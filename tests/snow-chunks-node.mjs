import test from 'node:test'
import assert from 'node:assert/strict'
import {encodePeriod,decodePeriod,NO_SEASON,UNKNOWN_PERIOD,ESCAPE_PERIOD,emptyChunk,setChunkCell,chunkRecord,encodeChunk,decodeChunk,compressChunk,decompressChunk,hasCell,dayIndex} from '../src/map/snow-season/chunk-codec.js'
import {chunkCell,nativeCell,chunksForExtent,SNOW_RESOLUTIONS,displayTileExtent} from '../src/map/snow-season/chunk-grid.js'
import {renderSnowTile} from '../src/map/snow-season/tile-renderer.js'
const record={status:'complete',start:'11-01',end:'05-31',days:212.25,lengthBounds:{minimum:212,maximum:212},wholeYears:{minimum:18,maximum:19},unknownDays:1,recoveredDays:2,altitude:1234}
test('all intervals decode exactly, with 64,131 direct states and all <=37 days covered',()=>{
 const seen=new Set();let direct=0,escapes=0
 for(let s=0;s<365;s++)for(let e=s;e<365;e++){
  const word=encodePeriod(s,e)
  if(word===ESCAPE_PERIOD){escapes++;assert.ok(e-s+1>=38);assert.deepEqual(decodePeriod(word,[s,e]),[s,e])}
  else{direct++;assert.ok(!seen.has(word));seen.add(word);assert.ok(![NO_SEASON,UNKNOWN_PERIOD,ESCAPE_PERIOD].includes(word));assert.deepEqual(decodePeriod(word),[s,e])}
 }
 assert.equal(direct,64131);assert.equal(escapes,2664)
})
test('codec rejects invalid dates, reserved words and malformed exceptions',()=>{
 for(const pair of [[-1,0],[3,2],[0,365],[1.5,2]])assert.throws(()=>encodePeriod(...pair))
 assert.throws(()=>dayIndex('02-29'));assert.throws(()=>dayIndex('09-31'));assert.equal(dayIndex('08-31'),364)
 assert.throws(()=>decodePeriod(0xfcfc));assert.throws(()=>decodePeriod(ESCAPE_PERIOD));assert.throws(()=>decodePeriod(ESCAPE_PERIOD,[365,365]))
})
test('chunk persists pending, known unknown, no-season, exceptions and exact estimator metadata',async()=>{
 const c=emptyChunk(1,10);setChunkCell(c,0,record);setChunkCell(c,99,{...record,start:'09-01',end:'11-30',days:91});setChunkCell(c,100,{status:'bounded',start:null,end:null,days:0,unknownDays:2});setChunkCell(c,9999,{status:'insufficient-data',start:null,end:null,days:null,unknownDays:99})
 assert.equal(c.words[99],ESCAPE_PERIOD)
 for(const restored of [decodeChunk(encodeChunk(c)),await decompressChunk(await compressChunk(c))]){
  assert.deepEqual(chunkRecord(restored,0),record);assert.deepEqual(chunkRecord(restored,99),chunkRecord(c,99));assert.equal(chunkRecord(restored,100).days,0);assert.equal(chunkRecord(restored,9999).days,null);assert.equal(chunkRecord(restored,1),null);assert.equal(hasCell(restored,1),false);assert.equal(hasCell(restored,9999),true);assert.equal(restored.cx,1);assert.equal(restored.cy,10)
 }
 const bytes=encodeChunk(c);assert.throws(()=>decodeChunk(bytes.subarray(0,bytes.length-1)));const bad=bytes.slice();new DataView(bad.buffer).setUint32(12,10001,true);assert.throws(()=>decodeChunk(bad))
})
test('chunk identity aligns negative eastings, top-down rows, edges and the complete domain',()=>{
 for(const [cx,cy,index] of [[0,0,0],[0,0,9999],[1,10,4312],[11,15,4994]]){
  const cell=nativeCell(cx,cy,index),a=chunkCell(cell.key);assert.deepEqual([a.cx,a.cy,a.index],[cx,cy,index])
 }
 assert.equal(chunksForExtent([-75000,6450000,1120000,8000000]).length,192);assert.equal(chunksForExtent([0,0,1000,1000]).length,0)
 assert.deepEqual(SNOW_RESOLUTIONS,[16000,8000,4000,2000,1000]);assert.deepEqual(displayTileExtent(4,0,0),[-75000,7900000,25000,8000000])
})
test('derived 100x100 tiles aggregate scalar values, preserve unknowns, and share chunk data across levels',async()=>{
 const c=emptyChunk(0,0);setChunkCell(c,0,record);setChunkCell(c,1,{...record,days:100});setChunkCell(c,100,{status:'complete',start:null,end:null,days:0})
 let reads=0;const store={async getChunk(cx,cy){reads++;return cx===0&&cy===0?c:emptyChunk(cx,cy)}}
 const native=await renderSnowTile(store,{z:4,x:0,y:0,metric:'length'});assert.equal(native.length,40000);assert.equal(native[3],255);assert.equal(native[7],255);assert.equal(native[11],0)
 const coarse=await renderSnowTile(store,{z:3,x:0,y:0,metric:'length'});assert.equal(coarse[3],191);assert.ok(reads>=5)
 const start=await renderSnowTile(store,{z:4,x:0,y:0,metric:'start'});assert.equal(start[3],255);assert.equal(start[100*4+3],0);assert.notDeepEqual([...start.subarray(0,3)],[...native.subarray(0,3)])
 await assert.rejects(()=>renderSnowTile(store,{z:5,x:0,y:0,metric:'length'}))
})
