# Spec: `core/bootstrap.js` and `index.html`

## Purpose

Specifies the application entry point — how all modules are wired together at startup, the initialisation order, CDN imports, and the first-run vs returning-user flow. The bootstrap is the only place that knows about all modules simultaneously.

---

## CDN imports (`index.html`)

All external libraries are loaded via CDN in `index.html` before any application modules. Load order matters — proj4js must be available before any ES module imports run.

```html
<!-- proj4js — must load before ES modules -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.9.0/proj4.js"></script>

<!-- MapLibre GL JS -->
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.18.0/dist/maplibre-gl.css">
<script src="https://unpkg.com/maplibre-gl@5.18.0/dist/maplibre-gl.js"></script>

<!-- Vue 3 -->
<script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>

<!-- Application entry point -->
<script type="module" src="src/core/bootstrap.js"></script>
```

### Map container
```html
<div id="map" style="width:100vw; height:100vh; position:absolute;"></div>
<div id="ui" style="position:absolute; top:0; left:0; z-index:10;"></div>
```

---

## Module initialisation order

The following order is required — earlier steps are dependencies of later ones:

```
1. Register proj4js CRS definitions
2. Create Queue singletons
3. Initialise Vue reactive state
4. Check KeyStore — determine first-run vs returning user
5. Initialise MapManager (map loads immediately, basemap visible)
6. Initialise RasterRenderer, register with MapManager
7. Create Sources and Layers via LayerFactory
8. Register Layers with RasterRenderer
9. Mount Vue UI
10. Prompt for KeyStore unlock (non-blocking — app already usable)
```

Steps 5-9 happen immediately without waiting for KeyStore unlock. Layers that require API keys show `locked` or `danger` state in the UI until the user unlocks.

---

## Step 1: Register CRS definitions

Must happen before any `Extent` is constructed.

```javascript
// core/bootstrap.js
import { registerCRS } from './primitives.js'

registerCRS({
  'EPSG:25833': '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  'EPSG:3035':  '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs'
})
// EPSG:4326 and EPSG:3857 are built into proj4js
```

`registerCRS` is a utility in `primitives.js` that calls `proj4.defs()` for each entry.

---

## Step 2: Queue singletons (`core/queues.js`)

```javascript
// core/queues.js
import { Queue } from './queue.js'

export const threddsQueue        = new Queue('thredds')
export const hoydedataQueue      = new Queue('hoydedata')
export const overpassQueue       = new Queue('overpass')
export const openrouteQueue      = new Queue('openrouteservice')
```

Sources import the queue they need directly from this module. No queue injection at the Source constructor level — queues are module-level singletons.

---

## Step 3: Vue reactive state

Vue 3 is loaded via CDN global script — ES module imports are not available. Use `window.Vue` destructuring:

```javascript
// core/appState.js
const { reactive, watch } = window.Vue

export const appState = reactive({
  // Global computation params — affect multiple layers
  timePeriod:    20,           // years
  winterPeriod:  { start: '12-01', end: '03-31' },
  percentile:    25,
  snowThreshold: 10,           // cm — discrete: 5 | 10 | 15 | 20

  // KeyStore status
  keyStoreState: 'uninitialised'  // 'uninitialised' | 'locked' | 'unlocked'
})
```

### Per-layer params
Each Layer has its own reactive params object created by `LayerFactory`:

```javascript
// Inside LayerFactory — window.Vue.reactive already destructured
const snowSeasonParams = reactive({
  enabled:    true,
  state:      'normal',        // 'normal' | 'warning' | 'danger' | 'locked'
  valueRange: { from: 0, to: 180 },
})
```

Layer state values:
- **`normal`** — source available, rendering correctly
- **`warning`** — optional API key missing, fallback active (e.g. Lantmäteriet — OpenTopoMap shows through)
- **`danger`** — required API key missing, layer cannot function at all
- **`locked`** — key is configured in KeyStore but KeyStore not yet unlocked

**Important**: all Vue functions (`reactive`, `watch`, `createApp`) must be accessed via `window.Vue` — not via ES module imports.

---

## Step 4: KeyStore check

