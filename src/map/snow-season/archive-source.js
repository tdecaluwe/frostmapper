import {snowFetchBlock} from './area-grid.js?v=snow-refresh-v4'
import {depthIndex,snowDepthBand} from './depths.js?v=snow-refresh-v4'
const DAY=86400000,BASE='https://thredds.met.no/thredds/dodsC/senorge/seNorge_snow',VARIABLES={sd:'snow_depth',swe:'snow_water_equivalent'}
const iso=day=>new Date(day*DAY).toISOString().slice(0,10)
function dayNumber(value){const n=Date.parse(`${value}T00:00:00Z`)/DAY;if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isInteger(n)||iso(n)!==value)throw new RangeError('Invalid archive date');return n}
export function fourMonthWindows(startDate,endDate){
 const start=dayNumber(startDate),end=dayNumber(endDate);if(start>end)throw new RangeError('Inverted archive dates')
 const windows=[]
 for(let year=Number(startDate.slice(0,4));year<=Number(endDate.slice(0,4));year++)for(const month of [0,4,8]){
  const first=Math.max(start,Date.UTC(year,month,1)/DAY),last=Math.min(end,Date.UTC(year,month+4,1)/DAY-1)
  if(first>last)continue
  windows.push({key:`${year}/${first}/${last}`,year,first,last,offset:first-start,days:last-first+1,firstIndex:first-Date.UTC(year,0,1)/DAY,lastIndex:last-Date.UTC(year,0,1)/DAY})
 }
 return windows
}
export function archiveUrl(theme,window,block){
 const variable=VARIABLES[theme];if(!variable)throw new RangeError('Unknown snow archive variable')
 const expression=`${variable}.${variable}[${window.firstIndex}:${window.lastIndex}][${block.yFirst}:${block.yLast}][${block.xFirst}:${block.xLast}]`
 return `${BASE}/${theme}/${theme}_${window.year}.nc.dods?${encodeURIComponent(expression)}`
}
/** Only the one-array DAP2 response used by the source, not a general NetCDF parser. */
export function parseArchiveArray(buffer,{days,width,height},variable='snow_depth'){
 const bytes=new Uint8Array(buffer),header=new TextDecoder().decode(bytes.subarray(0,2048)),marker=header.indexOf('Data:\n'),values=days*width*height
 if(marker<0)throw new RangeError('Missing snow archive data')
 const dimensions=new RegExp(`Float32 ${variable}\\[time = (\\d+)\\]\\[y = (\\d+)\\]\\[x = (\\d+)\\]`).exec(header.slice(0,marker))
 const offset=marker+6,view=new DataView(buffer)
 if(!dimensions||Number(dimensions[1])!==days||Number(dimensions[2])!==height||Number(dimensions[3])!==width||buffer.byteLength!==offset+8+values*4||view.getUint32(offset)!==values||view.getUint32(offset+4)!==values)throw new RangeError('Invalid snow archive array')
 return {view,offset:offset+8,values}
}
const abortError=()=>new DOMException('Snow request cancelled','AbortError')
/** Shared HTTP cap; queued priorities are evaluated again after every request. */
export class SnowArchiveRequestPool{
 constructor({concurrency=8,onChange=()=>{}}={}){if(!Number.isInteger(concurrency)||concurrency<1||concurrency>32)throw new RangeError('Invalid archive concurrency');this.concurrency=concurrency;this.onChange=onChange;this.active=0;this.queue=[];this.paused=false}
 run(fn,{priority=()=>0,signal}={}){
  return new Promise((resolve,reject)=>{
   if(signal?.aborted){reject(signal.reason??abortError());return}
   const task={fn,priority,signal,resolve,reject,abort:null}
   task.abort=()=>{const i=this.queue.indexOf(task);if(i>=0){this.queue.splice(i,1);signal.removeEventListener('abort',task.abort);reject(signal.reason??abortError())}}
   signal?.addEventListener('abort',task.abort,{once:true});this.queue.push(task);this.pump()
  })
 }
 pump(){
  while(!this.paused&&this.active<this.concurrency&&this.queue.length){
   let best=0;for(let i=1;i<this.queue.length;i++)if(this.queue[i].priority()<this.queue[best].priority())best=i
   const [task]=this.queue.splice(best,1);task.signal?.removeEventListener('abort',task.abort)
   if(task.signal?.aborted){task.reject(task.signal.reason??abortError());continue}
   this.active++;this.onChange()
   Promise.resolve().then(task.fn).then(task.resolve,task.reject).finally(()=>{this.active--;this.onChange();this.pump()})
  }
 }
}
/** Two bits per daily state, allocated only for cells missing from the cache. */
export class PackedSnowHistory{
 constructor({cells,days,indices}){
  if(!Number.isInteger(days)||days<1||days>65535||!Number.isInteger(cells)||cells<1||cells>222*222)throw new RangeError('Invalid snow history dimensions')
  this.days=days;this.indices=[...indices];this.lookup=new Int32Array(cells).fill(-1)
  for(let row=0;row<indices.length;row++){const i=indices[row];if(!Number.isInteger(i)||i<0||i>=cells||this.lookup[i]!==-1)throw new RangeError('Invalid snow history cell');this.lookup[i]=row}
  this.data=new Uint8Array(Math.ceil(indices.length*days/4)).fill(0xaa);this.unknown=new Uint16Array(indices.length).fill(days);this.recovered=new Map()
 }
 get(row,day){const p=row*this.days+day;return this.data[p>>>2]>>>((p&3)*2)&3}
 set(row,day,state){const p=row*this.days+day,shift=(p&3)*2,old=this.data[p>>>2]>>>shift&3;if(old===state)return;this.data[p>>>2]=(this.data[p>>>2]&~(3<<shift))|(state<<shift);this.unknown[row]+=Number(state===2)-Number(old===2)}
 cover(localIndex){const row=this.lookup[localIndex];if(row<0)throw new RangeError('Snow history cell not loaded');const cover=new Uint8Array(this.days);for(let d=0;d<this.days;d++){const value=this.get(row,d);cover[d]=value===2?255:value}return cover}
}
/** One nibble per daily depth band; transient and allocated for uncached cells. */
export class PackedSnowDepthHistory{
 constructor({cells,days,indices}){
  if(!Number.isInteger(days)||days<1||days>65535||!Number.isInteger(cells)||cells<1||cells>222*222)throw new RangeError('Invalid depth history dimensions')
  this.days=days;this.indices=[...indices];this.lookup=new Int32Array(cells).fill(-1)
  for(let row=0;row<indices.length;row++){const i=indices[row];if(!Number.isInteger(i)||i<0||i>=cells||this.lookup[i]!==-1)throw new RangeError('Invalid depth history cell');this.lookup[i]=row}
  this.data=new Uint8Array(Math.ceil(indices.length*days/2)).fill(0x77);this.unknown=new Uint16Array(indices.length).fill(days);this.recovered=new Map()
 }
 get(row,day){const p=row*this.days+day;return this.data[p>>>1]>>>((p&1)*4)&15}
 set(row,day,state){const p=row*this.days+day,shift=(p&1)*4,old=this.get(row,day);if(old===state)return;this.data[p>>>1]=(this.data[p>>>1]&~(15<<shift))|(state<<shift);this.unknown[row]+=Number(state===7)-Number(old===7)}
 bands(localIndex){const row=this.lookup[localIndex];if(row<0)throw new RangeError('Depth history cell not loaded');const values=new Uint8Array(this.days);for(let d=0;d<this.days;d++)values[d]=this.get(row,d);return values}
 cover(localIndex,minimumDepth=0){const level=depthIndex(minimumDepth),values=this.bands(localIndex);return values.map(v=>v===7||v===6&&level>0?255:Number(v===6||v>level))}
}
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))
/** Numeric, browser-readable spatial windows. No raw histories are persisted. */
export class SnowArchiveSource{
 constructor({fetchImpl=(...args)=>globalThis.fetch(...args),pool=new SnowArchiveRequestPool(),minimumDepthMm=0,maximumPartialBlocks=4,depthBands=false}={}){
  if(!Number.isFinite(minimumDepthMm)||minimumDepthMm<0||!Number.isInteger(maximumPartialBlocks)||maximumPartialBlocks<1)throw new RangeError('Invalid snow archive configuration')
  Object.assign(this,{fetch:fetchImpl,pool,minimumDepthMm,maximumPartialBlocks,depthBands});this.partial=new Map();this.inUse=new Set()
 }
 release(key,{keep=false}={}){this.inUse.delete(key);if(!keep)this.partial.delete(key);this.prune()}
 prune(){for(const key of this.partial.keys()){if(this.partial.size<=this.maximumPartialBlocks)break;if(!this.inUse.has(key))this.partial.delete(key)}}
 async array(theme,window,block,signal){
  const response=await this.fetch(archiveUrl(theme,window,block),{signal:AbortSignal.any([signal,AbortSignal.timeout(60000)]),cache:'no-store'})
  if(!response.ok)throw new Error(`Snow archive ${theme}: HTTP ${response.status}`)
  return parseArchiveArray(await response.arrayBuffer(),{days:window.days,width:block.width,height:block.height},VARIABLES[theme])
 }
 async consume(array,window,entry,{swe=false,signal}){
  const {block,history}=entry;let started=performance.now()
  for(let t=0;t<window.days;t++){
   if(signal.aborted)throw signal.reason??abortError()
   const day=window.offset+t
   for(let south=0;south<block.height;south++)for(let col=0;col<block.width;col++){
    const local=(block.height-1-south)*block.width+col,row=history.lookup[local];if(row<0)continue
    const value=array.view.getFloat32(array.offset+4*(t*block.cells+south*block.width+col)),valid=Number.isFinite(value)&&value>=0&&value!==65535
    if(swe){
     if(history.get(row,day)===(this.depthBands?7:2)&&valid&&value>0){history.set(row,day,this.depthBands?6:1);if(!history.recovered.has(row))history.recovered.set(row,new Set());history.recovered.get(row).add(day)}
    }else history.set(row,day,this.depthBands?snowDepthBand(value):valid?Number(value*10>this.minimumDepthMm):2)
   }
   if(performance.now()-started>8){await yieldTask();started=performance.now()}
  }
 }
 async load({bx,by,cells},cohort,{priority=()=>0}={}){
  const block=snowFetchBlock(bx,by),windows=fourMonthWindows(cohort.startDate,cohort.endDate),days=dayNumber(cohort.endDate)-dayNumber(cohort.startDate)+1,key=`${cohort.startDate}/${cohort.endDate}/${block.key}`,indices=cells.map(cell=>cell.localIndex)
  let entry=this.partial.get(key)
  if(!entry||indices.some(i=>entry.history.lookup[i]<0))entry={block,history:new (this.depthBands?PackedSnowDepthHistory:PackedSnowHistory)({cells:block.cells,days,indices}),complete:new Set(),start:dayNumber(cohort.startDate)}
  this.partial.delete(key);this.partial.set(key,entry);this.inUse.add(key);this.prune()
  const controller=new AbortController(),pending=[];let ready=false
  const request=(theme,window,id)=>{
   if(entry.complete.has(id))return Promise.resolve()
   const promise=this.pool.run(async()=>{const array=await this.array(theme,window,block,controller.signal);await this.consume(array,window,entry,{swe:theme==='swe',signal:controller.signal});entry.complete.add(id)},{priority,signal:controller.signal})
   pending.push(promise);return promise
  }
  try{
   await Promise.all(windows.map(window=>request('sd',window,`sd/${window.key}`)))
   // As with the point loader, positive SWE can resolve up to eight unknown
   // dates per cell. Zero SWE never establishes bare ground. Model-missing
   // cells with entire histories absent do not trigger thousands of requests.
   if(this.minimumDepthMm===0){
    const dates=new Set(),history=entry.history
    for(const local of indices){const row=history.lookup[local];if(history.unknown[row]>0&&history.unknown[row]<=8)for(let d=0;d<days;d++)if(history.get(row,d)===(this.depthBands?7:2))dates.add(d)}
    const groups=[]
    for(const offset of [...dates].sort((a,b)=>a-b)){
     const first=entry.start+offset,year=new Date(first*DAY).getUTCFullYear(),last=groups.at(-1)
     if(last&&last.last+1===first&&last.year===year&&last.days<123){last.last=first;last.lastIndex++;last.days++}
     else groups.push({year,first,last:first,offset,days:1,firstIndex:first-Date.UTC(year,0,1)/DAY,lastIndex:first-Date.UTC(year,0,1)/DAY})
    }
    await Promise.all(groups.map(window=>request('swe',window,`swe/${window.first}/${window.last}`)))
   }
   ready=true
   return {key,block,history:entry.history,inputForCell:local=>{
    const row=entry.history.lookup[local]
    return {startDate:cohort.startDate,...(this.depthBands?{bands:entry.history.bands(local)}:{cover:entry.history.cover(local)}),quality:{sweRecoveredDates:[...(entry.history.recovered.get(row)??[])].sort((a,b)=>a-b).map(d=>iso(entry.start+d))},source:{name:'NVE seNorge sd via MET THREDDS',projection:'EPSG:32633',nativeResolutionM:1000,altitudeM:null,supplementError:null}}
   }}
  }catch(error){controller.abort(error);await Promise.allSettled(pending);throw error}
  finally{if(!ready)this.inUse.delete(key);this.prune()}
 }
}
