// Produce per-row spans from the shared vector contours. Every span refers to
// a distortion band; clipping and reprojection are the renderer's job.
export class BandMaskPlanner {
 constructor({maxDepth=16,curveError=.2,rowsPerChunk=64}={}){this.maxDepth=maxDepth;this.curveError=curveError;this.rowsPerChunk=rowsPerChunk}
 uniform(width,height,band,start=0){return Array.from({length:height},(_,index)=>({x:0,y:start+index,width,height:1,band}))}
 plan(atlas,extent,width,height,anchorValue,options={}){
  const spans=[]
  for(const chunk of this.planChunks(atlas,extent,width,height,anchorValue,{...options,rowsPerChunk:height})){
   if(chunk.failed)return null
   if(chunk.spans)spans.push(...chunk.spans)
  }
  return spans
 }
 *planChunks(atlas,extent,width,height,anchorValue,{minimumStep=-Infinity,rowsPerChunk=this.rowsPerChunk,valueAt=null}={}){
  const anchor=typeof anchorValue==='number'?{value:anchorValue,x:width/2,y:height/2}:anchorValue
  if(!anchor||!Number.isFinite(anchor.value)){yield {failed:true};return}
  const [x0,y0,x1,y1]=atlas.data.extent,[left,bottom,right,top]=extent
  const norm=[(left-x0)/(x1-x0),(bottom-y0)/(y1-y0),(right-x0)/(x1-x0),(top-y0)/(y1-y0)]
  const steps=atlas.data.steps||1,candidates=atlas.query(norm).filter(item=>item.step>=minimumStep),lines=[]
  const uniformBand=Math.floor(anchor.value*steps)
  if(!candidates.length){
   for(let start=0;start<height;start+=rowsPerChunk)yield {spans:this.uniform(width,Math.min(rowsPerChunk,height-start),uniformBand,start)}
   yield {complete:true};return
  }
  const minLevel=atlas.data.minStep!==undefined?atlas.data.minStep/steps:atlas.data.minQuarter!==undefined?atlas.data.minQuarter/4:-80
  const maxLevel=atlas.data.maxStep!==undefined?atlas.data.maxStep/steps:atlas.data.maxQuarter!==undefined?atlas.data.maxQuarter/4:80
  if(anchor.value<minLevel||anchor.value>maxLevel){yield {failed:true};return}
  const screen=(x,y)=>[(x*(x1-x0)+x0-left)/(right-left)*width,(top-(y*(y1-y0)+y0))/(top-bottom)*height]
  const midpoint=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2]
  const flatten=(a,b,c,d,step,oriented,depth)=>{
   const vx=d[0]-a[0],vy=d[1]-a[1],length=Math.hypot(vx,vy)
   const distance=p=>length?Math.abs(vy*p[0]-vx*p[1]+d[0]*a[1]-d[1]*a[0])/length:Math.hypot(p[0]-a[0],p[1]-a[1])
   if(depth>=this.maxDepth||Math.max(distance(b),distance(c))<=this.curveError){lines.push({a,d,step,oriented});return}
   const ab=midpoint(a,b),bc=midpoint(b,c),cd=midpoint(c,d),abc=midpoint(ab,bc),bcd=midpoint(bc,cd),m=midpoint(abc,bcd)
   flatten(a,ab,abc,m,step,oriented,depth+1);flatten(m,bcd,cd,d,step,oriented,depth+1)
  }
  for(const {curve,step,oriented} of candidates)flatten(screen(curve[0],curve[1]),screen(curve[2],curve[3]),screen(curve[4],curve[5]),screen(curve[6],curve[7]),step,oriented,0)
  const anchorX=anchor.x,anchorY=anchor.y,rowCrossings=Array.from({length:height},()=>[]),vertical=[]
  const crossesAt=(a,d,axis,value)=>(a[axis]<=value&&value<d[axis])||(d[axis]<=value&&value<a[axis])
  const intersect=(a,d,axis,value)=>a[1-axis]+(value-a[axis])/(d[axis]-a[axis])*(d[1-axis]-a[1-axis])
  for(const {a,d,step,oriented} of lines){
   // Build the anchor column and screen-row crossing lists in one pass.
   if(crossesAt(a,d,0,anchorX))vertical.push({coordinate:intersect(a,d,0,anchorX),step,delta:-Math.sign(d[0]-a[0]),oriented})
   const first=Math.max(0,Math.ceil(Math.min(a[1],d[1])-.5)),end=Math.min(height,Math.ceil(Math.max(a[1],d[1])-.5))
   for(let row=first;row<end;row++){
    const y=row+.5
    if(!crossesAt(a,d,1,y))continue
    const coordinate=intersect(a,d,1,y)
    if(coordinate>=0&&coordinate<width)rowCrossings[row].push({coordinate,step,delta:Math.sign(d[1]-a[1]),oriented})
   }
  }
  vertical.sort((a,b)=>a.coordinate-b.coordinate)
  for(const row of rowCrossings)row.sort((a,b)=>a.coordinate-b.coordinate)
  const lowerBound=(items,value)=>{let low=0,high=items.length;while(low<high){const middle=(low+high)>>1;if(items[middle].coordinate<value)low=middle+1;else high=middle}return low}
  const cross=(band,step,delta,oriented)=>{
   if(oriented)return delta>0?step:step-1
   // New atlases carry per-curve orientation. If the builder could not
   // validate a curve locally, don't let an old parity heuristic guess which
   // side is higher; subdivision or ordinary reprojection is safer.
   if(atlas.data.orientation==='high-left')return null
   const high=step
   if(band===high)return high-1
   if(band===high-1)return high
   // Legacy contour paths have no direction metadata. If their crossings
   // arrive at an unrelated band, the local graph is ambiguous; do not invent
   // a transition. The worker subdivides and ultimately uses ordinary
   // reprojection if the ambiguity persists.
   return null
  }
  const anchorBand=uniformBand,anchorVerticalStart=lowerBound(vertical,anchorY)
  const refineCrossing=(crossing,y)=>{
   if(!valueAt)return crossing
   const level=crossing.step/steps;let x=crossing.coordinate,value=valueAt(x,y),derivative=0
   if(!Number.isFinite(value))return null
   for(let iteration=0;iteration<5;iteration++){
    const error=value-level
    if(Math.abs(error)<.001)break
    const left=valueAt(x-.5,y),right=valueAt(x+.5,y)
    if(!Number.isFinite(left)||!Number.isFinite(right))return null
    derivative=right-left
    if(Math.abs(derivative)<1e-8)return null
    const shift=error/derivative
    if(!Number.isFinite(shift)||Math.abs(shift)>32)return null
    x-=shift;value=valueAt(x,y)
    if(!Number.isFinite(value))return null
   }
   if(Math.abs(value-level)>.001)return null
   if(!derivative){const left=valueAt(x-.5,y),right=valueAt(x+.5,y);derivative=right-left}
   if(!Number.isFinite(derivative)||Math.abs(derivative)<1e-8)return null
   return {coordinate:x,step:crossing.step,delta:Math.sign(derivative),oriented:true}
  }
  for(let chunkStart=0;chunkStart<height;chunkStart+=rowsPerChunk){
   const spans=[],chunkEnd=Math.min(height,chunkStart+rowsPerChunk)
   for(let row=chunkStart;row<chunkEnd;row++){
    const y=row+.5,anchorValueAtRow=valueAt?.(anchorX,y),rowAnchorBand=Number.isFinite(anchorValueAtRow)?Math.floor(anchorValueAtRow*steps):anchorBand
    let band=rowAnchorBand
    const horizontal=rowCrossings[row].map(crossing=>refineCrossing(crossing,y)).filter(Boolean).sort((a,b)=>a.coordinate-b.coordinate)
    if(!Number.isFinite(anchorValueAtRow)){
     if(y<anchorY){const start=lowerBound(vertical,y);for(let i=anchorVerticalStart-1;i>=start;i--){const c=vertical[i];band=cross(band,c.step,-c.delta,c.oriented);if(band===null){yield {failed:true};return}}}
     else{const end=lowerBound(vertical,y);for(let i=anchorVerticalStart;i<end;i++){const c=vertical[i];band=cross(band,c.step,c.delta,c.oriented);if(band===null){yield {failed:true};return}}}
    }
    const leftEnd=lowerBound(horizontal,anchorX)
    for(let i=leftEnd-1;i>=0;i--){const c=horizontal[i];band=cross(band,c.step,-c.delta,c.oriented);if(band===null){yield {failed:true};return}}
    let start=0
    for(const c of horizontal){
     const end=Math.max(0,Math.min(width,Math.ceil(c.coordinate-.5)))
     if(end>start)spans.push({y:row,x:start,width:end-start,band})
     band=cross(band,c.step,c.delta,c.oriented);if(band===null){yield {failed:true};return}
     start=Math.max(start,end)
    }
    if(start<width)spans.push({y:row,x:start,width:width-start,band})
   }
   yield {spans}
  }
  yield {complete:true}
 }
}
