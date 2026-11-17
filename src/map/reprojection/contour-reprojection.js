import {equivalent} from 'ol/proj.js'
import {wrapAndSliceX} from 'ol/extent.js'
import {DistortionField} from './distortion.js?v=atlas-fast-v2'
import {ContourPlanClient} from './contour-plan-client.js?v=progressive-reproj-v1'
import {SourceTileAssembler} from './source-assembler.js?v=progressive-reproj-v1'
import {enableProgressiveReprojection} from './progressive-reproj-tile.js?v=progressive-reproj-v1'
import {ZoomLevelSupervisor} from './zoom-level-supervisor.js?v=supervisor-v5'

function eachSpan(spans,callback){
 if(ArrayBuffer.isView(spans)){for(let i=0;i<spans.length;i+=4)callback(spans[i],spans[i+1],spans[i+2],spans[i+3]);return}
 for(const span of spans)callback(span.x,span.y,span.width,span.band)
}
function splitTile(extent,width,height,minimumStep){
 const midX=(extent[0]+extent[2])/2,midY=(extent[1]+extent[3])/2,midPixelX=Math.floor(width/2),midPixelY=Math.floor(height/2)
 const parts=[
  {extent:[extent[0],midY,midX,extent[3]],width:midPixelX,height:midPixelY,offset:[0,0]},
  {extent:[midX,midY,extent[2],extent[3]],width:width-midPixelX,height:midPixelY,offset:[midPixelX,0]},
  {extent:[extent[0],extent[1],midX,midY],width:midPixelX,height:height-midPixelY,offset:[0,midPixelY]},
  {extent:[midX,extent[1],extent[2],midY],width:width-midPixelX,height:height-midPixelY,offset:[midPixelX,midPixelY]}
 ]
 return parts.map(part=>({
  offset:part.offset,
  request:{extent:part.extent,width:part.width,height:part.height,minimumStep},
  makeChildren:()=>splitTile(part.extent,part.width,part.height,minimumStep)
 }))
}

