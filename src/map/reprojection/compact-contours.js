import {fitFieldContour} from './field-curve-fit.js'
import {compressContourAtlas} from './compress-contours.js'
import {BoundedContourAtlas,ContourBudgetError,bezier,smoothPath} from './bounded-contours.js'

// Every stage is a global publication; custom schedules can contain any
// number of stages. Accuracy multipliers are independent of stage index.
export function createCompactContourPasses({preset='balanced',steps=4,preview={},coarse={},medium={}}={}){
 if(!['responsive','fast','balanced','progressive'].includes(preset))throw Error('Unknown contour preset')
 const passes=[
  {stage:'coarse',minimumDepth:4,maxDepth:8,boundaryDepth:5,tolerance:.3,fitToleranceMultiplier:4,rootIterations:28,visibilityZoomOffset:preset==='progressive'?4:0,...coarse},
  {stage:'medium',minimumDepth:5,maxDepth:14,boundaryDepth:7,tolerance:.1,fitToleranceMultiplier:2,visibilityZoomOffset:preset==='progressive'?2:0,...medium},
  {stage:'fine',minimumDepth:6,maxDepth:25,boundaryDepth:9,tolerance:.05,fitToleranceMultiplier:1}
 ]
 if(['responsive','fast'].includes(preset))passes.unshift({stage:'preview',minimumDepth:3,maxDepth:6,boundaryDepth:4,meshTolerance:.15,
  fitToleranceMultiplier:8,rootIterations:56,extrema:false,levelStride:preset==='fast'?steps:1,
  sampleBudget:150000,componentSampleBudget:5000,onBudget:'continue',...preview})
 return passes
}

