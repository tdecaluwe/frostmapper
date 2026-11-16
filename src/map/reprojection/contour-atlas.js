import {DistortionField} from './distortion.js?v=atlas-fast-v2'
import {traceContoursMulti} from './contour-trace.js?v=atlas-fast-v2'
import {fitContour} from './curve-fit.js'
import {ContourAtlas} from './contour-atlas-index.js'
export {ContourAtlas} from './contour-atlas-index.js'

// Builds projection-pair contour data. Coordinates are normalized to
// the projection extent, independent of zoom and viewport dimensions.
export class ContourAtlasBuilder {
 constructor(target,source,{width=target.getCode()==='FROST:TRIPTYCHIAL'?2049:1025,height=target.getCode()==='FROST:TRIPTYCHIAL'?1025:513,minQuarter=-80,maxQuarter=32,tolerance=.2,coordinateProjection=target}={}){
  this.target=target;this.source=source;this.width=width;this.height=height
  this.coordinateProjection=coordinateProjection
  this.minQuarter=minQuarter;this.maxQuarter=maxQuarter;this.tolerance=tolerance
  this.field=new DistortionField(target,source)
 }
 build(){
  const [x0,y0,x1,y1]=this.coordinateProjection.getExtent(),{width,height}=this
  const dx=(x1-x0)/(width-1),dy=(y1-y0)/(height-1),values=new Float64Array(width*height)
  const sample=this.coordinateProjection===this.source?point=>this.field.atSource(point):point=>this.field.at(point)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)values[y*width+x]=sample([x0+x*dx,y0+y*dy])??NaN
  const paths=[]
  const round=value=>Math.round(value*1e7)/1e7
  const levels=[]
  for(let quarter=this.minQuarter;quarter<=this.maxQuarter;quarter+=4)levels.push(quarter)
  const contours=traceContoursMulti(values,width,height,levels.map(quarter=>quarter/4))
  for(const quarter of levels){
   for(const path of contours.get(quarter/4)||[]){
    if(path.points.length<2)continue
    const curves=fitContour(path.points,this.tolerance).map(curve=>curve.flatMap(([x,y])=>[round(x/(width-1)),round(y/(height-1))]))
    paths.push({quarter,closed:path.closed,curves})
   }
  }
  return {version:1,target:this.target.getCode(),source:this.source.getCode(),coordinateProjection:this.coordinateProjection.getCode(),extent:[x0,y0,x1,y1],minQuarter:this.minQuarter,maxQuarter:this.maxQuarter,paths}
 }
}
