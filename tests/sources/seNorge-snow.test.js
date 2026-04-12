import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { registerCRS, GridTransform, TileId, Extent } from '../../src/core/primitives.js'
import { clearMemoryCache } from '../../src/core/cache.js'
import { SeNorgeSnowSource } from '../../src/sources/seNorge-snow.js'

// ---------------------------------------------------------------------------
// NetCDF3 binary builder — creates minimal valid CDF-1 files for testing.
// Layout: dims(time=record, y, x), vars: snow_amount(time,y,x):float32,
//         time(time):float64. All big-endian, no attributes.
// ---------------------------------------------------------------------------
function buildNc3(ntime, ny, nx, snowValues) {
  // snowValues: Float32Array or Array of length ntime*ny*nx, row-major [t,y,x]
  const snowPerRec = ny * nx * 4  // bytes per record for snow_amount (float32)
  const timePerRec = 8             // bytes per record for time (float64)
  const recSize    = snowPerRec + timePerRec

  function uint32(v) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, v >>> 0, false)
    return b
  }

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
    const out = new Uint8Array(total)
    let off = 0
    for (const p of parts) { out.set(new Uint8Array(p instanceof ArrayBuffer ? p : p.buffer), off); off += p.byteLength }
    return out
  }

  // Header parts
  const magic    = new Uint8Array([0x43, 0x44, 0x46, 0x01]) // CDF\x01
  const numrecs  = uint32(ntime)

  // dim_list: NC_DIMENSION (0xA), count=3
  const dimList = concat(
    uint32(0xA), uint32(3),
    ncStr('time'), uint32(0),   // record dim
    ncStr('y'),    uint32(ny),
    ncStr('x'),    uint32(nx),
  )

  // global att_list: absent (0,0)
  const gAttList = concat(uint32(0), uint32(0))

  // var_list skeleton — we need header length to compute offsets
  function varEntry(name, dimIds, nc_type, vsize, offset) {
    const dimPart = new Uint8Array(4 + dimIds.length * 4)
    new DataView(dimPart.buffer).setUint32(0, dimIds.length, false)
    dimIds.forEach((d, i) => new DataView(dimPart.buffer).setUint32(4 + i * 4, d, false))
    return concat(
      ncStr(name),
      dimPart,
      uint32(0), uint32(0), // empty att_list
      uint32(nc_type),
      uint32(vsize),
      uint32(offset),
    )
  }

  // Compute header length with placeholder offsets (999)
  const hdrProbe = concat(
    magic, numrecs, dimList, gAttList,
    uint32(0xB), uint32(2),
    varEntry('snow_amount', [0, 1, 2], 5, snowPerRec, 999),
    varEntry('time',        [0],       6, timePerRec, 999),
  )
  const hdrLen      = hdrProbe.byteLength
  const snowOffset  = hdrLen
  const timeOffset  = hdrLen + snowPerRec

  // Build real header with correct offsets
  const header = concat(
    magic, numrecs, dimList, gAttList,
    uint32(0xB), uint32(2),
    varEntry('snow_amount', [0, 1, 2], 5, snowPerRec, snowOffset),
    varEntry('time',        [0],       6, timePerRec, timeOffset),
  )

  // Build interleaved record data
  const dataBuf = new ArrayBuffer(ntime * recSize)
  const dv      = new DataView(dataBuf)
  for (let t = 0; t < ntime; t++) {
    const recStart = t * recSize
    for (let i = 0; i < ny * nx; i++) {
      dv.setFloat32(recStart + i * 4, snowValues[t * ny * nx + i], false)
    }
    dv.setFloat64(recStart + snowPerRec, t, false) // time value = t
  }

  return concat(header, new Uint8Array(dataBuf)).buffer
}

// ---------------------------------------------------------------------------
// Mock fetch helpers
// ---------------------------------------------------------------------------
function mockFetchNc3(arrayBuffer, { ok = true, status = 200 } = {}) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    arrayBuffer: () => Promise.resolve(arrayBuffer),
  })
}

