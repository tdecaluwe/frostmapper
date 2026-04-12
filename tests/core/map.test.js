/**
 * tests/core/map.test.js
 *
 * Unit tests for MapManager in core/map.js
 * Tests spec cases 1–10.
 *
 * All tests use a mock MapLibre constructor — no real WebGL context needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MapManager, tileBounds, PROVIDER_COVERAGE } from '../../src/core/map.js'
import { Viewport } from '../../src/core/primitives.js'

// ---------------------------------------------------------------------------
// Mock MapLibre constructor and map instance
// ---------------------------------------------------------------------------

function makeMockMap(opts = {}) {
  let _center = opts.center ?? [15, 65]
  let _zoom   = opts.zoom   ?? 5
  const handlers = {}

  return {
    on:   vi.fn((event, fn) => { handlers[event] = handlers[event] ?? []; handlers[event].push(fn) }),
    off:  vi.fn((event, fn) => { if (handlers[event]) handlers[event] = handlers[event].filter(h => h !== fn) }),
    fire: (event) => { (handlers[event] ?? []).forEach(fn => fn()) },
    addLayer:    vi.fn(),
    removeLayer: vi.fn(),
    getLayer:    vi.fn(id => undefined),
    addSource:   vi.fn(),
    remove:      vi.fn(),
    getBounds: vi.fn(() => ({
      getNorth: () =>  66,
      getSouth: () =>  64,
      getEast:  () =>  16,
      getWest:  () =>  14,
    })),
    getZoom: vi.fn(() => _zoom),
    getContainer: vi.fn(() => ({ clientWidth: 1024, clientHeight: 768 })),
    _handlers: handlers,
  }
}

let mockMapInstance
let MockMapLibre

beforeEach(() => {
  mockMapInstance = makeMockMap()
  MockMapLibre = vi.fn(() => mockMapInstance)
  MockMapLibre.addProtocol = vi.fn()
})

function makeManager(extraOpts = {}) {
  return new MapManager({
    container: 'map',
    MapLibre: MockMapLibre,
    ...extraOpts,
  })
}

// ---------------------------------------------------------------------------
// Test 1: Construction with mock MapLibre
// ---------------------------------------------------------------------------

describe('MapManager — test 1: construction', () => {
  it('constructs without error and does not register a composite:// protocol handler', () => {
    expect(() => makeManager()).not.toThrow()
    expect(MockMapLibre.addProtocol).not.toHaveBeenCalledWith('composite', expect.any(Function))
  })
})

// ---------------------------------------------------------------------------
// Test 2: Viewport emission
// ---------------------------------------------------------------------------

describe('MapManager — test 2: viewport emission', () => {
  it('onViewportChange callback receives a Viewport on moveend', () => {
    const mgr = makeManager()
    let received = null
    mgr.onViewportChange(vp => { received = vp })

    mockMapInstance.fire('moveend')

    expect(received).toBeInstanceOf(Viewport)
    expect(received.west).toBeCloseTo(1558472.87, 0)
    expect(received.south).toBeCloseTo(9349764.17, 0)
    expect(received.east).toBeCloseTo(1781111.85, 0)
    expect(received.north).toBeCloseTo(9876845.90, 0)
    expect(received.zoom).toBe(5)
    expect(received.widthPx).toBe(1024)
    expect(received.heightPx).toBe(768)
  })
})

// ---------------------------------------------------------------------------
// Test 3: Multiple subscribers
// ---------------------------------------------------------------------------

describe('MapManager — test 3: multiple subscribers', () => {
  it('calls all subscribers; unsubscribe removes only that one', () => {
    const mgr = makeManager()
    const calls1 = []
    const calls2 = []

    const unsub1 = mgr.onViewportChange(vp => calls1.push(vp))
    mgr.onViewportChange(vp => calls2.push(vp))

    mockMapInstance.fire('moveend')
    expect(calls1).toHaveLength(1)
    expect(calls2).toHaveLength(1)

    unsub1()
    mockMapInstance.fire('moveend')
    expect(calls1).toHaveLength(1)  // no new call
    expect(calls2).toHaveLength(2)  // still receiving
  })
})

// ---------------------------------------------------------------------------
// Test 4: addDataLayer
// ---------------------------------------------------------------------------

describe('MapManager — test 4: addDataLayer', () => {
  it('calls map.addLayer with the custom layer object', () => {
    const mgr = makeManager()
    const layer = { id: 'snow', type: 'custom', onAdd: vi.fn(), render: vi.fn(), onRemove: vi.fn() }
    mgr.addDataLayer(layer)
    expect(mockMapInstance.addLayer).toHaveBeenCalledWith(layer)
  })
})

// ---------------------------------------------------------------------------
// Test 5: addDataLayer deduplication
// ---------------------------------------------------------------------------

describe('MapManager — test 5: addDataLayer deduplication', () => {
  it('removes existing layer before re-adding', () => {
    const mgr = makeManager()
    mockMapInstance.getLayer = vi.fn().mockReturnValue({ id: 'snow' })  // already exists

    const layer = { id: 'snow', type: 'custom', onAdd: vi.fn(), render: vi.fn() }
    mgr.addDataLayer(layer)

    expect(mockMapInstance.removeLayer).toHaveBeenCalledWith('snow')
    expect(mockMapInstance.addLayer).toHaveBeenCalledWith(layer)
  })
})

// ---------------------------------------------------------------------------
// Test 6: removeDataLayer
// ---------------------------------------------------------------------------

describe('MapManager — test 6: removeDataLayer', () => {
  it('calls removeLayer with correct id', () => {
    const mgr = makeManager()
    mockMapInstance.getLayer = vi.fn().mockReturnValue({ id: 'snow' })
    mgr.removeDataLayer('snow')
    expect(mockMapInstance.removeLayer).toHaveBeenCalledWith('snow')
  })

  it('no-op when layer not found', () => {
    const mgr = makeManager()
    mockMapInstance.getLayer = vi.fn().mockReturnValue(undefined)
    mgr.removeDataLayer('nonexistent')
    expect(mockMapInstance.removeLayer).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Test 7: Protocol handler — in coverage
// ---------------------------------------------------------------------------

describe('MapManager — test 7: basemap style uses native MapLibre sources', () => {
  it('style sources contain opentopomap and kartverket, not composite', () => {
    const mgr = makeManager()
    const style = mgr._buildStyle()
    expect(style.sources).toHaveProperty('opentopomap')
    expect(style.sources).toHaveProperty('kartverket')
    expect(style.sources).not.toHaveProperty('basemap')
  })
})

// ---------------------------------------------------------------------------
// Test 8: basemap kartverket source sits above opentopomap
// ---------------------------------------------------------------------------

describe('MapManager — test 8: kartverket layer renders above opentopomap', () => {
  it('basemap-opentopomap appears before basemap-kartverket in layers array', () => {
    const mgr = makeManager()
    const style = mgr._buildStyle()
    const ids = style.layers.map(l => l.id)
    const otmIdx = ids.indexOf('basemap-opentopomap')
    const kvIdx  = ids.indexOf('basemap-kartverket')
    expect(otmIdx).toBeGreaterThanOrEqual(0)
    expect(kvIdx).toBeGreaterThanOrEqual(0)
    expect(otmIdx).toBeLessThan(kvIdx)
  })
})

// ---------------------------------------------------------------------------
// Test 9: no composite:// protocol handler is registered on construction
// ---------------------------------------------------------------------------

describe('MapManager — test 9: no composite:// protocol handler registered', () => {
  it('does not call addProtocol with composite during construction', () => {
    makeManager()
    const compositeCalls = MockMapLibre.addProtocol.mock.calls.filter(c => c[0] === 'composite')
    expect(compositeCalls).toHaveLength(0)
  })
})


// ---------------------------------------------------------------------------
// Test 10: destroy
// ---------------------------------------------------------------------------

describe('MapManager — test 10: destroy', () => {
  it('calls map.remove() and subsequent move events do not fire callbacks', () => {
    const mgr = makeManager()
    let callCount = 0
    mgr.onViewportChange(() => callCount++)

    mgr.destroy()
    expect(mockMapInstance.remove).toHaveBeenCalled()

    mockMapInstance.fire('moveend')
    expect(callCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Test 11: preserveDrawingBuffer
// ---------------------------------------------------------------------------

describe('MapManager — test 11: preserveDrawingBuffer', () => {
  it('passes preserveDrawingBuffer via canvasContextAttributes to the MapLibre constructor', () => {
    makeManager()
    const opts = MockMapLibre.mock.calls[0][0]
    expect(opts.canvasContextAttributes?.preserveDrawingBuffer).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test 12: viewport fires on moveend, NOT on move
// ---------------------------------------------------------------------------

describe('MapManager — test 12: viewport fires on moveend not move', () => {
  it('subscribes to moveend (not move) so viewport updates only after pan completes', () => {
    makeManager()
    const onCalls = mockMapInstance.on.mock.calls.map(c => c[0])
    expect(onCalls).toContain('moveend')
    expect(onCalls).not.toContain('move')
  })

  it('subscriber is NOT called during continuous move events', () => {
    const mgr = makeManager()
    let callCount = 0
    mgr.onViewportChange(() => callCount++)

    mockMapInstance.fire('move')
    mockMapInstance.fire('move')
    mockMapInstance.fire('move')
    expect(callCount).toBe(0)
  })

  it('subscriber IS called once on moveend', () => {
    const mgr = makeManager()
    let callCount = 0
    mgr.onViewportChange(() => callCount++)

    mockMapInstance.fire('moveend')
    expect(callCount).toBe(1)
  })

  it('destroy unregisters moveend listener', () => {
    const mgr = makeManager()
    mgr.destroy()
    const offCalls = mockMapInstance.off.mock.calls.map(c => c[0])
    expect(offCalls).toContain('moveend')
    expect(offCalls).not.toContain('move')
  })
})

// ---------------------------------------------------------------------------
// tileBounds helper tests
// ---------------------------------------------------------------------------

describe('tileBounds()', () => {
  it('tile (0,0) at zoom 0 covers the whole world', () => {
    const b = tileBounds(0, 0, 0)
    expect(b.west).toBeCloseTo(-180, 1)
    expect(b.east).toBeCloseTo(180, 1)
    expect(b.north).toBeGreaterThan(85)
    expect(b.south).toBeLessThan(-85)
  })

  it('tile center falls within the tile bounds', () => {
    const b = tileBounds(8, 133, 66)
    const cx = (b.west + b.east) / 2
    const cy = (b.north + b.south) / 2
    expect(cx).toBeGreaterThan(b.west)
    expect(cx).toBeLessThan(b.east)
    expect(cy).toBeGreaterThan(b.south)
    expect(cy).toBeLessThan(b.north)
  })
})

// ---------------------------------------------------------------------------
// Test 13: _buildStyle — native multi-source architecture (opentopomap + kartverket)
// ---------------------------------------------------------------------------

describe('MapManager — test 13: multi-source basemap (opentopomap + kartverket)', () => {
  it('_buildStyle() has opentopomap source with correct tile URL', () => {
    const mgr = makeManager()
    const style = mgr._buildStyle()
    expect(style.sources.opentopomap).toBeDefined()
    expect(style.sources.opentopomap.type).toBe('raster')
    expect(style.sources.opentopomap.tiles[0]).toMatch(/tile\.opentopomap\.org/)
  })

  it('_buildStyle() has kartverket source with correct tile URL', () => {
    const mgr = makeManager()
    const style = mgr._buildStyle()
    expect(style.sources.kartverket).toBeDefined()
    expect(style.sources.kartverket.type).toBe('raster')
    expect(style.sources.kartverket.tiles[0]).toMatch(/cache\.kartverket\.no/)
  })

  it('_buildStyle() has two layers: basemap-opentopomap and basemap-kartverket', () => {
    const mgr = makeManager()
    const style = mgr._buildStyle()
    const rasterLayers = style.layers.filter(l => l.type === 'raster')
    expect(rasterLayers).toHaveLength(2)
    const ids = rasterLayers.map(l => l.id)
    expect(ids).toContain('basemap-opentopomap')
    expect(ids).toContain('basemap-kartverket')
  })

  it('_buildStyle() layers reference the correct sources', () => {
    const mgr = makeManager()
    const style = mgr._buildStyle()
    const otmLayer = style.layers.find(l => l.id === 'basemap-opentopomap')
    const kvLayer  = style.layers.find(l => l.id === 'basemap-kartverket')
    expect(otmLayer?.source).toBe('opentopomap')
    expect(kvLayer?.source).toBe('kartverket')
  })

  it('_buildStyle() does NOT contain a composite:// URL anywhere', () => {
    const mgr = makeManager()
    const style = mgr._buildStyle()
    const styleJson = JSON.stringify(style)
    expect(styleJson).not.toMatch(/composite:\/\//)
  })
})

// ---------------------------------------------------------------------------
// Test 14: priority-based composite:// handler
// ---------------------------------------------------------------------------

describe('MapManager — test 14: priority handler — composite://tile/{z}/{x}/{y}', () => {
  it('uses Kartverket for a tile center inside Norway', async () => {
    const mgr = makeManager()
    const handler = MockMapLibre.addProtocol.mock.calls[0][1]

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(200),
    })

    // z=8, x=133, y=66 → centre ≈ 10°E, 63°N — inside Kartverket coverage
    const result = await handler({ url: 'composite://tile/8/133/66' }, null)
    expect(result.data).toBeInstanceOf(ArrayBuffer)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toMatch(/kartverket/)

    fetchMock.mockRestore()
  })

  it('skips Kartverket and uses OpenTopoMap for a tile outside Norway coverage', async () => {
    const mgr = makeManager()
    const handler = MockMapLibre.addProtocol.mock.calls[0][1]

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(200),
    })

    // z=5, x=28, y=20 → centre ≈ 135°E, 40°S — outside both Kartverket and Lantmäteriet
    const result = await handler({ url: 'composite://tile/5/28/20' }, null)
    expect(result.data).toBeInstanceOf(ArrayBuffer)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toMatch(/opentopomap/)

    fetchMock.mockRestore()
  })

  it('skips Lantmäteriet when token is absent; falls through to OpenTopoMap for Swedish tile', async () => {
    // z=8, x=137, y=78 → centre approx 13°E, 57°N — inside Lantmäteriet (south=55), outside Kartverket (south=57)
    const mgr = makeManager({ lantmaterietToken: null })
    const handler = MockMapLibre.addProtocol.mock.calls[0][1]

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(200),
    })

    const result = await handler({ url: 'composite://tile/8/137/78' }, null)
    expect(result.data).toBeInstanceOf(ArrayBuffer)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toMatch(/opentopomap/)

    fetchMock.mockRestore()
  })

  it('uses Lantmäteriet for Swedish tile when token is present', async () => {
    // Same tile as above, but with a token
    const mgr = makeManager({ lantmaterietToken: 'test-token' })
    const handler = MockMapLibre.addProtocol.mock.calls[0][1]

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(200),
    })

    const result = await handler({ url: 'composite://tile/8/137/78' }, null)
    expect(result.data).toBeInstanceOf(ArrayBuffer)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toMatch(/lantmateriet/)

    fetchMock.mockRestore()
  })

  it('falls through to next provider when fetch returns non-ok status', async () => {
    const mgr = makeManager()
    const handler = MockMapLibre.addProtocol.mock.calls[0][1]

    // Norwegian tile — Kartverket returns 503, should fall through to OpenTopoMap
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(200) })

    const result = await handler({ url: 'composite://tile/8/133/66' }, null)
    expect(result.data).toBeInstanceOf(ArrayBuffer)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toMatch(/opentopomap/)

    fetchMock.mockRestore()
  })

  it('returns transparent PNG when all providers fail', async () => {
    const mgr = makeManager({ lantmaterietToken: 'tok' })
    const handler = MockMapLibre.addProtocol.mock.calls[0][1]

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))

    const result = await handler({ url: 'composite://tile/8/133/66' }, null)
    expect(result.data).toBeInstanceOf(ArrayBuffer)
    // Should be the transparent PNG (very small — 68 bytes)
    expect(result.data.byteLength).toBeLessThan(100)

    fetchMock.mockRestore()
  })

  it('returns transparent PNG for malformed URL', async () => {
    const mgr = makeManager()
    const handler = MockMapLibre.addProtocol.mock.calls[0][1]
    const result = await handler({ url: 'composite://garbage' }, null)
    expect(result.data).toBeInstanceOf(ArrayBuffer)
    expect(result.data.byteLength).toBeLessThan(100)
  })
})
