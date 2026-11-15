// Port of PROJ's Peirce Quincuncial forward equations (adams.cpp).
// PROJ is distributed under the MIT license: https://proj.org/en/stable/about.html
const K = 1.8540746773013719
const COEFFICIENTS = [-8.58691003636495e-7,2.02692115653689e-7,3.12960480765314e-5,5.30394739921063e-5,-0.0012804644680613,-0.00575574836830288,0.0914203033408211]
const clamp = x => Math.max(-1,Math.min(1,x))
function elliptic(phi) {
 const y=2*(phi*2/Math.PI)**2-1
 let d1=0,d2=0
 for(const c of COEFFICIENTS){const prev=d1;d1=2*y*d1-d2+c;d2=prev}
 return phi*(y*d1-d2+2.19174570831038/2)
}
function inverseElliptic(value) {
 let lo=-Math.PI/2, hi=Math.PI/2
 for(let i=0;i<52;i++){const mid=(lo+hi)/2;if(elliptic(mid)<value)lo=mid;else hi=mid}
 return (lo+hi)/2
}
export function horizontalForward(lon,lat) {
 const sl=Math.sin(lon),cl=Math.cos(lon),cp=Math.cos(lat)
 const a=Math.acos(clamp(cp*(sl+cl)*Math.SQRT1_2)),b=Math.acos(clamp(cp*(sl-cl)*Math.SQRT1_2))
 let m=Math.asin(Math.sqrt(Math.max(0,1+Math.min(0,Math.cos(a+b)))))
 let n=Math.asin(Math.sqrt(Math.max(0,1-Math.max(0,Math.cos(a-b)))))
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
