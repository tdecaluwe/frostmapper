# ADR-004: Projection Handling, Extent/Chunk/Grid Model and Layer-Source Spatial Contract

**Date:** 2026-03-15
**Status:** Accepted

## Context

Data sources use different native coordinate reference systems (CRS): SeNorge/NGCD use ETRS89-LAEA (EPSG:3035), hoydedata uses EPSG:25833, OSM data uses WGS84. MapLibre renders in Web Mercator (EPSG:3857). Displaying gridded raster data correctly requires handling the mismatch between source CRS and rendering CRS without introducing unacceptable geometric distortion.

THREDDS does not support server-side reprojection. Client-side handling is required.

Distortion is handled via an **adaptive mesh approach**: each Chunk is rendered as a mesh of N×N quads rather than a single quad. The mesh vertices are reprojected from source CRS to Web Mercator on the CPU via proj4js. Finer meshes approximate the true curved shape more accurately. This replaces the earlier approach of splitting Chunks into sub-Chunks — keeping one draw call per Chunk regardless of distortion.

## Decisions

### 1. `Extent` class (`core/primitives.js`)

A geographic region with a known CRS. Pure spatial concept — no resolution, no data. All spatial reasoning in the application goes through Extent.

```javascript
class Extent {
  constructor({ north, south, east, west, crs })

  // Returns a new Extent in targetCRS whose bounds fully contain this Extent.
  // Reprojects all four corners and edge midpoints, returns bounding envelope.
  // Uses proj4js internally.
  // Note: approximation — see primitives.spec.md for accuracy notes.
  cover(targetCRS)  // → Extent

  // Returns the maximum geometric distortion when this Extent is rendered
  // as a mesh in targetCRS. See primitives.spec.md for algorithm.
  // Used to determine required mesh density.
  maxDistortion(targetCRS)  // → number

  // Returns { north, south, east, west } in targetCRS.
  toBoundingBox(targetCRS)  // → { north, south, east, west }

  // Returns [topLeft, topRight, bottomRight, bottomLeft] each as { x, y } in targetCRS.
  // Utility derived from toBoundingBox.
  toCorners(targetCRS)  // → Array<{x, y}>

  // Converts a resolution value in this Extent's CRS to equivalent resolution in targetCRS.
  translateResolution(resolution, targetCRS)  // → number

  width()   // → number (east - west in native CRS units)
  height()  // → number (north - south in native CRS units)
  center()  // → { x, y } in native CRS units
}
```

### 2. `Grid` class (`core/primitives.js`)

A typed 2D raster array. Pure data concept — no spatial identity.

```javascript
class Grid {
  constructor({ data, width, height, dtype })
  // data:  TypedArray (Float32Array, Uint8Array, etc.)
  // width: number of cells in x dimension
  // height: number of cells in y dimension
  // dtype: 'float32' | 'uint8' | 'uint16'
}
```

### 3. `Chunk` class (`core/primitives.js`)

Combines an Extent with a Grid. A fully georeferenced raster tile. Returned by Sources to Layers.

```javascript
class Chunk {
  constructor({ extent, grid })

  extent  // Extent instance — spatial identity and CRS
  grid    // Grid instance — data
}
```

Chunk resolution = `extent.width() / grid.width` in native CRS units per cell.

`Chunk.split()` is not needed — distortion is handled by adaptive mesh density in the rendering layer. See ADR-005.

### 4. Source internal grid and `compute()`

Each Source has a fixed internal chunk grid in its native CRS:
- **Base resolution**: fixed in native CRS units (e.g. 1000m for SeNorge, 0.25m for hoydedata)
- **Chunk boundaries**: deterministic from base resolution and a fixed geographic chunk size per source
- **Available strides**: powers of 2 from base resolution (1×, 2×, 4×, 8×...)

The Source selects the appropriate stride based on the requested resolution, translated to native CRS:

```javascript
const nativeResolution = requestedExtent.translateResolution(requestedResolution, nativeCRS)
const stride = nearestPowerOf2(nativeResolution / baseResolution)
```

Subclasses implement:
```javascript
async compute(extent, stride, params, signal, dependencies = {})  // → Grid
```

The base class (`Source`) owns Chunk construction:
```javascript
const chunk = new Chunk({ extent: internalChunkExtent, grid })
// yield chunk, write to cache
```

`extent` passed to `compute()` is the Source's internal chunk Extent (in native CRS, aligned to chunk grid).

### 5. Source `get()` — async generator

```javascript
async *get(extent, resolution, params, signal)  // → AsyncGenerator<Chunk>
```

- `extent` — Extent in any CRS. Source calls `extent.cover(nativeCRS)` internally.
- `resolution` — requested resolution in Extent's CRS units. Source translates and selects stride.
- `params` — source-specific parameters, JSON-serialisable.
- `signal` — AbortSignal. If aborted, generator stops yielding.

