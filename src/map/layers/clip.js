import GeoJSON from 'ol/format/GeoJSON.js'
import {apply} from 'ol/transform.js'
import {unByKey} from 'ol/Observable.js'
import {createEmpty,extend} from 'ol/extent.js'
import {createCoverageIndex} from './coverage.js'
export async function clipLayer(map,layer,url){
 const response=await fetch(url);if(!response.ok)throw new Error(`Border: ${response.status}`)
 const data=await response.json(),format=new GeoJSON();let projection,geometries=[],borderExtent,worldWidth=0
 // Keep a finite extent around the visible world copies so OpenLayers can
 // still skip an overlay when it is outside the view, including near the poles.
 let viewKeys=[],lastExtent
 function updateLayerExtent(){
  let extent=borderExtent
  if(worldWidth && extent){
   const view=map.getView(),center=view.getCenter(),resolution=view.getResolution(),size=map.getSize()
   const radius=size&&Number.isFinite(resolution)?Math.hypot(size[0],size[1])*resolution/2:0
   const x=center?.[0]??0
   // One extra copy on each side makes this conservative during resize/pan.
   const first=Math.floor((x-radius-extent[2])/worldWidth)
   const last=Math.ceil((x+radius-extent[0])/worldWidth)
   extent=[extent[0]+first*worldWidth,extent[1],extent[2]+last*worldWidth,extent[3]]
  }
  if(!extent&&!lastExtent)return
  if(extent&&lastExtent&&extent.every((value,i)=>value===lastExtent[i]))return
  lastExtent=extent
  layer.setExtent(extent)
 }
 function updateProjection(){
  unByKey(viewKeys)
  const view=map.getView(),viewProjection=view.getProjection(),code=viewProjection.getCode()
  if(code!==projection){
   projection=code
   worldWidth=(code==='FROST:TRIPTYCHIAL'||code==='EPSG:3857') && viewProjection.canWrapX()?viewProjection.getExtent()[2]-viewProjection.getExtent()[0]:0
   geometries=format.readFeatures(data,{dataProjection:'EPSG:4326',featureProjection:code}).map(f=>f.getGeometry())
   const extent=createEmpty()
   for(const geometry of geometries)extend(extent,geometry.getExtent())
   // An invalid transform must not hide the layer.
   borderExtent=extent.every(Number.isFinite)?extent:undefined
  }
  viewKeys=[view.on('change:center',updateLayerExtent),view.on('change:resolution',updateLayerExtent)]
  updateLayerExtent()
 }
 updateProjection()
 map.on('change:view',updateProjection)
 map.on('change:size',updateLayerExtent)
 layer.on('prerender',event=>{
  const ctx=event.context,frameExtent=event.frameState.extent
  ctx.save();ctx.beginPath()
  // Draw the same border in each visible world copy, using projected units.
  const first=worldWidth&&borderExtent?Math.ceil((frameExtent[0]-borderExtent[2])/worldWidth):0
  const last=worldWidth&&borderExtent?Math.floor((frameExtent[2]-borderExtent[0])/worldWidth):0
  for(let world=first;world<=last;world++)for(const geom of geometries){
   const polygons=geom.getType()==='Polygon'?[geom.getCoordinates()]:geom.getCoordinates()
   for(const polygon of polygons)for(const ring of polygon){
    ring.forEach((coord,i)=>{const p=apply(event.inversePixelTransform,apply(event.frameState.coordinateToPixelTransform,[coord[0]+world*worldWidth,coord[1]]));if(i===0)ctx.moveTo(...p);else ctx.lineTo(...p)})
    ctx.closePath()
   }
  }
  ctx.clip('evenodd')
 })
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
