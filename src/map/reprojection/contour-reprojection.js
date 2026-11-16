import {equivalent} from 'ol/proj.js'
import {DistortionField} from './distortion.js?v=runtime-atlas'
import {ContourPlanClient} from './contour-plan-client.js?v=incremental-mask'
import {SourceTileAssembler} from './source-assembler.js?v=worker-plans-r4'
import {ContourAtlasPreparer} from './contour-atlas-preparer.js?v=runtime-atlas'

function eachSpan(spans,callback){
 if(ArrayBuffer.isView(spans)){for(let i=0;i<spans.length;i+=4)callback({x:spans[i],y:spans[i+1],width:spans[i+2],band:spans[i+3]});return}
 for(const span of spans)callback(span)
}
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
  this.map=map;this.atlases=new Map();this.sourceAtlases=new Map();this.fields=new Map();this.sources=new Set();this.assemblers=new WeakMap();this.signature='none';this.atlasPreparer=new ContourAtlasPreparer()
  this.planWorker=new ContourPlanClient()
  map.on('change:view',()=>this.update())
  map.on('moveend',()=>this.prepareViewport())
  this.update()
 }
 field(target,source){const key=`${target.getCode()}|${source.getCode()}`;if(!this.fields.has(key))this.fields.set(key,new DistortionField(target,source));return this.fields.get(key)}
 update(){
  const view=this.map.getView(),projection=view.getProjection(),code=projection.getCode()
  if(!['EPSG:3035','EPSG:PEIRCE','FROST:TRIPTYCHIAL'].includes(code)){this.setSignature('none');return}
  if(!this.atlases.has(code)){
   this.atlases.set(code,null)
   this.atlasPreparer.prepare(code,'target').then(data=>{
    if(data.target!==code||data.source!=='EPSG:3857')throw Error('Contour projection mismatch')
    this.atlases.set(code,true);this.planWorker.register(`${code}:target`,data);this.update();this.prepareViewport()
   }).catch(error=>{console.error('Contour atlas preparation failed:',error);this.atlases.set(code,false)})
  }
  const atlas=this.atlases.get(code),source=[...this.sources].find(s=>s.getProjection()?.getCode()==='EPSG:3857')
  if(!atlas||!source){this.setSignature('none');return}
  if(!this.sourceAtlases.has(code)){
   this.sourceAtlases.set(code,null)
   this.atlasPreparer.prepare(code,'source').then(data=>{
    if(data.target!==code||data.source!=='EPSG:3857'||data.coordinateProjection!=='EPSG:3857')throw Error('Source contour projection mismatch')
    this.sourceAtlases.set(code,true);this.planWorker.register(`${code}:source`,data);for(const item of this.sources)item.changed();this.update();this.prepareViewport()
   }).catch(error=>{console.error('Source contour atlas preparation failed:',error);this.sourceAtlases.set(code,false)})
  }
  this.setSignature(code)
 }
 targetPlan(source,code,z,coord,extent,width,height,field){
  const target=this.map.getView().getProjection(),targetGrid=source.getTileGridForProjection(target),sourceGrid=source.getTileGridForProjection(source.getProjection()),reference=Math.round(Math.log2(sourceGrid.getResolution(0)/targetGrid.getResolution(z))),minimumQuarter=4*(reference-sourceGrid.getMaxZoom())
  const key=`${z}/${coord[1]}/${coord[2]}/${width}/${height}/q${minimumQuarter}`
  const id=`${code}:target`,cached=this.planWorker.peek(id,key)
  if(cached)return cached
  const anchorAt=(tileExtent,tileWidth,tileHeight)=>tileAnchor(tileExtent,tileWidth,tileHeight,point=>field.at(point))
  return this.planWorker.enqueue(id,key,()=>({extent,width,height,anchor:anchorAt(extent,width,height),minimumQuarter}),source,()=>splitTile(extent,width,height,anchorAt,minimumQuarter))
 }
 prepareViewport(){
  const view=this.map.getView(),code=view.getProjection().getCode(),source=[...this.sources].find(item=>item.getProjection()?.getCode()==='EPSG:3857'),atlas=this.atlases.get(code)
  if(!source||!atlas||!this.sourceAtlases.get(code))return
  const grid=source.getTileGridForProjection(view.getProjection()),size=this.map.getSize()
  if(!size||!size[0]||!size[1])return
  const z=grid.getZForResolution(view.getResolution()),range=grid.getTileRangeForExtentAndZ(view.calculateExtent(size),z),tileSize=grid.getTileSize(z)
  const width=typeof tileSize==='number'?tileSize:tileSize[0],height=typeof tileSize==='number'?tileSize:tileSize[1]
  const field=this.field(view.getProjection(),source.getProjection()),minX=range.minX-1,maxX=range.maxX+1,minY=range.minY-1,maxY=range.maxY+1
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
   const coord=[z,x,y],normalized=source.getTileCoordForTileUrlFunction(coord,view.getProjection())
   if(!normalized)continue
   const extent=grid.getTileCoordExtent(normalized)
   this.targetPlan(source,code,z,normalized,extent,width,height,field)
  }
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
  source.getKey=function(){return `${originalKey.call(this)}|bands:${manager.signature}|${manager.sourceAtlases.get(manager.signature)?'ready':'pending'}|plans:${manager.planWorker.revision}`}
  source.getTile=function(z,x,y,pixelRatio,target){
   const src=this.getProjection(),atlas=target&&manager.sourceAtlases.get(target.getCode())
   if(!atlas||!src||src.getCode()!=='EPSG:3857'||equivalent(src,target))return original.call(this,z,x,y,pixelRatio,target)
   const sourceGrid=this.getTileGridForProjection(src),targetGrid=this.getTileGridForProjection(target),field=manager.field(target,src),targetAtlas=manager.atlases.get(target.getCode())
   const coord=this.getTileCoordForTileUrlFunction([z,x,y],target)
   if(!coord||!targetAtlas)return original.call(this,z,x,y,pixelRatio,target)
   const extent=targetGrid.getTileCoordExtent(coord),size=targetGrid.getTileSize(z),width=typeof size==='number'?size:size[0],height=typeof size==='number'?size:size[1]
   const reference=Math.round(Math.log2(sourceGrid.getResolution(0)/targetGrid.getResolution(z)))
   const planned=manager.targetPlan(this,target.getCode(),z,coord,extent,width,height,field)
   if(!planned.ready||!planned.spans)return original.call(this,z,x,y,pixelRatio,target)
   const spans=planned.spans
   if(!spans)return original.call(this,z,x,y,pixelRatio,target)
   let lowest=sourceGrid.getMaxZoom(),highest=sourceGrid.getMinZoom()
   eachSpan(spans,span=>{const desired=Math.max(sourceGrid.getMinZoom(),Math.min(sourceGrid.getMaxZoom(),reference-span.band));lowest=Math.min(lowest,desired);highest=Math.max(highest,desired)})
   const requested=Math.min(sourceGrid.getMaxZoom(),lowest+(highest>lowest?1:0))
   const own=Object.prototype.hasOwnProperty.call(this,'getTileInternal')
   this.getTileInternal=function(sourceZ,sourceX,sourceY,ratio,projection){
    const sourceCoord=this.getTileCoordForTileUrlFunction([sourceZ,sourceX,sourceY],projection)
    if(!sourceCoord)return originalInternal.call(this,sourceZ,sourceX,sourceY,ratio,projection)
    const sourceExtent=sourceGrid.getTileCoordExtent(sourceCoord),sourceSize=sourceGrid.getTileSize(sourceZ),sourceWidth=typeof sourceSize==='number'?sourceSize:sourceSize[0],sourceHeight=typeof sourceSize==='number'?sourceSize:sourceSize[1],maximumZoom=Math.min(highest,lowest+2),minimumQuarter=4*(reference-maximumZoom),sourceKey=`${sourceZ}/${sourceCoord[1]}/${sourceCoord[2]}/${sourceWidth}/${sourceHeight}/q${minimumQuarter}`,sourceId=`${target.getCode()}:source`
    let sourcePlan=manager.planWorker.peek(sourceId,sourceKey)
    if(!sourcePlan){
     const anchorAt=(tileExtent,tileWidth,tileHeight)=>tileAnchor(tileExtent,tileWidth,tileHeight,point=>field.atSource(point))
     sourcePlan=manager.planWorker.enqueue(sourceId,sourceKey,()=>({extent:sourceExtent,width:sourceWidth,height:sourceHeight,anchor:anchorAt(sourceExtent,sourceWidth,sourceHeight),minimumQuarter}),this,()=>splitTile(sourceExtent,sourceWidth,sourceHeight,anchorAt,minimumQuarter))
    }
    if(!sourcePlan.ready||!sourcePlan.spans)return originalInternal.call(this,sourceZ,sourceX,sourceY,ratio,projection)
    return assembler.getTile(sourceZ,sourceX,sourceY,ratio,projection,{spans:sourcePlan.spans,reference,minimumZoom:lowest,maximumZoom,original:originalInternal,cacheKey:this.getKey()})
   }
   try{return this.getTileAtSourceZoom(z,x,y,pixelRatio,target,requested)}finally{if(own)this.getTileInternal=originalInternal;else delete this.getTileInternal}
  }
  this.update()
 }
}
