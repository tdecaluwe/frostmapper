# Spec: `core/layer.js` and `core/renderer.js`

## Purpose

This spec covers two tightly related modules:

- **`core/layer.js`** — `RasterLayer` base class for all raster overlay Layers (soft filters, hard filters). Subclasses implement data-specific logic. Annotation Layers (GeoJSON) do not extend this class.
- **`core/renderer.js`** — `RasterRenderer`, the single MapLibre Custom Layer that handles all WebGL rendering for raster overlays.

These two modules are specified together because their interfaces are tightly coupled — `RasterLayer` hands data to `RasterRenderer` via a defined upload interface, and `RasterRenderer` drives `RasterLayer.update()`.

---

## `RasterRenderer` (`core/renderer.js`)

### Purpose

The single MapLibre Custom Layer for all raster overlay rendering. Owns all WebGL state. Drives Layer data updates. Renders all registered Layers in one render loop.

### Interface

```javascript
class RasterRenderer {
  constructor({ mapManager })

  // MapLibre Custom Layer interface — called by MapLibre
  onAdd(map, gl)
  render(gl, matrix)
  onRemove(map, gl)

  // Layer management
  register(layer)       // → void — add Layer to draw list
  unregister(layerId)   // → void — remove Layer, release all its GPU resources

  // Called by RasterLayer to upload a chunk to GPU
  // grid: Grid — cell data to upload as texture
  // vertices: Float32Array — mesh vertices [x,y,u,v,...] in EPSG:3857
  // getParams: () => { layerType, hue, valueRange, threshold } — called every frame
  // returns: release — () => void — call to free GPU resources for this chunk
  upload(grid, vertices, getParams)  // → release: () => void
}
```

### Upload

```javascript
renderer.upload(grid, vertices, getParams)  // → release: () => void
```

- `grid` — `Grid` instance containing cell data. dtype determines WebGL texture format:
  - `'uint8'` → `gl.LUMINANCE` + `gl.UNSIGNED_BYTE`
  - `'uint16'` → `gl.LUMINANCE` + `gl.UNSIGNED_SHORT`
  - `'float32'` → `gl.LUMINANCE` + `gl.FLOAT` — requires `OES_texture_float` extension. Enable lazily on first float32 upload: `gl.getExtension('OES_texture_float')`. Log a warning if the extension is unavailable.
- `vertices` — `Float32Array` of mesh vertices `[x,y,u,v,...]` pre-reprojected to EPSG:3857
- `getParams` — `() => { layerType, hue, valueRange: { from, to }, threshold }` — called by the renderer on every frame to get current visualization params. Reads from Vue reactive state so param changes take effect immediately without re-uploading.
- Returns `release` — a closure that deletes the WebGL texture and mesh buffer when called. The Layer calls this when the chunk goes stale.

The renderer maintains an internal ordered list of `{ getParams, texture, meshBuffer }` entries per registered Layer. `render()` iterates them, calls `getParams()` for current uniforms, and draws.

### Constructor

```javascript
{
  mapManager: MapManager  // injected — used to subscribe to Viewport changes
}
```

### `onAdd(map, gl)`

Called by MapLibre when the Custom Layer is added to the map. Responsibilities:
1. Store `gl` reference
2. Compile the uber-shader (vertex + fragment) — see Shader section
3. Initialise internal ordered list of uploaded chunks per Layer
4. Subscribe to Viewport changes from `mapManager.onViewportChange()` — on each change, call `layer.update(viewport, signal)` on all registered Layers, cancelling any in-progress updates first

### `render(gl, matrix)`

Called by MapLibre on every frame. Pure draw — no async operations, no data fetching. Responsibilities:
1. Use compiled shader program
2. For each registered Layer (in registration order):
   - For each uploaded chunk entry `{ getParams, texture, meshBuffer }`:
     - Call `getParams()` to get current visualization params
     - Set uniforms: `matrix`, `layerType`, `hue`, `valueMin`, `valueMax`, `threshold`
     - Bind texture, bind mesh buffer, draw triangles

### `onRemove(map, gl)`

Called by MapLibre when the Custom Layer is removed. Responsibilities:
1. Unsubscribe from Viewport changes
2. Call all stored `release` callbacks to delete all WebGL resources
3. Cancel all in-progress Layer updates

### `register(layer)`

Adds a Layer to the draw list. Immediately triggers `layer.update(currentViewport, signal)` if a Viewport is already available. Layers are drawn in registration order.

### `unregister(layerId)`

Removes a Layer from the draw list. Calls all `release` callbacks associated with that Layer's uploaded chunks. Cancels any in-progress update for that Layer.

### Shader

**Vertex shader:**
```glsl
attribute vec2 position;  // Web Mercator coordinates, pre-reprojected CPU-side
attribute vec2 texCoord;  // UV (0,0) to (1,1)
uniform mat4 matrix;      // MapLibre projection matrix
varying vec2 uv;

void main() {
  uv = texCoord;
  gl_Position = matrix * vec4(position, 0.0, 1.0);
}
```

