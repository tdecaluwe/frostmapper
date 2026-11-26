import TileLayer from 'ol/layer/Tile.js'
import proj4 from 'proj4'
import {register} from 'ol/proj/proj4.js'
import {get as getProjection,transform,transformExtent} from 'ol/proj.js'
import {createMapView} from '../projections/view.js?v=viewport-model'
import {SnowSeasonRasterSource} from '../snow-season/raster-source.js'
import {SNOW_EXTENT,cellKey} from '../snow-season/grid.js'
import {SnowSeasonEstimator} from '../snow-season/season-estimator.js'

export class SnowSeasonLayer{
 constructor(map){
  this.map=map;this.generation=0;this.metric='length';this.grid=null;this.worker=null;this.requests=new Map();this.requestId=0;this.inspectionId=0
  proj4.defs('EPSG:32633','+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs');register(proj4);getProjection('EPSG:32633').setExtent(SNOW_EXTENT)
  this.source=new SnowSeasonRasterSource(tile=>this.request('render',tile));this.layer=new TileLayer({source:this.source,visible:false,opacity:.6,zIndex:9,preload:1});this.layer.set('name','snow-season');map.addLayer(this.layer)
  this.createControls();map.on('moveend',()=>this.updateView());map.on('change:view',()=>this.updateView());map.on('singleclick',event=>this.inspect(event.coordinate))
  const selected=new URL(location.href).searchParams.get('snow')
  if(['1','length','start','end'].includes(selected)){this.toggle.checked=true;if(selected!=='1'){this.metric=selected;this.selector.value=selected}this.enable()}
  this.updateView();addEventListener('pagehide',()=>this.worker?.postMessage({type:'flush'}))
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
  const status=document.createElement('small');status.id='snow-season-status';status.className='snow-season-status';status.setAttribute('role','status');status.textContent='Starting background snow collection…'
  const readout=document.createElement('div');readout.id='snow-season-readout';readout.className='snow-season-map-readout';readout.hidden=true;readout.setAttribute('role','status');document.body.append(readout)
  const retry=document.createElement('button');retry.type='button';retry.textContent='Retry';retry.className='snow-season-retry';retry.hidden=true
  const cohort=new SnowSeasonEstimator().cohort,note=document.createElement('small');note.className='snow-season-note';note.textContent=`NVE · 1 km · ${cohort.firstEndYear}–${cohort.lastEndYear} winters. 95% per endpoint.`;panel.append(note)
  root.append(status,retry,panel);document.querySelector('#layers').append(root)
  Object.assign(this,{toggle,panel,selector,gradient,legend,status,readout,retry})
  toggle.addEventListener('change',()=>this.enable());selector.addEventListener('change',()=>{this.metric=selector.value;const url=new URL(location.href);url.searchParams.set('snow',this.metric);history.replaceState(null,'',url);this.updateLegend();this.redraw()});show.addEventListener('click',()=>{toggle.checked=true;this.enable();this.showData()});retry.addEventListener('click',()=>this.updateView(true))
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
  this.redraw();if(this.toggle.checked)this.updateView();else this.readout.hidden=true
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
  try{this.worker=new Worker(new URL('../snow-season/season-worker.js?v=snow-chunks-v3',import.meta.url),{type:'module'})}catch{this.status.dataset.state='error';this.status.textContent='Snow worker unavailable';this.retry.hidden=false;return false}
  this.worker.onmessage=({data})=>{
   if(data.id&&this.requests.has(data.id)){
    const pending=this.requests.get(data.id);this.requests.delete(data.id)
    if(data.type==='request-error')pending.reject(new Error(data.message));else pending.resolve(data.type==='tile'?data.pixels:data.value)
    return
   }
   if(data.type==='chunks')this.source.chunksChanged(data.keys)
   else if(data.type==='progress'&&!data.paused){
    this.retry.hidden=true;this.status.dataset.state=data.active?'collecting':'idle'
    this.status.textContent=data.total?`Snow data: ${data.completed.toLocaleString()} / ${data.total.toLocaleString()} cells${data.active?` · fetching ${data.active}`:' · cached'}`:'Snow data: move to Norway or Sweden to collect'
   }
   else if(data.type==='error'){this.status.dataset.state='error';this.status.textContent=`Snow data unavailable: ${data.message}`;this.retry.hidden=false}
  }
  this.worker.onerror=()=>{
   this.status.dataset.state='error';this.status.textContent='Snow worker unavailable';this.retry.hidden=false
   for(const pending of this.requests.values())pending.reject(new Error('Snow worker unavailable'))
   this.requests.clear();this.worker.terminate();this.worker=null
  }
  return true
 }
 request(type,payload){
  if(!this.ensureWorker())return Promise.reject(new Error('Snow worker unavailable'))
  const id=++this.requestId
  return new Promise((resolve,reject)=>{this.requests.set(id,{resolve,reject});this.worker.postMessage({...payload,type,id})})
 }
 updateView(retry=false){
  if(retry)this.retry.hidden=true;this.readout.hidden=true;const view=this.map.getView();let extent=null
  try{extent=transformExtent(view.calculateExtent(this.map.getSize()),view.getProjection(),'EPSG:32633',16);if(!extent.every(Number.isFinite))extent=null}catch{}
  this.grid={extent};if(!this.ensureWorker())return
  // Collection is independent of layer visibility. The worker retains previous jobs.
  this.worker.postMessage({type:'view',generation:++this.generation,extent,retry})
 }
 redraw(){this.source.setMetric(this.metric)}
 async inspect(coordinate){
  if(!this.toggle.checked)return
  let native;try{native=transform(coordinate,this.map.getView().getProjection(),'EPSG:32633')}catch{return}
  const inspection=++this.inspectionId;this.readout.hidden=false;this.readout.textContent='Reading snow-season data…'
  let record;try{record=await this.request('inspect',{key:cellKey(...native)})}catch{if(inspection===this.inspectionId)this.readout.textContent='Snow data unavailable';return}
  if(inspection!==this.inspectionId||!this.toggle.checked)return
  if(!record){this.readout.textContent='Cell not calculated yet';return}
  if(record.status==='outside-model'){this.readout.textContent='Outside seNorge model coverage';return}
  if(record.days===null){this.readout.textContent='Historical data incomplete in this cell';return}
  if(record.days===0){this.readout.textContent='No common snow-season period';return}
  const date=md=>new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`2000-${md}T00:00:00Z`))
  const whole=record.wholeYears,coverage=whole?` Whole period: ${whole.minimum===whole.maximum?whole.minimum:`${whole.minimum}–${whole.maximum}`}/20 winters.`:''
  this.readout.textContent=`${record.days} days · ${date(record.start)}–${date(record.end)}.${coverage}${record.unknownDays?' Some historical days unknown.':''}`
 }
}
export function addSnowSeasonLayer(map){return new SnowSeasonLayer(map)}
