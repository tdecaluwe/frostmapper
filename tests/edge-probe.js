import '../src/map/projections/index.js?v=grieger-wrap'
import XYZ from 'ol/source/XYZ.js'
import {get} from 'ol/proj.js'
import {DistortionField} from '../src/map/reprojection/distortion.js'
import {ContourReprojection} from '../src/map/reprojection/contour-reprojection.js?v=worker-plans-r4'

const p=get('FROST:TRIPTYCHIAL'),src=get('EPSG:3857'),field=new DistortionField(p,src),result={},errors=[]
const map={on(){},getView(){return {getProjection:()=>p}},getSize(){return [800,600]}}
const source=new XYZ({projection:'EPSG:3857'}),manager=new ContourReprojection(map),data=await(await fetch('./fixtures/contours/source-frost-triptychial.json')).json()
const sourceGrid=source.getTileGridForProjection(src)
manager.sourceAtlases.set(p.getCode(),true);manager.planWorker.register(`${p.getCode()}:source`,data)
const bandAt=(spans,x,y)=>{
 if(ArrayBuffer.isView(spans)){for(let i=0;i<spans.length;i+=4)if(spans[i+1]===y&&spans[i]<=x&&spans[i]+spans[i+2]>x)return spans[i+3];return null}
 return spans.find(span=>span.y===y&&span.x<=x&&span.x+span.width>x)?.band??null
}
let checked=0,wrong=0,unavailable=0;const examples=[]
for(const [z,x,y] of [[7,31,63],[7,32,63],[7,31,64],[7,32,64],[8,63,127],[8,64,127],[8,63,128],[8,64,128]]){
 const coord=[z,x,y],extent=sourceGrid.getTileCoordExtent(coord),width=256,height=256,key=`edge/${z}/${x}/${y}`
 const pending=manager.sourcePlan(source,p.getCode(),key,extent,width,height,-80,field)
 if(pending.ready)errors.push(`z${z}/${x}/${y} did not queue its worker plan`)
 await manager.planWorker.whenIdle()
 const planned=manager.planWorker.peek(`${p.getCode()}:source`,key)
 if(!planned?.ready||!planned.spans){unavailable++;continue}
 for(let py=7;py<height;py+=16)for(let px=7;px<width;px+=16){
  const q=field.atSource([extent[0]+(extent[2]-extent[0])*(px+.5)/width,extent[3]-(extent[3]-extent[1])*(py+.5)/height])
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
