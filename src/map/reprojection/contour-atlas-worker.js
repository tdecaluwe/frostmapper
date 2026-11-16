import {get,PROJECTION_STRINGS,TRIPTYCHIAL_CODE} from '../projections/worker-index.js'
import {ContourAtlasBuilder} from './contour-atlas.js?v=atlas-fast-v2'
import {MAX_SOURCE_ZOOM} from './contour-atlas-config.js'
import {refineTriptychialSourceAtlas,refineTriptychialTargetAtlas} from '../../../tools/refine-source-atlas.js?v=atlas-fast-v2'

self.addEventListener('message',event=>{
 const message=event.data
 if(message.type==='build')build(message)
})

function build(message){
 try{
  const expected=PROJECTION_STRINGS[message.targetCode]
  if(!expected||expected!==message.targetDefinition||message.sourceDefinition!==PROJECTION_STRINGS['EPSG:3857'])throw Error('Projection definition changed while preparing the atlas')
  const target=get(message.targetCode),source=get('EPSG:3857'),coordinateProjection=message.coordinateProjection==='source'?source:target
  const options={coordinateProjection,maxQuarter:MAX_SOURCE_ZOOM*4}
  if(message.coordinateProjection==='source')Object.assign(options,{width:1025,height:1025})
  const builder=new ContourAtlasBuilder(target,source,options)
  let data=builder.build()
  if(message.targetCode===TRIPTYCHIAL_CODE){
   data=message.coordinateProjection==='source'
    ?refineTriptychialSourceAtlas(data)
    :refineTriptychialTargetAtlas(data,{maxQuarter:MAX_SOURCE_ZOOM*4})
  }
  data.targetDefinition=message.targetDefinition
  data.sourceDefinition=message.sourceDefinition
  data.highestSourceZoom=MAX_SOURCE_ZOOM
  const json=JSON.stringify(data)
  self.postMessage({type:'ready',id:message.id,data,json})
 }catch(error){
  self.postMessage({type:'error',id:message.id,error:String(error?.stack||error)})
 }
}
