// Projection-only local area scale. Coordinates and periodicity are supplied
// by the caller. Shrink curved / invalid stencils without masking any region.
export function finiteDifferenceScale(point,{sample,step=100,worldWidth=0,maxRefinements=12,curvatureTolerance=.02}={}){
 if(!point?.every(Number.isFinite)||typeof sample!=='function'||!Number.isFinite(step)||step<=0||!Number.isInteger(maxRefinements)||maxRefinements<0||maxRefinements>24||!Number.isFinite(curvatureTolerance)||curvatureTolerance<=0||!Number.isFinite(worldWidth)||worldWidth<0)return null
 const safe=p=>{try{const q=sample(p);return q?.every(Number.isFinite)?q:null}catch{return null}}
 const center=safe(point)
 if(!center)return null
 const unwrap=q=>{if(!q)return null;const p=q.slice();if(worldWidth>0)p[0]-=Math.round((p[0]-center[0])/worldWidth)*worldWidth;return p}
 // The last finite estimate is a best-effort value at an unresolved
 // singularity, not an error certificate. Curve validation remains mandatory.
 let h=step,last=null
 for(let round=0;round<=maxRefinements;round++){
  const p=[]
  for(let axis=0;axis<2;axis++)for(const sign of [-1,1]){const q=point.slice();q[axis]+=sign*h;p.push(unwrap(safe(q)))}
  let curvature=Infinity
  if(p.every(Boolean)){
   const [a,b,c,d]=p
   curvature=Math.max(Math.hypot(a[0]+b[0]-2*center[0],a[1]+b[1]-2*center[1])/(Math.hypot(b[0]-a[0],b[1]-a[1])||Number.MIN_VALUE),Math.hypot(c[0]+d[0]-2*center[0],c[1]+d[1]-2*center[1])/(Math.hypot(d[0]-c[0],d[1]-c[1])||Number.MIN_VALUE))
   {
    const det=Math.abs(((b[0]-a[0])/(2*h))*((d[1]-c[1])/(2*h))-((b[1]-a[1])/(2*h))*((d[0]-c[0])/(2*h)))
    last=det>1e-16&&Number.isFinite(det)?Math.log2(det)/2:null
    if(curvature<=curvatureTolerance)return last
   }
  }
  // At a projection fold a centered stencil can straddle two sheets even
  // as h tends to zero. Try consistent one-sided quadrants and reject those
  // whose mixed difference exposes a crease. This is generic domain handling.
  if(curvature>curvatureTolerance){
   const second=[]
   for(let axis=0;axis<2;axis++)for(const sign of [-1,1]){const q=point.slice();q[axis]+=sign*2*h;second.push(unwrap(safe(q)))}
   let best=null,bestCurvature=Infinity
   for(let ix=0;ix<2;ix++)for(let iy=0;iy<2;iy++){
    const a=p[ix],b=p[2+iy],aa=second[ix],bb=second[2+iy]
    if(!a||!b||!aa||!bb)continue
    const q=[point[0]+(ix?1:-1)*h,point[1]+(iy?1:-1)*h],corner=unwrap(safe(q))
    if(!corner)continue
    const dx=[a[0]-center[0],a[1]-center[1]],dy=[b[0]-center[0],b[1]-center[1]],nx=Math.hypot(...dx),ny=Math.hypot(...dy)
    const bend=Math.max(Math.hypot(aa[0]-2*a[0]+center[0],aa[1]-2*a[1]+center[1])/(nx||Number.MIN_VALUE),Math.hypot(bb[0]-2*b[0]+center[0],bb[1]-2*b[1]+center[1])/(ny||Number.MIN_VALUE),Math.hypot(corner[0]-a[0]-b[0]+center[0],corner[1]-a[1]-b[1]+center[1])/(Math.min(nx,ny)||Number.MIN_VALUE))
    if(bend<bestCurvature){
     const ux=(-3*center[0]+4*a[0]-aa[0])/(2*h),uy=(-3*center[1]+4*a[1]-aa[1])/(2*h),vx=(-3*center[0]+4*b[0]-bb[0])/(2*h),vy=(-3*center[1]+4*b[1]-bb[1])/(2*h),det=Math.abs(ux*vy-uy*vx)
     if(det>1e-16&&Number.isFinite(det)){best=Math.log2(det)/2;bestCurvature=bend}
    }
   }
   if(best!==null&&bestCurvature<=curvatureTolerance)return best
  }
  const next=h*(Number.isFinite(curvature)?Math.max(.05,Math.min(.5,curvatureTolerance/curvature)):.125)
  if(next<=16*Number.EPSILON*Math.max(1,...point.map(Math.abs)))return last
  h=next
 }
 return last
}
