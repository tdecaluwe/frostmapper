// Optional real-browser check: Web Locks and IndexedDB shared across two tabs.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');let active=0,maximum=0,limitedAt=0,afterLimit=0;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/data'){
  if(url.searchParams.has('limit')){limitedAt=Date.now();res.writeHead(429,{'Retry-After':'1'});res.end();return}
  if(limitedAt)afterLimit=Date.now();active++;maximum=Math.max(maximum,active);let finished=false;
  res.on('close',()=>{if(!finished){active--;finished=true}});
  res.writeHead(200,{'Content-Type':'application/octet-stream'});res.write('a');setTimeout(()=>res.end('b'),100);return;
 }
 if(url.pathname==='/worker.js'){
  res.setHeader('Content-Type','application/javascript');res.end(`import {SnowDownloadGate} from '/src/map/snow-season/download-gate.js';const gate=new SnowDownloadGate({spacingMs:0});onmessage=async({data})=>{try{await Promise.all(data.urls.map(url=>gate.download(url)));postMessage({id:data.id,ok:true})}catch(error){postMessage({id:data.id,error:error.message})}}`);return;
 }
 if(url.pathname.startsWith('/src/')){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(ROOT,url.pathname)));return}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Snow download lock test</title>');
});
(async()=>{
 await new Promise(r=>server.listen(8773,'127.0.0.1',r));
 const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext(),a=await context.newPage(),b=await context.newPage();
  for(const page of [a,b]){await page.goto('http://127.0.0.1:8773');await page.evaluate(()=>{
   window.worker=new Worker('/worker.js',{type:'module'});window.run=urls=>new Promise(resolve=>{worker.onmessage=e=>resolve(e.data);worker.postMessage({id:1,urls})});
  })}
  const results=await Promise.all([a,b].map(p=>p.evaluate(()=>run(['/data','/data']))));
  assert.ok(results.every(r=>r.ok));assert.equal(maximum,1);assert.equal(active,0);
  const limited=await a.evaluate(()=>run(['/data?limit']));assert.match(limited.error,/429/);
  // Cooldown survives the owner disappearing; it is not owned by that tab.
  await a.close();await b.evaluate(()=>run(['/data']));assert.ok(afterLimit-limitedAt>=990,`cooldown ${afterLimit-limitedAt} ms`);
  // A terminated worker cannot leave a persistent ownership lock behind.
  await b.evaluate(()=>{worker.postMessage({id:2,urls:['/data']})});
  await new Promise(r=>setTimeout(r,30));await b.evaluate(()=>{worker.terminate();worker=new Worker('/worker.js',{type:'module'})});
  assert.equal((await b.evaluate(()=>run(['/data']))).ok,true);
  console.log(JSON.stringify({twoTabMaximumDownloads:maximum,persistedCooldownMs:afterLimit-limitedAt,terminatedOwnerReleased:true}));
 }finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
