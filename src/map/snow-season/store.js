/** Per-browser summary cache. Raw historical time series are never persisted. */
export class SnowSeasonStore{
 constructor(namespace,{maximum=16384}={}){this.namespace=namespace;this.maximum=maximum;this.memory=new Map();this.writes=0;this.database=null}
 async open(){
  if(this.database)return this.database
  this.database=new Promise(resolve=>{
   if(!globalThis.indexedDB){resolve(null);return}
   const request=indexedDB.open('frostmapper-snow-seasons',1)
   request.onupgradeneeded=()=>{const store=request.result.createObjectStore('summaries',{keyPath:'id'});store.createIndex('used','used')}
   request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve(null)
  });return this.database
 }
 id(key){return `${this.namespace}/${key}`}
 remember(key,value){this.memory.delete(key);this.memory.set(key,value);if(this.memory.size>4096)this.memory.delete(this.memory.keys().next().value)}
 async get(key){
  if(this.memory.has(key))return this.memory.get(key)
  const db=await this.open();if(!db)return null
  return new Promise(resolve=>{const request=db.transaction('summaries').objectStore('summaries').get(this.id(key));request.onsuccess=()=>{const value=request.result&&Date.now()-request.result.used<30*86400000?request.result.value:null;if(value)this.remember(key,value);resolve(value)};request.onerror=()=>resolve(null)})
 }
 async put(key,value){
  this.remember(key,value);const db=await this.open();if(!db)return
  await new Promise(resolve=>{const tx=db.transaction('summaries','readwrite');tx.objectStore('summaries').put({id:this.id(key),used:Date.now(),value});tx.oncomplete=resolve;tx.onerror=resolve;tx.onabort=resolve})
  if(++this.writes%128===0)await this.prune(db)
 }
 async prune(db){
  await new Promise(resolve=>{const tx=db.transaction('summaries','readwrite'),store=tx.objectStore('summaries'),count=store.count();count.onsuccess=()=>{
   let remaining=count.result-this.maximum;if(remaining<=0)return
   const cursor=store.index('used').openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(!c||remaining--<=0)return;c.delete();c.continue()}
  };tx.oncomplete=resolve;tx.onerror=resolve;tx.onabort=resolve})
 }
}
