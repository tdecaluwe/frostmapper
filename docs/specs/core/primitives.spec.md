# Spec: Core Primitives

This document specifies the core spatial and data primitives used throughout the application. New primitives should be added here as needed.

All primitives are plain ES6 classes, importable from `core/primitives.js`. No external dependencies except `proj4js` (used by `Extent`).

---

## `registerCRS(definitions)` (module-level utility)

Registers proj4js CRS definitions. Must be called before any `Extent` is constructed using a non-built-in CRS.

```javascript
registerCRS({
  'EPSG:25833': '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  'EPSG:3035':  '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs'
})
```

Internally calls `proj4.defs(code, def)` for each entry. `EPSG:4326` and `EPSG:3857` are built into proj4js and do not need registration.

If an `Extent` is constructed with an unregistered CRS, proj4js will throw a meaningful error.

---

## `Extent` (`core/primitives.js`)

A geographic region with a known CRS. Pure spatial concept — no data, no resolution. All spatial reasoning in the application goes through Extent.

### Constructor

```javascript
new Extent({ north, south, east, west, crs })
// north, south, east, west: numbers in the units of the given CRS
// crs: string EPSG code e.g. 'EPSG:4326', 'EPSG:25833', 'EPSG:3035'
```

**Note on field names for projected CRS**: `north`, `south`, `east`, `west` are used consistently throughout for readability. For projected CRS (e.g. EPSG:3857, EPSG:25833, EPSG:3035) where units are meters, interpret as: `north=maxY`, `south=minY`, `east=maxX`, `west=minX`. These are not compass directions but axis extremes.

### Methods

#### `toBoundingBox(targetCRS)` → `{ north, south, east, west }`
Reprojects this Extent's bounding box into `targetCRS`. Reprojects all four corners and edge midpoints, then returns the bounding envelope of the reprojected points.

**Note**: this is an approximation. For large Extents in highly curved projections, the true bounding envelope may extend beyond what corners and midpoints produce (e.g. a projection where the top edge bulges above both top corners). For our use case (Scandinavian latitudes, UTM/LAEA projections, moderate tile sizes) this approximation is accurate enough.

#### `toCorners(targetCRS)` → `[topLeft, topRight, bottomRight, bottomLeft]`
Returns the four corners in `targetCRS` as `{ x, y }` objects. Utility derived from `toBoundingBox` — calls `toBoundingBox` internally and constructs corners from the result.

#### `cover(targetCRS)` → `Extent`
Returns a new `Extent` in `targetCRS` whose bounds fully contain this Extent when reprojected. Equivalent to `new Extent({ ...this.toBoundingBox(targetCRS), crs: targetCRS })`.

**Note**: inherits the approximation from `toBoundingBox` — the returned Extent is guaranteed to cover the original only to the accuracy of the midpoint sampling. In practice this is sufficient for our use case.

#### `maxDistortion(targetCRS)` → `number`
Returns the maximum geometric distortion as a fraction of the Extent's diagonal in `targetCRS` when this Extent is linearly stretched to `targetCRS`. A value of 0.005 means no point on the boundary is displaced by more than 0.5% of the diagonal compared to its correctly reprojected position.

Algorithm:
1. Reproject all four corners to `targetCRS`
2. For each edge, compute the linearly interpolated midpoint (average of the two reprojected corners)
3. Also reproject the true geographic midpoint of each edge to `targetCRS`
4. Compute displacement between linear midpoint and true reprojected midpoint for each edge
5. Return `max(displacements) / diagonal` where `diagonal` is the length of the bounding rectangle diagonal in `targetCRS`

**Note**: this is an approximation — it samples distortion at edge midpoints only. The true maximum distortion could occur at other points along the edges for highly curved projections or very large Extents. For our use case this approximation is sufficient.

#### `translateResolution(resolution, targetCRS)` → `number`
Converts a resolution value expressed in this Extent's CRS units to the equivalent resolution in `targetCRS` units at this Extent's location (using the Extent center point as the reference). Used by Sources to convert a requested resolution to their native CRS resolution before stride selection.

Example: an Extent in EPSG:4326 (degrees) with resolution 0.009° → translates to ~1000m in EPSG:3857 at 65°N.

#### `width()` → `number`
Returns the width of the Extent in its native CRS units (east - west).

#### `height()` → `number`
Returns the height of the Extent in its native CRS units (north - south).

#### `center()` → `{ x, y }`
Returns the center point in native CRS units.

