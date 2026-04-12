# Architecture

This document describes the internal structure of the Geo Scouting Tool. Architectural decisions and their rationale are documented in the ADRs — this document ties them together into a coherent picture of the whole system.

## Overview

The application is a fully static single-page app deployable on GitHub Pages. All data fetching, processing and rendering happens client-side. There is no backend.

---

## File Structure

```
index.html
data/
  airports.json             # Bundled airport passenger figures
src/
  core/
    primitives.js           # Extent, Grid, Chunk, Viewport classes
    cache.js                # Source base class — caching, chunk grid, get()
    queue.js                # Per-API priority queue with AbortController
    generators.js           # Async generator utilities: merge(), groupBy()
    map.js                  # MapLibre init, viewport emission, RasterRenderer registration
    renderer.js             # RasterRenderer — single MapLibre Custom Layer for all raster overlays
    crypto.js               # KeyStore — encrypted API key storage via Web Crypto API
  sources/
    seNorge-snow.js         # SeNorge raw snow depth — THREDDS, 1km, EPSG:3035
    ngcd-temp-mean.js       # NGCD daily mean temperature — THREDDS, 1km, EPSG:3035
    ngcd-temp-max.js        # NGCD daily max temperature — THREDDS, 1km, EPSG:3035
    hoydedata-elevation.js  # Norway DTM — hoydedata.no ImageServer, 0.25m, EPSG:25833
    mapzen-elevation.js     # Global elevation fallback — Mapzen Terrain Tiles, ~30m
    composite-elevation.js  # CompositeSource: hoydedata (Norway) + Mapzen (global)
    snow-season.js          # Derived: season length per year — consumes seNorge-snow
    melt-risk.js            # Derived: melt risk days per year — consumes ngcd-temp-max
    slope.js                # Derived: terrain passability — consumes composite-elevation, WebGPU
    road-access.js          # OSM road network — Overpass API
    transport-stops.js      # OSM public transport stops — Overpass API
    airports.js             # Airport data — OpenFlights + bundled JSON
    isochrones.js           # Travel time isochrones — OpenRouteService
  layers/
    snow-season.js          # Soft filter — snow season length
    winter-temp.js          # Soft filter — average winter temperature
    melt-risk.js            # Soft filter — melt risk days
    slope.js                # Hard filter — terrain passability
    road-access.js          # Hard filter — road accessibility
    transport-stops.js      # Annotation — public transport stops (GeoJSON)
    isochrones.js           # Annotation — airport travel time isolines (GeoJSON)
  ui/
    layer-panel.js          # Layer toggles, progress indicators, error states
    settings.js             # Global parameters and API key management
```

---

## Component Responsibilities

Four core components with clear, non-overlapping concerns:

### `MapManager` (`core/map.js`)
- Owns the MapLibre GL JS instance
- Converts MapLibre's WGS84 viewport to EPSG:3857 and emits `Viewport` primitives to subscribers
- Registers `RasterRenderer` as the single MapLibre Custom Layer for all raster overlays
- Manages GeoJSON layers for annotation Layers (road access, transport stops, isochrones)
- Registers the `composite://` protocol handler for multi-region basemap tile routing
- Nothing else — no data, no rendering logic, no knowledge of Sources or Layers

### `RasterRenderer` (`core/renderer.js`)
- The single MapLibre Custom Layer for all raster overlay rendering
- Owns all WebGL state: shader compilation (uber-shader), vertex buffers, texture management
- Subscribes to Viewport changes from MapManager — calls `layer.update(viewport, signal)` on all registered Layers
- On MapLibre's `render(gl, matrix)`: iterates registered Layers and draws their chunks in order
- Manages Layer registration and unregistration — releases GPU resources on unregister
- No knowledge of Sources, data formats, or what the data means — pure rendering

### `Layer` (base class + subclasses, `src/layers/`)
- Owns the data pipeline for one overlay — holds a Source reference, calls `source.get()`
- Implements `update(viewport, signal)` — fetches Chunks, hands textures and meshes to RasterRenderer
- Declares render params: `layerType`, `hue`, `valueRange` (for soft filters)
- Base class implements `generateMesh(chunk, targetCRS)` using `chunk.extent.maxDistortion()` to determine adaptive mesh density
- No WebGL code — hands data to RasterRenderer via a clean upload interface
- Annotation Layers (GeoJSON) bypass RasterRenderer and manage MapLibre GeoJSON layers directly

### `Source` (base class + subclasses, `src/sources/`)
- Owns data fetching, aggregation, and caching
- Exposes `async *get(extent, resolution, signal)` — async generator yielding `Chunk` objects
- Structural configuration (year, threshold, CRS) baked into instance at construction — not per-call params
- Source `id` encodes full configuration for unambiguous cache keys
- No knowledge of rendering, viewports, or Layers

---

## Data Flow

```
MapManager
  → emits Viewport (EPSG:3857) on map move

RasterRenderer
  → receives Viewport from MapManager
  → calls layer.update(viewport, signal) on each registered Layer

Layer.update(viewport, signal)
  → calls source.get(viewport, viewport.resolution(), signal)
  → async generator yields Chunks
  → for each Chunk:
      mesh = this.generateMesh(chunk, 'EPSG:3857')  // base class, adaptive N×N mesh
      renderer.uploadTexture(chunkKey, chunk.grid)
      renderer.uploadMesh(chunkKey, mesh)
      map.triggerRepaint()  // only when GPU state changes

RasterRenderer.render(gl, matrix)  // called every frame by MapLibre
  → for each registered Layer:
      for each chunk in layer.chunks:
        bind texture, set uniforms (layerType, hue, valueRange), draw mesh
```

---

## Rendering Architecture

