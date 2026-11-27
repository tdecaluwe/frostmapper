const DOWNLOAD_LOCK='frostmapper:senorge:download'
export function retryAfterMs(value,now=Date.now()){
 if(value===null||value===undefined||String(value).trim()==='')return null
 const seconds=Number(value)
 if(Number.isFinite(seconds))return seconds>=0?seconds*1000:null
 const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):null
}
export function abortableWait(ms,signal){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason);return}
  const done=()=>{signal?.removeEventListener('abort',abort);resolve()},timer=setTimeout(done,ms)
  const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason)}
  signal?.addEventListener('abort',abort,{once:true})
 })
}
/** A single small coordination record, never model/history data. */
class SnowRateState{
 constructor(){this.database=null;this.memory={id:'thredds',until:0,next:0,failures:0}}
 async open(){
  if(this.database)return this.database
  this.database=new Promise(resolve=>{
   if(!globalThis.indexedDB){resolve(null);return}
   let r;try{r=indexedDB.open('frostmapper-snow-network',1)}catch{resolve(null);return}
   let settled=false;const finish=value=>{if(settled){value?.close();return}settled=true;resolve(value)}
   r.onupgradeneeded=()=>r.result.createObjectStore('state',{keyPath:'id'})
   r.onerror=()=>finish(null);r.onblocked=()=>finish(null)
   r.onsuccess=()=>{const db=r.result;if(settled){db.close();return}db.onversionchange=()=>{this.database=null;db.close()};db.onclose=()=>{this.database=null};finish(db)}
  });const pending=this.database;pending.then(db=>{if(!db&&this.database===pending)this.database=null});return pending
 }
 async read(){
  try{const db=await this.open();if(db){const value=await new Promise((resolve,reject)=>{const r=db.transaction('state').objectStore('state').get('thredds');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});if(value)this.memory=value}}catch{this.database=null}
  return {...this.memory}
 }
 async write(value){
  this.memory={...value,id:'thredds'}
  try{const db=await this.open();if(db)await new Promise((resolve,reject)=>{const t=db.transaction('state','readwrite');t.objectStore('state').put(this.memory);t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error)})}catch{this.database=null}
 }
}
/** Web Locks cover the complete response body. Persistent state only remembers
 * pacing/cooldown deadlines; it never acts as a permanent tab ownership lock. */
export class SnowDownloadGate{
 constructor({locks=globalThis.navigator?.locks,state=new SnowRateState(),now=Date.now,wait=abortableWait,random=Math.random,spacingMs=250}={}){Object.assign(this,{locks,state,now,wait,random,spacingMs})}
 lock(name,fn,signal){
  if(!this.locks?.request)return Promise.reject(new Error('Shared download locks are unavailable in this browser'))
  return this.locks.request(name,{mode:'exclusive',...(signal?{signal}:{})},fn)
 }
 region(key,fn,signal){return this.lock(`frostmapper:senorge:season:${key}`,fn,signal)}
 async download(url,{fetchImpl=(...args)=>fetch(...args),signal,onProgress=()=>{}}={}){
  return this.lock(DOWNLOAD_LOCK,async()=>{
   const state=await this.state.read()
   for(;;){const delay=Math.max(state.until||0,state.next||0)-this.now();if(delay<=0)break;await this.wait(Math.min(delay,60000),signal)}
   signal?.throwIfAborted();onProgress()
   try{
    const response=await fetchImpl(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(120000)].filter(Boolean)),cache:'no-store'})
    if(!response.ok){
     const error=new Error(`Snow archive: HTTP ${response.status}`);error.status=response.status;error.retryAfter=retryAfterMs(response.headers?.get('Retry-After'),this.now());response.body?.cancel().catch(()=>{});throw error
    }
    let buffer
    if(response.body){
     const observed=response.body.pipeThrough(new TransformStream({transform(chunk,controller){onProgress();controller.enqueue(chunk)}}))
     buffer=await new Response(observed).arrayBuffer()
    }else buffer=await response.arrayBuffer()
    onProgress();await this.state.write({until:0,failures:0,next:this.now()+this.spacingMs});return buffer
   }catch(error){
    if(signal?.aborted)throw signal.reason??error
    const retryable=error instanceof TypeError||['TimeoutError','AbortError'].includes(error?.name)||[408,429].includes(error.status)||error.status>=500
    if(retryable){
     const failures=(state.failures||0)+1,base=error.status===429?30000:error.status>=500?5000:1000
     const delay=error.retryAfter??Math.min(300000,base*2**Math.min(5,failures-1))
     const until=this.now()+delay+this.random()*Math.min(1000,delay*.1)
     await this.state.write({until:Math.max(state.until||0,until),failures,next:this.now()+this.spacingMs})
    }else await this.state.write({...state,next:this.now()+this.spacingMs})
    throw error
   }
  },signal)
 }
}
let shared
export function snowDownloadGate(){return shared??=new SnowDownloadGate()}
