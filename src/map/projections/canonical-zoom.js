import View from 'ol/View.js'
import {transform} from 'ol/proj.js'
import {equivalentViewportResolution} from './ground-area.js?v=viewport-model'
import {createMapView} from './view.js?v=viewport-model'

const MAX_MERCATOR_LAT=85.0511287798066
function referenceView(lonLat,zoom,rotation=0){
 const center=transform([lonLat[0],Math.max(-MAX_MERCATOR_LAT,Math.min(MAX_MERCATOR_LAT,lonLat[1]))],'EPSG:4326','EPSG:3857')
 return new View({projection:'EPSG:3857',center,zoom,rotation,constrainRotation:false,multiWorld:true,minZoom:-10})
}

// The public zoom is the Web Mercator zoom covering approximately the same
// ground area. OpenLayers view and source-tile zooms remain implementation
// details. Actual projection constraints can still force the area to change.
export class CanonicalZoom {
 static fromView(view,size){
  if(view.getProjection().getCode()==='EPSG:3857')return view.getZoom()
  let lonLat
  try{lonLat=transform(view.getCenter(),view.getProjection(),'EPSG:4326')}catch{return null}
  if(!lonLat.every(Number.isFinite))return null
  const reference=referenceView(lonLat,view.getZoom(),view.getRotation())
  const resolution=equivalentViewportResolution(view,reference,size)
  if(resolution===null)return null
  const zoom=reference.getZoomForResolution(resolution)
  return Number.isFinite(zoom)?zoom:null
 }
 static createView(code,lonLat,zoom,rotation,size){
  const view=createMapView(code,lonLat,zoom,rotation,{exactRotation:true})
  if(size?.length===2&&size.every(v=>Number.isFinite(v)&&v>0))view.setViewportSize(size)
  if(code==='EPSG:3857')return view
  const reference=referenceView(lonLat,zoom,rotation)
  const anchor=transform(lonLat,'EPSG:4326',view.getProjection())
  for(let pass=0;pass<3;pass++){
   const resolution=equivalentViewportResolution(reference,view,size)
   if(resolution===null)break
   const previous=view.getResolution();view.setResolution(resolution)
   if(anchor.every(Number.isFinite))view.setCenter(anchor)
   view.resolveConstraints(0)
   if(Math.abs(view.getResolution()/previous-1)<1e-5)break
  }
  return view
 }
}
