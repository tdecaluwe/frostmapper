import { describe, it, expect, beforeAll } from 'vitest'
import proj4 from 'proj4'
import { registerCRS, Extent, Grid, GridTransform, TileId, Chunk, Viewport } from '../../src/core/primitives.js'

beforeAll(() => {
  registerCRS({
    'EPSG:25833': '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
    'EPSG:3035':  '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs'
  })
})

describe('Extent — cover() round-trip (test 1)', () => {
  it('all four corners reprojected to EPSG:4326 fall within covered bbox', () => {
    const ext = new Extent({ west: 250000, east: 260000, south: 6640000, north: 6650000, crs: 'EPSG:25833' })
    const covered = ext.cover('EPSG:4326')
    expect(covered.crs).toBe('EPSG:4326')

    const corners = [
      [ext.west, ext.north],
      [ext.east, ext.north],
      [ext.east, ext.south],
      [ext.west, ext.south],
    ]
    for (const [x, y] of corners) {
      const [lon, lat] = proj4('EPSG:25833', 'EPSG:4326', [x, y])
      expect(lon).toBeGreaterThanOrEqual(covered.west  - 1e-6)
      expect(lon).toBeLessThanOrEqual   (covered.east  + 1e-6)
      expect(lat).toBeGreaterThanOrEqual(covered.south - 1e-6)
      expect(lat).toBeLessThanOrEqual   (covered.north + 1e-6)
    }
  })
})

describe('Extent — maxDistortion() small extent (test 2)', () => {
  it('1km×1km in EPSG:3035 at 65°N → distortion < 0.001', () => {
    const [cx, cy] = proj4('EPSG:4326', 'EPSG:3035', [15, 65])
    const ext = new Extent({
      west: cx - 500, east: cx + 500,
      south: cy - 500, north: cy + 500,
      crs: 'EPSG:3035'
    })
    expect(ext.maxDistortion('EPSG:3857')).toBeLessThan(0.001)
  })
})

describe('Extent — maxDistortion() large extent (test 3)', () => {
  it('500km×500km in EPSG:3035 at 65°N → distortion > 0.005', () => {
    const [cx, cy] = proj4('EPSG:4326', 'EPSG:3035', [15, 65])
    const ext = new Extent({
      west: cx - 250000, east: cx + 250000,
      south: cy - 250000, north: cy + 250000,
      crs: 'EPSG:3035'
    })
    expect(ext.maxDistortion('EPSG:3857')).toBeGreaterThan(0.005)
  })
})

describe('Extent — translateResolution() degrees to meters (test 4)', () => {
  it('0.009° in EPSG:4326 at 65°N translates to projected EPSG:3857 units (Mercator-scaled)', () => {
    const ext = new Extent({
      west: 14.9955, east: 15.0045,
      south: 64.9955, north: 65.0045,
      crs: 'EPSG:4326'
    })
    const m = ext.translateResolution(0.009, 'EPSG:3857')
    expect(m).toBeGreaterThan(2000)
    expect(m).toBeLessThan(3000)
  })
})

describe('Extent — translateResolution() meters to degrees (test 5)', () => {
  it('1000m in EPSG:3857 at 65°N translates to EPSG:4326 degrees (Mercator-scaled)', () => {
    const [cx, cy] = proj4('EPSG:4326', 'EPSG:3857', [15, 65])
    const ext = new Extent({
      west: cx - 500, east: cx + 500,
      south: cy - 500, north: cy + 500,
      crs: 'EPSG:3857'
    })
    const deg = ext.translateResolution(1000, 'EPSG:4326')
    expect(deg).toBeGreaterThan(0.002)
    expect(deg).toBeLessThan(0.007)
  })
})

describe('Extent — toCorners() derived from toBoundingBox() (test 6)', () => {
  it('four corners match bounding box extremes', () => {
    const ext = new Extent({ west: 10, east: 20, south: 60, north: 70, crs: 'EPSG:4326' })
    const bb = ext.toBoundingBox('EPSG:3857')
    const corners = ext.toCorners('EPSG:3857')
    expect(corners).toHaveLength(4)
    expect(corners[0].x).toBeCloseTo(bb.west,  0)
    expect(corners[0].y).toBeCloseTo(bb.north, 0)
    expect(corners[1].x).toBeCloseTo(bb.east,  0)
    expect(corners[1].y).toBeCloseTo(bb.north, 0)
    expect(corners[2].x).toBeCloseTo(bb.east,  0)
    expect(corners[2].y).toBeCloseTo(bb.south, 0)
    expect(corners[3].x).toBeCloseTo(bb.west,  0)
    expect(corners[3].y).toBeCloseTo(bb.south, 0)
  })
})

