# Spec: `sources/seNorge-snow.js`

## Purpose

Fetches daily snow depth data for one snow year from THREDDS NCSS (MET Norway). Extends `Source` base class from `core/cache.js`. One instance per snow year × threshold level. Baked-in at construction — not passed per call.

The old `src/sources/seNorge-snow.js` uses a plain object with `compute(boundingBox, stride, params, signal)`. It must be **discarded and rewritten** as a `Source` subclass.

---

## THREDDS endpoint

```
https://thredds.met.no/thredds/ncss/senorge/seNorge2018/Archive/seNorge2018_{year}.nc
```

Parameters:
- `var=fsw` — snow depth in cm
- `north`, `south`, `east`, `west` — bounding box in WGS84
- `horizStride` — integer stride (1 = native resolution, 2 = every 2nd cell)
- `time_start`, `time_end` — ISO8601
- `timeStride=1`
- `accept=csv`

Time range for snow year `Y`: `{Y-1}-07-01T00:00:00Z` → `{Y}-06-30T00:00:00Z`

---

## GridTransform (SeNorge grid)

SeNorge uses EPSG:3035 (LAEA) at 1km resolution:

```javascript
new GridTransform({
  originX:        -75_000,    // LAEA origin offset for SeNorge grid
  originY:      6_450_000,
  chunkSize:      512_000,    // 512km chunks
  baseResolution:   1_000,    // 1km native
  nativeCRS:     'EPSG:3035'
})
```

---

## Class interface

```javascript
export class SeNorgeSnowSource extends Source {
  constructor({ id, year, transform, dtype, persist, queue })
  // year is baked in at construction: snow year Y → fetches data for snow year Y
  // Inherits: get(extent, resolution, signal), compute(tileId, signal)

  async compute(tileId, signal)
  // → Grid — dtype: 'float32', shape: tileId.cellsPerSide × tileId.cellsPerSide
  // Values: snow depth in cm for this tileId's spatial extent
  // One call per chunk per year
}
```

---

## `compute(tileId, signal)` algorithm

1. Convert `tileId.extent` to WGS84 bbox (via proj4: EPSG:3035 → EPSG:4326)
2. Build THREDDS NCSS URL with the extent bbox, `horizStride = tileId.stride`
3. Fetch with `signal`
4. Parse CSV response → `Float32Array` of shape `(cellsPerSide × cellsPerSide)` where each cell is the **mean snow depth across all days in the snow year**

Wait — the raw source yields daily values. The base `SeNorgeSnowSource` stores the **full time series** for a year as multiple days. But the Source base class `compute()` must return a single `Grid`. 

Resolution: `SeNorgeSnowSource.compute()` returns a Grid where each cell contains the **mean snow depth (in cm) averaged across all days** in the snow year. The day-by-day time series is not exposed by this Source — time-series aggregation lives in `SnowSeasonSource`, which consumes per-year sources.

**Actually**: to support `SnowSeasonSource` computing season length (longest consecutive run), it needs access to per-day values, not just a mean. This means `SeNorgeSnowSource` must store the full time series. But a `Source` yields a single `Grid` per `TileId`. 

**Design decision**: `SeNorgeSnowSource` stores a special Grid where the dtype encodes the time series. However, the `Grid` model has a single `(width × height)` data array. 

**Solution**: The time-series data is NOT cached through the `Source` base class cache mechanism. Instead, `SeNorgeSnowSource` overrides `compute()` to return a `Grid` where:
- `width = cellsPerSide` (spatial)  
- `height = cellsPerSide` (spatial)
- `data` = **the day-count** of days with snow depth ≥ the threshold baked into this source instance

This means each `SeNorgeSnowSource` instance is parameterised by **both year AND threshold**. The source ID encodes both. This is the approach reflected in `LayerFactory`:

```javascript
const childSources = THRESHOLDS.flatMap(threshold =>
  years.map(year => new SeNorgeSnowSource({
    id: `seNorge-snow-t${threshold}-${year}`,
    year, threshold,
    transform: seNorgeTransform,
    dtype: 'uint8',
    persist: true
  }))
)
```

