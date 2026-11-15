import View from 'ol/View.js'
import {get as getProjection,transform} from 'ol/proj.js'
import {getDistance} from 'ol/sphere.js'
import {createMapView} from './view.js?v=viewport-model'
import {equivalentViewportResolution,estimatedGroundAreaPerPixel} from './ground-area.js?v=viewport-model'
import {equivalentRotation} from './orientation.js?v=viewport-model'

const MAX_PASSES=3
const ROUND_TRIP_TOLERANCE_METRES=100

export class ProjectionUnavailableError extends Error {
 constructor(){super('This location is outside the selected projection. Move the map and try again.');this.name='ProjectionUnavailableError'}
}

function targetCenter(lonLat,projection){
 let point,roundTrip
 try{
  point=transform(lonLat,'EPSG:4326',projection)
  if(!point.every(Number.isFinite))throw new ProjectionUnavailableError()
  const extent=projection.getExtent()
  if(!extent||point[1]<extent[1]||point[1]>extent[3]||(!projection.canWrapX()&&(point[0]<extent[0]||point[0]>extent[2])))throw new ProjectionUnavailableError()
  roundTrip=transform(point,projection,'EPSG:4326')
  if(!roundTrip.every(Number.isFinite)||Math.abs(roundTrip[1])>90||getDistance(lonLat,roundTrip)>ROUND_TRIP_TOLERANCE_METRES)throw new ProjectionUnavailableError()
 }catch(error){
  if(error instanceof ProjectionUnavailableError)throw error
  throw new ProjectionUnavailableError()
 }
 return point
}

// A projection-aware snapshot: the OpenLayers view and its actual pixel size.
// The returned view is fully constrained before it is attached to the map.
export class ProjectionViewport {
 constructor(view,size){this.view=view;this.size=Array.isArray(size)?size.slice():undefined}
 static fromMap(map){return new ProjectionViewport(map.getView(),map.getSize())}

 switchTo(code){
  const source=this.view,projection=getProjection(code)
  if(!projection)throw new ProjectionUnavailableError()
  if(source.getProjection().getCode()===projection.getCode())return new ProjectionViewport(source,this.size)
  const center=source.getCenter()
  if(!center||!center.every(Number.isFinite))throw new ProjectionUnavailableError()
  let lonLat
  try{lonLat=transform(center,source.getProjection(),'EPSG:4326')}catch{throw new ProjectionUnavailableError()}
  if(!lonLat.every(Number.isFinite)||Math.abs(lonLat[1])>90)throw new ProjectionUnavailableError()
  const anchor=targetCenter(lonLat,projection)
  // Use an unconstrained reference at the same geographic anchor; later panning
  // to fit the map should not be mistaken for a change in orientation.
  const reference=new View({projection,center:anchor,resolution:source.getResolution(),rotation:source.getRotation(),constrainRotation:false,multiWorld:true,minZoom:-10})
  const orientation=equivalentRotation(source,reference,this.size)
  const view=createMapView(code,lonLat,source.getZoom(),orientation??source.getRotation(),{exactRotation:true})
  if(this.size?.length===2&&this.size.every(value=>Number.isFinite(value)&&value>0))view.setViewportSize(this.size)
  const sourceArea=estimatedGroundAreaPerPixel(source,this.size)
  let best=null,previous
  for(let pass=0;pass<MAX_PASSES;pass++){
   const resolution=equivalentViewportResolution(source,view,this.size)
   if(resolution!==null)view.setResolution(resolution)
   // Reapply the original anchor so the view shifts only as much as fitting needs.
   view.setCenter(anchor)
   view.resolveConstraints(0)
   const current={center:view.getCenter().slice(),resolution:view.getResolution()}
   const area=estimatedGroundAreaPerPixel(view,this.size)
   const score=sourceArea!==null&&area!==null?Math.abs(Math.log(area/sourceArea)):Infinity
   if(!best||score<best.score)best={...current,score}
   if(previous&&Math.abs(current.resolution/previous.resolution-1)<1e-5&&Math.hypot(current.center[0]-previous.center[0],current.center[1]-previous.center[1])<current.resolution*.01)break
   previous=current
  }
  if(best){view.setResolution(best.resolution);view.setCenter(best.center);view.resolveConstraints(0)}
  return new ProjectionViewport(view,this.size)
 }
}

export function createViewPreservingArea(view,code,size){return new ProjectionViewport(view,size).switchTo(code).view}
