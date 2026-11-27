import test from 'node:test'
import assert from 'node:assert/strict'
import {fourMonthWindows,archiveUrl,parseArchiveArray,PackedSnowHistory,SnowArchiveSource,SnowArchiveRequestPool} from '../src/map/snow-season/archive-source.js'
import {snowFetchBlock,FETCH_BLOCK_SIZE} from '../src/map/snow-season/area-grid.js'
import {SnowSeasonEstimator} from '../src/map/snow-season/season-estimator.js'
import {SnowCollectionQueue} from '../src/map/snow-season/collection-queue.js'
import {emptyChunk,CHUNK_SIZE,hasCell} from '../src/map/snow-season/chunk-codec.js'
import {archiveQuery,archiveFixture} from './helpers/snow-archive-fixture.mjs'
const DAY=86400000,day=iso=>Date.parse(iso+'T00:00:00Z')/DAY,cohort={startDate:'2023-09-01',endDate:'2024-08-31'},block=snowFetchBlock(0,0),last=block.cells-1
const tick=()=>new Promise(r=>setTimeout(r,0))
function fixtureSource(options={}){const calls=[];let active=0,maximum=0
 const source=new SnowArchiveSource({fetchImpl:async(url,{signal})=>{calls.push(archiveQuery(url));active++;maximum=Math.max(maximum,active);await tick();if(signal.aborted){active--;throw signal.reason}const body=archiveFixture(url,options);active--;return {ok:true,arrayBuffer:async()=>body.buffer}}})
 return {source,calls,get maximum(){return maximum}}
}
test('four-month requests cover exactly 20 complete snow years, including leap days',()=>{
 const windows=fourMonthWindows('2005-09-01','2025-08-31');assert.equal(windows.length,60);assert.equal(windows.reduce((n,w)=>n+w.days,0),7305);assert.equal(windows[0].first,day('2005-09-01'));assert.equal(windows.at(-1).last,day('2025-08-31'))
 for(let i=0;i<windows.length;i++){assert.ok(windows[i].days<=123);if(i)assert.equal(windows[i-1].last+1,windows[i].first)}
 assert.deepEqual(fourMonthWindows(cohort.startDate,cohort.endDate).map(w=>w.days),[122,121,123]);assert.throws(()=>fourMonthWindows('2025-09-31','2025-10-01'))
})
test('37-cell blocks align as thirds of 111-cell chunks and clip native model edges',()=>{
 assert.equal(CHUNK_SIZE,FETCH_BLOCK_SIZE*3);assert.equal(block.width,37);assert.equal(block.yLast,1549);assert.equal(block.yFirst,1513)
 const edge=snowFetchBlock(32,41);assert.equal(edge.width,11);assert.equal(edge.height,33);assert.deepEqual(edge.extent,[1109000,6450000,1120000,6483000]);assert.throws(()=>snowFetchBlock(33,0))
})
test('binary parser checks dimensions, duplicated lengths and payload completeness',()=>{
 const w=fourMonthWindows(cohort.startDate,cohort.endDate)[0],url=archiveUrl('sd',w,block),b=archiveFixture(url),a=parseArchiveArray(b.buffer,{days:w.days,width:37,height:37});assert.equal(a.values,122*37*37);assert.equal(a.view.getFloat32(a.offset),1)
 assert.throws(()=>parseArchiveArray(b.slice(0,-1).buffer,{days:w.days,width:37,height:37}));assert.throws(()=>parseArchiveArray(b.buffer,{days:w.days,width:36,height:37}))
})
test('packed history retains three states and repeated writes do not inflate unknown counts',()=>{
 const h=new PackedSnowHistory({cells:9,days:5,indices:[8,0]});assert.equal(h.data.byteLength,3);h.set(0,0,1);h.set(0,0,1);h.set(0,1,0);assert.equal(h.unknown[0],3);assert.deepEqual([...h.cover(8)],[1,0,255,255,255]);assert.deepEqual([...h.cover(0)],[255,255,255,255,255]);assert.throws(()=>h.cover(1))
})
test('spatial loading flips south-to-north rows and preserves estimator behaviour',async()=>{
 const fixture=fixtureSource({overrides:[{theme:'sd',x:block.xFirst,y:block.yLast,value:d=>d>=day('2023-10-01')&&d<=day('2024-05-31')?2:0},{theme:'sd',x:block.xLast,y:block.yFirst,value:0}]})
 const loaded=await fixture.source.load({bx:0,by:0,cells:[{localIndex:0},{localIndex:last}]},cohort)
 assert.equal(fixture.calls.length,3);assert.ok(fixture.maximum<=8);assert.equal(loaded.history.lookup[1],-1);assert.equal(loaded.history.data.byteLength,Math.ceil(366*2/4))
 const a=new SnowSeasonEstimator({referenceYear:2025,years:1}).estimate(loaded.inputForCell(0));assert.equal(a.period.start,'10-01');assert.equal(a.period.end,'05-31');assert.equal(a.period.averageDays,244)
 const b=new SnowSeasonEstimator({referenceYear:2025,years:1}).estimate(loaded.inputForCell(last));assert.equal(b.lengthDays.maximum,0)
})
test('SWE repairs positive evidence only, while zero SWE remains unknown',async()=>{
 const missing=day('2024-01-18'),fixture=fixtureSource({overrides:[{theme:'sd',x:block.xFirst,y:block.yLast,value:d=>d===missing?NaN:1},{theme:'sd',x:block.xLast,y:block.yFirst,value:d=>d===missing?NaN:0},{theme:'swe',x:block.xLast,y:block.yFirst,value:0}]})
 const loaded=await fixture.source.load({bx:0,by:0,cells:[{localIndex:0},{localIndex:last}]},cohort),a=loaded.inputForCell(0),b=loaded.inputForCell(last)
 assert.deepEqual(a.quality.sweRecoveredDates,['2024-01-18']);assert.equal(a.cover[missing-day(cohort.startDate)],1);assert.equal(b.cover[missing-day(cohort.startDate)],255);assert.equal(b.cover[0],0);assert.equal(fixture.calls.filter(c=>c.theme==='swe').length,1);assert.equal(fixture.calls.at(-1).days,1)
})
test('failed supplementary requests resume without downloading completed depth windows again',async()=>{
 const missing=day('2024-01-18');let fail=true;const calls=[]
 const source=new SnowArchiveSource({maximumAttempts:1,fetchImpl:async url=>{const q=archiveQuery(url);calls.push(q);if(q.theme==='swe'&&fail)return {ok:false,status:503};return {ok:true,arrayBuffer:async()=>archiveFixture(url,{overrides:[{theme:'sd',x:block.xFirst,y:block.yLast,value:d=>d===missing?NaN:1}]}).buffer}}})
 const task={bx:0,by:0,cells:[{localIndex:0}]};await assert.rejects(()=>source.load(task,cohort),/503/);fail=false;const loaded=await source.load(task,cohort);assert.equal(calls.filter(c=>c.theme==='sd').length,3);assert.equal(calls.filter(c=>c.theme==='swe').length,2);assert.equal(loaded.inputForCell(0).cover[missing-day(cohort.startDate)],1)
})
test('request pool reprioritizes queued work, pauses, and enforces a shared limit',async()=>{
 const pool=new SnowArchiveRequestPool({concurrency:1}),order=[];let release;const first=pool.run(()=>new Promise(resolve=>{release=()=>{order.push('first');resolve()}}));await tick();const old=pool.run(()=>order.push('background'),{priority:()=>1}),current=pool.run(()=>order.push('visible'),{priority:()=>0});pool.paused=true;release();await first;await tick();assert.deepEqual(order,['first']);pool.paused=false;pool.pump();await Promise.all([old,current]);assert.deepEqual(order,['first','visible','background']);assert.throws(()=>new SnowArchiveRequestPool({concurrency:0}))
})
test('block reservations exclude cached cells and retries restore only unfinished cells',()=>{
 const c=emptyChunk(0,0);c.known[0]|=1;const q=new SnowCollectionQueue({random:()=>0});q.addChunk(c);const area=q.takeBlock();assert.equal(area.bx,0);assert.equal(area.by,0);assert.equal(area.cells.length,37*37-1);assert.ok(area.cells.every(cell=>cell.localIndex!==0));assert.equal(new Set(area.cells.map(c=>c.localIndex)).size,area.cells.length)
 const one=area.cells[0];q.complete(one);q.retryBlock(area);assert.equal(q.completed,2);assert.equal(q.reserved.size,0);assert.ok(hasCell(c,0))
})
test('an entirely missing history stays unknown and does not trigger SWE downloads',async()=>{
 const fixture=fixtureSource({value:NaN}),loaded=await fixture.source.load({bx:0,by:0,cells:[{localIndex:0}]},cohort);assert.equal(fixture.calls.length,3);const result=new SnowSeasonEstimator({referenceYear:2025,years:1}).estimate(loaded.inputForCell(0));assert.equal(result.status,'insufficient-data');assert.equal(result.unknownDays,366);assert.equal(result.period,null)
})
test('full 20-year transport uses 60 windows and allocates histories only for uncached cells',async()=>{
 const fixture=fixtureSource(),full={startDate:'2005-09-01',endDate:'2025-08-31'},loaded=await fixture.source.load({bx:0,by:0,cells:[{localIndex:0}]},full);assert.equal(fixture.calls.length,60);assert.ok(fixture.calls.every(c=>c.days<=123));assert.equal(loaded.history.data.byteLength,Math.ceil(7305/4));assert.equal(loaded.inputForCell(0).cover.length,7305);assert.equal(new SnowSeasonEstimator({referenceYear:2026}).estimate(loaded.inputForCell(0)).period.averageDays,365.25);fixture.source.release(loaded.key);assert.equal(fixture.source.partial.size,0)
})
