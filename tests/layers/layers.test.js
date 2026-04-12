/**
 * Unit tests for all 8 layer modules.
 *
 * Mocks: MapLibre map, cache.getSource, map.targetStride, crypto.getKey, document/canvas.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ──────────────────── Shared mock helpers ──────────────────── */

// Cache mock — controls what getSource() returns
const mockSourceGet = vi.fn();
const mockGetSource = vi.fn(() => ({ get: mockSourceGet }));

vi.mock('../../src/core/cache.js', () => ({
  getSource: (...a) => mockGetSource(...a),
}));

vi.mock('../../src/core/map.js', () => ({
  targetStride: vi.fn(() => 0.01),
  onViewportChange: vi.fn(),
}));

vi.mock('../../src/core/crypto.js', () => ({
  getKey: vi.fn((name) => (name === 'openrouteservice' ? 'test-key-123' : null)),
}));

/** Create a mock MapLibre map object */
function createMockMap() {
  const sources = {};
  const layers = {};
  return {
    getLayer: vi.fn((id) => layers[id] || null),
    setLayoutProperty: vi.fn((id, prop, value) => {
      if (!layers[id]) layers[id] = {};
      layers[id][prop] = value;
    }),
    getSource: vi.fn((id) => sources[id] || null),
    addSource: vi.fn((id, spec) => {
      sources[id] = { ...spec, setData: vi.fn(), updateImage: vi.fn() };
    }),
    addLayer: vi.fn((spec, before) => {
      layers[spec.id] = { ...spec, visibility: 'visible' };
    }),
    _sources: sources,
    _layers: layers,
  };
}

/** Standard viewport for tests */
const viewport = {
  bounds: { north: 62, south: 61, east: 10, west: 9 },
  zoom: 8,
};

/** Stub HTMLCanvasElement + 2D context for raster layer rendering */
function stubCanvas() {
  const pixelData = new Uint8ClampedArray(40000);  // 100×100×4
  const imageDataObj = { data: pixelData, width: 100, height: 100 };
  const ctx = {
    createImageData: vi.fn((w, h) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    })),
    putImageData: vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => 'data:image/png;base64,MOCK'),
  };
  vi.stubGlobal('document', {
    createElement: vi.fn((tag) => {
      if (tag === 'canvas') return canvas;
      return {};
    }),
  });
  return { canvas, ctx };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSource.mockReturnValue({ get: mockSourceGet });
  mockSourceGet.mockReset();
  // Remove document stub if set
  try { vi.unstubAllGlobals(); } catch {}
});

