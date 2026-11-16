import ImageTile from 'ol/ImageTile.js'
import TileState from 'ol/TileState.js'
import Triangulation from 'ol/reproj/Triangulation.js'
import {ERROR_THRESHOLD} from 'ol/reproj/common.js'
import {equivalent} from 'ol/proj.js'
import {createEmpty,extend,getArea,getIntersection,getWidth,wrapAndSliceX} from 'ol/extent.js'

// The stitched source canvas may use at most 9× the output tile area.
// For a 256×256 tile at pixel ratio 1, this is 589,824 pixels (~2.25 MiB RGBA).
export const MAX_SOURCE_AREA_RATIO = 9
// Limit decoded source-image load as well as the stitch buffer. Ordinary 3×3
// source tiles remain at their preferred zoom; extreme polar footprints can
// fall back to a coarser source zoom before loading thousands of images.
export const MAX_NATIVE_SOURCE_AREA_RATIO = 32
const guardedSources = new WeakSet()
const BUDGET_EXCEEDED = Symbol('reprojection budget exceeded')

// Mirror ReprojTile's extent handling. We estimate with every candidate tile,
// including tiles that will later turn out to be empty, to stay conservative.
function sourceFootprint(source,sourceProjection,targetProjection,sourceGrid,targetGrid,tileCoord,sourceResolution,existingTriangulation) {
 const targetExtent=targetGrid.getTileCoordExtent(tileCoord)
 const maxTargetExtent=targetGrid.getExtent()
 const limitedTarget=maxTargetExtent?getIntersection(targetExtent,maxTargetExtent):targetExtent
 const projectionExtent=sourceProjection.getExtent()
 let maxSourceExtent=sourceGrid.getExtent()
 if(projectionExtent)maxSourceExtent=maxSourceExtent?getIntersection(maxSourceExtent,projectionExtent):projectionExtent
 const targetResolution=targetGrid.getResolution(tileCoord[0])
 const threshold=source.reprojectionErrorThreshold_ ?? ERROR_THRESHOLD
 // Reuse OpenLayers' current triangulation when available. If its internal
 // call order changes, retain the conservative independent calculation.
 const triangulation=existingTriangulation || new Triangulation(sourceProjection,targetProjection,limitedTarget,maxSourceExtent,sourceResolution*threshold,targetResolution)
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
 // Keep fractional dimensions so Canvas rounding is applied only once.
 return [(stitched[2]-stitched[0])*pixelRatio/resolution,(stitched[3]-stitched[1])*pixelRatio/resolution]
}

// Find the largest stitch scale whose rounded dimensions stay within budget.
function stitchScale(width,height,maxArea) {
 if(Math.round(width)*Math.round(height)<=maxArea)return 1
 let low=0,high=1
 for(let i=0;i<48;i++){
  const middle=(low+high)/2
  if(Math.round(width*middle)*Math.round(height*middle)<=maxArea)low=middle
  else high=middle
 }
 return low
}

export function guardReprojection(source) {
 if(guardedSources.has(source))return
 guardedSources.add(source)
 const getTile=source.getTile
 function guardedTile(z,x,y,pixelRatio,targetProjection,requestedZoom,areaRatio=MAX_SOURCE_AREA_RATIO,nativeRatio=MAX_NATIVE_SOURCE_AREA_RATIO,selectSourceZoom=null){
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
  const outputArea=Math.round(targetWidth*effectiveRatio)*Math.round(targetHeight*effectiveRatio)
  const maxArea=outputArea*areaRatio
  const owner=this
  let scale=1
  let currentTriangulation
  const getTriangles=Triangulation.prototype.getTriangles
  // ReprojTile calls getTriangles() immediately before selecting source zoom.
  // Capture only this projection pair and only during this synchronous call.
  Triangulation.prototype.getTriangles=function(...args){
   const result=getTriangles.apply(this,args)
   if(this.sourceProj_===sourceProjection && this.targetProj_===targetProjection)currentTriangulation=this
   return result
  }
  try{
   // ReprojTile selects the source zoom synchronously, before enumerating tiles.
   sourceGrid.getZForResolution=function(resolution,...args){
    let sourceZ=Number.isInteger(requestedZoom)?Math.max(this.getMinZoom(),Math.min(this.getMaxZoom(),requestedZoom)):original.call(this,resolution,...args)
    const extent=sourceFootprint(owner,sourceProjection,targetProjection,sourceGrid,targetGrid,coord,resolution,currentTriangulation)
    if(extent&&selectSourceZoom){
     const selected=selectSourceZoom(extent,{resolution,sourceZoom:sourceZ})
     if(Number.isInteger(selected))sourceZ=Math.max(sourceGrid.getMinZoom(),Math.min(sourceGrid.getMaxZoom(),selected))
    }
    if(!extent)return sourceZ
    for(;sourceZ>=sourceGrid.getMinZoom();sourceZ--){
     const [width,height]=estimateStitchSize(extent,sourceProjection,sourceGrid,sourceZ,effectiveRatio)
     // Avoid excessive image loading independently of the stitch budget.
     if(Math.round(width)*Math.round(height)<=outputArea*nativeRatio){
      scale=stitchScale(width,height,maxArea)
      return sourceZ
     }
    }
    throw BUDGET_EXCEEDED
   }
   const tile=getTile.call(this,z,x,y,pixelRatio,targetProjection)
   if(scale<1 && tile.sourceTileGrid_){
    // ReprojTile uses this grid twice: first for the real source extents, then
    // for the stitch resolution. Preserve the former and scale only the latter.
    const stitchGrid=Object.create(sourceGrid)
    stitchGrid.getTileCoordExtent=sourceGrid.getTileCoordExtent.bind(sourceGrid)
    stitchGrid.getResolution=level=>sourceGrid.getResolution(level)/scale
    tile.sourceTileGrid_=stitchGrid
   }
   return tile
  }catch(error){
   if(error!==BUDGET_EXCEEDED)throw error
   // No source zoom fits: an empty tile is preferable to an unsafe allocation.
   const empty=new ImageTile([z,x,y],TileState.EMPTY,'',null,()=>{})
   empty.key=this.getKey()
   return empty
  }finally{
   Triangulation.prototype.getTriangles=getTriangles
   if(hadOwn)sourceGrid.getZForResolution=original;else delete sourceGrid.getZForResolution
  }
 }
 source.getTile=function(z,x,y,pixelRatio,targetProjection){return guardedTile.call(this,z,x,y,pixelRatio,targetProjection)}
 // Reuse the same bounds when a contour band requests a specific source zoom.
 source.getTileAtSourceZoom=function(z,x,y,pixelRatio,targetProjection,sourceZoom,areaRatio,nativeRatio,selectSourceZoom){return guardedTile.call(this,z,x,y,pixelRatio,targetProjection,sourceZoom,areaRatio,nativeRatio,selectSourceZoom)}
}
