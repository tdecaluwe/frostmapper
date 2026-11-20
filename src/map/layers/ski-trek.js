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

const COLORS=['#b02a37','#165dce','#8a3daa','#b05b00','#087b53','#087b53']
const OPTION_COLORS={A:'#b02a37',B:'#8651b8',C:'#b16b00',D:'#08758b',E:'#287332',under20:'#565d63',R:'#087b53',F:'#ab286f',G:'#9b7517'}
const metric=p=>`${p.distance_km.toFixed(1)} km · ${Math.round(p.distance_above_15_m)} m >15° · ${p.max_slope_deg.toFixed(1)}° max`
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node}
const xml=text=>String(text).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]))

// Owns route selection, comparison overlays and the selected plan's chainage.
// Splitting and projection transforms run on load or control changes only.
export class SkiTrekLayer {
 constructor(map){
  this.map=map;this.source=new VectorSource({attributions:'Terrain route analysis: Mapzen / Kartverket DEM'})
  this.layer=new VectorLayer({source:this.source,zIndex:30});map.addLayer(this.layer)
  this.comparisons=new Set(['A','C']);this.returnComparisons=new Set(['F']);this.activeDay=0;this.styles=new Map();this.objectURL=null
  this.createControls();map.on('change:view',()=>this.rebuild())
  fetch(new URL('../../../data/ski-trek/exposure-routes.geojson',import.meta.url)).then(r=>{if(!r.ok)throw Error('Tracks unavailable');return r.json()}).then(data=>this.load(data)).catch(error=>{this.status.textContent=error.message})
 }
 createControls(){
  const panel=element('div'),row=element('div',null,'trek-row'),label=element('label')
  this.toggle=element('input');this.toggle.type='checkbox';this.toggle.checked=true;label.append(this.toggle,' Ski trek');row.append(label)
  this.show=element('button','↗');this.show.type='button';this.show.title='Show ski trek';this.show.setAttribute('aria-label',this.show.title);this.show.disabled=true;row.append(this.show);panel.append(row)
  const details=element('button','6 days · route options','trek-details-toggle');details.type='button';details.setAttribute('aria-expanded','false');details.setAttribute('aria-controls','trek-legs');panel.append(details)
  this.list=element('div');this.list.id='trek-legs';this.list.hidden=true;panel.append(this.list)
  this.status=element('small');this.status.setAttribute('role','status');panel.append(this.status);document.querySelector('#layers').append(panel)
  this.toggle.addEventListener('change',()=>this.layer.setVisible(this.toggle.checked))
  details.addEventListener('click',()=>{this.list.hidden=!this.list.hidden;details.setAttribute('aria-expanded',String(!this.list.hidden))})
  this.show.addEventListener('click',()=>{this.activeDay=0;this.rebuild();this.fit(this.source.getExtent())})
 }
 load(data){
  this.data=data;this.selected=data.features.map(f=>structuredClone(f));this.show.disabled=false
  const heading=element('small','Above 10°: fall-line angle ≤ 30° − terrain slope.');this.list.append(heading)
  const selectLabel=element('label','Day 1 plan');this.select=element('select');this.select.setAttribute('aria-label','Day 1 plan')
  for(const f of data.day1_options){const p=f.properties,option=element('option',`${p.id}: ${metric(p)}`);option.value=p.id;this.select.append(option)}
  this.select.value=this.selected[0].properties.id
  selectLabel.append(this.select);this.list.append(selectLabel)
  this.select.addEventListener('change',()=>{this.selected[0]=structuredClone(data.day1_options.find(f=>f.properties.id===this.select.value));this.update()})
  this.list.append(element('small','Compare day 1 options (selected plan stays visible):'))
  this.optionInputs=new Map()
  for(const f of data.day1_options){
   const p=f.properties,label=element('label',null,'trek-comparison'),input=element('input');input.type='checkbox';input.checked=this.comparisons.has(p.id)
   const text=element('span',`${p.id}. ${p.label} · ${metric(p)}`);text.style.borderLeft=`3px solid ${OPTION_COLORS[p.id]}`;label.append(input,text);this.list.append(label);this.optionInputs.set(p.id,input)
   input.addEventListener('change',()=>{if(input.checked)this.comparisons.add(p.id);else this.comparisons.delete(p.id);this.rebuild()})
  }
  const diagnostic=data.diagnostics[0],label=element('label',null,'trek-comparison'),check=element('input');check.type='checkbox'
  label.append(check,element('span',`Sub-20° diagnostic: ${diagnostic.properties.distance_km.toFixed(1)} km — exceeds 25 km limit`));this.list.append(label)
  check.addEventListener('change',()=>{this.diagnostic=check.checked;this.rebuild()})
  this.buttons=this.selected.map((f,i)=>{
   const button=element('button',null,'trek-leg');button.type='button';this.list.append(button)
   button.addEventListener('click',()=>{this.activeDay=i+1;this.rebuild();const feature=new GeoJSON().readFeature(this.selected[i],{featureProjection:this.map.getView().getProjection()});this.fit(feature.getGeometry().getExtent())});return button
  })
  const returnLabel=element('label','Day 6 return plan');this.returnSelect=element('select');this.returnSelect.setAttribute('aria-label','Day 6 return plan')
  for(const f of data.day6_options){const p=f.properties,option=element('option',`${p.id}: ${metric(p)}`);option.value=p.id;this.returnSelect.append(option)}
  this.returnSelect.value=this.selected[5].properties.id;returnLabel.append(this.returnSelect);this.list.append(returnLabel)
  this.returnSelect.addEventListener('change',()=>{this.selected[5]=structuredClone(data.day6_options.find(f=>f.properties.id===this.returnSelect.value));this.update()})
  this.list.append(element('small','Return alternatives: shared upper route, different lower-valley diversions. Limit 35 km.'))
  this.returnInputs=new Map()
  for(const f of data.day6_options){
   const p=f.properties,label=element('label',null,'trek-comparison'),input=element('input');input.type='checkbox';input.checked=this.returnComparisons.has(p.id)
   const text=element('span',`${p.id}. ${p.label} · ${metric(p)}`);text.style.borderLeft=`3px solid ${OPTION_COLORS[p.id]}`;label.append(input,text);this.list.append(label);this.returnInputs.set(p.id,input)
   input.addEventListener('change',()=>{if(input.checked)this.returnComparisons.add(p.id);else this.returnComparisons.delete(p.id);this.rebuild()})
  }
  this.download=element('a','Download selected plan GPX');this.list.append(this.download)
  const options=element('a','Download all day 1 options');options.href=new URL('../../../data/ski-trek/day1-exposure-options.gpx',import.meta.url);options.download='day1-exposure-options.gpx';this.list.append(options)
  const returns=element('a','Download return options');returns.href=new URL('../../../data/ski-trek/return-exposure-options.gpx',import.meta.url);returns.download='return-exposure-options.gpx';this.list.append(returns)
  this.list.append(element('small','Terrain-model candidates. A sub-20° day 1 within 25 km has not been found.'))
  this.update()
 }
 update(){
  this.selected.forEach((f,i)=>{const p=f.properties;this.buttons[i].textContent=`${i+1}. ${p.start} → ${p.end} · ${metric(p)}`})
  for(const [id,input] of this.optionInputs){input.disabled=id===this.select.value;input.checked=input.disabled||this.comparisons.has(id)}
  for(const [id,input] of this.returnInputs){input.disabled=id===this.returnSelect.value;input.checked=input.disabled||this.returnComparisons.has(id)}
  this.rebuild();this.updateDownload()
 }
 style(key,color,opacity,label,diagnostic=false){
  const id=[key,color,opacity,label,diagnostic].join('|');if(this.styles.has(id))return this.styles.get(id)
  let styles
  if(label)styles=new Style({text:new Text({text:label,font:'bold 12px system-ui',fill:new Fill({color}),stroke:new Stroke({color:'white',width:3}),overflow:true})})
  else{const rgb=[1,3,5].map(offset=>parseInt(color.slice(offset,offset+2),16));styles=[new Style({stroke:new Stroke({color:[255,255,255,opacity],width:6,lineCap:'butt'})}),new Style({stroke:new Stroke({color:[...rgb,opacity],width:3,lineCap:'butt',lineDash:diagnostic?[6,5]:undefined})})]}
  this.styles.set(id,styles);return styles
 }
 addTrack(f,offset,color,label,diagnostic=false){
  const projection=this.map.getView().getProjection(),format=new GeoJSON(),key=f.properties.id
  const whole=format.readFeature(f,{featureProjection:projection});whole.setStyle(this.style(key,color,1,label));this.source.addFeature(whole)
  const first=Math.floor(offset/1000)
  kilometreSegments(f.geometry.coordinates,1000,offset).forEach((coordinates,i)=>{
   const segment=format.readFeature({type:'Feature',geometry:{type:'LineString',coordinates}},{featureProjection:projection});segment.setStyle(this.style(key,color,(first+i)%2?.4:1,null,diagnostic));this.source.addFeature(segment)
  })
 }
 rebuild(){
  if(!this.data)return
  this.source.clear();let offset=0
  const retrace=Boolean(this.selected[5].properties.retrace)
  this.selected.forEach((f,i)=>{
   if(!retrace||i<4||i===4&&this.activeDay!==6||i===5&&this.activeDay===6)this.addTrack(f,offset,i===0||i===5?OPTION_COLORS[f.properties.id]:COLORS[i],i===0?`1${f.properties.id}`:i===5&&!retrace?`6${f.properties.id}`:i>=4&&this.activeDay!==6?'5 / 6':String(i+1))
   offset+=trackDistance(f.geometry.coordinates)
  })
  for(const f of this.data.day1_options)if(f.properties.id!==this.select.value&&this.comparisons.has(f.properties.id))this.addTrack(f,0,OPTION_COLORS[f.properties.id],`1${f.properties.id}`)
  const returnOffset=this.selected.slice(0,5).reduce((sum,f)=>sum+trackDistance(f.geometry.coordinates),0)
  for(const f of this.data.day6_options)if(f.properties.id!==this.returnSelect.value&&this.returnComparisons.has(f.properties.id))this.addTrack(f,returnOffset,OPTION_COLORS[f.properties.id],`6${f.properties.id}`)
  if(this.diagnostic)this.addTrack(this.data.diagnostics[0],0,OPTION_COLORS.under20,'<20° · over limit',true)
  const seen=new Set()
  for(const f of this.selected){
   const name=f.properties.start;if(seen.has(name))continue;seen.add(name)
   const first=new GeoJSON().readFeature(f,{featureProjection:this.map.getView().getProjection()}).getGeometry().getFirstCoordinate(),marker=new Feature(new Point(first))
   marker.setStyle(new Style({image:new CircleStyle({radius:4,fill:new Fill({color:'white'}),stroke:new Stroke({color:'#243642',width:2})}),text:new Text({text:name,offsetY:-13,font:'bold 11px system-ui',fill:new Fill({color:'#243642'}),stroke:new Stroke({color:'white',width:3})})}));this.source.addFeature(marker)
  }
 }
 fit(extent){this.toggle.checked=true;this.layer.setVisible(true);this.map.getView().fit(extent,{size:this.map.getSize(),padding:[50,65,50,35],maxZoom:14,duration:250})}
 updateDownload(){
  if(this.objectURL)URL.revokeObjectURL(this.objectURL)
  const tracks=this.selected.map(f=>{const p=f.properties,points=f.geometry.coordinates.map(([lon,lat,h])=>`<trkpt lat="${lat}" lon="${lon}"><ele>${h}</ele></trkpt>`).join('');return `<trk><name>${xml(`Day ${p.day} ${p.id}: ${p.start} – ${p.end}`)}</name><desc>${xml(metric(p)+'; terrain-only; fall-line angle <=30-slope above 10 degrees')}</desc><trkseg>${points}</trkseg></trk>`}).join('')
  this.objectURL=URL.createObjectURL(new Blob([`<?xml version="1.0" encoding="UTF-8"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="Frostmapper">${tracks}</gpx>`],{type:'application/gpx+xml'}));this.download.href=this.objectURL;this.download.download='tafjord-exposure-plan.gpx'
 }
}
export function addSkiTrek(map){return new SkiTrekLayer(map).layer}
