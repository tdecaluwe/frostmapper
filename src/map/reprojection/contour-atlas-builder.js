import {DistortionField} from './distortion.js?v=atlas-fast-v2'
import {buildAdaptiveContourPaths,createAdaptiveContourWorkspace} from './adaptive-contours.js?v=atlas-oriented-v11'

// A projection-pair atlas owns its initial global approximation and the state
// needed for progressively finer global subdivision passes.
const GLOBAL_PASSES=[
 {stage:'global-coarse',depth:6,minimumDepth:6,curvatureTolerance:.4},
 {stage:'global-medium',depth:9,minimumDepth:7,curvatureTolerance:.08},
 {stage:'global-final',depth:17,minimumDepth:8,curvatureTolerance:.08}
]

export class ContourAtlas {
 constructor(target,source,{coordinateProjection=target,steps=4,minZoom=-20,maxZoom=20,workspace=null,passes=GLOBAL_PASSES}={}){
  const extent=coordinateProjection.getExtent()
  if(!extent)throw Error(`Projection ${coordinateProjection.getCode()} has no finite extent for contour planning`)
  this.target=target;this.source=source;this.coordinateProjection=coordinateProjection
  if(!Number.isInteger(steps)||steps<1)throw Error('Contour steps must be a positive integer')
  this.extent=extent;this.steps=steps;this.minZoom=minZoom;this.maxZoom=maxZoom;this.passes=passes
  this.levels=[]
  for(let step=minZoom*steps;step<=maxZoom*steps;step++)this.levels.push({step,value:step/steps})
  this.identity=target.getCode()===source.getCode()
  this.field=this.identity?null:new DistortionField(target,source)
  this.sample=this.identity?null:(coordinateProjection===source?point=>this.field.atSource(point):point=>this.field.at(point))
  this.workspace=this.identity?null:(workspace||createAdaptiveContourWorkspace(Math.max(...passes.map(pass=>pass.depth)),Math.max(...passes.map(pass=>pass.depth))) )
  this.nextPass=0;this.complete=false;this.disposed=false;this.data=null;this.stage=null
  this.buildNextPass(false)
 }
 buildNextPass(reuseSamples){
  const pass=this.passes[this.nextPass]
  if(!pass)return null
  const paths=this.identity?[]:buildAdaptiveContourPaths({sample:this.sample,extent:this.extent,atlasExtent:this.extent,levels:this.levels,maxDepthX:pass.depth,maxDepthY:pass.depth,minimumDepth:pass.minimumDepth??7,curvatureTolerance:pass.curvatureTolerance,workspace:this.workspace,reuseSamples})
  this.data={version:3,orientation:'high-left',target:this.target.getCode(),source:this.source.getCode(),coordinateProjection:this.coordinateProjection.getCode(),extent:this.extent,steps:this.steps,minStep:this.minZoom*this.steps,maxStep:this.maxZoom*this.steps,paths}
  this.stage=pass.stage;this.nextPass++
  if(this.nextPass>=this.passes.length){this.complete=true;this.releaseIntermediateState()}
  return {stage:this.stage,atlas:this.data,done:this.complete}
 }
 // Run one global adaptive refinement block. The worker yields between calls,
 // so rendering stays independent of atlas preparation.
 refineBlock(){
  if(this.complete||this.disposed)return null
  return this.buildNextPass(true)
 }
 releaseIntermediateState(){
  this.workspace?.blocks.clear();this.workspace=null;this.field=null;this.sample=null
  this.target=null;this.source=null;this.coordinateProjection=null;this.levels=null
 }
 dispose(){
  if(!this.disposed){this.releaseIntermediateState();this.data=null;this.passes=null;this.disposed=true}
 }
}

export function* buildAdaptiveContourAtlasPasses(target,source,options={}){
 const atlas=new ContourAtlas(target,source,options)
 yield {stage:atlas.stage,atlas:atlas.data}
 while(!atlas.complete){const block=atlas.refineBlock();if(block)yield block}
}

export function buildAdaptiveContourAtlas(target,source,options={}){
 const atlas=new ContourAtlas(target,source,options)
 while(!atlas.complete)atlas.refineBlock()
 return atlas.data
}

