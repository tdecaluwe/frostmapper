import test from 'node:test'
import assert from 'node:assert/strict'
import {encodePeriod,decodePeriod,NO_SEASON,UNKNOWN_PERIOD,ESCAPE_PERIOD,emptyChunk,setChunkCell,chunkRecord,encodeChunk,decodeChunk,compressChunk,decompressChunk,hasCell,dayIndex,CHUNK_SIZE,CHUNK_CELLS} from '../src/map/snow-season/chunk-codec.js'
import {chunkCell,nativeCell,chunksForExtent,SNOW_RESOLUTIONS,displayTileExtent,CHUNK_METRES} from '../src/map/snow-season/chunk-grid.js'
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
 const c=emptyChunk(1,10);setChunkCell(c,0,record);setChunkCell(c,99,{...record,start:'09-01',end:'11-30',days:91});setChunkCell(c,100,{status:'bounded',start:null,end:null,days:0,unknownDays:2});setChunkCell(c,CHUNK_CELLS-1,{status:'insufficient-data',start:null,end:null,days:null,unknownDays:99})
 assert.equal(c.words[99],ESCAPE_PERIOD)
 for(const restored of [decodeChunk(encodeChunk(c)),await decompressChunk(await compressChunk(c))]){
  assert.deepEqual(chunkRecord(restored,0),record);assert.deepEqual(chunkRecord(restored,99),chunkRecord(c,99));assert.equal(chunkRecord(restored,100).days,0);assert.equal(chunkRecord(restored,CHUNK_CELLS-1).days,null);assert.equal(chunkRecord(restored,1),null);assert.equal(hasCell(restored,1),false);assert.equal(hasCell(restored,CHUNK_CELLS-1),true);assert.equal(restored.cx,1);assert.equal(restored.cy,10)
 }
 const bytes=encodeChunk(c);assert.throws(()=>decodeChunk(bytes.subarray(0,bytes.length-1)));const bad=bytes.slice();new DataView(bad.buffer).setUint32(12,CHUNK_CELLS+1,true);assert.throws(()=>decodeChunk(bad))
})
test('chunk identity aligns negative eastings, top-down rows, edges and the complete domain',()=>{
 for(const [cx,cy,index] of [[0,0,0],[0,0,CHUNK_CELLS-1],[1,10,4312],[11,15,4994]]){
  const cell=nativeCell(cx,cy,index),a=chunkCell(cell.key);assert.deepEqual([a.cx,a.cy,a.index],[cx,cy,index])
 }
 assert.equal(chunksForExtent([-75000,6450000,1120000,8000000]).length,154);assert.equal(chunksForExtent([0,0,1000,1000]).length,0)
 assert.deepEqual(SNOW_RESOLUTIONS,[16000,8000,4000,2000,1000]);assert.deepEqual(displayTileExtent(4,0,0),[-75000,7889000,36000,8000000])
})
test('derived 111x111 tiles aggregate scalar values, preserve unknowns, and share chunk data across levels',async()=>{
 const c=emptyChunk(0,0);setChunkCell(c,0,record);setChunkCell(c,1,{...record,days:100});setChunkCell(c,CHUNK_SIZE,{status:'complete',start:null,end:null,days:0})
 let reads=0;const store={value(c,i,metric){const r=chunkRecord(c,i);return metric==='length'?r.days:r[metric]?dayIndex(r[metric]):null},async getChunk(cx,cy){reads++;return cx===0&&cy===0?c:emptyChunk(cx,cy)}}
 const native=await renderSnowTile(store,{z:4,x:0,y:0,metric:'length'});assert.equal(native.length,CHUNK_CELLS*4);assert.equal(native[3],255);assert.equal(native[7],255);assert.equal(native[11],0)
 const coarse=await renderSnowTile(store,{z:3,x:0,y:0,metric:'length'});assert.equal(coarse[3],191);assert.ok(reads>=5)
 const start=await renderSnowTile(store,{z:4,x:0,y:0,metric:'start'});assert.equal(start[3],255);assert.equal(start[CHUNK_SIZE*4+3],0);assert.notDeepEqual([...start.subarray(0,3)],[...native.subarray(0,3)])
 await assert.rejects(()=>renderSnowTile(store,{z:5,x:0,y:0,metric:'length'}))
})

