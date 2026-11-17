import {CompactContourAtlas} from '../src/map/reprojection/compact-contours.js'
import {audit} from './contour-candidates-node.mjs'
import {griegerField} from './grieger-projection-field.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
const steps=Number(process.env.STEPS||4),tolerance=Number(process.env.TOLERANCE||.01),out=process.env.RESULT_DIR||'work/compact'
await mkdir(out,{recursive:true})
const engine=new CompactContourAtlas({sample:griegerField,steps,tolerance,periodicX:true,curveFitter:process.env.CURVE_FITTER||'adaptive',correctionSafety:Number(process.env.CORRECTION_SAFETY||1),compress:process.env.COMPRESS==='0'?false:process.env.COMPRESS==='all'?true:'final'}),runs=[]
try{
 while(!engine.complete){
  const r=engine.next(),a=audit(r.atlas),report={stage:r.stage,...r.stats,audit:a};runs.push(report)
  console.log(JSON.stringify({...report,audit:{...a,failures:undefined,perStep:undefined}}))
  await writeFile(`${out}/atlas-${steps}.json`,JSON.stringify(r.atlas))
 }
}finally{engine.dispose();await writeFile(`${out}/results-${steps}.json`,JSON.stringify({steps,tolerance,computeMs:runs.reduce((n,r)=>n+r.elapsedMs,0),runs},null,2))}
