// Fit cubic Bézier segments to a sampled contour. The tolerance is in the
// same units as the input coordinates. Endpoints are kept exactly shared.
export function fitContour(points,tolerance){
 if(!Number.isFinite(tolerance)||tolerance<=0||points.length<2||points.some(p=>p.length!==2||!p.every(Number.isFinite)))throw Error('Invalid contour')
 const result=[],distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])
 const norm=v=>{const length=Math.hypot(...v);return length?[v[0]/length,v[1]/length]:[0,0]}
 function fit(first,last,depth){
  const p0=points[first],p3=points[last],length=distance(p0,p3),count=last-first
  if(count===1){result.push([p0,[p0[0]+(p3[0]-p0[0])/3,p0[1]+(p3[1]-p0[1])/3],[p0[0]+2*(p3[0]-p0[0])/3,p0[1]+2*(p3[1]-p0[1])/3],p3]);return}
  // Closed sections and repeated endpoints must be split before fitting.
  if(length===0){const mid=first+Math.floor(count/2);fit(first,mid,depth+1);fit(mid,last,depth+1);return}
  const t0=norm([points[first+1][0]-p0[0],points[first+1][1]-p0[1]])
  const t1=norm([points[last-1][0]-p3[0],points[last-1][1]-p3[1]])
  const cumulative=[0];for(let i=first+1;i<=last;i++)cumulative.push(cumulative.at(-1)+distance(points[i-1],points[i]))
  const total=cumulative.at(-1);let c00=0,c01=0,c11=0,x0=0,x1=0
  for(let i=1;i<count;i++){
   const t=cumulative[i]/total,u=1-t,b0=u*u*u,b1=3*u*u*t,b2=3*u*t*t,b3=t*t*t
   const a0=[t0[0]*b1,t0[1]*b1],a1=[t1[0]*b2,t1[1]*b2]
   const residual=[points[first+i][0]-(b0+b1)*p0[0]-(b2+b3)*p3[0],points[first+i][1]-(b0+b1)*p0[1]-(b2+b3)*p3[1]]
   c00+=a0[0]*a0[0]+a0[1]*a0[1];c01+=a0[0]*a1[0]+a0[1]*a1[1];c11+=a1[0]*a1[0]+a1[1]*a1[1]
   x0+=a0[0]*residual[0]+a0[1]*residual[1];x1+=a1[0]*residual[0]+a1[1]*residual[1]
  }
  const det=c00*c11-c01*c01
  let alpha0=det?(x0*c11-x1*c01)/det:0,alpha1=det?(x1*c00-x0*c01)/det:0
  if(alpha0<=0||alpha1<=0||alpha0>total*2||alpha1>total*2)alpha0=alpha1=length/3
  const p1=[p0[0]+t0[0]*alpha0,p0[1]+t0[1]*alpha0],p2=[p3[0]+t1[0]*alpha1,p3[1]+t1[1]*alpha1]
  let max=0,split=first+Math.floor(count/2)
  for(let i=1;i<count;i++){
   const t=cumulative[i]/total,u=1-t,b0=u*u*u,b1=3*u*u*t,b2=3*u*t*t,b3=t*t*t
   const point=[b0*p0[0]+b1*p1[0]+b2*p2[0]+b3*p3[0],b0*p0[1]+b1*p1[1]+b2*p2[1]+b3*p3[1]]
   const error=distance(point,points[first+i]);if(error>max){max=error;split=first+i}
  }
  if(max<=tolerance){result.push([p0,p1,p2,p3]);return}
  fit(first,split,depth+1);fit(split,last,depth+1)
 }
 fit(0,points.length-1,0)
 return result
}
