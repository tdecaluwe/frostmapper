// Optional integration check. Uses existing Playwright/OL installations; no deployed dependencies.
const {chromium,devices}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),NODE=process.env.OL_NODE_MODULES||path.dirname(path.dirname(require.resolve('ol/package.json'))),ARTIFACTS=process.env.SNOW_TEST_ARTIFACTS;
const server=http.createServer((req,res)=>{const rel=new URL(req.url,'http://localhost').pathname;
 if(rel==='/proj4-esm.js'){res.setHeader('Content-Type','application/javascript');return res.end("import '/modules/proj4/dist/proj4.js';export default globalThis.proj4;")}
 const file=rel.startsWith('/modules/')?path.join(NODE,rel.slice(9)):path.join(ROOT,rel);
 try{let body=fs.readFileSync(file);if(file.endsWith('snow-chunks.html'))body=Buffer.from(body.toString().replace('https://esm.sh/ol@10.6.1/','/modules/ol/').replace('https://esm.sh/proj4@2.19.10','/proj4-esm.js').replace('"proj4":"/proj4-esm.js"','"proj4":"/proj4-esm.js","rbush":"/modules/rbush/index.js","quickselect":"/modules/quickselect/index.js"'));
 res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/json');res.end(body)}catch{res.statusCode=404;res.end('Not found')}
});
(async()=>{const {archiveQuery,archiveFixture}=await import('./helpers/snow-archive-fixture.mjs');await new Promise(r=>server.listen(8769,'127.0.0.1',r));const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});try{
 const context=await browser.newContext({...devices['iPhone 14'],viewport:{width:390,height:844},deviceScaleFactor:1}),page=await context.newPage(),errors=[],calls=[];let active=0,maxActive=0,pointCalls=0;page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
 await context.route('https://services.xgeo.no/**',route=>{pointCalls++;return route.abort()});
 await context.route('https://thredds.met.no/**',async route=>{const url=route.request().url(),q=archiveQuery(url),bx=q.xFirst/37,by=(1549-q.yLast)/37;calls.push({...q,bx,by});active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,30));try{await route.fulfill({contentType:'application/octet-stream',headers:{'Access-Control-Allow-Origin':'*'},body:Buffer.from(archiveFixture(url))})}catch{}finally{active--}});
 await page.goto('http://127.0.0.1:8769/README.md');
 await page.evaluate(async()=>{
  // An old cache is deliberately ignored. No cache migration is performed.
  const db=await new Promise(resolve=>{const r=indexedDB.open('frostmapper-snow-seasons',2);r.onupgradeneeded=()=>{r.result.createObjectStore('chunks',{keyPath:'id'});r.result.createObjectStore('summaries',{keyPath:'id'})};r.onsuccess=()=>resolve(r.result)});
  const {emptyChunk,setChunkCell,compressChunk}=await import('/src/map/snow-season/annual-chunk-codec.js');
  const {estimateAnnualSeasons}=await import('/src/map/snow-season/annual-seasons.js');
  const {SnowSeasonEstimator}=await import('/src/map/snow-season/season-estimator.js');
  const cohort=new SnowSeasonEstimator().cohort,chunk=emptyChunk(0,0,{firstEndYear:cohort.firstEndYear,years:cohort.years});
  const days=(Date.parse(cohort.endDate)-Date.parse(cohort.startDate))/86400000+1;
  const annual=estimateAnnualSeasons({startDate:cohort.startDate,bands:new Uint8Array(days)},cohort);
  for(let i=0;i<5000;i++)setChunkCell(chunk,i,annual);const payload=await compressChunk(chunk);
  await new Promise(resolve=>{const tx=db.transaction(['chunks','summaries'],'readwrite');tx.objectStore('chunks').put({id:`v3/annual-depths/${cohort.firstEndYear}/${cohort.lastEndYear}/0/0`,used:Date.now(),updated:Date.now(),payload});tx.objectStore('summaries').put({id:'v1/2006/2025/0mm/-25/7949',used:Date.now(),value:{start:'11-01',end:'05-31',days:212.25,marker:'old-cache'}});tx.oncomplete=resolve});db.close();
 });
 await page.goto('http://127.0.0.1:8769/tests/snow-chunks.html');await page.waitForFunction(()=>window.snow?.worker);await page.waitForFunction(()=>document.querySelector('#snow-season-status')?.textContent.includes('cells'));
 assert.equal(await page.locator('#snow-season-toggle').isChecked(),false);assert.equal(await page.locator('#snow-season-status').isVisible(),true);assert.equal(await page.locator('#snow-season-metric').isVisible(),false);
 const tally=await page.locator('#snow-season-status').textContent();assert.ok(Number(tally.match(/Snow data: ([\d,]+)/)[1].replaceAll(',',''))>=5000);assert.ok(calls.length>0);
 const old=await page.evaluate(()=>window.snow.request('inspect',{key:'-25/7949'}));assert.notEqual(old?.marker,'old-cache');
 const beforeMove=calls.length;await page.evaluate(()=>window.map.getView().setCenter([575500,7349500]));await page.waitForTimeout(1000);const afterMove=calls.slice(beforeMove),firstNew=afterMove.findIndex(q=>q.bx>10);assert.ok(firstNew>=0&&firstNew<=8,`new viewport priority ${firstNew}`);assert.ok(afterMove.slice(firstNew,firstNew+8).every(q=>q.bx>10));
 await page.locator('#snow-season-toggle').check();await page.waitForFunction(()=>[...window.snow.source.nativeTiles.values()].some(t=>t.getState()===2&&t.getImage()?.getContext('2d').getImageData(0,0,111,111).data.some((v,i)=>i%4===3&&v)));
 const native=await page.evaluate(()=>({tileSize:window.snow.source.getTileGrid().getTileSize(4),resolutions:window.snow.source.getTileGrid().getResolutions()}));assert.equal(native.tileSize,111);assert.deepEqual(native.resolutions,[16000,8000,4000,2000,1000]);
 await page.locator('#snow-season-toggle').uncheck();const hiddenCalls=calls.length,hiddenStatus=await page.locator('#snow-season-status').textContent();await page.waitForTimeout(600);assert.ok(calls.length>hiddenCalls||await page.locator('#snow-season-status').textContent()!==hiddenStatus);await page.locator('#snow-season-toggle').check();
 await page.waitForFunction(async()=>Boolean((await window.snow.request('inspect',{key:'575/7349'}))?.days));
 const inspected=await page.evaluate(()=>window.snow.request('inspect',{key:'575/7349'}));assert.equal(inspected.days,365.25);assert.equal(inspected.start,'09-01');
 // Inspection bypasses a large pending coarse render and should not flash a
 // loading message for an already-cached cell.
 const responsiveness=await page.evaluate(async()=>{
  let coarseDone=false;const messages=[];const observer=new MutationObserver(()=>messages.push(window.snow.readout.textContent));observer.observe(window.snow.readout,{childList:true,subtree:true});
  const coarse=window.snow.request('render',{z:0,x:0,y:0,metric:'length',minimumDepth:0,selection:window.snow.source.epoch}).then(()=>{coarseDone=true});
  await new Promise(r=>setTimeout(r,0));
  const started=performance.now();await window.snow.inspect([575500,7349500]);
  const result={inspectionMs:performance.now()-started,coarsePending:!coarseDone,text:window.snow.readout.textContent};
  observer.disconnect();result.readingFlashes=messages.some(text=>text.includes('Reading snow-season'));await coarse;return result;
 });
 assert.equal(responsiveness.coarsePending,true);assert.ok(responsiveness.inspectionMs<500,JSON.stringify(responsiveness));assert.ok(!responsiveness.text.includes('Reading snow-season'));
 if(responsiveness.inspectionMs<150)assert.equal(responsiveness.readingFlashes,false);
 const obsoleteReadIgnored=await page.evaluate(async()=>{
  const original=window.snow.request;let finish;
  window.snow.request=function(type,payload){return type==='inspect'?new Promise(r=>{finish=r}):original.call(this,type,payload)};
  try{
   const pending=window.snow.inspect([575500,7349500]);window.snow.updateView();finish({days:12,start:'11-01',end:'11-12'});await pending;
   return window.snow.readout.hidden;
  }finally{window.snow.request=original}
 });assert.equal(obsoleteReadIgnored,true);

 // Changing depth uses the same downloaded histories and yearly cache.
 await page.evaluate(()=>{window.sampleSnowPixel=()=>{const c=document.querySelector('#map canvas');return c?Array.from(c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data):null}});
 await page.waitForFunction(()=>window.sampleSnowPixel()?.[3]>0);
 const beforeDepth=await page.evaluate(()=>window.sampleSnowPixel());
 await page.locator('#snow-season-depth').evaluate(el=>{el.value='20';el.dispatchEvent(new Event('input',{bubbles:true}))});
 assert.equal(await page.locator('.snow-season-depth-label output').textContent(),'≥ 20 cm');
 const high=await page.evaluate(()=>window.snow.request('inspect',{key:'575/7349',minimumDepth:20}));assert.equal(high.days,0);
 await page.waitForFunction(()=>{const p=window.sampleSnowPixel();return p?.[0]>240&&p[1]>240&&p[2]>180&&p[3]>0});
 assert.equal(await page.evaluate(()=>window.snow.source.minimumDepth),20);
 const afterDepth=await page.evaluate(()=>window.sampleSnowPixel());
 assert.notDeepEqual(afterDepth,beforeDepth);

 await page.evaluate(()=>window.snow.request('flush',{}));const persisted=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('frostmapper-snow-seasons');r.onsuccess=()=>resolve(r.result)});return new Promise(resolve=>{const r=db.transaction('chunks').objectStore('chunks').getAll();r.onsuccess=()=>{resolve(r.result.map(v=>({id:v.id,format:v.payload.format,bytes:v.payload.data.byteLength})));db.close()}})});assert.ok(persisted.length>=2);assert.ok(persisted.every(v=>v.format==='deflate'));const testedConcurrency=maxActive;assert.ok(testedConcurrency<=8);
 // The seeded top 37 rows are complete fetch blocks and must be skipped. A
 // partially cached fetch block may be downloaded again to fill its remaining cells.
 assert.ok(calls.filter(q=>q.bx<3&&q.by<3).every(q=>q.by>0));assert.ok(calls.every(q=>q.days<=123&&q.width<=37&&q.height<=37));assert.equal(pointCalls,0);
 await page.reload();await page.waitForFunction(()=>window.snow?.worker);await page.waitForFunction(()=>Number(document.querySelector('#snow-season-status')?.textContent.match(/Snow data: ([\d,]+)/)?.[1]?.replaceAll(',',''))>=5000);
 assert.equal(await page.locator('#snow-season-depth').inputValue(),'20');
 const reused=await page.evaluate(()=>window.snow.request('inspect',{key:'575/7349'}));assert.equal(reused.days,365.25);
 await page.locator('#snow-season-toggle').check();await page.evaluate(()=>window.map.getView().setResolution(2000));await page.waitForFunction(()=>[...window.snow.source.nativeTiles.values()].some(t=>t.tileCoord[0]<4&&t.getState()===2));
 await page.evaluate(async()=>{const [{default:View},{transform}]=await Promise.all([import('/modules/ol/View.js'),import('/modules/ol/proj.js')]);window.map.setView(new View({projection:'EPSG:3857',center:transform([575500,7349500],'EPSG:32633','EPSG:3857'),resolution:50}))});await page.waitForFunction(()=>window.snow.layer.getData([195,422])?.[3]>0,null,{timeout:15000}).catch(async error=>{
  console.log('DISPLAY DEBUG',await page.evaluate(()=>({center:window.map.getView().getCenter(),size:window.map.getSize(),resolution:window.map.getView().getResolution(),pixel:window.snow.layer.getData([195,422]),sourceProjection:window.snow.source.getProjection().getCode(),tiles:[...window.snow.source.nativeTiles.values()].map(t=>({coord:t.tileCoord,state:t.getState(),pixel:t.getImage()?Array.from(t.getImage().getContext('2d').getImageData(95,95,1,1).data):null})),pending:window.snow.requests.size,status:window.snow.status.textContent})));
  throw error;
 });
 if(ARTIFACTS){fs.mkdirSync(ARTIFACTS,{recursive:true});await page.screenshot({path:path.join(ARTIFACTS,'chunk-layer-iphone.png')})}
 assert.deepEqual(errors,[]);const result={hiddenBackgroundFetch:true,priorityAfterMove:firstNew,persisted,native,inspection:inspected,cacheReused:true,responsiveness,obsoleteReadIgnored,fourMonthAreaRequests:true,pointCalls,maxActive:testedConcurrency,errors};if(ARTIFACTS)fs.writeFileSync(path.join(ARTIFACTS,'chunk-browser-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
