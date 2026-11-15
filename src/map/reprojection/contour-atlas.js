import {DistortionField} from './distortion.js'
import {traceContours} from './contour-trace.js'
import {fitContour} from './curve-fit.js'

// Builds static projection-pair contour data. Coordinates are normalized to
// the projection extent, independent of zoom and viewport dimensions.
export class ContourAtlasBuilder {
 constructor(target,source,{width=target.getCode()==='FROST:TRIPTYCHIAL'?2049:1025,height=target.getCode()==='FROST:TRIPTYCHIAL'?1025:513,minQuarter=-32,maxQuarter=32,tolerance=.2}={}){
  this.target=target;this.source=source;this.width=width;this.height=height
  this.minQuarter=minQuarter;this.maxQuarter=maxQuarter;this.tolerance=tolerance
  this.field=new DistortionField(target,source)
 }
 build(){
  const [x0,y0,x1,y1]=this.target.getExtent(),{width,height}=this
  const dx=(x1-x0)/(width-1),dy=(y1-y0)/(height-1),values=new Float64Array(width*height)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)values[y*width+x]=this.field.at([x0+x*dx,y0+y*dy])??NaN
  const paths=[]
  const round=value=>Math.round(value*1e7)/1e7
  for(let quarter=this.minQuarter;quarter<=this.maxQuarter;quarter+=4){
   for(const path of traceContours(values,width,height,quarter/4)){
    if(path.points.length<2)continue
    const curves=fitContour(path.points,this.tolerance).map(curve=>curve.flatMap(([x,y])=>[round(x/(width-1)),round(y/(height-1))]))
    paths.push({quarter,closed:path.closed,curves})
   }
  }
  // Coarse conservative complexity map, computed once during generation.
  // Smooth, fully valid cells need no expensive per-tile field validation.
  const columns=64,rows=32,bits=new Uint8Array(Math.ceil(columns*rows/8))
  for(let by=0;by<rows;by++)for(let bx=0;bx<columns;bx++){
   let min=Infinity,max=-Infinity,invalid=false
   const xa=Math.floor(bx*(width-1)/columns),xb=Math.ceil((bx+1)*(width-1)/columns)
   const ya=Math.floor(by*(height-1)/rows),yb=Math.ceil((by+1)*(height-1)/rows)
   for(let y=ya;y<=yb;y++)for(let x=xa;x<=xb;x++){
    const value=values[y*width+x]
    if(!Number.isFinite(value)){invalid=true;continue}
    min=Math.min(min,value);max=Math.max(max,value)
   }
   if(invalid||max-min>.75||min<this.minQuarter/4+.25||max>this.maxQuarter/4-.25){const i=by*columns+bx;bits[i>>3]|=1<<(i&7)}
  }
  const complexity={columns,rows,unsafe:btoa(String.fromCharCode(...bits))}
  return {version:1,target:this.target.getCode(),source:this.source.getCode(),extent:[x0,y0,x1,y1],minQuarter:this.minQuarter,maxQuarter:this.maxQuarter,complexity,paths}
 }
}

// Index individual Bézier segments using their control-point bounds. A curve
// always lies within those bounds; an exact intersection is left to rendering.
export class ContourAtlas {
 constructor(data,{indexSize=32}={}){
  if(data.version!==1||!Array.isArray(data.extent)||!Array.isArray(data.paths))throw Error('Invalid contour atlas')
  this.data=data;this.indexSize=indexSize;this.cells=new Map();this.segments=[]
  if(data.complexity){
   const {columns,rows,unsafe}=data.complexity,bytes=atob(unsafe),stride=columns+1
   this.complexity={columns,rows,stride,prefix:new Uint32Array((columns+1)*(rows+1))}
   const prefix=this.complexity.prefix
   for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    const i=y*columns+x,value=(bytes.charCodeAt(i>>3)>>(i&7))&1,k=(y+1)*stride+x+1
    prefix[k]=value+prefix[k-1]+prefix[k-stride]-prefix[k-stride-1]
   }
  }
  for(const path of data.paths)for(const curve of path.curves){
   const xs=[curve[0],curve[2],curve[4],curve[6]],ys=[curve[1],curve[3],curve[5],curve[7]]
   const segment={quarter:path.quarter,curve,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]},id=this.segments.push(segment)-1
   const [x0,y0,x1,y1]=this.cellRange(segment.bounds)
   for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const key=y*indexSize+x;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(id)
   }
  }
 }
 cellRange(extent){const clamp=value=>Math.max(0,Math.min(this.indexSize-1,Math.floor(value*this.indexSize)));return extent.map(clamp)}
 canSkipValidation(extent){
  const c=this.complexity
  if(!c||extent[0]<0||extent[1]<0||extent[2]>1||extent[3]>1)return false
  const x0=Math.max(0,Math.min(c.columns-1,Math.floor(extent[0]*c.columns))),x1=Math.max(0,Math.min(c.columns,Math.ceil(extent[2]*c.columns)))
  const y0=Math.max(0,Math.min(c.rows-1,Math.floor(extent[1]*c.rows))),y1=Math.max(0,Math.min(c.rows,Math.ceil(extent[3]*c.rows)))
  const p=c.prefix,s=c.stride
  return p[y1*s+x1]-p[y0*s+x1]-p[y1*s+x0]+p[y0*s+x0]===0
 }
 query(extent){
  const [minX,minY,maxX,maxY]=extent
  if(maxX<0||minX>1||maxY<0||minY>1)return []
  const [x0,y0,x1,y1]=this.cellRange(extent),ids=new Set(),result=[]
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)for(const id of this.cells.get(y*this.indexSize+x)||[])ids.add(id)
  for(const id of ids){const s=this.segments[id],b=s.bounds;if(b[0]<=maxX&&b[2]>=minX&&b[1]<=maxY&&b[3]>=minY)result.push(s)}
  return result
 }
}
