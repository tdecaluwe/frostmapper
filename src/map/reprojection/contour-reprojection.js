import {equivalent} from 'ol/proj.js'
import {wrapAndSliceX} from 'ol/extent.js'
import {DistortionField} from './distortion.js?v=atlas-fast-v2'
import {ContourPlanClient} from './contour-plan-client.js?v=incremental-mask'
import {SourceTileAssembler} from './source-assembler.js?v=worker-plans-r5'
import {ContourAtlasPreparer} from './contour-atlas-preparer.js?v=atlas-fast-v3'

function eachSpan(spans,callback){
 if(ArrayBuffer.isView(spans)){for(let i=0;i<spans.length;i+=4)callback({x:spans[i],y:spans[i+1],width:spans[i+2],band:spans[i+3]});return}
 for(const span of spans)callback(span)
}
const intersects=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1]
function tileAnchor(extent,width,height,distortionAt){
 const samples=[[.5,.5],[.25,.5],[.75,.5],[.5,.25],[.5,.75],[.25,.25],[.75,.25],[.25,.75],[.75,.75]]
 for(const [fx,fy] of samples){
  const point=[extent[0]+fx*(extent[2]-extent[0]),extent[3]-fy*(extent[3]-extent[1])],value=distortionAt(point)
  if(Number.isFinite(value))return {value,x:fx*width,y:fy*height}
 }
 return null
}
function splitTile(extent,width,height,anchorAt,minimumQuarter){
 const midX=(extent[0]+extent[2])/2,midY=(extent[1]+extent[3])/2,midPixelX=Math.floor(width/2),midPixelY=Math.floor(height/2)
 const parts=[
  {extent:[extent[0],midY,midX,extent[3]],width:midPixelX,height:midPixelY,offset:[0,0]},
  {extent:[midX,midY,extent[2],extent[3]],width:width-midPixelX,height:midPixelY,offset:[midPixelX,0]},
  {extent:[extent[0],extent[1],midX,midY],width:midPixelX,height:height-midPixelY,offset:[0,midPixelY]},
  {extent:[midX,extent[1],extent[2],midY],width:width-midPixelX,height:height-midPixelY,offset:[midPixelX,midPixelY]}
 ]
 return parts.map(part=>({
  offset:part.offset,
  request:{extent:part.extent,width:part.width,height:part.height,anchor:anchorAt(part.extent,part.width,part.height),minimumQuarter},
  makeChildren:()=>splitTile(part.extent,part.width,part.height,anchorAt,minimumQuarter)
 }))
}

