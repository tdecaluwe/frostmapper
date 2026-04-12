function getProj4() {
  if (typeof globalThis.proj4 !== 'undefined') return globalThis.proj4
  throw new Error('proj4 not available — load via CDN before using Extent')
}

export function registerCRS(definitions) {
  const proj4 = getProj4()
  for (const [code, def] of Object.entries(definitions)) {
    proj4.defs(code, def)
  }
}

export class Extent {
  constructor({ north, south, east, west, crs }) {
    this.north = north
    this.south = south
    this.east  = east
    this.west  = west
    this.crs   = crs
  }

  width()  { return this.east  - this.west  }
  height() { return this.north - this.south }
  center() { return { x: (this.west + this.east) / 2, y: (this.south + this.north) / 2 } }

  _samplePoints() {
    const { north, south, east, west } = this
    const midX = (west + east)   / 2
    const midY = (south + north) / 2
    return [
      [west,  north],
      [east,  north],
      [east,  south],
      [west,  south],
      [midX,  north],
      [east,  midY],
      [midX,  south],
      [west,  midY],
    ]
  }

  toBoundingBox(targetCRS) {
    const proj4 = getProj4()
    const pts = this._samplePoints().map(([x, y]) => proj4(this.crs, targetCRS, [x, y]))
    const xs = pts.map(p => p[0])
    const ys = pts.map(p => p[1])
    return {
      north: Math.max(...ys),
      south: Math.min(...ys),
      east:  Math.max(...xs),
      west:  Math.min(...xs),
    }
  }

  toCorners(targetCRS) {
    const bb = this.toBoundingBox(targetCRS)
    return [
      { x: bb.west, y: bb.north },
      { x: bb.east, y: bb.north },
      { x: bb.east, y: bb.south },
      { x: bb.west, y: bb.south },
    ]
  }

  cover(targetCRS) {
    return new Extent({ ...this.toBoundingBox(targetCRS), crs: targetCRS })
  }

  maxDistortion(targetCRS) {
    const proj4 = getProj4()
    const { north, south, east, west } = this
    const midX = (west + east)   / 2
    const midY = (south + north) / 2

    const rTL = proj4(this.crs, targetCRS, [west,  north])
    const rTR = proj4(this.crs, targetCRS, [east,  north])
    const rBR = proj4(this.crs, targetCRS, [east,  south])
    const rBL = proj4(this.crs, targetCRS, [west,  south])

    const rMidTop    = proj4(this.crs, targetCRS, [midX, north])
    const rMidRight  = proj4(this.crs, targetCRS, [east, midY])
    const rMidBottom = proj4(this.crs, targetCRS, [midX, south])
    const rMidLeft   = proj4(this.crs, targetCRS, [west, midY])

    const lMidTop    = [(rTL[0] + rTR[0]) / 2, (rTL[1] + rTR[1]) / 2]
    const lMidRight  = [(rTR[0] + rBR[0]) / 2, (rTR[1] + rBR[1]) / 2]
    const lMidBottom = [(rBL[0] + rBR[0]) / 2, (rBL[1] + rBR[1]) / 2]
    const lMidLeft   = [(rTL[0] + rBL[0]) / 2, (rTL[1] + rBL[1]) / 2]

    const dist2D = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)

    const displacements = [
      dist2D(lMidTop,    rMidTop),
      dist2D(lMidRight,  rMidRight),
      dist2D(lMidBottom, rMidBottom),
      dist2D(lMidLeft,   rMidLeft),
    ]

    const xs = [rTL[0], rTR[0], rBR[0], rBL[0]]
    const ys = [rTL[1], rTR[1], rBR[1], rBL[1]]
    const w  = Math.max(...xs) - Math.min(...xs)
    const h  = Math.max(...ys) - Math.min(...ys)
    const diagonal = Math.sqrt(w * w + h * h)

    if (diagonal === 0) return 0
    return Math.max(...displacements) / diagonal
  }

  translateResolution(resolution, targetCRS) {
    const proj4 = getProj4()
    const { x: cx, y: cy } = this.center()
    const p1 = proj4(this.crs, targetCRS, [cx, cy])
    const p2 = proj4(this.crs, targetCRS, [cx, cy + resolution])
    return Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2)
  }
}

const TYPED_ARRAY_CTOR = {
  float32: Float32Array,
  uint8:   Uint8Array,
  uint16:  Uint16Array,
}

export class Grid {
  constructor({ data, width, height, dtype }) {
    this.data   = data
    this.width  = width
    this.height = height
    this.dtype  = dtype
  }

  get(x, y) {
    return this.data[y * this.width + x]
  }

  slice(x0, y0, x1, y1) {
    const newWidth  = x1 - x0 + 1
    const newHeight = y1 - y0 + 1
    const Ctor = TYPED_ARRAY_CTOR[this.dtype] ?? Float32Array
    const newData = new Ctor(newWidth * newHeight)
    for (let row = 0; row < newHeight; row++) {
      for (let col = 0; col < newWidth; col++) {
        newData[row * newWidth + col] = this.data[(y0 + row) * this.width + (x0 + col)]
      }
    }
    return new Grid({ data: newData, width: newWidth, height: newHeight, dtype: this.dtype })
  }

  toArrayBuffer() {
    return this.data.buffer.slice(
      this.data.byteOffset,
      this.data.byteOffset + this.data.byteLength
    )
  }

  static fromArrayBuffer(buffer, width, height, dtype) {
    const Ctor = TYPED_ARRAY_CTOR[dtype] ?? Float32Array
    return new Grid({ data: new Ctor(buffer), width, height, dtype })
  }
}

export class GridTransform {
  constructor({ originX, originY, chunkSize, baseResolution, nativeCRS }) {
    this.originX       = originX
    this.originY       = originY
    this.chunkSize     = chunkSize
    this.baseResolution = baseResolution
    this.nativeCRS     = nativeCRS
    Object.freeze(this)
  }
}

export class TileId {
  #extent = null

  constructor({ chunkX, chunkY, stride, transform }) {
    this.chunkX     = chunkX
    this.chunkY     = chunkY
    this.stride     = stride
    this.transform  = transform
  }

  get extent() {
    if (this.#extent) return this.#extent
    const { originX, originY, chunkSize, nativeCRS } = this.transform
    this.#extent = new Extent({
      west:  originX + this.chunkX       * chunkSize,
      east:  originX + (this.chunkX + 1) * chunkSize,
      south: originY + this.chunkY       * chunkSize,
      north: originY + (this.chunkY + 1) * chunkSize,
      crs:   nativeCRS,
    })
    return this.#extent
  }

  get cellsPerSide() {
    return Math.round(this.transform.chunkSize / (this.transform.baseResolution * this.stride))
  }

  get cellSize() {
    return this.transform.baseResolution * this.stride
  }

  toString() {
    return `${this.chunkX},${this.chunkY}:${this.stride}`
  }
}

export class Chunk {
  constructor({ tileId, grid }) {
    this.tileId = tileId
    this.grid   = grid
  }

  get extent() {
    return this.tileId.extent
  }
}

export class Viewport extends Extent {
  constructor({ north, south, east, west, zoom, widthPx, heightPx }) {
    super({ north, south, east, west, crs: 'EPSG:3857' })
    this.zoom      = zoom
    this.widthPx   = widthPx
    this.heightPx  = heightPx
  }

  resolution() {
    return this.width() / this.widthPx / 2
  }
}
