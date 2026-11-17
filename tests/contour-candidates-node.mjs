// No npm dependencies: use Frostmapper's actual projection implementation.
import {refineContourAtlas} from '../src/map/reprojection/continuation-contours.js'
import {griegerField} from './grieger-projection-field.mjs'
import {writeFile,mkdir} from 'node:fs/promises'

import {BoundedContourAtlas,bezier} from '../src/map/reprojection/bounded-contours.js'
import {buildAdaptiveContourPaths,createAdaptiveContourWorkspace} from '../src/map/reprojection/adaptive-contours.js'
function percentile(sorted,p){return sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]:null}
export function audit(data,reference=griegerField){
 const errors=[],perStep={},failures=[],topology={paths:data.paths.length,closed:0,open:0,interiorEnds:0,discontinuous:0,tangentBreaks:0,seamLoops:0}
 let invalid=0,referenceDisagreement=0,maxReferenceDisagreement=0,curves=0
 for(const path of data.paths){
  if(path.closed)topology.closed++;else topology.open++
  if(path.periodic)topology.seamLoops++
  const es=[]
  for(let i=0;i<path.curves.length;i++){
   const c=path.curves[i];curves++
   if(i){const a=path.curves[i-1];if(Math.hypot(a[6]-c[0],a[7]-c[1])>1e-9)topology.discontinuous++;if(Math.hypot(a[6]-a[4]-c[2]+c[0],a[7]-a[5]-c[3]+c[1])>1e-9)topology.tangentBreaks++}
   for(const t of [.125,.375,.625,.875]){
    const q=bezier(c,t),v=reference(q)
    if(!Number.isFinite(v)){invalid++;continue}
    const error=Math.abs(v-path.step/data.steps)*data.steps;errors.push(error);es.push(error)
    if(error>.5&&failures.length<200)failures.push({step:path.step,point:q,error})
    const independent=griegerField(q,500),delta=Math.abs(v-independent)*data.steps
    if(Number.isFinite(delta)){maxReferenceDisagreement=Math.max(maxReferenceDisagreement,delta);if(delta>.125)referenceDisagreement++}
   }
  }
  for(const error of es)perStep[path.step]=Math.max(perStep[path.step]||0,error)
  if(!path.closed)for(const p of [path.curves[0].slice(0,2),path.curves.at(-1).slice(6)])if(p[1]>1e-6&&p[1]<1-1e-6&&p[0]>1e-6&&p[0]<1-1e-6){
   const r=1e-5,around=[[p[0]+r,p[1]],[p[0]-r,p[1]],[p[0],p[1]+r],[p[0],p[1]-r]]
   if(around.every(p=>Number.isFinite(reference(p))))topology.interiorEnds++
  }
 }
 errors.sort((a,b)=>a-b)
 return {curves,samples:errors.length,maxErrorSteps:errors.at(-1)??null,p99ErrorSteps:percentile(errors,.99),p999ErrorSteps:percentile(errors,.999),overHalfStep:errors.filter(e=>e>.5).length,invalid,referenceDisagreement,maxReferenceDisagreement,topology,perStep,failures}
}
if(import.meta.url===new URL(process.argv[1],'file:').href){
 const steps=Number(process.env.STEPS||4),tolerance=Number(process.env.TOLERANCE||.01),out=process.env.RESULT_DIR||'work/results';await mkdir(out,{recursive:true})
 const results=[]
 for(const candidate of (process.env.CANDIDATES||'bounded,linear,uniform,continuation,original').split(',')){
  let atlas,last;const runs=[],start=performance.now()
  try{
   if(candidate==='continuation'){
    const seedBuilder=new BoundedContourAtlas({sample:griegerField,steps,tolerance,periodicX:true,extrema:false,passes:[{stage:'seed',minimumDepth:4,maxDepth:4,boundaryDepth:4,tolerance:1}]})
    const seed=seedBuilder.next();runs.push({stage:'seed',...seed.stats,audit:audit(seed.atlas)});last=seed.atlas
    const passStart=performance.now();last=refineContourAtlas(last,{sample:griegerField});const report={stage:'corrected',elapsedMs:performance.now()-passStart,audit:audit(last)};runs.push(report);console.log(candidate,JSON.stringify({...report,audit:{...report.audit,perStep:undefined,failures:undefined}}))
   }else if(candidate==='original'){
    const workspace=createAdaptiveContourWorkspace(17,17),levels=Array.from({length:40*steps+1},(_,i)=>({step:i-20*steps,value:i/steps-20}))
    for(const p of [{stage:'coarse',depth:6,minimumDepth:6,tolerance:.4},{stage:'medium',depth:9,minimumDepth:7,tolerance:.08},{stage:'fine',depth:17,minimumDepth:8,tolerance:.08}]){
     const passStart=performance.now();let samples=0
     const paths=buildAdaptiveContourPaths({sample:point=>{if(++samples>2000000||workspace.blocks.size*256>8e6)throw Error('Benchmark guard: >2M samples/pass or >8MB raw cache');return griegerField(point)},extent:[0,0,1,1],atlasExtent:[0,0,1,1],levels,maxDepthX:p.depth,maxDepthY:p.depth,minimumDepth:p.minimumDepth,curvatureTolerance:p.tolerance,workspace,reuseSamples:p.stage!=='coarse'})
     last={steps,paths};const report={stage:p.stage,elapsedMs:performance.now()-passStart,samples,rawCacheBytes:workspace.blocks.size*256,audit:audit(last)};runs.push(report);console.log(candidate,p.stage,JSON.stringify({...report,audit:{...report.audit,perStep:undefined,failures:undefined}}))
    }
   }else{
    const options={sample:griegerField,steps,tolerance,periodicX:true,rootIterations:candidate==='linear'?0:56}
    if(candidate==='uniform'){Object.assign(options,{extrema:false,maxNodes:21845,cacheSize:32768,maxVertices:2048});options.passes=[{stage:'coarse',minimumDepth:4,maxDepth:4,boundaryDepth:4,tolerance:1},{stage:'fine',minimumDepth:7,maxDepth:7,boundaryDepth:7,tolerance:1}]}
    atlas=new BoundedContourAtlas(options)
    while(!atlas.complete){const r=atlas.next();last=r.atlas;const report={stage:r.stage,...r.stats,audit:audit(last)};runs.push(report);console.log(candidate,r.stage,JSON.stringify({...report,audit:{...report.audit,perStep:undefined,failures:undefined}}))}
   }
   results.push({candidate,steps,tolerance,totalMs:performance.now()-start,runs})
  }catch(error){results.push({candidate,steps,error:String(error.stack),runs});console.log(candidate,String(error))}
  atlas?.dispose()
  if(last)await writeFile(`${out}/${candidate}-${steps}-tol${tolerance}.json`,JSON.stringify(last))
  await writeFile(`${out}/results-${steps}-tol${tolerance}.json`,JSON.stringify(results,null,2))
 }
}
