import { describe, it, expect, beforeAll, vi } from 'vitest'
import { registerCRS, GridTransform, TileId, Grid, Chunk } from '../../src/core/primitives.js'
import { SnowSeasonLayer } from '../../src/layers/snow-season.js'
import { WinterTempLayer } from '../../src/layers/winter-temp.js'
import { MeltRiskLayer } from '../../src/layers/melt-risk.js'
import { SlopeLayer } from '../../src/layers/slope.js'

beforeAll(() => {
  registerCRS({
    'EPSG:3857': '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +no_defs',
    'EPSG:3035': '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs',
  })
})

const TRANSFORM = new GridTransform({
  originX: -75_000, originY: 6_450_000,
  chunkSize: 512_000, baseResolution: 1_000,
  nativeCRS: 'EPSG:3035',
})

function makeChunk() {
  const tileId = new TileId({ chunkX: 0, chunkY: 0, stride: 1, transform: TRANSFORM })
  const cells = tileId.cellsPerSide
  const grid = new Grid({ data: new Uint8Array(cells * cells).fill(10), width: cells, height: cells, dtype: 'uint8' })
  return new Chunk({ tileId, grid })
}

function makeMockRenderer() {
  const upload = vi.fn().mockReturnValue(() => {})
  return { upload, _map: { triggerRepaint: vi.fn() } }
}

function makeViewport(zoom = 12) {
  return {
    north: 8_500_000, south: 8_400_000, east: 1_600_000, west: 1_500_000,
    zoom, widthPx: 1024, heightPx: 1024, crs: 'EPSG:3857',
    resolution: () => 100,
    width: () => 100_000,
    height: () => 100_000,
    center: () => ({ x: 1_550_000, y: 8_450_000 }),
  }
}

describe('SnowSeasonLayer — test 1: layerType returns soft-filter', () => {
  it('layerType is "soft-filter"', () => {
    const layer = new SnowSeasonLayer({
      id: 'snow-season', source: null, renderer: makeMockRenderer(),
      params: { valueRange: { from: 0, to: 180 } },
    })
    expect(layer.layerType).toBe('soft-filter')
  })
})

describe('SnowSeasonLayer — test 2: hue returns 200', () => {
  it('hue is 200', () => {
    const layer = new SnowSeasonLayer({
      id: 'snow-season', source: null, renderer: makeMockRenderer(),
      params: {},
    })
    expect(layer.hue).toBe(200)
  })
})

describe('SnowSeasonLayer — test 3: valueRange reads from params reactively', () => {
  it('reflects mutations to params.valueRange', () => {
    const params = { valueRange: { from: 0, to: 180 } }
    const layer = new SnowSeasonLayer({
      id: 'snow-season', source: null, renderer: makeMockRenderer(), params,
    })

    expect(layer.valueRange).toEqual({ from: 0, to: 180 })
    params.valueRange = { from: 10, to: 200 }
    expect(layer.valueRange).toEqual({ from: 10, to: 200 })
  })
})

describe('SnowSeasonLayer — test 4: update() uploads chunks to renderer', () => {
  it('renderer.upload called once for one chunk', async () => {
    const chunk = makeChunk()
    const mockSource = { async *get() { yield chunk } }
    const renderer = makeMockRenderer()

    const layer = new SnowSeasonLayer({
      id: 'snow-season', source: mockSource, renderer,
      params: { valueRange: { from: 0, to: 180 } },
    })

    await layer.update(makeViewport(), new AbortController().signal)

    expect(renderer.upload).toHaveBeenCalledTimes(1)
    const [grid, vertices, getParams] = renderer.upload.mock.calls[0]
    expect(grid).toBeInstanceOf(Grid)
    expect(vertices).toBeInstanceOf(Float32Array)
    expect(typeof getParams).toBe('function')
    expect(getParams().hue).toBe(200)
    expect(getParams().layerType).toBe('soft-filter')
  })
})

