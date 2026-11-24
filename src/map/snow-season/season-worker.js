import {SnowSeasonEstimator} from './season-estimator.js'
import {NveBrowserSnowDepthSource} from './nve-source.js'
import {SnowSeasonStore} from './store.js'
import {compactSnowEstimate} from './grid.js'
const estimator=new SnowSeasonEstimator(),cohort=estimator.cohort,store=new SnowSeasonStore(`v1/${cohort.firstEndYear}/${cohort.lastEndYear}/0mm`)
let wanted=new Map(),queue=[],generation=0,finished=new Set(),running=0,failed=false
const active=new Map(),inFlight=new Set()
function progress(){postMessage({type:'progress',generation,completed:finished.size,total:wanted.size,active:running,failed})}
async function load(cell){
 const cached=await store.get(cell.key)
 if(cached)return cached
 if(!wanted.has(cell.key))return null
 const controller=new AbortController();active.set(cell.key,controller)
 const source=new NveBrowserSnowDepthSource({fetchImpl:(url,options)=>fetch(url,{...options,signal:AbortSignal.any([controller.signal,options.signal])})})
 try{
  const input=await source.load({x:cell.x,y:cell.y,startDate:cohort.startDate,endDate:cohort.endDate})
  if(input.source.supplementError)throw new Error(input.source.supplementError)
  const value=compactSnowEstimate(estimator.estimate(input),input);await store.put(cell.key,value);return value
 }catch(error){
  if(error.noCell){const value={status:'outside-model',start:null,end:null,days:null,unknownDays:0,recoveredDays:0};await store.put(cell.key,value);return value}
  throw error
 }finally{active.delete(cell.key)}
}
function pump(){
 while(running<4&&queue.length&&!failed){
  const cell=queue.shift();if(!wanted.has(cell.key)||finished.has(cell.key)||inFlight.has(cell.key))continue
  running++;inFlight.add(cell.key)
  load(cell).then(value=>{
   if(value&&wanted.has(cell.key)){finished.add(cell.key);postMessage({type:'cell',generation,key:cell.key,value})}
  }).catch(error=>{
   if(error.name==='AbortError'){if(wanted.has(cell.key)&&!failed)queue.push(wanted.get(cell.key));return}
   if(!wanted.has(cell.key))return
   failed=true;queue=[];for(const controller of active.values())controller.abort()
   postMessage({type:'error',generation,message:error.message||String(error)})
  }).finally(()=>{running--;inFlight.delete(cell.key);progress();pump()})
 }
 progress()
}
onmessage=({data})=>{
 if(data.type!=='view')return
 generation=data.generation;wanted=new Map(data.cells.map(cell=>[cell.key,cell]));finished=new Set();failed=false
 for(const [key,controller] of active)if(!wanted.has(key))controller.abort()
 queue=data.cells.slice();pump()
}
