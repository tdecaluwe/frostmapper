import GeoJSON from 'ol/format/GeoJSON.js'
import {apply} from 'ol/transform.js'
import {createCoverageIndex} from './coverage.js'
export async function clipLayer(layer,url){
 const response=await fetch(url);if(!response.ok)throw new Error(`Border: ${response.status}`)
 const data=await response.json(),format=new GeoJSON();let projection, geometries=[]
 layer.on('prerender',event=>{const code=event.frameState.viewState.projection.getCode();if(code!==projection){projection=code;geometries=format.readFeatures(data,{dataProjection:'EPSG:4326',featureProjection:code}).map(f=>f.getGeometry())}const ctx=event.context;ctx.save();ctx.beginPath();for(const geom of geometries){const polygons=geom.getType()==='Polygon'?[geom.getCoordinates()]:geom.getCoordinates();for(const polygon of polygons)for(const ring of polygon){ring.forEach((coord,i)=>{const p=apply(event.inversePixelTransform,apply(event.frameState.coordinateToPixelTransform,coord.slice()));if(i===0)ctx.moveTo(...p);else ctx.lineTo(...p)});ctx.closePath()}}ctx.clip('evenodd')})
 layer.on('postrender',event=>event.context.restore())
 return data
}

// Filter source tiles before fetching; clipping alone happens after network requests.
export function restrictTileRequests(source,data){
 const sourceProjection=source.getProjection()
 const grid=source.getTileGridForProjection(sourceProjection)
 const intersectsCountry=createCoverageIndex(data,sourceProjection,grid)
 const original=source.getTileUrlFunction()
 source.setTileUrlFunction((tileCoord,pixelRatio,projection)=>{
  if(!tileCoord||!intersectsCountry(tileCoord))return undefined
  return original.call(source,tileCoord,pixelRatio,projection)
 })
}
