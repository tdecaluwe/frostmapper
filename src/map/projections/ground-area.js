import {transform,getPointResolution} from 'ol/proj.js'

const EARTH_RADIUS=6371008.8
const RADIANS=Math.PI/180

// A unit vector avoids longitude wrapping problems at the antimeridian and poles.
function unitVector(coordinate,projection){
 const [lon,lat]=transform(coordinate,projection,'EPSG:4326')
 if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lat)>90.000001)return null
 const phi=lat*RADIANS,lambda=lon*RADIANS,cosPhi=Math.cos(phi)
 return [cosPhi*Math.cos(lambda),cosPhi*Math.sin(lambda),Math.sin(phi)]
}

// Approximate the local Jacobian's area scale in square ground metres per
// square projected unit. Central differences account for unequal horizontal
// and vertical distortion; rotation does not change the determinant.
export function groundAreaScale(projection,center,resolution){
 if(!center||!Number.isFinite(resolution)||resolution<=0)return null
 const step=Math.max(1,Math.min(1000,resolution*4)),[x,y]=center
 let points
 try{points=[[x-step,y],[x+step,y],[x,y-step],[x,y+step]].map(point=>unitVector(point,projection))}
 catch{return null}
 if(points.some(point=>!point))return null
 const dx=points[1].map((value,i)=>value-points[0][i]),dy=points[3].map((value,i)=>value-points[2][i])
 // A huge geographic jump over a small projected distance indicates a cut.
 if(Math.hypot(...dx)>0.25||Math.hypot(...dy)>0.25)return null
 const cross=[dx[1]*dy[2]-dx[2]*dy[1],dx[2]*dy[0]-dx[0]*dy[2],dx[0]*dy[1]-dx[1]*dy[0]]
 const area=Math.hypot(...cross)*(EARTH_RADIUS/(2*step))**2
 return Number.isFinite(area)&&area>1e-16?area:null
}

export function equivalentResolution(sourceView,targetView){
 const sourceResolution=sourceView.getResolution(),targetResolution=targetView.getResolution()
 if(!Number.isFinite(sourceResolution)||sourceResolution<=0||!Number.isFinite(targetResolution)||targetResolution<=0)return null
 const sourceProjection=sourceView.getProjection(),targetProjection=targetView.getProjection()
 const sourceCenter=sourceView.getCenter(),targetCenter=targetView.getCenter()
 const from=groundAreaScale(sourceProjection,sourceCenter,sourceResolution)
 const to=groundAreaScale(targetProjection,targetCenter,targetResolution)
 if(from!==null&&to!==null){const result=sourceResolution*Math.sqrt(from/to);if(Number.isFinite(result)&&result>0)return result}
 // At a projection cut or singularity, try OpenLayers' local linear scale.
 try{
  const sourceMeters=getPointResolution(sourceProjection,sourceResolution,sourceCenter,'m')
  const targetMeters=getPointResolution(targetProjection,1,targetCenter,'m')
  const result=sourceMeters/targetMeters
  return Number.isFinite(result)&&result>0?result:null
 }catch{return null}
}

// Estimate area per viewport pixel across a small grid. This improves wide
// views where projection distortion varies substantially across the screen.
function viewportAreaPerPixel(view,resolution,size){
 if(!size||size.length!==2||!size.every(value=>Number.isFinite(value)&&value>0))return null
 const center=view.getCenter(),projection=view.getProjection(),rotation=view.getRotation(),cos=Math.cos(rotation),sin=Math.sin(rotation)
 if(!center)return null
 const samples=4;let sum=0,valid=0
 for(let row=0;row<samples;row++)for(let col=0;col<samples;col++){
  const dx=((col+.5)/samples-.5)*size[0]*resolution
  const dy=-((row+.5)/samples-.5)*size[1]*resolution
  const point=[center[0]+dx*cos-dy*sin,center[1]+dx*sin+dy*cos]
  const area=groundAreaScale(projection,point,resolution)
  if(area!==null){sum+=area;valid++}
 }
 if(valid<samples*samples/2)return null
 const result=sum/(samples*samples)*resolution**2
 return Number.isFinite(result)&&result>0?result:null
}

export function equivalentViewportResolution(sourceView,targetView,size){
 let resolution=equivalentResolution(sourceView,targetView)
 if(resolution===null||!size||!size.every(Number.isFinite))return resolution
 // Local scale is enough for close views and avoids needless sampling.
 if(sourceView.getResolution()*Math.max(...size)<1000000)return resolution
 const sourceArea=viewportAreaPerPixel(sourceView,sourceView.getResolution(),size)
 if(sourceArea===null)return resolution
 for(let i=0;i<3;i++){
  const targetArea=viewportAreaPerPixel(targetView,resolution,size)
  if(targetArea===null)break
  const factor=Math.max(.5,Math.min(2,Math.sqrt(sourceArea/targetArea)))
  resolution*=factor
  if(Math.abs(factor-1)<.001)break
 }
 return Number.isFinite(resolution)&&resolution>0?resolution:null
}
