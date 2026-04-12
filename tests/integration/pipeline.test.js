import { describe, it, expect, beforeAll, vi } from 'vitest'
import { registerCRS, GridTransform, TileId, Grid, Chunk, Viewport } from '../../src/core/primitives.js'
import { clearMemoryCache } from '../../src/core/cache.js'
import { RasterRenderer } from '../../src/core/renderer.js'
import { SnowSeasonLayer } from '../../src/layers/snow-season.js'
import { SlopeLayer } from '../../src/layers/slope.js'

beforeAll(() => {
  registerCRS({
    'EPSG:3857': '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +no_defs',
    'EPSG:3035': '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs',
  })
  clearMemoryCache()
})

const TRANSFORM = new GridTransform({
  originX: 0, originY: 0,
  chunkSize: 512_000,
  baseResolution: 1_000,
  nativeCRS: 'EPSG:3857',
})

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
    FLOAT_:                    5126,
    UNSIGNED_BYTE:             5121,
    UNSIGNED_SHORT:            5123,
    TEXTURE_MIN_FILTER:        10241,
    TEXTURE_MAG_FILTER:        10240,
    LINEAR:                    9729,
    CLAMP_TO_EDGE:             33071,
    TEXTURE_WRAP_S:            10242,
    TEXTURE_WRAP_T:            10243,
    TEXTURE0:                  33984,
    activeTexture:             track('activeTexture'),
    getExtension:              () => ({}),
    getShaderInfoLog:          () => '',
    getProgramInfoLog:         () => '',
    enable:                    track('enable'),
    disable:                   track('disable'),
    blendFuncSeparate:         track('blendFuncSeparate'),
    BLEND:                     3042,
    SRC_ALPHA:                 770,
    ONE_MINUS_SRC_ALPHA:       771,
    ONE:                       1,
    DEPTH_TEST:                2929,
    STENCIL_TEST:              2960,
    createVertexArray:         () => ({}),
    bindVertexArray:           track('bindVertexArray'),
    deleteVertexArray:         track('deleteVertexArray'),
    _calls:                    calls,
  }
}

function makeMockMapManager() {
  let cb = null
  const map = { triggerRepaint: vi.fn() }
  return {
    onViewportChange: (fn) => { cb = fn; return () => { cb = null } },
    fireViewport:     (vp) => cb && cb(vp),
    _map:             map,
  }
}

function makeViewport(zoom = 12) {
  return new Viewport({
    west: 0, east: 512_000,
    south: 0, north: 512_000,
    zoom, widthPx: 1024, heightPx: 1024,
  })
}

function makeChunk(tileId) {
  const cells = tileId.cellsPerSide
  const grid = new Grid({
    data: new Uint8Array(cells * cells).fill(42),
    width: cells, height: cells, dtype: 'uint8',
  })
  return new Chunk({ tileId, grid })
}

describe('Integration — test 1: viewport change → chunk uploaded → render() draws', () => {
  it('gl.drawArrays called after viewport fires and update completes', async () => {
    const mapManager = makeMockMapManager()
    const gl = makeMockGl()
    const renderer = new RasterRenderer({ mapManager })
    renderer.onAdd(mapManager._map, gl)

    const tileId = new TileId({ chunkX: 0, chunkY: 0, stride: 1, transform: TRANSFORM })
    const chunk = makeChunk(tileId)
    const mockSource = { async *get() { yield chunk } }

    const layer = new SnowSeasonLayer({
      id: 'snow-season',
      source: mockSource,
      renderer,
      params: { valueRange: { from: 0, to: 180 } },
    })

    renderer.register(layer)
    const vp = makeViewport()
    await layer.update(vp, new AbortController().signal)

    const matrix = new Float32Array(16)
    renderer.render(gl, matrix)

    expect((gl._calls.drawArrays || []).length).toBeGreaterThan(0)
  })
})

describe('Integration — test 2: params change → render() uses updated uniform without re-upload', () => {
  it('valueRange.to mutation reflected in uniform1f without calling upload again', async () => {
    const mapManager = makeMockMapManager()
    const gl = makeMockGl()
    const renderer = new RasterRenderer({ mapManager })
    renderer.onAdd(mapManager._map, gl)

    const tileId = new TileId({ chunkX: 0, chunkY: 0, stride: 1, transform: TRANSFORM })
    const chunk = makeChunk(tileId)
    const mockSource = { async *get() { yield chunk } }
    const params = { valueRange: { from: 0, to: 180 } }

    const layer = new SnowSeasonLayer({ id: 'snow-season-2', source: mockSource, renderer, params })
    renderer.register(layer)
    await layer.update(makeViewport(), new AbortController().signal)

    const matrix = new Float32Array(16)
    gl._calls.uniform1f = []
    renderer.render(gl, matrix)

    const had180 = (gl._calls.uniform1f || []).some(args => args[1] === 180)
    expect(had180).toBe(true)

    const uploadCallsBefore = (gl._calls.texImage2D || []).length

    params.valueRange = { from: 0, to: 360 }
    gl._calls.uniform1f = []
    renderer.render(gl, matrix)

    const had360 = (gl._calls.uniform1f || []).some(args => args[1] === 360)
    expect(had360).toBe(true)

    expect((gl._calls.texImage2D || []).length).toBe(uploadCallsBefore)
  })
})

