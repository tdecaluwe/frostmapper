# Build Tracker

## Status legend
- ⬜ Not started
- 🔵 Spec written
- 🟡 In progress
- ✅ Done

---

## Phase 1: Core modules
These have no dependencies on each other except crypto (standalone) and map (needs nothing). Build and test in isolation.

| Component | Spec | Build | Test |
|-----------|------|-------|------|
| `core/primitives.js` (Extent, Grid, Chunk, Viewport) | 🔵 | ⬜ | ⬜ |
| `core/queue.js` | 🔵 | ⬜ | ⬜ |
| `core/cache.js` (Source base class) | 🔵 | ⬜ | ⬜ |
| `core/crypto.js` | 🔵 | ⬜ | ⬜ |
| `core/map.js` | 🔵 | ⬜ | ⬜ |
| `core/generators.js` (merge, groupBy) | 🔵 | ⬜ | ⬜ |
| `core/layer.js` (Layer base class) | ⬜ | ⬜ | ⬜ |

## Phase 2: Elevation source
Needed by slope. Simplest remote fetch source — good first Source to establish the pattern.

| Component | Spec | Build | Test |
|-----------|------|-------|------|
| `sources/hoydedata-elevation.js` | ⬜ | ⬜ | ⬜ |
| `sources/mapzen-elevation.js` | ⬜ | ⬜ | ⬜ |

## Phase 3: Slope source + layer
First derived source. Establishes the WebGPU pipeline and the Layer pattern.

| Component | Spec | Build | Test |
|-----------|------|-------|------|
| `sources/slope.js` | ⬜ | ⬜ | ⬜ |
| `layers/slope.js` | ⬜ | ⬜ | ⬜ |

## Phase 4: THREDDS sources
All share the same queue and similar fetch patterns. Build together.

| Component | Spec | Build | Test |
|-----------|------|-------|------|
| `sources/seNorge-snow.js` | ⬜ | ⬜ | ⬜ |
| `sources/ngcd-temp-mean.js` | ⬜ | ⬜ | ⬜ |
| `sources/ngcd-temp-max.js` | ⬜ | ⬜ | ⬜ |

## Phase 5: Derived climate sources + layers

| Component | Spec | Build | Test |
|-----------|------|-------|------|
| `sources/snow-season.js` | ⬜ | ⬜ | ⬜ |
| `sources/melt-risk.js` | ⬜ | ⬜ | ⬜ |
| `layers/snow-season.js` | ⬜ | ⬜ | ⬜ |
| `layers/winter-temp.js` | ⬜ | ⬜ | ⬜ |
| `layers/melt-risk.js` | ⬜ | ⬜ | ⬜ |

## Phase 6: Annotation sources + layers

| Component | Spec | Build | Test |
|-----------|------|-------|------|
| `sources/road-access.js` | ⬜ | ⬜ | ⬜ |
| `sources/transport-stops.js` | ⬜ | ⬜ | ⬜ |
| `sources/airports.js` | ⬜ | ⬜ | ⬜ |
| `sources/isochrones.js` | ⬜ | ⬜ | ⬜ |
| `layers/road-access.js` | ⬜ | ⬜ | ⬜ |
| `layers/transport-stops.js` | ⬜ | ⬜ | ⬜ |
| `layers/isochrones.js` | ⬜ | ⬜ | ⬜ |

## Phase 7: UI

| Component | Spec | Build | Test |
|-----------|------|-------|------|
| `ui/layer-panel.js` | ⬜ | ⬜ | ⬜ |
| `ui/settings.js` | ⬜ | ⬜ | ⬜ |
| `index.html` scaffold | ⬜ | ⬜ | ⬜ |

---

## Current focus
**Phase 1 complete — all core specs written. Next up: Phase 2 — elevation source specs.**

## ADRs
| ADR | Status |
|-----|--------|
| ADR-001: Stack and data sources | ✅ |
| ADR-002: Data fetching and caching | ✅ |
| ADR-003: Source abstraction and resolution | ✅ |
| ADR-004: Projection, Extent/Chunk model | ✅ |
| ADR-005: Rendering architecture | ✅ |

---