function mockFetchError({ ok = false, status = 503 } = {}) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  })
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const SENORGE_TRANSFORM = new GridTransform({
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

beforeEach(() => { clearMemoryCache() })

function makeTileId(chunkX = 0, chunkY = 0, stride = 1) {
  return new TileId({ chunkX, chunkY, stride, transform: SENORGE_TRANSFORM })
}

function makeNorwayTile(stride = 1) {
  return {
    stride,
    extent: {
      toBoundingBox: () => ({ west: 10, east: 20, south: 60, north: 68 }),
    },
  }
}

function makeSource(opts = {}) {
  return new SeNorgeSnowSource({
    id: `seNorge-test-${Date.now()}`,
    year: 2020,
    threshold: 5,
    transform: SENORGE_TRANSFORM,
    dtype: 'uint8',
    persist: false,
    ...opts,
  })
}

// ---------------------------------------------------------------------------
// test 1: correct URL is built for the seNorge_snow/fsw dataset
// ---------------------------------------------------------------------------
describe('SeNorgeSnowSource — test 1: URL targets senorge/seNorge_snow/fsw/{year}.nc', () => {
  it('fetches from the correct seNorge_snow/fsw path with snow_amount variable', async () => {
    const nc3 = buildNc3(1, 1, 1, [0.0])
    const fetchMock = mockFetchNc3(nc3)
    const source = makeSource({ year: 2023, _fetch: fetchMock })

    await source.compute(makeNorwayTile(), new AbortController().signal)

    const url = fetchMock.mock.calls[0][0]
    expect(url).toContain('senorge/seNorge_snow/fsw/fsw_2023.nc')
    expect(url).toContain('var=snow_amount')
    expect(url).toContain('accept=netCDF')
  })
})

// ---------------------------------------------------------------------------
// test 2: longest consecutive run — gap resets counter
// ---------------------------------------------------------------------------
describe('SeNorgeSnowSource — test 2: longest consecutive run — gap resets counter', () => {
  it('sequence [8,8,0,8,8,8,0,8,0,8] with threshold=5 gives longest run=3', async () => {
    const values = [8, 8, 0, 8, 8, 8, 0, 8, 0, 8]
    const nc3 = buildNc3(10, 1, 1, values)
    const source = makeSource({ threshold: 5, _fetch: mockFetchNc3(nc3) })

    const grid = await source.compute(makeNorwayTile(), new AbortController().signal)
    expect(grid.data[0]).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// test 3: all days below threshold → all zeros
// ---------------------------------------------------------------------------
describe('SeNorgeSnowSource — test 3: all days below threshold → all zeros', () => {
  it('returns a Grid with all zero values when no day meets the threshold', async () => {
    const values = [0, 2, 4.9, 0, 1]
    const nc3 = buildNc3(5, 1, 1, values)
    const source = makeSource({ threshold: 5, _fetch: mockFetchNc3(nc3) })

    const grid = await source.compute(makeNorwayTile(), new AbortController().signal)
    expect(Array.from(grid.data).every(v => v === 0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// test 4: season length capped at 255
// ---------------------------------------------------------------------------
describe('SeNorgeSnowSource — test 4: season length capped at 255', () => {
  it('a run longer than 255 days is stored as 255 in the Uint8 grid', async () => {
    const values = new Array(300).fill(10)
    const nc3 = buildNc3(300, 1, 1, values)
    const source = makeSource({ threshold: 5, _fetch: mockFetchNc3(nc3) })

    const grid = await source.compute(makeNorwayTile(), new AbortController().signal)
    expect(grid.data[0]).toBe(255)
  })
})

// ---------------------------------------------------------------------------
// test 5: HTTP error → returns null (no throw)
// ---------------------------------------------------------------------------
describe('SeNorgeSnowSource — test 5: HTTP error → returns null', () => {
  it('returns null (no throw) when fetch returns non-200 status', async () => {
    const source = makeSource({ _fetch: mockFetchError({ ok: false, status: 503 }) })

    const result = await source.compute(makeNorwayTile(), new AbortController().signal)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// test 6: abort propagates
// ---------------------------------------------------------------------------
describe('SeNorgeSnowSource — test 6: abort propagates', () => {
  it('throws AbortError immediately without fetching when signal is pre-aborted', async () => {
    const fetchMock = vi.fn()
    const source = makeSource({ _fetch: fetchMock })

    const ac = new AbortController()
    ac.abort()

    await expect(source.compute(makeTileId(), ac.signal))
      .rejects.toMatchObject({ name: 'AbortError' })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// test 7: multi-cell grid — each cell computed independently
// ---------------------------------------------------------------------------
describe('SeNorgeSnowSource — test 7: multi-cell grid — each cell computed independently', () => {
  it('returns Grid with correct run lengths per cell in a 2×2 grid', async () => {
    const nc3 = buildNc3(3, 2, 2, [
      10, 0, 10, 10,
      10, 0,  0, 10,
      10, 0, 10,  0,
    ])
    const source = makeSource({ threshold: 5, _fetch: mockFetchNc3(nc3) })

    const grid = await source.compute(makeNorwayTile(), new AbortController().signal)

    expect(grid.dtype).toBe('uint8')
    // Cell order: row-major y×x
    // (y0,x0): [10,10,10] → 3
    // (y0,x1): [0,0,0]    → 0
    // (y1,x0): [10,0,10]  → 1
    // (y1,x1): [10,10,0]  → 2
    expect(Array.from(grid.data)).toEqual(expect.arrayContaining([3, 0, 1, 2]))
    expect(grid.data[0]).toBe(3)
    expect(grid.data[1]).toBe(0)
    expect(grid.data[2]).toBe(1)
    expect(grid.data[3]).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// test 8: netCDF3 parser extracts snow_amount correctly
// ---------------------------------------------------------------------------
describe('SeNorgeSnowSource — test 8: netCDF3 binary correctly parsed from arrayBuffer', () => {
  it('reads float32 snow_amount values from netCDF3 binary and applies threshold', async () => {
    const nc3 = buildNc3(2, 1, 1, [6.0, 3.0])
    const source = makeSource({ threshold: 5, _fetch: mockFetchNc3(nc3) })

    const grid = await source.compute(makeNorwayTile(), new AbortController().signal)

    expect(grid).not.toBeNull()
    expect(grid.dtype).toBe('uint8')
    expect(grid.data[0]).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// test 9: get() uses cache on second call
// ---------------------------------------------------------------------------
describe('SeNorgeSnowSource — test 9: get() uses cache on second call', () => {
  it('fetch called only once when get() invoked twice for same extent and resolution', async () => {
    const nc3 = buildNc3(3, 2, 2, new Array(12).fill(8))
    const fetchMock = mockFetchNc3(nc3)
    const inMemoryStore = new Map()
    const source = makeSource({
      _fetch: fetchMock,
      _store: {
        get: (k) => inMemoryStore.get(k) ?? null,
        set: (k, v) => inMemoryStore.set(k, v),
      },
    })

    const extent = new Extent({
      west: 3_800_000, east: 4_400_000,
      south: 3_600_000, north: 4_200_000,
      crs: 'EPSG:3035',
    })
    const signal = new AbortController().signal

    const chunks1 = []
    for await (const chunk of source.get(extent, 1_000, signal)) chunks1.push(chunk)

    const chunks2 = []
    for await (const chunk of source.get(extent, 1_000, signal)) chunks2.push(chunk)

    expect(chunks1.length).toBeGreaterThan(0)
    expect(chunks2.length).toBe(chunks1.length)
    expect(fetchMock).toHaveBeenCalledTimes(chunks1.length)
  })
})

// ---------------------------------------------------------------------------
// test 10: tile outside Norway coverage — no fetch fired
// ---------------------------------------------------------------------------
describe('SeNorgeSnowSource — test 10: tile outside Norway coverage → no fetch', () => {
  it('returns null without fetching when tile bbox is entirely outside Norway coverage', async () => {
    const fetchSpy = vi.fn()
    const source = makeSource({ _fetch: fetchSpy })

    const outsideTile = {
      stride: 1,
      extent: {
        toBoundingBox: () => ({ west: -30, east: -20, south: 40, north: 50 }),
      },
    }

    const result = await source.compute(outsideTile, new AbortController().signal)

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
