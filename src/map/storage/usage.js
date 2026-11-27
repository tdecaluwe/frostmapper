/** Saved payload sizes, not the browser's private database/index allocation. */
export function savedDataBytes(entry){
 const data=entry?.payload?.data
 if(data instanceof ArrayBuffer||ArrayBuffer.isView(data))return data.byteLength
 if(typeof Blob!=='undefined'&&data instanceof Blob)return data.size
 const json=JSON.stringify(entry&&Object.hasOwn(entry,'value')?entry.value:entry,(_,value)=>typeof value==='bigint'?String(value):value)
 return json===undefined?0:new TextEncoder().encode(json).byteLength
}
export function formatStorageBytes(bytes){
 if(!Number.isFinite(bytes)||bytes<0)return 'Unavailable'
 if(bytes<1024)return `${bytes} B`
 const units=['KiB','MiB','GiB','TiB'];let value=bytes/1024,index=0
 while(value>=1024&&index<units.length-1){value/=1024;index++}
 return `${value.toLocaleString(undefined,{maximumFractionDigits:value<10?2:1})} ${units[index]}`
}
async function openExistingDatabase(name,implementation){
 return new Promise(resolve=>{
  let request,missing=false,settled=false
  const finish=result=>{if(settled){result.db?.close();return}settled=true;resolve(result)}
  try{request=implementation.open(name)}catch{return finish({error:true})}
  // Opening the overview must not create an empty database or change a version.
  request.onupgradeneeded=()=>{missing=true;request.transaction.abort()}
  request.onsuccess=()=>finish({db:request.result})
  request.onerror=event=>{event.preventDefault();finish(missing?{missing:true}:{error:true})}
  request.onblocked=()=>finish({error:true})
 })
}
async function inspectDatabase(name,stores,implementation){
 const opened=await openExistingDatabase(name,implementation),result=new Map(stores.map(store=>[store,{bytes:0,entries:0}]))
 if(opened.error)return {error:true,result}
 if(!opened.db)return {result}
 const db=opened.db
 try{
  const existing=stores.filter(store=>db.objectStoreNames.contains(store));if(!existing.length)return {result}
  await new Promise((resolve,reject)=>{
   const tx=db.transaction(existing,'readonly')
   for(const name of existing){const request=tx.objectStore(name).openCursor();request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const stats=result.get(name);try{stats.bytes+=savedDataBytes(cursor.value);stats.entries++}catch{tx.abort();return}cursor.continue()}}
   tx.oncomplete=resolve;tx.onerror=()=>reject(new Error('Cache read failed'));tx.onabort=()=>reject(new Error('Cache read aborted'))
  });return {result}
 }catch{return {error:true,result}}finally{db.close()}
}
/** One read per database/store, even if a caller lists multiple owners. */
export async function inspectLayerStorage(layers,{implementation=globalThis.indexedDB}={}){
 const databases=new Map()
 for(const layer of layers)for(const spec of layer.stores??[]){if(!databases.has(spec.database))databases.set(spec.database,new Set());databases.get(spec.database).add(spec.store)}
 const readings=new Map(await Promise.all([...databases].map(async([name,stores])=>[name,implementation?await inspectDatabase(name,[...stores],implementation):{error:true}])))
 const rows=layers.map(layer=>{
  let bytes=0,entries=0,available=true;const stores=[]
  for(const spec of layer.stores??[]){const database=readings.get(spec.database),stats=database.result?.get(spec.store);if(database.error)available=false;if(stats){bytes+=stats.bytes;entries+=stats.entries;stores.push({name:spec.store,...stats})}}
  return {id:layer.id,label:layer.label,bytes:available?bytes:null,entries:available?entries:null,hasCache:Boolean(layer.stores?.length),available,stores}
 })
 // Count a shared store only once in the total.
 let total=0,complete=true
 for(const db of readings.values()){if(db.error){complete=false;continue}for(const stats of db.result.values())total+=stats.bytes}
 return {rows,total:complete?total:null,supported:Boolean(implementation)}
}
