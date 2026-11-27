import test from 'node:test'
import assert from 'node:assert/strict'
import {SnowArchiveSource,SnowArchiveRequestPool,SnowArchiveInterruptedError,fourMonthWindows} from '../src/map/snow-season/archive-source.js'
import {snowFetchBlock} from '../src/map/snow-season/area-grid.js'
import {SnowTabRecovery} from '../src/map/snow-season/tab-recovery.js'
import {archiveQuery,archiveFixture} from './helpers/snow-archive-fixture.mjs'
const tick=(ms=0)=>new Promise(r=>setTimeout(r,ms)),cohort={startDate:'2023-09-01',endDate:'2024-08-31'},area={bx:0,by:0,cells:[{localIndex:0}]}
test('a transient Safari Load failed retries only that window',async()=>{
 const calls=[];let failed=false
 const source=new SnowArchiveSource({retryMs:()=>0,fetchImpl:async url=>{calls.push(archiveQuery(url));if(!failed){failed=true;throw new TypeError('Load failed')}return {ok:true,arrayBuffer:async()=>archiveFixture(url).buffer}}})
 const loaded=await source.load(area,cohort)
 assert.equal(calls.length,4);assert.ok(loaded.inputForCell(0).cover.every(v=>v===1));assert.equal(source.connections.size,0)
})
test('retries are bounded and permanent HTTP errors are not retried',async()=>{
 const window=fourMonthWindows(cohort.startDate,cohort.endDate)[0],block=snowFetchBlock(0,0)
 for(const [status,expected] of [[503,3],[429,3],[404,1]]){
  let calls=0;const source=new SnowArchiveSource({retryMs:()=>0,fetchImpl:async()=>{calls++;return {ok:false,status}}})
  await assert.rejects(()=>source.array('sd',window,block,new AbortController().signal));assert.equal(calls,expected)
 }
})
test('resume interrupts stalled requests, retains completed windows, and leaves recent work alone',async()=>{
 const calls=[];let stalled=true,secondStarted
 const second=new Promise(r=>{secondStarted=r}),source=new SnowArchiveSource({pool:new SnowArchiveRequestPool({concurrency:1}),fetchImpl:async(url,{signal})=>{
  const q=archiveQuery(url);calls.push(q)
  if(stalled&&q.year===2024&&q.first===0){secondStarted();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))}
  return {ok:true,arrayBuffer:async()=>archiveFixture(url).buffer}
 }})
 const interrupted=source.load(area,cohort).catch(e=>e);await second
 assert.equal(source.interruptStalled(),0);assert.equal(source.interruptStalled({now:Date.now()+16000}),1)
 assert.ok(await interrupted instanceof SnowArchiveInterruptedError)
 stalled=false;const loaded=await source.load(area,cohort)
 assert.equal(calls.filter(q=>q.year===2023).length,1);assert.equal(calls.length,4);assert.ok(loaded.inputForCell(0).cover.every(v=>v===1))
})
test('an interrupted retry sleep stops immediately instead of running another attempt',async()=>{
 let failed
 const reached=new Promise(r=>{failed=r}),controller=new AbortController(),source=new SnowArchiveSource({retryMs:()=>60000,fetchImpl:async()=>{failed();throw new TypeError('Load failed')}})
 const request=source.array('sd',fourMonthWindows(cohort.startDate,cohort.endDate)[0],snowFetchBlock(0,0),controller.signal).catch(e=>e)
 await reached;await tick();controller.abort(new SnowArchiveInterruptedError())
 assert.ok(await request instanceof SnowArchiveInterruptedError)
})
function lifecycle(options={}){
 const windowTarget=new EventTarget(),documentTarget=new EventTarget();documentTarget.visibilityState='visible'
 const recovery=new SnowTabRecovery({windowTarget,documentTarget,timeoutMs:20,debounceMs:0,...options})
 return {recovery,windowTarget,documentTarget}
}
test('pageshow and visibility events coalesce; online forces network recovery',async()=>{
 const calls=[],l=lifecycle({resume:async force=>calls.push(force),restart:()=>assert.fail('Healthy worker restarted')})
 try{
  l.windowTarget.dispatchEvent(new Event('pageshow'));l.documentTarget.dispatchEvent(new Event('visibilitychange'));await tick(10)
  assert.deepEqual(calls,[false]);l.windowTarget.dispatchEvent(new Event('online'));await tick(10);assert.deepEqual(calls,[false,true])
 }finally{l.recovery.dispose()}
})
test('a silent discarded worker is replaced once after its liveness deadline',async()=>{
 let restarts=0;const l=lifecycle({resume:(force,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})),restart:()=>restarts++})
 try{l.recovery.request();await tick(40);assert.equal(restarts,1);assert.equal(l.recovery.probe,null)}finally{l.recovery.dispose()}
})
test('backgrounding cancels only the liveness probe, then starts a fresh foreground check',async()=>{
 let resumes=0,restarts=0,flushes=0
 const l=lifecycle({resume:(force,{signal})=>{resumes++;return resumes===1?new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})):Promise.resolve()},restart:()=>restarts++,flush:()=>flushes++})
 try{
  l.recovery.request();await tick(5);l.documentTarget.visibilityState='hidden';l.documentTarget.dispatchEvent(new Event('visibilitychange'));l.windowTarget.dispatchEvent(new Event('pagehide'))
  await tick(35);assert.equal(restarts,0);assert.equal(flushes,1)
  l.documentTarget.visibilityState='visible';l.documentTarget.dispatchEvent(new Event('visibilitychange'));await tick(10);assert.equal(resumes,2);assert.equal(restarts,0)
 }finally{l.recovery.dispose()}
})