```javascript
import { KeyStore } from './crypto.js'

const storage = localStorage
const isInit = KeyStore.isInitialised(storage)
const keyStore = isInit ? new KeyStore({ storage }) : null

appState.keyStoreState = isInit ? 'locked' : 'uninitialised'
```

The `keyStore` instance is passed to `MapManager` and `LayerFactory`. It is not yet unlocked at this point — that happens in step 10.

---

## Step 5: MapManager

```javascript
import { MapManager } from './map.js'

const mapManager = new MapManager({
  container:     'map',
  MapLibre:      window.maplibregl,
  keyStore,
  initialCenter: [15.0, 65.0],
  initialZoom:   5
})
```

MapManager reads the Lantmäteriet token from `keyStore` at construction. If KeyStore is locked or uninitialised, the token is unavailable — Lantmäteriet tiles are skipped silently, OpenTopoMap shows through.

---

## Step 6: RasterRenderer

```javascript
import { RasterRenderer } from './renderer.js'

const renderer = new RasterRenderer({ mapManager })
mapManager.addDataLayer(renderer)  // registers as MapLibre Custom Layer
```

---

## Step 7: Create Sources and Layers (`core/layerFactory.js`)

`LayerFactory` creates fully wired Source and Layer instances for each overlay. It takes `appState`, `renderer`, and `keyStore` as dependencies.

```javascript
import { LayerFactory } from './layerFactory.js'

const factory = new LayerFactory({ appState, renderer, keyStore })
const layers = factory.createAll()
// layers: { snowSeason, winterTemp, meltRisk, slope, roadAccess, transportStops, isochrones }
```

### LayerFactory responsibilities
- Instantiates Sources with structural config derived from `appState` (e.g. years from `timePeriod`)
- Creates per-layer reactive params objects
- Instantiates Layer subclasses with source + renderer + params
- Determines initial layer `state` based on key availability
- Watches `appState.timePeriod` — when it changes, reconfigures affected Sources

### Source construction example (snow season)
```javascript
// Inside LayerFactory.createSnowSeason()
const years = currentYears(appState.timePeriod)  // e.g. [2005, 2006, ..., 2024]

const seNorgeTransform = new GridTransform({
  originX: -75000,         // LAEA origin offset for SeNorge grid
  originY: 6450000,        // confirmed from THREDDS metadata
  chunkSize: 512_000,      // 512km chunks
  baseResolution: 1000,    // 1km native resolution
  nativeCRS: 'EPSG:3035'
})

// One child Source per year per threshold level
const childSources = THRESHOLDS.flatMap(threshold =>
  years.map(year => new SeNorgeSnowSource({
    id: `seNorge-snow-t${threshold}-${year}`,
    year, threshold,
    transform: seNorgeTransform,
    dtype: 'uint8',
    persist: true
  }))
)

const snowSeasonSource = new SnowSeasonSource({ childSources, appState })
const params = reactive({ enabled: true, state: 'normal', valueRange: { from: 0, to: 180 } })
return new SnowSeasonLayer({ id: 'snow-season', source: snowSeasonSource, renderer, params })
```

---

## Step 8: Register Layers

```javascript
for (const layer of Object.values(layers)) {
  if (layer instanceof RasterLayer) {
    renderer.register(layer)
  } else {
    // Annotation layers subscribe to viewport directly
    mapManager.onViewportChange(viewport => layer.update(viewport))
  }
}
```

---

## Step 9: Mount Vue UI

```javascript
const { createApp } = window.Vue
import { LayerPanel } from '../ui/layer-panel.js'
import { SettingsPanel } from '../ui/settings.js'

const app = createApp({
  components: { LayerPanel, SettingsPanel },
  setup() {
    return { appState, layers }
  }
})
app.mount('#ui')
```

---

## Step 10: KeyStore unlock prompt (non-blocking)

The UI mounts and the map is immediately usable. The KeyStore unlock prompt is shown as a UI panel — not a blocking modal. The user can pan the map, toggle layers (those without key requirements work immediately), and unlock when ready.

### First-run flow
```javascript
// appState.keyStoreState === 'uninitialised'
// UI shows: "Create a master password to store your API keys"
// User enters password:
const keyStore = await KeyStore.create(password, {}, localStorage)
appState.keyStoreState = 'unlocked'
// User optionally enters Lantmäteriet token:
await keyStore.set('lantmateriet', token)
mapManager.setLantmaterietToken(token)
```

