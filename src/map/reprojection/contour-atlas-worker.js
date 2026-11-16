import {get,PROJECTION_STRINGS,TRIPTYCHIAL_CODE} from '../projections/worker-index.js'
import {ContourAtlasBuilder} from './contour-atlas.js?v=atlas-fast-v2'
import {MAX_SOURCE_ZOOM} from './contour-atlas-config.js'
import {buildTriptychialSourceBaseAtlas,refineTriptychialSourceAtlasPasses,refineTriptychialTargetAtlas} from '../../../tools/refine-source-atlas.js?v=atlas-fast-v3'
import {createAdaptiveContourWorkspace} from './adaptive-contours.js?v=atlas-fast-v3'

self.addEventListener('message',event=>{
 const message=event.data
 if(message.type==='build')void build(message)
})

async function build(message){
 try{
  const expected=PROJECTION_STRINGS[message.targetCode]
  if(!expected||expected!==message.targetDefinition||message.sourceDefinition!==PROJECTION_STRINGS['EPSG:3857'])throw Error('Projection definition changed while preparing the atlas')
  const target=get(message.targetCode),source=get('EPSG:3857'),coordinateProjection=message.coordinateProjection==='source'?source:target
  const triptychialSource=message.targetCode===TRIPTYCHIAL_CODE&&message.coordinateProjection==='source'
  const workspace=triptychialSource?createAdaptiveContourWorkspace(9,9):null
  const options={coordinateProjection,maxQuarter:MAX_SOURCE_ZOOM*4}
  if(message.coordinateProjection==='source')Object.assign(options,{width:1025,height:1025})
  let data
  if(triptychialSource)data=buildTriptychialSourceBaseAtlas(target,source,{maxQuarter:MAX_SOURCE_ZOOM*4,workspace})
  else data=new ContourAtlasBuilder(target,source,options).build()
  const metadata=atlas=>{
   atlas.targetDefinition=message.targetDefinition
   atlas.sourceDefinition=message.sourceDefinition
   atlas.highestSourceZoom=MAX_SOURCE_ZOOM
   return atlas
  }
  const publish=(type,stage,atlas)=>self.postMessage({type,stage,id:message.id,data:metadata(atlas)})
  if(triptychialSource){
   publish('update','global-base',data)
   await yieldWorker()
   for(const pass of refineTriptychialSourceAtlasPasses(data,{workspace})){
    publish('update',pass.stage,pass.atlas)
    await yieldWorker()
   }
  }else if(message.targetCode===TRIPTYCHIAL_CODE){
   data=refineTriptychialTargetAtlas(data,{maxQuarter:MAX_SOURCE_ZOOM*4})
  }
  metadata(data)
  const json=JSON.stringify(data)
  self.postMessage({type:'ready',id:message.id,data,json})
 }catch(error){
  self.postMessage({type:'error',id:message.id,error:String(error?.stack||error)})
 }
}

function yieldWorker(){return new Promise(resolve=>setTimeout(resolve,0))}
