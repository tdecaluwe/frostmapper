const VERTEX_SHADER_SRC = `#version 300 es
in vec2 position;
in vec2 texCoord;
uniform mat4 matrix;
uniform float worldSize;
out vec2 uv;
void main() {
  uv = texCoord;
  gl_Position = matrix * vec4(position * worldSize, 0.0, 1.0);
}
`

export const FRAGMENT_SHADER_SRC = `#version 300 es
precision mediump float;
uniform sampler2D chunkData;
uniform int layerType;
uniform float hue;
uniform float valueMin;
uniform float valueMax;
uniform float threshold;
uniform float dataScale;
in vec2 uv;
out vec4 fragColor;

vec4 hslaToRgba(float h, float s, float l, float a) {
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float hp = h / 60.0;
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  vec3 rgb;
  if      (hp < 1.0) rgb = vec3(c, x, 0.0);
  else if (hp < 2.0) rgb = vec3(x, c, 0.0);
  else if (hp < 3.0) rgb = vec3(0.0, c, x);
  else if (hp < 4.0) rgb = vec3(0.0, x, c);
  else if (hp < 5.0) rgb = vec3(x, 0.0, c);
  else               rgb = vec3(c, 0.0, x);
  float m = l - c / 2.0;
  return vec4(rgb + m, a);
}

void main() {
  float value = texture(chunkData, uv).r * dataScale;
  if (layerType == 0) {
    float range = valueMax - valueMin;
    float normalized = range == 0.0 ? 0.0 : clamp((value - valueMin) / range, 0.0, 1.0);
    vec4 straight = hslaToRgba(hue, 1.0, 0.5, normalized);
    fragColor = vec4(straight.rgb * straight.a, straight.a);
  } else {
    fragColor = value > threshold
      ? vec4(0.25, 0.25, 0.25, 0.5)
      : vec4(0.0, 0.0, 0.0, 0.0);
  }
}
`

export class RasterRenderer {
  #mapManager
  #gl = null
  #program = null
  #vao = null
  #map = null
  #layers = []
  #globalChunks = []
  #currentViewport = null
  #unsubscribeViewport = null
  #abortControllers = new Map()

  constructor({ mapManager }) {
    this.#mapManager = mapManager
  }

  get id() { return 'frostmapper-raster' }
  get type() { return 'custom' }

  refresh() { this.#map?.triggerRepaint() }

  getChunkCount() { return this.#globalChunks.length }

  onAdd(map, gl) {
    this.#gl = gl
    this.#map = map

    this.#program = this.#compileProgram(gl)
    this.#vao = gl.createVertexArray()

    const initialViewport = this.#mapManager.getViewport?.()
    if (initialViewport) this.#currentViewport = initialViewport

    this.#unsubscribeViewport = this.#mapManager.onViewportChange((viewport) => {
      this.#currentViewport = viewport
      this.#triggerLayerUpdates(viewport)
    })
  }

