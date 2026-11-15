import '../src/map/projections/index.js?v=grieger-wrap'
import {CanonicalZoom} from '../src/map/projections/canonical-zoom.js'
import {ProjectionViewport} from '../src/map/projections/viewport.js'
const errors=[],size=[800,600],codes=['EPSG:3857','EPSG:3035','EPSG:PEIRCE','FROST:TRIPTYCHIAL']
for(const zoom of [6,8,12])for(const code of codes){
 const view=CanonicalZoom.createView(code,[8.54,47.37],zoom,.2,size),actual=CanonicalZoom.fromView(view,size)
 if(!Number.isFinite(actual)||Math.abs(actual-zoom)>.04)errors.push(`${code} zoom ${zoom} restored as ${actual}`)
 const initial=CanonicalZoom.createView('EPSG:3857',[8.54,47.37],zoom,.2,size)
 const switched=new ProjectionViewport(initial,size).switchTo(code).view,next=CanonicalZoom.fromView(switched,size)
 if(!Number.isFinite(next)||Math.abs(next-zoom)>.04)errors.push(`${code} zoom ${zoom} switched as ${next}`)
}
{
 const view=CanonicalZoom.createView('FROST:TRIPTYCHIAL',[0,89.99],8,0,size),zoom=CanonicalZoom.fromView(view,size)
 if(!Number.isFinite(zoom))errors.push('polar canonical zoom was not finite')
}
document.querySelector('#results').textContent=errors.length?errors.join('\n'):'Passed canonical zoom restore and projection-switch checks'
if(errors.length)throw Error(errors.join('\n'))
