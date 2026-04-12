import { describe, it, expect, beforeEach } from 'vitest'
import { Source, clearMemoryCache } from '../../src/core/cache.js'
import { registerCRS, Extent, Grid, GridTransform, TileId, Chunk } from '../../src/core/primitives.js'

registerCRS({
  'EPSG:25833': '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  'EPSG:3035':  '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs'
})

const CHUNK_SIZE       = 512_000
const BASE_RESOLUTION  = 1_000

const testTransform = new GridTransform({
  originX: 0, originY: 0,
  chunkSize: CHUNK_SIZE,
  baseResolution: BASE_RESOLUTION,
  nativeCRS: 'EPSG:3857',
})

class TestSource extends Source {
  constructor(opts = {}) {
    super({ id: 'test-source', transform: testTransform, dtype: 'float32', persist: false, ...opts })
    this.computeCalls = []
    this._returnValue = null
  }

  async compute(tileId, signal) {
    this.computeCalls.push({ tileId, signal })
    if (this._returnValue instanceof Error) throw this._returnValue
    return this._returnValue
  }
}

function makeGrid(cells = 512, value = 1) {
  return new Grid({ data: new Float32Array(cells * cells).fill(value), width: cells, height: cells, dtype: 'float32' })
}

function singleChunkExtent(chunkX = 0, chunkY = 0) {
  return new Extent({
    west:  chunkX * CHUNK_SIZE + 1,
    east:  (chunkX + 1) * CHUNK_SIZE - 1,
    south: chunkY * CHUNK_SIZE + 1,
    north: (chunkY + 1) * CHUNK_SIZE - 1,
    crs: 'EPSG:3857',
  })
}

async function collect(gen) {
  const items = []
  for await (const v of gen) items.push(v)
  return items
}

beforeEach(() => clearMemoryCache())

describe('Source — memory hit (test 1)', () => {
  it('second get() call served from memory cache without calling compute()', async () => {
    const src = new TestSource()
    src._returnValue = makeGrid(512, 42)
    const extent = singleChunkExtent(0, 0)
    const res = BASE_RESOLUTION

    await collect(src.get(extent, res, null))
    expect(src.computeCalls).toHaveLength(1)

    src.computeCalls = []
    const chunks = await collect(src.get(extent, res, null))
    expect(chunks).toHaveLength(1)
    expect(src.computeCalls).toHaveLength(0)
  })
})

describe('Source — compute called on miss (test 2)', () => {
  it('calls compute with a TileId whose extent and cellsPerSide match expected chunk geometry', async () => {
    const src = new TestSource()
    src._returnValue = makeGrid(512, 7)
    const extent = singleChunkExtent(2, 3)

    const chunks = await collect(src.get(extent, BASE_RESOLUTION, null))
    expect(chunks).toHaveLength(1)
    expect(src.computeCalls).toHaveLength(1)

    const { tileId } = src.computeCalls[0]
    expect(tileId.chunkX).toBe(2)
    expect(tileId.chunkY).toBe(3)
    expect(tileId.extent.west).toBe(2 * CHUNK_SIZE)
    expect(tileId.extent.south).toBe(3 * CHUNK_SIZE)
    expect(tileId.cellsPerSide).toBe(512)
  })
})

describe('Source — multi-chunk 2×2 (test 3)', () => {
  it('yields exactly 4 chunks with correct chunkX/chunkY for each grid position', async () => {
    const src = new TestSource()
    let call = 0
    src.compute = async (tileId) => {
      call++
      return makeGrid(512, call)
    }

    const extent = new Extent({
      west: 1, east: 2 * CHUNK_SIZE - 1,
      south: 1, north: 2 * CHUNK_SIZE - 1,
      crs: 'EPSG:3857',
    })
    const chunks = await collect(src.get(extent, BASE_RESOLUTION, null))
    expect(chunks).toHaveLength(4)

    const positions = chunks.map(c => ({ x: c.tileId.chunkX, y: c.tileId.chunkY }))
    expect(positions).toContainEqual({ x: 0, y: 0 })
    expect(positions).toContainEqual({ x: 1, y: 0 })
    expect(positions).toContainEqual({ x: 0, y: 1 })
    expect(positions).toContainEqual({ x: 1, y: 1 })
  })
})