describe('Extent — toBoundingBox() known coordinates (test 7)', () => {
  it('EPSG:25833 easting/northing projects to expected WGS84 bbox (±0.1°)', () => {
    const ext = new Extent({ west: 474000, east: 526000, south: 6929000, north: 7042000, crs: 'EPSG:25833' })
    const bb = ext.toBoundingBox('EPSG:4326')
    expect(bb.west).toBeGreaterThan(14.0)
    expect(bb.east).toBeLessThan(16.0)
    expect(bb.south).toBeGreaterThan(62.0)
    expect(bb.north).toBeLessThan(64.0)
  })
})

describe('Extent — cover() same CRS (test 8)', () => {
  it('cover(same CRS) returns identical bounds', () => {
    const ext = new Extent({ west: 5, east: 15, south: 55, north: 65, crs: 'EPSG:4326' })
    const covered = ext.cover('EPSG:4326')
    expect(covered.west).toBeCloseTo(ext.west,   6)
    expect(covered.east).toBeCloseTo(ext.east,   6)
    expect(covered.south).toBeCloseTo(ext.south, 6)
    expect(covered.north).toBeCloseTo(ext.north, 6)
  })
})

describe('Extent — width(), height(), center() (test 9)', () => {
  it('computes correctly for a simple extent', () => {
    const ext = new Extent({ north: 10, south: 5, east: 20, west: 8, crs: 'EPSG:4326' })
    expect(ext.width()).toBe(12)
    expect(ext.height()).toBe(5)
    expect(ext.center()).toEqual({ x: 14, y: 7.5 })
  })
})

describe('Extent — proj4js CRS registration (test 10)', () => {
  it('EPSG:25833 transform to EPSG:4326 returns known coordinates', () => {
    const [lon, lat] = proj4('EPSG:25833', 'EPSG:4326', [500000, 6985589])
    expect(lon).toBeCloseTo(15.0, 1)
    expect(lat).toBeCloseTo(63.0, 1)
  })
})

describe('Grid — get() row-major order (test 11)', () => {
  it('get(x, y) = data[y * width + x]', () => {
    const g = new Grid({ data: new Float32Array([1, 2, 3, 4, 5, 6]), width: 3, height: 2, dtype: 'float32' })
    expect(g.get(0, 0)).toBe(1)
    expect(g.get(2, 0)).toBe(3)
    expect(g.get(0, 1)).toBe(4)
    expect(g.get(2, 1)).toBe(6)
  })
})

describe('Grid — slice() dimensions (test 12)', () => {
  it('slice(2,3,5,7) produces width=4, height=5', () => {
    const g = new Grid({ data: new Float32Array(100), width: 10, height: 10, dtype: 'float32' })
    const s = g.slice(2, 3, 5, 7)
    expect(s.width).toBe(4)
    expect(s.height).toBe(5)
  })
})

describe('Grid — slice() data correctness (test 13)', () => {
  it('sliced values match original grid at correct positions', () => {
    const values = Array.from({ length: 16 }, (_, i) => i)
    const g = new Grid({ data: new Float32Array(values), width: 4, height: 4, dtype: 'float32' })
    const s = g.slice(1, 1, 2, 2)
    expect(s.get(0, 0)).toBe(g.get(1, 1))
    expect(s.get(1, 0)).toBe(g.get(2, 1))
    expect(s.get(0, 1)).toBe(g.get(1, 2))
    expect(s.get(1, 1)).toBe(g.get(2, 2))
  })
})

describe('Grid — slice() full grid is copy (test 14)', () => {
  it('full-grid slice has identical values and is a new object', () => {
    const values = Array.from({ length: 16 }, (_, i) => i)
    const g = new Grid({ data: new Float32Array(values), width: 4, height: 4, dtype: 'float32' })
    const s = g.slice(0, 0, 3, 3)
    expect(s).not.toBe(g)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(s.get(x, y)).toBe(g.get(x, y))
      }
    }
  })
})

