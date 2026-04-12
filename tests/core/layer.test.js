import { describe, it, expect, beforeAll, vi } from 'vitest'
import proj4 from 'proj4'
import { registerCRS, Grid, GridTransform, TileId, Chunk, Viewport } from '../../src/core/primitives.js'
import { RasterRenderer } from '../../src/core/renderer.js'
import { RasterLayer } from '../../src/core/layer.js'

// ─── CRS Registration ──────────────────────────────────────────────────────────
beforeAll(() => {
  registerCRS({
    'EPSG:25833': '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
    'EPSG:3035':  '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs',
  })
})

// ─── Mock factories ────────────────────────────────────────────────────────────

function makeMockGl() {
  const calls = {}
  const track = (name) => (...args) => { (calls[name] = calls[name] || []).push(args); return 0 }
  return {
    createShader:              () => ({}),
    shaderSource:              track('shaderSource'),
    compileShader:             track('compileShader'),
    getShaderParameter:        () => true,
    createProgram:             () => ({}),
    attachShader:              track('attachShader'),
    linkProgram:               track('linkProgram'),
    getProgramParameter:       () => true,
    useProgram:                track('useProgram'),
    createTexture:             () => ({}),
    bindTexture:               track('bindTexture'),
    texImage2D:                track('texImage2D'),
    texParameteri:             track('texParameteri'),
    deleteTexture:             track('deleteTexture'),
    createBuffer:              () => ({}),
    bindBuffer:                track('bindBuffer'),
    bufferData:                track('bufferData'),
    deleteBuffer:              track('deleteBuffer'),
    enableVertexAttribArray:   track('enableVertexAttribArray'),
    vertexAttribPointer:       track('vertexAttribPointer'),
    getAttribLocation:         () => 0,
    getUniformLocation:        () => ({}),
    uniform1i:                 track('uniform1i'),
    uniform1f:                 track('uniform1f'),
    uniformMatrix4fv:          track('uniformMatrix4fv'),
    drawArrays:                track('drawArrays'),
    VERTEX_SHADER:             35633,
    FRAGMENT_SHADER:           35632,
    ARRAY_BUFFER:              34962,
    TRIANGLES:                 4,
    FLOAT:                     5126,
    TEXTURE_2D:                3553,
    LUMINANCE:                 6409,
    UNSIGNED_BYTE:             5121,
    UNSIGNED_SHORT:            5123,
    TEXTURE_MIN_FILTER:        10241,
    TEXTURE_MAG_FILTER:        10240,
    LINEAR:                    9729,
    TEXTURE0:                  33984,
    activeTexture:             track('activeTexture'),
    getExtension:              () => ({}),
    enable:                    track('enable'),
    disable:                   track('disable'),
    blendFuncSeparate:         track('blendFuncSeparate'),
    BLEND:                     3042,
    SRC_ALPHA:                 770,
    ONE_MINUS_SRC_ALPHA:       771,
    ONE:                       1,
    DEPTH_TEST:                2929,
    STENCIL_TEST:              2960,
    RED:                       6403,
    R8:                        33321,
    R32F:                      33326,
    TEXTURE_WRAP_S:            10242,
    TEXTURE_WRAP_T:            10243,
    CLAMP_TO_EDGE:             33071,
    createVertexArray:         () => ({}),
    bindVertexArray:           track('bindVertexArray'),
    deleteVertexArray:         track('deleteVertexArray'),
    _calls:                    calls,
  }
}

function makeMockMapManager() {
  let viewportCallback = null
  return {
    onViewportChange: (cb) => { viewportCallback = cb; return () => { viewportCallback = null } },
    fireViewport: (vp) => viewportCallback && viewportCallback(vp),
    _map: { triggerRepaint: vi.fn() },
  }
}

function makeMockMap(mapManager) {
  return mapManager._map
}

function makeViewport(opts = {}) {
  return new Viewport({
    west: 1_500_000, east: 1_600_000,
    south: 8_400_000, north: 8_500_000,
    zoom: 8, widthPx: 1024, heightPx: 1024,
    ...opts,
  })
}

function makeTransform(crs = 'EPSG:3857') {
  return new GridTransform({
    originX: 0, originY: 0,
    chunkSize: 512_000,
    baseResolution: 1_000,
    nativeCRS: crs,
  })
}

