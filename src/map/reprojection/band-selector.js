// Choose a contour phase for the viewport, independent of tile boundaries.
// Sample weights represent viewport area; invalid samples are excluded.
export class BandSelector {
 constructor({hysteresis=.05,maxMismatch=1,maxBadFraction=.05}={}){
  this.hysteresis=hysteresis;this.maxMismatch=maxMismatch;this.maxBadFraction=maxBadFraction;this.phase=null
 }
 choose(samples,referenceZoom){
  const usable=samples.filter(sample=>Number.isFinite(sample.value)&&Number.isFinite(sample.weight??1)&&(sample.weight??1)>0)
  if(!usable.length||!Number.isFinite(referenceZoom))return this.phase??0
  const candidates=[]
  for(let phase=0;phase<4;phase++){
   const counts=new Map();let total=0,bad=0,error=0
   for(const {value,weight=1} of usable){
    const band=Math.floor(value+phase/4),mismatch=Math.abs(Math.round(referenceZoom)-band-(referenceZoom-value))
    counts.set(band,(counts.get(band)||0)+weight);total+=weight;error+=weight*mismatch
    if(mismatch>this.maxMismatch)bad+=weight
   }
   candidates.push({phase,coverage:Math.max(...counts.values())/total,bad:bad/total,error:error/total})
  }
  const eligible=candidates.filter(c=>c.bad<=this.maxBadFraction)
  const sorted=(eligible.length?eligible:candidates).sort((a,b)=>eligible.length?b.coverage-a.coverage||a.error-b.error:a.bad-b.bad||b.coverage-a.coverage||a.error-b.error)
  const best=sorted[0],previous=sorted.find(c=>c.phase===this.phase)
  // A previous choice that violates the quality limit must not be retained.
  this.phase=previous&&previous.bad<=best.bad+1e-9&&previous.coverage+this.hysteresis>=best.coverage?previous.phase:best.phase
  return this.phase
 }
}
