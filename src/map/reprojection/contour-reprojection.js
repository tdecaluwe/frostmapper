import {equivalent} from 'ol/proj.js'
import {ContourAtlas} from './contour-atlas.js?v=fixed-bands'
import {DistortionField} from './distortion.js'
import {BandMaskPlanner} from './band-mask.js?v=fixed-bands'
import {SourceTileAssembler} from './source-assembler.js?v=source-loads'

const FILES={'EPSG:3035':'epsg-3035','EPSG:PEIRCE':'epsg-peirce','FROST:TRIPTYCHIAL':'frost-triptychial'}

// Owns shared projection-pair data and short-lived mask
// plans. The source adapter below owns OpenLayers integration for each layer.
export class ContourReprojection {
 constructor(map){
  this.map=map;this.atlases=new Map();this.sourceAtlases=new Map();this.fields=new Map();this.sources=new Set();this.plans=new Map();this.assemblers=new WeakMap();this.signature='none'
  this.planner=new BandMaskPlanner()
  map.on('change:view',()=>this.update())
  this.update()
 }
 field(target,source){const key=`${target.getCode()}|${source.getCode()}`;if(!this.fields.has(key))this.fields.set(key,new DistortionField(target,source));return this.fields.get(key)}
 update(){
  const view=this.map.getView(),projection=view.getProjection(),code=projection.getCode(),file=FILES[code]
  if(!file){this.setSignature('none');return}
  if(!this.atlases.has(code)){
   this.atlases.set(code,null)
   fetch(new URL(`../../../data/contours/${file}.json?v=fixed-bands`,import.meta.url)).then(r=>{if(!r.ok)throw Error(`Contour data ${r.status}`);return r.json()}).then(data=>{
    if(data.target!==code||data.source!=='EPSG:3857')throw Error('Contour projection mismatch')
    this.atlases.set(code,new ContourAtlas(data));this.update()
   }).catch(error=>{console.error('Contour data unavailable:',error);this.atlases.set(code,false)})
  }
  const atlas=this.atlases.get(code),source=[...this.sources].find(s=>s.getProjection()?.getCode()==='EPSG:3857')
  if(!atlas||!source){this.setSignature('none');return}
  if(!this.sourceAtlases.has(code)){
   this.sourceAtlases.set(code,null)
   fetch(new URL(`../../../data/contours/source-${FILES[code]}.json?v=stable-contours`,import.meta.url)).then(r=>{if(!r.ok)throw Error(`Source contour data ${r.status}`);return r.json()}).then(data=>{
    if(data.target!==code||data.source!=='EPSG:3857'||data.coordinateProjection!=='EPSG:3857')throw Error('Source contour projection mismatch')
    this.sourceAtlases.set(code,new ContourAtlas(data));for(const item of this.sources)item.changed();this.update()
   }).catch(error=>{console.error('Source contour data unavailable:',error);this.sourceAtlases.set(code,false)})
  }
  this.setSignature(code)
 }
 setSignature(signature){
  if(this.signature===signature)return
  this.signature=signature;this.plans.clear()
  for(const source of this.sources)source.changed()
 }
 addSource(source){
  if(this.sources.has(source))return
  this.sources.add(source);const original=source.getTile,originalKey=source.getKey,manager=this
  const originalInternal=source.getTileInternal
  const assembler=new SourceTileAssembler(source);this.assemblers.set(source,assembler)
  source.getKey=function(){return `${originalKey.call(this)}|bands:${manager.signature}|${manager.sourceAtlases.get(manager.signature)?'ready':'pending'}`}
  source.getTile=function(z,x,y,pixelRatio,target){
   const src=this.getProjection(),atlas=target&&manager.sourceAtlases.get(target.getCode())
   if(!atlas||!src||src.getCode()!=='EPSG:3857'||equivalent(src,target))return original.call(this,z,x,y,pixelRatio,target)
   const sourceGrid=this.getTileGridForProjection(src),targetGrid=this.getTileGridForProjection(target),field=manager.field(target,src),targetAtlas=manager.atlases.get(target.getCode())
   const coord=this.getTileCoordForTileUrlFunction([z,x,y],target)
   if(!coord||!targetAtlas)return original.call(this,z,x,y,pixelRatio,target)
   const extent=targetGrid.getTileCoordExtent(coord),size=targetGrid.getTileSize(z),width=typeof size==='number'?size:size[0],height=typeof size==='number'?size:size[1]
   const reference=Math.round(Math.log2(sourceGrid.getResolution(0)/targetGrid.getResolution(z)))
   const anchor=field.at([(extent[0]+extent[2])/2,(extent[1]+extent[3])/2])
   let spans=manager.planner.plan(targetAtlas,extent,width,height,anchor)
   const domain=targetAtlas.data.extent,normalized=[(extent[0]-domain[0])/(domain[2]-domain[0]),(extent[1]-domain[1])/(domain[3]-domain[1]),(extent[2]-domain[0])/(domain[2]-domain[0]),(extent[3]-domain[1])/(domain[3]-domain[1])]
   if(spans&&!targetAtlas.canSkipValidation(normalized)&&!manager.planner.validate(spans,extent,width,height,field))spans=null
   if(!spans)spans=manager.planner.sampledPlan(extent,width,height,field)
   if(!spans)return original.call(this,z,x,y,pixelRatio,target)
   const desired=spans.map(span=>Math.max(sourceGrid.getMinZoom(),Math.min(sourceGrid.getMaxZoom(),reference-span.band)))
   const lowest=Math.min(...desired),highest=Math.max(...desired)
   const requested=Math.min(sourceGrid.getMaxZoom(),lowest+(highest>lowest?1:0))
   const own=Object.prototype.hasOwnProperty.call(this,'getTileInternal')
   this.getTileInternal=function(sourceZ,sourceX,sourceY,ratio,projection){
    return assembler.getTile(sourceZ,sourceX,sourceY,ratio,projection,{atlas,field,planner:manager.planner,reference,minimumZoom:lowest,maximumZoom:Math.min(highest,lowest+2),original:originalInternal,cacheKey:this.getKey()})
   }
   try{return this.getTileAtSourceZoom(z,x,y,pixelRatio,target,requested)}finally{if(own)this.getTileInternal=originalInternal;else delete this.getTileInternal}
  }
  this.update()
 }
}
