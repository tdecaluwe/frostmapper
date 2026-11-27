// Deterministic refresh races and actual OL reprojection; no archive downloads.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),NODE=process.env.OL_NODE_MODULES||path.dirname(path.dirname(require.resolve('ol/package.json')));
const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#map{width:390px;height:844px}</style><div id="map"></div><script type="importmap">{"imports":{"ol/":"/modules/ol/","proj4":"/proj4-esm.js","rbush":"/modules/rbush/index.js","quickselect":"/modules/quickselect/index.js"}}</script>';
const server=http.createServer((req,res)=>{const rel=new URL(req.url,'http://localhost').pathname;
 if(rel==='/'){res.setHeader('Content-Type','text/html');return res.end(html)}
 if(rel==='/proj4-esm.js'){res.setHeader('Content-Type','application/javascript');return res.end("import '/modules/proj4/dist/proj4.js';export default globalThis.proj4;")}
 const file=rel.startsWith('/modules/')?path.join(NODE,rel.slice(9)):path.join(ROOT,rel);
 try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/plain');res.end(fs.readFileSync(file))}catch{res.statusCode=404;res.end()}
});
(async()=>{await new Promise(r=>server.listen(8770,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8770/');
 await page.evaluate(async()=>{
  const [{SnowSeasonRasterSource},{default:Map},{default:View},{default:TileLayer},{default:proj4},{register},{get,transform}]=await Promise.all([import('/src/map/snow-season/raster-source.js'),import('ol/Map.js'),import('ol/View.js'),import('ol/layer/Tile.js'),import('proj4'),import('ol/proj/proj4.js'),import('ol/proj.js')]);
  proj4.defs('EPSG:32633','+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs');register(proj4);
  window.modules={SnowSeasonRasterSource,Map,View,TileLayer,get,transform};window.jobs=[];
  window.source=new SnowSeasonRasterSource(data=>new Promise(resolve=>jobs.push({data,resolve})));
  window.tile=source.getTile(4,0,0,1,get('EPSG:32633'));tile.load();window.initialKey=source.getKey();
  source.chunksChanged(['0/0']);
  window.pixels=color=>{const p=new Uint8ClampedArray(111*111*4);for(let i=0;i<p.length;i+=4)p.set([...color,255],i);return p};
 });
 await page.waitForTimeout(600);
 assert.equal(await page.evaluate(()=>source.getKey()),await page.evaluate(()=>initialKey));
 await page.evaluate(()=>jobs[0].resolve(pixels([30,60,90])));await page.waitForFunction(()=>tile.getState()===2);
 await page.waitForFunction(()=>jobs.length===2);
 const before=await page.evaluate(()=>({key:source.getKey(),state:tile.getState(),pixel:Array.from(tile.getImage().getContext('2d').getImageData(0,0,1,1).data)}));
 assert.equal(before.state,2);assert.deepEqual(before.pixel,[30,60,90,255]);assert.equal(before.key,await page.evaluate(()=>initialKey));
 await page.evaluate(()=>{source.chunksChanged(['0/0']);source.chunksChanged(['0/0']);source.chunksChanged(['0/0'])});await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>jobs.length),2);
 await page.evaluate(()=>jobs[1].resolve(pixels([60,90,120])));await page.waitForFunction(()=>source.getKey()!==initialKey);
 assert.equal(await page.evaluate(()=>tile.getState()),2);await page.waitForFunction(()=>jobs.length===3);
 await page.evaluate(()=>{source.setActive(false);jobs[2].resolve(pixels([90,120,150]))});await page.waitForTimeout(100);
 const hiddenCalls=await page.evaluate(()=>jobs.length);await page.evaluate(()=>source.chunksChanged(['0/0']));await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>jobs.length),hiddenCalls);
 await page.evaluate(()=>{source.dispose();const {SnowSeasonRasterSource,Map,View,TileLayer,get,transform}=modules;window.held=[];window.hold=false;window.color=[30,60,90];window.frames=[];
  window.source=new SnowSeasonRasterSource(data=>hold?new Promise(resolve=>held.push(resolve)):Promise.resolve(pixels(color)));
  window.map=new Map({target:'map',layers:[new TileLayer({source,preload:0})],view:new View({projection:'EPSG:3857',center:transform([-24500,7949500],'EPSG:32633','EPSG:3857'),resolution:100})});
  window.sample=()=>{const c=document.querySelector('#map canvas');return c?Array.from(c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data):[0,0,0,0]};
 });
 await page.waitForFunction(()=>sample()[3]===255);const initial=await page.evaluate(()=>sample());
 await page.evaluate(()=>{window.monitor=setInterval(()=>frames.push(sample()),16);hold=true;source.chunksChanged(['0/0'])});
 await page.waitForFunction(()=>held.length>0);await page.waitForTimeout(350);
 assert.deepEqual(await page.evaluate(()=>sample()),initial);
 await page.evaluate(()=>{hold=false;color=[90,120,150];held.splice(0).forEach(resolve=>resolve(pixels(color)))});
 await page.waitForFunction(()=>sample()[0]===90);await page.waitForTimeout(100);
 const result=await page.evaluate(()=>{clearInterval(monitor);return{frames:frames.length,blankFrames:frames.filter(p=>p[3]===0).length,last:sample(),refreshRequests:jobs.length}});
 assert.equal(result.blankFrames,0);assert.deepEqual(result.last,[90,120,150,255]);assert.deepEqual(errors,[]);console.log(JSON.stringify({...result,initialLoadSurvivedUpdate:true,coalescedRefresh:true,hiddenRefreshPaused:true,errors}));
 }finally{await browser.close();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
