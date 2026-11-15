import {traceContours} from '../src/map/reprojection/contour-trace.js'
import {fitContour} from '../src/map/reprojection/curve-fit.js'
const errors=[]
const check=(condition,message)=>{if(!condition)errors.push(message)}
{
 const values=Float64Array.from({length:25},(_,i)=>i%5)
 const paths=traceContours(values,5,5,1.5)
 check(paths.length===1&&!paths[0].closed&&paths[0].points.length===5,'straight contour should cross the grid once')
 check(paths[0].points.every(p=>p[0]===1.5),'straight contour interpolation')
}
{
 const values=Float64Array.from({length:25},(_,i)=>1-Math.hypot(i%5-2,Math.floor(i/5)-2))
 const paths=traceContours(values,5,5,.5)
 check(paths.length===1&&paths[0].closed,'isolated peak should produce a closed contour')
 check(paths[0].points[0].every((v,i)=>v===paths[0].points.at(-1)[i]),'closed contour endpoints')
}
{
 const values=Float64Array.from([1,-1,1,-1,NaN,-1,1,-1,1])
 check(traceContours(values,3,3,0).length===0,'invalid samples must not be bridged')
}
{
 const paths=traceContours(Float64Array.from([2,-1,-1,2]),2,2,0)
 check(paths.length===2&&paths.every(p=>p.points.length===2),'saddle should produce two separate contours')
}
{
 const points=Array.from({length:51},(_,i)=>[i,i*2])
 const curves=fitContour(points,.01)
 check(curves.length===1,'a straight contour should fit in one Bézier')
 check(curves[0][0]===points[0]&&curves[0][3]===points.at(-1),'curve endpoints should be exact')
}
{
 const points=Array.from({length:101},(_,i)=>[i/10,Math.sin(i/10)])
 const curves=fitContour(points,.02)
 check(curves.length>1&&curves.length<points.length/2,'a curved contour should use multiple compact segments')
 check(curves.every((curve,i)=>!i||curve[0]===curves[i-1][3]),'curve segments must share endpoints exactly')
}
{
 const points=[[0,0],[1,0],[1,1],[0,1],[0,0]]
 const curves=fitContour(points,.01)
 check(curves.length>=2&&curves[0][0]===points[0]&&curves.at(-1)[3]===points.at(-1),'closed contour fitting')
}
document.querySelector('#results').textContent=errors.length?errors.join('\n'):'Passed contour tracing checks'
if(errors.length)throw Error(errors.join('\n'))
