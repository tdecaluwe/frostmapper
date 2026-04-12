/**
 * Tests for source modules.
 *
 * All network sources are tested with mocked fetch; derived sources
 * are tested with mocked dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';


// ── road-access source ──────────────────────────────────────────────

describe('road-access source', () => {
  let source;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/sources/road-access.js');
    source = mod.default;
  });

  it('has correct id and metadata', () => {
    expect(source.id).toBe('road-access');
    expect(source.queue).toBe('overpass');
    expect(source.persist).toBe(false);
  });

  it('builds correct Overpass query', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [] }),
    });

    const bbox = { south: 64, north: 66, west: 14, east: 16 };
    await source.compute(bbox, 1, { minClassification: 'secondary' }, null);

    const body = globalThis.fetch.mock.calls[0][1].body;
    const query = decodeURIComponent(body.replace('data=', ''));
    expect(query).toContain('highway');
    expect(query).toContain('motorway');
    expect(query).toContain('secondary');
    // Should NOT include tertiary since threshold is 'secondary'
    expect(query).not.toContain('tertiary');
  });

  it('converts OSM response to GeoJSON', async () => {
    const osmResponse = {
      elements: [{
        type: 'way',
        id: 12345,
        tags: { highway: 'primary', name: 'E6' },
        geometry: [
          { lat: 65.0, lon: 15.0 },
          { lat: 65.1, lon: 15.1 },
        ],
      }],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => osmResponse,
    });

    const bbox = { south: 64, north: 66, west: 14, east: 16 };
    const result = await source.compute(bbox, 1, {}, null);

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.highway).toBe('primary');
    expect(result.features[0].geometry.type).toBe('LineString');
  });
});

// ── transport-stops source ──────────────────────────────────────────

describe('transport-stops source', () => {
  let source;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/sources/transport-stops.js');
    source = mod.default;
  });

  it('has correct id', () => {
    expect(source.id).toBe('transport-stops');
  });

  it('converts OSM nodes to GeoJSON points', async () => {
    const osmResponse = {
      elements: [
        { type: 'node', id: 1, lat: 65.0, lon: 15.0, tags: { name: 'Trondheim S', railway: 'station' } },
        { type: 'node', id: 2, lat: 65.1, lon: 15.1, tags: { name: 'Bus Stop A', highway: 'bus_stop' } },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => osmResponse,
    });

    const bbox = { south: 64, north: 66, west: 14, east: 16 };
    const result = await source.compute(bbox, 1, {}, null);

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(2);
    expect(result.features[0].properties.type).toBe('rail');
    expect(result.features[1].properties.type).toBe('bus');
  });
});

// ── airports source ─────────────────────────────────────────────────

describe('airports source', () => {
  let source;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/sources/airports.js');
    source = mod.default;
  });

  it('has correct id', () => {
    expect(source.id).toBe('airports');
  });

  it('falls back to bundled data on OpenFlights failure', async () => {
    const bundledData = {
      airports: [
        { name: 'Oslo Gardermoen', iata: 'OSL', lat: 60.197, lon: 11.100, city: 'Oslo', country: 'Norway', passengers: 28000000 },
      ],
    };

    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      callCount++;
      if (url.includes('openflights')) {
        throw new Error('network error');
      }
      // Bundled airports.json
      return {
        ok: true,
        json: async () => bundledData,
      };
    });

    const bbox = { south: 54, north: 72, west: -5, east: 35 };
    const result = await source.compute(bbox, 1, { minPassengers: 100000 }, null);

    expect(result.type).toBe('FeatureCollection');
    expect(result.features.length).toBeGreaterThanOrEqual(1);
  });
});

// ── glo30-elevation source ──────────────────────────────────────────

describe('glo30-elevation source', () => {
  let source;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/sources/glo30-elevation.js');
    source = mod.default;
  });

  it('has correct id and metadata', () => {
    expect(source.id).toBe('glo30-elevation');
    expect(source.queue).toBe('s3');
    expect(source.baseResolution).toBeCloseTo(0.00027);
  });

  it('constructs correct S3 tile paths', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(100),
    });

    // Single tile: lat=65, lon=15
    const bbox = { south: 65.1, north: 65.9, west: 15.1, east: 15.9 };
    await source.compute(bbox, 1, {}, null);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain('copernicus-dem-30m');
    expect(url).toContain('N65');
    expect(url).toContain('E015');
  });

  it('returns null when tiles 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const bbox = { south: 65.1, north: 65.9, west: 15.1, east: 15.9 };
    const result = await source.compute(bbox, 1, {}, null);
    expect(result).toBeNull();
  });
});

// ── isochrones source ───────────────────────────────────────────────

describe('isochrones source', () => {
  let source;

  beforeEach(async () => {
    vi.resetModules();

    // Must mock the crypto module's getKey before importing isochrones
    vi.doMock('../../src/core/crypto.js', () => ({
      getKey: vi.fn().mockReturnValue('test-api-key'),
    }));

    const mod = await import('../../src/sources/isochrones.js');
    source = mod.default;
  });

  it('has correct id and dependencies', () => {
    expect(source.id).toBe('isochrones');
    expect(source.dependencies).toContain('airports');
    expect(source.queue).toBe('openrouteservice');
  });

  it('throws without API key', async () => {
    vi.doMock('../../src/core/crypto.js', () => ({
      getKey: vi.fn().mockReturnValue(null),
    }));
    vi.resetModules();
    const mod = await import('../../src/sources/isochrones.js');
    const srcNoKey = mod.default;

    const mockAirports = {
      get: vi.fn().mockResolvedValue({
        data: { type: 'FeatureCollection', features: [] },
      }),
    };

    const bbox = { south: 64, north: 66, west: 14, east: 16 };
    await expect(srcNoKey.compute(bbox, 1, {}, null, { airports: mockAirports }))
      .rejects.toThrow('API key');
  });
});
