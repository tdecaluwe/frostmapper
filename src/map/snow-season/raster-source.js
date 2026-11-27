import TileImageSource from 'ol/source/TileImage.js'
import Tile from 'ol/Tile.js'
import TileState from 'ol/TileState.js'
import TileGrid from 'ol/tilegrid/TileGrid.js'
import {SNOW_EXTENT} from './grid.js?v=snow-resume-v5'
import {depthIndex} from './depths.js?v=snow-resume-v5'
import {CHUNK_SIZE} from './chunk-codec.js?v=snow-resume-v5'
import {SNOW_RESOLUTIONS,displayTileExtent,CHUNK_METRES} from './chunk-grid.js?v=snow-resume-v5'
/** Canvas-backed native tiles; avoids encoding an image just to decode it again. */
class SnowCanvasTile extends Tile{
 constructor(coord,state,src,crossOrigin,loader,options){super(coord,state,options);this.src=src;this.loader=loader;this.image=null}
 getImage(){return this.image}
 load(){if(this.state!==TileState.IDLE&&this.state!==TileState.ERROR)return;this.setState(TileState.LOADING);this.loader(this,this.src)}
 setImage(canvas){this.image=canvas;this.setState(TileState.LOADED)}
}
/** 111x111 display tiles at 16/8/4/2/1 km per pixel, derived from cached chunks. */
export class SnowSeasonRasterSource extends TileImageSource{
 constructor(requestTile){
  super({projection:'EPSG:32633',tileGrid:new TileGrid({extent:SNOW_EXTENT,origin:[SNOW_EXTENT[0],SNOW_EXTENT[3]],tileSize:CHUNK_SIZE,resolutions:SNOW_RESOLUTIONS}),tileClass:SnowCanvasTile,wrapX:false,interpolate:false,transition:0,tileUrlFunction:coord=>coord.join('/'),attributions:'Snow season estimates: Frostmapper · <a href="https://www.senorge.no/">NVE seNorge</a> (NLOD)'})
  this.requestTile=requestTile;this.metric='length';this.minimumDepth=0;this.nativeTiles=new Map();this.epoch=0;this.revision=0
  this.dirtyTiles=new Set();this.refreshes=new Map();this.refreshTimer=null;this.publishTimer=null;this.active=true;this.preferredZ=SNOW_RESOLUTIONS.length-1
  this.setTileLoadFunction(tile=>this.requestImage(tile,false));this.setKey(this.imageKey())
 }
 imageKey(){return `snow/${this.metric}/${this.minimumDepth}/${this.epoch}/${this.revision}`}
 requestImage(tile,refresh){
  const [z,x,y]=tile.tileCoord,key=tile.tileCoord.join('/'),epoch=this.epoch
  this.requestTile({z,x,y,metric:this.metric,minimumDepth:this.minimumDepth,selection:epoch}).then(pixels=>{
   if(epoch!==this.epoch){if(!refresh)tile.setState(TileState.EMPTY);return}
   if(refresh&&this.nativeTiles.get(key)!==tile)return
   const canvas=tile.getImage()??document.createElement('canvas');canvas.width=CHUNK_SIZE;canvas.height=CHUNK_SIZE
   canvas.getContext('2d').putImageData(new ImageData(pixels,CHUNK_SIZE,CHUNK_SIZE),0,0);tile.setImage(canvas)
   // Reprojection canvases need a new source key, but only after their native
   // images are ready. Until then OL can keep drawing the previous revision.
   if(refresh&&!this.publishTimer)this.publishTimer=setTimeout(()=>{this.publishTimer=null;this.revision++;this.setKey(this.imageKey())},0)
  }).catch(()=>{if(!refresh)tile.setState(TileState.ERROR)}).finally(()=>{
   if(this.refreshes.get(key)===tile)this.refreshes.delete(key)
   this.scheduleRefresh()
  })
 }

 getTileInternal(z,x,y,pixelRatio,projection){
  const key=`${z}/${x}/${y}`
  if(this.nativeTiles.has(key)){const tile=this.nativeTiles.get(key);this.nativeTiles.delete(key);this.nativeTiles.set(key,tile);return tile}
  const tile=super.getTileInternal(z,x,y,pixelRatio,projection);this.nativeTiles.set(key,tile)
  if(this.nativeTiles.size>256)this.nativeTiles.delete(this.nativeTiles.keys().next().value)
  return tile
 }
 invalidate(){
  clearTimeout(this.refreshTimer);clearTimeout(this.publishTimer);this.refreshTimer=null;this.publishTimer=null
  this.epoch++;this.nativeTiles.clear();this.dirtyTiles.clear();this.refreshes.clear();this.setKey(this.imageKey())
 }
 chunksChanged(keys){
  for(const [key,tile] of this.nativeTiles){
   if(![TileState.LOADING,TileState.LOADED].includes(tile.getState()))continue
   const e=displayTileExtent(...tile.tileCoord)
   if(keys.some(key=>{const [cx,cy]=key.split('/').map(Number),left=SNOW_EXTENT[0]+cx*CHUNK_METRES,top=SNOW_EXTENT[3]-cy*CHUNK_METRES;return e[0]<left+CHUNK_METRES&&e[2]>left&&e[1]<top&&e[3]>top-CHUNK_METRES}))this.dirtyTiles.add(key)
  }
  this.scheduleRefresh()
 }
 scheduleRefresh(){
  if(!this.active||this.refreshTimer||![...this.dirtyTiles].some(key=>this.nativeTiles.get(key)?.getState()===TileState.LOADED&&!this.refreshes.has(key)&&this.inViewport(this.nativeTiles.get(key))))return
  this.refreshTimer=setTimeout(()=>{this.refreshTimer=null;this.refreshDirty()},250)
 }
 refreshDirty(){
  if(!this.active)return
  const keys=[...this.dirtyTiles].sort((a,b)=>Math.abs(Number(a.split('/')[0])-this.preferredZ)-Math.abs(Number(b.split('/')[0])-this.preferredZ))
  for(const key of keys){
   const tile=this.nativeTiles.get(key)
   if(!tile){this.dirtyTiles.delete(key);continue}
   if(tile.getState()!==TileState.LOADED||this.refreshes.has(key)||!this.inViewport(tile))continue
   this.dirtyTiles.delete(key);this.refreshes.set(key,tile);this.requestImage(tile,true)
  }
 }
 inViewport(tile){
  if(this.viewport===undefined)return true
  if(!this.viewport)return false
  const e=displayTileExtent(...tile.tileCoord),v=this.viewport
  return e[0]<v[2]&&e[2]>v[0]&&e[1]<v[3]&&e[3]>v[1]
 }
 setViewport(extent,resolution){this.viewport=extent;if(Number.isFinite(resolution)&&resolution>0)this.preferredZ=this.getTileGrid().getZForResolution(resolution);this.scheduleRefresh()}
 setActive(active){this.active=active;if(active)this.scheduleRefresh();else{clearTimeout(this.refreshTimer);this.refreshTimer=null}}
 setMetric(metric){if(this.metric!==metric){this.metric=metric;this.invalidate()}}
 setDepth(cm){depthIndex(cm);if(this.minimumDepth!==cm){this.minimumDepth=cm;this.invalidate()}}
 disposeInternal(){clearTimeout(this.refreshTimer);clearTimeout(this.publishTimer);this.nativeTiles.clear();this.dirtyTiles.clear();super.disposeInternal()}
}
