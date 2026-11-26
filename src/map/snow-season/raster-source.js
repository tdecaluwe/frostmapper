import TileImageSource from 'ol/source/TileImage.js'
import Tile from 'ol/Tile.js'
import TileState from 'ol/TileState.js'
import TileGrid from 'ol/tilegrid/TileGrid.js'
import {SNOW_EXTENT} from './grid.js'
import {SNOW_RESOLUTIONS,displayTileExtent,CHUNK_METRES} from './chunk-grid.js'
/** Canvas-backed native tiles; avoids encoding an image just to decode it again. */
class SnowCanvasTile extends Tile{
 constructor(coord,state,src,crossOrigin,loader,options){super(coord,state,options);this.src=src;this.loader=loader;this.image=null}
 getImage(){return this.image}
 load(){if(this.state!==TileState.IDLE&&this.state!==TileState.ERROR)return;this.setState(TileState.LOADING);this.loader(this,this.src)}
 setImage(canvas){this.image=canvas;this.setState(TileState.LOADED)}
}
/** 100x100 display tiles at 16/8/4/2/1 km per pixel, derived from cached chunks. */
export class SnowSeasonRasterSource extends TileImageSource{
 constructor(requestTile){
  super({projection:'EPSG:32633',tileGrid:new TileGrid({extent:SNOW_EXTENT,origin:[SNOW_EXTENT[0],SNOW_EXTENT[3]],tileSize:100,resolutions:SNOW_RESOLUTIONS}),tileClass:SnowCanvasTile,wrapX:false,interpolate:false,transition:0,tileUrlFunction:coord=>coord.join('/'),attributions:'Snow season estimates: Frostmapper · <a href="https://www.senorge.no/">NVE seNorge</a> (NLOD)'})
  this.requestTile=requestTile;this.metric='length';this.nativeTiles=new Map();this.epoch=0;this.refreshTimer=null
  this.setTileLoadFunction(tile=>{
   const [z,x,y]=tile.tileCoord,epoch=this.epoch
   this.requestTile({z,x,y,metric:this.metric}).then(pixels=>{
    if(epoch!==this.epoch){tile.setState(TileState.EMPTY);return}
    const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;canvas.getContext('2d').putImageData(new ImageData(pixels,100,100),0,0);tile.setImage(canvas)
   }).catch(()=>tile.setState(TileState.ERROR))
  });this.setKey('snow/length/0')
 }
 getTileInternal(z,x,y,pixelRatio,projection){
  const key=`${z}/${x}/${y}`
  if(this.nativeTiles.has(key)){const tile=this.nativeTiles.get(key);this.nativeTiles.delete(key);this.nativeTiles.set(key,tile);return tile}
  const tile=super.getTileInternal(z,x,y,pixelRatio,projection);this.nativeTiles.set(key,tile)
  if(this.nativeTiles.size>256)this.nativeTiles.delete(this.nativeTiles.keys().next().value)
  return tile
 }
 invalidate(){
  this.epoch++;this.nativeTiles.clear();this.setKey(`snow/${this.metric}/${this.epoch}`);this.changed()
 }
 chunksChanged(keys){
  const affected=keys.some(key=>{const [cx,cy]=key.split('/').map(Number),left=SNOW_EXTENT[0]+cx*CHUNK_METRES,top=SNOW_EXTENT[3]-cy*CHUNK_METRES;return [...this.nativeTiles.values()].some(tile=>{const e=displayTileExtent(...tile.tileCoord);return e[0]<left+CHUNK_METRES&&e[2]>left&&e[1]<top&&e[3]>top-CHUNK_METRES})})
  if(affected&&!this.refreshTimer)this.refreshTimer=setTimeout(()=>{this.refreshTimer=null;this.invalidate()},500)
 }
 setMetric(metric){if(this.metric!==metric){this.metric=metric;this.invalidate()}}
 disposeInternal(){clearTimeout(this.refreshTimer);this.nativeTiles.clear();super.disposeInternal()}
}
