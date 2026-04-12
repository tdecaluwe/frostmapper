const { chromium } = require('playwright');

(async() => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4173/demo/demo.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__demoDebug && window.__demoDebug.getMap(), { timeout: 30000 });

  const result = await page.evaluate(async () => {
    const proj4mod = await import('https://esm.sh/proj4@2.20.4');
    const proj4 = proj4mod.default;

    proj4.defs('EPSG:3035', '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs');
    proj4.defs('EPSG:25833', '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs');

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

    function forward(code, lonLat) {
      if (code === 'EPSG:PEIRCE') return window.__demoDebug.projectLonLat(lonLat[0], lonLat[1]);
      if (code === 'EPSG:4326') return lonLat.slice();
      return proj4('EPSG:4326', code, lonLat);
    }

    function inverse(code, xy) {
      if (code === 'EPSG:PEIRCE') return window.__demoDebug.unprojectCoordinate(xy[0], xy[1]);
      if (code === 'EPSG:4326') return xy.slice();
      return proj4(code, 'EPSG:4326', xy);
    }

    const extents = {
      'EPSG:3857': [-20037508.342789244, -20037508.342789244, 20037508.342789244, 20037508.342789244],
      'EPSG:4326': [-180, -90, 180, 90],
      'EPSG:3035': [1900000, 900000, 6900000, 5500000],
      'EPSG:25833': [-1200000, 3500000, 2500000, 8500000],
      'EPSG:PEIRCE': [-20037508.342789244, -20037508.34278923, 20037508.34278923, 20037508.342789244],
    };

    const rand = mulberry32(123456789);
    const points = [];
    while (points.length < 1000) {
      const lon = bbox.minLon + (bbox.maxLon - bbox.minLon) * rand();
      const lat = bbox.minLat + (bbox.maxLat - bbox.minLat) * rand();
      let ok = true;
      for (const code of projections) {
        const proj = forward(code, [lon, lat]);
        if (!proj || !Number.isFinite(proj[0]) || !Number.isFinite(proj[1])) { ok = false; break; }
        const inv = inverse(code, proj);
        if (!inv || !Number.isFinite(inv[0]) || !Number.isFinite(inv[1])) { ok = false; break; }
        const e = extents[code];
        if (e && (proj[0] < e[0] || proj[0] > e[2] || proj[1] < e[1] || proj[1] > e[3])) {
          ok = false; break;
        }
      }
      if (ok) points.push([lon, lat]);
    }

    function benchForward(code) {
      const start = performance.now();
      let checksum = 0;
      for (const p of points) {
        const out = forward(code, p);
        checksum += out[0] + out[1];
      }
      return { ms: performance.now() - start, checksum };
    }

    function benchInverse(code) {
      const projected = points.map((p) => forward(code, p));
      const start = performance.now();
      let checksum = 0;
      for (const p of projected) {
        const out = inverse(code, p);
        checksum += out[0] + out[1];
      }
      return { ms: performance.now() - start, checksum };
    }

    return {
      pointCount: points.length,
      bounds: bbox,
      sample: points.slice(0, 5),
      results: projections.map((code) => ({ code, forward: benchForward(code), inverse: benchInverse(code) })),
      notes: {
        proj4Only: ['EPSG:3857', 'EPSG:4326', 'EPSG:3035', 'EPSG:25833'],
        custom: ['EPSG:PEIRCE']
      }
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
