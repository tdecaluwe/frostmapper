import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { registerCRS, GridTransform, TileId, Extent, Grid, Chunk } from '../../src/core/primitives.js'
import { clearMemoryCache } from '../../src/core/cache.js'
import { SnowSeasonSource } from '../../src/sources/snow-season.js'
import { WinterTempSource } from '../../src/sources/winter-temp.js'
import { MeltRiskSource } from '../../src/sources/melt-risk.js'

// ── shared transform ────────────────────────────────────────────────────────

const TRANSFORM = new GridTransform({
  originX: -75_000,
  originY: 6_450_000,
  chunkSize: 512_000,
  baseResolution: 1_000,
  nativeCRS: 'EPSG:3035',
})

beforeAll(() => {
  registerCRS({
    'EPSG:3035': '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs',
    'EPSG:4326': '+proj=longlat +datum=WGS84 +no_defs',
  })
})

beforeEach(() => {
  clearMemoryCache()
})

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTileId(stride = 1) {
  return new TileId({ chunkX: 0, chunkY: 0, stride, transform: TRANSFORM })
}

/**
 * Create a stub child source whose compute() returns a single-cell Grid
 * with the given value.
 */
function makeStubSource(value, dtype = 'uint8') {
  return {
    get: async function* (_extent, _resolution, _signal) {
      const tileId = makeTileId()
      const Ctor = dtype === 'float32' ? Float32Array : Uint8Array
      const grid = new Grid({ data: new Ctor([value]), width: 1, height: 1, dtype })
      yield new Chunk({ tileId, grid })
    },
  }
}

/**
 * Create a stub child source that respects abort: awaits a promise that
 * only resolves when the signal fires.
 */
function makeSlowAbortableSource() {
  return {
    get: async function* (_extent, _resolution, signal) {
      await new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        // Never resolves on its own — only resolves on abort
      })
    },
  }
}

function makeSnowSource(percentile, childValues) {
  const childSources = childValues.map(v => makeStubSource(v, 'uint8'))
  return new SnowSeasonSource({
    id: `snow-season-test-${Date.now()}`,
    childSources,
    percentile,
    transform: TRANSFORM,
    persist: false,
    _store: null,
  })
}

