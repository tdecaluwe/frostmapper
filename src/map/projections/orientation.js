import {transform} from 'ol/proj.js'

const SAMPLES=32
const MIN_SAMPLES=8

// Fallback for a circle that crosses too many cuts or invalid regions.
function gridNorthAngle(projection,coordinate){
 let lonLat
 try{lonLat=transform(coordinate,projection,'EPSG:4326')}catch{return null}
 const [lon,lat]=lonLat
 if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lat)>=89.999999)return null
 const step=Math.min(.0001,(90-Math.abs(lat))/2)
 let south,north
 try{
  south=transform([lon,lat-step],'EPSG:4326',projection)
  north=transform([lon,lat+step],'EPSG:4326',projection)
 }catch{return null}
 if(!south.every(Number.isFinite)||!north.every(Number.isFinite))return null
 let dx=north[0]-south[0]
 const dy=north[1]-south[1],extent=projection.getExtent()
 const worldWidth=extent&&extent[2]-extent[0]
 if(projection.canWrapX()&&Number.isFinite(worldWidth)&&worldWidth>0)dx-=worldWidth*Math.round(dx/worldWidth)
 const length=Math.hypot(dx,dy)
 if(!Number.isFinite(length)||length<1e-6||(Number.isFinite(worldWidth)&&length>worldWidth/100))return null
 return Math.atan2(dx,dy)
}

function localRotation(sourceView,targetView){
 const source=gridNorthAngle(sourceView.getProjection(),sourceView.getCenter())
 const target=gridNorthAngle(targetView.getProjection(),targetView.getCenter())
 if(source===null||target===null)return null
 const angle=sourceView.getRotation()+source-target
 return Math.atan2(Math.sin(angle),Math.cos(angle))
}

// Estimate one rotation from the directions of corresponding points on the
// inscribed viewport circle. Circular averaging handles the ±π boundary.
export function equivalentRotation(sourceView,targetView,size){
 if(!size||size.length!==2||!size.every(value=>Number.isFinite(value)&&value>0))return localRotation(sourceView,targetView)
 const sourceProjection=sourceView.getProjection(),targetProjection=targetView.getProjection()
 const sourceCenter=sourceView.getCenter(),targetCenter=targetView.getCenter(),resolution=sourceView.getResolution()
 if(!sourceCenter||!targetCenter||!Number.isFinite(resolution)||resolution<=0)return localRotation(sourceView,targetView)
 const radius=Math.min(...size)/2,rotation=sourceView.getRotation(),cos=Math.cos(rotation),sin=Math.sin(rotation)
 const sourceExtent=sourceProjection.getExtent(),targetExtent=targetProjection.getExtent(),width=targetExtent&&targetExtent[2]-targetExtent[0]
 let sinSum=0,cosSum=0,count=0
 for(let i=0;i<SAMPLES;i++){
  const angle=2*Math.PI*i/SAMPLES,px=radius*Math.cos(angle),py=radius*Math.sin(angle)
  const point=[sourceCenter[0]+resolution*(cos*px+sin*py),sourceCenter[1]+resolution*(sin*px-cos*py)]
  if(sourceExtent&&(point[1]<sourceExtent[1]||point[1]>sourceExtent[3]))continue
  if(sourceExtent&&!sourceProjection.canWrapX()&&(point[0]<sourceExtent[0]||point[0]>sourceExtent[2]))continue
  let lonLat,projected
  try{
   lonLat=transform(point,sourceProjection,'EPSG:4326')
   if(!lonLat.every(Number.isFinite)||Math.abs(lonLat[1])>90)continue
   projected=transform(lonLat,'EPSG:4326',targetProjection)
  }catch{continue}
  if(!projected.every(Number.isFinite))continue
  if(targetExtent&&(projected[1]<targetExtent[1]||projected[1]>targetExtent[3]))continue
  if(targetExtent&&!targetProjection.canWrapX()&&(projected[0]<targetExtent[0]||projected[0]>targetExtent[2]))continue
  let dx=projected[0]-targetCenter[0]
  if(targetProjection.canWrapX()&&Number.isFinite(width)&&width>0)dx-=width*Math.round(dx/width)
  const dy=projected[1]-targetCenter[1]
  if(!Number.isFinite(dx)||!Number.isFinite(dy)||Math.hypot(dx,dy)<1e-6)continue
  const screenDirection=Math.atan2(px,-py),targetDirection=Math.atan2(dx,dy)
  const shift=screenDirection-targetDirection
  sinSum+=Math.sin(shift);cosSum+=Math.cos(shift);count++
 }
 // If the shifts cancel out, no stable average exists at this view.
 if(count<MIN_SAMPLES||Math.hypot(sinSum,cosSum)/count<.1)return localRotation(sourceView,targetView)
 return Math.atan2(sinSum,cosSum)
}
