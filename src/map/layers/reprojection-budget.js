import ImageTile from 'ol/ImageTile.js'
import TileState from 'ol/TileState.js'
import Triangulation from 'ol/reproj/Triangulation.js'
import {ERROR_THRESHOLD} from 'ol/reproj/common.js'
import {equivalent} from 'ol/proj.js'
import {createEmpty,extend,getArea,getIntersection,getWidth,wrapAndSliceX} from 'ol/extent.js'

// The stitched source canvas may use at most 8× the output tile area.
// For a 256×256 tile at pixel ratio 1, this is 524,288 pixels (~2 MiB RGBA).
export const MAX_SOURCE_AREA_RATIO = 8
const guardedSources = new WeakSet()
const BUDGET_EXCEEDED = Symbol('reprojection budget exceeded')

// Mirror ReprojTile's extent handling. We estimate with every candidate tile,
// including tiles that will later turn out to be empty, to stay conservative.
function sourceFootprint(source,sourceProjection,targetProjection,sourceGrid,targetGrid,tileCoord,sourceResolution) {
 const targetExtent=targetGrid.getTileCoordExtent(tileCoord)
 const maxTargetExtent=targetGrid.getExtent()
 const limitedTarget=maxTargetExtent?getIntersection(targetExtent,maxTargetExtent):targetExtent
 const projectionExtent=sourceProjection.getExtent()
 let maxSourceExtent=sourceGrid.getExtent()
 if(projectionExtent)maxSourceExtent=maxSourceExtent?getIntersection(maxSourceExtent,projectionExtent):projectionExtent
 const targetResolution=targetGrid.getResolution(tileCoord[0])
 const threshold=source.reprojectionErrorThreshold_ ?? ERROR_THRESHOLD
 const triangulation=new Triangulation(sourceProjection,targetProjection,limitedTarget,maxSourceExtent,sourceResolution*threshold,targetResolution)
 if(!triangulation.getTriangles().length)return null
 let extent=triangulation.calculateSourceExtent()
 if(maxSourceExtent){
  if(sourceProjection.canWrapX()){
   extent[1]=Math.max(maxSourceExtent[1],Math.min(maxSourceExtent[3],extent[1]))
   extent[3]=Math.max(maxSourceExtent[1],Math.min(maxSourceExtent[3],extent[3]))
  }else extent=getIntersection(extent,maxSourceExtent)
 }
 if(!extent.every(Number.isFinite))throw BUDGET_EXCEEDED
 return getArea(extent)>0?extent:null
}

export function estimateStitchSize(sourceExtent,sourceProjection,sourceGrid,z,pixelRatio) {
 const projectionExtent=sourceProjection.getExtent()
 const worldWidth=sourceProjection.canWrapX()?getWidth(projectionExtent):0
 let worldsAway=worldWidth?Math.floor((sourceExtent[0]-projectionExtent[0])/worldWidth):0
 const stitched=createEmpty()
 for(const extent of wrapAndSliceX(sourceExtent.slice(),sourceProjection,true)){
  const range=sourceGrid.getTileRangeForExtentAndZ(extent,z)
  if(range.maxX<range.minX||range.maxY<range.minY)continue
  const first=sourceGrid.getTileCoordExtent([z,range.minX,range.minY])
  const last=sourceGrid.getTileCoordExtent([z,range.maxX,range.maxY])
  const offset=worldsAway*worldWidth
  first[0]+=offset;first[2]+=offset;last[0]+=offset;last[2]+=offset
  extend(stitched,first);extend(stitched,last)
  worldsAway++
 }
 if(!stitched.every(Number.isFinite))return [Infinity,Infinity]
 const resolution=sourceGrid.getResolution(z)
 return [Math.round((stitched[2]-stitched[0])*pixelRatio/resolution),Math.round((stitched[3]-stitched[1])*pixelRatio/resolution)]
}

export function guardReprojection(source) {
 if(guardedSources.has(source))return
 guardedSources.add(source)
 const getTile=source.getTile
 source.getTile=function(z,x,y,pixelRatio,targetProjection){
  const sourceProjection=this.getProjection()
  if(!sourceProjection||!targetProjection||equivalent(sourceProjection,targetProjection))return getTile.call(this,z,x,y,pixelRatio,targetProjection)
  const sourceGrid=this.getTileGridForProjection(sourceProjection)
  const targetGrid=this.getTileGridForProjection(targetProjection)
  const coord=this.getTileCoordForTileUrlFunction([z,x,y],targetProjection)||[z,x,y]
  const original=sourceGrid.getZForResolution
  const hadOwn=Object.prototype.hasOwnProperty.call(sourceGrid,'getZForResolution')
  const effectiveRatio=this.getTilePixelRatio(pixelRatio)
  const targetSize=targetGrid.getTileSize(z)
  const [targetWidth,targetHeight]=typeof targetSize==='number'?[targetSize,targetSize]:targetSize
  const maxArea=Math.round(targetWidth*effectiveRatio)*Math.round(targetHeight*effectiveRatio)*MAX_SOURCE_AREA_RATIO
  const owner=this
  // ReprojTile selects the source zoom synchronously, before enumerating tiles.
  sourceGrid.getZForResolution=function(resolution,...args){
   let sourceZ=original.call(this,resolution,...args)
   const extent=sourceFootprint(owner,sourceProjection,targetProjection,sourceGrid,targetGrid,coord,resolution)
   if(!extent)return sourceZ
   for(;sourceZ>=sourceGrid.getMinZoom();sourceZ--){
    const [width,height]=estimateStitchSize(extent,sourceProjection,sourceGrid,sourceZ,effectiveRatio)
    if(width*height<=maxArea)return sourceZ
   }
   throw BUDGET_EXCEEDED
  }
  try{return getTile.call(this,z,x,y,pixelRatio,targetProjection)}
  catch(error){
   if(error!==BUDGET_EXCEEDED)throw error
   // No source zoom fits: an empty tile is preferable to an unsafe allocation.
   const empty=new ImageTile([z,x,y],TileState.EMPTY,'',null,()=>{})
   empty.key=this.getKey()
   return empty
  }finally{if(hadOwn)sourceGrid.getZForResolution=original;else delete sourceGrid.getZForResolution}
 }
}
