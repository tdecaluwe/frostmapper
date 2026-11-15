import './map/projections/index.js?v=grieger-wrap'
import Map from 'ol/Map.js'
import {defaults as defaultInteractions} from 'ol/interaction/defaults.js'
import TileLayer from 'ol/layer/Tile.js'
import XYZ from 'ol/source/XYZ.js'
import {createMapView} from './map/projections/view.js?v=viewport-model'
import {ProjectionViewport,ProjectionUnavailableError} from './map/projections/viewport.js'
import {guardReprojection} from './map/layers/reprojection-budget.js?v=stitch-scaling'
const baseSource=new XYZ({url:'https://tile.opentopomap.org/{z}/{x}/{y}.png',crossOrigin:'anonymous',maxZoom:17,attributions:'Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap (CC-BY-SA)'})
guardReprojection(baseSource)
const map = new Map({target:'map',interactions:defaultInteractions({onFocusOnly:false}),layers:[new TileLayer({preload:2,cacheSize:16384,source:baseSource})],view:createMapView('EPSG:3857',[10,50],4)})
import {readState,syncUrl} from './map/state/url.js?v=fill-viewport'
function applyState(s){const code=['EPSG:3857','EPSG:3035','EPSG:PEIRCE','FROST:TRIPTYCHIAL'].includes(s.projection)?s.projection:'EPSG:3857';map.setView(createMapView(code,s.center,s.zoom,s.rotation,{exactRotation:true}));document.querySelector('#projection').value=code}
const initial=readState(); if(initial) applyState(initial)
syncUrl(map,applyState)
import {attachScale} from './map/controls/scale.js'
attachScale(map)
import {nationalLayer,swiss} from './map/layers/national.js?v=fill-viewport'
nationalLayer(map,{name:'Switzerland',border:'ch',source:swiss})
import {france} from './map/layers/national.js?v=fill-viewport'
nationalLayer(map,{name:'France',border:'fr',source:france})
import {norway} from './map/layers/national.js?v=fill-viewport'
nationalLayer(map,{name:'Norway',border:'no',source:norway})

document.querySelector('#projection').addEventListener('change',event=>{
 const selector=event.target,status=document.querySelector('#projection-status'),previous=map.getView().getProjection().getCode()
 try{
  const next=ProjectionViewport.fromMap(map).switchTo(selector.value)
  map.setView(next.view);status.hidden=true;status.textContent=''
 }catch(error){
  if(!(error instanceof ProjectionUnavailableError))throw error
  selector.value=previous;status.textContent=error.message;status.hidden=false
 }
})
