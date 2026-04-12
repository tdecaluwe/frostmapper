# Testing Strategy

## Goals

Tests must provide genuine confidence that the app works — not just that individual units pass. A passing test suite must give a high probability that:

1. WebGL layers render correctly in the browser without blending artefacts
2. THREDDS data is fetched, parsed, aggregated, and cached correctly
3. UI parameters update layer rendering in real time without re-fetching
4. Layer toggling, error states, and KeyStore locking/unlocking work as expected

---

## Test pyramid

```
                  ┌─────────────────────────┐
                  │   E2E / Smoke Tests      │  2–5 tests, browser only
                  │   (manual checklist)     │
                  └─────────────────────────┘
               ┌─────────────────────────────────┐
               │   Integration Tests              │  ~20 tests, Vitest
               │   (pipeline: source → layer      │
               │    → renderer mock)              │
               └─────────────────────────────────┘
         ┌─────────────────────────────────────────────┐
         │   Unit Tests (existing + new)               │  ~250 tests, Vitest
         │   (core modules, sources, layers, UI)       │
         └─────────────────────────────────────────────┘
```

---

## Unit tests

### Existing (205 passing)

All core module unit tests in `tests/core/`. These cover `primitives`, `cache`, `queue`, `generators`, `crypto`, `map`, `layer`, `renderer`, `bootstrap`.

### New unit tests to add

| File | Count | Description |
|------|-------|-------------|
| `tests/core/renderer-compositing.test.js` | 7 | Premultiplied alpha, CLAMP_TO_EDGE, shader error logging |
| `tests/layers/snow-season.test.js` | 4 | SnowSeasonLayer subclass getters and update() |
| `tests/layers/winter-temp.test.js` | 3 | WinterTempLayer subclass |
| `tests/layers/melt-risk.test.js` | 3 | MeltRiskLayer subclass |
| `tests/layers/slope.test.js` | 4 | SlopeLayer hard-filter, zoom restriction |
| `tests/sources/seNorge-snow.test.js` | 7 | SeNorgeSnowSource with fixture CSV |
| `tests/sources/ngcd-temp-mean.test.js` | 6 | NgcdTempMeanSource with fixture CSV |
| `tests/sources/ngcd-temp-max.test.js` | 3 | NgcdTempMaxSource with fixture CSV |
| `tests/sources/snow-season-source.test.js` | 5 | SnowSeasonSource percentile aggregation |
| `tests/sources/melt-risk-source.test.js` | 4 | MeltRiskSource percentile aggregation |
| `tests/sources/slope-source.test.js` | 8 | SlopeSource CPU/GPU |
| `tests/ui/layer-panel.test.js` | 8 | Layer toggle, state transitions, progress |
| `tests/ui/settings.test.js` | 6 | Global params, keyStore lock/unlock states |

Total new: ~68 tests → ~273 total.

---

## Integration tests (`tests/integration/`)

Integration tests exercise multiple modules wired together, with mocked I/O boundaries (network + WebGL). A passing integration test suite means the data pipeline is functionally correct end-to-end.

### Pipeline integration test (`tests/integration/pipeline.test.js`)

Tests the full: Source → RasterLayer → RasterRenderer pipeline.

**Setup:**
- Mock GL context (same mock used in unit tests)
- Mock MapManager with controllable viewport callbacks
- Construct a real `SnowSeasonSource` with mock child sources (no network)
- Construct a real `SnowSeasonLayer`
- Construct a real `RasterRenderer` with mock GL

**Test 1: viewport change → chunk uploaded → render() draws**
1. Fire a Viewport change
2. SnowSeasonLayer.update() calls source.get() → yields 1 Chunk
3. RasterLayer.generateMesh() runs (real, not mocked)
4. renderer.upload() called with real Grid and real mesh vertices
5. Call renderer.render(gl, matrix)
6. Verify gl.drawArrays was called (layer rendered on screen)

**Test 2: params change → getParams closure returns new value → render() uses updated uniform**
1. Upload chunk with `params.valueRange = { from: 0, to: 180 }`
2. Render — verify `uniform1f` called with `valueMax = 180`
3. Mutate `params.valueRange.to = 360`
4. Render again — verify `uniform1f` called with `valueMax = 360` (no re-upload)

**Test 3: second viewport → stale chunk released → new chunk uploaded**
1. Upload chunk for viewport A
2. Fire viewport B (different spatial extent)
3. Layer update runs → no overlap with A → A's release() called
4. New chunk for B is uploaded
5. Verify gl.deleteTexture called once (A released), gl.createTexture called twice total

**Test 4: abort in-flight update → render continues with previous data**
1. Upload chunk for viewport A (gl.createTexture called)
2. Fire viewport B — update starts but is slow
3. Before B completes, fire viewport C — B is aborted
4. C completes successfully — C's chunk uploaded
5. Verify only A and C appear in render() draw calls (B was aborted before upload)

**Test 5: multiple layers — draw order preserved**
1. Register SnowSeasonLayer, then SlopeLayer
2. Upload one chunk for each
3. Call render()
4. Verify SnowSeasonLayer's chunk drawArrays call happens before SlopeLayer's

### Source integration test (`tests/integration/source-pipeline.test.js`)

**Test 6: seNorge → snow-season pipeline**
- Mock fetch returning seNorge fixture CSV
- Construct real `SeNorgeSnowSource` (threshold=10cm, year=2020)
- Construct real `SnowSeasonSource` wrapping 3 years of it (mocked to return pre-computed Grids)
- Call `source.get()` for a known extent
- Verify returned Chunk has correct season length at a known cell

