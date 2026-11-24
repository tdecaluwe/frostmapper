import assert from 'node:assert/strict'
import test from 'node:test'
import {SnowSeasonEstimator} from '../src/map/snow-season/season-estimator.js'
import {snowPresence,NveSnowDepthSource} from '../src/map/snow-season/nve-source.js'
const DAY=86400000,estimator=()=>new SnowSeasonEstimator({referenceYear:2026})
const day=s=>Date.parse(s+'T00:00:00Z')/DAY
function fixture(runs=()=>['10-01','05-31']){
 const e=estimator(),{startDate,endDate}=e.cohort,first=day(startDate),cover=new Uint8Array(day(endDate)-first+1)
 for(let year=2006;year<=2025;year++){
  const period=runs(year);if(!period)continue
  for(const [start,end] of typeof period[0]==='string'?[period]:period){
   const a=day(`${Number(start.slice(0,2))>=9?year-1:year}-${start}`),b=day(`${Number(end.slice(0,2))>=9?year-1:year}-${end}`)
   cover.fill(1,a-first,b-first+1)
  }
 }
 return {startDate,cover,set(date,value){cover[day(date)-first]=value}}
}
test('20 complete seasons exclude the current ending year',()=>{
 assert.deepEqual(estimator().cohort,{firstEndYear:2006,lastEndYear:2025,startDate:'2005-09-01',endDate:'2025-08-31',years:20})
})
test('independent 19/20 endpoints can have only 18/20 whole-period coverage',()=>{
 const a=fixture(y=>[y===2006?'12-01':y===2007?'11-01':'10-01',y===2008?'03-01':y===2009?'04-01':'05-31'])
 const r=estimator().estimate(a)
 assert.equal(r.period.start,'11-01');assert.equal(r.period.end,'04-01');assert.equal(r.period.nominalDays,152);assert.equal(r.period.averageDays,152.25)
 assert.deepEqual(r.wholePeriodYears,{minimum:18,maximum:18});assert.equal(r.requiredYears,19)
})
test('midwinter snow-free days split seasons instead of joining first and last snow',()=>{
 const a=fixture();a.set('2006-01-01',0);a.set('2007-01-01',0)
 assert.equal(estimator().estimate(a).period.start,'01-02')
})
test('ties between annual snow runs select the earlier one',()=>{
 const r=estimator().estimate(fixture(()=>[['10-01','10-10'],['12-01','12-10']]))
 assert.equal(r.period.start,'10-01');assert.equal(r.period.end,'10-10');assert.equal(r.period.nominalDays,10)
})
test('snow-free years stay in the denominator',()=>{
 assert.equal(estimator().estimate(fixture(y=>y===2006?null:['10-01','05-31'])).wholePeriodYears.minimum,19)
 const r=estimator().estimate(fixture(y=>y<=2007?null:['10-01','05-31']))
 assert.equal(r.period,null);assert.equal(r.lengthDays.maximum,0)
})
test('perennial snow includes leap days in average duration',()=>{
 const r=estimator().estimate(fixture(()=>['09-01','08-31']))
 assert.equal(r.period.nominalDays,365);assert.equal(r.period.averageDays,365.25)
})
test('a missing leap day is not dropped from continuity checks',()=>{
 const a=fixture();a.set('2008-02-29',0);a.set('2012-02-29',0)
 const r=estimator().estimate(a);assert.equal(r.period.end,'02-28')
})
test('unknown dates produce bounds, not fabricated snow-free days',()=>{
 const a=fixture(y=>[y===2006?'12-01':y===2007?'11-01':'10-01',y===2008?'03-01':y===2009?'04-01':'05-31']);a.set('2010-01-15',255)
 const r=estimator().estimate(a)
 assert.equal(r.status,'bounded');assert.equal(r.scenarios,2);assert.deepEqual(r.onset,{earliest:'11-01',latest:'12-01'});assert.equal(r.period,null)
})
test('unresolved dates can leave the period invariant but its historical coverage uncertain',()=>{
 const a=fixture();a.set('2024-01-18',255);const r=estimator().estimate(a)
 assert.equal(r.period.start,'10-01');assert.deepEqual(r.wholePeriodYears,{minimum:19,maximum:20})
})
test('out-of-domain or insufficient history is missing data, not a zero season',()=>{
 assert.equal(estimator().estimate({startDate:'2005-09-01',cover:[]}).status,'insufficient-data')
 assert.throws(()=>estimator().estimate({startDate:'2005-09-31',cover:[]}),/Invalid calendar date/)
})
function response(theme,data,start='01.01.2024 06:00:00',end='05.01.2024 06:00:00'){
 return {Theme:theme,X:100,Y:200,TimeResolution:1440,Unit:'mm',NoDataValue:65535,StartDate:start,EndDate:end,Data:data}
}
test('raw millimetres and positive SWE evidence; zero or missing SWE does not imply bare ground',()=>{
 const depth=response('sd',[1,0,65535,null,-1]),swe=response('swe',[100,100,2,0,65535])
 const r=snowPresence(depth,{swe});assert.deepEqual([...r.cover],[1,0,1,255,255]);assert.deepEqual(r.quality.sweRecoveredDates,['2024-01-03'])
 const higher=snowPresence(depth,{swe,minimumDepthMm:10});assert.deepEqual([...higher.cover],[0,0,255,255,255])
 assert.throws(()=>snowPresence({...depth,Unit:'cm'}),/raw snow depth/)
 assert.throws(()=>snowPresence(depth,{swe:{...swe,X:101}}),/same daily grid/)
})
test('source fetches only the missing interval for supplementary SWE',async()=>{
 const urls=[],depth=response('sd',[0,65535,65535,1,2]),swe=response('swe',[1,0],'02.01.2024 06:00:00','03.01.2024 06:00:00')
 const source=new NveSnowDepthSource({fetchImpl:async url=>{urls.push(url);return {ok:true,json:async()=>url.endsWith('/sd.json')?depth:swe}}})
 const r=await source.load({x:100,y:200,startDate:'2024-01-01',endDate:'2024-01-05'})
 assert.deepEqual([...r.cover],[0,1,255,1,1]);assert.equal(urls.length,2);assert.ok(urls[1].includes('/2024-01-02/2024-01-03/swe.json'))
})
test('failure of supplementary SWE retains the unresolved history',async()=>{
 const depth=response('sd',[0,65535,0,1,2]);let calls=0
 const source=new NveSnowDepthSource({fetchImpl:async()=>{calls++;if(calls>1)return {ok:false,status:503};return {ok:true,json:async()=>depth}}})
 const r=await source.load({x:100,y:200,startDate:'2024-01-01',endDate:'2024-01-05'})
 assert.equal(r.cover[1],255);assert.match(r.source.supplementError,/503/)
})
import {browserSeries,NveBrowserSnowDepthSource} from '../src/map/snow-season/nve-source.js'
import {visibleSnowCells,cellKey,snowColor} from '../src/map/snow-season/grid.js'
test('browser endpoint normalizes cm before applying thresholds without scaling nodata',()=>{
 const r=browserSeries({Theme:'sd',TimeResolution:1440,Unit:'cm',NoDataValue:65535,MASL:1200,MapGridValue:[.1,0,65535]}, {x:100,y:200,startDate:'2025-01-01',endDate:'2025-01-03',theme:'sd'})
 assert.deepEqual(r.Data,[1,0,null]);assert.equal(r.Unit,'mm');assert.equal(r.Altitude,1200)
 assert.deepEqual([...snowPresence(r).cover],[1,0,255])
 assert.throws(()=>browserSeries({Theme:'sd',TimeResolution:1440,Unit:'cm',MapGridValue:[1]}, {x:100,y:200,startDate:'2025-01-01',endDate:'2025-01-03',theme:'sd'}),/Incomplete/)
})
test('CORS-compatible source requests native coordinates and original calendar dates',async()=>{
 let requested
 const source=new NveBrowserSnowDepthSource({fetchImpl:async url=>{requested=new URL(url);return {ok:true,json:async()=>({Theme:'sd',TimeResolution:1440,Unit:'cm',NoDataValue:65535,MapGridValue:[1,2]})}}})
 const r=await source.load({x:120500,y:6908500,startDate:'2025-01-01',endDate:'2025-01-02'})
 assert.equal(requested.hostname,'services.xgeo.no');assert.deepEqual(JSON.parse(requested.searchParams.get('request')),{x:120500,y:6908500,id:'sd',startDateTime:'2025-01-01',endDateTime:'2025-01-02'});assert.deepEqual([...r.cover],[1,1])
})
test('native grid covers arbitrary model cells, deduplicates coordinates and bounds allocations',()=>{
 const r=visibleSnowCells([120100,6908100,121900,6910900]);assert.equal(r.count,6);assert.equal(r.cells.length,6)
 assert.equal(cellKey(120001,6908001),cellKey(120999,6908999))
 assert.ok(visibleSnowCells([-75000,6450000,1120000,8000000]).tooWide)
 assert.equal(visibleSnowCells([0,0,1000,1000]).cells.length,0)
 assert.equal(visibleSnowCells([NaN,0,1,1]).cells.length,0)
})
test('empty and uncertain seasons are distinct in the raster',()=>{
 assert.equal(snowColor({days:null}),null);assert.equal(snowColor({start:null},'start'),null)
 assert.ok(snowColor({days:0}));assert.ok(snowColor({days:365}));assert.notDeepEqual(snowColor({start:'10-01'},'start'),snowColor({start:'01-01'},'start'))
})
test('out-of-model histories are no-data, not bare ground or a fatal viewport error',()=>{
 let error
 try{browserSeries({ErrorMessage:'The remote server returned an error: (400) Bad Request.'},{x:0,y:0,startDate:'2025-01-01',endDate:'2025-01-03',theme:'sd'})}catch(e){error=e}
 assert.equal(error.noCell,true)
})
import {cachedSnowExtent} from '../src/map/snow-season/grid.js'
test('overview bounds preserve cached cells across regions without a new archive download',()=>{
 assert.equal(cachedSnowExtent(new Map()),null)
 assert.deepEqual(cachedSnowExtent(new Map([['120/6908',{}],['-33/6734',{}]])),[-33000,6734000,121000,6909000])
})
