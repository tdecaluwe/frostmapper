import {get,transform} from 'https://esm.sh/ol@10.6.1/proj.js'
import {DistortionField} from '../src/map/reprojection/distortion.js?v=atlas-fast-v2'
import {traceContoursMulti} from '../src/map/reprojection/contour-trace.js?v=atlas-fast-v2'
import {fitContour} from '../src/map/reprojection/curve-fit.js'
import {buildAdaptiveContourPaths,createAdaptiveContourWorkspace} from '../src/map/reprojection/adaptive-contours.js?v=atlas-fast-v3'

export function buildTriptychialSourceBaseAtlas(target,source,{maxQuarter=32,maxDepthX=9,maxDepthY=9,curvatureTolerance=.25,workspace=createAdaptiveContourWorkspace(maxDepthX,maxDepthY)}={}){
 const extent=source.getExtent(),field=new DistortionField(target,source),levels=[]
 for(let quarter=-80;quarter<=maxQuarter;quarter+=4)levels.push({quarter,value:quarter/4})
 const paths=buildAdaptiveContourPaths({sample:point=>field.atSource(point),extent,atlasExtent:extent,levels,maxDepthX,maxDepthY,curvatureTolerance,workspace})
 return {version:1,target:target.getCode(),source:source.getCode(),coordinateProjection:source.getCode(),extent,minQuarter:-80,maxQuarter,paths}
}

// Successive source-space passes add detail only where the distortion field
// changes enough to bend or cross an important zoom contour.
export function* refineTriptychialSourceAtlasPasses(atlas,{workspace=createAdaptiveContourWorkspace(9,9)}={}){
 const domain=atlas.extent
 const field=new DistortionField(get('FROST:TRIPTYCHIAL'),get('EPSG:3857'))
 const overlaps=(curve,box)=>{
  const xs=[curve[0],curve[2],curve[4],curve[6]],ys=[curve[1],curve[3],curve[5],curve[7]]
  return Math.max(...xs)>=box[0]&&Math.min(...xs)<=box[2]&&Math.max(...ys)>=box[1]&&Math.min(...ys)<=box[3]
 }
 const adaptive=(geographicBox,quarters,depthX,depthY=depthX)=>{
  const [left,bottom]=transform(geographicBox.slice(0,2),'EPSG:4326','EPSG:3857')
  const [right,top]=transform(geographicBox.slice(2),'EPSG:4326','EPSG:3857')
  const box=[(left-domain[0])/(domain[2]-domain[0]),(bottom-domain[1])/(domain[3]-domain[1]),(right-domain[0])/(domain[2]-domain[0]),(top-domain[1])/(domain[3]-domain[1])]
  const paths=buildAdaptiveContourPaths({
   sample:point=>field.atSource(point),extent:[left,bottom,right,top],atlasExtent:domain,
   levels:quarters.map(quarter=>({quarter,value:quarter/4})),maxDepthX:depthX,maxDepthY:depthY,workspace
  })
  const levels=new Set(quarters)
  atlas.paths=atlas.paths.filter(path=>!levels.has(path.quarter)||!path.curves.some(curve=>overlaps(curve,box)))
  atlas.paths.push(...paths)
 }
 adaptive([-96,-5,-84,5],[-8,-12],9,9)
 yield {stage:'broad-region',atlas}
 adaptive([-92,-2,-88,2],[-32,-28,-24,-20,-16,-12],8,8)
 yield {stage:'galapagos-region',atlas}
 adaptive([-90.5,-.5,-89.5,.5],[-32,-28,-24],9,9)
 yield {stage:'singularity-region',atlas}
 return atlas
}

export function refineTriptychialSourceAtlas(atlas,options={}){
 const passes=refineTriptychialSourceAtlasPasses(atlas,options)
 while(!passes.next().done){}
 return atlas
}

// The Galápagos point and the triptych borders need denser, locally fitted
// contours so open paths remain separable at the projection edge.
export function refineTriptychialTargetAtlas(atlas,{width=1025,height=1025,tolerance=.05,maxQuarter=32}={}){
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
  const quarters=[];for(let quarter=-80;quarter<=maxQuarter;quarter+=4)quarters.push(quarter)
  const contours=traceContoursMulti(values,width,height,quarters.map(quarter=>quarter/4))
  for(const quarter of quarters)for(const path of contours.get(quarter/4)||[]){
   if(path.points.length<2)continue
   const curves=fitContour(path.points,tolerance).map(curve=>curve.flatMap(([x,y])=>[
    round((left+x*dx-domain[0])/(domain[2]-domain[0])),round((top-y*dy-domain[1])/(domain[3]-domain[1]))
   ]))
   atlas.paths.push({quarter,closed:path.closed,curves})
  }
 }
 return atlas
}