### Single Custom Layer
All raster overlays (soft filters, hard filters) are rendered by a single MapLibre Custom Layer — `RasterRenderer`. This means:
- One shader program switch per frame
- All chunks share a single WebGL context
- Compositing order controlled explicitly in the render loop

### Uber-shader
One GLSL shader handles all raster layer types via a `layerType` uniform:
- **Soft filter**: maps cell value to `hsla(hue, 100%, 50%, normalizedValue)`
- **Hard filter**: outputs `rgba(0.5, 0.5, 0.5, 0.5)` if value exceeds threshold, else transparent

Render params (`hue`, `valueRange`) are read from Vue reactive state on every frame — uniforms update automatically when UI params change, no explicit `setParams()` needed.

### Adaptive mesh
Each Chunk is rendered as an N×N quad mesh (not a single quad). N is determined by `chunk.extent.maxDistortion('EPSG:3857')` — larger for Chunks with more reprojection distortion. Mesh vertices are reprojected from source CRS to EPSG:3857 on the CPU via proj4js when the Chunk arrives. The vertex shader applies MapLibre's projection matrix only.

### Texture per chunk
One WebGL texture per Chunk. Stored in `Map<chunkKey, {texture, mesh}>` per Layer. Simple, correct, and sufficient for our chunk counts (typically 4-16 per viewport per layer).

### Annotation layers
GeoJSON annotation layers (transport stops, isochrones, road access) bypass RasterRenderer entirely and use MapLibre's native `addSource`/`addLayer` GeoJSON pipeline.

---

## Projection Model

All spatial reasoning goes through `Extent`, `Chunk`, and `Viewport` primitives in `core/primitives.js`.

- **Viewport** is always in EPSG:3857 — MapLibre's WGS84 output is converted once in `map.js`
- **Viewport.resolution()** = `this.width() / widthPx / 2` — meters/cell at 2× screen resolution
- **Source.get()** accepts an Extent in any CRS — internally calls `extent.cover(nativeCRS)`
- **translateResolution()** converts resolution between CRS using proj4js at the Extent center point
- **proj4js** is the only projection dependency — loaded via CDN, used only inside Extent methods

Required CRS definitions registered at app startup:
- `EPSG:4326` (WGS84) — built-in to proj4js
- `EPSG:3857` (Web Mercator) — built-in to proj4js
- `EPSG:25833` (UTM zone 33N) — hoydedata native CRS
- `EPSG:3035` (ETRS89-LAEA) — SeNorge/NGCD native CRS

---

## Source Patterns

### Remote fetch Source
Fetches data from a remote API. Implements `compute(extent, stride, signal)` returning a `Grid`. The base class handles caching, chunk grid math, and Chunk construction.

### Composite Source
Orchestrates multiple child Sources with geographic coverage Extents. Routes `get()` calls to the appropriate child based on which coverage Extent the request falls within. Used for elevation (hoydedata for Norway, Mapzen globally).

### Derived Source (time series)
Consumes multiple child Sources (one per year/parameter value) via `merge()` and `groupBy()` from `core/generators.js`. Aggregates grouped Chunks into a single result Chunk per spatial extent. Used for snow season length, melt risk.

Example pattern:
```javascript
async *get(extent, resolution, signal) {
  const merged = merge(...this.yearSources.map(s => s.get(extent, resolution, signal)))
  const key = chunk => `${chunk.extent.west},${chunk.extent.south}`
  for await (const group of groupBy(merged, key, this.yearSources.length)) {
    yield new Chunk({ extent: group[0].extent, grid: this.aggregate(group) })
  }
}
```

---

## Generator Utilities (`core/generators.js`)

- `merge(...generators)` — yields from all generators concurrently, first-come-first-served
- `groupBy(generator, keyFn, expectedCount)` — accumulates values by key, yields complete groups

---

## Cache Architecture

### Two storage tiers
- **In-memory** (`Map<key, ArrayBuffer>`): all current session data, all Sources, cleared on refresh
- **IndexedDB**: Sources with `persist: true`, survives refresh, LRU eviction at 200MB

### Cache keys
`{sourceId}:{chunkX},{chunkY}:{stride}` — sourceId encodes full Source configuration

### Chunk grid
Fixed geographic grid per Source in the Source's native CRS. Chunk boundaries are deterministic and the same at all stride levels — stride only affects cell count within a chunk.

---

## API Queues

One `Queue` instance per remote API, shared across all Sources using that API. Sequential dispatch, priority ordered by distance from viewport center (lower = higher priority).

| Queue | Sources |
|-------|---------|
| THREDDS | seNorge-snow, ngcd-temp-mean, ngcd-temp-max |
| hoydedata | hoydedata-elevation |
| Overpass | road-access, transport-stops |
| OpenRouteService | isochrones |

---

## UI

Vue 3 via CDN (ESM build, no build pipeline). Reactive state via `reactive()`. Components defined as plain JS objects.

Map is always full viewport. All UI panels are overlays in a collapsible accordion (top-left). Only one panel open at a time.

**Panels**: Layers (toggles + progress + errors) · Settings (global params) · API Keys (key status + entry)

---

## References

- [ADR-001 — Stack and Data Sources](adr/ADR-001-stack-and-data-sources.md)
- [ADR-002 — Data Fetching, Processing and Caching Strategy](adr/ADR-002-data-fetching-caching-strategy.md)
- [ADR-003 — Source Abstraction, Caching and Resolution Strategy](adr/ADR-003-source-abstraction-caching-resolution.md)
- [ADR-004 — Projection, Extent/Chunk Model](adr/ADR-004-projection-extent-chunk-model.md)
- [ADR-005 — Rendering Architecture](adr/ADR-005-rendering-architecture.md)
