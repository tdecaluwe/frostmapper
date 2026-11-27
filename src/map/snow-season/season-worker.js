import {SnowSeasonEstimator} from './season-estimator.js?v=snow-depth-v3'
import {SnowArchiveSource,SnowArchiveRequestPool} from './archive-source.js?v=snow-depth-v3'
import {intersectsViewport} from './area-grid.js?v=snow-depth-v3'
import {SnowSeasonStore} from './store.js?v=snow-depth-v3'
import {estimateAnnualSeasons} from './annual-seasons.js?v=snow-depth-v3'
import {chunksForExtent} from './chunk-grid.js?v=snow-depth-v3'
import {SnowCollectionQueue} from './collection-queue.js?v=snow-depth-v3'
import {renderSnowTile} from './tile-renderer.js?v=snow-depth-v3'
const FETCH_CONCURRENCY=8
const estimator=new SnowSeasonEstimator(),cohort=estimator.cohort,pool=new SnowArchiveRequestPool({concurrency:FETCH_CONCURRENCY,onChange:()=>progress()}),source=new SnowArchiveSource({pool,depthBands:true})
const queue=new SnowCollectionQueue(),loading=new Map(),areas=new Map(),changedChunks=new Set();let visibleChunks=new Set()
let generation=0,pauseUntil=0,changeTimer=null,progressTimer=null,retryTimer=null
const store=new SnowSeasonStore(`v3/annual-depths/${cohort.firstEndYear}/${cohort.lastEndYear}`,{firstEndYear:cohort.firstEndYear,years:cohort.years,onChange:address=>{
 changedChunks.add(address.key)
 if(!changeTimer)changeTimer=setTimeout(()=>{changeTimer=null;postMessage({type:'chunks',keys:[...changedChunks]});changedChunks.clear()},500)
}})
function progress(){if(!progressTimer)progressTimer=setTimeout(()=>{progressTimer=null;postMessage({type:'progress',generation,completed:queue.completed,total:queue.total,active:pool.active,processing:areas.size,preparing:loading.size,paused:Date.now()<pauseUntil})},200)}
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))
async function collect(area){
 const loaded=await source.load(area,cohort,{priority:()=>intersectsViewport(area,queue.extent)?0:1});let complete=false
 try{
 // Current-view cells are calculated first; the randomized order within each
 // group avoids row-by-row fill when a block becomes ready.
 const cells=area.cells.slice().sort((a,b)=>Number(inView(b))-Number(inView(a)))
 function inView(cell){const e=queue.extent;return e&&cell.x>=e[0]&&cell.x<e[2]&&cell.y>=e[1]&&cell.y<e[3]}
 for(let i=0;i<cells.length;i++){
  const cell=cells[i],input=loaded.inputForCell(cell.localIndex),value=estimateAnnualSeasons(input,cohort)
  await store.put(cell.key,value);queue.complete(cell);progress()
  if(i%16===15)await yieldTask()
 }
 await store.flush();complete=true
 }finally{source.release(loaded.key,{keep:!complete})}
}
function backoff(){
 pool.paused=true;pauseUntil=Date.now()+30000;clearTimeout(retryTimer)
 retryTimer=setTimeout(()=>{retryTimer=null;pool.paused=false;pool.pump();pump()},30000)
}
function pump(){
 if(Date.now()<pauseUntil||[...loading.keys()].some(key=>visibleChunks.has(key)))return
 while(areas.size<4){
  let area=queue.takeBlock({background:false})
  if(!area){if(areas.size>=2)break;area=queue.takeBlock()}
  if(!area){if(!areas.size)store.flush();break}
  areas.set(area.key,area)
  collect(area).catch(error=>{
   queue.retryBlock(area);backoff()
   postMessage({type:'error',generation,message:error.message||String(error)})
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
 if(data.type==='view'){generation=data.generation;if(data.retry){pauseUntil=0;clearTimeout(retryTimer);retryTimer=null;pool.paused=false;pool.pump()}schedule(data.extent);return}
 if(data.type==='flush'){await store.flush();postMessage({type:'flushed',id:data.id});return}
 try{
  if(data.type==='inspect'){const value=await store.get(data.key,data.minimumDepth??0);postMessage({type:'inspection',id:data.id,value});return}
  if(data.type==='render'){
   const pixels=await renderSnowTile(store,data)
   postMessage({type:'tile',id:data.id,pixels},[pixels.buffer]);return
  }
 }catch(error){postMessage({type:'request-error',id:data.id,message:error.message||String(error)})}
}
