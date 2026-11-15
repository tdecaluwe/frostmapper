import Tile from 'ol/Tile.js'
import TileState from 'ol/TileState.js'

// A target tile composed from independently guarded OpenLayers reprojections.
export class CompositeTile extends Tile {
 constructor(coord,children,spans,width,height,options){
  super(coord,TileState.IDLE,options);this.children=children;this.spans=spans;this.width=width;this.height=height;this.canvas=null;this.listeners=[]
 }
 getImage(){return this.canvas}
 load(){
  if(this.state!==TileState.IDLE)return
  this.state=TileState.LOADING;this.changed()
  for(const child of this.children.values()){
   const listener=()=>this.update();child.addEventListener('change',listener);this.listeners.push([child,listener])
  }
  for(const child of this.children.values())if(child.getState()===TileState.IDLE)child.load()
  this.update()
 }
 unlisten(){for(const [child,listener] of this.listeners)child.removeEventListener('change',listener);this.listeners=[]}
 update(){
  if(this.state!==TileState.LOADING)return
  const children=[...this.children.values()]
  if(children.some(child=>child.getState()===TileState.IDLE||child.getState()===TileState.LOADING))return
  this.unlisten()
  if(children.some(child=>child.getState()===TileState.ERROR)){this.state=TileState.ERROR;this.changed();return}
  if(children.every(child=>child.getState()===TileState.EMPTY)){this.state=TileState.EMPTY;this.changed();return}
  const canvas=document.createElement('canvas');canvas.width=this.width;canvas.height=this.height
  const ctx=canvas.getContext('2d')
  for(const [zoom,child] of this.children){
   if(child.getState()!==TileState.LOADED)continue
   ctx.save();ctx.beginPath()
   for(const span of this.spans)if(span.zoom===zoom)ctx.rect(span.x,span.y,span.width,1)
   ctx.clip();ctx.drawImage(child.getImage(),0,0,this.width,this.height);ctx.restore()
  }
  this.canvas=canvas;this.state=TileState.LOADED
  // The combined canvas now owns the result; release intermediate canvases.
  for(const child of children)child.release()
  this.children.clear();this.changed()
 }
 release(){this.unlisten();for(const child of this.children.values())child.release();this.children.clear();this.canvas=null;super.release()}
}
