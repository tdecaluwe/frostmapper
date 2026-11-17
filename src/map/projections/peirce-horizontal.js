// Port of PROJ's Peirce Quincuncial forward equations (adams.cpp).
// PROJ is distributed under the MIT license: https://proj.org/en/stable/about.html
const K = 1.8540746773013719
const COEFFICIENTS = [-8.58691003636495e-7,2.02692115653689e-7,3.12960480765314e-5,5.30394739921063e-5,-0.0012804644680613,-0.00575574836830288,0.0914203033408211]
const clamp = x => Math.max(-1,Math.min(1,x))
function elliptic(phi) {
 const y=2*(phi*2/Math.PI)**2-1
 // Unroll the fixed Clenshaw recurrence: this runs for every projection
 // evaluation, and the coefficient count is constant.
 let d1=2*y*COEFFICIENTS[0]+COEFFICIENTS[1],d2=COEFFICIENTS[0]
 let prev=d1;d1=2*y*d1-d2+COEFFICIENTS[2];d2=prev
 prev=d1;d1=2*y*d1-d2+COEFFICIENTS[3];d2=prev
 prev=d1;d1=2*y*d1-d2+COEFFICIENTS[4];d2=prev
 prev=d1;d1=2*y*d1-d2+COEFFICIENTS[5];d2=prev
 prev=d1;d1=2*y*d1-d2+COEFFICIENTS[6];d2=prev
 return phi*(y*d1-d2+2.19174570831038/2)
}
// Evaluate the elliptic polynomial and its derivative in one differentiated
// Clenshaw recurrence; inverse projection can then use Newton steps.
function ellipticWithDerivative(phi) {
 const y=2*(phi*2/Math.PI)**2-1
 let d1=2*y*COEFFICIENTS[0]+COEFFICIENTS[1],d2=COEFFICIENTS[0]
 let e1=2*COEFFICIENTS[0],e2=0
 let prev=d1,eprev=e1
 d1=2*y*d1-d2+COEFFICIENTS[2];e1=2*prev+2*y*e1-e2;d2=prev;e2=eprev
 prev=d1;eprev=e1
 d1=2*y*d1-d2+COEFFICIENTS[3];e1=2*prev+2*y*e1-e2;d2=prev;e2=eprev
 prev=d1;eprev=e1
 d1=2*y*d1-d2+COEFFICIENTS[4];e1=2*prev+2*y*e1-e2;d2=prev;e2=eprev
 prev=d1;eprev=e1
 d1=2*y*d1-d2+COEFFICIENTS[5];e1=2*prev+2*y*e1-e2;d2=prev;e2=eprev
 prev=d1;eprev=e1
 d1=2*y*d1-d2+COEFFICIENTS[6];e1=2*prev+2*y*e1-e2;d2=prev;e2=eprev
 const p=y*d1-d2+2.19174570831038/2
 const dpdy=d1+y*e1-e2
 return [phi*p,p+phi*dpdy*(16*phi/(Math.PI*Math.PI))]
}
function inverseElliptic(value) {
 // The elliptic map is monotone on this interval. A capped Newton step keeps
 // each update local, and clamping keeps the iterate inside the inverse domain.
 let phi=value*(Math.PI/(2*K))
 for(let i=0;i<16;i++){
  const [result,slope]=ellipticWithDerivative(phi),correction=(result-value)/slope
  if(!Number.isFinite(correction))return phi
  const step=Math.max(-.25,Math.min(.25,correction))
  const next=Math.max(-Math.PI/2,Math.min(Math.PI/2,phi-step))
  if(next===phi||Math.abs(step)<=2*Number.EPSILON)return phi
  phi=next
 }
 return phi
}
export function horizontalForward(lon,lat) {
 // One half-angle formulation covers the whole chart; complementary component
 // ratios avoid cancellation when either angle approaches a fold.
 const sl=Math.sin(lon),cl=Math.cos(lon),cp=Math.cos(lat),sinLat=Math.sin(lat)
 const cosA=clamp(cp*(sl+cl)*Math.SQRT1_2),cosB=clamp(cp*(sl-cl)*Math.SQRT1_2)
 const compA=cp*(sl-cl)*Math.SQRT1_2,compB=cp*(sl+cl)*Math.SQRT1_2
 const sinA=Math.sqrt(sinLat*sinLat+compA*compA),sinB=Math.sqrt(sinLat*sinLat+compB*compB)
 const cosSum=cosA*cosB-sinA*sinB,cosDifference=cosA*cosB+sinA*sinB
 const cosDifferenceHalf=Math.sqrt(Math.max(0,(1+cosDifference)/2)),sinDifferenceHalf=Math.sqrt(Math.max(0,(1-cosDifference)/2))
 const cosSumHalf=cosDifferenceHalf>=sinDifferenceHalf?Math.abs(cosA+cosB)/(2*cosDifferenceHalf):Math.abs(sinA-sinB)/(2*sinDifferenceHalf)
 const sinSumHalf=Math.sqrt(Math.max(0,(1-cosSum)/2))
 const sinDifferenceHalfStable=sinSumHalf>=cosSumHalf?Math.abs(cosA-cosB)/(2*sinSumHalf):Math.abs(sinA-sinB)/(2*cosSumHalf)
 // sinA*sinB = hypot(cosA*cosB,sinLat). Rationalize the
 // smaller complement instead of subtracting nearly equal products at folds.
 const product=cosA*cosB,combined=Math.hypot(product,sinLat)
 let complementM,complementN
 if(product>=0){complementN=Math.sqrt(combined+product);complementM=complementN?Math.abs(sinLat)/complementN:0}
 else{complementM=Math.sqrt(combined-product);complementN=Math.abs(sinLat)/complementM}
 let m=Math.atan2(Math.SQRT2*cosSumHalf,complementM)
 let n=Math.atan2(Math.SQRT2*sinDifferenceHalfStable,complementN)
 if(sl<0)m=-m
 if(cl>0)n=-n
 let x=elliptic(m),y=elliptic(n)
 if(lat<0)x=2*K-x
 return [x-K,y]
}
export function horizontalInverse(x,y) {
 if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>2*K+1e-6||Math.abs(y)>K+1e-6)return [NaN,NaN]
 const south=x>0
 const rawX=south?K-x:x+K
 const m=inverseElliptic(rawX),n=inverseElliptic(y)
 let sum=Math.acos(clamp(-(Math.cos(m)**2)))
 if(m<0)sum=2*Math.PI-sum
 let diff=Math.acos(clamp(Math.cos(n)**2))
 if(n<0)diff=-diff
 const a=(sum+diff)/2,b=(sum-diff)/2
 const sinLon=(Math.cos(a)+Math.cos(b))*Math.SQRT1_2
 const cosLon=(Math.cos(a)-Math.cos(b))*Math.SQRT1_2
 const cosLat=Math.min(1,Math.hypot(sinLon,cosLon))
 return [Math.atan2(sinLon,cosLon),(south?-1:1)*Math.acos(cosLat)]
}
export const HORIZONTAL_HALF_HEIGHT=K
