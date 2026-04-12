# Spec: `core/map.js`

## Purpose

Owns the MapLibre GL JS instance. Responsible for:
- Initialising MapLibre with the basemap tile stack
- Registering the `composite://` protocol handler for multi-region basemap routing
- Registering and managing Custom Layers for data overlays
- Exposing viewport state as `Viewport` primitives via a subscription interface
- Accepting an injected MapLibre constructor for testability

---

## Interface

```javascript
class MapManager {
  constructor({ container, MapLibre, keyStore, initialCenter, initialZoom })
  
  onViewportChange(callback)          // → unsubscribe function
  addDataLayer(customLayer)           // → void — waits for map 'load' event internally
  removeDataLayer(id)                 // → void
  getViewport()                       // → Viewport
  setLantmaterietToken(token)         // → void — updates Lantmäteriet token at runtime
  destroy()                           // → void
}
```

---

## Constructor options

```javascript
{
  container: string,              // DOM element ID for MapLibre to render into
  MapLibre: class,                // injected MapLibre constructor — defaults to window.maplibregl
  keyStore: KeyStore,             // injected KeyStore instance for API key access
  initialCenter: [lon, lat],      // default: [15.0, 65.0] (centre of Scandinavia)
  initialZoom: number             // default: 5
}
```

Injecting both `MapLibre` and `keyStore` allows full construction-time testing without real WebGL or encrypted storage.

---

## Basemap initialisation

On construction, MapManager initialises MapLibre with a style containing three raster tile sources stacked in order:

1. **OpenTopoMap** (global fallback) — always present, lowest z-order
2. **Kartverket topo4** (Norway) — stacked above OpenTopoMap
3. **Lantmäteriet** (Sweden) — stacked above OpenTopoMap, requires token from KeyStore

All three are added as standard MapLibre raster sources routed through the `composite://` protocol handler. The handler determines which provider to fetch from based on tile geographic bounds — see Protocol Handler section.

---

## `composite://` protocol handler

Registered once at construction via `MapLibre.addProtocol('composite', handler)`.

### Tile URL format
```
composite://{provider}/{z}/{x}/{y}
```
Where `provider` is one of `opentopomap`, `kartverket`, `lantmateriet`.

MapLibre requests tiles using these URLs. The handler:
1. Extracts `z`, `x`, `y` from the URL
2. Computes the tile's geographic bounding box using the standard XYZ formula
3. Checks if the tile center falls within the provider's coverage Extent
4. If yes: fetches from the provider's real tile URL, returns PNG bytes
5. If no: returns a transparent 1×1 PNG (allows lower z-order layers to show through)

### Coverage Extents
```javascript
const coverage = {
  kartverket:    new Extent({ north: 72, south: 57, east: 32, west: 4,  crs: 'EPSG:4326' }),
  lantmateriet:  new Extent({ north: 70, south: 55, east: 25, west: 10, crs: 'EPSG:4326' }),
  opentopomap:   null  // global — always serves
}

const tileUrls = {
  kartverket:   (z, y, x) => `https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/${z}/${y}/${x}.png`,
  // Note: Kartverket uses {z}/{y}/{x} order — y and x are swapped vs standard XYZ
  lantmateriet: (z, x, y, token) => `https://api.lantmateriet.se/open/topowebb-ccby/v1/wmts/1.0.0/topowebb/default/3857/${z}/${y}/${x}.png?token=${token}`,
  opentopomap:  (z, x, y) => `https://tile.opentopomap.org/${z}/${x}/${y}.png`
}
```

### Tile bounding box formula (standard XYZ / Web Mercator)
```javascript
function tileBounds(z, x, y) {
  const n = Math.pow(2, z)
  const west  = (x / n) * 360 - 180
  const east  = ((x + 1) / n) * 360 - 180
  const north = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI
  const south = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI
  return { north, south, east, west }
}
```

### Notes
- Coverage check uses tile center point, not full tile bounds — avoids duplicate fetches at borders
- Lantmäteriet requires an API token appended to tile URLs — retrieved from KeyStore at handler registration time
- If Lantmäteriet token is missing, Lantmäteriet tiles are skipped silently — OpenTopoMap shows through

---

## `onViewportChange(callback)`

Registers a callback that receives a `Viewport` primitive whenever the map view changes.

```javascript
const unsubscribe = mapManager.onViewportChange(viewport => {
  // viewport: Viewport instance with boundingBox, zoom, widthPx, heightPx
})

