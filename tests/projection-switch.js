import '../src/map/projections/index.js?v=grieger-wrap'
import Map from 'ol/Map.js'
import Polygon from 'ol/geom/Polygon.js'
import {getArea} from 'ol/sphere.js'
import {transform} from 'ol/proj.js'
import {createMapView,createViewPreservingArea} from '../src/map/projections/view.js?v=preserve-area'

const el=document.querySelector('#map'),map=new Map({target:el,layers:[],controls:[],view:createMapView('EPSG:3857',[8.54,47.37],8)})
const codes=['EPSG:3857','EPSG:3035','EPSG:PEIRCE','FROST:TRIPTYCHIAL'],errors=[]
function localArea(){
 const [w,h]=map.getSize(),projection=map.getView().getProjection()
 const points=[[-20,-20],[20,-20],[20,20],[-20,20],[-20,-20]].map(([dx,dy])=>transform(map.getCoordinateFromPixel([w/2+dx,h/2+dy]),projection,'EPSG:4326'))
 for(let i=1;i<points.length;i++){while(points[i][0]-points[i-1][0]>180)points[i][0]-=360;while(points[i][0]-points[i-1][0]<-180)points[i][0]+=360}
 return getArea(new Polygon([points]),{projection:'EPSG:4326'})
}
for(const [w,h] of [[800,600],[390,664]]){
 el.style.width=`${w}px`;el.style.height=`${h}px`;map.updateSize()
 for(const center of [[8.54,47.37],[2.35,48.85],[10.75,59.91]])for(const from of codes)for(const to of codes){
  const initial=createMapView(from,center,8,.3);map.setView(initial);map.renderSync();const before=localArea()
  const next=createViewPreservingArea(initial,to,map.getSize());map.setView(next);map.renderSync();const after=localArea()
  const lonLat=transform(next.getCenter(),next.getProjection(),'EPSG:4326'),relative=Math.abs(after/before-1)
  if(!Number.isFinite(relative)||relative>0.02)errors.push(`${from} → ${to} at ${center}: area changed ${relative}`)
  if(Math.abs(lonLat[0]-center[0])>1e-4||Math.abs(lonLat[1]-center[1])>1e-4)errors.push(`${from} → ${to}: center changed ${lonLat}`)
  if(Math.abs(next.getRotation()-.3)>1e-8)errors.push(`${from} → ${to}: rotation changed`)
 }
}
// Independently approximate the full visible ground area on a wider view.
function viewportArea(){
 const [width,height]=map.getSize(),projection=map.getView().getProjection();let total=0
 const count=8
 for(let x=0;x<count;x++)for(let y=0;y<count;y++){
  const pixels=[[x,y],[x+1,y],[x+1,y+1],[x,y+1],[x,y]]
  const ring=pixels.map(([px,py])=>transform(map.getCoordinateFromPixel([px*width/count,py*height/count]),projection,'EPSG:4326'))
  if(ring.some(point=>!point.every(Number.isFinite)))continue
  for(let i=1;i<ring.length;i++){while(ring[i][0]-ring[i-1][0]>180)ring[i][0]-=360;while(ring[i][0]-ring[i-1][0]<-180)ring[i][0]+=360}
  total+=getArea(new Polygon([ring]),{projection:'EPSG:4326'})
 }
 return total
}
for(const [width,height] of [[800,600],[390,664]])for(const zoom of [3,4])for(const rotation of [0,.35])for(const target of codes.slice(1)){
 el.style.width=`${width}px`;el.style.height=`${height}px`;map.updateSize()
 const initial=createMapView('EPSG:3857',[8.54,47.37],zoom,rotation);map.setView(initial);map.renderSync();const before=viewportArea()
 const next=createViewPreservingArea(initial,target,map.getSize());map.setView(next);map.renderSync();const after=viewportArea()
 const relative=Math.abs(after/before-1)
 if(!Number.isFinite(relative)||relative>.05)errors.push(`wide viewport ${width}×${height} z${zoom} rotation ${rotation} → ${target}: area changed ${relative}`)
}
// Repeated switching should not accumulate a noticeable area drift.
el.style.width='800px';el.style.height='600px';map.updateSize()
let current=createMapView('EPSG:3857',[8.54,47.37],4);map.setView(current);map.renderSync();const initialArea=viewportArea()
for(let cycle=0;cycle<3;cycle++)for(const code of ['EPSG:3035','EPSG:PEIRCE','FROST:TRIPTYCHIAL','EPSG:3857']){
 current=createViewPreservingArea(current,code,map.getSize());map.setView(current);map.renderSync()
}
const drift=Math.abs(viewportArea()/initialArea-1)
if(!Number.isFinite(drift)||drift>.05)errors.push(`repeated switches drifted ${drift}`)
// Domain limits and cuts must degrade gracefully without invalid resolutions.
for(const center of [[0,89.99],[179,0],[-179,-80]])for(const to of codes){
 const initial=createMapView('FROST:TRIPTYCHIAL',center,8);map.setView(initial)
 const next=createViewPreservingArea(initial,to,map.getSize());map.setView(next)
 if(!Number.isFinite(next.getResolution())||next.getResolution()<=0||!next.getCenter().every(Number.isFinite))errors.push(`invalid view near ${center} → ${to}`)
}
map.setTarget(undefined)
document.querySelector('#results').textContent=errors.length?errors.join('\n'):'Passed projection area, center, rotation, and edge-case checks'
if(errors.length)throw Error(errors.join('\n'))