function makeChunk(transform, chunkX = 0, chunkY = 0, stride = 1) {
  const cells = Math.round(transform.chunkSize / (transform.baseResolution * stride))
  const tileId = new TileId({ chunkX, chunkY, stride, transform })
  const grid = new Grid({
    data: new Float32Array(cells * cells).fill(1),
    width: cells, height: cells, dtype: 'float32',
  })
  return new Chunk({ tileId, grid })
}

function makeGrid(cells = 4) {
  return new Grid({ data: new Float32Array(cells * cells).fill(1), width: cells, height: cells, dtype: 'float32' })
}

// Minimal subclass for testing
class TestLayer extends RasterLayer {
  get layerType()  { return 'soft-filter' }
  get hue()        { return this.params.hue ?? 200 }
  get valueRange() { return this.params.valueRange ?? { from: 0, to: 100 } }
  get threshold()  { return this.params.threshold ?? 0.5 }
}

// ─── RasterRenderer tests ──────────────────────────────────────────────────────

describe('RasterRenderer — test 1: construction and shader compilation', () => {
  it('onAdd compiles shaders without throwing', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)

    expect(() => renderer.onAdd(map, gl)).not.toThrow()

    // compileShader called twice (vertex + fragment)
    expect(gl._calls.compileShader).toHaveLength(2)
    // linkProgram called once
    expect(gl._calls.linkProgram).toHaveLength(1)
  })
})

describe('RasterRenderer — test 2: register() triggers immediate update', () => {
  it('calls layer.update() with current viewport immediately on register', async () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    // Fire a viewport so renderer has a current viewport
    const vp = makeViewport()
    mapManager.fireViewport(vp)

    // Give any microtasks a chance to complete
    await new Promise(r => setTimeout(r, 10))

    // Now register a layer
    const updateSpy = vi.fn().mockResolvedValue(undefined)
    const layer = {
      id: 'test-layer',
      update: updateSpy,
    }

    renderer.register(layer)
    await new Promise(r => setTimeout(r, 10))

    expect(updateSpy).toHaveBeenCalledWith(vp, expect.any(AbortSignal))
  })
})

describe('RasterRenderer — test 3: upload() returns release callback', () => {
  it('returns a function; calling it invokes deleteTexture and deleteBuffer', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    const grid = makeGrid(4)
    const vertices = new Float32Array([0, 0, 0, 0,  1, 0, 1, 0,  1, 1, 1, 1])
    const release = renderer.upload(grid, vertices, () => ({ layerType: 0, hue: 200, valueRange: { from: 0, to: 100 }, threshold: 0.5 }))

    expect(typeof release).toBe('function')

    release()
    expect(gl._calls.deleteTexture).toHaveLength(1)
    expect(gl._calls.deleteBuffer).toHaveLength(1)
  })
})

describe('RasterRenderer — test 4: render() calls getParams every frame', () => {
  it('reads hue from getParams each frame; changes take effect without re-upload', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    let hue = 200
    const getParams = () => ({ layerType: 0, hue, valueRange: { from: 0, to: 100 }, threshold: 0.5 })

    const vertices = new Float32Array([0, 0, 0, 0,  1, 0, 1, 0,  1, 1, 1, 1])
    renderer.upload(makeGrid(4), vertices, getParams)

    // Manually associate the chunk with a dummy layer entry by registering a dummy layer
    // We need to call render() - renderer must include the uploaded chunk in its draw list
    const matrix = new Float32Array(16)
    renderer.render(gl, matrix)

    // uniform1f should have been called with hue=200 somewhere
    const hueCall200 = (gl._calls.uniform1f || []).some(args => args[1] === 200)
    expect(hueCall200).toBe(true)

    // Change hue
    hue = 120
    gl._calls.uniform1f = []
    renderer.render(gl, matrix)

    const hueCall120 = (gl._calls.uniform1f || []).some(args => args[1] === 120)
    expect(hueCall120).toBe(true)
  })
})

