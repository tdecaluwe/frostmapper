import Map from 'ol/Map.js'
import View from 'ol/View.js'
import TileLayer from 'ol/layer/Tile.js'
import XYZ from 'ol/source/XYZ.js'
import {fromLonLat} from 'ol/proj.js'
const map = new Map({target:'map',layers:[new TileLayer({source:new XYZ({url:'https://tile.opentopomap.org/{z}/{x}/{y}.png',crossOrigin:'anonymous',maxZoom:17,attributions:'Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap (CC-BY-SA)'})})],view:new View({center:fromLonLat([10,50]),zoom:4})})
