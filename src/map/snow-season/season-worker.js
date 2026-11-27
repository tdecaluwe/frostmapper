import {SnowSeasonEstimator} from './season-estimator.js?v=snow-serial-v6'
import {SnowArchiveSource,SnowArchiveRequestPool,SnowArchiveInterruptedError,transientSnowError} from './archive-source.js?v=snow-serial-v6'
import {intersectsViewport} from './area-grid.js?v=snow-serial-v6'
import {SnowSeasonStore} from './store.js?v=snow-serial-v6'
import {SnowChunkCollector} from './chunk-collector.js?v=snow-serial-v6'
import {snowDownloadGate} from './download-gate.js?v=snow-serial-v6'
import {chunksForExtent} from './chunk-grid.js?v=snow-serial-v6'
import {SnowCollectionQueue} from './collection-queue.js?v=snow-serial-v6'
import {renderSnowTile} from './tile-renderer.js?v=snow-serial-v6'
import {displayTileExtent,SNOW_RESOLUTIONS} from './chunk-grid.js?v=snow-serial-v6'
import {SnowRenderQueue} from './render-queue.js?v=snow-serial-v6'
const FETCH_CONCURRENCY=1
const estimator=new SnowSeasonEstimator(),cohort=estimator.cohort,pool=new SnowArchiveRequestPool({concurrency:FETCH_CONCURRENCY,onChange:()=>progress()}),source=new SnowArchiveSource({pool,depthBands:true})
const queue=new SnowCollectionQueue(),loading=new Map(),areas=new Map(),calculating=new Set(),changedChunks=new Set();let visibleChunks=new Set()
let generation=0,pauseUntil=0,changeTimer=null,progressTimer=null,retryTimer=null,connectionGeneration=0,preferredZ=SNOW_RESOLUTIONS.length-1
const store=new SnowSeasonStore(`v3/annual-depths/${cohort.firstEndYear}/${cohort.lastEndYear}`,{firstEndYear:cohort.firstEndYear,years:cohort.years,onChange:address=>{
 changedChunks.add(address.key)
 if(!changeTimer)changeTimer=setTimeout(()=>{changeTimer=null;postMessage({type:'chunks',keys:[...changedChunks]});changedChunks.clear()},500)
}})
const renders=new SnowRenderQueue((data,options)=>renderSnowTile(store,data,options),{priority:data=>(intersectsViewport({extent:displayTileExtent(data.z,data.x,data.y)},queue.extent)?1000:0)-10*Math.abs(data.z-preferredZ)+data.z/100})
function progress(){if(!progressTimer)progressTimer=setTimeout(()=>{progressTimer=null;postMessage({type:'progress',generation,completed:queue.completed,total:queue.total,active:pool.active,processing:calculating.size,preparing:loading.size,paused:Date.now()<pauseUntil})},200)}
const collector=new SnowChunkCollector({source,store,cohort,gate:snowDownloadGate(),onProcessing:(key,active)=>{if(active)calculating.add(key);else calculating.delete(key);progress()}})
async function collect(area){
 await collector.collect(area,{priority:()=>intersectsViewport(area,queue.extent)?0:1})
 queue.completeBlock(area);progress()
}
function backoff(){
 pool.paused=true;pauseUntil=Date.now()+30000;clearTimeout(retryTimer)
 retryTimer=setTimeout(()=>{retryTimer=null;pool.paused=false;pool.pump();pump()},30000)
}
function pump(){
 if(Date.now()<pauseUntil||[...loading.keys()].some(key=>visibleChunks.has(key)))return
 while(areas.size<2){
  let area=queue.takeBlock({background:false})
  if(!area){if(areas.size>=1)break;area=queue.takeBlock()}
  if(!area){if(!areas.size)store.flush().catch(error=>postMessage({type:'error',generation,message:error.message||String(error)}));break}
  areas.set(area.key,area)
  const connection=connectionGeneration
  collect(area).catch(error=>{
   queue.retryBlock(area)
   if(error instanceof SnowArchiveInterruptedError||(connection!==connectionGeneration&&transientSnowError(error)))return
   backoff();postMessage({type:'error',generation,retrying:transientSnowError(error),message:error.message||String(error)})
  }).finally(()=>{areas.delete(area.key);progress();pump()})
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
 if(data.type==='resume'){
  connectionGeneration++;pauseUntil=0;clearTimeout(retryTimer);retryTimer=null;pool.paused=true
  const interrupted=source.interruptStalled({force:Boolean(data.force)})
  pool.paused=false;pool.pump();pump();progress()
  postMessage({type:'resumed',id:data.id,value:{interrupted}});return
 }
 if(data.type==='view'){
  generation=data.generation
  if(Number.isFinite(data.nativeResolution)&&data.nativeResolution>0)preferredZ=SNOW_RESOLUTIONS.reduce((best,r,z)=>Math.abs(r-data.nativeResolution)<Math.abs(SNOW_RESOLUTIONS[best]-data.nativeResolution)?z:best,0)
  if(data.retry){pauseUntil=0;clearTimeout(retryTimer);retryTimer=null;pool.paused=false;pool.pump()}
  schedule(data.extent);return
 }
 try{
  if(data.type==='flush'){await store.flush();postMessage({type:'flushed',id:data.id});return}
  if(data.type==='inspect'){const value=await store.get(data.key,data.minimumDepth??0);postMessage({type:'inspection',id:data.id,value});return}
  if(data.type==='render'){
   const pixels=await renders.request(data)
   postMessage({type:'tile',id:data.id,pixels},[pixels.buffer]);return
  }
 }catch(error){postMessage({type:'request-error',id:data.id,message:error.message||String(error)})}
}
