import Tile from 'ol/Tile.js'
import TileState from 'ol/TileState.js'

// A small per-source LRU. Eviction only drops our reference: a tile may still
// be in use by a ReprojTile or another assembled source tile.
class TilePool {
 constructor(limit){this.limit=limit;this.entries=new Map()}
 get(key,create){
  if(this.entries.has(key)){const value=this.entries.get(key);this.entries.delete(key);this.entries.set(key,value);return value}
  const value=create();this.entries.set(key,value)
  if(this.entries.size>this.limit)this.entries.delete(this.entries.keys().next().value)
  return value
 }
 clear(){this.entries.clear()}
}

export class AssembledSourceTile extends Tile {
 constructor(coord,parents,spans,extent,grid,width,height,options){
  super(coord,TileState.IDLE,options);this.parents=parents;this.spans=spans;this.extent=extent;this.grid=grid;this.width=width;this.height=height;this.canvas=null;this.listeners=[]
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
  this.unlisten()
  if(parents.some(({tile})=>tile.getState()===TileState.ERROR)){this.state=TileState.ERROR;this.changed();return}
  if(parents.every(({tile})=>tile.getState()===TileState.EMPTY)){this.state=TileState.EMPTY;this.changed();return}
  const canvas=document.createElement('canvas');canvas.width=this.width;canvas.height=this.height
  const ctx=canvas.getContext('2d'),[left,bottom,right,top]=this.extent
  for(const [zoom,{tile,coord}] of this.parents){
   if(tile.getState()!==TileState.LOADED)continue
   const image=tile.getImage(),parent=this.grid.getTileCoordExtent(coord),pw=parent[2]-parent[0],ph=parent[3]-parent[1]
   const sx=(left-parent[0])/pw*image.width,sy=(parent[3]-top)/ph*image.height,sw=(right-left)/pw*image.width,sh=(top-bottom)/ph*image.height
   ctx.save();ctx.beginPath();for(const span of this.spans)if(span.zoom===zoom)ctx.rect(span.x,span.y,span.width,span.height||1)
   ctx.clip();ctx.drawImage(image,sx,sy,sw,sh,0,0,this.width,this.height);ctx.restore()
  }
  this.canvas=canvas;this.state=TileState.LOADED;this.changed()
 }
 release(){this.unlisten();this.parents.clear();this.canvas=null;super.release()}
}

// Supplies ordinary source images or masked, upscaled ancestor images to an
// otherwise unchanged ReprojTile. Both caches are local to one tile source.
export class SourceTileAssembler {
 constructor(source,{maxParents=128,maxAssembled=64}={}){this.source=source;this.parents=new TilePool(maxParents);this.assembled=new TilePool(maxAssembled)}
 getTile(z,x,y,pixelRatio,projection,{atlas,field,planner,reference,original,cacheKey}){
  const source=this.source,grid=source.getTileGridForProjection(projection),coord=[z,x,y]
  if(source.getGutter()!==0)return original.call(source,z,x,y,pixelRatio,projection)
  const normalized=source.getTileCoordForTileUrlFunction(coord,projection)
  if(!normalized)return original.call(source,z,x,y,pixelRatio,projection)
  const extent=grid.getTileCoordExtent(normalized),tileSize=grid.getTileSize(z),size=typeof tileSize==='number'?[tileSize,tileSize]:tileSize
  const ratio=source.getTilePixelRatio(pixelRatio),width=Math.round(size[0]*ratio),height=Math.round(size[1]*ratio),domain=atlas.data.extent
  if(width<=0||height<=0||width*height>262144)return original.call(source,z,x,y,pixelRatio,projection)
  const key=`${cacheKey}|${reference}|${z}/${normalized[1]}/${normalized[2]}|${width}|${height}`
  return this.assembled.get(key,()=>{
   const fieldInSource={at:point=>field.atSource(point)},anchor=fieldInSource.at([(extent[0]+extent[2])/2,(extent[1]+extent[3])/2])
   let spans=planner.plan(atlas,extent,width,height,anchor)
   const norm=[(extent[0]-domain[0])/(domain[2]-domain[0]),(extent[1]-domain[1])/(domain[3]-domain[1]),(extent[2]-domain[0])/(domain[2]-domain[0]),(extent[3]-domain[1])/(domain[3]-domain[1])]
   if(spans&&!atlas.canSkipValidation(norm)&&!planner.validate(spans,extent,width,height,fieldInSource))spans=null
   if(!spans)spans=planner.sampledPlan(extent,width,height,fieldInSource)
   if(!spans)return this.parent(z,normalized[1],normalized[2],pixelRatio,projection,original,cacheKey)
   const min=grid.getMinZoom(),painted=spans.map(span=>({...span,zoom:Math.max(min,Math.min(z,reference-span.band))}))
   let levels=[...new Set(painted.map(span=>span.zoom))].sort((a,b)=>a-b)
   if(levels.length>3){
    const counts=new Map();for(const span of painted)counts.set(span.zoom,(counts.get(span.zoom)||0)+span.width*(span.height||1))
    let best=levels[0],weight=-1
    for(const low of levels){let sum=0;for(let candidate=low;candidate<low+3;candidate++)sum+=counts.get(candidate)||0;if(sum>weight){weight=sum;best=low}}
    for(const span of painted)span.zoom=Math.max(best,Math.min(best+2,span.zoom))
    levels=[...new Set(painted.map(span=>span.zoom))]
   }
   if(levels.length===1&&levels[0]===z)return this.parent(z,normalized[1],normalized[2],pixelRatio,projection,original,cacheKey)
   const parents=new Map()
   for(const zoom of levels){
    const parentCoord=grid.getTileCoordForCoordAndZ([(extent[0]+extent[2])/2,(extent[1]+extent[3])/2],zoom),parentExtent=grid.getTileCoordExtent(parentCoord)
    // Irregular/non-nested grids cannot safely use the parent as a crop.
    const epsilon=(extent[2]-extent[0])*1e-8
    if(parentExtent[0]>extent[0]+epsilon||parentExtent[1]>extent[1]+epsilon||parentExtent[2]<extent[2]-epsilon||parentExtent[3]<extent[3]-epsilon)return this.parent(z,normalized[1],normalized[2],pixelRatio,projection,original,cacheKey)
    parents.set(zoom,{coord:parentCoord,tile:this.parent(zoom,parentCoord[1],parentCoord[2],pixelRatio,projection,original,cacheKey)})
   }
   const tile=new AssembledSourceTile(coord,parents,painted,extent,grid,width,height,source.tileOptions);tile.key=source.getKey();return tile
  })
 }
 parent(z,x,y,pixelRatio,projection,original,cacheKey){
  const coord=this.source.getTileCoordForTileUrlFunction([z,x,y],projection)
  if(!coord)return original.call(this.source,z,x,y,pixelRatio,projection)
  const key=`${cacheKey}|${z}/${coord[1]}/${coord[2]}|${pixelRatio}`
  return this.parents.get(key,()=>original.call(this.source,z,coord[1],coord[2],pixelRatio,projection))
 }
 clear(){this.parents.clear();this.assembled.clear()}
}
