import '../src/map/projections/index.js?v=grieger-wrap'
import Map from 'ol/Map.js'
import {createMapView} from '../src/map/projections/view.js?v=viewport-model'
import {readState} from '../src/map/state/url.js?v=fill-viewport'
const element=document.querySelector('#map'),map=new Map({target:element,layers:[],controls:[],view:createMapView('EPSG:3857',[10,50],4)})
const errors=[]
for(const [width,height] of [[390,664],[1000,400],[768,100],[256,256]])for(const code of ['EPSG:3857','EPSG:3035','EPSG:PEIRCE','FROST:TRIPTYCHIAL'])for(const rotation of [0,Math.PI/4]){
 element.style.width=`${width}px`;element.style.height=`${height}px`;map.updateSize()
 const view=createMapView(code,[10,50],4,rotation);map.setView(view);view.setZoom(-10);view.resolveConstraints(0)
 const projectionExtent=view.getProjection().getExtent(),visible=view.calculateExtent(map.getSize()),worldHeight=projectionExtent[3]-projectionExtent[1],tolerance=worldHeight*1e-8
 if(visible[1]<projectionExtent[1]-tolerance||visible[3]>projectionExtent[3]+tolerance)errors.push(`${code} ${width}×${height} rotation ${rotation}: blank vertical space ${visible}`)
 const worldWidth=projectionExtent[2]-projectionExtent[0],wrapped=view.getProjection().canWrapX()
 if(!wrapped&&(visible[0]<projectionExtent[0]-tolerance||visible[2]>projectionExtent[2]+tolerance))errors.push(`${code} ${width}×${height}: blank horizontal space`)
 const xGap=Math.abs((visible[2]-visible[0])-worldWidth),yGap=Math.abs((visible[3]-visible[1])-worldHeight)
 if((wrapped?yGap:Math.min(xGap,yGap))>tolerance)errors.push(`${code} ${width}×${height} rotation ${rotation}: zoomed out too little`)
 if(wrapped&&rotation===0&&width/height>worldWidth/worldHeight&&visible[2]-visible[0]<=worldWidth)errors.push(`${code} ${width}×${height}: world copies not visible`)
 const center=view.getCenter();view.setCenter([center[0]+2*worldWidth,center[1]]);view.resolveConstraints(0)
 if(wrapped&&Math.abs(view.getCenter()[0]-(center[0]+2*worldWidth))>tolerance)errors.push(`${code}: horizontal pan is constrained`)
 if(!wrapped&&view.getCenter()[0]>projectionExtent[2]+tolerance)errors.push(`${code}: center escaped horizontal domain`)
}
// Resizing an already zoomed-out view must reapply the vertical constraint.
for(const code of ['EPSG:3857','EPSG:3035','EPSG:PEIRCE','FROST:TRIPTYCHIAL']){
 element.style.width='1000px';element.style.height='400px';map.updateSize()
 const view=createMapView(code,[0,0],4);map.setView(view);view.setZoom(-10);view.resolveConstraints(0)
 element.style.width='400px';element.style.height='1000px';map.updateSize()
 const world=view.getProjection().getExtent(),visible=view.calculateExtent(map.getSize()),tolerance=(world[3]-world[1])*1e-8
 if(visible[1]<world[1]-tolerance||visible[3]>world[3]+tolerance)errors.push(`${code}: resize exposed blank vertical space`)
 if(!view.getProjection().canWrapX()&&(visible[0]<world[0]-tolerance||visible[2]>world[2]+tolerance))errors.push(`${code}: resize exposed blank horizontal space`)
 if(Math.abs(createMapView(code,[0,0],4).getZoom()-4)>1e-8)errors.push(`${code}: zoom numbering changed`)
}
history.replaceState(null,'','?loc=@0,0,-1.50z')
if(readState()?.zoom!==-1.5)errors.push('negative zoom URL did not round-trip')
map.setTarget(undefined)
document.querySelector('#results').textContent=errors.length?errors.join('\n'):'Passed portrait, wide, small, rotated, and horizontal-wrap view checks'
if(errors.length)throw Error(errors.join('\n'))