### Notes
- `toBoundingBox` reprojects edge midpoints in addition to corners to handle curved projection boundaries correctly. For small Extents this is negligible; for large Extents near the poles it matters.
- proj4js is the only external dependency. All CRS transformations go through `proj4js.transform()`.
- Required CRS definitions must be registered at app startup: EPSG:25833, EPSG:3035. EPSG:4326 and EPSG:3857 are built into proj4js.

---

## `Grid` (`core/primitives.js`)

A typed 2D raster array. Pure data concept — no spatial identity, no CRS.

### Constructor

```javascript
new Grid({ data, width, height, dtype })
// data:   TypedArray matching dtype
// width:  number of cells in x dimension (columns)
// height: number of cells in y dimension (rows)
// dtype:  'float32' | 'uint8' | 'uint16'
```

### Properties

- `data` — the underlying TypedArray (`Float32Array`, `Uint8Array`, or `Uint16Array`)
- `width` — number of columns
- `height` — number of rows
- `dtype` — string dtype identifier

**Note**: use `grid.data.BYTES_PER_ELEMENT` to get bytes per cell (4 for float32, 2 for uint16, 1 for uint8) — this is provided natively by the TypedArray class.

### Methods

#### `get(x, y)` → `number`
Returns the cell value at column `x`, row `y`. Row-major order: index = `y * width + x`.

#### `slice(x0, y0, x1, y1)` → `Grid`
Returns a new Grid covering the sub-region `[x0..x1, y0..y1]` (inclusive). The returned Grid has width `x1 - x0 + 1` and height `y1 - y0 + 1`.

#### `toArrayBuffer()` → `ArrayBuffer`
Returns the underlying buffer as an ArrayBuffer. Used for IndexedDB storage.

#### `static fromArrayBuffer(buffer, width, height, dtype)` → `Grid`
Reconstructs a Grid from a stored ArrayBuffer. Used by Sources on cache retrieval.

### Notes
- Cells are stored in row-major order (left to right, top to bottom).
- `slice()` copies data — it does not return a view.

---

## `GridTransform` (`core/primitives.js`)

Describes the coordinate system of a source's chunk grid. An immutable value type — one instance per Source, shared across all its `TileId`s. Analogous to OGC WMTS `TileMatrixSet`.

### Constructor

```javascript
new GridTransform({ originX, originY, chunkSize, baseResolution, nativeCRS })
// originX, originY:  grid origin in native CRS units — where chunkX=0, chunkY=0 starts
// chunkSize:         spatial size of one chunk in native CRS units
// baseResolution:    finest native resolution in CRS units per cell
// nativeCRS:         EPSG code string e.g. 'EPSG:3035'
```

All properties are read-only after construction. No methods — pure value type.

### Properties

- `originX`, `originY` — grid origin in native CRS units
- `chunkSize` — spatial size of one chunk in native CRS units
- `baseResolution` — finest native resolution in CRS units per cell
- `nativeCRS` — EPSG code string

### Note on origin

The grid origin is not necessarily the CRS origin. THREDDS/SeNorge data starts at a specific geographic corner that does not coincide with the LAEA projection origin. Each Source defines its own `GridTransform` with the correct origin for that dataset.

### Note on chunkSize units

`chunkSize` is in the native CRS units — meters for projected CRS (EPSG:25833, EPSG:3035, EPSG:3857) and degrees for geographic CRS (EPSG:4326). `baseResolution` follows the same convention.

---

## `TileId` (`core/primitives.js`)

Identifies one specific tile within a source's chunk grid. An immutable value type — analogous to OGC WMTS tile identifier (TileMatrix + row + col), or a generalisation of XYZ `{z}/{x}/{y}` with an explicit CRS and fixed grid boundaries.

Unlike standard XYZ tiles (where tile boundaries change per zoom level), `chunkX`/`chunkY` always refer to the same geographic area regardless of `stride`. `stride` only affects cell count within a fixed tile boundary.

### Constructor

```javascript
new TileId({ chunkX, chunkY, stride, transform })
// chunkX, chunkY:  integer grid coordinates
// stride:          positive integer, power-of-2 — resolution multiplier
// transform:       GridTransform instance — shared across all TileIds from the same Source
```

All properties are read-only after construction.

### Properties

- `chunkX`, `chunkY` — integer grid coordinates
- `stride` — resolution multiplier
- `transform` — `GridTransform` reference

### Derived properties

```javascript
get extent()       // → Extent (lazy, cached) — geographic bounds in native CRS
get cellsPerSide() // → integer — Math.round(transform.chunkSize / (transform.baseResolution * stride))
get cellSize()     // → number — transform.baseResolution * stride
```

`extent` is computed from integer arithmetic — rounding errors can only occur at the final step, not accumulate:

