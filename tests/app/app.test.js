/**
 * Integration tests for app.js business logic.
 *
 * Since app.js mounts Vue at import time, we recreate and test
 * the core logic functions (computeLayerParams, togglePanel, changeSetting,
 * dotColor, error-check flow) in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ────────── Recreate the state shape & methods from app.js ────────── */

function createAppState(overrides = {}) {
  return {
    openPanel: null,
    showPasswordModal: false,
    passwordModalMode: 'unlock',
    editingKeyId: null,
    passwordError: null,
    keyStatus: { lantmateriet: false, openrouteservice: false },
    globalParams: {
      timePeriod: 20,
      winterStart: '12-01',
      winterEnd: '03-31',
      percentile: 25,
      snowThreshold: 10,
      startYear: 2006,
      endYear: 2025,
    },
    layers: [
      { id: 'snow-season', type: 'soft-filter', hue: 200, label: 'Snow Season Length', _active: false, _progress: 0, _error: null, defaultParams: { threshold: 10, percentile: 25 }, toggle: vi.fn(), update: vi.fn().mockResolvedValue(undefined) },
      { id: 'winter-temp', type: 'soft-filter', hue: 30, label: 'Winter Temperature', _active: false, _progress: 0, _error: null, defaultParams: {}, toggle: vi.fn(), update: vi.fn().mockResolvedValue(undefined) },
      { id: 'slope', type: 'hard-filter', hue: 120, label: 'Average Slope', _active: false, _progress: 0, _error: null, defaultParams: { slopeThreshold: 15 }, toggle: vi.fn(), update: vi.fn().mockResolvedValue(undefined) },
      { id: 'isochrones', type: 'annotation', hue: undefined, label: 'Travel Isochrones', _active: false, _progress: 0, _error: null, defaultParams: {}, toggle: vi.fn(), update: vi.fn().mockResolvedValue(undefined), requiresKey: 'openrouteservice', _errorCheck: () => null },
    ],
    ...overrides,
  };
}

/** Replicate app.js methods operating on a given state */
function createAppMethods(state) {
  const methods = {};

  methods.togglePanel = function (name) {
    state.openPanel = state.openPanel === name ? null : name;
  };

  methods.computeLayerParams = function (layer) {
    const gp = state.globalParams;
    return {
      ...layer.defaultParams,
      startYear: gp.endYear - gp.timePeriod + 1,
      endYear: gp.endYear,
      winterStart: gp.winterStart,
      winterEnd: gp.winterEnd,
      percentile: gp.percentile,
      threshold: gp.snowThreshold,
    };
  };

  methods.toggleLayer = function (layer, active) {
    layer._active = active;
    const map = methods._map;
    if (!map) return;

    if (active && layer._errorCheck) {
      const err = layer._errorCheck();
      if (err) {
        layer._error = err;
        layer._active = false;
        return;
      }
    }

    layer._error = null;
    layer.toggle(map, active);

    if (active) {
      methods.updateLayer(layer);
    }
  };

  methods.updateLayer = async function (layer) {
    const map = methods._map;
    if (!map || !layer._active) return;
    try {
      await layer.update(map, methods._viewport, methods.computeLayerParams(layer));
    } catch (err) {
      layer._error = 'fetch';
    }
  };

  methods.updateAllActiveLayers = function () {
    for (const layer of state.layers) {
      if (layer._active) {
        methods.updateLayer(layer);
      }
    }
  };

  methods.changeSetting = function (key, value) {
    state.globalParams[key] = value;
    if (key === 'timePeriod') {
      state.globalParams.startYear = state.globalParams.endYear - value + 1;
    }
    methods.updateAllActiveLayers();
  };

  methods.dotColor = function (layer) {
    if (layer.type === 'hard-filter') return '#888';
    if (layer.type === 'annotation') return '#aaa';
    return `hsl(${layer.hue ?? 200}, 80%, 55%)`;
  };

  methods.showKeyInput = function (keyId) {
    state.passwordModalMode = 'key';
    state.editingKeyId = keyId;
    state.showPasswordModal = true;
    state.passwordError = null;
  };

  // Mock injections
  methods._map = {};
  methods._viewport = { bounds: { north: 62, south: 61, east: 10, west: 9 }, zoom: 8 };

  return methods;
}

