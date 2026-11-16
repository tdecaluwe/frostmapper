import {get,transform} from 'ol/proj.js'
import {DistortionField} from '../src/map/reprojection/distortion.js'
import {traceContours} from '../src/map/reprojection/contour-trace.js'
import {fitContour} from '../src/map/reprojection/curve-fit.js'

// The global source grid is intentionally coarse near Grieger's Galápagos
// singularity. Nested local samples add detail without making the full-world
// atlas large or expensive to generate.
export function refineTriptychialSourceAtlas(atlas,{tolerance=.05}={}){
 const domain=atlas.extent
 const field=new DistortionField(get('FROST:TRIPTYCHIAL'),get('EPSG:3857'))
 const round=value=>Math.round(value*1e8)/1e8
 const overlaps=(curve,box)=>{
  const xs=[curve[0],curve[2],curve[4],curve[6]],ys=[curve[1],curve[3],curve[5],curve[7]]
  return Math.max(...xs)>=box[0]&&Math.min(...xs)<=box[2]&&Math.max(...ys)>=box[1]&&Math.min(...ys)<=box[3]
 }
 const sample=(geographicBox,width,height,quarters)=>{
  const [left,bottom]=transform(geographicBox.slice(0,2),'EPSG:4326','EPSG:3857')
  const [right,top]=transform(geographicBox.slice(2),'EPSG:4326','EPSG:3857')
  const dx=(right-left)/(width-1),dy=(top-bottom)/(height-1),values=new Float64Array(width*height)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)values[y*width+x]=field.atSource([left+x*dx,bottom+y*dy])??NaN
  const normBox=[(left-domain[0])/(domain[2]-domain[0]),(bottom-domain[1])/(domain[3]-domain[1]),(right-domain[0])/(domain[2]-domain[0]),(top-domain[1])/(domain[3]-domain[1])]
  const levels=new Set(quarters)
  atlas.paths=atlas.paths.filter(path=>!levels.has(path.quarter)||!path.curves.some(curve=>overlaps(curve,normBox)))
  for(const quarter of quarters)for(const path of traceContours(values,width,height,quarter/4)){
   if(path.points.length<2)continue
   const curves=fitContour(path.points,tolerance).map(curve=>curve.flatMap(([x,y])=>{
    const px=(left+x*dx-domain[0])/(domain[2]-domain[0]),py=(bottom+y*dy-domain[1])/(domain[3]-domain[1])
    return [round(px),round(py)]
   }))
   atlas.paths.push({quarter,closed:path.closed,curves})
  }
 }
 sample([-96,-5,-84,5],1537,1025,[-8,-12])
 sample([-92,-2,-88,2],1025,1025,[-32,-28,-24,-20,-16,-12])
 sample([-90.5,-.5,-89.5,.5],1025,1025,[-32,-28,-24])
 return atlas
}

// The Galápagos point and the triptych borders need denser, locally fitted
// contours so open paths remain separable at the projection edge.
export function refineTriptychialTargetAtlas(atlas,{width=1025,height=1025,tolerance=.05}={}){
 const target=get('FROST:TRIPTYCHIAL'),source=get('EPSG:3857'),field=new DistortionField(target,source),domain=atlas.extent
 const round=value=>Math.round(value*1e8)/1e8
 const center=transform([-90,0],'EPSG:4326',target),regions=[
  [center[0]-3e6,domain[3]-5e6,center[0]+3e6,domain[3]],
  [-14e6,domain[1],-10e6,domain[1]+5e6],
  [10e6,domain[3]-5e6,14e6,domain[3]]
 ]
 for(const [left,bottom,right,top] of regions){
  const dx=(right-left)/(width-1),dy=(top-bottom)/(height-1),values=new Float64Array(width*height)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)values[y*width+x]=field.at([left+x*dx,top-y*dy])??NaN
  const box=[(left-domain[0])/(domain[2]-domain[0]),(bottom-domain[1])/(domain[3]-domain[1]),(right-domain[0])/(domain[2]-domain[0]),(top-domain[1])/(domain[3]-domain[1])]
  const overlaps=curve=>{
   const xs=[curve[0],curve[2],curve[4],curve[6]],ys=[curve[1],curve[3],curve[5],curve[7]]
   return Math.max(...xs)>=box[0]&&Math.min(...xs)<=box[2]&&Math.max(...ys)>=box[1]&&Math.min(...ys)<=box[3]
  }
  atlas.paths=atlas.paths.filter(path=>!path.curves.some(overlaps))
  for(let quarter=-80;quarter<=32;quarter+=4)for(const path of traceContours(values,width,height,quarter/4)){
   if(path.points.length<2)continue
   const curves=fitContour(path.points,tolerance).map(curve=>curve.flatMap(([x,y])=>[
    round((left+x*dx-domain[0])/(domain[2]-domain[0])),round((top-y*dy-domain[1])/(domain[3]-domain[1]))
   ]))
   atlas.paths.push({quarter,closed:path.closed,curves})
  }
 }
 return atlas
}
