import ImageLayer from 'ol/layer/Image.js'
import proj4 from 'proj4'
import {register} from 'ol/proj/proj4.js'
import {get as getProjection,transform,transformExtent} from 'ol/proj.js'
import {createMapView} from '../projections/view.js?v=viewport-model'
import {SnowSeasonRasterSource} from '../snow-season/raster-source.js'
import {visibleSnowCells,SNOW_EXTENT,cellKey,cachedSnowExtent} from '../snow-season/grid.js'
import {SnowSeasonEstimator} from '../snow-season/season-estimator.js'

export class SnowSeasonLayer{
 constructor(map){
  this.map=map;this.records=new Map();this.generation=0;this.metric='length';this.grid=null;this.timer=null;this.worker=null
  proj4.defs('EPSG:32633','+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs');register(proj4);getProjection('EPSG:32633').setExtent(SNOW_EXTENT)
  this.source=new SnowSeasonRasterSource();this.layer=new ImageLayer({source:this.source,visible:false,opacity:.6,zIndex:9});this.layer.set('name','snow-season');map.addLayer(this.layer)
  this.createControls();map.on('moveend',()=>this.updateView());map.on('change:view',()=>this.updateView());map.on('singleclick',event=>this.inspect(event.coordinate))
  const selected=new URL(location.href).searchParams.get('snow')
  if(['1','length','start','end'].includes(selected)){this.toggle.checked=true;if(selected!=='1'){this.metric=selected;this.selector.value=selected}this.enable()}
 }
 createControls(){
  const root=document.createElement('div');root.id='snow-season-controls'
  const row=document.createElement('div');row.className='trek-row'
  const label=document.createElement('label'),toggle=document.createElement('input');toggle.id='snow-season-toggle';toggle.type='checkbox';label.append(toggle,' Snow season · 95%');row.append(label)
  const show=document.createElement('button');show.type='button';show.textContent='↗';show.title='Zoom to snow-season data';show.setAttribute('aria-label',show.title);row.append(show);root.append(row)
  const panel=document.createElement('div');panel.className='snow-season-panel';panel.hidden=true
  const selector=document.createElement('select');selector.id='snow-season-metric';selector.setAttribute('aria-label','Snow-season metric')
  for(const [value,text] of [['length','Season length'],['start','Start date (95%)'],['end','End date (95%)']]){const option=document.createElement('option');option.value=value;option.textContent=text;selector.append(option)}
  panel.append(selector)
  const gradient=document.createElement('div');gradient.className='snow-season-gradient';gradient.setAttribute('aria-hidden','true');panel.append(gradient)
  const legend=document.createElement('div');legend.className='snow-season-legend';panel.append(legend)
  const status=document.createElement('small');status.id='snow-season-status';status.setAttribute('role','status');panel.append(status)
  const readout=document.createElement('div');readout.id='snow-season-readout';readout.className='snow-season-map-readout';readout.hidden=true;readout.setAttribute('role','status');document.body.append(readout)
  const retry=document.createElement('button');retry.type='button';retry.textContent='Retry';retry.className='snow-season-retry';retry.hidden=true;panel.append(retry)
  const cohort=new SnowSeasonEstimator().cohort,note=document.createElement('small');note.className='snow-season-note';note.textContent=`NVE · 1 km · ${cohort.firstEndYear}–${cohort.lastEndYear} winters. 95% per endpoint.`;panel.append(note)
  root.append(panel);document.querySelector('#layers').append(root)
  Object.assign(this,{toggle,panel,selector,gradient,legend,status,readout,retry})
  toggle.addEventListener('change',()=>this.enable());selector.addEventListener('change',()=>{this.metric=selector.value;const url=new URL(location.href);url.searchParams.set('snow',this.metric);history.replaceState(null,'',url);this.updateLegend();this.redraw()});show.addEventListener('click',()=>{toggle.checked=true;this.enable();this.showData()});retry.addEventListener('click',()=>this.updateView())
  this.updateLegend()
 }
 updateLegend(){
  this.gradient.style.transform=this.metric==='start'?'scaleX(-1)':''
  const labels=this.metric==='length'?['0','90','180','270','365 days']:['Sep','Dec','Mar','Jun','Aug']
  this.legend.replaceChildren(...labels.map(text=>{const span=document.createElement('span');span.textContent=text;return span}))
 }
 enable(){
  this.panel.hidden=!this.toggle.checked;this.layer.setVisible(this.toggle.checked)
  const url=new URL(location.href);if(this.toggle.checked)url.searchParams.set('snow',this.metric);else url.searchParams.delete('snow');history.replaceState(null,'',url)
  if(this.toggle.checked){this.updateView();if(!this.grid?.extent)this.showData()}
  else {this.readout.hidden=true;this.worker?.postMessage({type:'view',generation:++this.generation,cells:[]});this.retry.hidden=true}
 }
 showData(){
  let native
  try{native=transform(this.map.getView().getCenter(),this.map.getView().getProjection(),'EPSG:32633')}catch{}
  const valid=native&&native.every(Number.isFinite)&&native[0]>=SNOW_EXTENT[0]&&native[0]<=SNOW_EXTENT[2]&&native[1]>=SNOW_EXTENT[1]&&native[1]<=SNOW_EXTENT[3]
  const center=valid?transform(native,'EPSG:32633','EPSG:4326'):[7.715058,62.114905]
  if(this.map.getView().getProjection().getCode()==='EPSG:3031'){
   this.map.setView(createMapView('EPSG:3857',center,12));document.querySelector('#projection').value='EPSG:3857'
  }else{
   const p=this.map.getView().getProjection(),c=transform(center,'EPSG:4326',p),nativeCenter=transform(center,'EPSG:4326','EPSG:32633')
   const extent=transformExtent([nativeCenter[0]-4000,nativeCenter[1]-4000,nativeCenter[0]+4000,nativeCenter[1]+4000],'EPSG:32633',p,8)
   if(extent.every(Number.isFinite)){this.map.getView().fit(extent,{size:this.map.getSize(),padding:[15,55,15,15]});this.map.getView().setCenter(c)}
  }
  this.updateView()
 }
 ensureWorker(){
  if(this.worker)return true
  try{this.worker=new Worker(new URL('../snow-season/season-worker.js?v=snow-season-v1',import.meta.url),{type:'module'})}catch{this.status.textContent='Snow worker unavailable';this.retry.hidden=false;return false}
  this.worker.onmessage=({data})=>{
   if(data.generation!==this.generation||!this.toggle.checked)return
   if(data.type==='cell'){
    this.records.delete(data.key);this.records.set(data.key,data.value);if(this.records.size>4096)this.records.delete(this.records.keys().next().value)
    if(!this.timer)this.timer=setTimeout(()=>{this.timer=null;this.redraw()},250)
   }else if(data.type==='progress'&&!data.failed)this.status.textContent=`${data.completed} / ${data.total} cells${data.completed<data.total?' · calculating…':' · tap the map for dates'}`
   else if(data.type==='error'){this.status.textContent=`Snow data unavailable: ${data.message}`;this.retry.hidden=false}
  }
  this.worker.onerror=()=>{this.status.textContent='Snow worker unavailable';this.retry.hidden=false;this.worker.terminate();this.worker=null}
  return true
 }
 updateView(){
  if(!this.toggle.checked)return
  this.retry.hidden=true;this.readout.textContent='';this.readout.hidden=true;const view=this.map.getView()
  try{this.grid=visibleSnowCells(transformExtent(view.calculateExtent(this.map.getSize()),view.getProjection(),'EPSG:32633',16))}catch{this.grid={cells:[],extent:null,count:0}}
  if(!this.ensureWorker())return;const cells=this.grid.tooWide?[]:this.grid.cells
  this.worker.postMessage({type:'view',generation:++this.generation,cells})
  if(this.grid.tooWide){this.redraw();this.status.textContent='Zoom in to calculate native 1 km snow seasons';return}
  if(!cells.length){this.source.update(null,this.records,this.metric);this.status.textContent='Outside seNorge coverage';return}
  this.status.textContent=`0 / ${cells.length} cells · calculating…`;this.redraw()
 }
 redraw(){const extent=this.grid?.tooWide?cachedSnowExtent(this.records):this.grid?.extent;this.source.update(this.toggle.checked?extent:null,this.records,this.metric)}
 inspect(coordinate){
  if(!this.toggle.checked)return
  let native;try{native=transform(coordinate,this.map.getView().getProjection(),'EPSG:32633')}catch{return}
  this.readout.hidden=false
  const record=this.records.get(cellKey(...native))
  if(!record){this.readout.textContent='Cell not calculated yet';return}
  if(record.status==='outside-model'){this.readout.textContent='Outside seNorge model coverage';return}
  if(record.days===null){this.readout.textContent='Historical data incomplete in this cell';return}
  if(record.days===0){this.readout.textContent='No common snow-season period';return}
  const date=md=>new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`2000-${md}T00:00:00Z`))
  const whole=record.wholeYears;this.readout.textContent=`${record.days} days · ${date(record.start)}–${date(record.end)}. Whole period: ${whole.minimum===whole.maximum?whole.minimum:`${whole.minimum}–${whole.maximum}`}/20 winters.${record.unknownDays?' Some historical days unknown.':''}`
 }
}
export function addSnowSeasonLayer(map){return new SnowSeasonLayer(map)}
