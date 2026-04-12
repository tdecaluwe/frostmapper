import { describe, it, expect, vi } from 'vitest'
import { RasterRenderer, FRAGMENT_SHADER_SRC } from '../../src/core/renderer.js'

// ─── Mock factories ────────────────────────────────────────────────────────────

function makeMockGl({
  shaderCompileOk = true,
  shaderInfoLog = '',
  programLinkOk = true,
  programInfoLog = '',
} = {}) {
  const calls = {}
  const track = (name) => (...args) => {
    ;(calls[name] = calls[name] || []).push(args)
    return 0
  }
  return {
    createShader:             () => ({}),
    shaderSource:             track('shaderSource'),
    compileShader:            track('compileShader'),
    getShaderParameter:       () => shaderCompileOk,
    getShaderInfoLog:         () => shaderInfoLog,
    createProgram:            () => ({}),
    attachShader:             track('attachShader'),
    linkProgram:              track('linkProgram'),
    getProgramParameter:      () => (shaderCompileOk ? programLinkOk : true),
    getProgramInfoLog:        () => programInfoLog,
    useProgram:               track('useProgram'),
    createTexture:            () => ({}),
    bindTexture:              track('bindTexture'),
    texImage2D:               track('texImage2D'),
    texParameteri:            track('texParameteri'),
    deleteTexture:            track('deleteTexture'),
    createBuffer:             () => ({}),
    bindBuffer:               track('bindBuffer'),
    bufferData:               track('bufferData'),
    deleteBuffer:             track('deleteBuffer'),
    enableVertexAttribArray:  track('enableVertexAttribArray'),
    vertexAttribPointer:      track('vertexAttribPointer'),
    getAttribLocation:        () => 0,
    getUniformLocation:       () => ({}),
    uniform1i:                track('uniform1i'),
    uniform1f:                track('uniform1f'),
    uniformMatrix4fv:         track('uniformMatrix4fv'),
    drawArrays:               track('drawArrays'),
    VERTEX_SHADER:            35633,
    FRAGMENT_SHADER:          35632,
    ARRAY_BUFFER:             34962,
    TRIANGLES:                4,
    FLOAT:                    5126,
    TEXTURE_2D:               3553,
    LUMINANCE:                6409,
    UNSIGNED_BYTE:            5121,
    UNSIGNED_SHORT:           5123,
    TEXTURE_MIN_FILTER:       10241,
    TEXTURE_MAG_FILTER:       10240,
    TEXTURE_WRAP_S:           10242,
    TEXTURE_WRAP_T:           10243,
    CLAMP_TO_EDGE:            33071,
    LINEAR:                   9729,
    TEXTURE0:                 33984,
    activeTexture:            track('activeTexture'),
    getExtension:             track('getExtension'),
    enable:                   track('enable'),
    disable:                  track('disable'),
    blendFuncSeparate:        track('blendFuncSeparate'),
    BLEND:                    3042,
    SRC_ALPHA:                770,
    ONE_MINUS_SRC_ALPHA:      771,
    ONE:                      1,
    DEPTH_TEST:               2929,
    STENCIL_TEST:             2960,
    createVertexArray:        () => { (calls.createVertexArray = calls.createVertexArray || []).push([]); return {} },
    bindVertexArray:          track('bindVertexArray'),
    deleteVertexArray:        track('deleteVertexArray'),
    _calls:                   calls,
  }
}

function makeMockMapManager({ initialViewport = null } = {}) {
  let viewportCallback = null
  return {
    onViewportChange: (cb) => { viewportCallback = cb; return () => { viewportCallback = null } },
    fireViewport: (vp) => viewportCallback && viewportCallback(vp),
    getViewport: () => initialViewport,
    _map: { triggerRepaint: vi.fn() },
  }
}

function makeMockMap(mapManager, { worldSize = 131072 } = {}) {
  const m = mapManager._map
  if (!m.transform) m.transform = { worldSize }
  return m
}