**Fragment shader (uber-shader):**
```glsl
precision mediump float;
uniform sampler2D chunkData;
uniform int layerType;     // 0 = soft filter, 1 = hard filter
uniform float hue;         // degrees 0-360 (soft filter only)
uniform float valueMin;    // from valueRange.from (soft filter only)
uniform float valueMax;    // from valueRange.to (soft filter only)
uniform float threshold;   // hard filter threshold
varying vec2 uv;

vec4 hslaToRgba(float h, float s, float l, float a);  // utility

void main() {
  float value = texture2D(chunkData, uv).r;

  if (layerType == 0) {
    // Soft filter — hue + opacity
    float normalized = clamp((value - valueMin) / (valueMax - valueMin), 0.0, 1.0);
    gl_FragColor = hslaToRgba(hue, 1.0, 0.5, normalized);
  } else {
    // Hard filter — grey overlay
    gl_FragColor = value > threshold
      ? vec4(0.5, 0.5, 0.5, 0.5)
      : vec4(0.0, 0.0, 0.0, 0.0);
  }
}
```

### triggerRepaint

`map.triggerRepaint()` is called by `RasterRenderer` after each `upload()` call — i.e. whenever new GPU resources are created. Not called if no new uploads occurred in an update cycle. This ensures MapLibre redraws when new data arrives even if the camera is idle.

---

## `RasterLayer` (`core/layer.js`)

### Purpose

Base class for all raster overlay Layers. Subclasses declare a Source and render params. The base class handles: Source consumption, mesh generation, texture upload coordination, and chunk lifecycle management.

All data aggregation (percentile computation, season length calculation etc.) happens in the Source — the Layer receives already-aggregated Chunks, one per spatial extent, ready for rendering.

Annotation Layers (GeoJSON) do not extend this class — they interact with MapLibre directly.

### Interface

```javascript
class RasterLayer {
  constructor({ id, source, renderer, params })

  // Called by RasterRenderer on viewport change
  async update(viewport, signal)

  // Base class — generates N×N mesh vertices for a Chunk, reprojected to targetCRS
  generateMesh(chunk, targetCRS)  // → Float32Array [x,y,u,v, ...]

  // Render params — called every frame by renderer via getParams closure
  get layerType()   // → 'soft-filter' | 'hard-filter' — implemented by subclass
  get hue()         // → number (soft filter only) — implemented by subclass
  get valueRange()  // → { from, to } (soft filter only) — from Vue reactive state
  get threshold()   // → number (hard filter only) — from Vue reactive state
}
```

### Constructor

```javascript
{
  id: string,                    // unique layer identifier
  source: Source,                // Source instance to consume — yields aggregated Chunks
  renderer: RasterRenderer,      // RasterRenderer to upload chunks to
  params: reactive({})           // Vue reactive object containing render params
}
```

### `update(viewport, signal)`

Called by RasterRenderer on every Viewport change. Responsibilities:

1. Call `source.get(viewport, viewport.resolution(), signal)`
2. Track chunk keys yielded in this cycle
3. For each yielded Chunk:
   a. Compute mesh: `const vertices = this.generateMesh(chunk, 'EPSG:3857')`
   b. Upload: `const release = renderer.upload(chunk.grid, vertices, () => this.#visualParams())`
   c. Store: `this.#chunks.set(chunkKey, release)`
4. After generator exhausts, purge stale chunks — for any key in previous cycle not in new cycle: call stored `release()`, delete from `this.#chunks`

If `signal` is aborted, the generator stops naturally. Already uploaded chunks remain valid.

### Private `#visualParams()`

Returns current visualization params — called by renderer on every frame via the closure passed to `upload()`:

```javascript
#visualParams() {
  return {
    layerType: this.layerType,
    hue: this.hue,
    valueRange: this.valueRange,  // reactive — current value each frame
    threshold: this.threshold     // reactive — current value each frame
  }
}
```

### `generateMesh(chunk, targetCRS)` → `Float32Array`

Base class method. Generates an N×N quad mesh for a Chunk, with vertices reprojected from the Chunk's native CRS to `targetCRS` via proj4js.

**Mesh density N** is determined by distortion:
```javascript
const distortion = chunk.tileId.extent.maxDistortion(targetCRS)
const N = distortion < 0.001 ? 2
        : distortion < 0.005 ? 4
        : distortion < 0.02  ? 8
        : 16
```

**Mesh construction:**
1. Generate an N×N grid of points in the Chunk's native CRS, uniformly distributed across `chunk.tileId.extent`
2. Reproject each point to `targetCRS` via proj4js
3. Assign UV coordinates linearly (0,0) at top-left to (1,1) at bottom-right
4. Triangulate into (N-1)×(N-1) quads = 2×(N-1)² triangles
5. Return as `Float32Array` of [x,y,u,v] per vertex in triangle order

### Chunk key

```javascript
function chunkKey(chunk) {
  return chunk.tileId.toString()  // '{chunkX},{chunkY}:{stride}'
}
```

`tileId` is set by the Source base class on every yielded Chunk. The Layer never needs to know the Source's `chunkSize`, `originX/Y`, or `nativeCRS` to construct a stable key. Different Layers consuming different Sources have separate `this.#chunks` maps — no cross-Layer collision possible.