```javascript
get extent() {
  return this.#extent ??= new Extent({
    west:  this.transform.originX + this.chunkX * this.transform.chunkSize,
    east:  this.transform.originX + (this.chunkX + 1) * this.transform.chunkSize,
    south: this.transform.originY + this.chunkY * this.transform.chunkSize,
    north: this.transform.originY + (this.chunkY + 1) * this.transform.chunkSize,
    crs:   this.transform.nativeCRS
  })
}
```

### `toString()` → `string`

Returns a stable string identifier for use as a cache key suffix:

```
'{chunkX},{chunkY}:{stride}'
```

This is the source-relative portion of the cache key. The full cache key is `sourceId + ':' + tileId.toString()`.

---

## `Chunk` (`core/primitives.js`)

Combines a `TileId` with a `Grid`. A fully georeferenced raster tile — the fundamental unit yielded by Sources and consumed by Layers.

### Constructor

```javascript
new Chunk({ tileId, grid })
// tileId: TileId instance — full spatial identity including CRS, origin, stride
// grid:   Grid instance — raster data
```

### Properties

- `tileId` — the `TileId` identifying this chunk's position, stride, and coordinate system
- `grid` — the `Grid` containing the raster data
- `extent` — shorthand for `tileId.extent`

### Derived properties

- **Resolution**: `tileId.cellSize` in native CRS units per cell
- **Dimensions**: `tileId.cellsPerSide × tileId.cellsPerSide`

---

## `Viewport` (`core/primitives.js`)

A specialised Extent representing the current map view in Web Mercator (EPSG:3857). Carries additional rendering context needed by Layers for resolution calculation. Always in EPSG:3857 — the conversion from MapLibre's WGS84 output happens in `map.js` via `cover('EPSG:3857')` before the Viewport is emitted.

### Constructor

```javascript
new Viewport({ north, south, east, west, zoom, widthPx, heightPx })
// crs is always EPSG:3857 — not a constructor parameter
```

- `north`, `south`, `east`, `west` — Web Mercator meters
- `zoom` — MapLibre zoom level (number)
- `widthPx` — viewport width in screen pixels
- `heightPx` — viewport height in screen pixels

### Derived methods

#### `resolution()` → `number`
Returns the appropriate source resolution in meters per cell — at 2x finer than the current screen pixel size, as required by ADR-003:
```javascript
this.width() / this.widthPx / 2
```

Used by Layers as the resolution argument to `source.get()`. All resolution-to-CRS conversions are handled downstream by `extent.translateResolution()`.

### Notes
- `Viewport` extends `Extent` — all Extent methods are available including `cover()`, `translateResolution()`, `toBoundingBox()` etc.
- The WGS84→Web Mercator conversion is handled once in `map.js`, not in Layers.
- `zoom` is retained for stride calculations and debugging but resolution is derived from extent dimensions and pixel count, not from zoom directly.

---

## Test cases

### Extent

**1. `cover()` round-trip**
Create Extent in EPSG:25833. Call `cover('EPSG:4326')`. Verify all four original corners, when reprojected to EPSG:4326, fall within the returned bounding box.

**2. `maxDistortion()` small extent**
Create a small Extent (1km × 1km) in EPSG:3035 at 65°N. Verify `maxDistortion('EPSG:3857') < 0.001`.

**3. `maxDistortion()` large extent**
Create a large Extent (500km × 500km) in EPSG:3035 at 65°N. Verify `maxDistortion('EPSG:3857') > 0.005`.

**4. `translateResolution()` degrees to meters**
Create Extent in EPSG:4326 at 65°N. Call `translateResolution(0.009, 'EPSG:3857')`. Verify result is approximately 1000m (±5%).

**5. `translateResolution()` meters to degrees**
Create Extent in EPSG:3857 at 65°N. Call `translateResolution(1000, 'EPSG:4326')`. Verify result is approximately 0.009° (±5%).

**6. `toCorners()` derived from `toBoundingBox()`**
Verify `toCorners()` returns the four corners of `toBoundingBox()` result as `{ x, y }` objects. topLeft matches `{ x: west, y: north }`, topRight matches `{ x: east, y: north }`, bottomRight matches `{ x: east, y: south }`, bottomLeft matches `{ x: west, y: south }` in the target CRS.

**7. `toBoundingBox()` known coordinates**
Create Extent in EPSG:25833 with known easting/northing values corresponding to a specific WGS84 bounding box. Call `toBoundingBox('EPSG:4326')`. Verify north/south/east/west match expected WGS84 values (±0.001°). This verifies proj4js is correctly registered and transforms are working.

