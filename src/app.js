import {attachNavigation} from './map/controls/navigation.js?v=edge-controls-v1'
import './map/projections/index.js?v=grieger-wrap'
import Map from 'ol/Map.js'
import {defaults as defaultInteractions} from 'ol/interaction/defaults.js'
import TileLayer from 'ol/layer/Tile.js'
import XYZ from 'ol/source/XYZ.js'
import {createMapView} from './map/projections/view.js?v=viewport-model'
import {ProjectionViewport,ProjectionUnavailableError} from './map/projections/viewport.js'
import {CanonicalZoom} from './map/projections/canonical-zoom.js'
import {ZoomBandSource} from './map/reprojection/zoom-band-source.js?v=source-loads'
import {ContourReprojection} from './map/reprojection/contour-reprojection.js?v=step-tiles-v1'
import {enableTileLoadingWhileInteracting} from './map/interactive-tile-loading.js'
const baseSource=new (ZoomBandSource(XYZ))({url:'https://tile.opentopomap.org/{z}/{x}/{y}.png',crossOrigin:'anonymous',maxZoom:17,attributions:'Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap (CC-BY-SA)'})
const map = new Map({target:'map',interactions:defaultInteractions({onFocusOnly:false}),layers:[new TileLayer({preload:2,cacheSize:16384,source:baseSource})],view:createMapView('EPSG:3857',[10,50],4)})
attachNavigation(map)
enableTileLoadingWhileInteracting(map)
const contourReprojection=new ContourReprojection(map,{steps:4})
baseSource.configureZoomBands(contourReprojection)
if(new URL(location.href).searchParams.get('debugBands')==='1')import('./map/reprojection/debug-overlay.js?v=steps-v1').then(({ContourDebugOverlay})=>new ContourDebugOverlay(map,contourReprojection))
import {readState,syncUrl} from './map/state/url.js?v=contour-bands'
function applyState(s){const code=['EPSG:3857','EPSG:3035','EPSG:PEIRCE','FROST:TRIPTYCHIAL'].includes(s.projection)?s.projection:'EPSG:3857';map.setView(CanonicalZoom.createView(code,s.center,s.zoom,s.rotation,map.getSize()));document.querySelector('#projection').value=code}
const initial=readState(); if(initial) applyState(initial)
syncUrl(map,applyState)
import {attachScale} from './map/controls/scale.js'
attachScale(map)
import {nationalLayer,swiss} from './map/layers/national.js?v=source-loads'
nationalLayer(map,{name:'Switzerland',border:'ch',source:swiss,contourReprojection})
import {france} from './map/layers/national.js?v=source-loads'
nationalLayer(map,{name:'France',border:'fr',source:france,contourReprojection})
import {norway} from './map/layers/national.js?v=source-loads'
nationalLayer(map,{name:'Norway',border:'no',source:norway,contourReprojection})

document.querySelector('#projection').addEventListener('change',event=>{
 const selector=event.target,status=document.querySelector('#projection-status'),previous=map.getView().getProjection().getCode()
 try{
  contourReprojection.zoomSupervisor.anticipateProjectionTranslation(selector.value,'EPSG:3857','source').catch(()=>{})
  const next=ProjectionViewport.fromMap(map).switchTo(selector.value)
  map.setView(next.view);status.hidden=true;status.textContent=''
 }catch(error){
  if(!(error instanceof ProjectionUnavailableError))throw error
  selector.value=previous;status.textContent=error.message;status.hidden=false
 }
})

import {addSteepnessLayer} from './map/layers/steepness.js?v=palette-v2'
addSteepnessLayer(map,contourReprojection)
