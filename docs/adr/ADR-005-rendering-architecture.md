# ADR-005: Rendering Architecture

**Date:** 2026-03-15
**Status:** Accepted

## Context

Our data sources use non-Mercator projections (EPSG:3035, EPSG:25833). MapLibre GL JS renders in Web Mercator. Displaying gridded raster overlays correctly requires per-pixel reprojection. Additionally, real-time parameter changes (percentile slider, threshold) require GPU-accelerated colorization to remain responsive.

Several rendering approaches were evaluated:
- MapLibre canvas source — simple but reintroduces distortion via linear corner stretching
- zarr-gl — too immature, only handles Float32, non-Mercator support incomplete
- deck.gl-raster — correct capabilities but React-centric, incompatible with no-build-pipeline constraint
- MapLibre Custom Layer with WebGL2 — correct reprojection via vertex shader, GPU colorization, no additional dependencies beyond regl (optional)

## Decisions

### 1. MapLibre Custom Layer for gridded raster overlays

Each of our data Layers is implemented as a MapLibre Custom Layer. This means:
- Our WebGL2 code runs inside MapLibre's rendering pipeline
- Access to MapLibre's projection matrix — correct screen coordinate mapping
- No canvas synchronization needed — MapLibre calls our `render()` method every frame automatically
- Viewport is always current — no drift between basemap and overlay

Distortion from non-Mercator source CRS is handled by **adaptive mesh density** — see ADR-004 section 8. Each Chunk is rendered as an N×N mesh of quads rather than a single quad. Mesh vertices are reprojected CPU-side via proj4js. No Chunk splitting needed.

### 2. Texture-based rendering with CPU-side reprojection

Each Chunk is rendered as a single quad (4 vertices, 2 triangles) with the chunk data uploaded as a WebGL texture. This is far more efficient than one vertex per grid cell.

**On Chunk arrival (CPU, once per Chunk):**
1. Convert the 4 corner coordinates from source native CRS to Web Mercator using proj4js
2. Upload cell data as a WebGL texture (Float32 → `R32F`, Uint8 → `LUMINANCE`)
3. Store converted corners and texture reference in the Custom Layer's GPU buffer

**Vertex shader** (runs 4 times per Chunk quad):
```glsl
attribute vec2 position;   // Web Mercator corner, pre-computed CPU-side via proj4js
attribute vec2 texCoord;   // UV coordinate (0,0) to (1,1)
uniform mat4 matrix;       // MapLibre's current projection matrix
varying vec2 uv;

void main() {
  uv = texCoord;
  gl_Position = matrix * vec4(position, 0.0, 1.0);
}
```

**Fragment shader** (runs once per screen pixel covered by the quad):
```glsl
uniform sampler2D chunkData;
uniform float hue;
uniform float valueMin;
uniform float valueMax;
varying vec2 uv;

void main() {
  float value = texture2D(chunkData, uv).r;
  float normalized = clamp((value - valueMin) / (valueMax - valueMin), 0.0, 1.0);
  gl_FragColor = hslaToRgba(hue, 1.0, 0.5, normalized);
}
```

Hard filter variant: output `vec4(0.5, 0.5, 0.5, 0.5)` if value exceeds threshold, else `vec4(0.0)`.

**Why CPU reprojection:**
Reprojection of 4 corners happens once per Chunk load using proj4js — not every frame. The vertex shader reduces to a single matrix multiply per vertex. This is simpler than implementing inverse UTM in GLSL (~40 lines of shader math) and has negligible cost since it runs only when new data arrives.

### 3. Raw WebGL2 as primary implementation

Raw WebGL2 is used directly — no regl dependency. regl may be introduced later if boilerplate becomes burdensome. The Custom Layer interface MapLibre provides is already a clean entry point:

```javascript
const customLayer = {
  id: 'layer-id',
  type: 'custom',
  onAdd(map, gl) {
    // compile shaders, create buffers, upload textures
  },
  render(gl, matrix) {
    // matrix is MapLibre's current projection matrix
    // draw call using current chunk data
  },
  onRemove(map, gl) {
    // cleanup WebGL resources
  }
}
map.addLayer(customLayer)
```

### 4. Zarr as internal storage format

Data is stored in IndexedDB as Zarr chunks with Gzip compression. Gzip is available natively in the browser via the `DecompressionStream` API — no WASM or additional dependencies needed.

The IndexedDB store implements the minimal Zarr store interface:
```javascript
const zarrStore = {
  async get(key) { return await idbGet(key) },   // → Uint8Array | undefined
  async set(key, value) { await idbSet(key, value) }
}
```

Zarr metadata (`.zarray`, `.zattrs`) per source stores:
- `dtype` — e.g. `'<u1'` for Uint8, `'<f4'` for Float32
- `shape` — chunk dimensions
- `crs` — source native CRS as EPSG string
- `chunks` — chunk shape
- `compressor` — `{ id: 'gzip', level: 1 }`

### 5. Slope computation stays on WebGPU

Slope computation is a compute operation, not a draw operation. It runs in a separate WebGPU compute pipeline, independent of MapLibre's WebGL2 context. The result is written to a Zarr chunk in IndexedDB and picked up by the slope Custom Layer for rendering via WebGL2. See ADR-003 for slope computation details.

### 6. Basemap multi-region routing via addProtocol

The basemap tile problem — multiple regional providers (Kartverket for Norway, Lantmäteriet for Sweden, OpenTopoMap globally) — is handled via MapLibre's `addProtocol` API. A custom `composite://` protocol handler intercepts tile requests, determines which provider covers the requested tile's geographic area, fetches from that provider, and returns the PNG bytes. Geographic routing uses the standard XYZ tile bounding box formula.

This is intentionally separate from our Source/Layer system — basemap tiles are visual PNG data, not numeric gridded data. No Zarr, no Chunk model, no aggregation.

## Consequences

- Custom Layer gives correct reprojection at the vertex shader level — no distortion regardless of source CRS
- GPU colorization via fragment shader enables real-time parameter changes (percentile, threshold) without re-fetching data
- Raw WebGL2 adds shader code to maintain — mitigated by regl if needed
- Zarr + Gzip storage is efficient and standard — future tooling compatibility
- Slope computation (WebGPU) and raster rendering (WebGL2) are separate pipelines — clean separation of compute and draw
- Basemap routing via addProtocol is independent of the Source/Layer system — simpler and appropriate for its use case
- No additional rendering library dependencies — MapLibre's Custom Layer API is sufficient

## Rejected alternatives

- **zarr-gl**: immature, Float32 only, non-Mercator support incomplete
- **deck.gl-raster**: correct capabilities but React-centric, requires build pipeline
- **Canvas source**: reintroduces distortion via linear corner stretching
- **regl**: convenience wrapper only, not a capability — deferred until needed
