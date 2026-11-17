import {polishContour} from './bounded-contours.js'

// Experimental, mesh-free curve correction for an existing atlas. This can
// refine cached topology cheaply, but CANNOT discover a missing component.
// Intentionally retained as a different Pareto candidate, not the default.
export function refineContourAtlas(seed,{sample,maxVertices=16384}={}){
 if(typeof sample!=='function'||!seed?.extent||!seed?.steps||!Array.isArray(seed.paths))throw Error('Invalid continuation seed')
 const e=seed.extent,steps=seed.steps
 const value=(x,y)=>{
  if(seed.periodicX)x-=Math.floor(x)
  const v=sample([e[0]+x*(e[2]-e[0]),e[1]+y*(e[3]-e[1])]);return Number.isFinite(v)?v:NaN
 }
 const paths=seed.paths.map(path=>{
  const points=path.curves.map(c=>c.slice(0,2));points.push(path.curves.at(-1).slice(6))
  if(points.length>maxVertices)throw Error('Continuation path exceeds vertex budget')
  // Correct existing knots as well as newly inserted curve samples. Keep
  // boundary endpoints fixed, so continuation cannot invent a new domain.
  for(let i=path.closed?0:1;i<points.length-1;i++){
   const p=points[i],q=points[(i+1)%(points.length-1)],h=Math.max(Math.hypot(p[0]-q[0],p[1]-q[1])*.01,Number.EPSILON*2)
   for(let j=0;j<12;j++){
    const v=value(...p),error=v-path.step/steps
    if(!Number.isFinite(error)||Math.abs(error)<.002/steps)break
    const gx=(value(p[0]+h,p[1])-value(p[0]-h,p[1]))/(2*h),gy=(value(p[0],p[1]+h)-value(p[0],p[1]-h))/(2*h),norm=gx*gx+gy*gy
    if(!Number.isFinite(norm)||norm<=0)break
    const dx=error*gx/norm,dy=error*gy/norm
    if(Math.hypot(dx,dy)>h*50)break
    p[0]-=dx;p[1]-=dy
   }
  }
  if(path.closed){const old=path.curves.at(-1),dx=Math.round(old[6]-path.curves[0][0]);points[points.length-1]=[points[0][0]+dx,points[0][1]]}
  const curves=polishContour(points,path.closed,path.step/steps,{sample:value,steps,maxVertices,tolerance:seed.quality?.requestedTolerance??.01})
  // Newton does not change the direction of a component.
  return {...path,curves,orientations:curves.map(()=>path.orientations?.every(Boolean)??false)}
 })
 return {...seed,paths,quality:{certified:false,discovery:'seed-topology-only'}}
}
