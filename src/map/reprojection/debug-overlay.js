// Optional developer overlay, activated with ?debugBands=1. It shows the
// selected Bézier contours without changing tile requests or composition.
export class ContourDebugOverlay {
 constructor(map,reprojection){
  this.map=map;this.reprojection=reprojection
  this.canvas=document.createElement('canvas')
  Object.assign(this.canvas.style,{position:'absolute',left:'0',top:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'2'})
  map.getViewport().append(this.canvas)
  this.listener=map.on('postrender',()=>this.render())
 }
 render(){
  const {map,reprojection,canvas}=this,size=map.getSize();if(!size)return
  const ratio=window.devicePixelRatio||1,width=Math.round(size[0]*ratio),height=Math.round(size[1]*ratio)
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
  const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,...size)
  const code=reprojection.signature,atlas=reprojection.atlases.get(code)
  if(!atlas)return
  const projection=map.getView().getProjection(),extent=map.getView().calculateExtent(size),domain=atlas.data.extent,worldWidth=projection.canWrapX()?domain[2]-domain[0]:0
  const first=worldWidth?Math.floor((extent[0]-domain[2])/worldWidth):0,last=worldWidth?Math.ceil((extent[2]-domain[0])/worldWidth):0
  ctx.lineWidth=2
  for(let world=first;world<=last;world++){
   const offset=world*worldWidth,norm=[(extent[0]-offset-domain[0])/(domain[2]-domain[0]),(extent[1]-domain[1])/(domain[3]-domain[1]),(extent[2]-offset-domain[0])/(domain[2]-domain[0]),(extent[3]-domain[1])/(domain[3]-domain[1])]
   for(const {curve,quarter} of atlas.query(norm)){
    const point=i=>map.getPixelFromCoordinate([domain[0]+curve[i]*(domain[2]-domain[0])+offset,domain[1]+curve[i+1]*(domain[3]-domain[1])])
    const a=point(0),b=point(2),c=point(4),d=point(6)
    if(!a||!b||!c||!d)continue
    ctx.strokeStyle=quarter%8===0?'#ff1758':'#00b6ff';ctx.beginPath();ctx.moveTo(...a);ctx.bezierCurveTo(...b,...c,...d);ctx.stroke()
   }
  }
 }
}
