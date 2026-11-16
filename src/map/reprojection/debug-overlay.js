import {transform} from 'ol/proj.js'

// Optional developer overlay, activated with ?debugBands=1.
export class ContourDebugOverlay{
 constructor(map,reprojection){
  this.map=map;this.reprojection=reprojection;this.canvas=document.createElement('canvas')
  Object.assign(this.canvas.style,{position:'absolute',left:'0',top:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'2'})
  map.getViewport().append(this.canvas);this.listener=map.on('postrender',()=>this.render())
 }
 render(){
  const {map,reprojection,canvas}=this,size=map.getSize();if(!size)return
  const ratio=window.devicePixelRatio||1,width=Math.round(size[0]*ratio),height=Math.round(size[1]*ratio)
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
  const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,...size)
  const atlas=reprojection.sourceAtlases.get(reprojection.signature)
  if(!atlas?.paths)return
  const projection=map.getView().getProjection(),domain=atlas.extent
  ctx.lineWidth=2
  for(const {curves,quarter} of atlas.paths){
   ctx.strokeStyle=quarter%8===0?'#ff1758':'#00b6ff'
   for(const curve of curves){
    ctx.beginPath();let started=false
    for(let step=0;step<=24;step++){
     const t=step/24,u=1-t,x=u*u*u*curve[0]+3*u*u*t*curve[2]+3*u*t*t*curve[4]+t*t*t*curve[6],y=u*u*u*curve[1]+3*u*u*t*curve[3]+3*u*t*t*curve[5]+t*t*t*curve[7]
     let pixel
     try{pixel=map.getPixelFromCoordinate(transform([domain[0]+x*(domain[2]-domain[0]),domain[1]+y*(domain[3]-domain[1])],'EPSG:3857',projection))}catch{pixel=null}
     if(!pixel||!pixel.every(Number.isFinite)){started=false;continue}
     if(!started){ctx.moveTo(...pixel);started=true}else ctx.lineTo(...pixel)
    }
    ctx.stroke()
   }
  }
 }
}