Yields Chunks in source native CRS as they become available. The Source guarantees the union of all yielded Chunks fully covers the requested Extent.

### 6. Cache storage

Raw ArrayBuffers stored in IndexedDB. Source reconstructs Chunks on retrieval using internal chunk grid knowledge. The cache is a dumb ArrayBuffer store.

### 7. Layer spatial flow

Layers have no declared native CRS. They work with whatever CRS the Viewport provides and receive Chunks back from the Source.

On each viewport update:

1. Receive viewport Extent in WGS84 from MapLibre/Viewport
2. Call `source.get(viewportExtent, resolution, params, signal)`
3. Source handles coverage, CRS conversion, and stride selection internally
4. For each yielded Chunk:
   a. Compute required mesh density from `chunk.extent.maxDistortion('EPSG:3857')`
   b. Generate N×N mesh vertices in source CRS, reproject to Web Mercator via proj4js
   c. Upload mesh vertices and chunk data texture to GPU
   d. Render via MapLibre Custom Layer draw call
5. Purge previously rendered Chunks not present in the new set of yielded Chunks

### 8. Adaptive mesh density

Mesh density N×N is determined per Chunk based on distortion:

| `maxDistortion('EPSG:3857')` | Mesh density |
|------------------------------|--------------|
| < 0.001 | 2×2 (single quad) |
| < 0.005 | 4×4 |
| < 0.02  | 8×8 |
| ≥ 0.02  | 16×16 |

CPU cost: reprojecting up to 16×16 = 256 points via proj4js once per Chunk. Negligible.
GPU cost: up to 16×16×2 = 512 triangles per Chunk. Negligible.

### 9. proj4js via CDN

All CRS conversions use `proj4js`, loaded via CDN. Required CRS definitions registered at app startup:
- `EPSG:4326` (WGS84) — built-in
- `EPSG:3857` (Web Mercator) — built-in
- `EPSG:25833` (UTM zone 33N) — hoydedata
- `EPSG:3035` (ETRS89-LAEA) — SeNorge/NGCD

## Consequences

- `Extent`, `Grid`, `Chunk` and `Viewport` are the four core spatial primitives
- Projection complexity fully encapsulated in `Extent` — no other module imports proj4js directly except the Layer rendering step
- Layers are projection-agnostic — they pass Extents to Sources and receive Chunks back
- Sources own all projection knowledge — CRS, chunk grid, stride selection
- Cache stores raw ArrayBuffers — Source reconstructs Chunks on retrieval
- Distortion handled by adaptive mesh density — one draw call per Chunk regardless of distortion level
- No Chunk splitting needed — simpler primitives, simpler Layer logic
- Progressive rendering natural — async generator yields Chunks as they arrive

## Decisions

### 1. `Extent` class (`core/extent.js`)

A geographic region with a known CRS. Pure spatial concept — no resolution, no data. All spatial reasoning in the application goes through Extent.

```javascript
class Extent {
  constructor({ north, south, east, west, crs })

  // Returns a new Extent in targetCRS whose bounds fully contain this Extent.
  // Reprojects all four corners and edge midpoints, returns bounding envelope.
  // Uses proj4js internally.
  cover(targetCRS)  // → Extent

  // Returns the maximum geometric distortion ratio when linearly stretching
  // this Extent from its native CRS to targetCRS.
  // Computed by comparing reprojected shape to its bounding rectangle.
  // Returns a value ≥ 0 where 0 = no distortion.
  maxDistortion(targetCRS)  // → number

  // Returns { north, south, east, west } in targetCRS.
  // Primary reprojection method.
  toBoundingBox(targetCRS)  // → { north, south, east, west }

  // Returns [topLeft, topRight, bottomRight, bottomLeft] each as { x, y } in targetCRS.
  // Utility derived from toBoundingBox.
  toCorners(targetCRS)  // → Array<{x, y}>

  // Converts a resolution value (meters/cell or degrees/cell) expressed in this
  // Extent's CRS to the equivalent resolution in targetCRS at this Extent's location.
  // Used by Sources to convert requested resolution to native CRS resolution.
  translateResolution(resolution, targetCRS)  // → number
}
```

### 2. `Grid` class (`core/grid.js`)

A typed 2D raster array. Pure data concept — no spatial identity.

```javascript
class Grid {
  constructor({ data, width, height, dtype })
  // data:  TypedArray (Float32Array, Uint8Array, etc.)
  // width: number of cells in x dimension
  // height: number of cells in y dimension
  // dtype: 'float32' | 'uint8' | 'uint16'
}
```

Resolution is implicit in a Chunk — derived from the Extent dimensions divided by Grid cell count.

### 3. `Chunk` class (`core/chunk.js`)

Combines an Extent with a Grid. A fully georeferenced raster tile. Returned by Sources to Layers.

