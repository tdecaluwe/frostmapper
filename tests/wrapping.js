import '../src/map/projections/index.js?v=grieger-wrap'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import {createMapView} from '../src/map/projections/view.js'
import TileLayer from 'ol/layer/Tile.js'
import XYZ from 'ol/source/XYZ.js'
import {get,transform} from 'ol/proj.js'
import {clipLayer} from '../src/map/layers/clip.js?v=fill-viewport'
import {guardReprojection} from '../src/map/layers/reprojection-budget.js?v=contour-bands'
import {syncUrl} from '../src/map/state/url.js?v=fill-viewport'

function solid(color){const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,256,256);return canvas.toDataURL()}
function source(color){const image=solid(color),result=new XYZ({tileUrlFunction:()=>image,wrapX:true,transition:0});guardReprojection(result);return result}
const projection=get('FROST:TRIPTYCHIAL'),extent=projection.getExtent(),width=extent[2]-extent[0]
const view=new View({projection,center:transform([8.54,47.37],'EPSG:4326',projection),zoom:8,multiWorld:true})
const base=new TileLayer({source:source('#f00000')})
const countries=[
 {id:'ch',center:[8.54,47.37],color:'#00e000',expected:[0,224,0]},
 {id:'fr',center:[2.35,48.85],color:'#0000e0',expected:[0,0,224]},
 {id:'no',center:[10.75,59.91],color:'#e0e000',expected:[224,224,0]},
]
const layers=countries.map(country=>new TileLayer({source:source(country.color)}))
const map=new Map({target:'map',view,layers:[base,...layers]})
await Promise.all(countries.map((country,i)=>clipLayer(map,layers[i],new URL(`../data/${country.id}.geojson`,import.meta.url))))
syncUrl(map,()=>{})
function render(){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('map render timed out')),15000);map.once('rendercomplete',()=>{clearTimeout(timeout);resolve()});map.render()})}
const errors=[]
if(!projection.canWrapX())errors.push('projection does not wrap')
for(const country of countries)for(const world of [0,1,-1,3]){
 const center=transform(country.center,'EPSG:4326',projection)
 view.setCenter([center[0]+world*width,center[1]])
 await render()
 const location=transform(view.getCenter(),projection,'EPSG:4326'),longitude=((location[0]+180)%360+360)%360-180
 if(Math.abs(longitude-country.center[0])>1e-4||Math.abs(location[1]-country.center[1])>1e-4)errors.push(`incorrect ${country.id} inverse in world ${world}: ${location}`)
 const saved=new URL(window.location.href).searchParams.get('loc')
 if(!saved?.startsWith(`@${country.center[1].toFixed(6)},${country.center[0].toFixed(6)},`))errors.push(`incorrect ${country.id} URL in world ${world}: ${saved}`)
 const composite=document.createElement('canvas');composite.width=composite.height=256;const ctx=composite.getContext('2d')
 for(const canvas of document.querySelectorAll('#map .ol-layer canvas'))ctx.drawImage(canvas,0,0,256,256)
 const pixel=ctx.getImageData(128,128,1,1).data
 if(country.expected.some((value,i)=>Math.abs(pixel[i]-value)>20))errors.push(`${country.id} overlay not visible in world ${world}: ${pixel}`)
}
// At low zoom, several world copies can be visible simultaneously.
for(const layer of layers)layer.setVisible(false)
const broad=new TileLayer({source:source('#00e000')});map.addLayer(broad)
const geometry={type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[-30,20],[30,20],[30,60],[-30,60],[-30,20]]]}}]}
const blob=URL.createObjectURL(new Blob([JSON.stringify(geometry)],{type:'application/geo+json'}))
await clipLayer(map,broad,blob);URL.revokeObjectURL(blob)
document.querySelector('#map').style.width='768px';map.updateSize()
const broadCenter=transform([0,40],'EPSG:4326',projection)
view.setCenter(broadCenter);view.setZoom(0)
await render()
const combined=document.createElement('canvas');combined.width=768;combined.height=256;const combinedContext=combined.getContext('2d')
for(const canvas of document.querySelectorAll('#map .ol-layer canvas'))combinedContext.drawImage(canvas,0,0,768,256)
for(const world of [-1,0,1]){
 const pixel=map.getPixelFromCoordinate([broadCenter[0]+world*width,broadCenter[1]])
 if(pixel[0]<0||pixel[0]>=768){errors.push(`world ${world} outside wide viewport: ${pixel}`);continue}
 const rgba=combinedContext.getImageData(Math.round(pixel[0]),Math.round(pixel[1]),1,1).data
 if(rgba[1]<180||rgba[0]>60)errors.push(`simultaneous world ${world} is missing: ${rgba}`)
}
// Web Mercator also repeats its clipped national layers across worlds.
broad.setVisible(false)
for(const layer of layers)layer.setVisible(true)
const mercatorView=createMapView('EPSG:3857',[8.54,47.37],8)
map.setView(mercatorView)
const mercatorProjection=mercatorView.getProjection(),mercatorExtent=mercatorProjection.getExtent(),mercatorWidth=mercatorExtent[2]-mercatorExtent[0]
for(const country of countries)for(const world of [-1,0,1]){
 const center=transform(country.center,'EPSG:4326',mercatorProjection)
 mercatorView.setCenter([center[0]+world*mercatorWidth,center[1]])
 await render()
 const composite=document.createElement('canvas');composite.width=768;composite.height=256;const ctx=composite.getContext('2d')
 for(const canvas of document.querySelectorAll('#map .ol-layer canvas'))ctx.drawImage(canvas,0,0,768,256)
 const pixel=ctx.getImageData(384,128,1,1).data
 if(country.expected.some((value,i)=>Math.abs(pixel[i]-value)>20))errors.push(`Web Mercator ${country.id} overlay not visible in world ${world}: ${pixel}`)
 const saved=new URL(window.location.href).searchParams.get('loc')
 if(!saved?.startsWith(`@${country.center[1].toFixed(6)},${country.center[0].toFixed(6)},`))errors.push(`incorrect Web Mercator ${country.id} URL in world ${world}: ${saved}`)
}
// Repeat a Swiss overlay with rotation in both wrapping projections.
for(const code of ['EPSG:3857','FROST:TRIPTYCHIAL']){
 const rotated=createMapView(code,[8.54,47.37],8,Math.PI/4);map.setView(rotated)
 const extent=rotated.getProjection().getExtent(),worldWidth=extent[2]-extent[0],center=rotated.getCenter()
 rotated.setCenter([center[0]+worldWidth,center[1]])
 await render()
 const composite=document.createElement('canvas');composite.width=768;composite.height=256;const ctx=composite.getContext('2d')
 for(const canvas of document.querySelectorAll('#map .ol-layer canvas'))ctx.drawImage(canvas,0,0,768,256)
 const pixel=ctx.getImageData(384,128,1,1).data
 if(pixel[1]<180||pixel[0]>60)errors.push(`rotated ${code} Swiss overlay not visible: ${pixel}`)
}
map.setTarget(undefined)
document.querySelector('#results').textContent=errors.length?errors.join('\n'):'Passed Grieger and Web Mercator wrap, URL, and overlay checks'
if(errors.length)throw Error(errors.join('\n'))
