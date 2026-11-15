// Produce per-row spans from the shared vector contours. Every span refers to
// a distortion band; clipping and reprojection are the renderer's job.
export class BandMaskPlanner {
 constructor({maxDepth=16,curveError=.2}={}){this.maxDepth=maxDepth;this.curveError=curveError}
 plan(atlas,extent,width,height,anchorValue){
  if(!Number.isFinite(anchorValue)||anchorValue<atlas.data.minQuarter/4||anchorValue>atlas.data.maxQuarter/4)return null
  const [x0,y0,x1,y1]=atlas.data.extent,[left,bottom,right,top]=extent
  const norm=[(left-x0)/(x1-x0),(bottom-y0)/(y1-y0),(right-x0)/(x1-x0),(top-y0)/(y1-y0)]
  const candidates=atlas.query(norm),lines=[]
  if(!candidates.length)return [{x:0,y:0,width,height,band:Math.floor(anchorValue)}]
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
  const anchorX=width/2,anchorY=height/2,anchorBand=Math.floor(anchorValue),vertical=crossings(0,anchorX),spans=[]
  for(let row=0;row<height;row++){
   const y=row+.5;let band=anchorBand
   const changes=vertical.filter(c=>c.coordinate>=Math.min(anchorY,y)&&c.coordinate<Math.max(anchorY,y))
   if(y<anchorY)changes.reverse()
   for(const c of changes){band=cross(band,c.quarter);if(band===null)return null}
   const horizontal=crossings(1,y).filter(c=>c.coordinate>=0&&c.coordinate<width),leftChanges=horizontal.filter(c=>c.coordinate<anchorX).reverse()
   for(const c of leftChanges){band=cross(band,c.quarter);if(band===null)return null}
   let start=0
   for(const c of horizontal){
    const end=Math.max(0,Math.min(width,Math.ceil(c.coordinate-.5)))
    if(end>start)spans.push({y:row,x:start,width:end-start,band})
    if(c.coordinate>=0&&c.coordinate<width){band=cross(band,c.quarter);if(band===null)return null}
    start=Math.max(start,end)
   }
   if(start<width)spans.push({y:row,x:start,width:width-start,band})
  }
  return spans
 }

 // Curves are approximations and can stop at cuts. Detect unreliable plans
 // before requesting images and let the caller use ordinary reprojection.
 validate(spans,extent,width,height,field,{samples=9,tolerance=.15}={}){
  const [left,bottom,right,top]=extent
  for(let row=0;row<samples;row++)for(let col=0;col<samples;col++){
   const x=Math.min(width-1,Math.floor((col+.5)*width/samples)),y=Math.min(height-1,Math.floor((row+.5)*height/samples))
   const value=field.at([left+(x+.5)/width*(right-left),top-(y+.5)/height*(top-bottom)])
   if(value===null)continue
   const shifted=value
   if(Math.abs(shifted-Math.round(shifted))<=tolerance)continue
   const span=spans.find(s=>s.y<=y&&s.y+(s.height||1)>y&&s.x<=x&&s.x+s.width>x)
   if(!span||span.band!==Math.floor(shifted))return false
  }
  return true
 }

 // In the small regions where a fixed curve is unreliable (typically a cut
 // or singularity), approximate the field on a shared grid. Samples include
 // tile edges, so neighboring tiles obtain the same boundary values. This is
 // only used after contour planning/validation fails and is cached per tile.
 sampledPlan(extent,width,height,field,{cells=12,maxPixels=262144}={}){
  if(width*height>maxPixels)return null
  const [left,bottom,right,top]=extent,n=cells+1,grid=new Float64Array(n*n)
  let valid=0
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
   const value=field.at([left+(right-left)*x/cells,top-(top-bottom)*y/cells])
   grid[y*n+x]=value===null?NaN:value;if(Number.isFinite(grid[y*n+x]))valid++
  }
  if(!valid)return null
  const spans=[]
  for(let y=0;y<height;y++){
   const gy=(y+.5)*cells/height,iy=Math.min(cells-1,Math.floor(gy)),ty=gy-iy
   let start=0,previous=null
   for(let x=0;x<width;x++){
    const gx=(x+.5)*cells/width,ix=Math.min(cells-1,Math.floor(gx)),tx=gx-ix
    const a=grid[iy*n+ix],b=grid[iy*n+ix+1],c=grid[(iy+1)*n+ix],d=grid[(iy+1)*n+ix+1]
    const wa=(1-tx)*(1-ty),wb=tx*(1-ty),wc=(1-tx)*ty,wd=tx*ty
    let value=0,weight=0
    if(Number.isFinite(a)){value+=a*wa;weight+=wa}
    if(Number.isFinite(b)){value+=b*wb;weight+=wb}
    if(Number.isFinite(c)){value+=c*wc;weight+=wc}
    if(Number.isFinite(d)){value+=d*wd;weight+=wd}
    const band=weight>0?Math.floor(value/weight):null
    if(x&&band!==previous){if(previous!==null)spans.push({y,x:start,width:x-start,band:previous});start=x}
    previous=band
   }
   if(previous!==null)spans.push({y,x:start,width:width-start,band:previous})
  }
  return spans.length?spans:null
 }
}
