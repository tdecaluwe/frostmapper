import GeoJSON from 'ol/format/GeoJSON.js'
import {getVectorContext} from 'ol/render.js'
export async function clipLayer(layer,url){
 const response=await fetch(url);if(!response.ok)throw new Error(`Border: ${response.status}`)
 const data=await response.json(),format=new GeoJSON();let projection, geometries=[]
 layer.on('prerender',event=>{const code=event.frameState.viewState.projection.getCode();if(code!==projection){projection=code;geometries=format.readFeatures(data,{dataProjection:'EPSG:4326',featureProjection:code}).map(f=>f.getGeometry())}const ctx=event.context;ctx.save();ctx.beginPath();const vector=getVectorContext(event);for(const geom of geometries)vector.drawGeometry(geom);ctx.clip('evenodd')})
 layer.on('postrender',event=>event.context.restore())
}
