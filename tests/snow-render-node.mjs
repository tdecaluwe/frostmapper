import test from 'node:test'
import assert from 'node:assert/strict'
import {SnowRenderQueue} from '../src/map/snow-season/render-queue.js'
import {renderSnowTile} from '../src/map/snow-season/tile-renderer.js'
import {emptyChunk,setChunkCell,chunkRecord,chunkValue} from '../src/map/snow-season/annual-chunk-codec.js'
const tick=()=>new Promise(r=>setTimeout(r,0)),request=(z=4,selection=0)=>({z,x:0,y:0,metric:'length',minimumDepth:0,selection})
test('equal render requests share computation and get independently transferable pixels',async()=>{
 let calls=0,finish
 const queue=new SnowRenderQueue(()=>{calls++;return new Promise(r=>{finish=r})})
 const a=queue.request(request()),b=queue.request(request());await tick();finish(new Uint8ClampedArray([1,2,3,255]))
 const [pa,pb]=await Promise.all([a,b]);assert.equal(calls,1);assert.deepEqual(pa,pb)
 structuredClone(pa.buffer,{transfer:[pa.buffer]});assert.equal(pb.byteLength,4)
})
test('fine visible rendering interrupts preload work and resumes its waiting callers',async()=>{
 const calls=[]
 const queue=new SnowRenderQueue(async(data,{signal})=>{
  calls.push(data.z)
  if(calls.length===1)await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))
  return new Uint8ClampedArray([data.z])
 },{priority:d=>d.z})
 const coarse=queue.request(request(0));await tick();const fine=queue.request(request(4))
 assert.equal((await fine)[0],4);assert.equal((await coarse)[0],0);assert.deepEqual(calls,[0,4,0]);assert.equal(queue.jobs.size,0)
})
test('changing depth selection rejects obsolete queued work and ignores late requests',async()=>{
 const queue=new SnowRenderQueue(async(data,{signal})=>{
  if(!data.selection)await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))
  return new Uint8ClampedArray([data.selection])
 })
 const obsolete=queue.request(request()).catch(e=>e);await tick()
 assert.equal((await queue.request(request(4,1)))[0],1);assert.equal((await obsolete).name,'AbortError')
 await assert.rejects(()=>queue.request(request()),{name:'AbortError'})
})
test('large tile aggregation yields to inspection messages before finishing',async()=>{
 const c=emptyChunk(0,0);c.known.fill(255)
 let finished=false,calls=0
 const store={async getChunk(){return c},value(){
  if(calls++<512){const stop=performance.now()+.04;while(performance.now()<stop){}}
  return 100
 }}
 const inspection=new Promise(resolve=>setTimeout(()=>resolve(!finished),0))
 const render=renderSnowTile(store,request()).then(p=>{finished=true;return p})
 assert.equal(await inspection,true);assert.equal((await render)[3],255)
})
test('preempting a large aggregation stops it at its next cooperative yield',async()=>{
 const c=emptyChunk(0,0);c.known.fill(255);const controller=new AbortController()
 const store={async getChunk(){return c},value(){const stop=performance.now()+.04;while(performance.now()<stop){}return 100}}
 setTimeout(()=>controller.abort(),0)
 await assert.rejects(()=>renderSnowTile(store,request(),{signal:controller.signal}),{name:'AbortError'})
})
test('bounded summaries retain quality when cached and invalidate on a cell write',()=>{
 const c=emptyChunk(0,0,{firstEndYear:2024,years:1})
 setChunkCell(c,0,{data:new Uint8Array(8),known:new Uint8Array([0])})
 const first=chunkRecord(c,0);assert.equal(first.days,null);assert.equal(chunkValue(c,0,'length'),null);assert.deepEqual(chunkRecord(c,0),first)
 setChunkCell(c,0,{data:new Uint8Array(8),known:new Uint8Array([5])})
 assert.equal(chunkValue(c,0,'length'),0);assert.equal(chunkRecord(c,0).unknownYears,0)
})
