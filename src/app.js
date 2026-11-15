import './map/projections/index.js?v=triptychial'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import {defaults as defaultInteractions} from 'ol/interaction/defaults.js'
import TileLayer from 'ol/layer/Tile.js'
import XYZ from 'ol/source/XYZ.js'
import {fromLonLat} from 'ol/proj.js'
import {guardReprojection} from './map/layers/reprojection-budget.js'
const baseSource=new XYZ({url:'https://tile.opentopomap.org/{z}/{x}/{y}.png',crossOrigin:'anonymous',maxZoom:17,attributions:'Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap (CC-BY-SA)'})
guardReprojection(baseSource)
const map = new Map({target:'map',interactions:defaultInteractions({onFocusOnly:false}),layers:[new TileLayer({preload:2,cacheSize:16384,source:baseSource})],view:new View({center:fromLonLat([10,50]),zoom:4})})
import {readState,syncUrl} from './map/state/url.js'
import {transform} from 'ol/proj.js'
function applyState(s){const code=['EPSG:3857','EPSG:3035','EPSG:PEIRCE','FROST:TRIPTYCHIAL'].includes(s.projection)?s.projection:'EPSG:3857';const v=new View({projection:code,center:transform(s.center,'EPSG:4326',code),zoom:s.zoom,rotation:s.rotation});map.setView(v);document.querySelector('#projection').value=code}
const initial=readState(); if(initial) applyState(initial)
syncUrl(map,applyState)
import {attachScale} from './map/controls/scale.js'
attachScale(map)
import {nationalLayer,swiss} from './map/layers/national.js?v=reprojection-budget'
nationalLayer(map,{name:'Switzerland',border:'ch',source:swiss})
import {france} from './map/layers/national.js?v=reprojection-budget'
nationalLayer(map,{name:'France',border:'fr',source:france})
import {norway} from './map/layers/national.js?v=reprojection-budget'
nationalLayer(map,{name:'Norway',border:'no',source:norway})

document.querySelector('#projection').addEventListener('change',e=>{const v=map.getView();applyState({projection:e.target.value,center:transform(v.getCenter(),v.getProjection(),'EPSG:4326'),zoom:v.getZoom(),rotation:v.getRotation()})})
