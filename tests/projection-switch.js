import '../src/map/projections/index.js?v=grieger-wrap'
import Map from 'ol/Map.js'
import Polygon from 'ol/geom/Polygon.js'
import {getArea} from 'ol/sphere.js'
import {transform} from 'ol/proj.js'
import {createMapView} from '../src/map/projections/view.js?v=viewport-model'
import {createViewPreservingArea,ProjectionViewport,ProjectionUnavailableError} from '../src/map/projections/viewport.js'
import {blendCircleRotations} from '../src/map/projections/orientation.js?v=viewport-model'

const el=document.querySelector('#map'),map=new Map({target:el,layers:[],controls:[],view:createMapView('EPSG:3857',[8.54,47.37],8)})
const codes=['EPSG:3857','EPSG:3035','EPSG:PEIRCE','FROST:TRIPTYCHIAL'],errors=[]
function trySwitch(view,code){
 try{return createViewPreservingArea(view,code,map.getSize())}
 catch(error){if(error instanceof ProjectionUnavailableError)return null;throw error}
}
function snapped(source,target){
 const geo=transform(source.getCenter(),source.getProjection(),'EPSG:4326')
 const expected=transform(geo,'EPSG:4326',target.getProjection()),actual=target.getCenter()
 if(target.getProjection().canWrapX()){
  const e=target.getProjection().getExtent(),width=e[2]-e[0]
  expected[0]+=Math.round((actual[0]-expected[0])/width)*width
 }
 return Math.hypot(actual[0]-expected[0],actual[1]-expected[1])>target.getResolution()*.01
}
function constrained(view){
 const domain=view.getProjection().getExtent(),visible=view.calculateExtent(map.getSize()),epsilon=view.getResolution()*2
 return Math.abs(visible[1]-domain[1])<epsilon||Math.abs(visible[3]-domain[3])<epsilon||(!view.getProjection().canWrapX()&&(Math.abs(visible[0]-domain[0])<epsilon||Math.abs(visible[2]-domain[2])<epsilon))
}
function localArea(){
 const [w,h]=map.getSize(),projection=map.getView().getProjection()
 const points=[[-20,-20],[20,-20],[20,20],[-20,20],[-20,-20]].map(([dx,dy])=>transform(map.getCoordinateFromPixel([w/2+dx,h/2+dy]),projection,'EPSG:4326'))
 for(let i=1;i<points.length;i++){while(points[i][0]-points[i-1][0]>180)points[i][0]-=360;while(points[i][0]-points[i-1][0]<-180)points[i][0]+=360}
 return getArea(new Polygon([points]),{projection:'EPSG:4326'})
}
// Measure the screen bearing of geographic north, independently of the
// implementation's rotation calculation.
function screenNorth(){
 const view=map.getView(),projection=view.getProjection(),center=view.getCenter()
 const [lon,lat]=transform(center,projection,'EPSG:4326'),points=[]
 for(const latitude of [lat-.0001,lat+.0001]){
  const point=transform([lon,latitude],'EPSG:4326',projection)
  if(projection.canWrapX()){
   const extent=projection.getExtent(),width=extent[2]-extent[0]
   point[0]+=Math.round((center[0]-point[0])/width)*width
  }
  points.push(map.getPixelFromCoordinate(point))
 }
 return Math.atan2(points[1][0]-points[0][0],-(points[1][1]-points[0][1]))
}
function angleDifference(a,b){return Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)))}
// Compare directions using OpenLayers' screen/coordinate conversions, not the
// implementation's projection-space rotation formula.
function circleSamples(){
 const [width,height]=map.getSize(),radius=Math.min(width,height)/2,projection=map.getView().getProjection(),extent=projection.getExtent(),result=[]
 for(let i=0;i<32;i++){
  const angle=2*Math.PI*i/32,px=radius*Math.cos(angle),py=radius*Math.sin(angle)
  const coordinate=map.getCoordinateFromPixel([width/2+px,height/2+py])
  if(extent&&(coordinate[1]<extent[1]||coordinate[1]>extent[3]))continue
  if(extent&&!projection.canWrapX()&&(coordinate[0]<extent[0]||coordinate[0]>extent[2]))continue
  const lonLat=transform(coordinate,projection,'EPSG:4326')
  if(lonLat.every(Number.isFinite)&&Math.abs(lonLat[1])<=90)result.push({lonLat,direction:Math.atan2(px,-py)})
 }
 return result
}
function circleShift(samples){
 const view=map.getView(),projection=view.getProjection(),center=view.getCenter(),extent=projection.getExtent(),[width,height]=map.getSize()
 let sin=0,cos=0,count=0
 for(const sample of samples){
  const point=transform(sample.lonLat,'EPSG:4326',projection)
  if(!point.every(Number.isFinite))continue
  if(extent&&(point[1]<extent[1]||point[1]>extent[3]))continue
  if(extent&&!projection.canWrapX()&&(point[0]<extent[0]||point[0]>extent[2]))continue
  if(projection.canWrapX()){const worldWidth=extent[2]-extent[0];point[0]+=Math.round((center[0]-point[0])/worldWidth)*worldWidth}
  const pixel=map.getPixelFromCoordinate(point),dx=pixel[0]-width/2,dy=pixel[1]-height/2
  if(Math.hypot(dx,dy)<1e-6)continue
  const shift=Math.atan2(dx,-dy)-sample.direction;sin+=Math.sin(shift);cos+=Math.cos(shift);count++
 }
 return {angle:Math.atan2(sin,cos),count,strength:Math.hypot(sin,cos)/count}
}
for(const [w,h] of [[800,600],[390,664]]){
 el.style.width=`${w}px`;el.style.height=`${h}px`;map.updateSize()
 for(const center of [[8.54,47.37],[2.35,48.85],[10.75,59.91]])for(const from of codes)for(const to of codes){
  const initial=createMapView(from,center,8,.3);map.setView(initial);map.renderSync();const before=localArea(),beforeNorth=screenNorth(),circle=circleSamples()
  const next=createViewPreservingArea(initial,to,map.getSize());map.setView(next);map.renderSync();const after=localArea()
  const lonLat=transform(next.getCenter(),next.getProjection(),'EPSG:4326'),relative=Math.abs(after/before-1)
  if(!Number.isFinite(relative)||relative>0.02)errors.push(`${from} → ${to} at ${center}: area changed ${relative}`)
  if(Math.abs(lonLat[0]-center[0])>1e-4||Math.abs(lonLat[1]-center[1])>1e-4)errors.push(`${from} → ${to}: center changed ${lonLat}`)
  if(angleDifference(beforeNorth,screenNorth())>.01)errors.push(`${from} → ${to}: low-distortion north changed too much`)
  const shift=circleShift(circle);if(shift.count>=8&&shift.strength>=.1&&Math.abs(shift.angle)>1e-4)errors.push(`${from} → ${to}: circle mean shifted ${shift.angle}`)
 }
}
// Verify zero, small (below OpenLayers' snap threshold), and rotated headings.
for(const rotation of [0,.03,.3,-.7,Math.PI-.01,-Math.PI+.01])for(const from of codes)for(const to of codes){
 const initial=createMapView(from,[8.54,47.37],8,rotation,{exactRotation:true});map.setView(initial);map.renderSync();const before=screenNorth(),circle=circleSamples()
 const next=createViewPreservingArea(initial,to,map.getSize());map.setView(next);map.renderSync()
 if(angleDifference(before,screenNorth())>.01)errors.push(`${from} → ${to}: low-distortion north changed at rotation ${rotation}`)
 const shift=circleShift(circle);if(shift.count>=8&&shift.strength>=.1&&Math.abs(shift.angle)>1e-4)errors.push(`${from} → ${to}: circle mean shifted at rotation ${rotation}: ${shift.angle}`)
}
// If the viewport size is unavailable, use a local-north fallback.
{
 const initial=createMapView('EPSG:3857',[8.54,47.37],8,.03,{exactRotation:true});map.setView(initial);map.renderSync();const before=screenNorth()
 const next=createViewPreservingArea(initial,'FROST:TRIPTYCHIAL');map.setView(next);map.renderSync()
 if(angleDifference(before,screenNorth())>1e-4)errors.push('local orientation fallback changed screen north')
}
// Compare the circular average on wider, rotated views and all projection pairs.
for(const [width,height] of [[800,600],[390,664]])for(const zoom of [3,4])for(const rotation of [0,.35])for(const from of codes)for(const to of codes){
 el.style.width=`${width}px`;el.style.height=`${height}px`;map.updateSize()
 const initial=createMapView(from,[8.54,47.37],zoom,rotation,{exactRotation:true});map.setView(initial);map.renderSync();const circle=circleSamples()
 const next=createViewPreservingArea(initial,to,map.getSize());map.setView(next);map.renderSync();const shift=circleShift(circle)
 if(!snapped(initial,next)&&shift.count>=24&&shift.strength>=.99&&Math.abs(shift.angle)>.005)errors.push(`wide ${from} → ${to} ${width}×${height} z${zoom} rotation ${rotation}: circle mean shifted ${shift.angle}`)
}
// Wrapped copies, antimeridian views, and high latitudes should remain stable.
for(const center of [[179,20],[-179,20],[0,80]])for(const from of codes)for(const to of codes){
 const initial=createMapView(from,center,7,.3,{exactRotation:true});map.setView(initial)
 if(initial.getProjection().canWrapX()){
  const extent=initial.getProjection().getExtent(),width=extent[2]-extent[0],point=initial.getCenter()
  initial.setCenter([point[0]+2*width,point[1]])
 }
 map.renderSync();const circle=circleSamples()
 const next=trySwitch(initial,to);if(!next)continue;map.setView(next);map.renderSync();const shift=circleShift(circle)
 if(!snapped(initial,next)&&shift.count>=24&&shift.strength>=.99&&Math.abs(shift.angle)>.005)errors.push(`wrapped/cut ${from} → ${to} at ${center}: circle mean shifted ${shift.angle}`)
 if(!Number.isFinite(next.getRotation()))errors.push(`invalid rotation ${from} → ${to} at ${center}`)
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
 if(!Number.isFinite(relative)||(relative>.05&&!constrained(next)&&!snapped(initial,next)))errors.push(`wide viewport ${width}×${height} z${zoom} rotation ${rotation} → ${target}: area changed ${relative}`)
}
// Repeated switching should not accumulate a noticeable area drift.
el.style.width='800px';el.style.height='600px';map.updateSize()
let current=createMapView('EPSG:3857',[8.54,47.37],4);map.setView(current);map.renderSync();let initialArea
for(let cycle=0;cycle<3;cycle++){
 for(const code of ['EPSG:3035','EPSG:PEIRCE','FROST:TRIPTYCHIAL','EPSG:3857']){current=createViewPreservingArea(current,code,map.getSize());map.setView(current);map.renderSync()}
 if(cycle===0)initialArea=viewportArea()
}
const drift=Math.abs(viewportArea()/initialArea-1)
if(!Number.isFinite(drift)||drift>.05)errors.push(`repeated switches drifted ${drift}`)
// Domain limits and cuts must degrade gracefully without invalid resolutions.
for(const center of [[0,89.99],[179,0],[-179,-80]])for(const to of codes){
 const initial=createMapView('FROST:TRIPTYCHIAL',center,8);map.setView(initial)
 const next=trySwitch(initial,to);if(!next)continue;map.setView(next)
 if(!Number.isFinite(next.getResolution())||next.getResolution()<=0||!next.getCenter().every(Number.isFinite))errors.push(`invalid view near ${center} → ${to}`)
}
// Switching is transactional: an invalid destination must leave the live view alone.
{
 const initial=createMapView('EPSG:3857',[150,-30],8,.3,{exactRotation:true});map.setView(initial)
 const before=initial.getCenter().slice(),snapshot=ProjectionViewport.fromMap(map)
 let rejected=false
 try{snapshot.switchTo('EPSG:3035')}catch(error){if(error instanceof ProjectionUnavailableError)rejected=true;else throw error}
 if(!rejected||map.getView()!==initial||initial.getCenter().some((v,i)=>v!==before[i]))errors.push('unavailable projection did not preserve the original view')
 if(snapshot.switchTo('EPSG:3857').view!==initial)errors.push('switching to the current projection changed the view')
}
// Blending must choose reliable rings smoothly and respect the ±π angle seam.
{
 const blend=blendCircleRotations
 if(angleDifference(blend([{angle:.8,quality:1},{angle:-.4,quality:1}],0),.8)>1e-10)errors.push('reliable outer ring did not take precedence')
 if(angleDifference(blend([{angle:.8,quality:0},{angle:-.4,quality:1}],0),-.4)>1e-10)errors.push('unreliable outer ring did not defer to the inner ring')
 if(angleDifference(blend([{angle:1,quality:.49}],0),blend([{angle:1,quality:.51}],0))>.03)errors.push('ring confidence transition was discontinuous')
 if(angleDifference(blend([{angle:-Math.PI+.1,quality:.5}],Math.PI-.1),Math.PI)>1e-10)errors.push('ring blend crossed the angle seam incorrectly')
 if(blend([null],.2)!==.2)errors.push('missing rings did not use the fallback')
}
map.setTarget(undefined)
document.querySelector('#results').textContent=errors.length?errors.join('\n'):'Passed projection area, center, rotation, and edge-case checks'
if(errors.length)throw Error(errors.join('\n'))