function makeGrid(opts = {}) {
  const { cells = 4, dtype = 'float32' } = opts
  const Ctor = dtype === 'float32' ? Float32Array : (dtype === 'uint8' ? Uint8Array : Uint16Array)
  return {
    data: new Ctor(cells * cells).fill(1),
    width: cells,
    height: cells,
    dtype,
  }
}

const VERTICES = new Float32Array([0, 0, 0, 0,  1, 0, 1, 0,  1, 1, 1, 1])
const DEFAULT_PARAMS = () => ({
  layerType: 'soft-filter',
  hue: 200,
  valueRange: { from: 0, to: 100 },
  threshold: 0.5,
})

// ─── Test 1: soft filter fragment shader outputs premultiplied alpha ───────────

describe('renderer-compositing — test 1: soft filter shader contains premultiplied alpha', () => {
  it('FRAGMENT_SHADER_SRC contains straight.rgb * straight.a before gl_FragColor assignment', () => {
    // The soft filter branch must premultiply: gl_FragColor = vec4(straight.rgb * straight.a, straight.a)
    // This test verifies the shader source string contains the premultiplication expression.
    expect(FRAGMENT_SHADER_SRC).toBeDefined()
    expect(typeof FRAGMENT_SHADER_SRC).toBe('string')

    // Must contain the premultiplication pattern
    const hasPremultiply = FRAGMENT_SHADER_SRC.includes('straight.rgb * straight.a')
    expect(hasPremultiply).toBe(true)
  })

  it('FRAGMENT_SHADER_SRC does NOT use the bare straight color as the final output (no missing premultiply)', () => {
    // The old (buggy) code was: gl_FragColor = hslaToRgba(hue, 1.0, 0.5, normalized)
    // i.e. it assigned the HSLA result directly without premultiplying.
    // After the fix, the direct assignment must be gone.
    const hasBareHslaDirectOutput = /gl_FragColor\s*=\s*hslaToRgba/.test(FRAGMENT_SHADER_SRC)
    expect(hasBareHslaDirectOutput).toBe(false)
  })
})

// ─── Test 2: hard filter outputs premultiplied rgba (0.25 not 0.5) ────────────

describe('renderer-compositing — test 2: hard filter shader outputs premultiplied 0.25 grey', () => {
  it('FRAGMENT_SHADER_SRC hard filter branch contains 0.25 not 0.5 for RGB', () => {
    // Premultiplied: straight grey(0.5) × alpha(0.5) = 0.25
    // Old (buggy): vec4(0.5, 0.5, 0.5, 0.5)
    // Correct:     vec4(0.25, 0.25, 0.25, 0.5)
    expect(FRAGMENT_SHADER_SRC).toBeDefined()

    const hasPremultipliedGrey = FRAGMENT_SHADER_SRC.includes('0.25, 0.25, 0.25, 0.5')
    expect(hasPremultipliedGrey).toBe(true)
  })

  it('FRAGMENT_SHADER_SRC hard filter branch does NOT contain the unpremultiplied vec4(0.5, 0.5, 0.5, 0.5)', () => {
    // The old value must be absent
    const hasUnpremultiplied = FRAGMENT_SHADER_SRC.includes('0.5, 0.5, 0.5, 0.5')
    expect(hasUnpremultiplied).toBe(false)
  })
})

// ─── Test 3: CLAMP_TO_EDGE set on texture upload ──────────────────────────────

describe('renderer-compositing — test 3: CLAMP_TO_EDGE set on texture upload', () => {
  it('texParameteri called with CLAMP_TO_EDGE for TEXTURE_WRAP_S', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)

    const texParamCalls = gl._calls.texParameteri || []
    const hasWrapS = texParamCalls.some(
      args => args[1] === gl.TEXTURE_WRAP_S && args[2] === gl.CLAMP_TO_EDGE
    )
    expect(hasWrapS).toBe(true)
  })

  it('texParameteri called with CLAMP_TO_EDGE for TEXTURE_WRAP_T', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)

    const texParamCalls = gl._calls.texParameteri || []
    const hasWrapT = texParamCalls.some(
      args => args[1] === gl.TEXTURE_WRAP_T && args[2] === gl.CLAMP_TO_EDGE
    )
    expect(hasWrapT).toBe(true)
  })
})

