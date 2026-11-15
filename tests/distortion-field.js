import '../src/map/projections/index.js?v=grieger-wrap'
import {get} from 'ol/proj.js'
import {projectionDistortion} from '../src/map/reprojection/distortion.js'
import {traceContours} from '../src/map/reprojection/contour-trace.js'
import {fitContour} from '../src/map/reprojection/curve-fit.js'

const source=get('EPSG:3857'),errors=[],results=[]
// This is a representative sampling check, not a proof between samples.
for(const code of ['EPSG:3035','EPSG:PEIRCE','FROST:TRIPTYCHIAL']){
 const projection=get(code),[x0,y0,x1,y1]=projection.getExtent(),width=257,height=129
 const dx=(x1-x0)/(width-1),dy=(y1-y0)/(height-1),values=new Float64Array(width*height)
 const sample=(x,y)=>projectionDistortion(projection,source,[x0+x*dx,y0+y*dy])??NaN
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)values[y*width+x]=sample(x,y)
 let maxError=0,checks=0,segments=0
 for(let level=-32;level<=32;level++)for(const path of traceContours(values,width,height,level/4)){
  if(path.points.length<2)continue
  for(const curve of fitContour(path.points,.2)){
   segments++
   for(const t of [.25,.5,.75]){
    const u=1-t,x=u**3*curve[0][0]+3*u*u*t*curve[1][0]+3*u*t*t*curve[2][0]+t**3*curve[3][0]
    const y=u**3*curve[0][1]+3*u*u*t*curve[1][1]+3*u*t*t*curve[2][1]+t**3*curve[3][1]
    const actual=sample(x,y)
    if(Number.isFinite(actual)){checks++;maxError=Math.max(maxError,Math.abs(actual-level/4))}
   }
  }
 }
 if(checks<30||maxError>.125)errors.push(`${code}: ${checks} checks, max error ${maxError}`)
 results.push(`${code}: ${segments} curves, ${checks} checks, max error ${maxError.toFixed(4)} zoom steps`)
}
document.querySelector('#results').textContent=errors.length?errors.join('\n'):`Passed sampled field checks\n${results.join('\n')}`
if(errors.length)throw Error(errors.join('\n'))
