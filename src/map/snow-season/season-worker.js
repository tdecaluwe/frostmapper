import {SnowSeasonEstimator} from './season-estimator.js'
import {NveBrowserSnowDepthSource} from './nve-source.js'
import {SnowSeasonStore} from './store.js'
import {compactSnowEstimate,visibleSnowCells,SNOW_EXTENT} from './grid.js'
import {chunksForExtent,chunkCell,nativeCell,inSnowDomain} from './chunk-grid.js'
import {renderSnowTile} from './tile-renderer.js'
const estimator=new SnowSeasonEstimator(),cohort=estimator.cohort,source=new NveBrowserSnowDepthSource()
const jobs=new Map(),inFlight=new Set(),changedChunks=new Set()
let generation=0,priority=[],priorityIndex=0,ordered=[],running=0,completed=0,total=0,pauseUntil=0,changeTimer=null,progressTimer=null,retryTimer=null,drained=0
const store=new SnowSeasonStore(`v1/${cohort.firstEndYear}/${cohort.lastEndYear}/0mm`,{onChange:address=>{
 changedChunks.add(address.key)
 if(!changeTimer)changeTimer=setTimeout(()=>{changeTimer=null;postMessage({type:'chunks',keys:[...changedChunks]});changedChunks.clear()},500)
}})
function progress(){if(!progressTimer)progressTimer=setTimeout(()=>{progressTimer=null;postMessage({type:'progress',generation,completed,total,active:running,paused:Date.now()<pauseUntil})},200)}
function done(cell){const a=chunkCell(cell.key),job=jobs.get(a.key);return !job||Boolean(job.done[a.index>>>3]&(1<<(a.index&7)))}
function finish(cell){const a=chunkCell(cell.key),job=jobs.get(a.key);if(job&&!done(cell)){job.done[a.index>>>3]|=1<<(a.index&7);completed++;job.completed++}}
function next(){
 while(priorityIndex<priority.length){const cell=priority[priorityIndex++];if(!done(cell)&&!inFlight.has(cell.key))return cell}
 for(const job of ordered){if(job.cursor>=10000&&job.completed<job.total)job.cursor=0;while(job.cursor<10000){const cell=nativeCell(job.cx,job.cy,job.cursor++);if(inSnowDomain(cell)&&!done(cell)&&!inFlight.has(cell.key))return cell}}
 return null
}
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
 if(Date.now()<pauseUntil)return
 while(running<4){
  const cell=next();if(!cell){if(!running)store.flush();break}
  running++;inFlight.add(cell.key)
  load(cell).then(()=>finish(cell)).catch(error=>{
   // Keep completed cells and queued chunks. Retry later without a request storm.
   priority.splice(priorityIndex,0,cell);pauseUntil=Date.now()+30000
   postMessage({type:'error',generation,message:error.message||String(error)})
   if(!retryTimer)retryTimer=setTimeout(()=>{retryTimer=null;pump()},30000)
  }).finally(()=>{running--;inFlight.delete(cell.key);progress();if(++drained%128===0)setTimeout(pump,0);else pump()})
 }
 progress()
}
function schedule(extent){
 for(const chunk of chunksForExtent(extent))if(!jobs.has(chunk.key)){
  const width=Math.min(100,(SNOW_EXTENT[2]-SNOW_EXTENT[0])/1000-chunk.cx*100),height=Math.min(100,(SNOW_EXTENT[3]-SNOW_EXTENT[1])/1000-chunk.cy*100)
  jobs.set(chunk.key,{...chunk,cursor:0,completed:0,total:width*height,done:new Uint8Array(1250)});total+=width*height
 }
 const centre=extent?[(extent[0]+extent[2])/2,(extent[1]+extent[3])/2]:[0,0],visible=new Set(chunksForExtent(extent).map(c=>c.key))
 ordered=[...jobs.values()].sort((a,b)=>Number(visible.has(b.key))-Number(visible.has(a.key))||distance(a)-distance(b))
 function distance(c){const p=nativeCell(c.cx,c.cy,5050);return (p.x-centre[0])**2+(p.y-centre[1])**2}
 let grid=extent?visibleSnowCells(extent):{cells:[]}
 if(grid.tooWide){const x=Math.max(SNOW_EXTENT[0],Math.min(SNOW_EXTENT[2],centre[0])),y=Math.max(SNOW_EXTENT[1],Math.min(SNOW_EXTENT[3],centre[1]));grid=visibleSnowCells([x-32000,y-32000,x+32000,y+32000])}
 priority=grid.cells??[];priorityIndex=0;pump()
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