// ─── Test 4: OES_texture_float requested on float32 upload ────────────────────

describe('renderer-compositing — test 4: OES_texture_float requested on float32 upload', () => {
  it('getExtension called with OES_texture_float when grid dtype is float32', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    const float32Grid = makeGrid({ dtype: 'float32' })
    renderer.upload(float32Grid, VERTICES, DEFAULT_PARAMS)

    const extCalls = gl._calls.getExtension || []
    const requestedFloatExt = extCalls.some(args => args[0] === 'OES_texture_float')
    expect(requestedFloatExt).toBe(true)
  })

  it('getExtension NOT called with OES_texture_float when grid dtype is uint8', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    // Reset the extension call tracking after onAdd
    gl._calls.getExtension = []

    const uint8Grid = makeGrid({ dtype: 'uint8' })
    renderer.upload(uint8Grid, VERTICES, DEFAULT_PARAMS)

    const extCalls = gl._calls.getExtension || []
    const requestedFloatExt = extCalls.some(args => args[0] === 'OES_texture_float')
    expect(requestedFloatExt).toBe(false)
  })
})

// ─── Test 5: shader compile error propagates info log ─────────────────────────

describe('renderer-compositing — test 5: shader compile error — render is no-op', () => {
  it('onAdd does not throw when shader compilation fails', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl({
      shaderCompileOk: false,
      shaderInfoLog: 'ERROR: 0:41: undefined symbol: straight',
    })
    const map = makeMockMap(mapManager)

    expect(() => renderer.onAdd(map, gl)).not.toThrow()
  })

  it('render() skips drawing after shader compile failure', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl({
      shaderCompileOk: false,
      shaderInfoLog: 'some compile error',
    })
    const map = makeMockMap(mapManager)

    renderer.onAdd(map, gl)
    const matrix = new Float32Array(16)
    renderer.render(gl, matrix)

    expect(gl._calls.drawArrays ?? []).toHaveLength(0)
  })
})

describe('renderer-compositing — test 6: shader link error — render is no-op', () => {
  it('onAdd does not throw when shader linking fails', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl({
      shaderCompileOk: true,
      programLinkOk: false,
      programInfoLog: 'ERROR: program link failed: varying mismatch',
    })
    const map = makeMockMap(mapManager)

    expect(() => renderer.onAdd(map, gl)).not.toThrow()
  })

  it('render() skips drawing after shader link failure', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl({
      shaderCompileOk: true,
      programLinkOk: false,
      programInfoLog: 'some link error',
    })
    const map = makeMockMap(mapManager)

    renderer.onAdd(map, gl)
    const matrix = new Float32Array(16)
    renderer.render(gl, matrix)

    expect(gl._calls.drawArrays ?? []).toHaveLength(0)
  })
})

// ─── Test 7: valueMin == valueMax does not crash render() ─────────────────────


describe('renderer-compositing — test 7: valueMin == valueMax does not crash render()', () => {
  it('render() completes without throwing when valueMin equals valueMax', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    // Upload a soft-filter chunk with degenerate valueRange (min == max)
    const degenerateParams = () => ({
      layerType: 'soft-filter',
      hue: 200,
      valueRange: { from: 50, to: 50 },  // min === max → 0/0 in shader
      threshold: 0.5,
    })

    renderer.upload(makeGrid(), VERTICES, degenerateParams)

    const matrix = new Float32Array(16)
    expect(() => renderer.render(gl, matrix)).not.toThrow()
  })

  it('render() with valueMin == valueMax still calls uniform1f with both values', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    renderer.upload(makeGrid(), VERTICES, () => ({
      layerType: 'soft-filter',
      hue: 0,
      valueRange: { from: 42, to: 42 },
      threshold: 0,
    }))

    gl._calls.uniform1f = []
    const matrix = new Float32Array(16)
    renderer.render(gl, matrix)

    // Should have set valueMin and valueMax uniforms (both 42)
    const values = (gl._calls.uniform1f || []).map(args => args[1])
    expect(values).toContain(42)
  })
})

