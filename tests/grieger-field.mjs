// Forward-mode differentiation of Frostmapper's ob-tran.js and
// peirce-horizontal.js (PROJ equations; see licenses/PROJ.txt).
// This is a benchmark adapter. The contour implementation has no knowledge
// of Peirce, Grieger, poles, or projection-specific regions.
const R=6378137,K=1.8540746773013719
const coefficients=[-8.58691003636495e-7,2.02692115653689e-7,3.12960480765314e-5,5.30394739921063e-5,-0.0012804644680613,-0.00575574836830288,0.0914203033408211]
const d=v=>Array.isArray(v)?v:[v,0,0]
const add=(a,b)=>{a=d(a);b=d(b);return a.map((v,i)=>v+b[i])}
const mul=(a,b)=>{a=d(a);b=d(b);return [a[0]*b[0],a[1]*b[0]+a[0]*b[1],a[2]*b[0]+a[0]*b[2]]}
const unary=(a,f,df)=>{a=d(a);const k=df(a[0]);return [f(a[0]),k*a[1],k*a[2]]}
const sin=a=>unary(a,Math.sin,Math.cos),cos=a=>unary(a,Math.cos,v=>-Math.sin(v))
const asin=a=>unary(a,v=>Math.asin(Math.max(-1,Math.min(1,v))),v=>1/Math.sqrt(Math.max(0,1-v*v)))
const acos=a=>unary(a,v=>Math.acos(Math.max(-1,Math.min(1,v))),v=>-1/Math.sqrt(Math.max(0,1-v*v)))
const abs=a=>unary(a,Math.abs,v=>v<0?-1:1)
const atan2=(a,b)=>{a=d(a);b=d(b);const s=a[0]**2+b[0]**2;return [Math.atan2(a[0],b[0]),(b[0]*a[1]-a[0]*b[1])/s,(b[0]*a[2]-a[0]*b[2])/s]}
function elliptic(phi){
 const y=add(mul(2,mul(mul(phi,2/Math.PI),mul(phi,2/Math.PI))),-1)
 let d1=0,d2=0
 for(const c of coefficients){const prev=d1;d1=add(add(mul(mul(2,y),d1),mul(-1,d2)),c);d2=prev}
 return mul(phi,add(add(mul(y,d1),mul(-1,d2)),2.19174570831038/2))
}
export function griegerDifferential([u,v]){
 // Break exact coordinate symmetries at roundoff scale to avoid removable
 // 0/0 in the published algebra. No regional masks or contour seeds.
 const lon=[(u-.5)*2*Math.PI+2e-16,1/R,0],latitude=2*Math.atan(Math.exp((v-.5)*2*Math.PI))-Math.PI/2
 const lat=[latitude+3e-16,0,Math.cos(latitude)/R],sp=sin(lat),cp=cos(lat),cl=cos(lon),sl=sin(lon)
 const a=Math.SQRT1_2
 // Differentiate the same spherical rotation in Cartesian form. Avoid
 // acos(dot) near a coincident pole, where dot rounds to exactly one.
 const A=add(mul(-a,mul(cp,cl)),mul(a,sp)),B=mul(cp,sl),C=add(mul(-a,sp),mul(-a,mul(cp,cl)))
 const X=mul(a,add(A,mul(-1,B))),Y=mul(a,add(A,B))
 const hypot=(p,q)=>{const value=Math.hypot(p[0],q[0]);return [value,(p[0]*p[1]+q[0]*q[1])/value,(p[0]*p[2]+q[0]*q[2])/value]}
 const plus=mul(a,add(Y,X)),minus=mul(a,add(Y,mul(-1,X)))
 const aa=atan2(hypot(C,minus),plus),bb=atan2(hypot(C,plus),minus)
 // Stable half-angle equivalents of sqrt(1+cos(a+b)) and
 // sqrt(1-cos(a-b)); they also retain precision near regular symmetry axes.
 const sqrt=p=>unary(p,Math.sqrt,v=>.5/Math.sqrt(v))
 const div=(p,q)=>mul(p,unary(q,v=>1/v,v=>-1/(v*v)))
 const D=mul(plus,minus),E=hypot(D,C)
 // Rationalized complementary sines avoid another removable 0/0 along
 // the rotated equator. These are algebraic identities, not region masks.
 let cosM,cosN
 if(D[0]>=0){cosN=sqrt(add(E,D));cosM=div(abs(C),cosN)}
 else{cosM=sqrt(add(E,mul(-1,D)));cosN=div(abs(C),cosM)}
 let m=atan2(mul(Math.SQRT2,abs(cos(mul(.5,add(aa,bb))))),cosM)
 let n=atan2(mul(Math.SQRT2,abs(sin(mul(.5,add(aa,mul(-1,bb)))))),cosN)
 if(Y[0]<0)m=mul(-1,m)
 if(X[0]>0)n=mul(-1,n)
 let x=elliptic(m),y=elliptic(n)
 if(C[0]<0)x=add(2*K,mul(-1,x))
 x=add(x,-2*K);x[0]=((x[0]+2*K)%(4*K)+4*K)%(4*K)-2*K
 x=mul(-R,x);y=mul(-R,y)
 const det=Math.abs(x[1]*y[2]-x[2]*y[1])
 return {point:[x[0],y[0]],value:det>0&&Number.isFinite(det)?-Math.log2(det)/2:NaN}
}
export const griegerField=p=>griegerDifferential(p).value
