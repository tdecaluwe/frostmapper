import '../src/map/projections/index.js?v=grieger-wrap'
import {get,transform} from 'ol/proj.js'
import XYZ from 'ol/source/XYZ.js'
import {ContourReprojection} from '../src/map/reprojection/contour-reprojection.js?v=progressive-reproj-v1'

const source=new XYZ({projection:'EPSG:3857'}),sourceProjection=get('EPSG:3857'),result={},errors=[]
let activeProjection=sourceProjection
const manager=new ContourReprojection({on(){},getView(){return {getProjection:()=>activeProjection}},getSize(){return [0,0]}})
for(const [code,file,center] of [['EPSG:3035','epsg-3035',[10,50]],['EPSG:PEIRCE','epsg-peirce',[0,0]],['FROST:TRIPTYCHIAL','frost-triptychial',[-90,0]]]){
 activeProjection=get(code)
 const data=await(await fetch(`./fixtures/contours/source-${file}.json`)).json(),sourceGrid=source.getTileGridForProjection(sourceProjection),field=manager.field(activeProjection,sourceProjection),z=7,centerSource=transform(center,'EPSG:4326','EPSG:3857'),centerCoord=sourceGrid.getTileCoordForCoordAndZ(centerSource,z),pending=[]
 manager.sourceAtlases.set(code,true);manager.planWorker.register(`${code}:source`,data)
 for(let y=centerCoord[2]-1;y<=centerCoord[2]+1;y++)for(let x=centerCoord[1]-1;x<=centerCoord[1]+1;x++){
  const coord=[z,x,y],extent=sourceGrid.getTileCoordExtent(coord),key=`probe/${z}/${x}/${y}`
  manager.sourcePlan(source,code,key,extent,256,256,-80,field)
  pending.push({key,extent})
 }
 await manager.planWorker.whenIdle()
 let unavailable=0
 for(const {key} of pending){
  const plan=manager.planWorker.peek(`${code}:source`,key)
  if(!plan?.ready||!plan.spans)unavailable++
 }
 result[code]={tiles:pending.length,unavailable}
}
if(Object.values(result).some(stats=>stats.tiles===0||stats.unavailable))errors.push('worker contour plans were unavailable')
manager.planWorker.worker?.terminate()
document.querySelector('#results').textContent=(errors.length?'Failed':'Passed')+' worker contour availability checks\n'+JSON.stringify(result,null,2)
if(errors.length)throw Error(errors.join('\n'))