/* ────────────────────────────────────────────────────────────── */
/*                     1. SNOW-SEASON LAYER                      */
/* ────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────── */
/*                     5. ELEVATION LAYER                        */
/* ────────────────────────────────────────────────────────────── */
describe('elevation layer', async () => {
  const { default: layer } = await import('../../src/layers/elevation.js');

  it('toggle manages visibility', () => {
    const map = createMockMap();
    map._layers[layer._mapLayerId] = {};
    map.getLayer.mockImplementation((id) => map._layers[id] || null);

    layer.toggle(map, false);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(layer._mapLayerId, 'visibility', 'none');
  });

  it('update renders elevation overlay with values', async () => {
    stubCanvas();
    const map = createMockMap();
    layer._active = true;

    const values = new Float32Array([100, 500, 1000, 1500]);
    mockSourceGet.mockResolvedValue({
      data: { values, width: 2, height: 2, bounds: viewport.bounds },
      bounds: viewport.bounds,
      stride: 0.001,
    });

    await layer.update(map, viewport, {});

    expect(map.addSource).toHaveBeenCalledWith(layer._mapSourceId, expect.objectContaining({ type: 'image' }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: layer._mapLayerId,
      type: 'raster',
    }));
  });

  it('update handles multi-tile response', async () => {
    stubCanvas();
    const map = createMockMap();
    layer._active = true;

    const tile1 = { values: new Float32Array([100, 200]), width: 2, height: 1, bounds: { north: 62, south: 61.5, west: 9, east: 9.5 } };
    const tile2 = { values: new Float32Array([300, 400]), width: 2, height: 1, bounds: { north: 62, south: 61.5, west: 9.5, east: 10 } };

    mockSourceGet.mockResolvedValue({
      data: { tiles: [tile1, tile2], bounds: viewport.bounds },
      bounds: viewport.bounds,
      stride: 0.001,
    });

    await layer.update(map, viewport, {});
    // Tiles are merged into single overlay — addSource called once
    expect(map.addSource).toHaveBeenCalledTimes(1);
  });

  it('update bails on null result', async () => {
    const map = createMockMap();
    layer._active = true;
    mockSourceGet.mockResolvedValue(null);

    await layer.update(map, viewport, {});
    expect(map.addSource).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────────────────────────────────────── */
/*                     6. ROAD-ACCESS LAYER                      */
/* ────────────────────────────────────────────────────────────── */
describe('road-access layer', async () => {
  const { default: layer } = await import('../../src/layers/road-access.js');

  it('toggle manages visibility for mask layer', () => {
    const map = createMockMap();
    map._layers[layer._mapLayerId] = { visibility: 'visible' };
    map.getLayer.mockImplementation((id) => map._layers[id] || null);

    layer.toggle(map, false);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(layer._mapLayerId, 'visibility', 'none');
  });

  it('update adds GeoJSON source and layers', async () => {
    stubCanvas();
    const map = createMockMap();
    layer._active = true;

    const geojson = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[9, 61], [10, 62]] }, properties: { highway: 'tertiary' } },
      ],
    };
    mockSourceGet.mockResolvedValue({ data: geojson, bounds: viewport.bounds, stride: 1 });

    await layer.update(map, viewport, {});

    expect(map.addSource).toHaveBeenCalledWith(layer._mapSourceId, expect.objectContaining({
      type: 'image',
    }));
    // Single raster mask layer
    expect(map.addLayer).toHaveBeenCalledTimes(1);
  });

  it('update calls setData on existing source', async () => {
    stubCanvas();
    const map = createMockMap();
    layer._active = true;
    const updateImageFn = vi.fn();
    map._sources[layer._mapSourceId] = { updateImage: updateImageFn };
    map.getSource.mockImplementation((id) => map._sources[id] || null);

    const geojson = { type: 'FeatureCollection', features: [] };
    mockSourceGet.mockResolvedValue({ data: geojson, bounds: viewport.bounds, stride: 1 });

    await layer.update(map, viewport, {});

    expect(updateImageFn).toHaveBeenCalledWith(expect.objectContaining({ url: expect.any(String), coordinates: expect.any(Array) }));
    expect(map.addSource).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────────────────────────────────────── */
/*                   7. TRANSPORT-STOPS LAYER                    */
/* ────────────────────────────────────────────────────────────── */
describe('transport-stops layer', async () => {
  const { default: layer } = await import('../../src/layers/transport-stops.js');

  it('toggle manages visibility for circle + label layers', () => {
    const map = createMockMap();
    for (const id of layer._mapLayerIds) {
      map._layers[id] = {};
    }
    map.getLayer.mockImplementation((id) => map._layers[id] || null);

    layer.toggle(map, true);
    expect(map.setLayoutProperty).toHaveBeenCalledWith('layer-transport-stops-circle', 'visibility', 'visible');
    expect(map.setLayoutProperty).toHaveBeenCalledWith('layer-transport-stops-label', 'visibility', 'visible');
  });

  it('update clears data when below minZoom', async () => {
    const map = createMockMap();
    layer._active = true;
    const setDataFn = vi.fn();
    map._sources[layer._mapSourceId] = { setData: setDataFn };
    map.getSource.mockImplementation((id) => map._sources[id] || null);

    const lowZoomViewport = { ...viewport, zoom: 5 };
    await layer.update(map, lowZoomViewport, {});

    expect(setDataFn).toHaveBeenCalledWith({ type: 'FeatureCollection', features: [] });
  });

  it('update adds GeoJSON source and styled layers at valid zoom', async () => {
    const map = createMockMap();
    layer._active = true;

    const geojson = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [9.5, 61.5] }, properties: { name: 'Stop A', type: 'bus' } },
      ],
    };
    mockSourceGet.mockResolvedValue({ data: geojson, bounds: viewport.bounds, stride: 1 });

    const highZoomViewport = { ...viewport, zoom: 12 };
    await layer.update(map, highZoomViewport, {});

    expect(map.addSource).toHaveBeenCalledWith(layer._mapSourceId, expect.objectContaining({
      type: 'geojson',
      data: geojson,
    }));
    // Two visual layers: circle + symbol/label
    expect(map.addLayer).toHaveBeenCalledTimes(2);
  });
});

/* ────────────────────────────────────────────────────────────── */
/*                     8. ISOCHRONES LAYER                       */
/* ────────────────────────────────────────────────────────────── */
describe('isochrones layer', async () => {
  const { default: layer } = await import('../../src/layers/isochrones.js');

  it('toggle manages visibility for fill, line, label layers', () => {
    const map = createMockMap();
    for (const id of layer._mapLayerIds) {
      map._layers[id] = {};
    }
    map.getLayer.mockImplementation((id) => map._layers[id] || null);

    layer.toggle(map, false);
    expect(map.setLayoutProperty).toHaveBeenCalledTimes(3);
  });

  it('update requires OpenRouteService API key', async () => {
    // Override getKey to return null
    const { getKey } = await import('../../src/core/crypto.js');
    getKey.mockReturnValueOnce(null);

    const map = createMockMap();
    layer._active = true;

    await layer.update(map, viewport, {});
    expect(mockGetSource).not.toHaveBeenCalled();
  });

  it('update adds GeoJSON source and 3 styled layers', async () => {
    const map = createMockMap();
    layer._active = true;

    const geojson = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[9, 61], [10, 61], [10, 62], [9, 62], [9, 61]]] }, properties: { value: 3600, iata: 'OSL' } },
      ],
    };
    mockSourceGet.mockResolvedValue({ data: geojson, bounds: viewport.bounds, stride: 1 });

    await layer.update(map, viewport, {});

    expect(map.addSource).toHaveBeenCalledWith(layer._mapSourceId, expect.objectContaining({
      type: 'geojson',
      data: geojson,
    }));
    // Three layers: fill + line + symbol
    expect(map.addLayer).toHaveBeenCalledTimes(3);
  });

  it('update calls setData on existing source', async () => {
    const map = createMockMap();
    layer._active = true;
    const setDataFn = vi.fn();
    map._sources[layer._mapSourceId] = { setData: setDataFn };
    map.getSource.mockImplementation((id) => map._sources[id] || null);

    const geojson = { type: 'FeatureCollection', features: [] };
    mockSourceGet.mockResolvedValue({ data: geojson, bounds: viewport.bounds, stride: 1 });

    await layer.update(map, viewport, {});

    expect(setDataFn).toHaveBeenCalledWith(geojson);
    expect(map.addSource).not.toHaveBeenCalled();
  });
});


