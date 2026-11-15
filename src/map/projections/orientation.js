import {transform} from 'ol/proj.js'

const SAMPLES=32
const RADII=[1,.5,.25,.125]
const normalize=angle=>Math.atan2(Math.sin(angle),Math.cos(angle))
function smoothstep(low,high,value){const t=Math.max(0,Math.min(1,(value-low)/(high-low)));return t*t*(3-2*t)}

// Local-north fallback when the circles cannot determine a stable rotation.
function gridNorthAngle(projection,coordinate){
 let lonLat
 try{lonLat=transform(coordinate,projection,'EPSG:4326')}catch{return null}
 const [lon,lat]=lonLat
 if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lat)>=89.999999)return null
 const step=Math.min(.0001,(90-Math.abs(lat))/2)
 let south,north
 try{south=transform([lon,lat-step],'EPSG:4326',projection);north=transform([lon,lat+step],'EPSG:4326',projection)}catch{return null}
 if(!south.every(Number.isFinite)||!north.every(Number.isFinite))return null
 let dx=north[0]-south[0]
 const dy=north[1]-south[1],extent=projection.getExtent(),worldWidth=extent&&extent[2]-extent[0]
 if(projection.canWrapX()&&Number.isFinite(worldWidth)&&worldWidth>0)dx-=worldWidth*Math.round(dx/worldWidth)
 const length=Math.hypot(dx,dy)
 if(!Number.isFinite(length)||length<1e-6||(Number.isFinite(worldWidth)&&length>worldWidth/100))return null
 return Math.atan2(dx,dy)
}
function localRotation(sourceView,targetView){
 const source=gridNorthAngle(sourceView.getProjection(),sourceView.getCenter())
 const target=gridNorthAngle(targetView.getProjection(),targetView.getCenter())
 return source===null||target===null?null:normalize(sourceView.getRotation()+source-target)
}

// Fade points near configured extent boundaries, so losing a sample does not
// abruptly change the result. A source's imagery coverage is not its domain.
function extentWeight(point,projection,margin){
 const extent=projection.getExtent()
 if(!extent)return 1
 let distance=Math.min(point[1]-extent[1],extent[3]-point[1])
 if(!projection.canWrapX())distance=Math.min(distance,point[0]-extent[0],extent[2]-point[0])
 return smoothstep(0,Math.max(1,margin),distance)
}

function circleStats(sourceView,targetView,size,radiusFraction){
 const sourceProjection=sourceView.getProjection(),targetProjection=targetView.getProjection()
 const sourceCenter=sourceView.getCenter(),targetCenter=targetView.getCenter(),resolution=sourceView.getResolution()
 const radius=Math.min(...size)/2*radiusFraction,rotation=sourceView.getRotation(),cos=Math.cos(rotation),sin=Math.sin(rotation)
 const targetExtent=targetProjection.getExtent(),worldWidth=targetExtent&&targetExtent[2]-targetExtent[0]
 const sourceMargin=resolution*Math.max(2,radius*.03),targetMargin=(targetView.getResolution()||resolution)*Math.max(2,radius*.03)
 let sinSum=0,cosSum=0,totalWeight=0,xx=0,yy=0,xy=0
 for(let i=0;i<SAMPLES;i++){
  const angle=2*Math.PI*i/SAMPLES,ux=Math.cos(angle),uy=Math.sin(angle),px=radius*ux,py=radius*uy
  const point=[sourceCenter[0]+resolution*(cos*px+sin*py),sourceCenter[1]+resolution*(sin*px-cos*py)]
  let weight=extentWeight(point,sourceProjection,sourceMargin)
  if(weight<=0)continue
  let lonLat,projected
  try{
   lonLat=transform(point,sourceProjection,'EPSG:4326')
   if(!lonLat.every(Number.isFinite)||Math.abs(lonLat[1])>90)continue
   projected=transform(lonLat,'EPSG:4326',targetProjection)
  }catch{continue}
  if(!projected.every(Number.isFinite))continue
  weight*=extentWeight(projected,targetProjection,targetMargin)
  if(weight<=0)continue
  let dx=projected[0]-targetCenter[0]
  if(targetProjection.canWrapX()&&Number.isFinite(worldWidth)&&worldWidth>0)dx-=worldWidth*Math.round(dx/worldWidth)
  const dy=projected[1]-targetCenter[1]
  if(!Number.isFinite(dx)||!Number.isFinite(dy)||Math.hypot(dx,dy)<1e-6)continue
  const shift=Math.atan2(px,-py)-Math.atan2(dx,dy)
  sinSum+=weight*Math.sin(shift);cosSum+=weight*Math.cos(shift);totalWeight+=weight
  xx+=weight*ux*ux;yy+=weight*uy*uy;xy+=weight*ux*uy
 }
 if(totalWeight<=0)return null
 const coherence=Math.hypot(sinSum,cosSum)/totalWeight,coverage=totalWeight/SAMPLES
 // A narrow arc alone is a poor representation, even if its angles agree.
 const balance=1-Math.hypot(xx-yy,2*xy)/totalWeight
 const quality=smoothstep(.94,.98,coherence)*smoothstep(.35,.75,coverage)*smoothstep(.05,.3,balance)
 return {angle:Math.atan2(sinSum,cosSum),quality,radius:radiusFraction,coherence,coverage}
}

// Circularly blend from the smallest reliable circle outwards. The outermost
// circle wins when its coverage and angular agreement are both good.
export function blendCircleRotations(circles,fallback){
 let angle=fallback
 for(let i=circles.length-1;i>=0;i--){
  const circle=circles[i]
  if(circle&&circle.quality>0)angle=normalize(angle+circle.quality*normalize(circle.angle-angle))
 }
 return angle
}

export function equivalentRotation(sourceView,targetView,size){
 const fallback=localRotation(sourceView,targetView)??sourceView.getRotation()
 if(!size||size.length!==2||!size.every(value=>Number.isFinite(value)&&value>0))return fallback
 const sourceCenter=sourceView.getCenter(),targetCenter=targetView.getCenter(),resolution=sourceView.getResolution()
 if(!sourceCenter||!targetCenter||!Number.isFinite(resolution)||resolution<=0)return fallback
 const circles=[]
 for(const radius of RADII){
  const stats=circleStats(sourceView,targetView,size,radius)
  circles.push(stats)
  if(stats&&stats.quality>=1-1e-12)break
 }
 return blendCircleRotations(circles,fallback)
}