**Test 7: cache prevents re-fetch**
- First get() → fetch called once → result cached
- Second get() with same extent → fetch NOT called → cached Grid returned instantly

**Test 8: source abort during multi-year aggregation**
- SnowSeasonSource wrapping 5 year sources
- Abort after 2 years yielded
- Verify exactly 2 child fetches completed; 3 were cancelled

---

## Fixture strategy

Each THREDDS source has its own fixture file in `tests/fixtures/`:

| Fixture | Source | Description |
|---------|--------|-------------|
| `seNorge-snow-2020.csv` | SeNorgeSnowSource | ≥4 cells, 365 days, real lat/lon from EPSG:3035 grid |
| `ngcd-temp-mean-2020.csv` | NgcdTempMeanSource | ≥4 cells, 365 days, `tg` values for Norway |
| `ngcd-temp-max-2020.csv` | NgcdTempMaxSource | ≥4 cells, 365 days, `tx` values |

Fixtures are **verbatim subsets of real API responses** — not synthetically generated. They are committed to the repository. When a real THREDDS response is obtained, the CSV is truncated to a 2×2 to 4×4 spatial grid for size constraints but must contain real values.

### How to generate fixtures

```bash
# seNorge 2020 — 2x2 cell area near Røros (63.5°N, 11.0°E to 63.52°N, 11.03°E)
curl "https://thredds.met.no/thredds/ncss/senorge/seNorge2018/Archive/seNorge2018_2019.nc\
?var=fsw\
&north=63.52&south=63.50&east=11.03&west=11.00\
&horizStride=1\
&time_start=2019-07-01T00:00:00Z\
&time_end=2020-06-30T00:00:00Z\
&timeStride=30\
&accept=csv" > tests/fixtures/seNorge-snow-2020.csv
```

`timeStride=30` reduces the file to ~12 rows per cell (monthly samples) while still exercising the parser. For tests requiring correct season length, synthetic per-cell time series can be prepended to the real header.

### Fixture-based mock pattern

```javascript
import { readFileSync } from 'fs'
import { join } from 'path'
import { vi } from 'vitest'

// In test setup:
const csvFixture = readFileSync(join(__dirname, '../fixtures/seNorge-snow-2020.csv'), 'utf8')
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  text: () => Promise.resolve(csvFixture),
}))
```

---

## Smoke test checklist (manual, browser)

Run after deploying to a local server (`npx serve .` or equivalent). These are manual checks that confirm the app works end-to-end in a real browser with real WebGL and real THREDDS network calls.

### Smoke Test 1: App loads without errors

- Open browser dev tools console
- Navigate to `index.html`
- Expected: no JS errors, map loads, basemap visible over Norway

### Smoke Test 2: Snow season layer renders

- Enable the Snow Season layer
- Zoom to Norway
- Wait for loading indicator to complete
- Expected: blue gradient overlay appears, darker blue in areas with longer snow seasons (inland mountains, north)
- Expected: no solid white/grey rectangle — smooth gradient

### Smoke Test 3: Slope layer renders at zoom 10+

- Zoom in to mountainous area in Norway (e.g. Jotunheimen) to zoom ≥ 10
- Enable Slope layer
- Expected: grey overlay appears on steep cells within seconds of tiles loading
- Expected: no slope layer visible when zoomed back out to zoom 9

### Smoke Test 4: Real-time parameter update

- Enable Snow Season layer with `valueRange.to = 180`
- Observe blue gradient
- Change `valueRange.to` to 90 via the settings panel
- Expected: gradient intensifies immediately (no re-fetch) — cells that previously showed 50% opacity now show full opacity

### Smoke Test 5: Layer toggle — instant re-show from cache

- Enable Snow Season layer, wait for data to load
- Disable the layer
- Re-enable the layer
- Expected: overlay reappears within 100ms with no network request (data served from cache)

### Smoke Test 6: WebGL blending — no artefacts

- Enable all three soft filter layers simultaneously (snow season, winter temp, melt risk)
- Zoom to an area with data for all three
- Expected: layers blend correctly — each contributes its hue without white halos or colour inversion artefacts
- Note: if premultiplied alpha is broken, you will see white edges around colour transitions

### Smoke Test 7: KeyStore flow

- On first load: settings panel shows "API keys not configured"
- Enter master password and Lantmäteriet token
- Expected: Lantmäteriet basemap tiles replace OpenTopoMap in Sweden
- Reload the page
- Expected: settings panel shows "Locked — enter password to unlock"
- Enter password
- Expected: Lantmäteriet tiles reappear

---

## Coverage target

Coverage is tracked via Vitest's built-in coverage reporter (`v8`). Target: **≥ 95% line coverage** across `src/core/`, `src/sources/`, and `src/layers/`. UI components are excluded from the numeric target (JSDOM limitations make 100% impractical for DOM-heavy code) but must have meaningful happy-path and error-state coverage.

Run coverage: `npx vitest run --coverage`

Lines NOT required to be covered by unit tests (covered by smoke tests instead):
- WebGPU compute pipeline paths (no WebGPU in Node.js test environment)
- MapLibre map initialisation (requires browser DOM)
- IndexedDB persistence (mocked in unit tests; real persistence tested by smoke test 5)