So `compute()` returns a Grid where **each cell = number of days with snow depth ≥ threshold** for the given year and spatial extent. This is a daily count (0–365), fitting in Uint8.

Wait — the season length metric is the **longest consecutive run**, not total days. A simple count doesn't support that computation. We need the per-day sequence.

**Final design**: `SeNorgeSnowSource` computes season length directly. It:
1. Fetches the full daily time series for the snow year via THREDDS
2. For each cell, computes the **longest consecutive run of days ≥ threshold**
3. Returns a Grid where each cell = season length in days (Uint8, max 255)

This computation happens inside `compute()`. The cache stores the already-computed season length, not the raw time series. This is the correct design — heavy computation happens once and is persisted.

---

## `compute(tileId, signal)` — final algorithm

```
1. extent = tileId.extent  (in EPSG:3035)
2. wgs84Bbox = reprojectExtentToWGS84(extent)
3. url = buildTHREDDSUrl(year, wgs84Bbox, tileId.stride)
4. response = await fetch(url, { signal })
5. parse CSV → per-cell daily time series  (timeSeriesGrid: Float32Array[days × cells])
6. for each cell:
   a. scan the time series for the longest consecutive run of days where depth ≥ threshold
   b. seasonLength[cell] = longestRun (capped at 255)
7. return new Grid({ data: seasonLength, width, height, dtype: 'uint8' })
```

The `Grid` is returned to the base class which handles caching.

---

## CSV response format

THREDDS NCSS CSV for a spatial subset:
```
date,lat,lon,fsw
2020-07-01T12:00:00Z,64.5,15.3,0.0
2020-07-01T12:00:00Z,64.5,15.4,0.0
...
2021-06-30T12:00:00Z,64.5,15.3,3.2
```

The parser must:
1. Parse unique `(lat, lon)` pairs to determine grid dimensions
2. For each cell, collect the `fsw` value for each date in chronological order
3. Build a 2D grid of time series arrays

---

## Error handling

- HTTP error (non-200): throw with status code in message
- Abort: re-throw `AbortError`
- Empty CSV (< 2 lines): return null grid (base class will skip cache write)
- NaN values in CSV: treat as 0 (no snow)

---

## Source ID

`seNorge-snow-t{threshold}-{year}` — e.g. `seNorge-snow-t10-2020`

This ensures each year × threshold combination has an independent cache entry.

---

## Test cases

### Test 1: compute() with fixture CSV — correct season length

Use a fixture CSV with 2 cells × 10 days of data where:
- Cell A: 5 days ≥ threshold, 3 consecutive — expected season length: 3
- Cell B: 0 days ≥ threshold — expected season length: 0

Mock `fetch` to return the fixture. Call `compute(tileId, signal)`. Verify returned Grid has:
- `dtype === 'uint8'`
- Cell A value = 3
- Cell B value = 0

### Test 2: longest consecutive run — gap resets counter

Fixture: 10 days, depth sequence: `[8, 8, 0, 8, 8, 8, 0, 8, 0, 8]` (threshold=5cm).
Runs: 2, 3, 1. Expected longest: 3.

### Test 3: all days below threshold → season length 0

All values below threshold. Expected Grid all zeros.

### Test 4: season length capped at 255

If the run length would be 300, it is capped at 255 (Uint8 max).

### Test 5: HTTP error → throws

Mock `fetch` returns `{ ok: false, status: 503 }`. Verify `compute()` throws an error with `503` in the message.

### Test 6: abort propagates

Call `compute()` with a pre-aborted signal. Verify `AbortError` is thrown without fetching.

### Test 7: get() yields cached chunk on second call

Call `source.get(extent, resolution, signal)` twice with same params. Verify `fetch` called only once (second call from cache).

---

## Fixture file

`tests/fixtures/seNorge-snow-2020.csv` — a minimal real CSV response from THREDDS for a small spatial area (≥ 4 cells, ≥ 30 days). Should include:
- A realistic date range (July 1 → June 30)
- Real lat/lon values from the SeNorge grid
- Mix of zero and non-zero snow depth values
- At least one cell with a clear longest-run result to assert against

The fixture must be a verbatim subset of a real THREDDS NCSS response.
