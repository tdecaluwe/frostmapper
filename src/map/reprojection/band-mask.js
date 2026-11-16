// Produce per-row spans from the shared vector contours. Every span refers to
// a distortion band; clipping and reprojection are the renderer's job.
export class BandMaskPlanner {
 constructor({maxDepth=16,curveError=.2,rowsPerChunk=16}={}){this.maxDepth=maxDepth;this.curveError=curveError;this.rowsPerChunk=rowsPerChunk}
 uniform(width,height,band,start=0){return Array.from({length:height},(_,index)=>({x:0,y:start+index,width,height:1,band}))}
 plan(atlas,extent,width,height,anchorValue,options={}){
  const spans=[]
  for(const chunk of this.planChunks(atlas,extent,width,height,anchorValue,{...options,rowsPerChunk:height})){
   if(chunk.failed)return null
   if(chunk.spans)spans.push(...chunk.spans)
  }
  return spans
 }
 *planChunks(atlas,extent,width,height,anchorValue,{minimumQuarter=-Infinity,rowsPerChunk=this.rowsPerChunk}={}){
  const anchor=typeof anchorValue==='number'?{value:anchorValue,x:width/2,y:height/2}:anchorValue
  if(!anchor||!Number.isFinite(anchor.value)){yield {failed:true};return}
  const [x0,y0,x1,y1]=atlas.data.extent,[left,bottom,right,top]=extent
  const norm=[(left-x0)/(x1-x0),(bottom-y0)/(y1-y0),(right-x0)/(x1-x0),(top-y0)/(y1-y0)]
  const candidates=atlas.query(norm).filter(item=>item.quarter>=minimumQuarter),lines=[]
  const uniformBand=Math.floor(anchor.value)
  if(!candidates.length){
   for(let start=0;start<height;start+=rowsPerChunk)yield {spans:this.uniform(width,Math.min(rowsPerChunk,height-start),uniformBand,start)}
   yield {complete:true};return
  }
  if(anchor.value<atlas.data.minQuarter/4||anchor.value>atlas.data.maxQuarter/4){yield {failed:true};return}
  const screen=(x,y)=>[(x*(x1-x0)+x0-left)/(right-left)*width,(top-(y*(y1-y0)+y0))/(top-bottom)*height]
  const midpoint=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2]
  const flatten=(a,b,c,d,quarter,depth)=>{
   const vx=d[0]-a[0],vy=d[1]-a[1],length=Math.hypot(vx,vy)
   const distance=p=>length?Math.abs(vy*p[0]-vx*p[1]+d[0]*a[1]-d[1]*a[0])/length:Math.hypot(p[0]-a[0],p[1]-a[1])
   if(depth>=this.maxDepth||Math.max(distance(b),distance(c))<=this.curveError){lines.push({a,d,quarter});return}
   const ab=midpoint(a,b),bc=midpoint(b,c),cd=midpoint(c,d),abc=midpoint(ab,bc),bcd=midpoint(bc,cd),m=midpoint(abc,bcd)
   flatten(a,ab,abc,m,quarter,depth+1);flatten(m,bcd,cd,d,quarter,depth+1)
  }
  for(const {curve,quarter} of candidates)flatten(screen(curve[0],curve[1]),screen(curve[2],curve[3]),screen(curve[4],curve[5]),screen(curve[6],curve[7]),quarter,0)
  const crossings=(axis,value)=>{
   const other=1-axis,result=[]
   for(const {a,d,quarter} of lines){
    // A half-open rule prevents double-counting shared contour vertices.
    if(!((a[axis]<=value&&value<d[axis])||(d[axis]<=value&&value<a[axis])))continue
    const coordinate=a[other]+(value-a[axis])/(d[axis]-a[axis])*(d[other]-a[other])
    result.push({coordinate,quarter})
   }
   return result.sort((a,b)=>a.coordinate-b.coordinate)
  }
  const cross=(band,quarter)=>{
   const high=quarter/4
   if(!Number.isInteger(high))return null
   if(band===high)return high-1
   if(band===high-1)return high
   return null
  }
  const anchorX=anchor.x,anchorY=anchor.y,anchorBand=uniformBand,vertical=crossings(0,anchorX)
  for(let chunkStart=0;chunkStart<height;chunkStart+=rowsPerChunk){
   const spans=[],chunkEnd=Math.min(height,chunkStart+rowsPerChunk)
   for(let row=chunkStart;row<chunkEnd;row++){
    const y=row+.5;let band=anchorBand
    const changes=vertical.filter(c=>c.coordinate>=Math.min(anchorY,y)&&c.coordinate<Math.max(anchorY,y))
    if(y<anchorY)changes.reverse()
    for(const c of changes){band=cross(band,c.quarter);if(band===null){yield {failed:true};return}}
    const horizontal=crossings(1,y).filter(c=>c.coordinate>=0&&c.coordinate<width),leftChanges=horizontal.filter(c=>c.coordinate<anchorX).reverse()
    for(const c of leftChanges){band=cross(band,c.quarter);if(band===null){yield {failed:true};return}}
    let start=0
    for(const c of horizontal){
     const end=Math.max(0,Math.min(width,Math.ceil(c.coordinate-.5)))
     if(end>start)spans.push({y:row,x:start,width:end-start,band})
     if(c.coordinate>=0&&c.coordinate<width){band=cross(band,c.quarter);if(band===null){yield {failed:true};return}}
     start=Math.max(start,end)
    }
    if(start<width)spans.push({y:row,x:start,width:width-start,band})
   }
   yield {spans}
  }
  yield {complete:true}
 }
}
