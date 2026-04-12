const MERCATOR_HALF_WORLD = 20037508.3427892
const MERCATOR_FULL_WORLD = MERCATOR_HALF_WORLD * 2

function getProj4() {
  if (typeof globalThis.proj4 !== 'undefined') return globalThis.proj4
  throw new Error('proj4 not available')
}

function metersToMercator(x3857, y3857) {
  return [
    (x3857 + MERCATOR_HALF_WORLD) / MERCATOR_FULL_WORLD,
    (MERCATOR_HALF_WORLD - y3857) / MERCATOR_FULL_WORLD,
  ]
}

function chunkKey(chunk) {
  return chunk.tileId.toString()
}

function meshDensity(distortion) {
  if (distortion < 0.001) return 2
  if (distortion < 0.005) return 4
  if (distortion < 0.02)  return 8
  return 16
}

export class RasterLayer {
  #chunks = new Map()
  #id
  #renderer

  constructor({ id, source, renderer, params }) {
    this.#id = id
    this.source = source
    this.#renderer = renderer
    this.params = params
  }

  get id() {
    return this.#id
  }

  get isRasterLayer() {
    return true
  }

  get layerType() { throw new Error('layerType must be implemented by subclass') }
  get hue()       { throw new Error('hue must be implemented by subclass') }
  get valueRange() { throw new Error('valueRange must be implemented by subclass') }
  get threshold() { throw new Error('threshold must be implemented by subclass') }

  async update(viewport, signal) {
    const newKeys = new Set()
    let completed = false

    try {
      for await (const chunk of this.source.get(viewport, viewport.resolution(), signal)) {
        if (signal?.aborted) break

        const key = chunkKey(chunk)
        newKeys.add(key)

        if (!this.#chunks.has(key)) {
          const vertices = this.generateMesh(chunk, 'EPSG:3857')
          const release = this.#renderer.upload(chunk.grid, vertices, () => this.#visualParams(), this.#id)
          this.#chunks.set(key, release)
        }
      }
      completed = !signal?.aborted
    } catch (err) {
      if (err?.name !== 'AbortError') throw err
    }

    if (completed) {
      for (const [key, release] of this.#chunks) {
        if (!newKeys.has(key)) {
          release()
          this.#chunks.delete(key)
        }
      }
    }
  }

  generateMesh(chunk, targetCRS) {
    const proj4 = getProj4()
    const ext = chunk.tileId.extent
    const distortion = ext.maxDistortion(targetCRS)
    const N = meshDensity(distortion)

    const floatsPerVertex = 4
    const trianglesPerQuad = 2
    const verticesPerTriangle = 3
    const quads = (N - 1) * (N - 1)
    const totalVertices = quads * trianglesPerQuad * verticesPerTriangle
    const out = new Float32Array(totalVertices * floatsPerVertex)

    const pts = new Array(N * N)
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        const srcX = ext.west  + (col / (N - 1)) * (ext.east  - ext.west)
        const srcY = ext.north - (row / (N - 1)) * (ext.north - ext.south)
        const [px3857, py3857] = proj4(ext.crs, targetCRS, [srcX, srcY])
        const [px, py] = targetCRS === 'EPSG:3857'
          ? metersToMercator(px3857, py3857)
          : [px3857, py3857]
        const u = col / (N - 1)
        const v = row / (N - 1)
        pts[row * N + col] = { x: px, y: py, u, v }
      }
    }

    let idx = 0
    const write = (p) => {
      out[idx++] = p.x
      out[idx++] = p.y
      out[idx++] = p.u
      out[idx++] = p.v
    }

    for (let row = 0; row < N - 1; row++) {
      for (let col = 0; col < N - 1; col++) {
        const tl = pts[row       * N + col]
        const tr = pts[row       * N + col + 1]
        const bl = pts[(row + 1) * N + col]
        const br = pts[(row + 1) * N + col + 1]
        write(tl); write(tr); write(br)
        write(tl); write(br); write(bl)
      }
    }

    return out
  }

  #visualParams() {
    return {
      layerType: this.layerType,
      hue: this.hue,
      valueRange: this.valueRange,
      threshold: this.threshold,
    }
  }
}
