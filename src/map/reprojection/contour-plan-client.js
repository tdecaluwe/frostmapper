// Cache contour masks prepared off-thread. Partial row batches are available
// to renderers while the worker continues planning the rest of a tile.
export class ContourPlanClient {
 constructor({cacheSize=8192,refreshDelay=16}={}){
  this.cache=new Map();this.completed=new Set();this.pending=new Set();this.jobs=new Map();this.records=new Map();this.atlases=new Set();this.sources=new Set();this.waiters=[];this.cacheSize=cacheSize;this.refreshDelay=refreshDelay;this.revision=0;this.timer=null;this.pumpTimer=null
  try{
   this.worker=new Worker(new URL('./contour-plan-worker.js?v=oriented-mask-v3',import.meta.url),{type:'module'})
   this.worker.onmessage=event=>this.receive(event.data)
   this.worker.onerror=()=>this.fail()
  }catch{this.worker=null}
 }
 register(id,data){
  if(!this.worker)return
  this.atlases.add(id);this.worker.postMessage({type:'atlas',id,data})
 }
 peek(atlas,key){
  const fullKey=`${atlas}|${key}`
  if(this.cache.has(fullKey)){
   const spans=this.cache.get(fullKey);this.cache.delete(fullKey);this.cache.set(fullKey,spans)
   return {ready:!!spans,complete:this.completed.has(fullKey),spans}
  }
  if(this.pending.has(fullKey)){
   const record=this.records.get(fullKey),spans=this.partialSpans(record)
   return {ready:!!spans,complete:false,spans}
  }
  return null
 }
 whenIdle(){
  if(!this.pending.size&&!this.jobs.size&&this.timer===null)return Promise.resolve()
  return new Promise(resolve=>this.waiters.push(resolve))
 }
 enqueue(atlas,key,makeRequest,source,makeChildren=null){
  const fullKey=`${atlas}|${key}`,cached=this.peek(atlas,key);if(cached){this.sources.add(source);return cached}
  if(!this.worker){this.cache.set(fullKey,null);return {ready:false,complete:false,spans:null}}
  if(!this.pending.has(fullKey)){
   this.pending.add(fullKey);this.records.set(fullKey,{atlas,makeChildren,depth:0,partialPacked:new Int32Array(0),partialLength:0});this.jobs.set(fullKey,{atlas,key:fullKey,makeRequest,depth:0});this.schedulePump()
  }
  this.sources.add(source)
  return {ready:false,complete:false,spans:null}
 }
 schedulePump(){
  if(this.pumpTimer!==null)return
  this.pumpTimer=setTimeout(()=>{
   this.pumpTimer=null;let count=0
   for(const [key,job] of this.jobs){
    this.jobs.delete(key)
    try{this.worker.postMessage({type:'plan',atlas:job.atlas,key:job.key,depth:job.depth,...job.makeRequest()})}
    catch{this.finish(key,null,false)}
    if(++count>=24)break
   }
   if(this.jobs.size)this.schedulePump()
   if(!this.pending.size)this.scheduleRefresh()
  },0)
 }
 scheduleRefresh(){
  if(this.timer!==null)return
  this.timer=setTimeout(()=>{
   this.timer=null;this.revision++
   const sources=[...this.sources];this.sources.clear()
   for(const source of sources)source.changed()
   if(!this.pending.size&&!this.jobs.size){for(const resolve of this.waiters)resolve();this.waiters=[]}
  },this.refreshDelay)
 }
 receive(message){
  if(message.type==='atlas-error'){console.error('Contour atlas worker rejected data:',message.error);return}
  if(message.type==='chunk'){
   const record=this.records.get(message.key)
   if(!record)return
   this.appendPartial(record,message.spans)
   if(!record.parent)this.scheduleRefresh()
   return
  }
  if(message.type==='split'){
   const record=this.records.get(message.key),children=record?.makeChildren?.()
   if(!record||record.depth>=4||!children?.length){this.finish(message.key,this.partialSpans(record),false);return}
   record.partialPacked=new Int32Array(0);record.partialLength=0
   if(!record.parent)this.scheduleRefresh()
   record.children=new Array(children.length);record.offsets=children.map(child=>child.offset);record.remaining=children.length;record.failed=false
   for(let i=0;i<children.length;i++){
    const child=children[i],childKey=`${message.key}/split-${i}`
    this.pending.add(childKey);this.records.set(childKey,{atlas:record.atlas,parent:message.key,index:i,offset:child.offset,makeChildren:child.makeChildren,depth:record.depth+1,partialPacked:new Int32Array(0),partialLength:0})
    this.jobs.set(childKey,{atlas:record.atlas,key:childKey,depth:record.depth+1,makeRequest:()=>child.request})
   }
   this.schedulePump();return
  }
  if(message.type==='complete'){
   const record=this.records.get(message.key)
   this.complete(message.key,this.partialSpans(record),true);return
  }
  if(message.type==='failed'){
   const record=this.records.get(message.key)
   this.complete(message.key,this.partialSpans(record),false)
  }
 }
 complete(key,spans,complete){
  const record=this.records.get(key)
  if(record?.parent){
   this.pending.delete(key);this.records.delete(key)
   const parent=this.records.get(record.parent)
   if(parent){
    parent.children[record.index]=spans
    if(!complete)parent.failed=true
    parent.remaining--
    if(parent.remaining===0){
     const packed=[]
     for(let i=0;i<parent.children.length;i++){
      const child=parent.children[i],offset=parent.offsets[i]
      if(!child)continue
      for(let j=0;j<child.length;j+=4)packed.push(child[j]+offset[0],child[j+1]+offset[1],child[j+2],child[j+3])
     }
     const merged=packed.length?Int32Array.from(packed):null
     this.complete(record.parent,merged,!parent.failed)
    }else if(parent.parent&&spans){
     const translated=this.translate(spans,record.offset)
     this.appendPartial(parent,translated)
    }else if(!parent.parent&&spans){
     const translated=this.translate(spans,record.offset)
     this.appendPartial(parent,translated);this.scheduleRefresh()
    }
   }
   return
  }
  this.finish(key,spans,complete)
 }
 translate(spans,offset){
  const result=new Int32Array(spans.length)
  for(let i=0;i<spans.length;i+=4){result[i]=spans[i]+offset[0];result[i+1]=spans[i+1]+offset[1];result[i+2]=spans[i+2];result[i+3]=spans[i+3]}
  return result
 }
 appendPartial(record,chunk){
  const required=record.partialLength+chunk.length
  if(record.partialPacked.length<required){
   const capacity=Math.max(required,record.partialPacked.length?record.partialPacked.length*2:256),packed=new Int32Array(capacity)
   packed.set(record.partialPacked.subarray(0,record.partialLength));record.partialPacked=packed
  }
  record.partialPacked.set(chunk,record.partialLength);record.partialLength=required
 }
 partialSpans(record){
  return record?.partialLength?record.partialPacked.subarray(0,record.partialLength):null
 }
 finish(key,spans,complete){
  if(!this.pending.delete(key))return
  // A partial plan is useful while it is progressing, but an exhausted or
  // failed plan must return to ordinary reprojection instead of caching a
  // permanently incomplete mask.
  if(!complete)spans=null
  this.records.delete(key);this.cache.set(key,spans)
  if(complete)this.completed.add(key);else this.completed.delete(key)
  while(this.cache.size>this.cacheSize){const oldest=this.cache.keys().next().value;this.cache.delete(oldest);this.completed.delete(oldest)}
  this.scheduleRefresh()
 }
 fail(){
  if(!this.worker)return
  this.worker.terminate();this.worker=null;this.jobs.clear();this.records.clear();clearTimeout(this.pumpTimer);this.pumpTimer=null
  for(const key of this.pending){this.cache.set(key,null);this.completed.delete(key)}
  this.pending.clear()
  clearTimeout(this.timer);this.timer=null
  const sources=[...this.sources];this.sources.clear()
  for(const source of sources)source.changed()
  for(const resolve of this.waiters)resolve();this.waiters=[]
 }
}
