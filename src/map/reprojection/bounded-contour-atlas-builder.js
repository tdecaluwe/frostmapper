// Optional Frostmapper integration. This adapter deliberately leaves the
// existing worker default intact until browser integration is validated.
import {transform} from 'https://esm.sh/ol@10.6.1/proj.js'
import {DistortionField} from './distortion.js?v=visibility-v1'
import {CompactContourAtlas} from './compact-contours.js'
import {BoundedContourAtlas} from './bounded-contours.js'
import {MAX_SOURCE_ZOOM} from './contour-atlas-config.js'

export class BoundedProjectionContourAtlas {
 constructor(target,source,{coordinateProjection=source,scaleSample=null,steps=4,minZoom=-MAX_SOURCE_ZOOM,maxZoom=MAX_SOURCE_ZOOM,tolerance=.01,algorithm='compact',finiteDifferenceStep=100,adaptiveFiniteDifferences=true,sourceDomainPolicy='forward',...options}={}){
  const extent=coordinateProjection.getExtent()
  if(!extent)throw Error('Contour coordinate projection requires a finite extent')
  this.targetCode=target.getCode();this.sourceCode=source.getCode();this.coordinateCode=coordinateProjection.getCode()
  const field=scaleSample?null:new DistortionField(target,source,{step:finiteDifferenceStep,adaptive:adaptiveFiniteDifferences,domainPolicy:sourceDomainPolicy})
  const sample=scaleSample??(coordinateProjection===source?p=>field.atSource(p):p=>field.at(p))
  // Source-coordinate atlases use the finite forward domain by default.
  // Display clipping and optional strict round-trip validation are separate
  // from numerical scale estimation and visibility-driven discovery.
  if(!['compact','bounded'].includes(algorithm))throw Error('Unknown contour algorithm')
  const Engine=algorithm==='compact'?CompactContourAtlas:BoundedContourAtlas
  const targetExtent=target.getExtent()
  const visibility={
   project:p=>coordinateProjection===target?p:transform(p,coordinateProjection,target),
   resolutionAtZoom:z=>(targetExtent?Math.max(targetExtent[2]-targetExtent[0],targetExtent[3]-targetExtent[1]):Math.max(extent[2]-extent[0],extent[3]-extent[1]))/256/2**z,
   worldWidth:target.canWrapX()&&targetExtent?targetExtent[2]-targetExtent[0]:0,
   ...options.visibility
  }
  this.engine=new Engine({...options,visibility,sample,extent,steps,minZoom,maxZoom,tolerance,periodicX:coordinateProjection.canWrapX()})
  this.complete=false;this.disposed=false;this.data=null;this.stage=null;this.stats=null
  this.refineBlock()
 }
 refineBlock(){
  if(this.complete||this.disposed)return null
  const result=this.engine.next()
  Object.assign(result.atlas,{target:this.targetCode,source:this.sourceCode,coordinateProjection:this.coordinateCode})
  this.data=result.atlas;this.stage=result.stage;this.stats=result.stats;this.complete=result.done
  return result
 }
 dispose(){if(!this.disposed){this.engine.dispose();this.engine=null;this.data=null;this.disposed=true}}
}
export function* buildBoundedContourAtlasPasses(target,source,options={}){
 const atlas=new BoundedProjectionContourAtlas(target,source,options)
 try{
  yield {stage:atlas.stage,atlas:atlas.data,done:atlas.complete,stats:atlas.stats}
  while(!atlas.complete)yield atlas.refineBlock()
 }finally{atlas.dispose()}
}
