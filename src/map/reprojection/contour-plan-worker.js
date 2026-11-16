import {ContourAtlas} from './contour-atlas-index.js?v=steps-v2'
import {BandMaskPlanner} from './band-mask.js?v=steps-v2'

const atlases=new Map(),planner=new BandMaskPlanner()
self.addEventListener('message',event=>{
 const message=event.data
 if(message.type==='atlas'){
  try{atlases.set(message.id,new ContourAtlas(message.data))}
  catch(error){self.postMessage({type:'atlas-error',id:message.id,error:String(error)})}
  return
 }
 if(message.type==='plan')runPlan(message)
})

async function runPlan(message){
 try{
  const atlas=atlases.get(message.atlas)
  const chunks=atlas?planner.planChunks(atlas,message.extent,message.width,message.height,message.anchor,{minimumStep:message.minimumStep}):[{failed:true}]
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
