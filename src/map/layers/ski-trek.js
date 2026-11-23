import {transform,transformExtent} from 'ol/proj.js'
import {createMapView} from '../projections/view.js?v=viewport-model'
import {kilometreSegments,trackDistance} from './track-segments.js'
import {RouteCatalog} from './route-catalog.js?v=route-minima-v1'
import {RouteDetailsPanel} from './route-details.js?v=route-minima-v1'
import Feature from 'ol/Feature.js'
import Overlay from 'ol/Overlay.js'
import Point from 'ol/geom/Point.js'
import GeoJSON from 'ol/format/GeoJSON.js'
import VectorSource from 'ol/source/Vector.js'
import VectorLayer from 'ol/layer/Vector.js'
import Style from 'ol/style/Style.js'
import Stroke from 'ol/style/Stroke.js'
import Text from 'ol/style/Text.js'
import Fill from 'ol/style/Fill.js'
import CircleStyle from 'ol/style/Circle.js'

const COLORS=['#b02a37','#165dce','#8a3daa','#b05b00','#087b53','#087b53']
const VARIANTS={'1a':'#b02a37','1b':'#8651b8',D2B:'#b05b00',D3B:'#b07330',D5B:'#ab286f',D5C:'#9b7517',D4B:'#357a60',VP:'#3571b3',VJ:'#266a4d',JM:'#a16e18',JMB:'#ab286f',R:'#087b53',RF:'#087b53',RG:'#ab286f'}
const node=(tag,text,className)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(className)e.className=className;return e}

