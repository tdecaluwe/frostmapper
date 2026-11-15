import View from 'ol/View.js'
import {get as getProjection,transform} from 'ol/proj.js'

// OpenLayers handles clamping to these rectangular map extents. Wrapped
// projections are unbounded horizontally and bounded vertically.
const WRAPPED_PROJECTIONS=new Set(['EPSG:3857','FROST:TRIPTYCHIAL'])

export function createMapView(code,lonLat,zoom,rotation=0,{exactRotation=false}={}){
 const projection=getProjection(code)
 const options={projection,center:transform(lonLat,'EPSG:4326',projection),zoom,rotation}
 if(exactRotation)options.constrainRotation=false
 const extent=projection.getExtent()
 if(extent){
  const wrapped=WRAPPED_PROJECTIONS.has(code)
  Object.assign(options,{
   multiWorld:wrapped,
   extent:wrapped?[-Infinity,extent[1],Infinity,extent[3]]:extent,
   constrainOnlyCenter:false,
   smoothExtentConstraint:false,
   smoothResolutionConstraint:false,
   // Keep standard zoom numbering while permitting very short viewports.
   minZoom:-10,
  })
 }
 return new View(options)
}
