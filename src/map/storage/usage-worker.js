import {inspectLayerStorage} from './usage.js'
onmessage=async({data})=>{
 try{postMessage({id:data.id,result:await inspectLayerStorage(data.layers)})}
 catch{postMessage({id:data.id,error:'Cached data could not be read.'})}
}
