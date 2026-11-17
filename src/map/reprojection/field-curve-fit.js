import {bezier,ContourBudgetError} from './bounded-contours.js'

// Fit implicit curves directly to a traced component. Each output span is
// accepted by the field, or subdivided. No dense cubic atlas is constructed.
export function fitFieldContour(input,closed,level,{sample,tolerance=.01,maxSegments=4096}={}){
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity
 for(const p of input){minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1])}
 const scale=Math.hypot(maxX-minX,maxY-minY),spacing=scale*.005,points=[input[0]]
 for(let i=1;i<input.length-1;i++)if(Math.hypot(input[i][0]-points.at(-1)[0],input[i][1]-points.at(-1)[1])>spacing)points.push(input[i])
 points.push(input.at(-1))
 const last=points.length-1,delta=[points[last][0]-points[0][0],points[last][1]-points[0][1]],tangents=[]
 const gradient=(p,h)=>[(sample(p[0]+h,p[1])-sample(p[0]-h,p[1]))/(2*h),(sample(p[0],p[1]+h)-sample(p[0],p[1]-h))/(2*h)]
 for(let i=0;i<=last;i++){
  const p=points[i],a=i?points[i-1]:closed?[points[last-1][0]-delta[0],points[last-1][1]-delta[1]]:p,b=i<last?points[i+1]:closed?[points[1][0]+delta[0],points[1][1]+delta[1]]:p
  let dx=b[0]-a[0],dy=b[1]-a[1]
  const g=gradient(p,Math.max(scale*.001,Number.EPSILON*4)),n=Math.hypot(...g)
  if(n>0&&Number.isFinite(n)){let x=-g[1]/n,y=g[0]/n;if(x*dx+y*dy<0){x=-x;y=-y}dx=x;dy=y}
  const length=Math.hypot(dx,dy);tangents.push(length?[dx/length,dy/length]:[0,0])
 }
 if(closed)tangents[last]=tangents[0]
 const result=[];let emitted=0
 function fit(first,end,depth=0){
  if(emitted>=maxSegments)throw new ContourBudgetError(`Implicit curve output budget exhausted at level ${level}; component extent ${maxX-minX} x ${maxY-minY} normalized (diagonal ${scale})`)
  const a=points[first],b=points[end],u=tangents[first],v=tangents[end],chord=Math.hypot(b[0]-a[0],b[1]-a[1]);let arc=0
  for(let i=first+1;i<=end;i++)arc+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1])
  if(end-first>32||arc>chord*2.5){const mid=(first+end)>>1;if(mid>first){const size=points.length;fit(first,mid,depth+1);const added=points.length-size;fit(mid+added,end+added,depth+1);return}}
  let h=chord/3,k=chord/3,c
  const curve=()=>[...a,a[0]+u[0]*h,a[1]+u[1]*h,b[0]-v[0]*k,b[1]-v[1]*k,...b]
  for(let iteration=0;iteration<8;iteration++){
   c=curve();const rows=[],errors=[]
   for(const t of [1/3,2/3]){
    const p=bezier(c,t),e=sample(...p)-level,g=gradient(p,Math.max(chord*.0001,Number.EPSILON*4)),B=3*(1-t)**2*t,C=3*(1-t)*t*t
    errors.push(e);rows.push([B*(g[0]*u[0]+g[1]*u[1]),-C*(g[0]*v[0]+g[1]*v[1])])
   }
   if(Math.max(...errors.map(Math.abs))<tolerance*.1)break
   const det=rows[0][0]*rows[1][1]-rows[0][1]*rows[1][0]
   if(!Number.isFinite(det)||Math.abs(det)<1e-30)break
   const dh=(errors[0]*rows[1][1]-errors[1]*rows[0][1])/det,dk=(rows[0][0]*errors[1]-rows[1][0]*errors[0])/det
   if(!Number.isFinite(dh+dk))break
   h=Math.max(chord*.01,Math.min(arc,h-dh));k=Math.max(chord*.01,Math.min(arc,k-dk))
  }
  c=curve();let valid=true,worst=0,at=.5
  for(let j=1;j<16;j++){
   const p=bezier(c,j/16),e=Math.abs(sample(...p)-level)
   if(!Number.isFinite(e)){valid=false;break}if(e>worst){worst=e;at=j/16}
  }
  valid&&=worst<=tolerance*.5
  if(valid){
   const ga=gradient(a,Math.max(scale*.001,Number.EPSILON*4)),expected=Math.sign(u[0]*ga[1]-u[1]*ga[0])
   for(const t of [.23,.51,.79]){
    const p=bezier(c,t),g=gradient(p,Math.max(scale*.001,Number.EPSILON*4)),v=1-t,dx=3*(v*v*(c[2]-c[0])+2*v*t*(c[4]-c[2])+t*t*(c[6]-c[4])),dy=3*(v*v*(c[3]-c[1])+2*v*t*(c[5]-c[3])+t*t*(c[7]-c[5]))
    if(expected*(dx*g[1]-dy*g[0])<0){valid=false;break}
   }
  }
  if(valid){emitted++;result.push(c);return}
  if(end-first>1){const mid=(first+end)>>1;const size=points.length;fit(first,mid,depth+1);const added=points.length-size;fit(mid+added,end+added,depth+1);return}
  if(depth>=14||chord<Number.EPSILON*8)throw new ContourBudgetError('Implicit curve could not meet sampled accuracy target')
  // Insert a corrected knot only when a one-edge span fails validation.
  let p=bezier(c,at)
  for(let j=0;j<12;j++){
   const e=sample(...p)-level;if(!Number.isFinite(e)||Math.abs(e)<tolerance*.1)break
   const g=gradient(p,Math.max(chord*.01,Number.EPSILON*4)),n=g[0]**2+g[1]**2
   if(!(n>0)||!Number.isFinite(n))break
   const d=Math.min(1,chord*.5/(Math.abs(e)/Math.sqrt(n)));p=[p[0]-d*e*g[0]/n,p[1]-d*e*g[1]/n]
  }
  const g=gradient(p,Math.max(chord*.001,Number.EPSILON*4)),n=Math.hypot(...g);let t=n?[-g[1]/n,g[0]/n]:u
  if(t[0]*(b[0]-a[0])+t[1]*(b[1]-a[1])<0)t=t.map(x=>-x)
  points.splice(end,0,p);tangents.splice(end,0,t)
  const size=points.length;fit(first,end,depth+1);const added=points.length-size;fit(end+added,end+1+added,depth+1)
 }
 // Fit ranges right to left so insertion cannot invalidate unvisited indices.
 // Reversal is undone without reversing each segment's travel direction.
 const chunks=[]
 for(let i=0;i<last;i+=32)chunks.push([i,Math.min(last,i+32)])
 for(let i=chunks.length-1;i>=0;i--){const before=result.length;fit(...chunks[i]);const part=result.splice(before);chunks[i]=part}
 const output=chunks.flat()
 // Harmonize the rare join whose differently sized handles round to
 // noticeably different directions at coordinate precision limits.
 for(let i=closed?0:1;i<output.length;i++){
  const a=output[(i+output.length-1)%output.length],b=output[i],u=[a[6]-a[4],a[7]-a[5]],v=[b[2]-b[0],b[3]-b[1]],n=Math.hypot(...u),m=Math.hypot(...v)
  if(n&&m&&(u[0]*v[0]+u[1]*v[1])/(n*m)<.999999){
   const dx=u[0]/n+v[0]/m,dy=u[1]/n+v[1]/m,f=Math.min(n,m)/Math.hypot(dx,dy),grid=2**(Math.floor(Math.log2(Math.max(Math.abs(a[6]),Math.abs(a[7]),Math.abs(b[0]),Math.abs(b[1]),Number.MIN_VALUE)))-51),rx=Math.round(dx*f/grid)*grid,ry=Math.round(dy*f/grid)*grid,x=b[0]+rx,y=b[1]+ry
   const ac=a.slice(),bc=b.slice();ac[4]=ac[6]-rx;ac[5]=ac[7]-ry;bc[2]=x;bc[3]=y
   let safe=true
   for(const c of [ac,bc])for(const t of [.125,.375,.625,.875]){const e=Math.abs(sample(...bezier(c,t))-level);if(!Number.isFinite(e)||e>tolerance)safe=false}
   if(safe){a[4]=ac[4];a[5]=ac[5];b[2]=bc[2];b[3]=bc[3]}
  }
 }
 return output
}
