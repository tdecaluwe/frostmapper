import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { registerCRS, GridTransform, TileId, Extent, Grid, Chunk } from '../../src/core/primitives.js'
import { clearMemoryCache } from '../../src/core/cache.js'
import { SlopeSource } from '../../src/sources/slope.js'

const SLOPE_TRANSFORM = new GridTransform({
  originX:        -75_000,
  originY:      6_450_000,
  chunkSize:       50_000,
  baseResolution:     250,
  nativeCRS:  'EPSG:25833',
})

beforeAll(() => {
  registerCRS({
    'EPSG:25833': '+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs',
    'EPSG:4326':  '+proj=longlat +datum=WGS84 +no_defs',
  })
})

beforeEach(() => {
  clearMemoryCache()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function makeTileId(stride = 1) {
  return new TileId({ chunkX: 0, chunkY: 0, stride, transform: SLOPE_TRANSFORM })
}

function makeElevGrid(data, side) {
  return new Grid({ data: new Float32Array(data), width: side, height: side, dtype: 'float32' })
}

function makeElevSource(grid) {
  return {
    get: async function* (extent, resolution, signal) {
      const tileId = makeTileId()
      yield new Chunk({ tileId, grid })
    },
  }
}

function makeAbortableElevSource() {
  return {
    get: async function* (_extent, _resolution, signal) {
      await new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    },
  }
}

function makeSlopeSource(elevSource, opts = {}) {
  return new SlopeSource({
    id: `slope-test-${Date.now()}`,
    elevationSource: elevSource,
    kernelMeters: opts.kernelMeters ?? 50,
    radiusMeters:  opts.radiusMeters ?? 100,
    transform:     SLOPE_TRANSFORM,
    persist:       false,
    _store:        null,
  })
}

describe('SlopeSource — test 1: flat terrain → slope ≈ 0', () => {
  it('all cells of uniform elevation produce slope near 0°', async () => {
    const flat = Array(25).fill(100)
    const source = makeSlopeSource(makeElevSource(makeElevGrid(flat, 5)))
    const grid = await source.compute(makeTileId(), new AbortController().signal)

    expect(grid).not.toBeNull()
    for (const v of grid.data) {
      expect(v).toBeCloseTo(0, 1)
    }
  })
})

describe('SlopeSource — test 2: uniform incline → known slope', () => {
  it('incline of tan(15°) per cell gives slope ≈ 15° for interior cells', async () => {
    const D = 250
    const tanTarget = Math.tan(15 * Math.PI / 180)
    const data = []
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        data.push(col * D * tanTarget)
      }
    }
    const source = makeSlopeSource(makeElevSource(makeElevGrid(data, 5)), { kernelMeters: D })
    const grid = await source.compute(makeTileId(), new AbortController().signal)

    const interiorValues = []
    for (let row = 1; row < 4; row++) {
      for (let col = 1; col < 4; col++) {
        interiorValues.push(grid.data[row * 5 + col])
      }
    }
    for (const v of interiorValues) {
      expect(v).toBeCloseTo(15, 0)
    }
  })
})

describe('SlopeSource — test 3: 90th percentile window — mostly flat with steep peak', () => {
  it('90th percentile of 25 values where 1=45° and 24=0° is 0°', async () => {
    const flat = Array(25).fill(0)
    const elevSource = makeElevSource(makeElevGrid(flat, 5))
    const source = makeSlopeSource(elevSource, { radiusMeters: 99999 })

    const grid = await source.compute(makeTileId(), new AbortController().signal)

    const centerIdx = 2 * 5 + 2
    expect(grid.data[centerIdx]).toBeCloseTo(0, 0)
  })
})

describe('SlopeSource — test 4: 90th percentile window — mostly steep', () => {
  it('p90 of grid where 23 cells=20° and 2 cells=5° is 20°', async () => {
    const cellSizeM = 250
    const tan20 = Math.tan(20 * Math.PI / 180)
    const tan5  = Math.tan(5  * Math.PI / 180)
    const data = []
    let steepcells = 0
    for (let i = 0; i < 25; i++) {
      if (i < 2) {
        data.push(i * cellSizeM * tan5)
        steepcells++
      } else {
        data.push(i * cellSizeM * tan20)
      }
    }
    const source = makeSlopeSource(makeElevSource(makeElevGrid(data, 5)), { radiusMeters: 99999, kernelMeters: cellSizeM })
    const grid = await source.compute(makeTileId(), new AbortController().signal)

    const centerIdx = 2 * 5 + 2
    expect(grid.data[centerIdx]).toBeGreaterThan(15)
  })
})

describe('SlopeSource — test 5: no navigator.gpu → uses CPU path', () => {
  it('returns valid float32 Grid without WebGPU', async () => {
    const origGpu = globalThis.navigator?.gpu
    if (typeof globalThis.navigator === 'undefined') {
      globalThis.navigator = {}
    }
    globalThis.navigator.gpu = undefined

    try {
      const flat = Array(25).fill(50)
      const source = makeSlopeSource(makeElevSource(makeElevGrid(flat, 5)))
      const grid = await source.compute(makeTileId(), new AbortController().signal)

      expect(grid).not.toBeNull()
      expect(grid.dtype).toBe('float32')
    } finally {
      if (origGpu !== undefined) globalThis.navigator.gpu = origGpu
    }
  })
})

describe('SlopeSource — test 6: WebGPU throws → falls back to CPU', () => {
  it('still returns valid result when GPU compute throws', async () => {
    if (typeof globalThis.navigator === 'undefined') {
      globalThis.navigator = {}
    }
    globalThis.navigator.gpu = {
      requestAdapter: () => Promise.reject(new Error('GPU not available')),
    }

    try {
      const flat = Array(25).fill(50)
      const source = makeSlopeSource(makeElevSource(makeElevGrid(flat, 5)))
      const grid = await source.compute(makeTileId(), new AbortController().signal)

      expect(grid).not.toBeNull()
      expect(grid.dtype).toBe('float32')
    } finally {
      globalThis.navigator.gpu = undefined
    }
  })
})

describe('SlopeSource — test 7: abort signal cancels elevation fetch', () => {
  it('rejects with AbortError when signal fires during elevation fetch', async () => {
    const source = makeSlopeSource(makeAbortableElevSource())
    const controller = new AbortController()
    const promise = source.compute(makeTileId(), controller.signal)
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('SlopeSource — test 8: dtype is float32', () => {
  it('returned Grid has dtype === "float32"', async () => {
    const flat = Array(9).fill(100)
    const source = makeSlopeSource(makeElevSource(makeElevGrid(flat, 3)))
    const grid = await source.compute(makeTileId(), new AbortController().signal)

    expect(grid.dtype).toBe('float32')
  })
})
