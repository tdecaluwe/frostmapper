// Visibility is measured in the displayed projection. The callback accepts
// atlas coordinates; it uses projection evaluations only. No field derivatives.
export class ContourVisibility {
 constructor({minPatchPixels=10,highestZoom=20,extent=[0,0,1,1],project=p=>p,resolutionAtZoom=z=>Math.max(extent[2]-extent[0],extent[3]-extent[1])/256/2**z,worldWidth=0,discoverySafety=2,zoomOffset=0}={}){
  if(!Number.isFinite(zoomOffset)||zoomOffset<0||!Number.isFinite(highestZoom)||highestZoom<0||!extent||extent.length!==4||typeof extent.every!=='function'||!extent.every(Number.isFinite)||extent[2]<=extent[0]||extent[3]<=extent[1]||!Number.isFinite(minPatchPixels)||minPatchPixels<0||!Number.isFinite(worldWidth)||worldWidth<0||!Number.isFinite(discoverySafety)||discoverySafety<1||typeof project!=='function'||typeof resolutionAtZoom!=='function')throw Error('Invalid contour visibility settings')
  Object.assign(this,{minPatchPixels,highestZoom,project,resolutionAtZoom,worldWidth,discoverySafety,zoomOffset,extent:extent.slice()})
  this.enabled=minPatchPixels>0
 }
 zoom(level){const maximum=Math.max(0,this.highestZoom-this.zoomOffset);return Math.max(0,Math.min(maximum,maximum+level))}
 resolution(level){try{const r=this.resolutionAtZoom(this.zoom(level));return Number.isFinite(r)&&r>0?r:NaN}catch{return NaN}}
 // Input is in normalized atlas coordinates. Periodic source paths stay
 // lifted; projected x is unwrapped along the sequence before measuring it.
 pixels(points,level,charge=()=>{}){
  const resolution=this.resolution(level)
  if(!Number.isFinite(resolution))return Infinity
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,lastX=null
  for(const p of points){
   const e=this.extent,q=[e[0]+p[0]*(e[2]-e[0]),e[1]+p[1]*(e[3]-e[1])]
   charge()
   let v;try{v=this.project(q)}catch{return Infinity}
   if(!v?.every(Number.isFinite))return Infinity
   let x=v[0];if(this.worldWidth>0&&lastX!==null)x+=Math.round((lastX-x)/this.worldWidth)*this.worldWidth
   lastX=x;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,v[1]);maxY=Math.max(maxY,v[1])
  }
  return Math.max(maxX-minX,maxY-minY)/resolution
 }
 visible(points,level,charge,safety=1){return !this.enabled||this.pixels(points,level,charge)*safety>=this.minPatchPixels}
}
