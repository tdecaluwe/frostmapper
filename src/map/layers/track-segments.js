import {getDistance} from 'ol/sphere.js'

// Split once in geographic space, independently of the displayed projection.
// The radius matches the Mercator ground-distance calculation used by routing.
export function kilometreSegments(coordinates,interval=1000,offset=0){
 if(!Number.isFinite(interval)||interval<=0||!Number.isFinite(offset)||offset<0)throw Error('Invalid track interval')
 if(coordinates.length<2)return []
 const segments=[];let part=[coordinates[0]],remaining=interval-(offset%interval)
 for(let i=1;i<coordinates.length;i++){
  let start=coordinates[i-1],end=coordinates[i],distance=getDistance(start,end,6378137)
  while(distance>=remaining && distance>1e-7){
   const fraction=remaining/distance,point=start.map((value,axis)=>value+(end[axis]-value)*fraction)
   part.push(point);segments.push(part);part=[point];start=point
   distance=getDistance(start,end,6378137);remaining=interval
  }
  if(distance>1e-7){part.push(end);remaining-=distance}
 }
 if(part.length>1)segments.push(part)
 return segments
}

export function trackDistance(coordinates){
 let distance=0
 for(let i=1;i<coordinates.length;i++)distance+=getDistance(coordinates[i-1],coordinates[i],6378137)
 return distance
}
