import {ContourAtlas} from './contour-atlas-index.js?v=oriented-steps-v3'
import {BandMaskPlanner} from './band-mask.js?v=oriented-mask-v3'
import {get} from '../projections/worker-index.js'
import {DistortionField} from './distortion.js?v=atlas-fast-v2'

const atlases=new Map(),fields=new Map(),planner=new BandMaskPlanner()
self.addEventListener('message',event=>{
 const message=event.data
 if(message.type==='atlas'){
  try{
   atlases.set(message.id,new ContourAtlas(message.data))
   const pair=`${message.data.target}|${message.data.source}`
   if(!fields.has(pair))fields.set(pair,new DistortionField(get(message.data.target),get(message.data.source)))
  }
  catch(error){self.postMessage({type:'atlas-error',id:message.id,error:String(error)})}
  return
 }
 if(message.type==='plan')runPlan(message)
})

async function runPlan(message){
 try{
  const atlas=atlases.get(message.atlas),field=atlas&&fields.get(`${atlas.data.target}|${atlas.data.source}`)
  const anchor=message.anchor||(atlas&&field?tileAnchor(atlas,field,message.extent,message.width,message.height):null)
  const sourceCoordinates=atlas?.data.coordinateProjection===atlas?.data.source,valueAt=atlas&&field?(x,y)=>{
   const [left,bottom,right,top]=message.extent,point=[left+x/message.width*(right-left),top-y/message.height*(top-bottom)]
   return sourceCoordinates?field.atSource(point):field.at(point)
  }:null
  const chunks=atlas?planner.planChunks(atlas,message.extent,message.width,message.height,anchor,{minimumStep:message.minimumStep,valueAt}):[{failed:true}]
  for(const chunk of chunks){
   if(chunk.failed){
    if(message.depth<4)self.postMessage({type:'split',key:message.key})
    else self.postMessage({type:'failed',key:message.key})
    return
   }
   if(chunk.complete){self.postMessage({type:'complete',key:message.key});return}
   const spans=chunk.spans||[],packed=new Int32Array(spans.length*4)
   for(let i=0;i<spans.length;i++){
    const span=spans[i],offset=i*4
    packed[offset]=span.x;packed[offset+1]=span.y;packed[offset+2]=span.width;packed[offset+3]=span.band
   }
   self.postMessage({type:'chunk',key:message.key,spans:packed},[packed.buffer])
   await new Promise(resolve=>setTimeout(resolve,0))
  }
 }catch(error){
  console.error('Contour plan failed in worker:',error)
  if(message.depth<4)self.postMessage({type:'split',key:message.key})
  else self.postMessage({type:'failed',key:message.key})
 }
}

function tileAnchor(atlas,field,extent,width,height){
 const samples=[[.5,.5],[.25,.5],[.75,.5],[.5,.25],[.5,.75],[.25,.25],[.75,.25],[.25,.75],[.75,.75]],atSource=atlas.data.coordinateProjection===atlas.data.source,distortionAt=atSource?point=>field.atSource(point):point=>field.at(point)
 for(const [fx,fy] of samples){
  const point=[extent[0]+fx*(extent[2]-extent[0]),extent[3]-fy*(extent[3]-extent[1])],value=distortionAt(point)
  if(Number.isFinite(value))return {value,x:fx*width,y:fy*height}
 }
 return null
}
