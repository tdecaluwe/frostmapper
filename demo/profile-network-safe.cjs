const { chromium } = require('playwright');
(async() => {
  const [name, projection, visibleArg, durationArg] = process.argv.slice(2);
  const visibleMap = JSON.parse(visibleArg);
  const durationMs = Number(durationArg || '3000');
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  let requests = [];
  let errors = [];
  let crashed = false;
  page.on('crash', () => { crashed = true; });
  page.on('close', () => { crashed = true; });
  page.on('requestfinished', async (req) => {
    try {
      const res = await req.response();
      requests.push({ url: req.url(), resourceType: req.resourceType(), status: res ? res.status() : null });
    } catch {}
  });
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));

  await page.goto('http://127.0.0.1:4173/demo/demo.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__demoDebug && window.__demoDebug.getMap(), { timeout: 30000 });
  await page.evaluate((visibleMap) => {
    const map = window.__demoDebug.getMap();
    const names = ['opentopomap','norway','switzerland','france','belgium','austria','italy'];
    const layers = map.getAllLayers();
    names.forEach((name, i) => {
      const visible = !!visibleMap[name];
      layers[i].setVisible(visible);
      const checkbox = document.getElementById(`toggle-${name === 'opentopomap' ? 'opentopo' : name}`);
      if (checkbox) checkbox.checked = visible;
    });
  }, visibleMap);
  await page.waitForTimeout(500);
  requests = [];
  errors = [];
  await page.selectOption('#projection-picker', projection);
  await page.waitForTimeout(durationMs);

  let state = { projection: 'unknown', zoom: null, layerInfo: [] };
  try {
    state = await page.evaluate(() => ({ projection: window.__demoDebug.getProjection(), zoom: window.__demoDebug.getZoom(), layerInfo: window.__demoDebug.getLayerInfo() }));
  } catch {}

  const tileReqs = requests.filter(r => r.resourceType === 'image');
  const stats = {};
  for (const r of tileReqs) {
    const u = new URL(r.url);
    const host = u.host;
    const path = u.pathname;
    if (!stats[host]) stats[host] = { total:0, bad:0, unique:new Set(), zHist:{}, top:{} };
    const s = stats[host];
    s.total += 1;
    s.unique.add(r.url);
    if ((r.status || 0) >= 400) s.bad += 1;
    let key = path; let z = null;
    const xyz = path.match(/\/(\d+)\/(\d+)\/(\d+)\.(png|jpg|jpeg)$/);
    if (xyz) { z = xyz[1]; key = `${xyz[1]}/${xyz[2]}/${xyz[3]}`; }
    if (z !== null) s.zHist[z] = (s.zHist[z] || 0) + 1;
    s.top[key] = (s.top[key] || 0) + 1;
  }
  const normalized = Object.fromEntries(Object.entries(stats).map(([host, s]) => [host, {
    total: s.total, bad: s.bad, unique: s.unique.size, zHist: s.zHist,
    topRepeats: Object.entries(s.top).sort((a,b)=>b[1]-a[1]).slice(0,10),
  }]));

  console.log(JSON.stringify({ name, projection, crashed, state, imageRequestCount: tileReqs.length, consoleErrorCount: errors.length, tileStats: normalized, sampleErrors: errors.slice(0,10) }, null, 2));
  await browser.close().catch(() => {});
})();
