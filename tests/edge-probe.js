import '../src/map/projections/index.js?v=grieger-wrap'
import XYZ from 'ol/source/XYZ.js'
import {get} from 'ol/proj.js'
import {getForProjection} from 'ol/tilegrid.js'
import {DistortionField} from '../src/map/reprojection/distortion.js'
import {ContourAtlas} from '../src/map/reprojection/contour-atlas.js'
import {ContourReprojection} from '../src/map/reprojection/contour-reprojection.js?v=worker-plans-r4'

const p=get('FROST:TRIPTYCHIAL'),src=get('EPSG:3857'),field=new DistortionField(p,src),result={},errors=[]
const map={on(){},getView(){return {getProjection:()=>p}},getSize(){return [800,600]}}
const source=new XYZ({projection:'EPSG:3857'}),manager=new ContourReprojection(map),data=await(await fetch('./fixtures/contours/frost-triptychial.json')).json()
const atlas=new ContourAtlas(data),grid=source.getTileGridForProjection(p),sourceGrid=source.getTileGridForProjection(src)
manager.atlases.set(p.getCode(),atlas);manager.planWorker.register(`${p.getCode()}:target`,data)
const bandAt=(spans,x,y)=>{
 if(ArrayBuffer.isView(spans)){for(let i=0;i<spans.length;i+=4)if(spans[i+1]===y&&spans[i]<=x&&spans[i]+spans[i+2]>x)return spans[i+3];return null}
 return spans.find(span=>span.y===y&&span.x<=x&&span.x+span.width>x)?.band??null
}
let checked=0,wrong=0,unavailable=0;const examples=[]
for(const [z,x,y] of [[7,31,0],[7,32,0],[7,31,63],[7,33,63],[7,95,0],[8,63,0],[8,64,127]]){
 const coord=[z,x,y],extent=grid.getTileCoordExtent(coord),size=grid.getTileSize(z),width=typeof size==='number'?size:size[0],height=typeof size==='number'?size:size[1]
 const pending=manager.targetPlan(source,p.getCode(),z,coord,extent,width,height,field)
 if(pending.ready)errors.push(`z${z}/${x}/${y} did not queue its worker plan`)
 await manager.planWorker.whenIdle()
 const reference=Math.round(Math.log2(sourceGrid.getResolution(0)/grid.getResolution(z))),minimumQuarter=4*(reference-sourceGrid.getMaxZoom()),key=`${z}/${x}/${y}/${width}/${height}/q${minimumQuarter}`,planned=manager.planWorker.peek(`${p.getCode()}:target`,key)
 if(!planned?.ready||!planned.spans){unavailable++;continue}
 for(let py=7;py<height;py+=16)for(let px=7;px<width;px+=16){
  const q=field.at([extent[0]+(extent[2]-extent[0])*(px+.5)/width,extent[3]-(extent[3]-extent[1])*(py+.5)/height])
  if(q===null||Math.abs(q-Math.round(q))<.15)continue
  const actual=bandAt(planned.spans,px,py)
  const point=[extent[0]+(extent[2]-extent[0])*(px+.5)/width,extent[3]-(extent[3]-extent[1])*(py+.5)/height]
  if(actual===null){wrong++;if(examples.length<12)examples.push({tile:`${z}/${x}/${y}`,pixel:[px,py],coord:point.map(v=>+v.toFixed(0)),q:+q.toFixed(3),actual:null});continue}
  checked++;if(actual!==Math.floor(q)){wrong++;if(examples.length<12)examples.push({tile:`${z}/${x}/${y}`,pixel:[px,py],coord:point.map(v=>+v.toFixed(0)),q:+q.toFixed(3),actual})}
 }
 result[`${z}/${x}/${y}`]={spans:ArrayBuffer.isView(planned.spans)?planned.spans.length/4:planned.spans.length}
}
if(unavailable)errors.push(`${unavailable} edge tiles had no completed contour plan`)
if(checked<1000||wrong)errors.push(`worker-planned edge masks: ${wrong}/${checked} incorrect`)
result.accuracy={checked,wrong,unavailable}
result.examples=examples
document.querySelector('#results').textContent=(errors.length?'Failed':'Passed')+' Grieger worker contour checks\n'+JSON.stringify(result,null,2)
if(errors.length)throw Error(errors.join('\n'))
