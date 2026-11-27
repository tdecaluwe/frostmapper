import test from 'node:test'
import assert from 'node:assert/strict'
import {SnowDownloadGate,retryAfterMs} from '../src/map/snow-season/download-gate.js'
import {SnowChunkCollector} from '../src/map/snow-season/chunk-collector.js'
import {emptyChunk,encodeChunk,decodeChunk,hasCell,setChunkCell,annualCell} from '../src/map/snow-season/annual-chunk-codec.js'
import {nativeCell} from '../src/map/snow-season/chunk-grid.js'
import {estimateAnnualSeasons,seasonDays} from '../src/map/snow-season/annual-seasons.js'
const tick=()=>new Promise(r=>setTimeout(r,0))
function locks(){const tails=new Map();return {request(name,options,fn){const next=(tails.get(name)??Promise.resolve()).catch(()=>{}).then(()=>{options.signal?.throwIfAborted();return fn()});tails.set(name,next);return next}}}
function state(){let value={};return {read:async()=>({...value}),write:async v=>{value={...v}}}}
test('Retry-After accepts both HTTP formats, including an immediate retry',()=>{
 assert.equal(retryAfterMs('12'),12000);assert.equal(retryAfterMs('0'),0);assert.equal(retryAfterMs('Fri, 27 Nov 2026 12:00:00 GMT',Date.UTC(2026,10,27,11,59,50)),10000)
 for(const v of [null,'','garbage','-1'])assert.equal(retryAfterMs(v),null)
})
test('separate gates share the lock until the entire response body is consumed',async()=>{
 const shared=locks(),sharedState=state(),a=new SnowDownloadGate({locks:shared,state:sharedState,spacingMs:0}),b=new SnowDownloadGate({locks:shared,state:sharedState,spacingMs:0})
 let finish,started=0
 const first=a.download('a',{fetchImpl:async()=>{started++;return new Response(new ReadableStream({start(c){finish=()=>{c.enqueue(new Uint8Array([1]));c.close()}}}))}})
 await tick();const second=b.download('b',{fetchImpl:async()=>{started++;return new Response(new Uint8Array([2]))}})
 await tick();assert.equal(started,1);finish();assert.deepEqual([...new Uint8Array(await first)],[1]);assert.deepEqual([...new Uint8Array(await second)],[2]);assert.equal(started,2)
})
test('another gate honors persisted cooldown; successes reset failures',async()=>{
 const shared=locks(),sharedState=state(),waits=[];let time=1000
 const options={locks:shared,state:sharedState,now:()=>time,random:()=>0,wait:async ms=>{waits.push(ms);time+=ms},spacingMs:0}
 await assert.rejects(new SnowDownloadGate(options).download('a',{fetchImpl:async()=>new Response('',{status:429,headers:{'Retry-After':'120'}})}),/429/)
 assert.equal((await sharedState.read()).until,121000)
 await new SnowDownloadGate(options).download('b',{fetchImpl:async()=>{assert.equal(time,121000);return new Response('ok')}})
 assert.deepEqual(waits,[60000,60000]);assert.equal((await sharedState.read()).failures,0)
})
test('429 without Retry-After and server/network failures back off conservatively',async()=>{
 for(const [status,delay] of [[429,30000],[503,5000],[0,1000]]){
  const sharedState=state(),gate=new SnowDownloadGate({locks:locks(),state:sharedState,now:()=>1000,random:()=>0})
  await assert.rejects(gate.download('a',{fetchImpl:async()=>{if(!status)throw new TypeError('Load failed');return new Response('',{status})}}))
  assert.equal((await sharedState.read()).until,1000+delay)
 }
})
test('aborted downloads release ownership without creating a rate-limit cooldown',async()=>{
 const sharedState=state(),gate=new SnowDownloadGate({locks:locks(),state:sharedState,spacingMs:0}),controller=new AbortController()
 const reason=new DOMException('resume','AbortError')
 await assert.rejects(gate.download('a',{signal:controller.signal,fetchImpl:async()=>{controller.abort(reason);throw reason}}),e=>e===reason)
 assert.equal((await sharedState.read()).until,undefined)
 assert.equal((await gate.download('b',{fetchImpl:async()=>new Response('ok')})).byteLength,2)
})
function collectionFixture(){
 const cohort={firstEndYear:2022,years:3},chunk=emptyChunk(0,0,cohort),cached=estimateAnnualSeasons({startDate:'2021-09-01',bands:new Uint8Array(1096)},cohort)
 // Only two cells are pending in this entire chunk.
 for(let i=2;i<111*111;i++)setChunkCell(chunk,i,cached)
 let snapshot=encodeChunk(chunk),notifications=0
 const store=()=>({namespace:'test',reloadChunk:async()=>decodeChunk(snapshot),saveChunk:async(c,{notify})=>{snapshot=encodeChunk(c);if(notify)notifications++},onChange:()=>{notifications++}})
 const cells=[0,1].map(i=>({...nativeCell(0,0,i),localIndex:i})),area={key:'0/0',bx:0,by:0,cells},calls=[],released=[];let failYear=2023
 const source={async load(area,year){calls.push(year.firstEndYear);if(year.firstEndYear===failYear)throw new TypeError('interrupted');return {key:String(year.firstEndYear),inputForCell:()=>({startDate:year.startDate,bands:new Uint8Array(seasonDays(year.firstEndYear)).fill(1)})}},release(key){released.push(key)}}
 return {cohort,area,source,store,calls,released,chunk:()=>decodeChunk(snapshot),resume:()=>{failYear=null},notifications:()=>notifications}
}
test('annual checkpoints survive interruption; pending cells stay hidden and existing cells survive',async()=>{
 const f=collectionFixture(),gate=new SnowDownloadGate({locks:locks()}),collector=new SnowChunkCollector({...f,store:f.store(),gate})
 await assert.rejects(collector.collect(f.area),/interrupted/)
 assert.equal(f.chunk().completedYears,1);assert.equal(hasCell(f.chunk(),0),false);assert.equal(hasCell(f.chunk(),2),true);assert.equal(f.notifications(),0)
 const existing=annualCell(f.chunk(),2);f.resume()
 await new SnowChunkCollector({...f,store:f.store(),gate}).collect(f.area)
 assert.deepEqual(f.calls,[2022,2023,2023,2024]);assert.equal(f.chunk().completedYears,7);assert.equal(hasCell(f.chunk(),0),true);assert.deepEqual(annualCell(f.chunk(),2),existing);assert.equal(f.notifications(),1)
 assert.deepEqual(f.released,['2022','2023','2024'])
})
test('two collectors recheck checkpoints under the region lock, downloading each year once',async()=>{
 const f=collectionFixture();f.resume();const shared=locks()
 await Promise.all([1,2].map(()=>new SnowChunkCollector({...f,store:f.store(),gate:new SnowDownloadGate({locks:shared})}).collect(f.area)))
 assert.deepEqual(f.calls,[2022,2023,2024]);assert.equal(hasCell(f.chunk(),1),true)
})