// Retain conforming topology discovery, but spend less on a fine global mesh
// and correct geometry in the normal direction of the implicit field instead.
export class CompactContourAtlas extends BoundedContourAtlas {
 constructor(options={}){
  const tolerance=options.tolerance??.01
  if(!(options.correctionSafety??1)||!Number.isFinite(options.correctionSafety??1)||(options.correctionSafety??1)<0)throw Error('Invalid correction safety')
  super({maxNodes:65533,cacheSize:32768,maxVertices:4096,maxPathVertices:(options.correctionSafety??1)<1?4096:2048,
   passes:createCompactContourPasses({preset:options.preset??'balanced',steps:options.steps??4,preview:options.preview,coarse:options.coarse,medium:options.medium}),...options,tolerance})
  this.correctionSafety=options.correctionSafety??1
  this.compress=options.compress??'final'
  this.curveFitter=options.curveFitter??'adaptive'
  if(!['adaptive','hybrid'].includes(this.curveFitter))throw Error('Unknown curve fitter')
 }
 next(){
  const result=super.next()
  if(result&&this.curveFitter==='adaptive')result.atlas.curveFitting={method:'adaptive-implicit',continuity:'G1',tolerance:result.atlas.quality.sampledAcceptanceTolerance,certified:false}
  else if(result&&this.compress&&(this.compress!=='final'||result.done))result.atlas.compression={continuity:'G1',tolerance:result.atlas.quality.sampledAcceptanceTolerance*.5,certified:false}
  return result
 }
 polish(points,closed,level){
  if(this.curveFitter==='adaptive'){
   try{return fitFieldContour(points,closed,level,{sample:(x,y)=>this.direct(x,y),tolerance:this.fittingTolerance,maxSegments:this.maxPathVertices})}
   catch(error){
    if(!(error instanceof ContourBudgetError))throw error
    // Reject this entire component when accuracy or configured work limits
    // prevent fitting it. A budget rejection alone does not establish noise.
    this.stats.unresolvedComponents=(this.stats.unresolvedComponents||0)+1
    return null
   }
  }
  const target=this.fittingTolerance*this.correctionSafety
  const sample=(x,y)=>this.direct(x,y)
  let curves=[]
  for(let round=0;round<12;round++){
   curves=implicitCubics(points,closed,sample)
   const insert=[]
   for(let i=0;i<curves.length;i++){
    const c=curves[i];let worst=0,at=.5
    for(const t of [.125,.25,.375,.5,.625,.75,.875]){
     const p=bezier(c,t),v=sample(...p),e=Math.abs(v-level)
     if(Number.isFinite(e)&&e>worst){worst=e;at=t}
    }
    if(worst<=target*.5)continue
    const origin=bezier(c,at),length=Math.hypot(c[6]-c[0],c[7]-c[1])
    let p=origin.slice(),best=worst
    for(let j=0;j<12;j++){
     const v=sample(...p),error=v-level
     if(!Number.isFinite(error)||Math.abs(error)<target*.1)break
     const h=Math.max(length*.01,Number.EPSILON*.25),g=gradient(sample,p,h),norm=g[0]**2+g[1]**2
     if(!(norm>0)||!Number.isFinite(norm))break
     let accepted=false
     for(let damp=1;damp>=1/32;damp/=2){
      const q=[p[0]-damp*error*g[0]/norm,p[1]-damp*error*g[1]/norm]
      const residual=Math.abs(sample(...q)-level)
      if(residual<best&&Math.hypot(q[0]-origin[0],q[1]-origin[1])<=length){p=q;best=residual;accepted=true;break}
     }
     if(!accepted)break
    }
    // Floating point noise must not prevent an otherwise useful correction.
    if(best<worst*.8)insert.push([i,p])
   }
   if(!insert.length)break
   if(points.length+insert.length>this.maxPathVertices)throw new ContourBudgetError('Compact curve point budget exhausted')
   for(let j=insert.length-1;j>=0;j--)points.splice(insert[j][0]+1,0,insert[j][1])
  }
  const fitted=implicitCubics(points,closed,sample)
  if(!this.compress||(this.compress==='final'&&this.pass<this.passes.length-1))return fitted
  // Merge during path fitting, before orientation and before level output.
  const start=performance.now(),result=compressContourAtlas({extent:[0,0,1,1],steps:this.steps,periodicX:this.periodicX,paths:[{step:level*this.steps,closed,curves:fitted,orientations:fitted.map(()=>true)}]},{sample:p=>sample(...p),tolerance:this.fittingTolerance*.5,checkOrientation:false})
  this.stats.compressionMs=(this.stats.compressionMs??0)+performance.now()-start
  this.stats.compressionEvaluations=(this.stats.compressionEvaluations??0)+result.stats.evaluations
  return result.atlas.paths[0].curves
 }
}
function gradient(sample,p,h){return [(sample(p[0]+h,p[1])-sample(p[0]-h,p[1]))/(2*h),(sample(p[0],p[1]+h)-sample(p[0],p[1]-h))/(2*h)]}
function implicitCubics(points,closed,sample){
 const last=points.length-1,delta=[points[last][0]-points[0][0],points[last][1]-points[0][1]]
 const tangents=[]
 for(let i=0;i<=last;i++){
  const p=points[i],a=i?points[i-1]:closed?[points[last-1][0]-delta[0],points[last-1][1]-delta[1]]:p
  const b=i<last?points[i+1]:closed?[points[1][0]+delta[0],points[1][1]+delta[1]]:p
  const la=Math.hypot(p[0]-a[0],p[1]-a[1]),lb=Math.hypot(b[0]-p[0],b[1]-p[1]),length=Math.min(la||Infinity,lb||Infinity)
  let dx=b[0]-a[0],dy=b[1]-a[1]
  const g=gradient(sample,p,Math.max(length*.01,Number.EPSILON*.25)),norm=Math.hypot(...g)
  if(norm>0&&Number.isFinite(norm)){let tx=-g[1]/norm,ty=g[0]/norm;if(tx*dx+ty*dy<0){tx=-tx;ty=-ty}dx=tx;dy=ty}
  const n=Math.hypot(dx,dy),factor=n&&Number.isFinite(length)?length/(3*n):0
  tangents.push([dx*factor,dy*factor])
 }
 // Match the closing derivative exactly, even after periodic lifting.
 if(closed)tangents[last]=tangents[0]
 const curves=[]
 for(let i=0;i<last;i++){const a=points[i],b=points[i+1],u=tangents[i],v=tangents[i+1];curves.push([a[0],a[1],a[0]+u[0],a[1]+u[1],b[0]-v[0],b[1]-v[1],b[0],b[1]])}
 return curves
}