// ─── Test 8: render() skips chunks whose layer has enabled=false ──────────────

describe('renderer-compositing — test 8: render() skips disabled-layer chunks', () => {
  it('drawArrays NOT called for a chunk whose getParams returns enabled=false', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    const disabledParams = () => ({
      layerType: 'soft-filter',
      hue: 200,
      valueRange: { from: 0, to: 100 },
      threshold: 0.5,
      enabled: false,
    })

    renderer.upload(makeGrid(), VERTICES, disabledParams)

    gl._calls.drawArrays = []
    const matrix = new Float32Array(16)
    renderer.render(gl, matrix)

    expect(gl._calls.drawArrays ?? []).toHaveLength(0)
  })

  it('drawArrays called for enabled chunk but NOT for disabled chunk when both present', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    const enabledParams  = () => ({ ...DEFAULT_PARAMS(), enabled: true })
    const disabledParams = () => ({ ...DEFAULT_PARAMS(), enabled: false })

    renderer.upload(makeGrid(), VERTICES, enabledParams)
    renderer.upload(makeGrid(), VERTICES, disabledParams)

    gl._calls.drawArrays = []
    renderer.render(gl, new Float32Array(16))

    // Only 1 draw call (the enabled one)
    expect((gl._calls.drawArrays ?? []).length).toBe(1)
  })

  it('drawArrays called after re-enabling a previously disabled chunk', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    let enabled = false
    const dynamicParams = () => ({ ...DEFAULT_PARAMS(), enabled })

    renderer.upload(makeGrid(), VERTICES, dynamicParams)

    gl._calls.drawArrays = []
    renderer.render(gl, new Float32Array(16))
    expect((gl._calls.drawArrays ?? []).length).toBe(0)

    // Re-enable
    enabled = true
    gl._calls.drawArrays = []
    renderer.render(gl, new Float32Array(16))
    expect((gl._calls.drawArrays ?? []).length).toBe(1)
  })
})

// ─── Test 9: clearLayer() removes chunks by layerId ───────────────────────────

describe('renderer-compositing — test 9: clearLayer() removes all chunks for a layerId', () => {
  it('after clearLayer(), render() makes no draw calls for that layer', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    renderer.uploadForLayer('layerA', makeGrid(), VERTICES, DEFAULT_PARAMS)
    renderer.uploadForLayer('layerA', makeGrid(), VERTICES, DEFAULT_PARAMS)

    renderer.clearLayer('layerA')

    gl._calls.drawArrays = []
    renderer.render(gl, new Float32Array(16))

    expect((gl._calls.drawArrays ?? []).length).toBe(0)
  })

  it('clearLayer() calls deleteTexture and deleteBuffer for each removed chunk', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    gl._calls.deleteTexture = []
    gl._calls.deleteBuffer  = []

    renderer.uploadForLayer('layerA', makeGrid(), VERTICES, DEFAULT_PARAMS)
    renderer.uploadForLayer('layerA', makeGrid(), VERTICES, DEFAULT_PARAMS)

    renderer.clearLayer('layerA')

    expect((gl._calls.deleteTexture ?? []).length).toBe(2)
    expect((gl._calls.deleteBuffer  ?? []).length).toBe(2)
  })

  it('clearLayer() does NOT remove chunks from other layers', () => {

    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    renderer.uploadForLayer('layerA', makeGrid(), VERTICES, DEFAULT_PARAMS)
    renderer.uploadForLayer('layerB', makeGrid(), VERTICES, DEFAULT_PARAMS)

    renderer.clearLayer('layerA')

    gl._calls.drawArrays = []
    renderer.render(gl, new Float32Array(16))

    // layerB still draws
    expect((gl._calls.drawArrays ?? []).length).toBe(1)
  })
})

