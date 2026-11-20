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
 const colors=['#b02a37','#165dce','#8a3daa','#b05b00','#087b53','#ab286f']
 let returnDay=5,distinctReturn=new URL(location.href).searchParams.get('return')==='alternative'
 const styles=colors.map((color,i)=>[1,.4].map(opacity=>{
  const rgb=[1,3,5].map(offset=>parseInt(color.slice(offset,offset+2),16))
  return [new Style({stroke:new Stroke({color:[255,255,255,opacity],width:6,lineCap:'butt'})}),new Style({stroke:new Stroke({color:[...rgb,opacity],width:3,lineCap:'butt'})})]
 }))
 const labelStyles=colors.map((color,i)=>new Style({text:new Text({text:String(i+1),font:'bold 13px system-ui',fill:new Fill({color}),stroke:new Stroke({color:'white',width:3}),overflow:true})}))
 const layer=new VectorLayer({source,zIndex:30,style:feature=>{
  const day=feature.get('day'),alternative=Boolean(feature.get('alternative'))
  if(alternative&&!distinctReturn || !alternative&&day===6&&distinctReturn)return undefined
  if(!distinctReturn&&day>=5&&day!==returnDay)return undefined
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
 let data,segmented,renderData
 function rebuild(){
  if(!data)return
  source.clear();source.addFeatures(new GeoJSON().readFeatures(renderData,{featureProjection:map.getView().getProjection()}))
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
 fetch(new URL('../../../data/ski-trek/route.geojson?v=return-v1',import.meta.url)).then(response=>{if(!response.ok)throw Error('Track unavailable');return response.json()}).then(json=>{
  data=json
  distinctReturn=distinctReturn&&Boolean(data.return_alternative)
  renderData={type:'FeatureCollection',features:[...data.features,...(data.return_alternative?[data.return_alternative]:[])]}
  let chainage=0
  segmented={type:'FeatureCollection',features:data.features.flatMap(f=>{
   const first=Math.floor(chainage/1000),parts=kilometreSegments(f.geometry.coordinates,1000,chainage).map((coordinates,index)=>({type:'Feature',properties:{...f.properties,segment:first+index},geometry:{type:'LineString',coordinates}}))
   chainage+=trackDistance(f.geometry.coordinates)
   return parts
  })}
  if(data.return_alternative){
   const f=data.return_alternative,firstFive=data.features.slice(0,5).reduce((sum,f)=>sum+trackDistance(f.geometry.coordinates),0),first=Math.floor(firstFive/1000)
   segmented.features.push(...kilometreSegments(f.geometry.coordinates,1000,firstFive).map((coordinates,index)=>({type:'Feature',properties:{...f.properties,segment:first+index},geometry:{type:'LineString',coordinates}})))
  }
  rebuild();toggle.disabled=false;show.disabled=false
  const alternativeLabel=document.createElement('label'),alternativeToggle=document.createElement('input');alternativeToggle.type='checkbox';alternativeToggle.checked=distinctReturn
  alternativeLabel.append(alternativeToggle,' Different return');alternativeLabel.hidden=!data.return_alternative;list.append(alternativeLabel)
  const alternativeNote=document.createElement('small');alternativeNote.textContent=data.return_alternative?`${data.return_alternative.properties.distance_km.toFixed(1)} km · ${data.return_alternative.properties.max_slope_deg.toFixed(1)}° max · +${data.return_alternative.properties.ascent_m} m`:'';list.append(alternativeNote)
  const dayButtons=new Map()
  const describe=p=>`${p.day}. ${p.start} → ${p.end} · ${p.distance_km.toFixed(1)} km · ${p.max_slope_deg.toFixed(1)}° max`
  for(const f of data.features){
   const p=f.properties,button=document.createElement('button');button.type='button';button.className='trek-leg'
   button.textContent=describe(p.day===6&&distinctReturn?data.return_alternative.properties:p);dayButtons.set(p.day,button)
   button.addEventListener('click',()=>{if(p.day>=5){returnDay=p.day;layer.changed()}fit(source.getFeatures().find(feature=>feature.get('day')===p.day&&feature.get('segment')===undefined&&Boolean(feature.get('alternative'))===(p.day===6&&distinctReturn)).getGeometry().getExtent())});list.append(button)
  }
  const download=document.createElement('a');download.textContent='Download GPX';list.append(download)
  const updateReturn=()=>{
   layer.changed()
   const filename=distinctReturn?'tafjord-ski-trek-distinct-return.gpx':'tafjord-ski-trek.gpx'
   download.href=new URL(`../../../data/ski-trek/${filename}`,import.meta.url);download.download=filename
   const f=distinctReturn?data.return_alternative:data.features.find(f=>f.properties.day===6)
   dayButtons.get(6).textContent=describe(f.properties)
  }
  alternativeToggle.addEventListener('change',()=>{distinctReturn=alternativeToggle.checked;updateReturn()})
  updateReturn()
  const note=document.createElement('small');note.textContent='Terrain-only DEM calculation; slopes below 10° treated equally.';list.append(note)
 }).catch(error=>{status.textContent=error.message})
 return layer
}
