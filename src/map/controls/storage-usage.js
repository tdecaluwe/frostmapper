import {formatStorageBytes} from '../storage/usage.js'
const node=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element}
export function layerStorageDefinitions(map){
 const result=new Map()
 function visit(layer){
  if(layer.getLayers){for(const child of layer.getLayers().getArray())visit(child);return}
  const label=layer.get('storageLabel');if(!label)return
  const id=layer.get('storageId')??label,stores=layer.get('storageStores')??[]
  if(!result.has(id))result.set(id,{id,label,stores:[]})
  for(const spec of stores)if(!result.get(id).stores.some(item=>item.database===spec.database&&item.store===spec.store))result.get(id).stores.push(spec)
 }
 for(const layer of map.getLayers().getArray())visit(layer)
 return [...result.values()]
}
/** Read-only overview. Workers scan payloads only while requested by the user. */
export class StorageUsageControl{
 constructor({target,getLayers,onOpen=()=>{}}){
  Object.assign(this,{target,getLayers,onOpen});this.worker=null;this.sequence=0;this.opened=false
  const root=node('div',undefined,'storage-usage-control'),button=node('button');button.id='storage-usage-toggle';button.type='button';button.title='Cached data usage';button.setAttribute('aria-label',button.title);button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','storage-usage-panel')
  button.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 3h13l4 4v14H3V3z"/><path d="M7 3v6h10V3M7 21v-8h10v8M14 4v3"/></svg>'
  const panel=node('section',undefined,'storage-usage-panel');panel.id='storage-usage-panel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','storage-usage-title')
  const header=node('div',undefined,'storage-usage-header'),heading=node('h2','Cached data');heading.id='storage-usage-title';heading.tabIndex=-1
  const close=node('button','×','storage-usage-close');close.type='button';close.title='Close cache overview';close.setAttribute('aria-label',close.title);header.append(heading,close)
  const status=node('p','', 'storage-usage-status');status.setAttribute('role','status')
  const table=node('table'),thead=node('thead'),tr=node('tr');for(const text of ['Layer','Saved data','Items']){const th=node('th',text);th.scope='col';tr.append(th)}thead.append(tr);const tbody=node('tbody');table.append(thead,tbody)
  const total=node('p',undefined,'storage-usage-total'),origin=node('p',undefined,'storage-usage-origin');origin.hidden=true
  const note=node('p','IndexedDB payloads only; database overhead, browser tile caches and in-memory tiles are excluded.','storage-usage-note')
  const footer=node('div',undefined,'storage-usage-footer'),refresh=node('button','Refresh');refresh.type='button';refresh.title='Refresh cache usage';refresh.setAttribute('aria-label',refresh.title);footer.append(refresh)
  panel.append(header,status,table,total,origin,note,footer);root.append(button,panel);target.append(root)
  Object.assign(this,{root,button,panel,status,tbody,total,origin,refreshButton:refresh,heading})
  button.addEventListener('click',()=>this.opened?this.close():this.open());close.addEventListener('click',()=>this.close());refresh.addEventListener('click',()=>this.refresh())
  document.addEventListener('pointerdown',event=>{if(this.opened&&!root.contains(event.target))this.close(false)})
  document.addEventListener('keydown',event=>{if(this.opened&&event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close()}})
 }
 open(){this.onOpen();this.opened=true;this.panel.hidden=false;this.button.setAttribute('aria-expanded','true');this.heading.focus({preventScroll:true});this.refresh()}
 close(restoreFocus=true){this.opened=false;this.panel.hidden=true;this.button.setAttribute('aria-expanded','false');this.sequence++;this.worker?.terminate();this.worker=null;if(restoreFocus)this.button.focus({preventScroll:true})}
 async read(layers,id){
  if(!globalThis.Worker){const {inspectLayerStorage}=await import('../storage/usage.js');return inspectLayerStorage(layers)}
  this.worker?.terminate();this.worker=new Worker(new URL('../storage/usage-worker.js',import.meta.url),{type:'module'})
  return new Promise((resolve,reject)=>{
   const worker=this.worker
   const finish=()=>{worker.terminate();if(this.worker===worker)this.worker=null}
   worker.onmessage=({data})=>{if(data.id!==id)return;finish();if(data.error)reject(new Error(data.error));else resolve(data.result)}
   worker.onerror=()=>{finish();reject(new Error('Cached data could not be read.'))}
   worker.postMessage({id,layers})
  })
 }
 async refresh(){
  const id=++this.sequence;this.refreshButton.disabled=true;this.status.textContent='Reading cached data…';this.panel.setAttribute('aria-busy','true')
  try{
   const [result,estimate]=await Promise.all([this.read(this.getLayers(),id),Promise.resolve().then(()=>navigator.storage?.estimate?.()).catch(()=>null)])
   if(id!==this.sequence||!this.opened)return
   this.tbody.replaceChildren()
   for(const row of result.rows){const tr=node('tr');tr.dataset.layer=row.id;const label=node('th',row.label);label.scope='row';const bytes=node('td',formatStorageBytes(row.bytes)),entries=node('td',row.available?row.entries?row.entries.toLocaleString():'—':'—');if(!row.hasCache)entries.title='No IndexedDB cache';tr.append(label,bytes,entries);this.tbody.append(tr)}
   this.total.textContent=`Total saved data: ${formatStorageBytes(result.total)}`
   this.status.textContent=!result.supported?'IndexedDB is unavailable in this browser.':result.rows.some(row=>!row.available)?'Some cached data could not be read.':result.total===0?'No map data is cached in IndexedDB yet.':''
   this.origin.hidden=!Number.isFinite(estimate?.usage)
   if(!this.origin.hidden)this.origin.textContent=`Browser estimate for this origin: ${formatStorageBytes(estimate.usage)}${Number.isFinite(estimate.quota)?` / ${formatStorageBytes(estimate.quota)} quota`:''}. Includes other site storage.`
  }catch(error){if(id===this.sequence&&this.opened)this.status.textContent=error.message||'Cached data could not be read.'}
  finally{if(id===this.sequence){this.refreshButton.disabled=false;this.panel.removeAttribute('aria-busy')}}
 }
}