/* ────────── Tests ────────── */

describe('App Logic: togglePanel', () => {
  it('opens a panel when none is open', () => {
    const state = createAppState();
    const m = createAppMethods(state);
    m.togglePanel('layers');
    expect(state.openPanel).toBe('layers');
  });

  it('closes current panel when toggled again', () => {
    const state = createAppState({ openPanel: 'layers' });
    const m = createAppMethods(state);
    m.togglePanel('layers');
    expect(state.openPanel).toBeNull();
  });

  it('switches to different panel', () => {
    const state = createAppState({ openPanel: 'layers' });
    const m = createAppMethods(state);
    m.togglePanel('settings');
    expect(state.openPanel).toBe('settings');
  });
});

describe('App Logic: computeLayerParams', () => {
  it('merges global params with layer defaults', () => {
    const state = createAppState();
    const m = createAppMethods(state);
    const snowLayer = state.layers[0]; // snow-season

    const params = m.computeLayerParams(snowLayer);

    expect(params.threshold).toBe(10); // from layer defaults + globalParams.snowThreshold
    expect(params.startYear).toBe(2006); // 2025 - 20 + 1
    expect(params.endYear).toBe(2025);
    expect(params.winterStart).toBe('12-01');
    expect(params.winterEnd).toBe('03-31');
    expect(params.percentile).toBe(25);
  });

  it('recalculates startYear from timePeriod', () => {
    const state = createAppState();
    state.globalParams.timePeriod = 5;
    const m = createAppMethods(state);

    const params = m.computeLayerParams(state.layers[0]);
    expect(params.startYear).toBe(2021); // 2025 - 5 + 1
  });
});

describe('App Logic: toggleLayer', () => {
  it('activates layer and calls toggle + update', () => {
    const state = createAppState();
    const m = createAppMethods(state);
    const layer = state.layers[0];

    m.toggleLayer(layer, true);

    expect(layer._active).toBe(true);
    expect(layer.toggle).toHaveBeenCalledWith(m._map, true);
    expect(layer.update).toHaveBeenCalled();
  });

  it('deactivates layer and calls toggle only', () => {
    const state = createAppState();
    const m = createAppMethods(state);
    const layer = state.layers[0];
    layer._active = true;

    m.toggleLayer(layer, false);

    expect(layer._active).toBe(false);
    expect(layer.toggle).toHaveBeenCalledWith(m._map, false);
    expect(layer.update).not.toHaveBeenCalled();
  });

  it('blocks activation when errorCheck returns error', () => {
    const state = createAppState();
    const m = createAppMethods(state);
    const isoLayer = state.layers[3]; // isochrones
    isoLayer._errorCheck = () => 'key';

    m.toggleLayer(isoLayer, true);

    expect(isoLayer._active).toBe(false);
    expect(isoLayer._error).toBe('key');
    expect(isoLayer.toggle).not.toHaveBeenCalled();
  });

  it('does nothing when map is not available', () => {
    const state = createAppState();
    const m = createAppMethods(state);
    m._map = null;
    const layer = state.layers[0];

    m.toggleLayer(layer, true);

    expect(layer._active).toBe(true); // state is set
    expect(layer.toggle).not.toHaveBeenCalled(); // but map ops skipped
  });
});

