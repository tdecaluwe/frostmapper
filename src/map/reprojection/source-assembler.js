import Tile from 'ol/Tile.js'
import TileState from 'ol/TileState.js'

// OpenLayers limits target-tile loads, but each assembled tile can start many
// source images. Share a separate queue across all map sources.
class SourceLoadQueue {
 constructor(limit=16){this.limit=limit;this.active=0;this.pending=[];this.queued=new WeakSet()}
 add(tile,start){
  if(this.queued.has(tile)||tile.getState()!==TileState.IDLE)return
  this.queued.add(tile);this.pending.push({tile,start});this.drain()
 }
 drain(){
  while(this.active<this.limit&&this.pending.length){
   const {tile,start}=this.pending.shift()
   if(tile.getState()!==TileState.IDLE){this.queued.delete(tile);continue}
   this.active++
   let finished=false
   const done=()=>{
    if(finished)return
    const state=tile.getState()
    if(state!==TileState.LOADED&&state!==TileState.ERROR&&state!==TileState.EMPTY)return
    finished=true
    tile.removeEventListener('change',done);this.queued.delete(tile);this.active--;this.drain()
   }
   tile.addEventListener('change',done)
   try{start()}catch(error){tile.removeEventListener('change',done);this.queued.delete(tile);this.active--;this.drain();throw error}
   done()
  }
 }
}
const sourceLoads=new SourceLoadQueue()
function queueLoad(tile){
 const start=tile.load.bind(tile)
 tile.load=function(){sourceLoads.add(tile,start)}
 return tile
}

// A small per-source LRU. Eviction only drops our reference: a tile may still
// be in use by a ReprojTile or another assembled source tile.
class TilePool {
 constructor(limit){this.limit=limit;this.entries=new Map()}
 get(key,create){
  if(this.entries.has(key)){const value=this.entries.get(key);this.entries.delete(key);if(value.getState()!==TileState.ERROR){this.entries.set(key,value);return value}}
  const value=create();this.entries.set(key,value)
  if(this.entries.size>this.limit)this.entries.delete(this.entries.keys().next().value)
  return value
 }
 clear(){this.entries.clear()}
}

export class AssembledZoomTile extends Tile {
 constructor(coord,parents,spans,extent,grid,width,height,options,fallback){
  super(coord,TileState.IDLE,options);this.parents=parents;this.spans=spans;this.extent=extent;this.grid=grid;this.width=width;this.height=height;this.canvas=null;this.listeners=[];this.fallback=fallback
 }
 getImage(){return this.canvas}
 load(){
  if(this.state!==TileState.IDLE)return
  this.state=TileState.LOADING;this.changed()
  for(const {tile} of this.parents.values()){
   const listener=()=>this.update();tile.addEventListener('change',listener);this.listeners.push([tile,listener])
  }
  for(const {tile} of this.parents.values())if(tile.getState()===TileState.IDLE)tile.load()
  this.update()
 }
 unlisten(){for(const [tile,listener] of this.listeners)tile.removeEventListener('change',listener);this.listeners=[]}
 update(){
  if(this.state!==TileState.LOADING)return
  const parents=[...this.parents.values()]
  if(parents.some(({tile})=>tile.getState()===TileState.IDLE||tile.getState()===TileState.LOADING))return
  if(this.fallback&&parents.some(({tile})=>tile.getState()===TileState.ERROR)){
   const make=this.fallback;this.fallback=null
   const parent=make()
   if(parent){
    this.parents.set('emergency',parent)
    const listener=()=>this.update();parent.tile.addEventListener('change',listener);this.listeners.push([parent.tile,listener])
    if(parent.tile.getState()===TileState.IDLE)parent.tile.load()
    if(parent.tile.getState()===TileState.IDLE||parent.tile.getState()===TileState.LOADING)return
   }
   return this.update()
  }
  this.unlisten()
  const loaded=parents.filter(({tile})=>tile.getState()===TileState.LOADED)
  if(!loaded.length){this.state=parents.some(({tile})=>tile.getState()===TileState.ERROR)?TileState.ERROR:TileState.EMPTY;this.changed();return}
  const canvas=document.createElement('canvas');canvas.width=this.width;canvas.height=this.height
  const ctx=canvas.getContext('2d'),[left,bottom,right,top]=this.extent
  const draw=(zoom,{tile,coord},masked)=>{
   if(tile.getState()!==TileState.LOADED)return
   const image=tile.getImage(),parent=this.grid.getTileCoordExtent(coord),pw=parent[2]-parent[0],ph=parent[3]-parent[1]
   const a=Math.max(left,parent[0]),b=Math.max(bottom,parent[1]),c=Math.min(right,parent[2]),d=Math.min(top,parent[3])
   if(a>=c||b>=d)return
   const sx=(a-parent[0])/pw*image.width,sy=(parent[3]-d)/ph*image.height,sw=(c-a)/pw*image.width,sh=(d-b)/ph*image.height
   const dx=(a-left)/(right-left)*this.width,dy=(top-d)/(top-bottom)*this.height,dw=(c-a)/(right-left)*this.width,dh=(d-b)/(top-bottom)*this.height
   ctx.save()
   if(masked){ctx.beginPath();for(const span of this.spans)if(span.zoom===zoom)ctx.rect(span.x,span.y,span.width,span.height||1);ctx.clip()}
   ctx.drawImage(image,sx,sy,sw,sh,dx,dy,dw,dh);ctx.restore()
  }
  const ordered=loaded.sort((a,b)=>a.zoom-b.zoom)
  // Start with a complete coarse image so invalid contour samples or open
  // paths at a projection cut cannot leave transparent holes in the tile.
  if(ordered.length){const lowest=ordered[0].zoom;for(const parent of ordered)if(parent.zoom===lowest)draw(parent.zoom,parent,false)}
  for(const parent of ordered)if(parent.zoom!==ordered[0].zoom)draw(parent.zoom,parent,true)
  this.canvas=canvas;this.state=TileState.LOADED;this.changed()
 }
 release(){this.unlisten();this.parents.clear();this.canvas=null;super.release()}
}