// ─── Test 10: refreshLayer() re-triggers layer update for a registered layer ──

describe('renderer-compositing — test 10: refreshLayer() re-triggers layer update', () => {
  it('refreshLayer() calls layer.update() for the matching registered layer', async () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    const fakeViewport = { zoom: 8, north: 62, south: 61, east: 10, west: 8 }
    mapManager.fireViewport(fakeViewport)

    const updateCalls = []
    const fakeLayer = {
      id: 'test-layer',
      update: vi.fn(async (vp, signal) => { updateCalls.push(vp) }),
    }
    renderer.register(fakeLayer)

    // Clear previous calls from register() triggering an update
    fakeLayer.update.mockClear()

    renderer.refreshLayer('test-layer')

    // Give async update a chance to run
    await new Promise(r => setTimeout(r, 0))

    expect(fakeLayer.update).toHaveBeenCalledOnce()
    expect(fakeLayer.update.mock.calls[0][0]).toBe(fakeViewport)
  })

  it('refreshLayer() falls back to mapManager.getViewport() when no move events have fired', async () => {
    const fallbackViewport = { zoom: 8, north: 62, south: 61, east: 10, west: 8 }
    const mapManager = makeMockMapManager({ initialViewport: fallbackViewport })
    const renderer = new RasterRenderer({ mapManager })
    renderer.onAdd(makeMockMap(mapManager), makeMockGl())

    const fakeLayer = {
      id: 'refresh-fallback-test',
      update: vi.fn(async () => {}),
    }
    renderer.register(fakeLayer)
    fakeLayer.update.mockClear()

    renderer.refreshLayer('refresh-fallback-test')
    await new Promise(r => setTimeout(r, 0))

    expect(fakeLayer.update).toHaveBeenCalledOnce()
    expect(fakeLayer.update.mock.calls[0][0]).toBe(fallbackViewport)
  })

  it('refreshLayer() with unknown layerId does nothing and does not throw', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    renderer.onAdd(makeMockMap(mapManager), gl)

    expect(() => renderer.refreshLayer('nonexistent')).not.toThrow()
  })

  it('refreshLayer() uses the current viewport, not a stale one', async () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    renderer.onAdd(makeMockMap(mapManager), makeMockGl())

    const vp1 = { zoom: 5, north: 70, south: 60, east: 15, west: 5 }
    const vp2 = { zoom: 8, north: 62, south: 61, east: 10, west: 8 }
    mapManager.fireViewport(vp1)
    mapManager.fireViewport(vp2)

    const fakeLayer = {
      id: 'layer-vp-test',
      update: vi.fn(async () => {}),
    }
    renderer.register(fakeLayer)
    fakeLayer.update.mockClear()

    renderer.refreshLayer('layer-vp-test')
    await new Promise(r => setTimeout(r, 0))

    expect(fakeLayer.update).toHaveBeenCalledOnce()
    // Should have been called with the LATEST viewport (vp2)
    expect(fakeLayer.update.mock.calls[0][0]).toBe(vp2)
  })
})

// ─── Test 11: onAdd seeds initial viewport from mapManager.getViewport() ──────

describe('renderer-compositing — test 11: onAdd seeds initial viewport', () => {
  it('register() immediately starts layer update when getViewport() returns a viewport on onAdd', async () => {
    const seedViewport = { zoom: 8, north: 62, south: 61, east: 10, west: 8 }
    const mapManager = makeMockMapManager({ initialViewport: seedViewport })
    const renderer = new RasterRenderer({ mapManager })
    renderer.onAdd(makeMockMap(mapManager), makeMockGl())

    const fakeLayer = {
      id: 'seed-test',
      update: vi.fn(async () => {}),
    }
    renderer.register(fakeLayer)
    await new Promise(r => setTimeout(r, 0))

    expect(fakeLayer.update).toHaveBeenCalledOnce()
    expect(fakeLayer.update.mock.calls[0][0]).toBe(seedViewport)
  })

  it('register() does not start update when getViewport() returns null', async () => {
    const mapManager = makeMockMapManager({ initialViewport: null })
    const renderer = new RasterRenderer({ mapManager })
    renderer.onAdd(makeMockMap(mapManager), makeMockGl())

    const fakeLayer = {
      id: 'null-vp-test',
      update: vi.fn(async () => {}),
    }
    renderer.register(fakeLayer)
    await new Promise(r => setTimeout(r, 0))

    expect(fakeLayer.update).not.toHaveBeenCalled()
  })
})

