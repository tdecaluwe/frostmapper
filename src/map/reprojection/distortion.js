// Absolute CDN URL also lets the atlas generator import this module from a
// native module worker, where the document's import map is not available.
import {transform} from 'https://esm.sh/ol@10.6.1/proj.js'

// Use a central difference where possible and an inward, second-order
// difference at a domain edge. Undefined samples must never be clamped into
// the domain: that creates artificial distortion contours at the boundary.
function derivative(sample,point,axis,step,center,unwrap){
 const at=offset=>{const p=point.slice();p[axis]+=offset;const v=sample(p);return v&&unwrap(v,center)}
 const plus=at(step),minus=at(-step)
 if(plus&&minus)return [(plus[0]-minus[0])/(2*step),(plus[1]-minus[1])/(2*step)]
 if(plus){
  const second=at(2*step)
  return second?[(-3*center[0]+4*plus[0]-second[0])/(2*step),(-3*center[1]+4*plus[1]-second[1])/(2*step)]:[(plus[0]-center[0])/step,(plus[1]-center[1])/step]
 }
 if(minus){
  const second=at(-2*step)
  return second?[(3*center[0]-4*minus[0]+second[0])/(2*step),(3*center[1]-4*minus[1]+second[1])/(2*step)]:[(center[0]-minus[0])/step,(center[1]-minus[1])/step]
 }
 return null
}

// Signed logarithm of the linear source/view scale derived from the Jacobian
// area. One unit corresponds to one source zoom level.
export function distortionAt(point,{sample,step=100,sourceWorldWidth=0}){
 if(!point?.every(Number.isFinite)||!Number.isFinite(step)||step<=0)return null
 const center=sample(point)
 if(!center||!center.every(Number.isFinite))return null
 const unwrap=(value,anchor)=>{
  const result=value.slice()
  if(sourceWorldWidth>0)result[0]-=sourceWorldWidth*Math.round((result[0]-anchor[0])/sourceWorldWidth)
  return result
 }
 const dx=derivative(sample,point,0,step,center,unwrap),dy=derivative(sample,point,1,step,center,unwrap)
 if(!dx||!dy)return null
 const determinant=Math.abs(dx[0]*dy[1]-dx[1]*dy[0])
 return Number.isFinite(determinant)&&determinant>1e-16?Math.log2(determinant)/2:null
}

// Reject samples beyond either projection's domain and those that do not
// round-trip. The latter also avoids treating a projection cut as a smooth
// field. source extent bounds the source imagery, including Mercator's poles.
export function projectionDistortion(target,source,point,step=100){
 const targetExtent=target.getExtent(),sourceExtent=source.getExtent()
 const targetWidth=target.canWrapX()&&targetExtent?targetExtent[2]-targetExtent[0]:0
 const sourceWidth=source.canWrapX()&&sourceExtent?sourceExtent[2]-sourceExtent[0]:0
 const sample=coordinate=>{
  if(targetExtent&&(coordinate[1]<targetExtent[1]||coordinate[1]>targetExtent[3]||(!targetWidth&&(coordinate[0]<targetExtent[0]||coordinate[0]>targetExtent[2]))))return null
  try{
   const result=transform(coordinate,target,source)
   if(!result.every(Number.isFinite))return null
   if(sourceExtent&&(result[1]<sourceExtent[1]||result[1]>sourceExtent[3]||(!sourceWidth&&(result[0]<sourceExtent[0]||result[0]>sourceExtent[2]))))return null
   const back=transform(result,source,target)
   if(!back.every(Number.isFinite))return null
   let dx=back[0]-coordinate[0]
   if(targetWidth)dx-=targetWidth*Math.round(dx/targetWidth)
   if(Math.hypot(dx,back[1]-coordinate[1])>Math.max(1,step*.01))return null
   return result
  }catch{return null}
 }
 return distortionAt(point,{sample,step,sourceWorldWidth:sourceWidth})
}

// In source coordinates the Jacobian is the inverse of the target-to-source
// Jacobian. Sampling the forward transform avoids repeatedly transforming
// every finite-difference neighbor back and forth through both projections.
function projectionDistortionFromSource(target,source,point,step=100){
 if(!point?.every(Number.isFinite)||!Number.isFinite(step)||step<=0)return null
 const sourceExtent=source.getExtent(),targetExtent=target.getExtent(),sourceWidth=source.canWrapX()&&sourceExtent?sourceExtent[2]-sourceExtent[0]:0,targetWidth=target.canWrapX()&&targetExtent?targetExtent[2]-targetExtent[0]:0
 const inside=(coordinate,extent,worldWidth)=>!extent||coordinate[1]>=extent[1]&&coordinate[1]<=extent[3]&&(worldWidth>0||coordinate[0]>=extent[0]&&coordinate[0]<=extent[2])
 if(!inside(point,sourceExtent,sourceWidth))return null
 try{
  const center=transform(point,source,target)
  if(!center.every(Number.isFinite)||!inside(center,targetExtent,targetWidth))return null
  const back=transform(center,target,source)
  if(!back.every(Number.isFinite))return null
  let dx=back[0]-point[0]
  if(sourceWidth)dx-=sourceWidth*Math.round(dx/sourceWidth)
  if(Math.hypot(dx,back[1]-point[1])>Math.max(1,step*.01))return null
  const sample=coordinate=>{
   // distortionAt samples the center again before taking its finite
   // differences. Reuse the already validated projection result instead of
   // projecting every field point twice.
   if(coordinate[0]===point[0]&&coordinate[1]===point[1])return center
   if(!inside(coordinate,sourceExtent,sourceWidth))return null
   const result=transform(coordinate,source,target)
   return result.every(Number.isFinite)&&inside(result,targetExtent,targetWidth)?result:null
  }
  const value=distortionAt(point,{sample,step,sourceWorldWidth:targetWidth})
  return value===null?null:-value
 }catch{return null}
}

// Projection-pair data is independent of the viewport and can be shared by
// layers that use the same source coordinate system.
export class DistortionField {
 constructor(target,source,{step=100}={}){this.target=target;this.source=source;this.step=step}
 at(point){return projectionDistortion(this.target,this.source,point,this.step)}
 atSource(point){
  return projectionDistortionFromSource(this.target,this.source,point,this.step)
 }
}
