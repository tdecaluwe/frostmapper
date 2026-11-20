import {kilometreSegments,trackDistance} from './track-segments.js'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import CircleStyle from 'ol/style/Circle.js'
import GeoJSON from 'ol/format/GeoJSON.js'
import VectorSource from 'ol/source/Vector.js'
import VectorLayer from 'ol/layer/Vector.js'
import Style from 'ol/style/Style.js'
import Stroke from 'ol/style/Stroke.js'
import Text from 'ol/style/Text.js'
import Fill from 'ol/style/Fill.js'

export function addSkiTrek(map){
 const source=new VectorSource({attributions:'Route terrain analysis: Mapzen / Kartverket elevation data'})
 const colors=['#b02a37','#165dce','#8a3daa','#b05b00','#087b53','#087b53']
 let returnDay=5
 const styles=colors.map((color,i)=>[1,.4].map(opacity=>{
  const rgb=[1,3,5].map(offset=>parseInt(color.slice(offset,offset+2),16))
  return [new Style({stroke:new Stroke({color:[255,255,255,opacity],width:6,lineCap:'butt'})}),new Style({stroke:new Stroke({color:[...rgb,opacity],width:3,lineCap:'butt'})})]
 }))
 const labelStyles=colors.map((color,i)=>new Style({text:new Text({text:i>=4?'5 / 6':String(i+1),font:'bold 13px system-ui',fill:new Fill({color}),stroke:new Stroke({color:'white',width:3}),overflow:true})}))
 const layer=new VectorLayer({source,zIndex:30,style:feature=>{
  const day=feature.get('day');if(day>=5&&day!==returnDay)return undefined
  const segment=feature.get('segment')
  return segment===undefined?labelStyles[day-1]:styles[day-1][segment%2]
 }})
 map.addLayer(layer)
 const container=document.createElement('div'),row=document.createElement('div');row.className='trek-row'
 const label=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=true;toggle.disabled=true
 label.append(toggle,' Ski trek');row.append(label)
 const show=document.createElement('button');show.type='button';show.textContent='↗';show.title='Show ski trek';show.setAttribute('aria-label',show.title);show.disabled=true;row.append(show);container.append(row)
 const details=document.createElement('button');details.type='button';details.textContent='6 daily legs';details.className='trek-details-toggle';details.setAttribute('aria-expanded','false');details.setAttribute('aria-controls','trek-legs');container.append(details)
 const list=document.createElement('div');list.id='trek-legs';list.hidden=true;container.append(list)
 const status=document.createElement('small');status.setAttribute('role','status');container.append(status)
 document.querySelector('#layers').append(container)
 toggle.addEventListener('change',()=>layer.setVisible(toggle.checked))
 details.addEventListener('click',()=>{list.hidden=!list.hidden;details.setAttribute('aria-expanded',String(!list.hidden))})
 const fit=extent=>{layer.setVisible(true);toggle.checked=true;map.getView().fit(extent,{size:map.getSize(),padding:[50,65,50,35],maxZoom:14,duration:250})}
 show.addEventListener('click',()=>fit(source.getExtent()))
 let data,segmented
 function rebuild(){
  if(!data)return
  source.clear();source.addFeatures(new GeoJSON().readFeatures(data,{featureProjection:map.getView().getProjection()}))
  const originals=source.getFeatures()
  source.addFeatures(new GeoJSON().readFeatures(segmented,{featureProjection:map.getView().getProjection()}))
  const seen=new Set()
  for(const feature of originals){
   const name=feature.get('start');if(seen.has(name))continue;seen.add(name)
   const marker=new Feature(new Point(feature.getGeometry().getFirstCoordinate()))
   marker.setStyle(new Style({image:new CircleStyle({radius:4,fill:new Fill({color:'white'}),stroke:new Stroke({color:'#243642',width:2})}),text:new Text({text:name,offsetY:-13,font:'bold 11px system-ui',fill:new Fill({color:'#243642'}),stroke:new Stroke({color:'white',width:3})})}))
   source.addFeature(marker)
  }
 }
 map.on('change:view',rebuild)
 fetch(new URL('../../../data/ski-trek/route.geojson',import.meta.url)).then(response=>{if(!response.ok)throw Error('Track unavailable');return response.json()}).then(json=>{
  data=json
  let chainage=0
  segmented={type:'FeatureCollection',features:data.features.flatMap(f=>{
   const first=Math.floor(chainage/1000),parts=kilometreSegments(f.geometry.coordinates,1000,chainage).map((coordinates,index)=>({type:'Feature',properties:{...f.properties,segment:first+index},geometry:{type:'LineString',coordinates}}))
   chainage+=trackDistance(f.geometry.coordinates)
   return parts
  })}
  rebuild();toggle.disabled=false;show.disabled=false
  for(const f of data.features){
   const p=f.properties,button=document.createElement('button');button.type='button';button.className='trek-leg'
   button.textContent=`${p.day}. ${p.start} → ${p.end} · ${p.distance_km.toFixed(1)} km · ${p.max_slope_deg.toFixed(1)}° max`
   button.addEventListener('click',()=>{if(p.day>=5){returnDay=p.day;layer.changed()}fit(source.getFeatures().find(feature=>feature.get('day')===p.day&&feature.get('segment')===undefined).getGeometry().getExtent())});list.append(button)
  }
  const download=document.createElement('a');download.href=new URL('../../../data/ski-trek/tafjord-ski-trek.gpx',import.meta.url);download.download='tafjord-ski-trek.gpx';download.textContent='Download GPX';list.append(download)
  const note=document.createElement('small');note.textContent='Terrain-only DEM calculation; slopes below 10° treated equally.';list.append(note)
 }).catch(error=>{status.textContent=error.message})
 return layer
}