```javascript
class Chunk {
  constructor({ extent, grid })

  extent  // Extent instance — spatial identity and CRS
  grid    // Grid instance — data

  // Splits this Chunk into sub-Chunks small enough that maxDistortion(targetCRS)
  // is below threshold. Yields sub-Chunks as an async generator.
  // Each sub-Chunk carries the proportional slice of the Grid data.
  async *split(maxDistortion, targetCRS)  // → AsyncGenerator<Chunk>
}
```

Chunk resolution = `extent width in native CRS units / grid.width` (and equivalently for height).

### 4. Source internal grid and `compute()`

Each Source has a fixed internal chunk grid in its native CRS:
- **Base resolution**: fixed in native CRS units (e.g. 1000m for SeNorge, 0.25m for hoydedata)
- **Chunk boundaries**: deterministic from base resolution and a fixed geographic chunk size per source
- **Available strides**: powers of 2 from base resolution (1×, 2×, 4×, 8×...)

The Source selects the appropriate stride based on the requested resolution, translated to native CRS:

```javascript
const nativeResolution = requestedExtent.translateResolution(requestedResolution, nativeCRS)
const stride = nearestPowerOf2(nativeResolution / baseResolution)
```

Subclasses implement:
```javascript
async compute(extent, stride, params, signal, dependencies = {})  // → Grid
```

The base class (`Source`) owns Chunk construction:
```javascript
// base class, after compute() resolves:
const chunk = new Chunk({ extent: internalChunkExtent, grid })
// yield chunk, write to cache
```

`extent` passed to `compute()` is the Source's internal chunk Extent (in native CRS, aligned to chunk grid) — not the caller's requested Extent.

### 5. Source `get()` — async generator

```javascript
async *get(extent, resolution, params, signal)  // → AsyncGenerator<Chunk>
```

- `extent` — Extent in any CRS. Source calls `extent.cover(nativeCRS)` internally to ensure full coverage in its own projection.
- `resolution` — requested resolution in the Extent's CRS units. Source translates to native CRS and selects stride.
- `params` — source-specific parameters, JSON-serialisable.
- `signal` — AbortSignal. If aborted, generator stops yielding.

Yields Chunks in source native CRS as they become available. Cache hits yield immediately. Computed Chunks yield on completion.

The Source guarantees the union of all yielded Chunks fully covers the requested Extent. The Layer may purge any previously rendered tiles not covered by the new set of yielded Chunks.

### 6. Cache storage

Raw ArrayBuffers stored in IndexedDB (natively supported, no serialisation overhead). On cache retrieval, the Source reconstructs the Chunk using:
- ArrayBuffer → Grid (Source knows dtype and can derive dimensions from chunk grid math)
- Internal chunk Extent (Source derives from chunk grid coordinates + known CRS)

Chunk reconstruction is always the Source's responsibility. The cache is a dumb ArrayBuffer store.

### 7. Layer spatial flow

Layers have no declared native CRS. They work with whatever CRS the Viewport provides and receive Chunks back from the Source.

On each viewport update:

1. Receive viewport Extent in WGS84 from MapLibre/Viewport
2. Call `source.get(viewportExtent, resolution, params, signal)`
3. Source handles coverage, CRS conversion, and stride selection internally
4. For each yielded Chunk:
   a. Check `chunk.maxDistortion('EPSG:3857')`
   b. If above threshold: `chunk.split(threshold, 'EPSG:3857')` → render each sub-Chunk
   c. If below threshold: render directly via `chunk.extent.toCorners('EPSG:3857')` → MapLibre image source
5. Purge previously rendered tiles not present in the new set of yielded Chunks

### 8. proj4js via CDN

All CRS conversions use `proj4js`, loaded via CDN. Required CRS definitions registered at app startup:
- `EPSG:4326` (WGS84) — built-in
- `EPSG:3857` (Web Mercator) — built-in
- `EPSG:25833` (UTM zone 33N) — hoydedata
- `EPSG:3035` (ETRS89-LAEA) — SeNorge/NGCD

### 9. Distortion threshold

Default maximum distortion: **0.5%** (`maxDistortion < 0.005`). Configurable per Layer. At Scandinavia's latitudes (~65°N) this corresponds to render tiles of roughly 200-300km east-west for ETRS89-LAEA sources.

## Consequences

- `Extent`, `Grid` and `Chunk` are the three core spatial primitives — all spatial reasoning flows through them
- Projection complexity is fully encapsulated in `Extent` — no other module imports proj4js directly
- Layers are projection-agnostic — they pass Extents to Sources and receive Chunks back
- Sources own all projection knowledge about their data — CRS, chunk grid, stride selection
- Cache stores raw ArrayBuffers — Source reconstructs Chunks on retrieval
- Progressive rendering is natural — async generator yields Chunks as they arrive
- Distortion is bounded by the splitting threshold — visually accurate at all zoom levels
