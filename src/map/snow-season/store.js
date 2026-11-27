import {emptyChunk,setChunkCell,chunkRecord,chunkValue,compressChunk,decompressChunk} from './annual-chunk-codec.js?v=snow-refresh-v4'
import {chunkCell,chunkKey} from './chunk-grid.js?v=snow-refresh-v4'
const EXPIRY=30*86400000
/** Encoded 111x111 blocks only; raw historical time series never reach IndexedDB. */
export class SnowSeasonStore{
 constructor(namespace,{maximum=512,onChange=()=>{},firstEndYear=new Date().getUTCFullYear()-20,years=20}={}){
  Object.assign(this,{namespace,maximum,onChange,firstEndYear,years});this.memory=new Map();this.loading=new Map();this.dirty=new Set();this.database=null;this.timer=null;this.writes=0;this.serial=Promise.resolve()
 }
 async open(){
  if(this.database)return this.database
  this.database=new Promise(resolve=>{
   if(!globalThis.indexedDB){resolve(null);return}
   const request=indexedDB.open('frostmapper-snow-seasons',2);let settled=false
   const finish=value=>{if(!settled){settled=true;resolve(value)}else value?.close()}
   request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('chunks')){const store=db.createObjectStore('chunks',{keyPath:'id'});store.createIndex('used','used')}}
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();finish(db)}
   request.onerror=()=>finish(null);request.onblocked=()=>finish(null)
  });return this.database
 }
 id(key){return `${this.namespace}/${key}`}
 trim(keep){
  for(const [key] of this.memory){if(this.memory.size<=4)break;if(key!==keep&&!this.dirty.has(key))this.memory.delete(key)}
 }
 async getChunk(cx,cy){
  const key=chunkKey(cx,cy)
  if(this.memory.has(key)){const chunk=this.memory.get(key);this.memory.delete(key);this.memory.set(key,chunk);return chunk}
  if(this.loading.has(key))return this.loading.get(key)
  const pending=(async()=>{
   const db=await this.open();let chunk=null
   if(db){const stored=await new Promise(resolve=>{const request=db.transaction('chunks').objectStore('chunks').get(this.id(key));request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve(null)})
    if(stored&&Date.now()-stored.updated<EXPIRY)try{chunk=await decompressChunk(stored.payload);if(chunk.cx!==cx||chunk.cy!==cy||chunk.firstEndYear!==this.firstEndYear||chunk.years!==this.years)chunk=null}catch{/* Invalid cache entries are recomputed. */}}
   chunk??=emptyChunk(cx,cy,this)
   this.memory.set(key,chunk);this.trim(key);return chunk
  })().finally(()=>this.loading.delete(key));this.loading.set(key,pending);return pending
 }
 record(chunk,index,minimumDepth=0){return chunkRecord(chunk,index,minimumDepth)}
 value(chunk,index,metric,minimumDepth=0){return chunkValue(chunk,index,metric,minimumDepth)}
 async get(key,minimumDepth=0){
  const address=chunkCell(key),chunk=await this.getChunk(address.cx,address.cy)
  return this.record(chunk,address.index,minimumDepth)
 }
 async put(key,record){
  const address=chunkCell(key),chunk=await this.getChunk(address.cx,address.cy)
  setChunkCell(chunk,address.index,record);this.memory.set(address.key,chunk);this.dirty.add(address.key);this.onChange(address)
  this.scheduleFlush()
 }
 scheduleFlush(){if(!this.timer){this.timer=setTimeout(()=>{this.timer=null;this.flush()},2000);this.timer.unref?.()}}
 flush(){
  if(this.timer){clearTimeout(this.timer);this.timer=null}
  this.serial=this.serial.catch(()=>{}).then(async()=>{
   const db=await this.open();if(!db)return
   for(const key of [...this.dirty]){
    const chunk=this.memory.get(key);if(!chunk)continue
    const revision=chunk.revision,payload=await compressChunk(chunk),now=Date.now()
    const saved=await new Promise(resolve=>{const tx=db.transaction('chunks','readwrite');tx.objectStore('chunks').put({id:this.id(key),used:now,updated:now,payload});tx.oncomplete=()=>resolve(true);tx.onerror=()=>resolve(false);tx.onabort=()=>resolve(false)})
    if(saved&&chunk.revision===revision)this.dirty.delete(key)
    if(saved&&++this.writes%32===0)await this.prune(db)
   }
   this.trim()
  });return this.serial
 }
 async prune(db){
  await new Promise(resolve=>{const tx=db.transaction('chunks','readwrite'),store=tx.objectStore('chunks'),count=store.count();count.onsuccess=()=>{let remaining=count.result-this.maximum;if(remaining<=0)return;const cursor=store.index('used').openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(!c||remaining--<=0)return;c.delete();c.continue()}};tx.oncomplete=resolve;tx.onerror=resolve;tx.onabort=resolve})
 }
}
