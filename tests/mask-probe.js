import '../src/map/projections/index.js?v=grieger-wrap'
import {get} from 'ol/proj.js'
import XYZ from 'ol/source/XYZ.js'
import {ContourReprojection} from '../src/map/reprojection/contour-reprojection.js?v=worker-plans-r4'

const source=new XYZ({projection:'EPSG:3857'}),sourceProjection=get('EPSG:3857'),result={},errors=[]
let activeProjection=sourceProjection
const manager=new ContourReprojection({on(){},getView(){return {getProjection:()=>activeProjection}},getSize(){return [0,0]}})
for(const [code,file] of [['EPSG:3035','epsg-3035'],['EPSG:PEIRCE','epsg-peirce'],['FROST:TRIPTYCHIAL','frost-triptychial']]){
 activeProjection=get(code)
 const data=await(await fetch(`./fixtures/contours/${file}.json`)).json(),targetGrid=source.getTileGridForProjection(activeProjection),field=manager.field(activeProjection,sourceProjection),z=3,range=targetGrid.getTileRangeForExtentAndZ(activeProjection.getExtent(),z),pending=[]
 manager.planWorker.register(`${code}:target`,data)
 for(let y=range.minY;y<=range.maxY;y++)for(let x=range.minX;x<=range.maxX;x++){
  const coord=[z,x,y],extent=targetGrid.getTileCoordExtent(coord),size=targetGrid.getTileSize(z),width=typeof size==='number'?size:size[0],height=typeof size==='number'?size:size[1]
  manager.targetPlan(source,code,z,coord,extent,width,height,field)
  pending.push({coord,extent,width,height})
 }
 await manager.planWorker.whenIdle()
 let unavailable=0
 for(const {coord,width,height} of pending){
  const reference=Math.round(Math.log2(source.getTileGridForProjection(sourceProjection).getResolution(0)/targetGrid.getResolution(z))),minimumQuarter=4*(reference-source.getTileGridForProjection(sourceProjection).getMaxZoom()),key=`${z}/${coord[1]}/${coord[2]}/${width}/${height}/q${minimumQuarter}`,plan=manager.planWorker.peek(`${code}:target`,key)
  if(!plan?.ready||!plan.spans)unavailable++
 }
 result[code]={tiles:pending.length,unavailable}
}
if(Object.values(result).some(stats=>stats.tiles===0||stats.unavailable))errors.push('worker contour plans were unavailable')
manager.planWorker.worker?.terminate()
document.querySelector('#results').textContent=(errors.length?'Failed':'Passed')+' worker contour availability checks\n'+JSON.stringify(result,null,2)
if(errors.length)throw Error(errors.join('\n'))
