import {bezier} from './bounded-contours.js'

// Fit runs of existing cubics. Endpoints and endpoint tangent directions are
// fixed, so topology, winding and geometric tangent continuity are retained.
// The curve parameter speed can change at joins (G1 rather than uniform-t C1).
export function compressContourAtlas(atlas,{sample,tolerance=.01,geometryTolerance=.005,maxRun=64,checkOrientation=true}={}){
 if(typeof sample!=='function'||!(tolerance>0)||!(geometryTolerance>0)||!Number.isInteger(maxRun)||maxRun<2)throw Error('Invalid compression options')
 const extent=atlas.extent,evalField=p=>{
  let x=p[0];if(atlas.periodicX)x-=Math.floor(x)
  return sample([extent[0]+x*(extent[2]-extent[0]),extent[1]+p[1]*(extent[3]-extent[1])])
 }
 let evaluations=0,attempts=0
 const paths=atlas.paths.map(path=>{
  const input=path.curves,curves=[],orientations=[]
  function emit(first,last){
   if(last-first===1){curves.push(input[first]);orientations.push(path.orientations?.[first]??false);return}
   if(last-first>maxRun){const mid=(first+last)>>1;emit(first,mid);emit(mid,last);return}
   attempts++
   const candidate=fit(input,first,last,geometryTolerance)
   let valid=!!candidate
   // Independent of fitting samples. Include near-end probes to detect
   // overshoots that a midpoint-only residual check would miss.
   if(valid)for(let j=1;j<32;j++){
    const v=evalField(bezier(candidate,j/32));evaluations++
    if(!Number.isFinite(v)||Math.abs(v-path.step/atlas.steps)>tolerance){valid=false;break}
   }
   const oriented=path.orientations?.slice(first,last).every(Boolean)??false
   if(valid&&oriented&&checkOrientation){
    // Compression preserves travel direction; additionally reject a merge
    // whose interior normal would put higher field values on the right.
    for(const t of [.25,.5,.75]){
     const p=bezier(candidate,t),v=1-t,dx=3*(v*v*(candidate[2]-candidate[0])+2*v*t*(candidate[4]-candidate[2])+t*t*(candidate[6]-candidate[4])),dy=3*(v*v*(candidate[3]-candidate[1])+2*v*t*(candidate[5]-candidate[3])+t*t*(candidate[7]-candidate[5])),n=Math.hypot(dx,dy)
     if(!n)continue
     const eps=Math.max(Number.EPSILON*2,Math.min(n*.001,1e-6)),l=evalField([p[0]-dy/n*eps,p[1]+dx/n*eps]),r=evalField([p[0]+dy/n*eps,p[1]-dx/n*eps]);evaluations+=2
     if(Number.isFinite(l)&&Number.isFinite(r)&&l<r-1e-9){valid=false;break}
    }
   }
   if(valid&&oriented){curves.push(candidate);orientations.push(true)}
   else{const mid=(first+last)>>1;emit(first,mid);emit(mid,last)}
  }
  emit(0,input.length)
  return {...path,orientation:orientations.every(Boolean)?'high-left':undefined,curves,orientations}
 })
 return {atlas:{...atlas,paths,compression:{tolerance,geometryTolerance,continuity:'G1',certified:false}},stats:{attempts,evaluations}}
}
function fit(input,first,last,tolerance){
 const start=input[first],end=input[last-1],a=start.slice(0,2),b=end.slice(6),dx=start[2]-a[0],dy=start[3]-a[1],ex=b[0]-end[4],ey=b[1]-end[5],n=Math.hypot(dx,dy),m=Math.hypot(ex,ey)
 if(!n||!m)return null
 const u=[dx/n,dy/n],v=[ex/m,ey/m],points=[a],dist=[0]
 for(let i=first;i<last;i++)for(const t of [.25,.5,.75,1]){
  const p=bezier(input[i],t),prev=points.at(-1);dist.push(dist.at(-1)+Math.hypot(p[0]-prev[0],p[1]-prev[1]));points.push(p)
 }
 const length=dist.at(-1)
 if(!length)return null
 let aa=0,ab=0,bb=0,ar=0,br=0
 for(let i=1;i<points.length-1;i++){
  const t=dist[i]/length,s=1-t,B=3*s*s*t,C=3*s*t*t
  const rx=points[i][0]-(1-3*t*t+2*t*t*t)*a[0]-(3*t*t-2*t*t*t)*b[0],ry=points[i][1]-(1-3*t*t+2*t*t*t)*a[1]-(3*t*t-2*t*t*t)*b[1]
  aa+=B*B;ab-=B*C*(u[0]*v[0]+u[1]*v[1]);bb+=C*C;ar+=B*(u[0]*rx+u[1]*ry);br-=C*(v[0]*rx+v[1]*ry)
 }
 const det=aa*bb-ab*ab
 if(!(det>1e-20))return null
 const h=(ar*bb-br*ab)/det,k=(br*aa-ar*ab)/det
 if(!(h>0&&k>0&&h<length&&k<length))return null
 const curve=[...a,a[0]+u[0]*h,a[1]+u[1]*h,b[0]-v[0]*k,b[1]-v[1]*k,...b]
 const aligned=(x,y,tx,ty)=>{const n=Math.hypot(x,y);return n>0&&(x*tx+y*ty)/n>=1-1e-8}
 if(!aligned(curve[2]-a[0],curve[3]-a[1],...u)||!aligned(b[0]-curve[4],b[1]-curve[5],...v))return null
 for(let i=1;i<points.length-1;i++){
  const p=bezier(curve,dist[i]/length)
  if(Math.hypot(p[0]-points[i][0],p[1]-points[i][1])>length*tolerance)return null
 }
 return curve
}
