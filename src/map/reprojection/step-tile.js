import ImageTile from 'ol/ImageTile.js'

// An OL image-tile identity with no canvas of its own. Payload lifetime follows
// the last shell, including shells retained by OL as stale/parent fallbacks.
export class StepTile extends ImageTile {
 constructor(coord,key,payload,onRelease){
  super(coord,payload.tile.getState(),'',null,()=>{},{transition:0})
  this.image_=null
  this.key=key;this.payload=payload;this.onRelease=onRelease;payload.references++
  this.forward=()=>{this.state=payload.tile.getState();this.changed()}
  payload.tile.addEventListener('change',this.forward)
 }
 getImage(){return this.payload?.tile.getImage()??null}
 load(){this.payload?.tile.load()}
 release(){
  if(!this.payload)return
  const payload=this.payload;payload.tile.removeEventListener('change',this.forward)
  this.payload=null
  if(--payload.references===0){this.onRelease(payload);payload.tile.release()}
  super.release()
 }
}

function sameArray(a,b){return a===b||!!a&&!!b&&a.length===b.length&&a.every((value,i)=>value===b[i])}
const identities=new WeakMap()
let nextIdentity=0
function identity(tile){if(!identities.has(tile))identities.set(tile,++nextIdentity);return identities.get(tile)}
function describe(tile){
 if(!tile?.parents)return {id:identity(tile)}
 return {initialZoom:tile.initialZoom,spans:tile.spans,parents:[...tile.parents].map(([key,parent])=>`${key}:${identity(parent.tile)}`).sort()}
}
function sameSource(a,b){
 if(a.id||b.id)return a.id===b.id
 return a.initialZoom===b.initialZoom&&sameArray(a.spans,b.spans)&&sameArray(a.parents,b.parents)
}
function dependencies(tile){return (tile.sourceTiles_||[]).map(({tile,offset})=>({tile:describe(tile),offset}))}
function identical(a,b){
 return a.sourceZ===b.sourceZ&&a.stitchResolution===b.stitchResolution&&a.sources.length===b.sources.length&&a.sources.every((source,i)=>source.offset===b.sources[i].offset&&sameSource(source.tile,b.sources[i].tile))
}

export class StepTilePool {
 constructor(){this.entries=new Map()}
 wrap(tile,coord,key,spatialKey){
  if(!tile?.sourceTiles_?.length)return tile
  const signature={sourceZ:tile.sourceZ_,stitchResolution:tile.sourceTileGrid_.getResolution(tile.sourceZ_),sources:dependencies(tile)}
  let entries=this.entries.get(spatialKey)
  if(!entries){entries=new Set();this.entries.set(spatialKey,entries)}
  let payload=[...entries].find(entry=>identical(entry.signature,signature))
  if(payload)tile.release()
  else {payload={tile,signature,references:0};entries.add(payload)}
  return new StepTile(coord,key,payload,entry=>{entries.delete(entry);if(!entries.size)this.entries.delete(spatialKey)})
 }
}