  render(glOrArgs, legacyArgs) {
    if (!this.#program) return

    let gl, rawMatrix
    if (glOrArgs && typeof glOrArgs === 'object' && 'modelViewProjectionMatrix' in glOrArgs) {
      gl = glOrArgs.gl
      rawMatrix = glOrArgs.modelViewProjectionMatrix
    } else {
      gl = glOrArgs
      rawMatrix = legacyArgs instanceof Float32Array ? legacyArgs : legacyArgs?.modelViewProjectionMatrix ?? legacyArgs
    }

    if (!gl || !rawMatrix) return
    const m = rawMatrix instanceof Float32Array ? rawMatrix : new Float32Array(rawMatrix)
    if (m.length !== 16) return

    gl.useProgram(this.#program)
    gl.bindVertexArray(this.#vao)

    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.STENCIL_TEST)

    const matLoc = gl.getUniformLocation(this.#program, 'matrix')
    if (!matLoc) return
    gl.uniformMatrix4fv(matLoc, false, m)

    const worldSize = this.#map?.transform?.worldSize ?? 1.0
    gl.uniform1f(gl.getUniformLocation(this.#program, 'worldSize'), worldSize)

    for (const entry of this.#globalChunks) {
      const params = entry.getParams()
      if (params.enabled === false) continue

      const layerTypeVal = params.layerType === 'hard-filter' ? 1 : 0
      const hue = params.hue ?? 0
      const valueMin = params.valueRange?.from ?? 0
      const valueMax = params.valueRange?.to ?? 1
      const threshold = params.threshold ?? 0.5

      gl.uniform1i(gl.getUniformLocation(this.#program, 'layerType'), layerTypeVal)
      gl.uniform1f(gl.getUniformLocation(this.#program, 'hue'), hue)
      gl.uniform1f(gl.getUniformLocation(this.#program, 'valueMin'), valueMin)
      gl.uniform1f(gl.getUniformLocation(this.#program, 'valueMax'), valueMax)
      gl.uniform1f(gl.getUniformLocation(this.#program, 'threshold'), threshold)
      gl.uniform1f(gl.getUniformLocation(this.#program, 'dataScale'), entry.dataScale ?? 1.0)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, entry.texture)
      gl.uniform1i(gl.getUniformLocation(this.#program, 'chunkData'), 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, entry.meshBuffer)
      const stride = 4 * 4
      const posLoc = gl.getAttribLocation(this.#program, 'position')
      const uvLoc = gl.getAttribLocation(this.#program, 'texCoord')
      gl.enableVertexAttribArray(posLoc)
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, stride, 0)
      gl.enableVertexAttribArray(uvLoc)
      gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, stride, 2 * 4)

      const vertexCount = entry.vertexCount
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount)
    }

    gl.disable(gl.BLEND)
  }

  onRemove(_map, gl) {
    this.#unsubscribeViewport?.()
    if (this.#vao) {
      gl.deleteVertexArray(this.#vao)
      this.#vao = null
    }
    for (const entry of this.#globalChunks) {
      entry.release()
    }
    this.#globalChunks = []
    for (const ac of this.#abortControllers.values()) {
      ac.abort()
    }
    this.#abortControllers.clear()
  }

  register(layer) {
    this.#layers.push(layer)
    if (this.#currentViewport) {
      this.#startLayerUpdate(layer, this.#currentViewport)
    }
  }

  unregister(layerId) {
    this.#layers = this.#layers.filter(l => l.id !== layerId)
    const ac = this.#abortControllers.get(layerId)
    if (ac) {
      ac.abort()
      this.#abortControllers.delete(layerId)
    }
    const remaining = this.#globalChunks.filter(e => e.layerId !== layerId)
    const toRelease = this.#globalChunks.filter(e => e.layerId === layerId)
    for (const e of toRelease) e.release()
    this.#globalChunks = remaining
  }

  refreshLayer(layerId) {
    const layer = this.#layers.find(l => l.id === layerId)
    if (!layer || !this.#currentViewport) return
    this.#startLayerUpdate(layer, this.#currentViewport)
  }

  clearLayer(layerId) {
    const toRelease = this.#globalChunks.filter(e => e.layerId === layerId)
    for (const e of toRelease) e.release()
    this.#globalChunks = this.#globalChunks.filter(e => e.layerId !== layerId)
    this.#map?.triggerRepaint()
  }

  upload(grid, vertices, getParams, layerId = null) {
    const gl = this.#gl
    const texture = this.#uploadTexture(gl, grid)
    const meshBuffer = this.#uploadMesh(gl, vertices)
    const vertexCount = vertices.length / 4

    const dataScale = grid.dtype === 'uint8' ? 255.0 : 1.0

    const release = () => {
      gl.deleteTexture(texture)
      gl.deleteBuffer(meshBuffer)
      const idx = this.#globalChunks.findIndex(e => e.texture === texture)
      if (idx !== -1) this.#globalChunks.splice(idx, 1)
    }

    this.#globalChunks.push({ getParams, texture, meshBuffer, vertexCount, layerId, dataScale, release })
    this.#map?.triggerRepaint()
    return release
  }

  uploadForLayer(layerId, grid, vertices, getParams) {
    return this.upload(grid, vertices, getParams, layerId)
  }

  #compileProgram(gl) {
    const vs = this.#compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC)
    if (!vs) return null
    const fs = this.#compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC)
    if (!fs) return null
    const program = gl.createProgram()
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS ?? 0x8B82)) {
      const log = gl.getProgramInfoLog(program)
      console.error(`Shader link failed: ${log}`)
      return null
    }
    return program
  }

  #compileShader(gl, type, src) {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, src)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS ?? 0x8B81)) {
      const log = gl.getShaderInfoLog(shader)
      console.error(`Shader compile failed: ${log}`)
      return null
    }
    return shader
  }

  #uploadTexture(gl, grid) {
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)

    if (grid.dtype === 'float32') {
      gl.getExtension('OES_texture_float')
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, grid.width, grid.height, 0, gl.RED, gl.FLOAT, grid.data)
    } else if (grid.dtype === 'uint16') {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI ?? gl.LUMINANCE, grid.width, grid.height, 0, gl.RED_INTEGER ?? gl.LUMINANCE, gl.UNSIGNED_SHORT, grid.data)
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, grid.width, grid.height, 0, gl.RED, gl.UNSIGNED_BYTE, grid.data)
    }

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return texture
  }

  #uploadMesh(gl, vertices) {
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW ?? 35044)
    return buffer
  }

  #triggerLayerUpdates(viewport) {
    for (const layer of this.#layers) {
      this.#startLayerUpdate(layer, viewport)
    }
  }

  #startLayerUpdate(layer, viewport) {
    const existing = this.#abortControllers.get(layer.id)
    if (existing) existing.abort()

    const ac = new AbortController()
    this.#abortControllers.set(layer.id, ac)

    Promise.resolve().then(async () => {
      if (ac.signal.aborted) return
      try {
        await layer.update(viewport, ac.signal)
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error(`Layer update failed for ${layer.id}:`, err)
        }
      }
    })
  }
}
