import View from 'ol/View.js'
import {get as getProjection,transform} from 'ol/proj.js'
import {equivalentViewportResolution} from './ground-area.js'

// These projections repeat horizontally but have a finite vertical extent.
const WRAPPED_PROJECTIONS=new Set(['EPSG:3857','FROST:TRIPTYCHIAL'])

export function createMapView(code,lonLat,zoom,rotation=0){
 const projection=getProjection(code)
 const options={projection,center:transform(lonLat,'EPSG:4326',projection),zoom,rotation}
 if(WRAPPED_PROJECTIONS.has(code)){
  const extent=projection.getExtent()
  Object.assign(options,{
   multiWorld:true,
   extent:[-Infinity,extent[1],Infinity,extent[3]],
   // Constrain the entire viewport vertically, not its center or its width.
   constrainOnlyCenter:false,
   smoothExtentConstraint:false,
   smoothResolutionConstraint:false,
   // Allow enough zoom-out for short/wide viewports; the vertical extent
   // remains the actual limit. Negative zoom values keep normal zoom numbering.
   minZoom:-10,
  })
 }
 return new View(options)
}

// Keep the local ground area represented by the fixed-size viewport stable.
export function createViewPreservingArea(sourceView,code,size){
 const lonLat=transform(sourceView.getCenter(),sourceView.getProjection(),'EPSG:4326')
 const view=createMapView(code,lonLat,sourceView.getZoom(),sourceView.getRotation())
 const resolution=equivalentViewportResolution(sourceView,view,size)
 if(resolution!==null)view.setResolution(resolution)
 return view
}