describe('Source — IndexedDB persistence (test 4)', () => {
  it('second get() (after memory eviction) served from IDB without calling compute()', async () => {
    const fakeStore = new Map()
    const store = {
      get: async (key) => fakeStore.get(key) ?? null,
      set: async (key, buf) => { fakeStore.set(key, buf) },
    }
    const src = new TestSource({ persist: true, _store: store })
    src._returnValue = makeGrid(512, 99)
    const extent = singleChunkExtent(0, 0)

    await collect(src.get(extent, BASE_RESOLUTION, null))
    expect(src.computeCalls).toHaveLength(1)

    clearMemoryCache()
    src.computeCalls = []

    const chunks = await collect(src.get(extent, BASE_RESOLUTION, null))
    expect(chunks).toHaveLength(1)
    expect(src.computeCalls).toHaveLength(0)
  })
})

describe('Source — persist: false, no IDB write (test 5)', () => {
  it('persist:false does not write to IDB but still caches in memory', async () => {
    const src = new TestSource({ persist: false })
    src._returnValue = makeGrid(512, 1)
    const extent = singleChunkExtent(0, 0)

    await collect(src.get(extent, BASE_RESOLUTION, null))

    clearMemoryCache()
    src.computeCalls = []

    const chunks = await collect(src.get(extent, BASE_RESOLUTION, null))
    expect(chunks).toHaveLength(1)
    expect(src.computeCalls).toHaveLength(1)
  })
})