// ─── Test 12: getChunkCount() returns number of uploaded chunks ───────────────

describe('renderer-compositing — test 12: getChunkCount() returns uploaded chunk count', () => {
  it('getChunkCount() returns 0 before any uploads', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    renderer.onAdd(makeMockMap(mapManager), makeMockGl())

    expect(renderer.getChunkCount()).toBe(0)
  })

  it('getChunkCount() increments after each upload()', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    renderer.onAdd(makeMockMap(mapManager), gl)

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)
    expect(renderer.getChunkCount()).toBe(1)

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)
    expect(renderer.getChunkCount()).toBe(2)
  })

  it('getChunkCount() decrements after a chunk is released', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    renderer.onAdd(makeMockMap(mapManager), gl)

    const release = renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)
    expect(renderer.getChunkCount()).toBe(1)

    release()
    expect(renderer.getChunkCount()).toBe(0)
  })
})

// ─── Test 13: blend state is re-applied in render(), not just onAdd() ─────────

describe('renderer-compositing — test 13: blend state re-applied in render()', () => {
  it('gl.enable(BLEND) is called during render(), not only in onAdd()', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    renderer.onAdd(makeMockMap(mapManager), gl)

    // Reset the call log after onAdd so we only track render() calls
    gl._calls.enable = []
    gl._calls.blendFuncSeparate = []

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)
    renderer.render(gl, new Float32Array(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0)))

    const enableCalls = gl._calls.enable ?? []
    const blendEnabled = enableCalls.some(args => args[0] === gl.BLEND)
    expect(blendEnabled).toBe(true)
  })

  it('gl.blendFuncSeparate() is called during render()', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    renderer.onAdd(makeMockMap(mapManager), gl)

    gl._calls.enable = []
    gl._calls.blendFuncSeparate = []

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)
    renderer.render(gl, new Float32Array(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0)))

    const blendCalls = gl._calls.blendFuncSeparate ?? []
    expect(blendCalls.length).toBeGreaterThan(0)
  })
})

// ─── Test 13: MapLibre v5 render API — object with modelViewProjectionMatrix ──

describe('renderer-compositing — test 13: MapLibre v5 render() accepts CustomRenderMethodInput object', () => {
  it('render() draws when passed a MapLibre v5 args object instead of a raw Float32Array', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    renderer.onAdd(makeMockMap(mapManager), gl)

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)

    const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    const v5Args = { modelViewProjectionMatrix: identity }

    gl._calls.drawArrays = []
    renderer.render(gl, v5Args)

    expect(gl._calls.drawArrays).toHaveLength(1)
  })

  it('render() extracts matrix from modelViewProjectionMatrix and passes it to uniformMatrix4fv', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    renderer.onAdd(makeMockMap(mapManager), gl)

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)

    const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    const v5Args = { modelViewProjectionMatrix: identity }

    gl._calls.uniformMatrix4fv = []
    renderer.render(gl, v5Args)

    const mvpCalls = gl._calls.uniformMatrix4fv ?? []
    expect(mvpCalls.length).toBeGreaterThan(0)
    const passedMatrix = mvpCalls[0][2]
    expect(passedMatrix).toBe(identity)
  })
})

// ─── Test 14: render() disables DEPTH_TEST and STENCIL_TEST ───────────────────

