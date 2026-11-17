import {get,PROJECTION_STRINGS} from '../projections/worker-index.js'
import {MAX_SOURCE_ZOOM} from './contour-atlas-config.js'
import {BoundedProjectionContourAtlas} from './bounded-contour-atlas-builder.js?v=visibility-v1'

self.addEventListener('message',event=>{
 const message=event.data
 if(message.type==='build')void build(message)
})

async function build(message){
 let atlas
 try{
  const expected=PROJECTION_STRINGS[message.targetCode]
  const expectedSource=PROJECTION_STRINGS[message.sourceCode]
  if(!expected||expected!==message.targetDefinition||!expectedSource||message.sourceDefinition!==expectedSource)throw Error('Projection definition changed while preparing the atlas')
  const target=get(message.targetCode),source=get(message.sourceCode),coordinateProjection=message.coordinateProjection==='source'?source:target
  const highestSourceZoom=message.highestSourceZoom||MAX_SOURCE_ZOOM
  const options={coordinateProjection,steps:message.steps||4,minZoom:-highestSourceZoom,maxZoom:highestSourceZoom}
  const metadata=atlas=>{
   atlas.targetDefinition=message.targetDefinition
   atlas.sourceDefinition=message.sourceDefinition
   atlas.highestSourceZoom=highestSourceZoom
   return atlas
  }
  const publish=(type,stage,atlas)=>self.postMessage({type,stage,id:message.id,data:metadata(atlas)})
  atlas=new BoundedProjectionContourAtlas(target,source,options)
  let data=atlas.data
  publish('update',atlas.stage,data)
  while(!atlas.complete){
   await yieldWorker()
   const pass=atlas.refineBlock();data=pass.atlas
   publish('update',pass.stage,data)
  }
  metadata(data)
  const json=JSON.stringify(data)
  atlas.dispose()
  self.postMessage({type:'ready',id:message.id,data,json})
 }catch(error){
  atlas?.dispose()
  self.postMessage({type:'error',id:message.id,error:String(error?.stack||error)})
 }
}

function yieldWorker(){return new Promise(resolve=>setTimeout(resolve,0))}
