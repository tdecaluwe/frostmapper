import {ContourAtlasPreparer} from './contour-atlas-preparer.js?v=atlas-builder-v4'

// Owns projection-pair atlas lifecycles and announces each usable snapshot to
// the tile-plan worker. It also fixes band-to-source zoom mappings per target
// zoom so panning cannot change a band’s translation.
export class ZoomLevelSupervisor {
 constructor({planClient,onAtlasChange=()=>{},preparer=new ContourAtlasPreparer(),steps=4}={}){
  if(!Number.isInteger(steps)||steps<1)throw Error('Zoom-level steps must be a positive integer')
  this.planClient=planClient;this.onAtlasChange=onAtlasChange;this.preparer=preparer;this.steps=steps;this.entries=new Map()
 }
 key(targetCode,sourceCode,coordinateProjection){return `${targetCode}|${sourceCode}|${coordinateProjection}|steps=${this.steps}`}
 atlasId(targetCode,sourceCode,coordinateProjection){return `${targetCode}:${sourceCode}:${coordinateProjection}:steps-${this.steps}`}
 register(targetCode,sourceCode='EPSG:3857',coordinateProjection='source'){
  const key=this.key(targetCode,sourceCode,coordinateProjection)
  if(!this.entries.has(key))this.entries.set(key,{key,targetCode,sourceCode,coordinateProjection,steps:this.steps,status:'registered',data:null,revision:0,promise:null,anticipated:false,translations:new Map()})
  return this.entries.get(key)
 }
 // Signal likely future need before a reprojection tile asks for its mask.
 anticipateProjectionTranslation(targetCode,sourceCode='EPSG:3857',coordinateProjection='source'){
  const entry=this.register(targetCode,sourceCode,coordinateProjection)
  entry.anticipated=true
  if(entry.promise||entry.status==='ready'||entry.status==='failed')return entry.promise
  entry.status='preparing'
  const onUpdate=(data,stage)=>{
   entry.data=data;entry.revision++;entry.status=stage==='complete'?'ready':'refining'
   this.planClient?.register(this.atlasId(targetCode,sourceCode,coordinateProjection),data)
   this.onAtlasChange(entry,stage)
  }
  entry.promise=this.preparer.prepare(targetCode,sourceCode,coordinateProjection,this.steps,onUpdate).then(data=>{
   entry.data=data;entry.status='ready';return data
  }).catch(error=>{
   entry.status='failed';entry.error=error;this.onAtlasChange(entry,'failed');throw error
  })
  entry.promise.catch(()=>{})
  return entry.promise
 }
 getAtlas(targetCode,sourceCode='EPSG:3857',coordinateProjection='source'){
  return this.register(targetCode,sourceCode,coordinateProjection).data
 }
 getRevision(targetCode,sourceCode='EPSG:3857',coordinateProjection='source'){
  return this.register(targetCode,sourceCode,coordinateProjection).revision
 }
 getStatus(targetCode,sourceCode='EPSG:3857',coordinateProjection='source'){
  return this.register(targetCode,sourceCode,coordinateProjection).status
 }
 referenceFor(targetCode,sourceCode,targetZoom,reference){
  const entry=this.register(targetCode,sourceCode,'source'),key=String(targetZoom)
  if(!entry.translations.has(key))entry.translations.set(key,reference)
  return entry.translations.get(key)
 }
 sourceZoomForBand(targetCode,sourceCode,targetZoom,reference,band,minimum,maximum,steps=this.steps){
  const fixedReference=this.referenceFor(targetCode,sourceCode,targetZoom,reference)
  return Math.max(minimum,Math.min(maximum,fixedReference-Math.floor(band/steps)))
 }
}
