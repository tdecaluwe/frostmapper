import {DistortionField} from './distortion.js'
import {traceContours} from './contour-trace.js'
import {fitContour} from './curve-fit.js'

// Builds static projection-pair contour data. Coordinates are normalized to
// the projection extent, independent of zoom and viewport dimensions.
export class ContourAtlasBuilder {
 constructor(target,source,{width=257,height=129,minQuarter=-32,maxQuarter=32,tolerance=.2}={}){
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
  for(let quarter=this.minQuarter;quarter<=this.maxQuarter;quarter++){
   for(const path of traceContours(values,width,height,quarter/4)){
    if(path.points.length<2)continue
    const curves=fitContour(path.points,this.tolerance).map(curve=>curve.flatMap(([x,y])=>[round(x/(width-1)),round(y/(height-1))]))
    paths.push({quarter,closed:path.closed,curves})
   }
  }
  return {version:1,target:this.target.getCode(),source:this.source.getCode(),extent:[x0,y0,x1,y1],minQuarter:this.minQuarter,maxQuarter:this.maxQuarter,paths}
 }
}

// Index individual Bézier segments using their control-point bounds. A curve
// always lies within those bounds; an exact intersection is left to rendering.
export class ContourAtlas {
 constructor(data,{indexSize=32}={}){
  if(data.version!==1||!Array.isArray(data.extent)||!Array.isArray(data.paths))throw Error('Invalid contour atlas')
  this.data=data;this.indexSize=indexSize;this.cells=new Map();this.segments=[]
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
 query(extent,phase){
  const [minX,minY,maxX,maxY]=extent
  if(maxX<0||minX>1||maxY<0||minY>1)return []
  const [x0,y0,x1,y1]=this.cellRange(extent),ids=new Set(),result=[]
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)for(const id of this.cells.get(y*this.indexSize+x)||[])ids.add(id)
  for(const id of ids){const s=this.segments[id],b=s.bounds;if((((s.quarter+phase)%4)+4)%4===0&&b[0]<=maxX&&b[2]>=minX&&b[1]<=maxY&&b[3]>=minY)result.push(s)}
  return result
 }
}