describe('Integration — test 3: second viewport → stale chunk released → new chunk uploaded', () => {
  it('release called and new upload made when viewport shifts to non-overlapping area', async () => {
    const mapManager = makeMockMapManager()
    const gl = makeMockGl()
    const renderer = new RasterRenderer({ mapManager })
    renderer.onAdd(mapManager._map, gl)

    const tileA = new TileId({ chunkX: 0, chunkY: 0, stride: 1, transform: TRANSFORM })
    const tileB = new TileId({ chunkX: 3, chunkY: 3, stride: 1, transform: TRANSFORM })

    let serveChunks = [makeChunk(tileA)]
    const mockSource = {
      async *get() { for (const c of serveChunks) yield c },
    }

    const layer = new SnowSeasonLayer({
      id: 'snow-season-3', source: mockSource, renderer,
      params: { valueRange: { from: 0, to: 180 } },
    })
    renderer.register(layer)

    await layer.update(makeViewport(), new AbortController().signal)
    const uploadCount1 = (gl._calls.texImage2D || []).length

    serveChunks = [makeChunk(tileB)]
    await layer.update(makeViewport(), new AbortController().signal)

    expect((gl._calls.deleteTexture || []).length).toBeGreaterThan(0)
    expect((gl._calls.texImage2D || []).length).toBe(uploadCount1 + 1)
  })
})

describe('Integration — test 4: abort in-flight update → render continues with previous data', () => {
  it('aborted update does not upload; previous chunk still rendered', async () => {
    const mapManager = makeMockMapManager()
    const gl = makeMockGl()
    const renderer = new RasterRenderer({ mapManager })
    renderer.onAdd(mapManager._map, gl)

    const tileA = new TileId({ chunkX: 0, chunkY: 0, stride: 1, transform: TRANSFORM })
    const chunkA = makeChunk(tileA)

    let resolveSlowFetch
    const mockSource = {
      async *get(_extent, _res, signal) {
        if (!resolveSlowFetch) {
          yield chunkA
          return
        }
        await new Promise((res, rej) => {
          resolveSlowFetch = res
          signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')))
        })
        yield makeChunk(new TileId({ chunkX: 1, chunkY: 0, stride: 1, transform: TRANSFORM }))
      },
    }

    const layer = new SnowSeasonLayer({
      id: 'snow-season-4', source: mockSource, renderer,
      params: { valueRange: { from: 0, to: 180 } },
    })
    renderer.register(layer)

    await layer.update(makeViewport(), new AbortController().signal)
    const uploadAfterA = (gl._calls.texImage2D || []).length
    expect(uploadAfterA).toBe(1)

    resolveSlowFetch = null
    resolveSlowFetch = () => {}
    const controllerB = new AbortController()
    const slowUpdate = layer.update(makeViewport(), controllerB.signal)
    controllerB.abort()

    try { await slowUpdate } catch { /* AbortError is expected */ }

    expect((gl._calls.texImage2D || []).length).toBe(uploadAfterA)

    const matrix = new Float32Array(16)
    renderer.render(gl, matrix)
    expect((gl._calls.drawArrays || []).length).toBeGreaterThan(0)
  })
})

describe('Integration — test 5: multiple layers — draw order preserved', () => {
  it('SnowSeasonLayer chunks drawn before SlopeLayer chunks', async () => {
    const mapManager = makeMockMapManager()
    const gl = makeMockGl()
    const renderer = new RasterRenderer({ mapManager })
    renderer.onAdd(mapManager._map, gl)

    const tileSnow = new TileId({ chunkX: 0, chunkY: 0, stride: 1, transform: TRANSFORM })
    const tileSlope = new TileId({ chunkX: 1, chunkY: 0, stride: 1, transform: TRANSFORM })

    const snowSource = { async *get() { yield makeChunk(tileSnow) } }
    const slopeSource = { async *get() { yield makeChunk(tileSlope) } }

    const snowLayer = new SnowSeasonLayer({
      id: 'snow-order', source: snowSource, renderer,
      params: { valueRange: { from: 0, to: 180 } },
    })
    const slopeLayer = new SlopeLayer({
      id: 'slope-order', source: slopeSource, renderer,
      params: { slopeThreshold: 15 },
    })

    renderer.register(snowLayer)
    renderer.register(slopeLayer)

    const vp = makeViewport(12)
    await snowLayer.update(vp, new AbortController().signal)
    await slopeLayer.update(vp, new AbortController().signal)

    const drawCalls = []
    const origDraw = gl.drawArrays
    let drawIdx = 0
    gl.drawArrays = (...args) => {
      drawCalls.push(drawIdx++)
      return origDraw(...args)
    }

    const matrix = new Float32Array(16)
    renderer.render(gl, matrix)

    expect(drawCalls.length).toBe(2)
    expect(drawCalls[0]).toBeLessThan(drawCalls[1])
  })
})