// Map rendering and hit selection are separate from itinerary data and the pane.
export class SkiTrekLayer {
 constructor(map){
  this.map=map;this.source=new VectorSource({attributions:'Terrain routes: © Kartverket, NHM DTM 1 m'});this.layer=new VectorLayer({source:this.source,zIndex:30});map.addLayer(this.layer)
  this.profileMarkerElement=node('div',null,'route-profile-marker');this.profileOverlay=new Overlay({element:this.profileMarkerElement,positioning:'center-center',stopEvent:false});map.addOverlay(this.profileOverlay)
  this.styles=new Map();this.visible=new Set();this.inputs=new Map();this.marker=null;this.routeURL=null;this.activeId=null
  this.panel=new RouteDetailsPanel({onChoose:id=>this.inspect(id,this.hitIds),onClose:()=>{if(this.routeURL)URL.revokeObjectURL(this.routeURL);this.routeURL=null;this.activeId=null;this.clearMarker();this.rebuild()},onFit:id=>this.fitRoute(id),onUse:id=>{this.catalog.select(id);this.visible.add(id);this.rebuild();this.inspect(id)},onDistance:d=>this.inspectDistance(d)})
  this.createControls();map.on('change:view',()=>this.rebuild())
  map.on('singleclick',event=>{const ids=[];map.forEachFeatureAtPixel(event.pixel,f=>{const id=f.get('routeId');if(id)for(const peer of this.catalog.identical(id))if(this.visible.has(peer)&&!ids.includes(peer))ids.push(peer)},{layerFilter:layer=>layer===this.layer,hitTolerance:matchMedia('(pointer:coarse)').matches?12:7});if(ids.length){const id=ids.includes(this.activeId)?this.activeId:ids.find(id=>this.catalog.selected.includes(id))||ids[0];this.inspect(id,ids)}})
  map.on('pointermove',event=>{if(event.dragging||event.originalEvent.pointerType==='touch')return;this.pointer=event.pixel;if(this.hoverFrame)return;this.hoverFrame=requestAnimationFrame(()=>{this.hoverFrame=null;const hit=map.forEachFeatureAtPixel(this.pointer,f=>Boolean(f.get('routeId')),{layerFilter:layer=>layer===this.layer,hitTolerance:6});map.getViewport().style.cursor=hit?'pointer':''})})
  fetch(new URL('../../../data/ski-trek/exposure-routes.geojson?v=route-minima-v1',import.meta.url)).then(r=>{if(!r.ok)throw Error('Tracks unavailable');return r.json()}).then(data=>this.load(data)).catch(error=>{this.status.textContent=error.message})
 }
 createControls(){
  const container=node('div'),row=node('div',null,'trek-row'),label=node('label');this.toggle=node('input');this.toggle.type='checkbox';this.toggle.checked=true;label.append(this.toggle,' Ski trek')
  this.show=node('button','↗');this.show.type='button';this.show.title='Show ski trek';this.show.setAttribute('aria-label',this.show.title);this.show.disabled=true;row.append(label,this.show)
  this.menu=node('details');const summary=node('summary','Routes');this.menu.append(summary);this.routeList=node('div');this.routeList.id='trek-routes';this.menu.append(this.routeList)
  this.plan=node('a','Download selected plan GPX');this.plan.href='#';this.plan.download='frostmapper-plan.gpx';this.plan.addEventListener('click',event=>{if(!this.catalog){event.preventDefault();return}this.plan.href=this.catalog.getPlanURL()})
  this.status=node('small');this.status.setAttribute('role','status');container.append(row,this.menu,this.plan,this.status);document.querySelector('#layers').append(container)
  this.toggle.addEventListener('change',()=>this.layer.setVisible(this.toggle.checked));this.show.addEventListener('click',()=>{this.toggle.checked=true;this.layer.setVisible(true);this.fit(this.source.getExtent())})
 }
 color(route){if(route.properties.day===6&&route.properties.minimum_id){const peer=this.catalog?.identical(route.properties.id).map(id=>this.catalog.get(id)).find(f=>f.properties.day===5);if(peer)return this.color(peer)}return VARIANTS[route.properties.id]||COLORS[Math.max(0,(route.properties.day||1)-1)]||'#8050a0'}
 label(route){const p=route.properties;return p.day?`${/^1[ab]$/.test(p.id)?p.id:p.day} · ${p.label.startsWith('Lowest')?`${p.start} → ${p.end}`:p.label}`:`${p.start} → ${p.end}${p.label.startsWith('Lowest')?'':` · ${p.label}`}`}
 load(data){
  this.catalog=new RouteCatalog(data);for(const id of this.catalog.selected)if(id)this.visible.add(id)
  for(const f of [...(data.day1_options||[]),...(data.day6_options||[]),...(data.additional_routes||[])])this.visible.add(f.properties.id)
  for(const id of ['VP','VJ','JM'])if(this.catalog.get(id))this.visible.add(id)
  this.show.disabled=false;this.routeList.replaceChildren()
  const routes=[...this.catalog.routes.values()].sort((a,b)=>(a.properties.day||9)-(b.properties.day||9)||a.properties.id.localeCompare(b.properties.id))
  for(const route of routes){
   const p=route.properties,row=node('div',null,'route-menu-row'),check=node('input');check.type='checkbox';check.checked=this.visible.has(p.id);check.setAttribute('aria-label',`Show route ${p.id}`);check.addEventListener('change',()=>{check.checked?this.visible.add(p.id):this.visible.delete(p.id);this.rebuild()});this.inputs.set(p.id,check)
   const button=node('button',this.label(route),'route-menu-name');button.type='button';button.style.borderLeftColor=this.color(route);button.addEventListener('click',()=>{this.inspect(p.id);document.querySelector('#map-options').open=false});row.append(check,button);this.routeList.append(row)
  }
  this.status.textContent='';this.rebuild()
 }
 style(id,color,opacity,label){
  const active=id===this.activeId,key=[id,color,opacity,label,active].join('|');if(this.styles.has(key))return this.styles.get(key)
  const styles=label?new Style({text:new Text({text:label,font:'bold 12px system-ui',fill:new Fill({color}),stroke:new Stroke({color:'white',width:3}),overflow:true})}):[new Style({stroke:new Stroke({color:[255,255,255,opacity],width:active?8:6,lineCap:'butt'})}),new Style({stroke:new Stroke({color:[...([1,3,5].map(n=>parseInt(color.slice(n,n+2),16))),opacity],width:active?4.5:3,lineCap:'butt'})})]
  this.styles.set(key,styles);return styles
 }
 addTrack(route,offset,label){
  const projection=this.map.getView().getProjection(),format=new GeoJSON(),id=route.properties.id,color=this.color(route),whole=format.readFeature(route,{featureProjection:projection});whole.set('routeId',id);whole.set('routePart','label');whole.setStyle(this.style(id,color,1,label));this.source.addFeature(whole)
  const first=Math.floor(offset/1000);kilometreSegments(route.geometry.coordinates,1000,offset).forEach((coordinates,i)=>{const segment=format.readFeature({type:'Feature',geometry:{type:'LineString',coordinates}},{featureProjection:projection});segment.set('routeId',id);segment.set('routePart','line');segment.setStyle(this.style(id,color,(first+i)%2?.4:1));this.source.addFeature(segment)})
 }
 rebuild(){
  if(!this.catalog)return;this.source.clear();this.profileOverlay.setPosition(undefined)
  const offsets=[];let distance=0;for(const route of this.catalog.selected.map(id=>this.catalog.get(id))){offsets.push(distance);if(route)distance+=trackDistance(route.geometry.coordinates)}
  const drawn=new Set(),dayLabel=p=>p.day===1?p.id:String(p.day)+(/^(?:D[2-5][B-Z]|R[F-Z])$/.test(p.id)?p.id.at(-1).toLowerCase():'')
  for(const route of this.catalog.routes.values()){
   const p=route.properties;if(!this.visible.has(p.id))continue
   const peers=this.catalog.identical(p.id).filter(id=>this.visible.has(id)),key=p.minimum_id||p.id;if(drawn.has(key))continue;drawn.add(key)
   const peerRoutes=peers.map(id=>this.catalog.get(id)),chosen=peerRoutes.find(f=>f.properties.id===this.activeId)||peerRoutes.find(f=>f.properties.day===5)||route,q=chosen.properties
   const offset=q.day?offsets[q.day-1]:q.id.startsWith('JM')&&this.catalog.get('VJ')?trackDistance(this.catalog.get('VJ').geometry.coordinates):q.id.startsWith('VP')?offsets[1]:0
   const label=peerRoutes.length>1?peerRoutes.map(f=>dayLabel(f.properties)).join(' / '):q.day?dayLabel(q):q.id
   this.addTrack(chosen,offset,label)
  }

  const seen=new Set();for(const route of this.catalog.selectedRoutes())for(const [name,coordinate] of [[route.properties.start,route.geometry.coordinates[0]],[route.properties.end,route.geometry.coordinates.at(-1)]]){if(seen.has(name))continue;seen.add(name);const marker=new Feature(new Point(transform(coordinate,'EPSG:4326',this.map.getView().getProjection())));marker.setStyle(new Style({image:new CircleStyle({radius:4,fill:new Fill({color:'white'}),stroke:new Stroke({color:'#243642',width:2})}),text:new Text({text:name,offsetY:-13,font:'bold 11px system-ui',fill:new Fill({color:'#243642'}),stroke:new Stroke({color:'white',width:3})})}));this.source.addFeature(marker)}
  for(const [id,input] of this.inputs)input.checked=this.visible.has(id)
 }
 inspect(id,hitIds=[id]){
  const route=this.catalog?.get(id);if(!route)return;this.activeId=id;this.hitIds=hitIds;this.visible.add(id);this.toggle.checked=true;this.layer.setVisible(true);this.rebuild();if(this.routeURL)URL.revokeObjectURL(this.routeURL);this.routeURL=this.catalog.routeURL(id)
  this.panel.show(route,this.catalog.profile(id),{color:this.color(route),canUse:this.catalog.canSelect(id),isSelected:this.catalog.selected.includes(id),url:this.routeURL,choices:hitIds.map(id=>({id,label:this.label(this.catalog.get(id))}))})
 }
 clearMarker(){this.profileOverlay.setPosition(undefined)}
 inspectDistance(value){
  if(value===null||!this.activeId){this.clearMarker();return}const route=this.catalog.get(this.activeId),coordinates=route.geometry.coordinates
  if(this.chainRoute!==this.activeId){this.chainRoute=this.activeId;this.chain=[0];for(let i=1;i<coordinates.length;i++)this.chain.push(this.chain.at(-1)+trackDistance([coordinates[i-1],coordinates[i]]))}
  const target=value/(route.properties.distance_km*1000)*this.chain.at(-1);let lo=0,hi=coordinates.length-1;while(lo+1<hi){const mid=(lo+hi)>>1;if(this.chain[mid]<target)lo=mid;else hi=mid}const fraction=(target-this.chain[lo])/(this.chain[hi]-this.chain[lo]||1),coordinate=coordinates[lo].map((v,i)=>v+(coordinates[hi][i]-v)*fraction),point=transform(coordinate,'EPSG:4326',this.map.getView().getProjection())
  this.profileMarkerElement.style.backgroundColor=this.color(route);this.profileOverlay.setPosition(point)
 }
 fitRoute(id){const route=this.catalog.get(id),f=new GeoJSON().readFeature(route,{featureProjection:this.map.getView().getProjection()});this.fit(f.getGeometry().getExtent())}
 fit(extent){
  if(this.map.getView().getProjection().getCode()==='EPSG:3031'){extent=transformExtent(extent,'EPSG:3031','EPSG:3857',16);this.map.setView(createMapView('EPSG:3857',[7.7,62.2],10));document.querySelector('#projection').value='EPSG:3857'}
  const bottom=this.panel.root.hidden?40:this.panel.root.getBoundingClientRect().height+20;this.map.getView().fit(extent,{size:this.map.getSize(),padding:[50,65,bottom,35],maxZoom:14,duration:250})
 }
}
export function addSkiTrek(map){return new SkiTrekLayer(map).layer}
