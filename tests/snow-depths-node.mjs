import test from 'node:test'
import assert from 'node:assert/strict'
import {snowDepthBand} from '../src/map/snow-season/depths.js'
import {PackedSnowDepthHistory,SnowArchiveSource} from '../src/map/snow-season/archive-source.js'
import {yearCodec,seasonDays,seasonStart,estimateAnnualSeasons,summarizeAnnualSeasons} from '../src/map/snow-season/annual-seasons.js'
import {emptyChunk,setChunkCell,chunkRecord,chunkValue,encodeChunk,decodeChunk,compressChunk,decompressChunk,CHUNK_CELLS,annualCell} from '../src/map/snow-season/annual-chunk-codec.js'
import {SnowSeasonEstimator} from '../src/map/snow-season/season-estimator.js'
import {renderSnowTile} from '../src/map/snow-season/tile-renderer.js'
import {archiveQuery,archiveFixture} from './helpers/snow-archive-fixture.mjs'
const DAY=86400000,cohort={firstEndYear:2024,years:1},input=band=>({startDate:'2023-09-01',bands:new Uint8Array(366).fill(band)})
function pattern(cohort){
 const a=seasonStart(cohort.firstEndYear),end=seasonStart(cohort.firstEndYear+cohort.years),bands=new Uint8Array((end-a)/DAY)
 for(let y=0;y<cohort.years;y++){
  const year=cohort.firstEndYear+y,offset=(seasonStart(year)-a)/DAY
  for(let day=0;day<seasonDays(year);day++){
   const md=new Date(seasonStart(year)+day*DAY).toISOString().slice(5,10)
   bands[offset+day]=md>='10-01'||md<='06-30'?1:0
   if(md>='11-01'||md<='05-31')bands[offset+day]=2
   if(md>='12-01'||md<='04-30')bands[offset+day]=3
   if(md>='01-01'&&md<='03-31')bands[offset+day]=4
   if(md>='02-01'&&md<='02-29')bands[offset+day]=5
  }
 }
 return {startDate:new Date(a).toISOString().slice(0,10),bands}
}
test('depth bands include exact minima and retain unknown depth separately from presence',()=>{
 assert.deepEqual([0,.1,4.99,5,9.99,10,15,20,300,NaN,-1,65535].map(snowDepthBand),[0,1,1,2,2,3,4,5,5,7,7,7])
 const h=new PackedSnowDepthHistory({cells:2,days:8,indices:[1]})
 for(let i=0;i<8;i++)h.set(0,i,i)
 assert.equal(h.data.byteLength,4);assert.deepEqual([...h.bands(1)],[0,1,2,3,4,5,6,7])
 assert.deepEqual([...h.cover(1)],[0,1,1,1,1,1,1,255]);assert.deepEqual([...h.cover(1,20)],[0,0,0,0,0,1,255,255]);assert.equal(h.unknown[0],1)
})
test('five half-open nested intervals occupy exactly eight bytes including leap days and empty suffixes',()=>{
 const choose=(N,n)=>{let c=1n;for(let i=1;i<=n;i++)c=c*BigInt(N-n+i)/BigInt(i);return c}
 let seed=987654321
 for(const year of [2024,2025]){
  const codec=yearCodec(year),days=seasonDays(year),N=days+10
  const C=choose(N,10),Q=1n<<50n,tail=choose(days+codec.tail,codec.tail)
  assert.equal(codec.bitLength,64);assert(C*Q<(1n<<64n)*(Q-4n*(BigInt(N*N)+tail+5n)))
  for(let t=0;t<2000;t++){
   const xs=Array.from({length:10},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%(days+1)}).sort((a,b)=>a-b)
   const pairs=Array.from({length:5},(_,i)=>[xs[i],xs[9-i]])
   if(t<6)for(let i=t;i<5;i++)pairs[i]=[pairs[Math.max(0,t-1)][0],pairs[Math.max(0,t-1)][0]]
   const bytes=codec.encode(pairs);assert.equal(bytes.length,8);assert.deepEqual(codec.decode(bytes),pairs)
  }
 }
})
test('annual data derive all five independent 95% endpoints and exact leap-year means',()=>{
 const estimator=new SnowSeasonEstimator({referenceYear:2026}),c=estimator.cohort,source=pattern(c),annual=estimateAnnualSeasons(source,c)
 assert.equal(annual.data.length,20*8);assert.ok(annual.known.every(v=>v===5))
 for(const [level,depth] of [0,5,10,15,20].entries()){
  const expected=estimator.estimate({startDate:source.startDate,cover:source.bands.map(v=>Number(v>level))}),got=summarizeAnnualSeasons(annual,c,depth)
  assert.equal(got.start,expected.period.start);assert.equal(got.end,expected.period.end);assert.equal(got.days,expected.period.averageDays)
 }
 assert.equal(summarizeAnnualSeasons(annual,c,15).days,90.25)
 // Fixed month/day periods retain the existing conservative Feb 29 policy.
 assert.equal(summarizeAnnualSeasons(annual,c,20).days,28)
})
test('higher thresholds stay inside the main season; empty and tied runs remain deterministic',()=>{
 const source=input(0);source.bands.fill(1,30,150);source.bands.fill(5,200,250)
 const annual=estimateAnnualSeasons(source,cohort),pairs=yearCodec(2024).decode(annual.data)
 assert.deepEqual(pairs[0],[30,150]);assert.ok(pairs.slice(1).every(p=>p[0]===p[1]));assert.equal(summarizeAnnualSeasons(annual,cohort,20).days,0)
 source.bands.fill(0);source.bands.fill(5,30,50);source.bands.fill(5,90,110)
 assert.deepEqual(yearCodec(2024).decode(estimateAnnualSeasons(source,cohort).data),Array.from({length:5},()=>[30,50]))
})
test('unknown evidence does not invent depth; unknown days outside the winning season do not discard it',()=>{
 const source=input(5);source.bands[150]=6
 const annual=estimateAnnualSeasons(source,cohort)
 assert.equal(annual.known[0],1);assert.equal(summarizeAnnualSeasons(annual,cohort,0).days,366);assert.equal(summarizeAnnualSeasons(annual,cohort,5).days,null)
 source.bands.fill(0);source.bands.fill(5,100,250);source.bands[10]=7
 const stable=estimateAnnualSeasons(source,cohort);assert.equal(stable.known[0],5);assert.equal(summarizeAnnualSeasons(stable,cohort,20).days,150)
 source.bands.fill(7);assert.equal(estimateAnnualSeasons(source,cohort).known[0],0)
 source.bands.fill(0);assert.equal(summarizeAnnualSeasons(estimateAnnualSeasons(source,cohort),cohort,0).days,0)
})
test('annual chunks preserve quality, pending cells, eight-byte words and depth-specific summaries',async()=>{
 const c=emptyChunk(1,2,{firstEndYear:2024,years:1}),annual=estimateAnnualSeasons(pattern(cohort),cohort)
 setChunkCell(c,0,annual);setChunkCell(c,CHUNK_CELLS-1,{data:new Uint8Array(8),known:new Uint8Array([0])})
 for(const restored of [decodeChunk(encodeChunk(c)),await decompressChunk(await compressChunk(c))]){
  assert.deepEqual(annualCell(restored,0),annual);assert.equal(chunkRecord(restored,1),null);assert.equal(chunkRecord(restored,CHUNK_CELLS-1).days,null)
  const first=chunkRecord(restored,0,0);assert.deepEqual(chunkRecord(restored,0,0),first)
  assert.equal(chunkRecord(restored,0,20).days,28);assert.notEqual(chunkRecord(restored,0,20).days,first.days)
 }
 const bytes=encodeChunk(c);assert.equal(bytes.length,32+CHUNK_CELLS*8+Math.ceil(CHUNK_CELLS*3/8)+Math.ceil(CHUNK_CELLS/8));assert.throws(()=>decodeChunk(bytes.subarray(1)))
 const bad=bytes.slice();bad[32+c.data.length]=7;assert.throws(()=>decodeChunk(bad))
})
test('selected depth changes rendered pixels from cached annual data',async()=>{
 const c=emptyChunk(0,0,{firstEndYear:2024,years:1});setChunkCell(c,0,estimateAnnualSeasons(pattern(cohort),cohort))
 const store={value:chunkValue,async getChunk(cx,cy){return cx===0&&cy===0?c:emptyChunk(cx,cy,{firstEndYear:2024,years:1})}}
 const low=await renderSnowTile(store,{z:4,x:0,y:0,metric:'length',minimumDepth:0}),high=await renderSnowTile(store,{z:4,x:0,y:0,metric:'length',minimumDepth:20})
 assert.equal(low[3],255);assert.equal(high[3],255);assert.notDeepEqual(low.slice(0,3),high.slice(0,3))
 await assert.rejects(()=>renderSnowTile(store,{z:4,x:0,y:0,metric:'length',minimumDepth:7}))
})
test('one archive download retains every depth band; SWE establishes only positive presence',async()=>{
 const calls=[],missing=Date.UTC(2024,0,18)/DAY
 const source=new SnowArchiveSource({depthBands:true,fetchImpl:async url=>{calls.push(archiveQuery(url));return {ok:true,arrayBuffer:async()=>archiveFixture(url,{overrides:[{theme:'sd',x:0,y:1549,value:d=>d===missing?NaN:20}]}).buffer}}})
 const loaded=await source.load({bx:0,by:0,cells:[{localIndex:0}]},{startDate:'2023-09-01',endDate:'2024-08-31'}),value=loaded.inputForCell(0)
 assert.equal(calls.filter(v=>v.theme==='sd').length,3);assert.equal(calls.filter(v=>v.theme==='swe').length,1)
 assert.equal(value.bands[0],5);assert.equal(value.bands[missing-Date.UTC(2023,8,1)/DAY],6);assert.equal(loaded.history.data.byteLength,183)
})
