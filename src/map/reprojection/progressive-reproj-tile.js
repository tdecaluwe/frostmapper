import TileState from 'ol/TileState.js'
import {releaseCanvas} from 'ol/dom.js'
import {AssembledZoomTile} from './source-assembler.js?v=progressive-reproj-v1'

// ReprojTile normally discards its source tile list after one render. Keep it
// only for assembled zoom tiles so their in-place refinements can reproject
// the same target tile without invalidating the whole source cache.
export function enableProgressiveReprojection(tile){
 const sourceTiles=tile?.sourceTiles_
 if(!sourceTiles?.some(({tile})=>tile instanceof AssembledZoomTile))return tile
 const assembled=sourceTiles.map(source=>source.tile).filter(source=>source instanceof AssembledZoomTile)
 const originalReproject=tile.reproject_.bind(tile),originalRelease=tile.release.bind(tile),listeners=new Map()
 const stopListening=source=>{const listener=listeners.get(source);if(listener){source.removeEventListener('change',listener);listeners.delete(source)}}
 const stopAll=()=>{for(const source of [...listeners.keys()])stopListening(source)}
 const syncListeners=()=>{
  for(const source of [...listeners.keys()])if(source.refined||source.getState()===TileState.ERROR||source.getState()===TileState.EMPTY)stopListening(source)
  for(const source of assembled){
   if(source.refined||source.getState()===TileState.ERROR||source.getState()===TileState.EMPTY||listeners.has(source))continue
   const listener=()=>{if(tile.getState()===TileState.LOADED)tile.reproject_()}
   listeners.set(source,listener);source.addEventListener('change',listener)
  }
 }
 tile.reproject_=function(){
  const complete=assembled.every(source=>source.refined||source.getState()===TileState.ERROR||source.getState()===TileState.EMPTY)
  if(complete){
   stopAll()
   const previous=tile.canvas_
   tile.sourceTiles_=sourceTiles
   originalReproject()
   if(previous&&previous!==tile.canvas_)releaseCanvas(previous.getContext('2d'))
   return
  }
  const loaded=sourceTiles.filter(({tile:source})=>source.getState()===TileState.LOADED)
  if(!loaded.length){tile.sourceTiles_=sourceTiles;originalReproject();return}
  const previous=tile.canvas_
  tile.sourceTiles_=loaded
  originalReproject()
  tile.sourceTiles_=sourceTiles
  if(previous&&previous!==tile.canvas_)releaseCanvas(previous.getContext('2d'))
  syncListeners()
 }
 tile.release=function(){stopAll();originalRelease()}
 return tile
}
