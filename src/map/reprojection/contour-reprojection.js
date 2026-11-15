import {equivalent} from 'ol/proj.js'
import {ContourAtlas} from './contour-atlas.js'
import {DistortionField} from './distortion.js'
import {BandSelector} from './band-selector.js'
import {BandMaskPlanner} from './band-mask.js'
import {CompositeTile} from './composite-tile.js'
import {MAX_SOURCE_AREA_RATIO,MAX_NATIVE_SOURCE_AREA_RATIO} from '../layers/reprojection-budget.js?v=contour-bands'

const FILES={'EPSG:3035':'epsg-3035','EPSG:PEIRCE':'epsg-peirce','FROST:TRIPTYCHIAL':'frost-triptychial'}
const MAX_COMPOSITE_LEVELS=3

// Owns the shared projection-pair data, viewport phase, and short-lived mask
// plans. The source adapter below owns OpenLayers integration for each layer.
export class ContourReprojection {
 constructor(map){
  this.map=map;this.atlases=new Map();this.fields=new Map();this.selectors=new Map();this.sources=new Set();this.plans=new Map();this.signature='none'
  this.planner=new BandMaskPlanner()
  map.on('change:view',()=>this.update());map.on('moveend',()=>this.update());map.on('change:size',()=>this.update())
  this.update()
 }
 field(target,source){const key=`${target.getCode()}|${source.getCode()}`;if(!this.fields.has(key))this.fields.set(key,new DistortionField(target,source));return this.fields.get(key)}
 update(){
  const view=this.map.getView(),projection=view.getProjection(),code=projection.getCode(),file=FILES[code]
  if(!file){this.setSignature('none');return}
  if(!this.atlases.has(code)){
   this.atlases.set(code,null)
   fetch(new URL(`../../../data/contours/${file}.json`,import.meta.url)).then(r=>{if(!r.ok)throw Error(`Contour data ${r.status}`);return r.json()}).then(data=>{
    if(data.target!==code||data.source!=='EPSG:3857')throw Error('Contour projection mismatch')
    this.atlases.set(code,new ContourAtlas(data));this.update()
   }).catch(error=>{console.error('Contour data unavailable:',error);this.atlases.set(code,false)})
  }
  const atlas=this.atlases.get(code),source=[...this.sources].find(s=>s.getProjection()?.getCode()==='EPSG:3857')
  if(!atlas||!source){this.setSignature('none');return}
  const size=this.map.getSize(),resolution=view.getResolution()
  if(!size||!Number.isFinite(resolution)||resolution<=0)return
  const field=this.field(projection,source.getProjection()),samples=[]
  for(let y=0;y<7;y++)for(let x=0;x<7;x++){
   const coordinate=this.map.getCoordinateFromPixel([(x+.5)*size[0]/7,(y+.5)*size[1]/7])
   if(!coordinate)continue
   const value=field.at(coordinate);if(value!==null)samples.push({value})
  }
  if(!this.selectors.has(code))this.selectors.set(code,new BandSelector())
  const grid=source.getTileGridForProjection(source.getProjection()),targetGrid=source.getTileGridForProjection(projection)
  // Source zooms are chosen for the target tile grid, which can differ from
  // the continuously changing view resolution between target zoom levels.
  const targetResolution=targetGrid.getResolution(targetGrid.getZForResolution(resolution))
  const reference=Math.log2(grid.getResolution(0)/targetResolution)
  const phase=this.selectors.get(code).choose(samples,reference)
  this.setSignature(`${code}|${phase}`)
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
   if(!target||!src||src.getCode()!=='EPSG:3857'||equivalent(src,target)||!manager.signature.startsWith(`${target.getCode()}|`)||!this.getTileAtSourceZoom)return fallback()
   const atlas=manager.atlases.get(target.getCode()),phase=Number(manager.signature.split('|')[1])
   const grid=this.getTileGridForProjection(target),sourceGrid=this.getTileGridForProjection(src),coord=this.getTileCoordForTileUrlFunction([z,x,y],target)
   if(!atlas||!coord)return fallback()
   const extent=grid.getTileCoordExtent(coord),tileSize=grid.getTileSize(z),size=typeof tileSize==='number'?[tileSize,tileSize]:tileSize,ratio=this.getTilePixelRatio(pixelRatio)
   const width=Math.round(size[0]*ratio),height=Math.round(size[1]*ratio),targetResolution=grid.getResolution(z)
   if(width<=0||height<=0||width*height>1048576||!Number.isFinite(targetResolution))return fallback()
   const field=manager.field(target,src),key=`${target.getCode()}|${phase}|${coord.join('/')}|${width}|${height}`
   let spans=manager.plans.get(key)
   if(spans===undefined){
    const anchor=field.at([(extent[0]+extent[2])/2,(extent[1]+extent[3])/2])
    spans=manager.planner.plan(atlas,extent,phase,width,height,anchor)
    if(spans&&!manager.planner.validate(spans,extent,phase,width,height,field))spans=null
    if(manager.plans.size>=512)manager.plans.delete(manager.plans.keys().next().value)
    manager.plans.set(key,spans)
   }
   if(!spans)return fallback()
   const reference=Math.log2(sourceGrid.getResolution(0)/targetResolution)
   if(!Number.isFinite(reference))return fallback()
   const min=sourceGrid.getMinZoom(),max=sourceGrid.getMaxZoom(),base=Math.round(reference)
   const painted=spans.map(s=>({...s,zoom:Math.max(min,Math.min(max,base-s.band))})),levels=[...new Set(painted.map(s=>s.zoom))]
   if(levels.length>MAX_COMPOSITE_LEVELS)return fallback()
   if(levels.length===1)return this.getTileAtSourceZoom(z,x,y,pixelRatio,target,levels[0])
   const children=new Map(),budget=MAX_SOURCE_AREA_RATIO-levels.length-1
   for(const level of levels)children.set(level,this.getTileAtSourceZoom(z,x,y,pixelRatio,target,level,budget,MAX_NATIVE_SOURCE_AREA_RATIO/levels.length))
   const tile=new CompositeTile([z,x,y],children,painted,width,height,this.tileOptions);tile.key=this.getKey();return tile
  }
  this.update()
 }
}