// Owns shared projection-pair data and short-lived mask
// plans. The source adapter below owns OpenLayers integration for each layer.
export class ContourReprojection {
 constructor(map){
  this.map=map;this.sourceAtlases=new Map();this.atlasRevisions=new Map();this.fields=new Map();this.sources=new Set();this.assemblers=new WeakMap();this.signature='none';this.atlasPreparer=new ContourAtlasPreparer()
  this.planWorker=new ContourPlanClient()
  map.on('change:view',()=>this.update())
  this.update()
 }
 field(target,source){const key=`${target.getCode()}|${source.getCode()}`;if(!this.fields.has(key))this.fields.set(key,new DistortionField(target,source));return this.fields.get(key)}
 update(){
  const view=this.map.getView(),projection=view.getProjection(),code=projection.getCode()
  if(!['EPSG:3035','EPSG:PEIRCE','FROST:TRIPTYCHIAL'].includes(code)){this.setSignature('none');return}
  const source=[...this.sources].find(s=>s.getProjection()?.getCode()==='EPSG:3857')
  if(!source){this.setSignature('none');return}
  if(!this.sourceAtlases.has(code)){
   this.sourceAtlases.set(code,null)
   this.atlasPreparer.prepare(code,'source',data=>{
    if(data.target!==code||data.source!=='EPSG:3857'||data.coordinateProjection!=='EPSG:3857')throw Error('Source contour projection mismatch')
    this.sourceAtlases.set(code,data);this.atlasRevisions.set(code,(this.atlasRevisions.get(code)||0)+1);this.planWorker.register(`${code}:source`,data)
    if(this.map.getView().getProjection().getCode()===code){const alreadyActive=this.signature===code;this.setSignature(code);if(alreadyActive)for(const item of this.sources)item.changed()}
   }).catch(error=>{
    console.error('Source contour atlas preparation failed:',error)
    this.sourceAtlases.set(code,false);this.atlasRevisions.set(code,(this.atlasRevisions.get(code)||0)+1)
    if(this.map.getView().getProjection().getCode()===code)this.setSignature('none')
   })
  }
  if(this.sourceAtlases.get(code))this.setSignature(code)
  else this.setSignature('none')
 }
 sourcePlan(source,code,key,extent,width,height,minimumQuarter,field){
  const atlas=this.sourceAtlases.get(code)
  if(atlas?.unrefinedExtents?.some(region=>intersects(extent,region)))return {ready:false,complete:false,spans:null}
  const id=`${code}:source`,versionedKey=`${key}|atlas:${this.atlasRevisions.get(code)||0}`,cached=this.planWorker.peek(id,versionedKey)
  if(cached)return cached
  const anchorAt=(tileExtent,tileWidth,tileHeight)=>tileAnchor(tileExtent,tileWidth,tileHeight,point=>field.atSource(point))
  return this.planWorker.enqueue(id,versionedKey,()=>({extent,width,height,anchor:anchorAt(extent,width,height),minimumQuarter}),source,()=>splitTile(extent,width,height,anchorAt,minimumQuarter))
 }
 footprintPlan(source,code,z,coord,sourceExtent,reference,minimumQuarter,field){
  const sourceProjection=source.getProjection(),parts=wrapAndSliceX(sourceExtent.slice(),sourceProjection,true)
  if(!parts.length)return null
  const sourceGrid=source.getTileGridForProjection(sourceProjection),width=256,height=256
  let lowest=sourceGrid.getMaxZoom(),highest=sourceGrid.getMinZoom()
  const plans=parts.map((extent,part)=>{
   const extentKey=extent.map(value=>Math.round(value*1000)).join(','),key=`footprint/${z}/${coord[1]}/${coord[2]}/${width}x${height}/q${minimumQuarter}/${part}/${extentKey}`
   return this.sourcePlan(source,code,key,extent,width,height,minimumQuarter,field)
  })
  if(plans.some(planned=>!planned?.ready||!planned.complete||!planned.spans))return null
  for(const planned of plans){
   eachSpan(planned.spans,span=>{
    const desired=Math.max(sourceGrid.getMinZoom(),Math.min(sourceGrid.getMaxZoom(),reference-span.band))
    lowest=Math.min(lowest,desired);highest=Math.max(highest,desired)
   })
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
  source.getKey=function(){return `${originalKey.call(this)}|bands:${manager.signature}|atlas:${manager.atlasRevisions.get(manager.signature)||0}|${manager.sourceAtlases.get(manager.signature)?'ready':'pending'}|plans:${manager.planWorker.revision}`}
  source.getTile=function(z,x,y,pixelRatio,target){
   const src=this.getProjection(),atlas=target&&manager.sourceAtlases.get(target.getCode())
   if(!atlas||!src||src.getCode()!=='EPSG:3857'||equivalent(src,target))return original.call(this,z,x,y,pixelRatio,target)
   const sourceGrid=this.getTileGridForProjection(src),targetGrid=this.getTileGridForProjection(target),field=manager.field(target,src)
   const coord=this.getTileCoordForTileUrlFunction([z,x,y],target)
   if(!coord)return original.call(this,z,x,y,pixelRatio,target)
   const reference=Math.round(Math.log2(sourceGrid.getResolution(0)/targetGrid.getResolution(z)))
   const minimumQuarter=4*(reference-sourceGrid.getMaxZoom()),selection={}
   const selectZoom=sourceExtent=>{
    const result=manager.footprintPlan(this,target.getCode(),z,coord,sourceExtent,reference,minimumQuarter,field)
    if(!result)return undefined
    Object.assign(selection,result);return result.requested
   }
   const own=Object.prototype.hasOwnProperty.call(this,'getTileInternal')
   this.getTileInternal=function(sourceZ,sourceX,sourceY,ratio,projection){
    if(!Number.isFinite(selection.lowest))return originalInternal.call(this,sourceZ,sourceX,sourceY,ratio,projection)
    const sourceCoord=this.getTileCoordForTileUrlFunction([sourceZ,sourceX,sourceY],projection)
    if(!sourceCoord)return originalInternal.call(this,sourceZ,sourceX,sourceY,ratio,projection)
    const sourceExtent=sourceGrid.getTileCoordExtent(sourceCoord),sourceSize=sourceGrid.getTileSize(sourceZ),sourceWidth=typeof sourceSize==='number'?sourceSize:sourceSize[0],sourceHeight=typeof sourceSize==='number'?sourceSize:sourceSize[1],maximumZoom=selection.maximumZoom,sourceMinimumQuarter=4*(reference-maximumZoom),sourceKey=`${sourceZ}/${sourceCoord[1]}/${sourceCoord[2]}/${sourceWidth}/${sourceHeight}/q${sourceMinimumQuarter}`
    const sourcePlan=manager.sourcePlan(this,target.getCode(),sourceKey,sourceExtent,sourceWidth,sourceHeight,sourceMinimumQuarter,field)
    if(!sourcePlan.ready||!sourcePlan.spans)return originalInternal.call(this,sourceZ,sourceX,sourceY,ratio,projection)
    return assembler.getTile(sourceZ,sourceX,sourceY,ratio,projection,{spans:sourcePlan.spans,reference,minimumZoom:selection.lowest,maximumZoom,original:originalInternal,cacheKey:this.getKey()})
   }
   try{return this.getTileAtSourceZoom(z,x,y,pixelRatio,target,undefined,undefined,undefined,selectZoom)}finally{if(own)this.getTileInternal=originalInternal;else delete this.getTileInternal}
  }
  this.update()
 }
}
