import '../src/map/projections/index.js?v=triptychial'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import TileLayer from 'ol/layer/Tile.js'
import {containsCoordinate} from 'ol/extent.js'
import {transform} from 'ol/proj.js'
import {clipLayer} from '../src/map/layers/clip.js?v=pole-overlays'

const map=new Map({view:new View({center:[0,0],zoom:4})})
const countries=[['ch',[8.54,47.37]],['fr',[2.35,48.85]],['no',[10.75,59.91]]]
const layers=await Promise.all(countries.map(async ([id])=>{const layer=new TileLayer();await clipLayer(map,layer,new URL(`../data/${id}.geojson`,import.meta.url));return layer}))
const errors=[]
for(const code of ['EPSG:3857','EPSG:3035','EPSG:PEIRCE','FROST:TRIPTYCHIAL']){
 map.setView(new View({projection:code,center:transform([10,50],'EPSG:4326',code),zoom:4}))
 countries.forEach(([id,center],i)=>{const extent=layers[i].getExtent(),point=transform(center,'EPSG:4326',code);if(!extent||!containsCoordinate(extent,point))errors.push(`${id} extent excludes its center in ${code}`)})
 if(code==='FROST:TRIPTYCHIAL'){
  const pole=transform([0,90],'EPSG:4326',code)
  for(const i of [0,1])if(containsCoordinate(layers[i].getExtent(),pole))errors.push(`${countries[i][0]} extent unnecessarily includes the North Pole`)
 }
}
document.querySelector('#results').textContent=errors.length?errors.join('\n'):'Passed country extent and projection-switch checks'
if(errors.length)throw Error(errors.join('\n'))