// Later:
unsubscribe()
```

### Implementation
Listens to MapLibre's `move` event (fires during pan, zoom, rotation). On each event:
1. Reads `map.getBounds()` → `{ north, south, east, west }` in WGS84
2. Converts to Web Mercator via `new Extent({...bounds, crs: 'EPSG:4326'}).cover('EPSG:3857')`
3. Reads `map.getZoom()`
4. Reads container `clientWidth` / `clientHeight`
5. Constructs and emits a `Viewport` instance in EPSG:3857

The WGS84→Web Mercator conversion happens once here — Layers receive a Viewport already in EPSG:3857 and never need to handle this conversion themselves.

### Multiple subscribers
Multiple callbacks can be registered. All are called on each viewport change. `unsubscribe()` removes only the specific callback.

---

## `addDataLayer(customLayer)`

Registers a MapLibre Custom Layer for a data overlay.

```javascript
mapManager.addDataLayer({
  id: 'snow-season',
  type: 'custom',
  onAdd(map, gl) { ... },
  render(gl, matrix) { ... },
  onRemove(map, gl) { ... }
})
```

Internally calls `map.addLayer(customLayer)`. If a layer with the same `id` already exists, removes it first. Layers are rendered in registration order — register in the correct z-order.

## `addDataLayer(customLayer)`

Registers a MapLibre Custom Layer. Internally waits for the MapLibre `load` event before calling `map.addLayer()`. If the map is already loaded, adds immediately. If a layer with the same `id` already exists, removes it first. Layers are rendered in registration order.

## `removeDataLayer(id)`

Removes a previously registered Custom Layer by id. Calls `map.removeLayer(id)`. No-op if the layer does not exist. Does not cancel any in-progress data fetches — the Layer is responsible for its own cleanup via `onRemove`.

---

Updates the Lantmäteriet API token at runtime — called after KeyStore unlock when the token becomes available. Re-registers the `composite://` protocol handler with the new token. Lantmäteriet tiles activate on the next viewport render.

---

Removes a registered Custom Layer by id. Calls `map.removeLayer(id)`. No-op if layer not found.

---

## `getViewport()`

Returns the current `Viewport` synchronously without waiting for a change event. Used by Layers on initialisation to get the current state immediately.

---

## `destroy()`

Removes all `onViewportChange` listeners, replaces the `composite://` protocol handler with a no-op (MapLibre has no `removeProtocol` API), and calls `map.remove()` to clean up WebGL resources.

---

## GPU texture pyramid management

Custom Layers manage their own GPU textures. MapLibre calls each Custom Layer's `render(gl, matrix)` on every frame. The Custom Layer is responsible for:
- Keeping textures for all loaded stride levels per Chunk in GPU memory
- Rendering the finest available stride for each screen area
- Only evicting a coarser texture once a finer replacement is fully uploaded

This ensures smooth rendering during zoom — coarser textures render while finer data loads, with no blank areas.

MapLibre does not manage Custom Layer GPU resources — the Custom Layer owns its WebGL texture lifecycle entirely.

---

## Dependency on KeyStore

`MapManager` receives a `KeyStore` instance via constructor injection. The Lantmäteriet token is read from it at construction time via `keyStore.get('lantmateriet')` and used in the protocol handler. If the token is not available or KeyStore is not yet unlocked, Lantmäteriet tiles are silently skipped.

---

## Test cases

### 1. Construction with mock MapLibre
Construct `MapManager` with a mock MapLibre constructor that does not require WebGL. Verify no errors thrown. Verify `addProtocol` called with `'composite'`.

### 2. Viewport emission on move
Trigger a mock `move` event on the MapLibre instance. Verify `onViewportChange` callback receives a `Viewport` in EPSG:3857 (Web Mercator meters) with correct `zoom`, `widthPx`, `heightPx`. Verify `viewport.crs === 'EPSG:3857'`. Verify `viewport.west` and `viewport.east` are in meters (not degrees).

### 3. Multiple subscribers
Register two `onViewportChange` callbacks. Trigger `move`. Verify both called. Unsubscribe one. Trigger `move` again. Verify only remaining callback called.

### 4. getViewport() returns initial state
Construct MapManager. Before any `move` event fires, call `getViewport()`. Verify returns a valid Viewport reflecting the initial center and zoom.

### 5. addDataLayer
Call `addDataLayer` with a mock Custom Layer. Verify `map.addLayer` called with correct object.

### 6. addDataLayer deduplication
Call `addDataLayer` twice with the same id. Verify `map.removeLayer` called before the second `map.addLayer`.

### 7. removeDataLayer
Call `addDataLayer` then `removeDataLayer`. Verify `map.removeLayer` called with correct id.

### 8. removeDataLayer no-op
Call `removeDataLayer('nonexistent')`. Verify no error thrown and `map.removeLayer` not called.

### 9. Protocol handler — in coverage
Call the protocol handler with a tile URL whose center falls within Kartverket coverage. Verify fetch called with a Kartverket URL.

### 10. Protocol handler — outside coverage
Call the protocol handler with a tile URL outside all named provider coverage. Verify transparent 1×1 PNG returned without fetching.

### 11. Protocol handler — missing Lantmäteriet token
Construct MapManager with no Lantmäteriet token in KeyStore. Call handler with a Swedish tile. Verify no fetch attempted, transparent PNG returned.

### 12. Protocol handler — malformed URL
Call the protocol handler with a malformed URL that cannot be parsed. Verify it fails gracefully — returns transparent PNG or rejects cleanly, does not throw unhandled exception.

### 13. destroy stops viewport callbacks
Call `destroy()`. Verify `map.remove()` called. Trigger a mock `move` event after destroy. Verify no callbacks are called.

### 14. destroy followed by addDataLayer
Call `destroy()`. Call `addDataLayer()`. Verify it either throws a clear error or is a no-op — does not crash silently or leave the app in a broken state.
