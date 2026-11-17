import {readFile,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {bezier} from '../src/map/reprojection/bounded-contours.js'
import {griegerField} from './grieger-field.mjs'
const data=JSON.parse(await readFile(process.argv[2])),report={checked:0,wrong:0,unresolved:0,tangentDirectionBreaks:0,quantizationLimitedJoins:0}
assert.equal(data.orientation,'high-left')
for(const path of data.paths)for(let i=0;i<path.curves.length;i++){
 assert.equal(path.orientations[i],true)
 const c=path.curves[i]
 if(path.closed||i>0){const p=path.curves[(i+path.curves.length-1)%path.curves.length],u=[p[6]-p[4],p[7]-p[5]],v=[c[2]-c[0],c[3]-c[1]],norm=Math.hypot(...u)*Math.hypot(...v);if(norm&&(u[0]*v[0]+u[1]*v[1])/norm<.999999){
  const angle=Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/norm))),roundoff=8*Number.EPSILON*Math.max(1,...p.map(Math.abs),...c.map(Math.abs))/Math.min(Math.hypot(...u),Math.hypot(...v))
  if(angle<=roundoff)report.quantizationLimitedJoins++;else report.tangentDirectionBreaks++
 }}
 for(const t of [.23,.51,.79]){
  const p=bezier(c,t),u=1-t,dx=3*(u*u*(c[2]-c[0])+2*u*t*(c[4]-c[2])+t*t*(c[6]-c[4])),dy=3*(u*u*(c[3]-c[1])+2*u*t*(c[5]-c[3])+t*t*(c[7]-c[5])),n=Math.hypot(dx,dy)
  let resolved=false
  for(const factor of [.05,.1,.2]){
   const eps=Math.max(Number.EPSILON*2,Math.min(n*factor,1e-5)),l=griegerField([p[0]-dy/n*eps,p[1]+dx/n*eps]),r=griegerField([p[0]+dy/n*eps,p[1]-dx/n*eps])
   if(Number.isFinite(l)&&Number.isFinite(r)&&Math.abs(l-r)>1e-9){report.checked++;if(l<r)report.wrong++;resolved=true;break}
  }
  if(!resolved)report.unresolved++
 }
}
console.log(JSON.stringify(report,null,2))
if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(report,null,2))
assert.equal(report.wrong,0);assert.equal(report.unresolved,0);assert.equal(report.tangentDirectionBreaks,0)