### Stale chunk purge

After each `update()` cycle, the Layer compares the set of chunk keys yielded in this cycle against the previous cycle. Keys present in the previous set but absent from the new set are released via `renderer.removeChunk(key)`. This handles viewport panning — chunks that moved out of view are released from GPU memory.

---

## Subclass pattern

```javascript
class SnowSeasonLayer extends RasterLayer {
  get layerType() { return 'soft-filter' }
  get hue() { return 200 }  // blue
  get valueRange() { return this.params.valueRange }  // reactive
  // No aggregate() — percentile computation happens in SnowSeasonSource
}

class SlopeLayer extends RasterLayer {
  get layerType() { return 'hard-filter' }
  get threshold() { return this.params.slopeThreshold }  // reactive
}
```

---

## Annotation Layers

Annotation Layers (transport stops, isochrones, road access) are not subclasses of `RasterLayer`. They:
- Subscribe to Viewport changes directly from MapManager
- Call their Source's `get()` generator
- Manage MapLibre GeoJSON sources and layers directly via `map.addSource()` / `map.updateData()`
- Have no interaction with RasterRenderer

They share the same update pattern (`update(viewport, signal)`) but implement it independently.

---

## Test cases

### RasterRenderer

**1. Construction and shader compilation**
Construct RasterRenderer with a mock MapManager. Call `onAdd(mockMap, mockGl)`. Verify shader compiled without errors.

**2. register() triggers immediate update**
Register a Layer when a Viewport is already available. Verify `layer.update()` is called immediately with the current Viewport.

**3. upload() returns release callback**
Call `renderer.upload(mockGrid, mockVertices, () => params)`. Verify returns a function. Call the returned function. Verify `gl.deleteTexture` and buffer deletion called.

**4. render() calls getParams every frame**
Upload a chunk with `getParams` returning `{ hue: 200, ... }`. Call `render()`. Verify hue uniform set to 200. Change `getParams` to return `{ hue: 120, ... }`. Call `render()` again. Verify hue uniform updated to 120 — no re-upload needed.

**5. triggerRepaint called only on upload**
Register a Layer. Call `update()` with a Viewport where all chunks are cached — no new uploads. Verify `map.triggerRepaint()` not called. Trigger a new chunk — verify `triggerRepaint()` called once.

**6. Viewport change cancels in-progress update**
Register a Layer whose `source.get()` is slow. Trigger a Viewport change before the first update completes. Verify first update's signal is aborted. Verify second update starts with new Viewport.

**7. render() order matches registration order**
Register LayerA then LayerB. Verify in `render()`, LayerA's chunks are drawn before LayerB's.

**8. unregister() calls all release callbacks**
Register a Layer, upload 2 chunks. Call `unregister()`. Verify both release callbacks are called. Verify GPU resources freed.

### RasterLayer

**9. generateMesh() — low distortion → 2×2 mesh**
Create a small Chunk in EPSG:3035 at 65°N with `maxDistortion('EPSG:3857') < 0.001`. Call `generateMesh(chunk, 'EPSG:3857')`. Verify returned Float32Array has correct vertex count for a 2×2 mesh. Verify UV coordinates are (0,0), (1,0), (0,1), (1,1) at corners.

**10. generateMesh() — high distortion → finer mesh**
Create a large Chunk with `maxDistortion('EPSG:3857') > 0.005`. Call `generateMesh()`. Verify mesh has more than 4 vertices. Verify reprojected vertex positions differ from linear interpolation of corners.

**11. generateMesh() — reprojection correctness**
Create Chunk via TileId in EPSG:25833 with known corner coordinates. Call `generateMesh(chunk, 'EPSG:3857')`. Verify the four corner vertices of the returned mesh match `proj4('EPSG:25833', 'EPSG:3857', [x, y])` for each of the four corners of `chunk.tileId.extent` (±0.001m).

**12. update() calls upload with getParams closure**
Create Layer with mock Source yielding 1 Chunk. Call `update()`. Verify `renderer.upload()` called with correct grid, vertices, and a getParams function. Verify calling getParams returns current layer visualization params.

**13. update() stores release callback**
Call `update()` yielding chunk A. Verify `this.#chunks` contains an entry for A's key storing the release callback returned by `renderer.upload()`.

**14. update() purges stale chunks**
First `update()` yields chunks A and B — two release callbacks stored. Second `update()` yields only chunk A. Verify B's stored release callback is called. Verify B's entry removed from `this.#chunks`.

**15. update() abort stops generator**
Call `update()` with a slow Source. Abort signal mid-update. Verify generator stops. Verify no further uploads after abort. Verify previously uploaded chunks remain.

**16. #visualParams() returns reactive values**
Create Layer with `params.valueRange = { from: 0, to: 180 }`. Call `#visualParams()`. Verify returns correct valueRange. Change `params.valueRange`. Call `#visualParams()` again. Verify updated value returned — same closure, different result.

**17. Chunk key uniqueness**
Two Chunks at different spatial positions produce different chunk keys. Two Chunks at the same position but different strides produce different chunk keys.
