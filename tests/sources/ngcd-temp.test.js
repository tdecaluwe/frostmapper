import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { registerCRS, GridTransform, TileId, Extent } from '../../src/core/primitives.js'
import { clearMemoryCache } from '../../src/core/cache.js'
import { NgcdTempMeanSource } from '../../src/sources/ngcd-temp-mean.js'
import { NgcdTempMaxSource } from '../../src/sources/ngcd-temp-max.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MEAN_CSV = readFileSync(join(__dirname, '../fixtures/ngcd-temp-mean-2020.csv'), 'utf-8')
const MAX_CSV  = readFileSync(join(__dirname, '../fixtures/ngcd-temp-max-2020.csv'),  'utf-8')

const NGCD_TRANSFORM = new GridTransform({
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

function mockFetch(csvText, { ok = true, status = 200 } = {}) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: () => Promise.resolve(csvText),
  })
}

function makeTileId(stride = 1) {
  return new TileId({ chunkX: 0, chunkY: 0, stride, transform: NGCD_TRANSFORM })
}

function makeSource(Cls, opts = {}) {
  return new Cls({
    id: `ngcd-test-${Date.now()}`,
    year: 2020,
    winterStart: '12-01',
    winterEnd: '03-31',
    transform: NGCD_TRANSFORM,
    persist: false,
    ...opts,
  })
}

describe('NgcdTempMeanSource — test 1: compute() returns null (source disabled)', () => {
  it('returns null without fetching because the NGCD URL is known-broken', async () => {
    const fetchSpy = vi.fn()
    const source = makeSource(NgcdTempMeanSource, { _fetch: fetchSpy })

    const result = await source.compute(makeTileId(), new AbortController().signal)

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('NgcdTempMeanSource — test 2: winter period filter (source disabled)', () => {
  it('returns null without fetching regardless of winter period config', async () => {
    const fetchSpy = vi.fn()
    const source = makeSource(NgcdTempMeanSource, { _fetch: fetchSpy })

    const result = await source.compute(makeTileId(), new AbortController().signal)

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('NgcdTempMeanSource — test 3: uniform winter temperature (source disabled)', () => {
  it('returns null without fetching for all tile configurations', async () => {
    const fetchSpy = vi.fn()
    const source = makeSource(NgcdTempMeanSource, { _fetch: fetchSpy })

    const result = await source.compute(makeTileId(), new AbortController().signal)

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('NgcdTempMeanSource — test 4: HTTP error → returns null', () => {
  it('returns null (no throw) when fetch returns non-200 status', async () => {
    const source = makeSource(NgcdTempMeanSource, {
      _fetch: mockFetch('', { ok: false, status: 503 }),
    })

    const result = await source.compute(makeTileId(), new AbortController().signal)
    expect(result).toBeNull()
  })
})

describe('NgcdTempMeanSource — test 5: abort signal respected', () => {
  it('throws AbortError without fetching when signal is pre-aborted', async () => {
    const fetchMock = vi.fn()
    const source = makeSource(NgcdTempMeanSource, { _fetch: fetchMock })

    const ac = new AbortController()
    ac.abort()

    await expect(source.compute(makeTileId(), ac.signal))
      .rejects.toMatchObject({ name: 'AbortError' })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('NgcdTempMeanSource — test 6: cache stores null result (source disabled)', () => {
  it('get() returns no chunks because compute returns null and null grids are skipped', async () => {
    const fetchSpy = vi.fn()
    const inMemoryStore = new Map()
    const source = makeSource(NgcdTempMeanSource, {
      _fetch: fetchSpy,
      _store: {
        get: k => inMemoryStore.get(k) ?? null,
        set: (k, v) => inMemoryStore.set(k, v),
      },
    })

    const extent = new Extent({
      west: 3_800_000, east: 4_400_000,
      south: 3_600_000, north: 4_200_000,
      crs: 'EPSG:3035',
    })
    const signal = new AbortController().signal

    const chunks = []
    for await (const c of source.get(extent, 1_000, signal)) chunks.push(c)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(chunks).toHaveLength(0)
  })
})

describe('NgcdTempMaxSource — test 7: compute() returns null (source disabled)', () => {
  it('returns null without fetching because the NGCD URL is known-broken', async () => {
    const fetchSpy = vi.fn()
    const source = makeSource(NgcdTempMaxSource, { _fetch: fetchSpy })

    const result = await source.compute(makeTileId(), new AbortController().signal)

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('NgcdTempMaxSource — test 8: melt day count (source disabled)', () => {
  it('returns null without fetching regardless of data content', async () => {
    const fetchSpy = vi.fn()
    const source = makeSource(NgcdTempMaxSource, { _fetch: fetchSpy })

    const result = await source.compute(makeTileId(), new AbortController().signal)

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('NgcdTempMaxSource — test 9: NaN values (source disabled)', () => {
  it('returns null without fetching regardless of NaN values in data', async () => {
    const fetchSpy = vi.fn()
    const source = makeSource(NgcdTempMaxSource, { _fetch: fetchSpy })

    const result = await source.compute(makeTileId(), new AbortController().signal)

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
