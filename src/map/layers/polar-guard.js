import {transform} from 'ol/proj.js'

// Near a pole a single target tile can span almost every longitude in the
// Web Mercator source. Reprojection stitches those source tiles into one
// temporary canvas, which can exhaust memory even when the cache is small.
// Tiles near the pole or extending beyond Web Mercator's northern latitude
// limit use coarser source tiles. Outside that narrow boundary, detail is unchanged.
const POLAR_SOURCE_MAX_ZOOM = 3
const guarded = new WeakSet()
const poleByProjection = new WeakMap()
const MERCATOR_MAX_LATITUDE = 85.0511287798066

export function guardPolarReprojection(source) {
 if(guarded.has(source))return
 guarded.add(source)
 const getTile=source.getTile
 source.getTile=function(z,x,y,pixelRatio,projection){
  if(projection?.getCode()!=='FROST:TRIPTYCHIAL')return getTile.call(this,z,x,y,pixelRatio,projection)
  const targetGrid=this.getTileGridForProjection(projection)
  const extent=targetGrid.getTileCoordExtent([z,x,y])
  let pole=poleByProjection.get(projection)
  if(!pole){pole=transform([0,90],'EPSG:4326',projection);poleByProjection.set(projection,pole)}
  const width=extent[2]-extent[0],height=extent[3]-extent[1]
  const nearPole=pole.every(Number.isFinite)&&pole[0]>=extent[0]-width&&pole[0]<=extent[2]+width&&pole[1]>=extent[1]-height&&pole[1]<=extent[3]+height
  const samples=[[extent[0],extent[1]],[extent[0],extent[3]],[extent[2],extent[1]],[extent[2],extent[3]],[(extent[0]+extent[2])/2,(extent[1]+extent[3])/2]]
  const touchesPolarCap=nearPole||samples.some(point=>transform(point,projection,'EPSG:4326')[1]>=MERCATOR_MAX_LATITUDE)
  if(!touchesPolarCap)return getTile.call(this,z,x,y,pixelRatio,projection)
  const grid=this.getTileGridForProjection(this.getProjection())
  const original=grid.getZForResolution
  const hadOwn=Object.prototype.hasOwnProperty.call(grid,'getZForResolution')
  // ReprojTile selects its source zoom synchronously during getTile().
  grid.getZForResolution=function(...args){return Math.max(this.getMinZoom(),Math.min(original.apply(this,args),POLAR_SOURCE_MAX_ZOOM))}
  try{return getTile.call(this,z,x,y,pixelRatio,projection)}
  finally{if(hadOwn)grid.getZForResolution=original;else delete grid.getZForResolution}
 }
}