**8. `cover()` same CRS**
Create Extent in EPSG:4326. Call `cover('EPSG:4326')`. Verify returned Extent has identical north/south/east/west values.

**9. `width()`, `height()`, `center()` basic correctness**
Create Extent with north=10, south=5, east=20, west=8, crs='EPSG:4326'. Verify `width()=12`, `height()=5`, `center()={x:14, y:7.5}`.

**10. proj4js CRS registration**
Verify that calling `proj4('EPSG:25833', 'EPSG:4326', [500000, 7000000])` returns a result close to known WGS84 coordinates (±0.001°). This confirms EPSG:25833 and EPSG:3035 are registered at app startup before any Extent operations run.

### Grid

**11. `get()` row-major order**
Create Grid width=3, height=2, data=[1,2,3,4,5,6]. Verify `get(0,0)=1`, `get(2,0)=3`, `get(0,1)=4`, `get(2,1)=6`.

**12. `slice()` dimensions**
Create 10×10 Grid. Call `slice(2, 3, 5, 7)`. Verify result has width=4, height=5.

**13. `slice()` data correctness**
Create 4×4 Grid with known values. Slice a 2×2 sub-region. Verify all four values match original grid at correct positions.

**14. `slice()` full grid**
Create 4×4 Grid. Call `slice(0, 0, 3, 3)`. Verify result is a copy of the full grid with identical values. Verify result is a new object (not the same reference).

**15. `toArrayBuffer()` / `fromArrayBuffer()` round-trip — Float32**
Create Float32 Grid with known values. Convert to ArrayBuffer and back. Verify all values match original.

**16. `toArrayBuffer()` / `fromArrayBuffer()` round-trip — Uint8**
Create Uint8 Grid with known values including 0 and 255. Convert to ArrayBuffer and back. Verify all values match original.

**17. `toArrayBuffer()` / `fromArrayBuffer()` round-trip — Uint16**
Create Uint16 Grid with known values including 0 and 65535. Convert to ArrayBuffer and back. Verify all values match original.

### GridTransform

**18. Extent from TileId uses origin**
Create GridTransform with originX=1000, originY=2000, chunkSize=500, baseResolution=1, nativeCRS='EPSG:3035'. Create TileId with chunkX=2, chunkY=3, stride=1. Verify `tileId.extent.west === 1000 + 2*500 === 2000`. Verify `tileId.extent.south === 2000 + 3*500 === 3500`.

**19. cellsPerSide at various strides**
Create GridTransform with chunkSize=512000, baseResolution=1000. Create TileId at stride=1. Verify `cellsPerSide === 512`. At stride=2 verify `cellsPerSide === 256`. At stride=4 verify `cellsPerSide === 128`.

**20. cellSize**
GridTransform with baseResolution=1000. TileId with stride=4. Verify `tileId.cellSize === 4000`.

### TileId

**21. toString() format**
Create TileId with chunkX=4, chunkY=12, stride=2. Verify `tileId.toString() === '4,12:2'`.

**22. extent is lazily cached**
Create TileId. Access `extent` twice. Verify same object reference returned both times (lazy cache hit).

**23. Two TileIds with same coords produce same toString()**
Create two TileId instances with identical chunkX/chunkY/stride (but same transform). Verify `toString()` values are identical.

**24. Two TileIds with different coords produce different toString()**
Verify different chunkX produces different `toString()`. Verify different stride produces different `toString()`.

### Chunk

**25. Chunk extent shorthand**
Create Chunk with a TileId. Verify `chunk.extent === chunk.tileId.extent`.

**26. Chunk resolution via tileId**
Create Chunk with GridTransform baseResolution=1000, stride=2. Verify `chunk.tileId.cellSize === 2000`.

### Viewport

**27. `resolution()` basic correctness**
Create Viewport with west=0, east=1000000 (1000km wide in Web Mercator), widthPx=1000. Verify `resolution()` = 500m (1000000 / 1000 / 2).

**28. `resolution()` scales with viewport width**
Create two Viewports with the same geographic extent but widthPx=500 and widthPx=1000. Verify resolution() for widthPx=1000 is exactly half that of widthPx=500.

**29. `resolution()` scales with geographic width**
Create two Viewports with the same widthPx but one covering twice the geographic width. Verify the wider Viewport has twice the resolution() value.

**30. Viewport inherits Extent methods**
Create Viewport with known Web Mercator bounds. Call `cover('EPSG:3035')`. Verify result is an Extent in EPSG:3035 that covers the original bounds. Verify Viewport CRS is EPSG:3857.