// Owns shared projection-pair data and short-lived mask
// plans. The source adapter below owns OpenLayers integration for each layer.
export class ContourReprojection {
 constructor(map,{steps=4}={}){
  this.map=map;this.fields=new Map();this.sources=new Set();this.assemblers=new WeakMap();this.signature='none'
  this.planWorker=new ContourPlanClient()
  this.zoomSupervisor=new ZoomLevelSupervisor({planClient:this.planWorker,steps,onAtlasChange:entry=>{
   if(this.map.getView().getProjection().getCode()!==entry.targetCode)return
   const wasActive=this.signature===entry.targetCode
   this.setSignature(this.zoomSupervisor.getAtlas(entry.targetCode,entry.sourceCode,entry.coordinateProjection)?entry.targetCode:'none')
   if(wasActive)for(const source of this.sources)source.changed()
  }})
  map.on('change:view',()=>this.update())
  this.update()
 }
 field(target,source){const key=`${target.getCode()}|${source.getCode()}`;if(!this.fields.has(key))this.fields.set(key,new DistortionField(target,source));return this.fields.get(key)}
 update(){
  const view=this.map.getView(),projection=view.getProjection(),code=projection.getCode()
  if(code==='EPSG:3857'){this.setSignature('none');return}
  const source=[...this.sources].find(s=>s.getProjection()?.getCode()==='EPSG:3857')
  if(!source){this.setSignature('none');return}
  this.zoomSupervisor.anticipateProjectionTranslation(code,source.getProjection().getCode(),'source').catch(error=>console.error('Source contour atlas preparation failed:',error))
  if(this.zoomSupervisor.getAtlas(code,source.getProjection().getCode(),'source'))this.setSignature(code)
  else this.setSignature('none')
 }
 sourcePlan(source,code,key,extent,width,height,minimumStep){
  const sourceCode=source.getProjection().getCode(),id=this.zoomSupervisor.atlasId(code,sourceCode,'source'),versionedKey=`${key}|atlas:${this.zoomSupervisor.getRevision(code,sourceCode,'source')}`,cached=this.planWorker.peek(id,versionedKey)
  if(cached)return cached
  return this.planWorker.enqueue(id,versionedKey,()=>({extent,width,height,minimumStep}),source,()=>splitTile(extent,width,height,minimumStep))
 }
 footprintPlan(source,code,z,coord,sourceExtent,reference,minimumStep,steps){
  const sourceProjection=source.getProjection(),parts=wrapAndSliceX(sourceExtent.slice(),sourceProjection,true)
  if(!parts.length)return null
  const sourceGrid=source.getTileGridForProjection(sourceProjection),width=256,height=256
  let lowest=sourceGrid.getMaxZoom(),highest=sourceGrid.getMinZoom()
  const plans=parts.map((extent,part)=>{
   const extentKey=extent.map(value=>Math.round(value*1000)).join(','),key=`footprint/${z}/${coord[1]}/${coord[2]}/${width}x${height}/s${minimumStep}/${part}/${extentKey}`
   return this.sourcePlan(source,code,key,extent,width,height,minimumStep)
  })
  if(plans.some(planned=>!planned?.ready||!planned.complete||!planned.spans))return null
  for(const planned of plans){
   let minBand=Infinity,maxBand=-Infinity
   eachSpan(planned.spans,(_x,_y,_width,band)=>{minBand=Math.min(minBand,band);maxBand=Math.max(maxBand,band)})
   if(minBand!==Infinity){
    const bounds=this.zoomSupervisor.sourceZoomBoundsForBands(code,sourceProjection.getCode(),z,reference,minBand,maxBand,sourceGrid.getMinZoom(),sourceGrid.getMaxZoom(),steps)
    lowest=Math.min(lowest,bounds.minimum);highest=Math.max(highest,bounds.maximum)
   }
  }
  return {lowest,highest,requested:Math.min(sourceGrid.getMaxZoom(),lowest+(highest>lowest?1:0)),maximumZoom:Math.min(highest,lowest+2)}
 }
 setSignature(signature){
  if(this.signature===signature)return
  this.signature=signature
  for(const source of this.sources)source.changed()
 }
 addSource(source){
  if(this.sources.has(source))return
  this.sources.add(source);const original=source.getTile,originalKey=source.getKey,manager=this
  const originalInternal=source.getTileInternal
  const assembler=new SourceTileAssembler(source);this.assemblers.set(source,assembler)
  source.getKey=function(){const sourceCode=this.getProjection()?.getCode();return `${originalKey.call(this)}|bands:${manager.signature}|atlas:${manager.zoomSupervisor.getRevision(manager.signature,sourceCode,'source')}|${manager.zoomSupervisor.getAtlas(manager.signature,sourceCode,'source')?'ready':'pending'}|plans:${manager.planWorker.completeRevision}`}
  source.getTile=function(z,x,y,pixelRatio,target){
   const src=this.getProjection(),atlas=target&&manager.zoomSupervisor.getAtlas(target.getCode(),src?.getCode(),'source')
   if(!atlas||!src||equivalent(src,target))return original.call(this,z,x,y,pixelRatio,target)
   const sourceGrid=this.getTileGridForProjection(src),targetGrid=this.getTileGridForProjection(target)
   const coord=this.getTileCoordForTileUrlFunction([z,x,y],target)
   if(!coord)return original.call(this,z,x,y,pixelRatio,target)
   const reference=Math.round(Math.log2(sourceGrid.getResolution(0)/targetGrid.getResolution(z)))
   const steps=atlas.steps||manager.zoomSupervisor.steps||1,minimumStep=(reference-sourceGrid.getMaxZoom())*steps,selection={},zoomLookup=manager.zoomSupervisor.sourceZoomLookup(target.getCode(),src.getCode(),z,reference,sourceGrid.getMinZoom(),sourceGrid.getMaxZoom(),atlas.minStep??atlas.minQuarter??-80,atlas.maxStep??atlas.maxQuarter??80,steps)
   const selectZoom=sourceExtent=>{
   const result=manager.footprintPlan(this,target.getCode(),z,coord,sourceExtent,reference,minimumStep,steps)
    if(!result)return undefined
    Object.assign(selection,result);return result.requested
   }
   const own=Object.prototype.hasOwnProperty.call(this,'getTileInternal')
   this.getTileInternal=function(sourceZ,sourceX,sourceY,ratio,projection){
    if(!Number.isFinite(selection.lowest))return originalInternal.call(this,sourceZ,sourceX,sourceY,ratio,projection)
    const sourceCoord=this.getTileCoordForTileUrlFunction([sourceZ,sourceX,sourceY],projection)
    if(!sourceCoord)return originalInternal.call(this,sourceZ,sourceX,sourceY,ratio,projection)
    const sourceExtent=sourceGrid.getTileCoordExtent(sourceCoord),sourceSize=sourceGrid.getTileSize(sourceZ),sourceWidth=typeof sourceSize==='number'?sourceSize:sourceSize[0],sourceHeight=typeof sourceSize==='number'?sourceSize:sourceSize[1],maximumZoom=selection.maximumZoom,sourceMinimumStep=(reference-maximumZoom)*steps,sourceKey=`${sourceZ}/${sourceCoord[1]}/${sourceCoord[2]}/${sourceWidth}/${sourceHeight}/s${sourceMinimumStep}`
    const sourcePlan=manager.sourcePlan(this,target.getCode(),sourceKey,sourceExtent,sourceWidth,sourceHeight,sourceMinimumStep)
    if(!sourcePlan.ready||!sourcePlan.spans)return originalInternal.call(this,sourceZ,sourceX,sourceY,ratio,projection)
    return assembler.getTile(sourceZ,sourceX,sourceY,ratio,projection,{spans:sourcePlan.spans,complete:sourcePlan.complete,reference,steps,zoomLookup,minimumZoom:selection.lowest,maximumZoom,original:originalInternal,cacheKey:this.getKey(),parentCacheKey:originalKey.call(this)})
   }
   try{return enableProgressiveReprojection(this.getTileAtSourceZoom(z,x,y,pixelRatio,target,undefined,undefined,undefined,selectZoom))}finally{if(own)this.getTileInternal=originalInternal;else delete this.getTileInternal}
  }
  this.update()
 }
}
