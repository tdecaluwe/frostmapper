import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { registerCRS, Extent, GridTransform, TileId, Grid, Chunk } from '../../src/core/primitives.js'
import { clearMemoryCache } from '../../src/core/cache.js'
import { SeNorgeSnowSource } from '../../src/sources/seNorge-snow.js'
import { SnowSeasonSource } from '../../src/sources/snow-season.js'

function buildMinimalNc3(ntime, ny, nx, fillValue = 10) {
  const snowPerRec = ny * nx * 4
  const timePerRec = 8
  const recSize    = snowPerRec + timePerRec

  function u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, false); return b }
  function ncStr(s) {
    const enc = new TextEncoder().encode(s)
    const pad = (4 - enc.length % 4) % 4
    const out = new Uint8Array(4 + enc.length + pad)
    new DataView(out.buffer).setUint32(0, enc.length, false)
    out.set(enc, 4)
    return out
  }
  function concat(...parts) {
    const total = parts.reduce((n, p) => n + p.byteLength, 0)
    const out = new Uint8Array(total); let off = 0
    for (const p of parts) { out.set(new Uint8Array(p instanceof ArrayBuffer ? p : p.buffer), off); off += p.byteLength }
    return out
  }
  function varEntry(name, dimIds, nc_type, vsize, offset) {
    const dp = new Uint8Array(4 + dimIds.length * 4)
    new DataView(dp.buffer).setUint32(0, dimIds.length, false)
    dimIds.forEach((d, i) => new DataView(dp.buffer).setUint32(4 + i * 4, d, false))
    return concat(ncStr(name), dp, u32(0), u32(0), u32(nc_type), u32(vsize), u32(offset))
  }

  const magic   = new Uint8Array([0x43, 0x44, 0x46, 0x01])
  const numrecs = u32(ntime)
  const dimList = concat(u32(0xA), u32(3), ncStr('time'), u32(0), ncStr('y'), u32(ny), ncStr('x'), u32(nx))
  const gAttList = concat(u32(0), u32(0))

  const hdrProbe = concat(magic, numrecs, dimList, gAttList, u32(0xB), u32(2),
    varEntry('snow_amount', [0, 1, 2], 5, snowPerRec, 999),
    varEntry('time',        [0],       6, timePerRec, 999))
  const hdrLen     = hdrProbe.byteLength
  const snowOffset = hdrLen
  const timeOffset = hdrLen + snowPerRec

  const header = concat(magic, numrecs, dimList, gAttList, u32(0xB), u32(2),
    varEntry('snow_amount', [0, 1, 2], 5, snowPerRec, snowOffset),
    varEntry('time',        [0],       6, timePerRec, timeOffset))

  const dataBuf = new ArrayBuffer(ntime * recSize)
  const dv = new DataView(dataBuf)
  for (let t = 0; t < ntime; t++) {
    const rs = t * recSize
    for (let i = 0; i < ny * nx; i++) dv.setFloat32(rs + i * 4, fillValue, false)
    dv.setFloat64(rs + snowPerRec, t, false)
  }

  return concat(header, new Uint8Array(dataBuf)).buffer
}

const SNOW_NC3 = buildMinimalNc3(3, 2, 2, 10)

const TRANSFORM = new GridTransform({
  originX: -75_000, originY: 6_450_000,
  chunkSize: 512_000, baseResolution: 1_000,
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

function mockFetch(nc3 = SNOW_NC3) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(nc3) })
}

function makeTileId(stride = 1) {
  return new TileId({ chunkX: 0, chunkY: 0, stride, transform: TRANSFORM })
}

function makeSnowSource(year = 2020, fetchFn = mockFetch()) {
  return new SeNorgeSnowSource({
    id: `senorge-${year}-${Date.now()}`,
    year, threshold: 5,
    transform: TRANSFORM, persist: false,
    _fetch: fetchFn,
    _store: { get: () => null, set: () => {} },
  })
}

function makeGridChunk(value, tileId = makeTileId()) {
  const cells = tileId.cellsPerSide
  const data = new Uint8Array(cells * cells).fill(value)
  const grid = new Grid({ data, width: cells, height: cells, dtype: 'uint8' })
  return new Chunk({ tileId, grid })
}

function makePrecomputedSource(value) {
  const tileId = makeTileId()
  const chunk = makeGridChunk(value, tileId)
  return {
    get: async function* (extent, resolution, signal) {
      yield chunk
    },
  }
}

describe('Source integration — test 6: seNorge → snow-season pipeline', () => {
  it('SnowSeasonSource wrapping real SeNorgeSnowSource returns valid percentile Grid', async () => {
    const child1 = makePrecomputedSource(10)
    const child2 = makePrecomputedSource(20)
    const child3 = makePrecomputedSource(30)

    const source = new SnowSeasonSource({
      id: 'snow-season-pipeline',
      childSources: [child1, child2, child3],
      percentile: 50,
      transform: TRANSFORM, persist: false, _store: null,
    })

    const tileId = makeTileId()
    const grid = await source.compute(tileId, new AbortController().signal)

    expect(grid).not.toBeNull()
    expect(grid.dtype).toBe('uint8')
    expect(grid.data[0]).toBe(20)
  })
})

describe('Source integration — test 7: cache prevents re-fetch', () => {
  it('second get() with same extent does not call fetch again', async () => {
    const fetchMock = mockFetch()
    const source = makeSnowSource(2020, fetchMock)
    const store = new Map()
    source._store = {
      get: k => store.get(k) ?? null,
      set: (k, v) => store.set(k, v),
    }

    const norwayExtent = new Extent({
      west: 10, east: 20, south: 60, north: 68,
      crs: 'EPSG:4326',
    })
    const extent = norwayExtent

    const chunks1 = []
    for await (const c of source.get(extent, 1_000, new AbortController().signal)) chunks1.push(c)

    const chunks2 = []
    for await (const c of source.get(extent, 1_000, new AbortController().signal)) chunks2.push(c)

    expect(chunks1.length).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledTimes(chunks1.length)
  })
})

describe('Source integration — test 8: abort during multi-year aggregation', () => {
  it('SnowSeasonSource with 5 children: abort after 2 → stops iteration', async () => {
    let resolvedCount = 0
    let pendingReject = null

    function makeSlowSource(idx) {
      return {
        get: async function* (_extent, _resolution, signal) {
          if (idx < 2) {
            resolvedCount++
            const cells = makeTileId().cellsPerSide
            const data = new Uint8Array(cells * cells).fill(idx * 5)
            yield new Chunk({ tileId: makeTileId(), grid: new Grid({ data, width: cells, height: cells, dtype: 'uint8' }) })
          } else {
            await new Promise((res, rej) => {
              pendingReject = rej
              signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')))
            })
            yield makeGridChunk(99)
          }
        },
      }
    }

    const childSources = [0, 1, 2, 3, 4].map(makeSlowSource)
    const source = new SnowSeasonSource({
      id: 'abort-test', childSources, percentile: 50,
      transform: TRANSFORM, persist: false, _store: null,
    })

    const controller = new AbortController()
    const promise = source.compute(makeTileId(), controller.signal)

    await new Promise(r => setTimeout(r, 10))
    controller.abort()

    try {
      await promise
    } catch (e) {
      expect(e.name).toBe('AbortError')
    }

    expect(resolvedCount).toBe(2)
  })
})