import {SnowCollectionQueue} from '../src/map/snow-season/collection-queue.js'
function seededRandom(seed=12345){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}}
test('queue credits cached cells in bulk and never samples known, reserved or completed cells',()=>{
 const c=emptyChunk(0,0);c.known.fill(255)
 const pending=[0,31,32,63,64,150,800,900,CHUNK_CELLS-1]
 for(const i of pending)c.known[i>>>3]&=~(1<<(i&7))
 const q=new SnowCollectionQueue({random:seededRandom()});q.addChunk(c);assert.equal(q.total,CHUNK_CELLS);assert.equal(q.completed,CHUNK_CELLS-pending.length)
 const cells=[];for(let i=0;i<pending.length;i++)cells.push(q.take())
 assert.equal(q.take(),null);assert.equal(new Set(cells.map(c=>c.key)).size,pending.length)
 assert.deepEqual(cells.map(c=>chunkCell(c.key).index).sort((a,b)=>a-b),pending)
 for(const cell of cells){q.complete(cell);q.complete(cell)}
 assert.equal(q.completed,CHUNK_CELLS);assert.equal(q.take(),null)
})
test('queue preserves visible priority across pans and makes failed reservations available again',()=>{
 const q=new SnowCollectionQueue({random:seededRandom()}),a=emptyChunk(0,0),b=emptyChunk(5,5);q.addChunk(a);q.addChunk(b)
 q.setViewport(displayTileExtent(4,0,0));const old=q.take();assert.equal(chunkCell(old.key).cx,0)
 q.setViewport(displayTileExtent(4,5,5));const current=q.take();assert.equal(chunkCell(current.key).cx,5)
 q.retry(current);assert.equal(q.completed,0);assert.equal(q.reserved.size,1)
 const job=q.jobs.get('5/5'),index=chunkCell(current.key).index;assert.ok(job.pending[index>>>5]&(1<<(index&31)))
 q.complete(old);assert.equal(q.completed,1)
 for(let i=0;i<100;i++){const c=q.take();assert.equal(chunkCell(c.key).cx,5);q.complete(c)}
})
test('random coverage reaches the viewport edges with only a mild centre bias',()=>{
 let central=0;const quadrants=[0,0,0,0]
 for(let trial=0;trial<200;trial++){
  const q=new SnowCollectionQueue({random:seededRandom(901+trial)});q.setViewport(displayTileExtent(4,0,0));q.addChunk(emptyChunk(0,0))
  for(let i=0;i<100;i++){const c=q.take(),index=chunkCell(c.key).index,col=index%CHUNK_SIZE,row=Math.floor(index/CHUNK_SIZE);if(col>=CHUNK_SIZE*.25&&col<CHUNK_SIZE*.75&&row>=CHUNK_SIZE*.25&&row<CHUNK_SIZE*.75)central++;quadrants[Number(col>=CHUNK_SIZE/2)+2*Number(row>=CHUNK_SIZE/2)]++;q.complete(c)}
 }
 assert.ok(central/20000>.275&&central/20000<.32,`central share ${central/20000}`)
 assert.ok(quadrants.every(n=>n>4500&&n<5500),`quadrants ${quadrants}`)
})
test('queue handles partial edge chunks, clipped viewports and a completely cached domain',()=>{
 const q=new SnowCollectionQueue({random:seededRandom()}),edge=emptyChunk(10,13);edge.known.fill(255);q.setViewport(displayTileExtent(4,10,13));q.addChunk(edge);assert.equal(q.total,85*107);assert.equal(q.completed,85*107);assert.equal(q.take(),null)
 const r=new SnowCollectionQueue({random:seededRandom()});r.addChunk(emptyChunk(0,0));r.setViewport([-75000,7999500,-74500,8000000]);const only=r.take();assert.equal(chunkCell(only.key).index,0);assert.equal(r.take({background:false}),null);r.complete(only);assert.ok(r.take())
})
test('wide views sample across distant visible chunks rather than a central crop',()=>{
 const q=new SnowCollectionQueue({random:seededRandom(2026)});q.setViewport([-75000,8000000-7*CHUNK_METRES,-75000+7*CHUNK_METRES,8000000]);q.addChunk(emptyChunk(0,0));q.addChunk(emptyChunk(6,6));let left=0,right=0
 for(let i=0;i<100;i++){const cell=q.take();if(chunkCell(cell.key).cx===0)left++;else right++;q.complete(cell)}
 assert.ok(left>30&&right>30,`visible chunks ${left}/${right}`)
})
