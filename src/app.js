import Map from 'ol/Map.js'
import View from 'ol/View.js'
import TileLayer from 'ol/layer/Tile.js'
import XYZ from 'ol/source/XYZ.js'
import {fromLonLat} from 'ol/proj.js'
const map = new Map({target:'map',layers:[new TileLayer({source:new XYZ({url:'https://tile.opentopomap.org/{z}/{x}/{y}.png',crossOrigin:'anonymous',maxZoom:17,attributions:'Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap (CC-BY-SA)'})})],view:new View({center:fromLonLat([10,50]),zoom:4})})
import {readState,syncUrl} from './map/state/url.js'
import {transform} from 'ol/proj.js'
function applyState(s){const v=map.getView();v.setCenter(transform(s.center,'EPSG:4326',v.getProjection()));v.setZoom(s.zoom);v.setRotation(s.rotation)}
const initial=readState(); if(initial) applyState(initial)
syncUrl(map,applyState)