describe('App Logic: changeSetting', () => {
  it('updates globalParams and triggers active layer updates', () => {
    const state = createAppState();
    const m = createAppMethods(state);
    state.layers[1]._active = true; // winter-temp

    m.changeSetting('percentile', 50);

    expect(state.globalParams.percentile).toBe(50);
    expect(state.layers[1].update).toHaveBeenCalled();
    expect(state.layers[0].update).not.toHaveBeenCalled(); // inactive
  });

  it('recalculates startYear when timePeriod changes', () => {
    const state = createAppState();
    const m = createAppMethods(state);

    m.changeSetting('timePeriod', 10);

    expect(state.globalParams.timePeriod).toBe(10);
    expect(state.globalParams.startYear).toBe(2016); // 2025 - 10 + 1
  });

  it('does not update inactive layers', () => {
    const state = createAppState();
    const m = createAppMethods(state);

    m.changeSetting('winterStart', '11-15');

    for (const layer of state.layers) {
      expect(layer.update).not.toHaveBeenCalled();
    }
  });
});

describe('App Logic: updateLayer error handling', () => {
  it('sets error state when update throws', async () => {
    const state = createAppState();
    const m = createAppMethods(state);
    const layer = state.layers[0];
    layer._active = true;
    layer.update.mockRejectedValue(new Error('network fail'));

    await m.updateLayer(layer);

    expect(layer._error).toBe('fetch');
  });

  it('skips update when layer is inactive', async () => {
    const state = createAppState();
    const m = createAppMethods(state);
    const layer = state.layers[0];
    layer._active = false;

    await m.updateLayer(layer);

    expect(layer.update).not.toHaveBeenCalled();
  });
});

describe('App Logic: dotColor', () => {
  it('returns #888 for hard-filter layers', () => {
    const state = createAppState();
    const m = createAppMethods(state);
    expect(m.dotColor(state.layers[2])).toBe('#888'); // slope
  });

  it('returns #aaa for annotation layers', () => {
    const state = createAppState();
    const m = createAppMethods(state);
    expect(m.dotColor(state.layers[3])).toBe('#aaa'); // isochrones
  });

  it('returns hsl for soft-filter layers', () => {
    const state = createAppState();
    const m = createAppMethods(state);
    expect(m.dotColor(state.layers[0])).toBe('hsl(200, 80%, 55%)'); // snow-season hue=200
  });

  it('defaults to hue 200 when hue is undefined', () => {
    const state = createAppState();
    const m = createAppMethods(state);
    const layer = { type: 'soft-filter', hue: undefined };
    expect(m.dotColor(layer)).toBe('hsl(200, 80%, 55%)');
  });
});

describe('App Logic: showKeyInput', () => {
  it('sets modal state for key input', () => {
    const state = createAppState();
    const m = createAppMethods(state);

    m.showKeyInput('lantmateriet');

    expect(state.showPasswordModal).toBe(true);
    expect(state.passwordModalMode).toBe('key');
    expect(state.editingKeyId).toBe('lantmateriet');
    expect(state.passwordError).toBeNull();
  });
});

/* ────────── Cache + Layer pipeline integration ────────── */
describe('Data pipeline integration (cache → source → layer)', () => {
  it('Source subclass yields Chunks that carry grid data', async () => {
    const { Source, clearMemoryCache } = await import('../../src/core/cache.js')
    const { Extent, Grid, Chunk, GridTransform } = await import('../../src/core/primitives.js')

    clearMemoryCache()

    const transform = new GridTransform({
      originX: 0, originY: 0,
      chunkSize: 512_000,
      baseResolution: 1_000,
      nativeCRS: 'EPSG:4326',
    })

    class TestSrc extends Source {
      async compute(tileId, signal) {
        const cells = tileId.cellsPerSide
        const data = new Float32Array(cells * cells).fill(99)
        return new Grid({ data, width: cells, height: cells, dtype: 'float32' })
      }
    }

    const src = new TestSrc({
      id: 'integration-test',
      transform,
      dtype: 'float32',
    })

    // Request a single-chunk extent (strict interior)
    const extent = new Extent({ west: 1, east: 511_999, south: 1, north: 511_999, crs: 'EPSG:4326' })

    const chunks = []
    for await (const chunk of src.get(extent, 1_000, null)) {
      chunks.push(chunk)
    }

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBeInstanceOf(Chunk)
    expect(chunks[0].grid.get(0, 0)).toBe(99)
    expect(chunks[0].extent.crs).toBe('EPSG:4326')
  })
});