### Returning user flow
```javascript
// appState.keyStoreState === 'locked'
// UI shows: "Enter your master password to unlock API keys"
// User enters password:
await keyStore.unlock(password, localStorage)
appState.keyStoreState = 'unlocked'
const token = await keyStore.get('lantmateriet')
if (token) mapManager.setLantmaterietToken(token)
// LayerFactory re-evaluates layer states
```

### Layer state transitions on unlock
After unlock, `LayerFactory` re-evaluates each layer's state:
- If required key now available → `'locked'` → `'normal'`
- If optional key now available → `'warning'` → `'normal'`
- If key configured but blank → remains `'danger'`

---

## Layer state determination

Layer state is determined at creation and re-evaluated after KeyStore unlock:

| Condition | State |
|-----------|-------|
| No keys required | `normal` |
| Optional key missing, fallback active | `warning` |
| Required key missing | `danger` |
| Key configured, KeyStore locked | `locked` |
| All required keys available | `normal` |

Layers with keys required:
- `roadAccess` — OpenRouteService (required for isochrone computation)
- `isochrones` — OpenRouteService (required)
- `winterTemp`, `meltRisk`, `snowSeason`, `slope` — no keys required
- Basemap (Lantmäteriet) — optional, OpenTopoMap fallback active

---

## `appState` changes and Source reconfiguration

When `appState.timePeriod` changes, `LayerFactory` must reconfigure affected Sources:

```javascript
watch(() => appState.timePeriod, (newPeriod) => {
  const newYears = currentYears(newPeriod)
  snowSeasonSource.reconfigure({ years: newYears })
  meltRiskSource.reconfigure({ years: newYears })
  // Sources add child Sources for new years, retain existing ones
})
```

---

## File structure additions

```
src/
  core/
    bootstrap.js      # Entry point — wires everything together
    queues.js         # Queue singletons
    appState.js       # Global Vue reactive state
    layerFactory.js   # Creates and wires Sources and Layers
```

---

## Test cases

### 1. CRS registration before Extent construction
Verify that calling `new Extent({ ..., crs: 'EPSG:25833' })` before `registerCRS()` throws a meaningful error. Verify that after `registerCRS()` it succeeds.

### 2. Queue singletons are shared
Import `threddsQueue` from two different modules. Verify both references point to the same Queue instance.

### 3. First-run KeyStore flow
`KeyStore.isInitialised()` returns false. Verify `appState.keyStoreState === 'uninitialised'`. Call `KeyStore.create('password', {})`. Verify `appState.keyStoreState === 'unlocked'`.

### 4. Returning user flow
`KeyStore.isInitialised()` returns true. Verify `appState.keyStoreState === 'locked'`. Call `KeyStore.unlock('password')`. Verify `appState.keyStoreState === 'unlocked'`.

### 5. Map usable before unlock
Construct MapManager and RasterRenderer before KeyStore unlock. Verify map renders (viewport change events fire, basemap loads). Verify layers without key requirements update normally.

### 6. Layer state on creation — no keys
Create a SnowSeasonLayer via LayerFactory with no KeyStore. Verify `params.state === 'normal'`.

### 7. Layer state on creation — key required, missing
Create an IsochronesLayer via LayerFactory with KeyStore locked. Verify `params.state === 'locked'`.

### 8. Layer state after unlock — key available
Create IsochronesLayer with KeyStore locked (`state === 'locked'`). Unlock KeyStore with valid OpenRouteService key. Verify `params.state === 'normal'`.

### 9. timePeriod change triggers Source reconfiguration
Set `appState.timePeriod = 20`. Verify SnowSeasonSource has 20 child Sources. Change to `appState.timePeriod = 25`. Verify 5 new child Sources added. Verify original 20 child Sources retained (cache preserved).

### 10. RasterLayer registered before annotation layers
Verify RasterLayer subclasses are registered with RasterRenderer. Verify annotation layers subscribe to viewport changes via MapManager. Verify no annotation layer is registered with RasterRenderer.