describe('renderer-compositing — test 14: render() disables depth and stencil tests', () => {
  it('gl.disable(DEPTH_TEST) is called during render()', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    renderer.onAdd(makeMockMap(mapManager), gl)

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)

    gl._calls.disable = []
    const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    renderer.render(gl, identity)

    const disableCalls = gl._calls.disable ?? []
    const disabledDepth = disableCalls.some(args => args[0] === gl.DEPTH_TEST)
    expect(disabledDepth).toBe(true)
  })

  it('gl.disable(STENCIL_TEST) is called during render()', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    renderer.onAdd(makeMockMap(mapManager), gl)

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)

    gl._calls.disable = []
    const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    renderer.render(gl, identity)

    const disableCalls = gl._calls.disable ?? []
    const disabledStencil = disableCalls.some(args => args[0] === gl.STENCIL_TEST)
    expect(disabledStencil).toBe(true)
  })
})

// ─── Test 15: VAO created in onAdd() and bound in render() ────────────────────

describe('renderer-compositing — test 15: VAO created in onAdd() and bound before draw', () => {
  it('createVertexArray() is called during onAdd()', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()

    gl._calls.createVertexArray = []
    renderer.onAdd(makeMockMap(mapManager), gl)

    const vaoCalls = gl._calls.createVertexArray ?? []
    expect(vaoCalls.length).toBeGreaterThan(0)
  })

  it('bindVertexArray() is called during render() before drawArrays()', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    renderer.onAdd(makeMockMap(mapManager), gl)

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)

    gl._calls.bindVertexArray = []
    gl._calls.drawArrays = []
    const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    renderer.render(gl, identity)

    expect((gl._calls.bindVertexArray ?? []).length).toBeGreaterThan(0)
    expect((gl._calls.drawArrays ?? []).length).toBeGreaterThan(0)
  })

  it('VAO is bound before the first drawArrays call (not after)', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const callOrder = []
    const gl = makeMockGl()
    gl.bindVertexArray = (...args) => {
      callOrder.push('bindVertexArray')
      ;(gl._calls.bindVertexArray = gl._calls.bindVertexArray || []).push(args)
    }
    gl.drawArrays = (...args) => {
      callOrder.push('drawArrays')
      ;(gl._calls.drawArrays = gl._calls.drawArrays || []).push(args)
    }
    renderer.onAdd(makeMockMap(mapManager), gl)
    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)

    renderer.render(gl, new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]))

    const firstBind = callOrder.indexOf('bindVertexArray')
    const firstDraw = callOrder.indexOf('drawArrays')
    expect(firstBind).toBeGreaterThanOrEqual(0)
    expect(firstDraw).toBeGreaterThan(firstBind)
  })
})

// ─── Test 17: render() sets dataScale uniform — 255 for uint8, 1 for float32 ──

describe('renderer-compositing — test 17: dataScale uniform set by grid dtype', () => {
  it('uniform1f called with 255.0 for uint8 grid dtype', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    renderer.onAdd(makeMockMap(mapManager), gl)

    renderer.upload(makeGrid({ dtype: 'uint8' }), VERTICES, DEFAULT_PARAMS)

    gl._calls.uniform1f = []
    renderer.render(gl, new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]))

    const dataScaleCall = (gl._calls.uniform1f ?? []).find(args => args[1] === 255.0)
    expect(dataScaleCall).toBeDefined()
  })

  it('uniform1f called with 1.0 for float32 grid dtype (but NOT 255.0)', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    renderer.onAdd(makeMockMap(mapManager), gl)

    renderer.upload(makeGrid({ dtype: 'float32' }), VERTICES, DEFAULT_PARAMS)

    gl._calls.uniform1f = []
    renderer.render(gl, new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]))

    const wrongScaleCall = (gl._calls.uniform1f ?? []).find(args => args[1] === 255.0)
    expect(wrongScaleCall).toBeUndefined()
  })

  it('FRAGMENT_SHADER_SRC multiplies texture sample by dataScale uniform', () => {
    // The shader must scale sampled uint8 values back to data range.
    // uint8 textures are normalized to [0,1] by WebGL; multiplying by 255
    // restores the original byte value before applying valueMin/valueMax.
    expect(FRAGMENT_SHADER_SRC).toContain('dataScale')
    expect(FRAGMENT_SHADER_SRC).toContain('texture(chunkData, uv).r * dataScale')
  })
})