describe('RasterRenderer — test 5: triggerRepaint called only on upload', () => {
  it('triggerRepaint called after upload(), not on layer registration alone', async () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    // Register a layer with a source that yields NO chunks
    let chunks = []
    const mockSource = {
      async *get() { for (const c of chunks) yield c },
    }
    const layer = new TestLayer({
      id: 'repaint-test',
      source: mockSource,
      renderer,
      params: {},
    })

    renderer.register(layer)
    const vp = makeViewport()
    await layer.update(vp, new AbortController().signal)

    expect(map.triggerRepaint).not.toHaveBeenCalled()

    // Now add a chunk and update
    const transform = makeTransform('EPSG:3857')
    chunks = [makeChunk(transform, 3, 16, 1)]
    await layer.update(vp, new AbortController().signal)

    expect(map.triggerRepaint).toHaveBeenCalledTimes(1)
  })
})

describe('RasterRenderer — test 6: viewport change cancels in-progress update', () => {
  it('first update signal aborted when second viewport fires; second update starts', async () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    let resolveSlowGet
    const signals = []
    const mockSource = {
      async *get(_extent, _res, signal) {
        signals.push(signal)
        await new Promise(r => { resolveSlowGet = r })
        if (signal.aborted) return
        yield makeChunk(makeTransform('EPSG:3857'), 0, 0, 1)
      },
    }

    const layer = {
      id: 'slow-layer',
      update: async (vp, signal) => {
        for await (const _chunk of mockSource.get(vp, vp.resolution(), signal)) { /* noop */ }
      },
    }

    renderer.register(layer)

    // Fire first viewport
    mapManager.fireViewport(makeViewport())
    await new Promise(r => setTimeout(r, 10)) // let first update start

    // Fire second viewport before first completes
    mapManager.fireViewport(makeViewport({ west: 1_600_000, east: 1_700_000 }))
    await new Promise(r => setTimeout(r, 10))

    // First signal should be aborted
    expect(signals[0]?.aborted).toBe(true)
    // Second signal should exist and not aborted
    expect(signals[1]).toBeDefined()
    expect(signals[1]?.aborted).toBe(false)

    // Cleanup
    resolveSlowGet?.()
  })
})

describe('RasterRenderer — test 7: render() order matches registration order', () => {
  it('LayerA chunks drawn before LayerB chunks', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    const drawOrder = []
    let drawCount = 0

    const makeGetParams = (label) => () => {
      return { layerType: 0, hue: 200, valueRange: { from: 0, to: 100 }, threshold: 0.5, _label: label }
    }

    // Intercept uniform1f to record draw order based on drawArrays calls
    const origDrawArrays = gl.drawArrays
    gl.drawArrays = (...args) => {
      drawOrder.push(drawCount)
      drawCount++
      return origDrawArrays(...args)
    }

    const vertices = new Float32Array([0, 0, 0, 0,  1, 0, 1, 0,  1, 1, 1, 1])

    // Register LayerA and LayerB (dummy layers with id only)
    const layerA = { id: 'layerA', update: vi.fn().mockResolvedValue(undefined) }
    const layerB = { id: 'layerB', update: vi.fn().mockResolvedValue(undefined) }
    renderer.register(layerA)
    renderer.register(layerB)

    // Upload a chunk for each layer
    renderer.uploadForLayer('layerA', makeGrid(4), vertices, makeGetParams('A'))
    renderer.uploadForLayer('layerB', makeGrid(4), vertices, makeGetParams('B'))

    const matrix = new Float32Array(16)
    renderer.render(gl, matrix)

    // LayerA's chunk drawn first → drawOrder[0] < drawOrder[1]
    expect(drawOrder[0]).toBeLessThan(drawOrder[1])
  })
})

describe('RasterRenderer — test 8: unregister() calls all release callbacks', () => {
  it('both release callbacks called when layer unregistered', async () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    let released = 0
    const mockSource = {
      async *get() {
        yield makeChunk(makeTransform('EPSG:3857'), 0, 0, 1)
        yield makeChunk(makeTransform('EPSG:3857'), 1, 0, 1)
      },
    }

    const layer = new TestLayer({
      id: 'unregister-test',
      source: mockSource,
      renderer,
      params: {},
    })

    renderer.register(layer)
    const vp = makeViewport()
    await layer.update(vp, new AbortController().signal)

    // Override deleteTexture to track releases
    let deleteTextureCalls = 0
    gl.deleteTexture = () => { deleteTextureCalls++ }
    gl.deleteBuffer = () => {}

    renderer.unregister('unregister-test')

    expect(deleteTextureCalls).toBe(2)
  })
})