describe('Grid — toArrayBuffer / fromArrayBuffer round-trip Float32 (test 15)', () => {
  it('Float32 values survive serialisation', () => {
    const values = [1.1, 2.2, 3.3, 4.4]
    const g = new Grid({ data: new Float32Array(values), width: 2, height: 2, dtype: 'float32' })
    const g2 = Grid.fromArrayBuffer(g.toArrayBuffer(), 2, 2, 'float32')
    for (let i = 0; i < values.length; i++) {
      expect(g2.data[i]).toBeCloseTo(values[i], 4)
    }
  })
})

describe('Grid — toArrayBuffer / fromArrayBuffer round-trip Uint8 (test 16)', () => {
  it('Uint8 values survive serialisation including 0 and 255', () => {
    const values = [0, 1, 127, 255]
    const g = new Grid({ data: new Uint8Array(values), width: 2, height: 2, dtype: 'uint8' })
    const g2 = Grid.fromArrayBuffer(g.toArrayBuffer(), 2, 2, 'uint8')
    for (let i = 0; i < values.length; i++) {
      expect(g2.data[i]).toBe(values[i])
    }
  })
})

describe('Grid — toArrayBuffer / fromArrayBuffer round-trip Uint16 (test 17)', () => {
  it('Uint16 values survive serialisation including 0 and 65535', () => {
    const values = [0, 1000, 32768, 65535]
    const g = new Grid({ data: new Uint16Array(values), width: 2, height: 2, dtype: 'uint16' })
    const g2 = Grid.fromArrayBuffer(g.toArrayBuffer(), 2, 2, 'uint16')
    for (let i = 0; i < values.length; i++) {
      expect(g2.data[i]).toBe(values[i])
    }
  })
})

describe('GridTransform — extent from TileId uses origin (test 18)', () => {
  it('tileId.extent.west and .south computed from origin + chunkX/Y * chunkSize', () => {
    const transform = new GridTransform({
      originX: 1000, originY: 2000,
      chunkSize: 500, baseResolution: 1,
      nativeCRS: 'EPSG:3035'
    })
    const tileId = new TileId({ chunkX: 2, chunkY: 3, stride: 1, transform })
    expect(tileId.extent.west).toBe(1000 + 2 * 500)
    expect(tileId.extent.south).toBe(2000 + 3 * 500)
  })
})

describe('GridTransform — cellsPerSide at various strides (test 19)', () => {
  it('cellsPerSide = chunkSize / (baseResolution * stride)', () => {
    const transform = new GridTransform({
      originX: 0, originY: 0,
      chunkSize: 512000, baseResolution: 1000,
      nativeCRS: 'EPSG:3035'
    })
    expect(new TileId({ chunkX: 0, chunkY: 0, stride: 1, transform }).cellsPerSide).toBe(512)
    expect(new TileId({ chunkX: 0, chunkY: 0, stride: 2, transform }).cellsPerSide).toBe(256)
    expect(new TileId({ chunkX: 0, chunkY: 0, stride: 4, transform }).cellsPerSide).toBe(128)
  })
})

describe('GridTransform — cellSize (test 20)', () => {
  it('cellSize = baseResolution * stride', () => {
    const transform = new GridTransform({
      originX: 0, originY: 0,
      chunkSize: 512000, baseResolution: 1000,
      nativeCRS: 'EPSG:3035'
    })
    const tileId = new TileId({ chunkX: 0, chunkY: 0, stride: 4, transform })
    expect(tileId.cellSize).toBe(4000)
  })
})

const makeTransform = () => new GridTransform({
  originX: 0, originY: 0,
  chunkSize: 100000, baseResolution: 1000,
  nativeCRS: 'EPSG:3035'
})

describe('TileId — toString() format (test 21)', () => {
  it("produces '{chunkX},{chunkY}:{stride}'", () => {
    const tileId = new TileId({ chunkX: 4, chunkY: 12, stride: 2, transform: makeTransform() })
    expect(tileId.toString()).toBe('4,12:2')
  })
})

describe('TileId — extent is lazily cached (test 22)', () => {
  it('accessing extent twice returns the same object reference', () => {
    const tileId = new TileId({ chunkX: 1, chunkY: 1, stride: 1, transform: makeTransform() })
    const first = tileId.extent
    const second = tileId.extent
    expect(second).toBe(first)
  })
})

describe('TileId — same coords produce same toString() (test 23)', () => {
  it('two TileIds with identical coords have identical toString()', () => {
    const t = makeTransform()
    const a = new TileId({ chunkX: 3, chunkY: 5, stride: 2, transform: t })
    const b = new TileId({ chunkX: 3, chunkY: 5, stride: 2, transform: t })
    expect(a.toString()).toBe(b.toString())
  })
})

