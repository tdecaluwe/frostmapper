import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {compressContourAtlas} from '../src/map/reprojection/compress-contours.js'
import {griegerField} from './grieger-projection-field.mjs'
import {bezier} from '../src/map/reprojection/bounded-contours.js'
import {audit} from './contour-candidates-node.mjs'
const input=JSON.parse(await readFile(process.argv[2])),out=process.argv[3]||'work/compressed'
await mkdir(out,{recursive:true})
const start=performance.now(),result=compressContourAtlas(input,{sample:griegerField,tolerance:Number(process.env.COMPRESS_TOLERANCE||.005)}),elapsedMs=performance.now()-start
const data=result.atlas,serialized=JSON.stringify(data),a=audit(data)
let tangentAngleBreaks=0
for(const path of data.paths){
 const c=path.curves
 for(let i=0;i<c.length;i++){
  if(!path.closed&&i===0)continue
  const p=c[(i+c.length-1)%c.length],q=c[i],u=[p[6]-p[4],p[7]-p[5]],v=[q[2]-q[0],q[3]-q[1]],norm=Math.hypot(...u)*Math.hypot(...v)
  if(norm&&((u[0]*v[0]+u[1]*v[1])/norm<.999999))tangentAngleBreaks++
 }
}
let independentMaxLog2Error=0
for(const p of data.paths)for(const c of p.curves)for(const t of [.07,.19,.43,.71,.93]){const v=griegerField(bezier(c,t));if(!Number.isFinite(v))throw Error('Invalid independent probe');independentMaxLog2Error=Math.max(independentMaxLog2Error,Math.abs(v-p.step/data.steps))}
const report={independentMaxLog2Error,elapsedMs,...result.stats,bytes:Buffer.byteLength(serialized),inputBytes:Buffer.byteLength(JSON.stringify(input)),tangentAngleBreaks,audit:a}
await writeFile(`${out}/atlas.json`,serialized);await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))
console.log(JSON.stringify({...report,audit:{...a,failures:undefined,perStep:undefined}},null,2))
