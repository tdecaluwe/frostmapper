import '../src/map/projections/index.js?v=grieger-wrap'
import {get,transform} from 'ol/proj.js'
import {distortionAt,projectionDistortion} from '../src/map/reprojection/distortion.js'
const errors=[]
function check(condition,message){if(!condition)errors.push(message)}
const sample=([x,y])=>x>=0&&x<=10&&y>=0&&y<=10?[2*x,3*y]:null
for(const point of [[5,5],[0,5],[10,5],[5,0],[5,10],[0,0],[10,10]]){
 const scale=distortionAt(point,{sample,step:.01})
 check(scale!==null&&Math.abs(scale-Math.log2(6)/2)<1e-8,`incorrect derivative at ${point}: ${scale}`)
}
check(distortionAt([-1,1],{sample,step:.01})===null,'outside domain must be invalid')
{
 const sample=([x,y])=>x>=0&&y>=0?[x+x*x,y+y*y]:null
 const scale=distortionAt([0,0],{sample,step:.01})
 check(scale!==null&&Math.abs(scale)<1e-8,'second order inward derivative at boundary')
}
{
 const sample=([x,y])=>[((x%360)+360)%360,y]
 const scale=distortionAt([359.99,0],{sample,step:.1,sourceWorldWidth:360})
 check(scale!==null&&Math.abs(scale)<1e-9,'wrapped source seam should not create false distortion')
}
{
 const target=get('FROST:TRIPTYCHIAL'),source=get('EPSG:3857'),extent=target.getExtent(),x=-22573619.339498337
 const edge=projectionDistortion(target,source,[x,extent[1]]),near=projectionDistortion(target,source,[x,extent[1]+1670])
 check(edge!==null&&near!==null&&Math.abs(edge-near)<.001,`Grieger lower edge produced false distortion ${edge}, ${near}`)
 check(projectionDistortion(target,source,[x,extent[1]-1])===null,'point beyond target edge was sampled')
 const polar=transform([0,89.99],'EPSG:4326',target)
 check(projectionDistortion(target,source,polar)===null,'imagery outside Mercator coverage was included')
}
document.querySelector('#results').textContent=errors.length?errors.join('\n'):'Passed boundary, seam, and source-coverage distortion checks'
if(errors.length)throw Error(errors.join('\n'))