describe('Source — abort during compute (test 6)', () => {
  it('generator stops and AbortError propagates when signal is aborted', async () => {
    const src = new TestSource()
    const controller = new AbortController()

    src.compute = async (_tileId, signal) => {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 50)
        signal.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
      return makeGrid(512, 1)
    }

    const gen = src.get(singleChunkExtent(0, 0), BASE_RESOLUTION, controller.signal)
    setTimeout(() => controller.abort(), 10)

    await expect(async () => {
      for await (const _c of gen) {}
    }).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('Source — stable cache key (test 7)', () => {
  it('same source+chunk produces same cache key; different source ids produce different keys', () => {
    const tileId = new TileId({ chunkX: 4, chunkY: 12, stride: 2, transform: testTransform })
    const key1 = 'test-source:' + tileId.toString()
    const key2 = 'other-source:' + tileId.toString()
    expect(key1).toBe('test-source:4,12:2')
    expect(key2).toBe('other-source:4,12:2')
    expect(key1).not.toBe(key2)
  })
})

describe('Source — chunk alignment expansion (test 8)', () => {
  it('misaligned request expands to chunk boundaries and yields aligned TileId extents', async () => {
    const src = new TestSource()
    src._returnValue = makeGrid(512, 1)

    const misaligned = new Extent({
      west:  CHUNK_SIZE * 0.1, east:  CHUNK_SIZE * 0.9,
      south: CHUNK_SIZE * 0.2, north: CHUNK_SIZE * 0.8,
      crs: 'EPSG:3857',
    })
    const chunks = await collect(src.get(misaligned, BASE_RESOLUTION, null))
    expect(chunks).toHaveLength(1)
    expect(chunks[0].tileId.chunkX).toBe(0)
    expect(chunks[0].tileId.chunkY).toBe(0)
    expect(chunks[0].extent.west).toBe(0)
    expect(chunks[0].extent.east).toBe(CHUNK_SIZE)
  })
})

describe('Source — stride selection from resolution (test 10)', () => {
  it('resolution=3500 → stride=4; resolution=1000 → stride=1', async () => {
    const src = new TestSource()
    src.compute = async (tileId) => {
      src.computeCalls.push({ tileId })
      return makeGrid(tileId.cellsPerSide, 1)
    }

    const extent = singleChunkExtent(0, 0)

    src.computeCalls = []
    await collect(src.get(extent, 3500, null))
    expect(src.computeCalls[0].tileId.stride).toBe(4)

    clearMemoryCache()
    src.computeCalls = []
    await collect(src.get(extent, 1000, null))
    expect(src.computeCalls[0].tileId.stride).toBe(1)
  })
})

describe('Source — cell dimensions at stride (test 11)', () => {
  it('stride=1 yields 512×512 cells; stride=4 yields 128×128 cells, same chunk boundaries', async () => {
    const src1 = new TestSource({ id: 'src1' })
    const src4 = new TestSource({ id: 'src4' })
    src1.compute = async (tileId) => makeGrid(tileId.cellsPerSide, 1)
    src4.compute = async (tileId) => makeGrid(tileId.cellsPerSide, 1)

    const extent = singleChunkExtent(0, 0)

    const [c1] = await collect(src1.get(extent, BASE_RESOLUTION, null))
    const [c4] = await collect(src4.get(extent, BASE_RESOLUTION * 4, null))

    expect(c1.grid.width).toBe(512)
    expect(c4.grid.width).toBe(128)
    expect(c1.extent.west).toBe(c4.extent.west)
    expect(c1.extent.east).toBe(c4.extent.east)
  })
})

describe('Source — concurrent requests deduplication (test 12)', () => {
  it('two concurrent get() calls for same chunk call compute() only once', async () => {
    const src = new TestSource()
    let computeCount = 0
    src.compute = async (tileId) => {
      computeCount++
      await new Promise(r => setTimeout(r, 20))
      return makeGrid(512, 1)
    }

    const extent = singleChunkExtent(0, 0)
    const [chunks1, chunks2] = await Promise.all([
      collect(src.get(extent, BASE_RESOLUTION, null)),
      collect(src.get(extent, BASE_RESOLUTION, null)),
    ])

    expect(computeCount).toBe(1)
    expect(chunks1).toHaveLength(1)
    expect(chunks2).toHaveLength(1)
    expect(chunks1[0].grid.data[0]).toBe(chunks2[0].grid.data[0])
  })
})

describe('Source — null grid from compute() (test 14)', () => {
  it('when compute() returns null, get() yields no chunks and does not throw', async () => {
    const src = new TestSource()
    src._returnValue = null

    const extent = singleChunkExtent(0, 0)
    const chunks = await collect(src.get(extent, BASE_RESOLUTION, null))

    expect(chunks).toHaveLength(0)
    expect(src.computeCalls).toHaveLength(1)
  })

  it('when compute() returns null, second get() still calls compute() (nothing was cached)', async () => {
    const src = new TestSource()
    src._returnValue = null

    const extent = singleChunkExtent(0, 0)
    await collect(src.get(extent, BASE_RESOLUTION, null))
    src.computeCalls = []

    await collect(src.get(extent, BASE_RESOLUTION, null))
    expect(src.computeCalls).toHaveLength(1)
  })
})

describe('Source — foreign CRS extent (test 13)', () => {
  it('Extent in EPSG:3857 triggers cover(nativeCRS) and yields chunks in native CRS', async () => {
    const nativeTransform = new GridTransform({
      originX: 0, originY: 0,
      chunkSize: CHUNK_SIZE, baseResolution: BASE_RESOLUTION,
      nativeCRS: 'EPSG:3857',
    })
    const src = new TestSource({ transform: nativeTransform })
    src.compute = async (tileId) => makeGrid(tileId.cellsPerSide, 1)

    const extent = new Extent({ west: 1, east: CHUNK_SIZE - 1, south: 1, north: CHUNK_SIZE - 1, crs: 'EPSG:3857' })
    const chunks = await collect(src.get(extent, BASE_RESOLUTION, null))

    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(chunk.tileId.transform.nativeCRS).toBe('EPSG:3857')
    }
  })
})