function makeMeltSource(percentile, childValues) {
  const childSources = childValues.map(v => makeStubSource(v, 'uint8'))
  return new MeltRiskSource({
    id: `melt-risk-test-${Date.now()}`,
    childSources,
    percentile,
    transform: TRANSFORM,
    persist: false,
    _store: null,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// SnowSeasonSource tests
// ═══════════════════════════════════════════════════════════════════════════

describe('SnowSeasonSource — test 1: p25 of [10, 20, 30, 40] = 10', () => {
  it('returns Grid with cell value 10', async () => {
    const source = makeSnowSource(25, [10, 20, 30, 40])
    const tileId = makeTileId()

    const grid = await source.compute(tileId, new AbortController().signal)

    expect(grid).not.toBeNull()
    // idx = floor(25/100 * (4-1)) = floor(0.75) = 0 → sorted[0] = 10
    expect(grid.data[0]).toBe(10)
  })
})

describe('SnowSeasonSource — test 2: p50 of [10, 20, 30, 40] = 20', () => {
  it('returns Grid with cell value 20', async () => {
    const source = makeSnowSource(50, [10, 20, 30, 40])
    const tileId = makeTileId()

    const grid = await source.compute(tileId, new AbortController().signal)

    // idx = floor(50/100 * (4-1)) = floor(1.5) = 1 → sorted[1] = 20
    expect(grid.data[0]).toBe(20)
  })
})

describe('SnowSeasonSource — test 3: abort propagates to child sources', () => {
  it('rejects with AbortError when signal fires mid-computation', async () => {
    const slowChild = makeSlowAbortableSource()
    const source = new SnowSeasonSource({
      id: 'snow-season-abort-test',
      childSources: [slowChild],
      percentile: 50,
      transform: TRANSFORM,
      persist: false,
      _store: null,
    })

    const controller = new AbortController()
    const promise = source.compute(makeTileId(), controller.signal)
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('SnowSeasonSource — test 4: dtype is uint8', () => {
  it('returned Grid has dtype === "uint8"', async () => {
    const source = makeSnowSource(50, [5, 10])
    const grid = await source.compute(makeTileId(), new AbortController().signal)

    expect(grid.dtype).toBe('uint8')
  })
})

describe('SnowSeasonSource — test 5: zero values included in percentile', () => {
  it('p50 of [0, 10, 20] = 10', async () => {
    const source = makeSnowSource(50, [0, 10, 20])
    const tileId = makeTileId()

    const grid = await source.compute(tileId, new AbortController().signal)

    // idx = floor(50/100 * (3-1)) = floor(1) = 1 → sorted[1] = 10
    expect(grid.data[0]).toBe(10)
  })
})

describe('SnowSeasonSource — test 5b: p0 of [0, 10, 20] = 0 (zero value not ignored)', () => {
  it('zero contributes as the minimum', async () => {
    const source = makeSnowSource(0, [0, 10, 20])
    const grid = await source.compute(makeTileId(), new AbortController().signal)

    // idx = floor(0/100 * (3-1)) = 0 → sorted[0] = 0
    expect(grid.data[0]).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// MeltRiskSource tests
// ═══════════════════════════════════════════════════════════════════════════

describe('MeltRiskSource — test 6: p25 of [0, 5, 10, 15] = 0', () => {
  it('returns Grid with cell value 0', async () => {
    const source = makeMeltSource(25, [0, 5, 10, 15])
    const tileId = makeTileId()

    const grid = await source.compute(tileId, new AbortController().signal)

    // idx = floor(25/100 * (4-1)) = floor(0.75) = 0 → sorted[0] = 0
    expect(grid.data[0]).toBe(0)
  })
})

describe('MeltRiskSource — test 7: p75 of [0, 5, 10, 15] = 10', () => {
  it('returns Grid with cell value 10', async () => {
    const source = makeMeltSource(75, [0, 5, 10, 15])
    const tileId = makeTileId()

    const grid = await source.compute(tileId, new AbortController().signal)

    // idx = floor(75/100 * (4-1)) = floor(2.25) = 2 → sorted[2] = 10
    expect(grid.data[0]).toBe(10)
  })
})

describe('MeltRiskSource — test 8: dtype is uint8', () => {
  it('returned Grid has dtype === "uint8"', async () => {
    const source = makeMeltSource(50, [3, 7])
    const grid = await source.compute(makeTileId(), new AbortController().signal)

    expect(grid.dtype).toBe('uint8')
  })
})

describe('MeltRiskSource — test 9: single child — percentile is the value itself', () => {
  it('any percentile of a single value returns that value', async () => {
    for (const pct of [0, 25, 50, 75, 100]) {
      const source = makeMeltSource(pct, [7])
      const grid = await source.compute(makeTileId(), new AbortController().signal)
      expect(grid.data[0]).toBe(7)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// WinterTempSource tests
// ═══════════════════════════════════════════════════════════════════════════

function makeWinterTempSource(percentile, childValues) {
  const childSources = childValues.map(v => makeStubSource(v, 'float32'))
  return new WinterTempSource({
    id: `winter-temp-test-${Date.now()}`,
    childSources,
    percentile,
    transform: TRANSFORM,
    persist: false,
    _store: null,
  })
}

describe('WinterTempSource — test 10: p25 of [-10, -5, 0, 5] = -10', () => {
  it('returns Grid with cell value -10 (lowest quartile temperature)', async () => {
    const source = makeWinterTempSource(25, [-10, -5, 0, 5])
    const grid = await source.compute(makeTileId(), new AbortController().signal)

    expect(grid).not.toBeNull()
    expect(grid.data[0]).toBeCloseTo(-10)
  })
})

describe('WinterTempSource — test 11: p50 of [-8, -4, -1, 2] = -4', () => {
  it('returns Grid with cell value -4 (median temperature)', async () => {
    const source = makeWinterTempSource(50, [-8, -4, -1, 2])
    const grid = await source.compute(makeTileId(), new AbortController().signal)

    expect(grid.data[0]).toBeCloseTo(-4)
  })
})

describe('WinterTempSource — test 12: dtype is float32 (not uint8)', () => {
  it('returned Grid has dtype === "float32"', async () => {
    const source = makeWinterTempSource(50, [-5.5, 3.2])
    const grid = await source.compute(makeTileId(), new AbortController().signal)

    expect(grid.dtype).toBe('float32')
  })
})

describe('WinterTempSource — test 13: preserves negative float values', () => {
  it('single child with negative float value is preserved exactly', async () => {
    const source = makeWinterTempSource(50, [-12.7])
    const grid = await source.compute(makeTileId(), new AbortController().signal)

    expect(grid.data[0]).toBeCloseTo(-12.7)
  })
})
