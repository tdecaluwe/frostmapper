const { chromium } = require('playwright');
const fs = require('fs');

async function runScenario(name, projection, visibleMap, durationMs = 8000) {
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  let requests = [];
  let failures = [];
  let errors = [];
  page.on('requestfinished', async (req) => {
    try {
      const res = await req.response();
      requests.push({ url: req.url(), method: req.method(), resourceType: req.resourceType(), status: res ? res.status() : null });
    } catch {}
  });
  page.on('requestfailed', (req) => {
    failures.push({ url: req.url(), method: req.method(), resourceType: req.resourceType(), failure: req.failure()?.errorText || 'unknown' });
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

  await page.waitForTimeout(1000);
  requests = [];
  failures = [];
  errors = [];

  const client = await page.context().newCDPSession(page);
  await client.send('Profiler.enable');
  await client.send('Profiler.start');
  await page.selectOption('#projection-picker', projection);
  await page.waitForTimeout(durationMs);
  const profile = await client.send('Profiler.stop');

  const state = await page.evaluate(() => ({
    projection: window.__demoDebug.getProjection(),
    zoom: window.__demoDebug.getZoom(),
    layerInfo: window.__demoDebug.getLayerInfo(),
    canvasCount: document.querySelectorAll('#map canvas').length,
  }));

  const tileReqs = requests.filter(r => r.resourceType === 'image');
  const uniqueUrls = new Set(tileReqs.map(r => r.url));
  const tileStats = {};
  for (const r of tileReqs) {
    let host = 'invalid';
    let path = '';
    try {
      const u = new URL(r.url);
      host = u.host;
      path = u.pathname;
    } catch {}
    if (!tileStats[host]) tileStats[host] = { total: 0, bad: 0, unique: new Set(), zHist: {}, repeats: {} };
    const s = tileStats[host];
    s.total += 1;
    s.unique.add(r.url);
    if (r.status >= 400) s.bad += 1;

    let key = path;
    let z = null;
    const xyz = path.match(/\/(\d+)\/(\d+)\/(\d+)\.(png|jpg|jpeg)$/);
    if (xyz) {
      z = xyz[1];
      key = `${xyz[1]}/${xyz[2]}/${xyz[3]}`;
    } else if (host.includes('wmts.geo.admin.ch')) {
      const m = path.match(/\/3857\/(\d+)\/(\d+)\/(\d+)\./);
      if (m) {
        z = m[1];
        key = `${m[1]}/${m[2]}/${m[3]}`;
      }
    }
    if (z !== null) s.zHist[z] = (s.zHist[z] || 0) + 1;
    s.repeats[key] = (s.repeats[key] || 0) + 1;
  }

  const normalizedTileStats = Object.fromEntries(Object.entries(tileStats).map(([host, s]) => [host, {
    total: s.total,
    bad: s.bad,
    unique: s.unique.size,
    zHist: s.zHist,
    topRepeats: Object.entries(s.repeats).sort((a,b) => b[1] - a[1]).slice(0, 10),
  }]));

  const nodes = new Map();
  for (const node of profile.profile.nodes) nodes.set(node.id, node);
  const samples = profile.profile.samples || [];
  const timeDeltas = profile.profile.timeDeltas || [];
  const totals = new Map();
  for (let i = 0; i < samples.length; i++) totals.set(samples[i], (totals.get(samples[i]) || 0) + (timeDeltas[i] || 0));
  const top = Array.from(totals.entries()).map(([id, t]) => {
    const cf = (nodes.get(id) || {}).callFrame || {};
    return { fn: cf.functionName || '(anonymous)', url: cf.url || '', line: cf.lineNumber || 0, selfMs: +(t / 1000).toFixed(2) };
  }).sort((a, b) => b.selfMs - a.selfMs).slice(0, 15);

  const result = {
    name,
    projection,
    state,
    requestCount: requests.length,
    imageRequestCount: tileReqs.length,
    uniqueImageUrls: uniqueUrls.size,
    failureCount: failures.length,
    consoleErrorCount: errors.length,
    tileStats: normalizedTileStats,
    sampleErrors: errors.slice(0, 10),
    top,
  };

  console.log(JSON.stringify(result, null, 2));
  fs.writeFileSync(`/tmp/${name}.json`, JSON.stringify(result, null, 2));
  await browser.close();
}

const [name, projection, visibleArg, durationArg] = process.argv.slice(2);
runScenario(name, projection, JSON.parse(visibleArg), Number(durationArg || '8000')).catch((err) => {
  console.error(err);
  process.exit(1);
});