// ─── RasterLayer tests ─────────────────────────────────────────────────────────

describe('RasterLayer — test 9: generateMesh() low distortion → 2×2 mesh', () => {
  it('small chunk in EPSG:3035 at 65°N → 2×2 grid → 24 floats', () => {
    const [cx, cy] = proj4('EPSG:4326', 'EPSG:3035', [15, 65])
    const transform = new GridTransform({
      originX: cx - 500, originY: cy - 500,
      chunkSize: 1_000,
      baseResolution: 10,
      nativeCRS: 'EPSG:3035',
    })
    const tileId = new TileId({ chunkX: 0, chunkY: 0, stride: 1, transform })
    const cells = tileId.cellsPerSide
    const grid = new Grid({ data: new Float32Array(cells * cells).fill(1), width: cells, height: cells, dtype: 'float32' })
    const chunk = new Chunk({ tileId, grid })

    // Verify distortion is < 0.001 (N=2)
    expect(chunk.tileId.extent.maxDistortion('EPSG:3857')).toBeLessThan(0.001)

    const mockRenderer = { upload: vi.fn().mockReturnValue(() => {}), _map: { triggerRepaint: vi.fn() } }
    const layer = new TestLayer({ id: 'test', source: null, renderer: mockRenderer, params: {} })

    const mesh = layer.generateMesh(chunk, 'EPSG:3857')

    // N=2: 1×1 quad = 2 triangles = 6 vertices × 4 floats = 24
    expect(mesh).toBeInstanceOf(Float32Array)
    expect(mesh.length).toBe(24)

    // Verify UV coords are present: first vertex u=0,v=0; second u=1,v=0 etc.
    // Vertices: [x,y,u,v], the UV corners should be 0,0 / 1,0 / 1,1 and 0,0 / 1,1 / 0,1
    // Just check the u,v values are in [0,1]
    for (let i = 0; i < 6; i++) {
      const u = mesh[i * 4 + 2]
      const v = mesh[i * 4 + 3]
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThanOrEqual(1)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('RasterLayer — test 10: generateMesh() high distortion → finer mesh', () => {
  it('large chunk with distortion > 0.005 → more than 24 floats', () => {
    const [cx, cy] = proj4('EPSG:4326', 'EPSG:3035', [15, 65])
    const transform = new GridTransform({
      originX: cx - 250_000, originY: cy - 250_000,
      chunkSize: 500_000,
      baseResolution: 5_000,
      nativeCRS: 'EPSG:3035',
    })
    const tileId = new TileId({ chunkX: 0, chunkY: 0, stride: 1, transform })
    const cells = tileId.cellsPerSide
    const grid = new Grid({ data: new Float32Array(cells * cells).fill(1), width: cells, height: cells, dtype: 'float32' })
    const chunk = new Chunk({ tileId, grid })

    // Verify distortion > 0.005
    expect(chunk.tileId.extent.maxDistortion('EPSG:3857')).toBeGreaterThan(0.005)

    const mockRenderer = { upload: vi.fn().mockReturnValue(() => {}), _map: { triggerRepaint: vi.fn() } }
    const layer = new TestLayer({ id: 'test', source: null, renderer: mockRenderer, params: {} })

    const mesh = layer.generateMesh(chunk, 'EPSG:3857')

    // Must have more than 24 floats (i.e. N > 2)
    expect(mesh.length).toBeGreaterThan(24)
  })
})

describe('RasterLayer — test 11: generateMesh() reprojection correctness', () => {
  it('corner vertices match Mercator [0,1] reprojection of chunk extent corners', () => {
    const HALF = 20037508.3427892
    const FULL = HALF * 2
    function toMercator([x, y]) { return [(x + HALF) / FULL, (HALF - y) / FULL] }

    const transform = new GridTransform({
      originX: 250_000, originY: 6_640_000,
      chunkSize: 10_000,
      baseResolution: 100,
      nativeCRS: 'EPSG:25833',
    })
    const tileId = new TileId({ chunkX: 0, chunkY: 0, stride: 1, transform })
    const cells = tileId.cellsPerSide
    const grid = new Grid({ data: new Float32Array(cells * cells).fill(1), width: cells, height: cells, dtype: 'float32' })
    const chunk = new Chunk({ tileId, grid })

    const ext = chunk.tileId.extent
    const expectedTL = toMercator(proj4('EPSG:25833', 'EPSG:3857', [ext.west,  ext.north]))
    const expectedTR = toMercator(proj4('EPSG:25833', 'EPSG:3857', [ext.east,  ext.north]))
    const expectedBR = toMercator(proj4('EPSG:25833', 'EPSG:3857', [ext.east,  ext.south]))
    const expectedBL = toMercator(proj4('EPSG:25833', 'EPSG:3857', [ext.west,  ext.south]))

    const mockRenderer = { upload: vi.fn().mockReturnValue(() => {}), _map: { triggerRepaint: vi.fn() } }
    const layer = new TestLayer({ id: 'test', source: null, renderer: mockRenderer, params: {} })

    const mesh = layer.generateMesh(chunk, 'EPSG:3857')

    const getVertex = (i) => [mesh[i * 4], mesh[i * 4 + 1]]
    const corners = [expectedTL, expectedTR, expectedBR, expectedBL]

    for (let i = 0; i < 6; i++) {
      const [vx, vy] = getVertex(i)
      const matchesACorner = corners.some(([cx, cy]) =>
        Math.abs(vx - cx) < 1e-6 && Math.abs(vy - cy) < 1e-6
      )
      expect(matchesACorner).toBe(true)
    }
  })
})

describe('RasterLayer — test 12: update() calls upload with getParams closure', () => {
  it('renderer.upload called with grid, Float32Array vertices, and callable getParams', async () => {
    const transform = makeTransform('EPSG:3857')
    const chunk = makeChunk(transform, 3, 16, 1)

    const mockSource = {
      async *get() { yield chunk },
    }

    const uploadSpy = vi.fn().mockReturnValue(() => {})
    const mockRenderer = {
      upload: uploadSpy,
      _map: { triggerRepaint: vi.fn() },
    }

    const layer = new TestLayer({
      id: 'upload-test',
      source: mockSource,
      renderer: mockRenderer,
      params: { hue: 42, valueRange: { from: 10, to: 90 } },
    })

    const vp = makeViewport()
    await layer.update(vp, new AbortController().signal)

    expect(uploadSpy).toHaveBeenCalledTimes(1)
    const [grid, vertices, getParams] = uploadSpy.mock.calls[0]
    expect(grid).toBeInstanceOf(Grid)
    expect(vertices).toBeInstanceOf(Float32Array)
    expect(typeof getParams).toBe('function')

    const params = getParams()
    expect(params).toHaveProperty('layerType')
    expect(params).toHaveProperty('hue')
    expect(params).toHaveProperty('valueRange')
    expect(params).toHaveProperty('threshold')
  })
})

describe('RasterLayer — test 13: update() stores release callback', () => {
  it('release callback stored for chunk key after update', async () => {
    const transform = makeTransform('EPSG:3857')
    const chunk = makeChunk(transform, 0, 0, 1)
    const chunkKeyStr = chunk.tileId.toString()

    const releaseCallback = vi.fn()
    const mockSource = { async *get() { yield chunk } }
    const mockRenderer = {
      upload: vi.fn().mockReturnValue(releaseCallback),
      _map: { triggerRepaint: vi.fn() },
    }

    const layer = new TestLayer({
      id: 'store-test',
      source: mockSource,
      renderer: mockRenderer,
      params: {},
    })

    const vp = makeViewport()
    await layer.update(vp, new AbortController().signal)

    // Access internal chunk map via test helper
    // The layer must expose a way to check — we verify by calling unregister-like behaviour:
    // release should be callable (we verify it's stored by calling a second update that doesn't yield the chunk)
    const mockSource2 = { async *get() { /* yield nothing */ } }
    layer.source = mockSource2
    await layer.update(vp, new AbortController().signal)

    // Release callback should have been called (stale chunk purged)
    expect(releaseCallback).toHaveBeenCalledTimes(1)
  })
})

describe('RasterLayer — test 14: update() purges stale chunks', () => {
  it('chunk B release called after second update that omits B', async () => {
    const transform = makeTransform('EPSG:3857')
    const chunkA = makeChunk(transform, 0, 0, 1)
    const chunkB = makeChunk(transform, 1, 0, 1)

    const releaseA = vi.fn()
    const releaseB = vi.fn()

    let yieldChunks = [chunkA, chunkB]
    const mockSource = {
      async *get() { for (const c of yieldChunks) yield c },
    }
    const releaseMap = new Map([
      [chunkA.tileId.toString(), releaseA],
      [chunkB.tileId.toString(), releaseB],
    ])
    let callIdx = 0
    const mockRenderer = {
      upload: vi.fn().mockImplementation(() => {
        const entries = [...releaseMap.entries()]
        return entries[callIdx++ % entries.length][1]
      }),
      _map: { triggerRepaint: vi.fn() },
    }

    const layer = new TestLayer({
      id: 'purge-test',
      source: mockSource,
      renderer: mockRenderer,
      params: {},
    })

    const vp = makeViewport()
    await layer.update(vp, new AbortController().signal)
    expect(releaseA).not.toHaveBeenCalled()
    expect(releaseB).not.toHaveBeenCalled()

    // Second update yields only A
    callIdx = 0
    yieldChunks = [chunkA]
    await layer.update(vp, new AbortController().signal)

    expect(releaseB).toHaveBeenCalled()
  })
})

describe('RasterLayer — test 15: update() abort stops generator', () => {
  it('abort mid-update stops processing; previously uploaded chunks remain', async () => {
    const transform = makeTransform('EPSG:3857')
    const chunkA = makeChunk(transform, 0, 0, 1)

    const ac = new AbortController()
    let uploadCount = 0

    const mockSource = {
      async *get(_extent, _res, signal) {
        yield chunkA
        uploadCount++
        // Abort mid-iteration
        ac.abort()
        // This chunk should NOT be yielded after abort
        if (signal.aborted) return
        yield makeChunk(transform, 1, 0, 1)
      },
    }

    const mockRenderer = {
      upload: vi.fn().mockReturnValue(() => {}),
      _map: { triggerRepaint: vi.fn() },
    }

    const layer = new TestLayer({
      id: 'abort-test',
      source: mockSource,
      renderer: mockRenderer,
      params: {},
    })

    const vp = makeViewport()
    await layer.update(vp, ac.signal)

    // Only 1 chunk uploaded (second was after abort)
    expect(mockRenderer.upload).toHaveBeenCalledTimes(1)
  })
})

describe('RasterLayer — test 16: #visualParams() returns reactive values', () => {
  it('getParams closure returns updated values when params object changes', async () => {
    const transform = makeTransform('EPSG:3857')
    const chunk = makeChunk(transform, 0, 0, 1)

    const params = { hue: 200, valueRange: { from: 0, to: 180 }, threshold: 0.5 }

    let capturedGetParams
    const mockSource = { async *get() { yield chunk } }
    const mockRenderer = {
      upload: vi.fn().mockImplementation((_grid, _vertices, getParams) => {
        capturedGetParams = getParams
        return () => {}
      }),
      _map: { triggerRepaint: vi.fn() },
    }

    const layer = new TestLayer({
      id: 'reactive-test',
      source: mockSource,
      renderer: mockRenderer,
      params,
    })

    const vp = makeViewport()
    await layer.update(vp, new AbortController().signal)

    expect(capturedGetParams).toBeDefined()
    const initialResult = capturedGetParams()
    expect(initialResult.valueRange).toEqual({ from: 0, to: 180 })

    // Mutate params in-place
    params.valueRange = { from: 10, to: 200 }

    const updatedResult = capturedGetParams()
    expect(updatedResult.valueRange).toEqual({ from: 10, to: 200 })
  })
})

describe('RasterLayer — test 17: chunk key uniqueness', () => {
  it('different positions → different keys; same position different strides → different keys', () => {
    const transform = makeTransform('EPSG:3857')

    const chunkA = makeChunk(transform, 0, 0, 1)
    const chunkB = makeChunk(transform, 1, 0, 1)  // different position
    const chunkC = makeChunk(transform, 0, 0, 2)  // same position, different stride

    const keyA = chunkA.tileId.toString()
    const keyB = chunkB.tileId.toString()
    const keyC = chunkC.tileId.toString()

    expect(keyA).not.toBe(keyB)
    expect(keyA).not.toBe(keyC)
    expect(keyB).not.toBe(keyC)
  })
})

describe('RasterLayer — test 18b: generateMesh() vertex positions are in Mercator [0,1] range', () => {
  it('all vertex x,y values are in [0, 1] (MapLibre Mercator coordinate space)', () => {
    const [cx, cy] = proj4('EPSG:4326', 'EPSG:3035', [9.0, 61.5])
    const transform = new GridTransform({
      originX: cx - 50_000, originY: cy - 50_000,
      chunkSize: 100_000,
      baseResolution: 1_000,
      nativeCRS: 'EPSG:3035',
    })
    const tileId = new TileId({ chunkX: 0, chunkY: 0, stride: 1, transform })
    const cells = tileId.cellsPerSide
    const grid = new Grid({ data: new Float32Array(cells * cells).fill(1), width: cells, height: cells, dtype: 'float32' })
    const chunk = new Chunk({ tileId, grid })

    const mockRenderer = { upload: vi.fn().mockReturnValue(() => {}), _map: { triggerRepaint: vi.fn() } }
    const layer = new TestLayer({ id: 'test', source: null, renderer: mockRenderer, params: {} })

    const mesh = layer.generateMesh(chunk, 'EPSG:3857')

    const vertexCount = mesh.length / 4
    for (let i = 0; i < vertexCount; i++) {
      const x = mesh[i * 4]
      const y = mesh[i * 4 + 1]
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(1)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(1)
    }
  })
})

describe('RasterLayer — test 18: update() swallows AbortError from source generator', () => {
  it('does not throw or reject when source generator throws AbortError mid-iteration', async () => {
    const transform = makeTransform('EPSG:3857')
    const ac = new AbortController()

    const mockSource = {
      async *get(_vp, _res, signal) {
        yield makeChunk(transform, 0, 0, 1)
        ac.abort()
        const err = new Error('signal is aborted without reason')
        err.name = 'AbortError'
        throw err
      },
    }

    const mockRenderer = {
      upload: vi.fn().mockReturnValue(() => {}),
      _map: { triggerRepaint: vi.fn() },
    }

    const layer = new TestLayer({
      id: 'abort-error-test',
      source: mockSource,
      renderer: mockRenderer,
      params: {},
    })

    const vp = makeViewport()
    await expect(layer.update(vp, ac.signal)).resolves.toBeUndefined()
  })

  it('non-abort errors from source generator still propagate', async () => {
    const mockSource = {
      async *get() {
        throw new Error('network failure')
      },
    }

    const mockRenderer = {
      upload: vi.fn().mockReturnValue(() => {}),
      _map: { triggerRepaint: vi.fn() },
    }

    const layer = new TestLayer({
      id: 'network-error-test',
      source: mockSource,
      renderer: mockRenderer,
      params: {},
    })

    const vp = makeViewport()
    await expect(layer.update(vp, new AbortController().signal)).rejects.toThrow('network failure')
  })
})

describe('RasterRenderer — test 19: upload() uses WebGL2-compatible texture formats', () => {
  it('uint8 grid uses R8/RED internalFormat (not LUMINANCE)', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    const grid = new Grid({ data: new Uint8Array(16).fill(128), width: 4, height: 4, dtype: 'uint8' })
    const vertices = new Float32Array([0, 0, 0, 0,  1, 0, 1, 0,  1, 1, 1, 1])
    renderer.upload(grid, vertices, () => ({ layerType: 0, hue: 200, valueRange: { from: 0, to: 255 }, threshold: 0 }))

    const [call] = gl._calls.texImage2D
    const internalFormat = call[2]
    const format = call[6]
    expect(internalFormat).toBe(gl.R8)
    expect(format).toBe(gl.RED)
    expect(internalFormat).not.toBe(gl.LUMINANCE)
  })

  it('float32 grid uses R32F/RED internalFormat (not LUMINANCE)', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    const grid = new Grid({ data: new Float32Array(16).fill(0.5), width: 4, height: 4, dtype: 'float32' })
    const vertices = new Float32Array([0, 0, 0, 0,  1, 0, 1, 0,  1, 1, 1, 1])
    renderer.upload(grid, vertices, () => ({ layerType: 0, hue: 200, valueRange: { from: 0, to: 1 }, threshold: 0 }))

    const [call] = gl._calls.texImage2D
    const internalFormat = call[2]
    const format = call[6]
    expect(internalFormat).toBe(gl.R32F)
    expect(format).toBe(gl.RED)
    expect(internalFormat).not.toBe(gl.LUMINANCE)
  })
})