// Compatibility for consumers of the earlier source assembler prototype.
export {AssembledZoomTile as AssembledSourceTile}

// Supplies ordinary source images or masked, upscaled ancestor images to an
// otherwise unchanged ReprojTile. Both caches are local to one tile source.
export class SourceTileAssembler {
 constructor(source,{maxParents=128,maxAssembled=64}={}){this.source=source;this.parents=new TilePool(maxParents);this.assembled=new TilePool(maxAssembled)}
 getTile(z,x,y,pixelRatio,projection,{atlas,field,planner,reference,minimumZoom=z,maximumZoom=minimumZoom+2,original,cacheKey}){
  const source=this.source,grid=source.getTileGridForProjection(projection),coord=[z,x,y]
  if(source.getGutter()!==0)return original.call(source,z,x,y,pixelRatio,projection)
  const normalized=source.getTileCoordForTileUrlFunction(coord,projection)
  if(!normalized)return original.call(source,z,x,y,pixelRatio,projection)
  const extent=grid.getTileCoordExtent(normalized),tileSize=grid.getTileSize(z),size=typeof tileSize==='number'?[tileSize,tileSize]:tileSize
  const ratio=source.getTilePixelRatio(pixelRatio),width=Math.round(size[0]*ratio),height=Math.round(size[1]*ratio),domain=atlas.data.extent
  if(width<=0||height<=0||width*height>262144)return original.call(source,z,x,y,pixelRatio,projection)
  const key=`${cacheKey}|${reference}|${minimumZoom}|${maximumZoom}|${z}/${normalized[1]}/${normalized[2]}|${width}|${height}`
  return this.assembled.get(key,()=>{
   const fieldInSource={at:point=>field.atSource(point)},anchor=fieldInSource.at([(extent[0]+extent[2])/2,(extent[1]+extent[3])/2])
   let spans=planner.plan(atlas,extent,width,height,anchor)
   const norm=[(extent[0]-domain[0])/(domain[2]-domain[0]),(extent[1]-domain[1])/(domain[3]-domain[1]),(extent[2]-domain[0])/(domain[2]-domain[0]),(extent[3]-domain[1])/(domain[3]-domain[1])]
   if(spans&&!atlas.canSkipValidation(norm)&&!planner.validate(spans,extent,width,height,fieldInSource))spans=null
   if(!spans)spans=planner.sampledPlan(extent,width,height,fieldInSource)
   if(!spans)return this.parent(z,normalized[1],normalized[2],pixelRatio,projection,original,cacheKey)
   const min=grid.getMinZoom(),painted=spans.map(span=>({...span,zoom:Math.max(min,minimumZoom,Math.min(grid.getMaxZoom(),maximumZoom,reference-span.band))}))
   let levels=[...new Set(painted.map(span=>span.zoom))].sort((a,b)=>a-b)
   if(levels.length>3){
    const counts=new Map();for(const span of painted)counts.set(span.zoom,(counts.get(span.zoom)||0)+span.width*(span.height||1))
    let best=levels[0],weight=-1
    for(const low of levels){let sum=0;for(let candidate=low;candidate<low+3;candidate++)sum+=counts.get(candidate)||0;if(sum>weight){weight=sum;best=low}}
    for(const span of painted)span.zoom=Math.max(best,Math.min(best+2,span.zoom))
    levels=[...new Set(painted.map(span=>span.zoom))]
   }
   const parents=new Map(),fallbackZoom=Math.min(z,minimumZoom)
   for(const zoom of [...new Set([fallbackZoom,...levels])]){
    const range=grid.getTileRangeForExtentAndZ(extent,zoom)
    if((range.maxX-range.minX+1)*(range.maxY-range.minY+1)>16)return this.parent(z,normalized[1],normalized[2],pixelRatio,projection,original,cacheKey)
    for(let px=range.minX;px<=range.maxX;px++)for(let py=range.minY;py<=range.maxY;py++){
     const parentCoord=[zoom,px,py]
     parents.set(`${zoom}/${px}/${py}`,{zoom,coord:parentCoord,tile:this.parent(zoom,px,py,pixelRatio,projection,original,cacheKey)})
    }
   }
   const fallback=fallbackZoom>min?()=>{
    const zoom=fallbackZoom-1,parentCoord=grid.getTileCoordForCoordAndZ([(extent[0]+extent[2])/2,(extent[1]+extent[3])/2],zoom)
    return {zoom,coord:parentCoord,tile:this.parent(zoom,parentCoord[1],parentCoord[2],pixelRatio,projection,original,cacheKey)}
   }:null
   const tile=new AssembledZoomTile(coord,parents,painted,extent,grid,width,height,source.tileOptions,fallback);tile.key=source.getKey();return tile
  })
 }
 parent(z,x,y,pixelRatio,projection,original,cacheKey){
  const coord=this.source.getTileCoordForTileUrlFunction([z,x,y],projection)
  if(!coord)return original.call(this.source,z,x,y,pixelRatio,projection)
  const key=`${cacheKey}|${z}/${coord[1]}/${coord[2]}|${pixelRatio}`
  return this.parents.get(key,()=>queueLoad(original.call(this.source,z,coord[1],coord[2],pixelRatio,projection)))
 }
 clear(){this.parents.clear();this.assembled.clear()}
}