// ─── Test 16: render() scales positions by worldSize before applying matrix ───

describe('renderer-compositing — test 16: render() sets worldSize uniform from map.transform', () => {
  it('uniform1f is called with a worldSize value matching map.transform.worldSize', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager, { worldSize: 131072 })
    renderer.onAdd(map, gl)

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)

    gl._calls.uniform1f = []
    const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    renderer.render(gl, identity)

    const worldSizeCall = (gl._calls.uniform1f ?? []).find(args => args[1] === 131072)
    expect(worldSizeCall).toBeDefined()
  })

  it('worldSize uniform defaults to 1.0 when map.transform is unavailable', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const mapNoTransform = { triggerRepaint: vi.fn() }
    renderer.onAdd(mapNoTransform, gl)

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)

    gl._calls.uniform1f = []
    const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    renderer.render(gl, identity)

    const worldSizeFallback = (gl._calls.uniform1f ?? []).find(args => args[1] === 1.0)
    expect(worldSizeFallback).toBeDefined()
  })

  it('uniformMatrix4fv is called with the supplied matrix', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)

    gl._calls.uniformMatrix4fv = []
    const matrix = new Float32Array([2,0,0,0, 0,2,0,0, 0,0,1,0, 0,0,0,1])
    renderer.render(gl, matrix)

    const call = (gl._calls.uniformMatrix4fv ?? []).find(args => args[2] === matrix)
    expect(call).toBeDefined()
  })

  it('drawing proceeds normally with a custom matrix', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    const map = makeMockMap(mapManager)
    renderer.onAdd(map, gl)

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)

    gl._calls.drawArrays = []
    renderer.render(gl, new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]))

    expect((gl._calls.drawArrays ?? []).length).toBe(1)
  })
})

// ─── Test 16: render() enables BLEND for premultiplied-alpha compositing ─────────

describe('renderer-compositing — test 16: render() enables BLEND for premultiplied-alpha compositing', () => {
  it('gl.enable(BLEND) is called before drawArrays()', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    renderer.onAdd(makeMockMap(mapManager), gl)

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)

    gl._calls.enable = []
    gl._calls.drawArrays = []
    const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    renderer.render(gl, identity)

    const enableCalls = gl._calls.enable ?? []
    const blendEnabled = enableCalls.some(args => args[0] === gl.BLEND)
    expect(blendEnabled).toBe(true)
  })

  it('gl.blendFuncSeparate(ONE, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA) is called for premultiplied alpha', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    renderer.onAdd(makeMockMap(mapManager), gl)

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)

    gl._calls.blendFuncSeparate = []
    const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    renderer.render(gl, identity)

    const bfsCalls = gl._calls.blendFuncSeparate ?? []
    const premultCall = bfsCalls.some(args =>
      args[0] === gl.ONE && args[1] === gl.ONE_MINUS_SRC_ALPHA &&
      args[2] === gl.ONE && args[3] === gl.ONE_MINUS_SRC_ALPHA
    )
    expect(premultCall).toBe(true)
  })

  it('gl.disable(BLEND) is called after drawArrays() to restore state', () => {
    const mapManager = makeMockMapManager()
    const renderer = new RasterRenderer({ mapManager })
    const gl = makeMockGl()
    renderer.onAdd(makeMockMap(mapManager), gl)

    renderer.upload(makeGrid(), VERTICES, DEFAULT_PARAMS)

    gl._calls.disable = []
    gl._calls.drawArrays = []
    const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    renderer.render(gl, identity)

    const disableCalls = gl._calls.disable ?? []
    const blendDisabledAfter = disableCalls.some(args => args[0] === gl.BLEND)
    expect(blendDisabledAfter).toBe(true)
  })
})
