import test from 'node:test'
import assert from 'node:assert/strict'
import {savedDataBytes,formatStorageBytes,inspectLayerStorage} from '../src/map/storage/usage.js'
import {layerStorageDefinitions} from '../src/map/controls/storage-usage.js'
test('saved data counts compressed buffers, typed-array views, blobs and UTF-8 legacy values',()=>{
 assert.equal(savedDataBytes({id:'not part of payload',payload:{format:'deflate',data:new ArrayBuffer(4096)}}),4096)
 assert.equal(savedDataBytes({payload:{data:new Uint8Array(new ArrayBuffer(100),10,20)}}),20)
 assert.equal(savedDataBytes({payload:{data:new Blob(['snow'])}}),4)
 assert.equal(savedDataBytes({value:'ø'}),4)
 assert.equal(savedDataBytes({value:{days:0}}),10);assert.equal(savedDataBytes({value:null}),4)
})
test('size labels distinguish bytes, binary units, zero and unavailable readings',()=>{
 assert.equal(formatStorageBytes(0),'0 B');assert.equal(formatStorageBytes(1023),'1023 B');assert.equal(formatStorageBytes(1024),'1 KiB');assert.equal(formatStorageBytes(1048576),'1 MiB');assert.equal(formatStorageBytes(null),'Unavailable')
})
test('layer definitions include hidden layers, traverse groups and deduplicate stores',()=>{
 const layer=properties=>({get:key=>properties[key]})
 const snow={storageLabel:'Snow',storageId:'snow',storageStores:[{database:'db',store:'chunks'}]}
 const group={getLayers:()=>({getArray:()=>[layer(snow),layer(snow),layer({})]})}
 const definitions=layerStorageDefinitions({getLayers:()=>({getArray:()=>[layer({storageLabel:'Base'}),group]})})
 assert.deepEqual(definitions,[{id:'Base',label:'Base',stores:[]},{id:'snow',label:'Snow',stores:[{database:'db',store:'chunks'}]}])
})
test('unavailable IndexedDB is distinct from a layer with no IndexedDB cache',async()=>{
 const result=await inspectLayerStorage([{id:'base',label:'Base',stores:[]},{id:'snow',label:'Snow',stores:[{database:'db',store:'chunks'}]}],{implementation:null})
 assert.equal(result.supported,false);assert.equal(result.rows[0].bytes,0);assert.equal(result.rows[1].bytes,null);assert.equal(result.total,null)
})
