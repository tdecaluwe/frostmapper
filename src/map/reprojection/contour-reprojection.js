import {equivalent} from 'ol/proj.js'
import {ContourAtlas} from './contour-atlas.js?v=fixed-bands'
import {DistortionField} from './distortion.js'
import {BandMaskPlanner} from './band-mask.js?v=fixed-bands'
import {CompositeTile} from './composite-tile.js?v=fixed-bands'
import {MAX_SOURCE_AREA_RATIO,MAX_NATIVE_SOURCE_AREA_RATIO} from '../layers/reprojection-budget.js?v=contour-bands'

const FILES={'EPSG:3035':'epsg-3035','EPSG:PEIRCE':'epsg-peirce','FROST:TRIPTYCHIAL':'frost-triptychial'}
const MAX_COMPOSITE_LEVELS=3

// Owns shared projection-pair data and short-lived mask
// plans. The source adapter below owns OpenLayers integration for each layer.
export class ContourReprojection {
 constructor(map){
  this.map=map;this.atlases=new Map();this.fields=new Map();this.sources=new Set();this.plans=new Map();this.signature='none'
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
  source.getKey=function(){return `${originalKey.call(this)}|bands:${manager.signature}`}
  source.getTile=function(z,x,y,pixelRatio,target){
   const fallback=()=>original.call(this,z,x,y,pixelRatio,target),src=this.getProjection()
   if(!target||!src||src.getCode()!=='EPSG:3857'||equivalent(src,target)||manager.signature!==target.getCode()||!this.getTileAtSourceZoom)return fallback()
   const atlas=manager.atlases.get(target.getCode())
   const grid=this.getTileGridForProjection(target),sourceGrid=this.getTileGridForProjection(src),coord=this.getTileCoordForTileUrlFunction([z,x,y],target)
   if(!atlas||!coord)return fallback()
   const extent=grid.getTileCoordExtent(coord),tileSize=grid.getTileSize(z),size=typeof tileSize==='number'?[tileSize,tileSize]:tileSize,ratio=this.getTilePixelRatio(pixelRatio)
   const width=Math.round(size[0]*ratio),height=Math.round(size[1]*ratio),targetResolution=grid.getResolution(z)
   if(width<=0||height<=0||width*height>1048576||!Number.isFinite(targetResolution))return fallback()
   const field=manager.field(target,src),key=`${target.getCode()}|${coord.join('/')}|${width}|${height}`
   let spans=manager.plans.get(key)
   if(spans===undefined){
    const anchor=field.at([(extent[0]+extent[2])/2,(extent[1]+extent[3])/2])
    spans=manager.planner.plan(atlas,extent,width,height,anchor)
    const domain=atlas.data.extent,normalized=[(extent[0]-domain[0])/(domain[2]-domain[0]),(extent[1]-domain[1])/(domain[3]-domain[1]),(extent[2]-domain[0])/(domain[2]-domain[0]),(extent[3]-domain[1])/(domain[3]-domain[1])]
    if(spans&&!atlas.canSkipValidation(normalized)&&!manager.planner.validate(spans,extent,width,height,field))spans=null
    if(!spans)spans=manager.planner.sampledPlan(extent,width,height,field)
    if(manager.plans.size>=512)manager.plans.delete(manager.plans.keys().next().value)
    manager.plans.set(key,spans)
   }
   if(!spans)return fallback()
   const reference=Math.log2(sourceGrid.getResolution(0)/targetResolution)
   if(!Number.isFinite(reference))return fallback()
   const min=sourceGrid.getMinZoom(),max=sourceGrid.getMaxZoom(),base=Math.round(reference)
   const painted=spans.map(s=>({...s,zoom:Math.max(min,Math.min(max,base-s.band))}))
   let levels=[...new Set(painted.map(s=>s.zoom))].sort((a,b)=>a-b)
   if(levels.length>MAX_COMPOSITE_LEVELS){
    // Near a singularity, several contours can fit into one target tile.
    // Keep the three adjacent source levels covering the most pixels and
    // clamp the remainder to the nearest level instead of discarding the mask.
    const counts=new Map();for(const span of painted)counts.set(span.zoom,(counts.get(span.zoom)||0)+span.width*(span.height||1))
    let best=levels[0],weight=-1
    for(const low of levels){let sum=0;for(let z=low;z<low+MAX_COMPOSITE_LEVELS;z++)sum+=counts.get(z)||0;if(sum>weight){weight=sum;best=low}}
    for(const span of painted)span.zoom=Math.max(best,Math.min(best+MAX_COMPOSITE_LEVELS-1,span.zoom))
    levels=[...new Set(painted.map(s=>s.zoom))].sort((a,b)=>a-b)
   }
   if(levels.length===1)return this.getTileAtSourceZoom(z,x,y,pixelRatio,target,levels[0])
   const children=new Map(),budget=MAX_SOURCE_AREA_RATIO-levels.length-1
   for(const level of levels)children.set(level,this.getTileAtSourceZoom(z,x,y,pixelRatio,target,level,budget,MAX_NATIVE_SOURCE_AREA_RATIO/levels.length))
   const tile=new CompositeTile([z,x,y],children,painted,width,height,this.tileOptions);tile.key=this.getKey();return tile
  }
  this.update()
 }
}