describe('WinterTempLayer — test 5: layerType returns soft-filter', () => {
  it('layerType is "soft-filter"', () => {
    const layer = new WinterTempLayer({
      id: 'winter-temp', source: null, renderer: makeMockRenderer(),
      params: { valueRange: { from: 0, to: -20 } },
    })
    expect(layer.layerType).toBe('soft-filter')
  })
})

describe('WinterTempLayer — test 6: hue returns 30', () => {
  it('hue is 30', () => {
    const layer = new WinterTempLayer({
      id: 'winter-temp', source: null, renderer: makeMockRenderer(),
      params: {},
    })
    expect(layer.hue).toBe(30)
  })
})

describe('WinterTempLayer — test 7: inverted valueRange handled correctly', () => {
  it('valueRange from: 0, to: -20 returned from params', () => {
    const params = { valueRange: { from: 0, to: -20 } }
    const layer = new WinterTempLayer({
      id: 'winter-temp', source: null, renderer: makeMockRenderer(), params,
    })
    expect(layer.valueRange).toEqual({ from: 0, to: -20 })
  })
})

describe('MeltRiskLayer — test 8: layerType returns soft-filter', () => {
  it('layerType is "soft-filter"', () => {
    const layer = new MeltRiskLayer({
      id: 'melt-risk', source: null, renderer: makeMockRenderer(),
      params: { valueRange: { from: 0, to: 30 } },
    })
    expect(layer.layerType).toBe('soft-filter')
  })
})

describe('MeltRiskLayer — test 9: hue returns 0', () => {
  it('hue is 0', () => {
    const layer = new MeltRiskLayer({
      id: 'melt-risk', source: null, renderer: makeMockRenderer(),
      params: {},
    })
    expect(layer.hue).toBe(0)
  })
})

describe('MeltRiskLayer — test 10: valueRange reads from params', () => {
  it('returns params.valueRange', () => {
    const params = { valueRange: { from: 0, to: 30 } }
    const layer = new MeltRiskLayer({
      id: 'melt-risk', source: null, renderer: makeMockRenderer(), params,
    })
    expect(layer.valueRange).toEqual({ from: 0, to: 30 })
  })
})

describe('SlopeLayer — test 11: layerType returns hard-filter', () => {
  it('layerType is "hard-filter"', () => {
    const layer = new SlopeLayer({
      id: 'slope', source: null, renderer: makeMockRenderer(),
      params: { slopeThreshold: 15 },
    })
    expect(layer.layerType).toBe('hard-filter')
  })
})

describe('SlopeLayer — test 12: threshold reads from params reactively', () => {
  it('reflects mutations to params.slopeThreshold', () => {
    const params = { slopeThreshold: 15 }
    const layer = new SlopeLayer({
      id: 'slope', source: null, renderer: makeMockRenderer(), params,
    })

    expect(layer.threshold).toBe(15)
    params.slopeThreshold = 20
    expect(layer.threshold).toBe(20)
  })
})

describe('SlopeLayer — test 13: update() is no-op below zoom 10', () => {
  it('renderer.upload NOT called when viewport.zoom < 10', async () => {
    const chunk = makeChunk()
    const mockSource = { async *get() { yield chunk } }
    const renderer = makeMockRenderer()

    const layer = new SlopeLayer({
      id: 'slope', source: mockSource, renderer,
      params: { slopeThreshold: 15 },
    })

    await layer.update(makeViewport(9), new AbortController().signal)

    expect(renderer.upload).not.toHaveBeenCalled()
  })
})

describe('SlopeLayer — test 14: update() runs at zoom 10', () => {
  it('renderer.upload called when viewport.zoom >= 10', async () => {
    const chunk = makeChunk()
    const mockSource = { async *get() { yield chunk } }
    const renderer = makeMockRenderer()

    const layer = new SlopeLayer({
      id: 'slope', source: mockSource, renderer,
      params: { slopeThreshold: 15 },
    })

    await layer.update(makeViewport(10), new AbortController().signal)

    expect(renderer.upload).toHaveBeenCalledTimes(1)
  })
})
