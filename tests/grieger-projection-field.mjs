// Benchmark scalar field estimated only by calls to Frostmapper's projection
// forward function. No analytic or differentiated projection evaluator.
import {registerOblique} from '../src/map/projections/ob-tran.js'
import {HORIZONTAL_HALF_HEIGHT as K} from '../src/map/projections/peirce-horizontal.js'
const R=6378137,W=2*Math.PI*R,TW=4*K*R
let definition
registerOblique({Proj:{projections:{add:d=>definition=d}}})
const projection=Object.assign(Object.create(definition),{o_proj:'peirce_q',o_type:'horizontal',o_lat_p:-45,o_lon_p:45,o_scrollx:-.25,a:R,k0:1,long0:0})
projection.init()
export function project(x,y){const p=projection.forward({x:x/R,y:2*Math.atan(Math.exp(y/R))-Math.PI/2});return [-p.x,-p.y]}
export function griegerField([u,v],h=100){
 const x=(u-.5)*W,y=(v-.5)*W,center=project(x,y)
 if(!center.every(Number.isFinite)||Math.abs(center[1])>K*R)return NaN
 const points=[project(x-h,y),project(x+h,y),project(x,y-h),project(x,y+h)]
 if(points.some(p=>!p.every(Number.isFinite)||Math.abs(p[1])>K*R))return NaN
 for(const p of points)p[0]-=Math.round((p[0]-center[0])/TW)*TW
 const [a,b,c,d]=points,det=Math.abs(((b[0]-a[0])*(d[1]-c[1])-(b[1]-a[1])*(d[0]-c[0]))/(4*h*h))
 return det>1e-16&&Number.isFinite(det)?-Math.log2(det)/2:NaN
}
