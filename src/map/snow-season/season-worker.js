import {SnowSeasonEstimator} from './season-estimator.js'
import {NveBrowserSnowDepthSource} from './nve-source.js'
import {SnowSeasonStore} from './store.js'
import {compactSnowEstimate} from './grid.js'
import {chunksForExtent} from './chunk-grid.js'
import {SnowCollectionQueue} from './collection-queue.js'
import {renderSnowTile} from './tile-renderer.js'
const estimator=new SnowSeasonEstimator(),cohort=estimator.cohort,source=new NveBrowserSnowDepthSource()
const queue=new SnowCollectionQueue(),loading=new Map(),changedChunks=new Set();let visibleChunks=new Set()
let generation=0,running=0,pauseUntil=0,changeTimer=null,progressTimer=null,retryTimer=null,drained=0
const store=new SnowSeasonStore(`v1/${cohort.firstEndYear}/${cohort.lastEndYear}/0mm`,{onChange:address=>{
 changedChunks.add(address.key)
 if(!changeTimer)changeTimer=setTimeout(()=>{changeTimer=null;postMessage({type:'chunks',keys:[...changedChunks]});changedChunks.clear()},500)
}})
function progress(){if(!progressTimer)progressTimer=setTimeout(()=>{progressTimer=null;postMessage({type:'progress',generation,completed:queue.completed,total:queue.total,active:running,preparing:loading.size,paused:Date.now()<pauseUntil})},200)}
function next(){return queue.take()}
async function load(cell){
 const cached=await store.get(cell.key);if(cached)return cached
 try{
  const input=await source.load({x:cell.x,y:cell.y,startDate:cohort.startDate,endDate:cohort.endDate})
  if(input.source.supplementError)throw new Error(input.source.supplementError)
  const value=compactSnowEstimate(estimator.estimate(input),input);await store.put(cell.key,value);return value
 }catch(error){
  if(error.noCell){const value={status:'outside-model',start:null,end:null,days:null,unknownDays:0,recoveredDays:0};await store.put(cell.key,value);return value}
  throw error
 }
}
function pump(){
 if(Date.now()<pauseUntil||[...loading.keys()].some(key=>visibleChunks.has(key)))return
 while(running<4){
  const cell=next();if(!cell){if(!running)store.flush();break}
  running++
  load(cell).then(()=>queue.complete(cell)).catch(error=>{
   // Keep completed cells and queued chunks. Retry later without a request storm.
   queue.retry(cell);pauseUntil=Date.now()+30000
   postMessage({type:'error',generation,message:error.message||String(error)})
   if(!retryTimer)retryTimer=setTimeout(()=>{retryTimer=null;pump()},30000)
  }).finally(()=>{running--;progress();if(++drained%128===0)setTimeout(pump,0);else pump()})
 }
 progress()
}
function schedule(extent){
 queue.setViewport(extent)
 const chunks=chunksForExtent(extent);visibleChunks=new Set(chunks.map(chunk=>chunk.key))
 for(const chunk of chunks)if(!queue.has(chunk.key)&&!loading.has(chunk.key)){
  const pending=store.getChunk(chunk.cx,chunk.cy).then(value=>queue.addChunk(value)).catch(error=>postMessage({type:'error',generation,message:error.message||String(error)})).finally(()=>{loading.delete(chunk.key);progress();pump()})
  loading.set(chunk.key,pending)
 }
 pump()
}
onmessage=async({data})=>{
 if(data.type==='view'){generation=data.generation;if(data.retry)pauseUntil=0;schedule(data.extent);return}
 if(data.type==='flush'){await store.flush();postMessage({type:'flushed',id:data.id});return}
 try{
  if(data.type==='inspect'){const value=await store.get(data.key);postMessage({type:'inspection',id:data.id,value});return}
  if(data.type==='render'){
   const pixels=await renderSnowTile(store,data)
   postMessage({type:'tile',id:data.id,pixels},[pixels.buffer]);return
  }
 }catch(error){postMessage({type:'request-error',id:data.id,message:error.message||String(error)})}
}
