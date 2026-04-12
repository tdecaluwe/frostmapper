
const { chromium } = require('playwright');
(async() => {
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4173/demo/demo.html', {waitUntil: 'domcontentloaded', timeout: 30000});
  await page.waitForFunction(() => window.__demoDebug && window.__demoDebug.getMap(), {timeout: 30000});
  const result = await page.evaluate(async () => {
    const projections = ['EPSG:3857', 'EPSG:4326', 'EPSG:3035', 'EPSG:25833', 'EPSG:PEIRCE'];
    const bbox = { minLon: 5, maxLon: 15, minLat: 45, maxLat: 70 };
    function mulberry32(a) {
      return function() {
        let t = a += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const rand = mulberry32(123456789);
    const points = [];
    const {transform, get: getProjection} = await import('ol/proj.js');
    while (points.length < 1000) {
      const lon = bbox.minLon + (bbox.maxLon - bbox.minLon) * rand();
      const lat = bbox.minLat + (bbox.maxLat - bbox.minLat) * rand();
      let ok = true;
      for (const code of projections) {
        const proj = transform([lon, lat], 'EPSG:4326', code);
        if (!proj || !Number.isFinite(proj[0]) || !Number.isFinite(proj[1])) { ok = false; break; }
        const inv = transform(proj, code, 'EPSG:4326');
        if (!inv || !Number.isFinite(inv[0]) || !Number.isFinite(inv[1])) { ok = false; break; }
        const extent = getProjection(code)?.getExtent?.();
        if (extent) {
          if (proj[0] < extent[0] || proj[0] > extent[2] || proj[1] < extent[1] || proj[1] > extent[3]) {
            ok = false; break;
          }
        }
      }
      if (ok) points.push([lon, lat]);
    }
    function benchForward(code) {
      const start = performance.now();
      let checksum = 0;
      for (const p of points) {
        const out = transform(p, 'EPSG:4326', code);
        checksum += out[0] + out[1];
      }
      return { ms: performance.now() - start, checksum };
    }
    function benchInverse(code) {
      const projected = points.map((p) => transform(p, 'EPSG:4326', code));
      const start = performance.now();
      let checksum = 0;
      for (const p of projected) {
        const out = transform(p, code, 'EPSG:4326');
        checksum += out[0] + out[1];
      }
      return { ms: performance.now() - start, checksum };
    }
    return {
      pointCount: points.length,
      bounds: bbox,
      sample: points.slice(0, 5),
      results: projections.map((code) => ({ code, forward: benchForward(code), inverse: benchInverse(code) })),
    };
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
