import GeoJSON from 'ol/format/GeoJSON.js'
import RBush from 'ol/structs/RBush.js'
import {containsExtent} from 'ol/extent.js'

// A block packs the two-bit states of 16×16 source tiles into 64 bytes.
const BLOCK_SIZE = 16
const OUTSIDE = 1, INSIDE = 2, BORDER = 3

// Liang–Barsky segment/rectangle intersection, including touching edges.
function segmentIntersects(segment, extent) {
 const [a,b]=segment, dx=b[0]-a[0], dy=b[1]-a[1]
 let low=0, high=1
 for(const [p,q] of [[-dx,a[0]-extent[0]],[dx,extent[2]-a[0]],[-dy,a[1]-extent[1]],[dy,extent[3]-a[1]]]) {
  if(p===0){if(q<0)return false;continue}
  const t=q/p
  if(p<0){if(t>high)return false;low=Math.max(low,t)}
  else {if(t<low)return false;high=Math.min(high,t)}
 }
 return true
}

export function createCoverageIndex(data, projection, grid) {
 const features=new GeoJSON().readFeatures(data,{dataProjection:'EPSG:4326',featureProjection:projection})
 const polygons=features.flatMap(feature=>{const g=feature.getGeometry();return g.getType()==='MultiPolygon'?g.getPolygons():[g]})
 const segments=[], extents=[]
 for(const polygon of polygons) for(const ring of polygon.getCoordinates()) for(let i=1;i<ring.length;i++) {
  const a=ring[i-1],b=ring[i]
  segments.push([a,b]);extents.push([Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])])
 }
 const edges=new RBush();edges.load(extents,segments)
 const blocks=new Map()
 function stateAt(z,x,y) {
  const bx=Math.floor(x/BLOCK_SIZE),by=Math.floor(y/BLOCK_SIZE),key=`${z}/${bx}/${by}`
  let block=blocks.get(key)
  const index=(y-by*BLOCK_SIZE)*BLOCK_SIZE+(x-bx*BLOCK_SIZE), byte=index>>2, shift=(index&3)*2
  let state=block?(block[byte]>>shift)&3:0
  if(state)return state
  const extent=grid.getTileCoordExtent([z,x,y])
  if(edges.getInExtent(extent).some(segment=>segmentIntersects(segment,extent))) state=BORDER
  else {
   const point=[(extent[0]+extent[2])/2,(extent[1]+extent[3])/2]
   let inside=false
   // Even-odd parity matches the canvas clip, including enclaves and holes.
   for(const polygon of polygons)if(polygon.intersectsCoordinate(point))inside=!inside
   state=inside?INSIDE:OUTSIDE
  }
  if(!block){block=new Uint8Array(64);blocks.set(key,block)}
  block[byte]|=state<<shift
  return state
 }
 return function intersectsCountry(tileCoord) {
  const [z,x,y]=tileCoord, minZoom=grid.getMinZoom()
  // Only reuse an ancestor when its actual source-grid extent contains the tile.
  // This keeps the lookup correct for grids with irregular matrix origins or scales.
  const tileExtent=grid.getTileCoordExtent(tileCoord)
  for(let level=minZoom;level<=z;level++) {
   const factor=2**(z-level), px=Math.floor(x/factor),py=Math.floor(y/factor)
   if(level!==z&&!containsExtent(grid.getTileCoordExtent([level,px,py]),tileExtent))continue
   const state=stateAt(level,px,py)
   if(state===OUTSIDE)return false
   if(state===INSIDE)return true
  }
  return true
 }
}
