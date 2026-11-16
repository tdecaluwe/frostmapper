// Run: node tests/zoom-contours-node.mjs
// Compare ready contour plans with an independent finite-difference field.
import {readFile} from 'node:fs/promises'
import {registerOblique} from '../src/map/projections/ob-tran.js'
import {HORIZONTAL_HALF_HEIGHT} from '../src/map/projections/peirce-horizontal.js'
import {ContourAtlas} from '../src/map/reprojection/contour-atlas-index.js'
import {BandMaskPlanner} from '../src/map/reprojection/band-mask.js'

const data=JSON.parse(await readFile(process.env.FROSTMAPPER_ATLAS||new URL('./fixtures/contours/source-frost-triptychial.json',import.meta.url),'utf8'))
let oblique
registerOblique({Proj:{projections:{add:definition=>{oblique=definition}}}})
const projection=Object.assign(Object.create(oblique),{o_proj:'peirce_q',o_type:'horizontal',o_lat_p:-45,o_lon_p:45,o_scrollx:-.25,a:6378137,k0:1,long0:0})
projection.init()
const R=6378137,W=2*Math.PI*R,TARGET_WIDTH=4*HORIZONTAL_HALF_HEIGHT*R,extent=data.extent
function project(x,y){const lon=x/R,lat=2*Math.atan(Math.exp(y/R))-Math.PI/2,p=projection.forward({x:lon,y:lat});return [-p.x,-p.y]}
function distortion([x,y]){
 const h=100,center=project(x,y),a=project(x-h,y),b=project(x+h,y),c=project(x,y-h),d=project(x,y+h),maxY=HORIZONTAL_HALF_HEIGHT*R
 if([center,a,b,c,d].some(point=>!point.every(Number.isFinite)||Math.abs(point[1])>maxY))return null
 for(const p of [b,c,d])p[0]-=Math.round((p[0]-a[0])/TARGET_WIDTH)*TARGET_WIDTH
 const determinant=Math.abs(((b[0]-a[0])*(d[1]-c[1])-(b[1]-a[1])*(d[0]-c[0]))/(4*h*h))
 return determinant>1e-16&&Number.isFinite(determinant)?-Math.log2(determinant)/2:null
}
const atlas=new ContourAtlas(data),planner=new BandMaskPlanner(),results=[]
for(const z of [6,8,10]){
 const n=2**z,originX=n/4,originY=n/2,size=W/n;let checked=0,wrong=0,skipped=0
 for(const [x,y] of [[originX-1,originY-1],[originX,originY-1],[originX-1,originY],[originX,originY]]){
  const e=[extent[0]+x*size,extent[3]-(y+1)*size,extent[0]+(x+1)*size,extent[3]-y*size],anchor=distortion([(e[0]+e[2])/2,(e[1]+e[3])/2])
  const spans=planner.plan(atlas,e,256,256,anchor)
  if(!spans){skipped++;continue}
  for(let py=2;py<256;py+=4)for(let px=2;px<256;px+=4){
   const q=distortion([e[0]+(px+.5)*size/256,e[3]-(py+.5)*size/256])
   const steps=data.steps||1
   if(q===null||Math.abs(q*steps-Math.round(q*steps))<.2)continue
   const span=spans.find(s=>s.y===py&&s.x<=px&&s.x+s.width>px)
   if(!span)continue
   checked++;if(span.band!==Math.floor(q*steps))wrong++
  }
 }
 results.push({sourceZoom:z,checked,wrong,skipped})
}
console.log(JSON.stringify(results,null,2))
if(results.some(result=>result.checked<100||result.wrong)){console.error('FAIL: ready contour masks disagree with Grieger distortion');process.exitCode=1}
