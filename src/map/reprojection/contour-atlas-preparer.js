import {PROJECTION_STRINGS} from '../projections/index.js?v=grieger-wrap'
import {MAX_SOURCE_ZOOM} from './contour-atlas-config.js'

const CACHE_PREFIX='frostmapper:contour-atlas:v5:'

export function contourAtlasCacheKey(targetDefinition,sourceDefinition,coordinateProjection){
 return `${CACHE_PREFIX}${coordinateProjection}:${targetDefinition}:${sourceDefinition}`
}

export class ContourAtlasPreparer{
 constructor(){
  this.pending=new Map();this.nextId=0
  this.worker=null
 }
 createWorker(){
  if(this.worker)return true
  try{
   this.worker=new Worker(new URL('./contour-atlas-worker.js?v=atlas-fast-v4',import.meta.url),{type:'module'})
   this.worker.onmessage=event=>this.receive(event.data)
   this.worker.onerror=event=>this.failAll(event.message||'Contour atlas worker failed')
  }catch{this.worker=null}
  return !!this.worker
 }
 prepare(targetCode,coordinateProjection,onUpdate=()=>{}){
  const targetDefinition=PROJECTION_STRINGS[targetCode],sourceDefinition=PROJECTION_STRINGS['EPSG:3857']
  if(!targetDefinition||!sourceDefinition)return Promise.reject(Error('Unsupported contour projection'))
  const key=contourAtlasCacheKey(targetDefinition,sourceDefinition,coordinateProjection)
  try{
   const cached=localStorage.getItem(key)
   if(cached){
    const data=JSON.parse(cached)
    if(data.version===1&&data.target===targetCode&&data.coordinateProjection===(coordinateProjection==='source'?'EPSG:3857':targetCode)&&data.targetDefinition===targetDefinition&&data.sourceDefinition===sourceDefinition&&data.highestSourceZoom===MAX_SOURCE_ZOOM){try{onUpdate(data,'complete')}catch(error){console.error('Contour atlas update callback failed:',error)}return Promise.resolve(data)}
    localStorage.removeItem(key)
   }
  }catch{}
  if(this.pending.has(key)){const entry=this.pending.get(key);entry.listeners.add(onUpdate);return entry.promise}
  if(!this.createWorker())return Promise.reject(Error('Contour atlas worker unavailable'))
  const id=++this.nextId
  let resolve,reject
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no})
  this.pending.set(key,{id,promise,resolve,reject,key,listeners:new Set([onUpdate]),hasUpdates:false})
  try{this.worker.postMessage({type:'build',id,key,targetCode,targetDefinition,sourceDefinition,coordinateProjection})}
  catch(error){this.pending.delete(key);reject(error)}
  return promise
 }
 receive(message){
  const entry=[...this.pending.values()].find(item=>item.id===message.id)
  if(!entry)return
  if(message.type==='update'){
   entry.hasUpdates=true
   for(const listener of entry.listeners)try{listener(message.data,message.stage)}catch(error){console.error('Contour atlas update callback failed:',error)}
   return
  }
  this.pending.delete(entry.key)
  if(message.type==='error'){entry.reject(Error(message.error));return}
  try{localStorage.setItem(entry.key,message.json)}catch{}
  if(!entry.hasUpdates)for(const listener of entry.listeners)try{listener(message.data,'complete')}catch(error){console.error('Contour atlas update callback failed:',error)}
  entry.resolve(message.data)
 }
 failAll(message){
  for(const entry of this.pending.values())entry.reject(Error(message))
  this.pending.clear()
  this.worker?.terminate();this.worker=null
 }
}