## Known issues / decisions pending
- **CompositeSource**: a Source that wraps multiple child Sources with geographic coverage Extents, routing requests to the appropriate child. Needed for elevation (hoydedata Norway + Mapzen global). To be specced in sources phase.
- **Chunk size**: geographic chunk size per source needs finalising in source specs. Key insight: one chunk covering the viewport is fine, multi-chunk only matters for cancellation granularity and progressive loading.
- **Sweden elevation source**: Lantmäteriet equivalent of hoydedata.no not yet identified.
- **Basemap addProtocol**: test whether Kartverket/Lantmäteriet return 404 or blank tiles outside coverage — affects routing logic complexity.
- **Kartverket tile URL**: updated endpoint is `https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png` — note y and x are swapped vs standard XYZ. Update map.spec.md.
- **MapLibre CDN**: pin to specific version in bootstrap spec — `https://unpkg.com/maplibre-gl@5.18.0/dist/maplibre-gl.js`. `addProtocol` is stable and available in all recent versions — no minimum version check needed, just fail clearly if missing.
- **`setLantmaterietToken()` on MapManager**: legitimate gap — token can change at runtime via UI. Add to map.spec.md when updating Kartverket URL.
- **Storage architecture ADR needed**: current spec only covers in-memory + IndexedDB. Need to define a full storage tier policy:
  - **In-memory**: current session, fast, lost on refresh
  - **localStorage**: small (5-10MB), synchronous — settings, KeyStore blob only
  - **IndexedDB**: large async store — computed chunk cache (current)
  - **OPFS (Origin Private File System)**: large, fast, portable — precomputed data that can be exported/imported between machines, enabling users to share precomputed datasets. Investigate as replacement or complement to IndexedDB for chunk cache.
  - Different data types belong at different tiers — needs explicit policy in a new ADR-006.
- **KeyStore storage abstraction**: crypto spec should inject a storage backend rather than hardcoding localStorage, enabling test environments to use an in-memory Map and future support for OPFS. Proposed constructor: `new KeyStore({ storage })` where storage implements `getItem(key)` / `setItem(key, value)` / `removeItem(key)`.

## Missing specs (to be written)
- **`core/generators.spec.md`**: `merge(...generators)` and `groupBy(generator, keyFn, expectedCount)` — generic async generator utilities used by composite Sources
- **`core/layer.spec.md`**: Layer base class interface — Custom Layer structure, how Chunks are received and uploaded as WebGL textures, mesh generation, texture pyramid management, render params vs structural params
- **`core/bootstrap.spec.md`** (or `index.html` scaffold): app entry point, CDN imports, initialisation order, how all modules are wired together
- **App state spec**: Vue 3 reactive store shape — which properties are reactive, how Layer render param changes propagate to recomputation
- **`sources/composite.spec.md`**: CompositeSource — routes `get()` calls to child Sources based on geographic coverage

## Fixed in review
- get() signature now uses `extent` + `resolution` consistently across cache.spec and ADR-004
- compute() now consistently takes `extent` and returns `Grid`
- Chunk grid math now uses native CRS — Web Mercator coords.js removed
- Assembly section removed from cache.spec (orphaned after generator switch)
- KeyStore injected via constructor in MapManager
- destroy() removeProtocol replaced with no-op note
- metersPerPixel() formula uses 512px tiles (MapLibre default)
- Priority update no-op for in-flight tasks documented in queue.spec

## Testing strategy

### Framework
- **Vitest** for all automated tests — native ES module support, no browser required, minimal config
- The no-build-pipeline constraint applies to the app only, not test tooling
- Minimal `vite.config.js` committed to repo for test runner configuration

### Test tiers
- **Unit tests** (`npm test`): always run, no network, all external calls mocked via msw
- **Integration tests** (`npm run test:integration`): opt-in, hit real APIs, run manually or in CI with network access
- **Manual smoke tests**: documented steps in `docs/testing/smoke-tests.md` for visual browser verification

### External API mocking
- Use **msw (Mock Service Worker)** via `msw/node` for Vitest — intercepts fetch at network level
- Fixture files committed to `tests/fixtures/` — real API responses recorded once and replayed
- Required fixtures to record before writing source tests:
  - THREDDS NCSS response for a single SeNorge chunk (known bbox + stride)
  - THREDDS NCSS response for a single NGCD chunk
  - hoydedata.no `exportImage` response for a small bbox
  - Overpass API response for a small Norwegian road network area
  - OpenRouteService isochrone response for Tromsø airport
  - OpenFlights airport data response

### Notes
- Fixture responses should use small geographic extents to keep file sizes manageable
- Document the exact request parameters used to generate each fixture alongside the fixture file
- When a real API changes response format, update the fixture and re-run unit tests