describe('TileId — different coords produce different toString() (test 24)', () => {
  it('different chunkX or stride changes toString()', () => {
    const t = makeTransform()
    const base = new TileId({ chunkX: 3, chunkY: 5, stride: 2, transform: t })
    const diffX    = new TileId({ chunkX: 4, chunkY: 5, stride: 2, transform: t })
    const diffStride = new TileId({ chunkX: 3, chunkY: 5, stride: 4, transform: t })
    expect(diffX.toString()).not.toBe(base.toString())
    expect(diffStride.toString()).not.toBe(base.toString())
  })
})

describe('Chunk — extent shorthand (test 25)', () => {
  it('chunk.extent === chunk.tileId.extent', () => {
    const tileId = new TileId({ chunkX: 1, chunkY: 1, stride: 1, transform: makeTransform() })
    const grid   = new Grid({ data: new Float32Array(100 * 100), width: 100, height: 100, dtype: 'float32' })
    const chunk  = new Chunk({ tileId, grid })
    expect(chunk.extent).toBe(chunk.tileId.extent)
  })
})

describe('Chunk — resolution via tileId (test 26)', () => {
  it('chunk.tileId.cellSize = baseResolution * stride', () => {
    const transform = new GridTransform({
      originX: 0, originY: 0,
      chunkSize: 512000, baseResolution: 1000,
      nativeCRS: 'EPSG:3035'
    })
    const tileId = new TileId({ chunkX: 0, chunkY: 0, stride: 2, transform })
    const grid   = new Grid({ data: new Float32Array(256 * 256), width: 256, height: 256, dtype: 'float32' })
    const chunk  = new Chunk({ tileId, grid })
    expect(chunk.tileId.cellSize).toBe(2000)
  })
})

describe('Viewport — resolution() basic correctness (test 27)', () => {
  it('resolution() = width / widthPx / 2', () => {
    const vp = new Viewport({
      west: 0, east: 1000000,
      south: 0, north: 1000000,
      zoom: 8, widthPx: 1000, heightPx: 1000
    })
    expect(vp.resolution()).toBe(500)
  })
})

describe('Viewport — resolution() scales with widthPx (test 28)', () => {
  it('doubling widthPx halves resolution()', () => {
    const base = { west: 0, east: 1000000, south: 0, north: 1000000, zoom: 8 }
    const vp500  = new Viewport({ ...base, widthPx: 500,  heightPx: 500 })
    const vp1000 = new Viewport({ ...base, widthPx: 1000, heightPx: 1000 })
    expect(vp1000.resolution()).toBeCloseTo(vp500.resolution() / 2, 10)
  })
})

describe('Viewport — resolution() scales with geographic width (test 29)', () => {
  it('doubling geographic width doubles resolution()', () => {
    const base = { west: 0, south: 0, north: 1000000, zoom: 8, widthPx: 1000, heightPx: 1000 }
    const vp1 = new Viewport({ ...base, east: 1000000 })
    const vp2 = new Viewport({ ...base, east: 2000000 })
    expect(vp2.resolution()).toBeCloseTo(vp1.resolution() * 2, 10)
  })
})

describe('Viewport — inherits Extent methods (test 30)', () => {
  it('cover() works and CRS is EPSG:3857', () => {
    const [cx, cy] = proj4('EPSG:4326', 'EPSG:3857', [15, 65])
    const vp = new Viewport({
      west: cx - 100000, east: cx + 100000,
      south: cy - 100000, north: cy + 100000,
      zoom: 8, widthPx: 1024, heightPx: 1024
    })
    expect(vp.crs).toBe('EPSG:3857')
    const covered = vp.cover('EPSG:3035')
    expect(covered.crs).toBe('EPSG:3035')
    const corners3857 = [
      [vp.west, vp.north], [vp.east, vp.north],
      [vp.east, vp.south], [vp.west, vp.south]
    ]
    for (const [x, y] of corners3857) {
      const [cx2, cy2] = proj4('EPSG:3857', 'EPSG:3035', [x, y])
      expect(cx2).toBeGreaterThanOrEqual(covered.west  - 1)
      expect(cx2).toBeLessThanOrEqual   (covered.east  + 1)
      expect(cy2).toBeGreaterThanOrEqual(covered.south - 1)
      expect(cy2).toBeLessThanOrEqual   (covered.north + 1)
    }
  })
})
