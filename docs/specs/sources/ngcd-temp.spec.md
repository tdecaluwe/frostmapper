# Spec: `sources/ngcd-temp-mean.js` and `sources/ngcd-temp-max.js`

## Purpose

Two parallel sources for NGCD (Nordic Gridded Climate Dataset) daily temperature data from THREDDS. Both extend `Source`. They differ only in the THREDDS variable and the aggregation the consuming source performs.

- `NgcdTempMeanSource` — fetches `tg` (daily mean temperature, °C)
- `NgcdTempMaxSource` — fetches `tx` (daily maximum temperature, °C)

The old implementations are plain objects with `compute(boundingBox, stride, params, signal)`. Both must be **discarded and rewritten**.

---

## THREDDS endpoint

```
https://thredds.met.no/thredds/ncss/ngcd/type2/v1/{year}.nc
```

Parameters:
- `var=tg` (mean) or `var=tx` (max)
- `north`, `south`, `east`, `west` — WGS84 bbox
- `horizStride` — integer
- `time_start`, `time_end` — full calendar year: `{year}-01-01` → `{year}-12-31`
- `timeStride=1`
- `accept=csv`

---

## GridTransform (NGCD grid)

NGCD uses EPSG:3035 at 1km resolution — same grid as SeNorge:

```javascript
new GridTransform({
  originX:        -75_000,
  originY:      6_450_000,
  chunkSize:      512_000,
  baseResolution:   1_000,
  nativeCRS:     'EPSG:3035'
})
```

---

## NgcdTempMeanSource

### Purpose

One instance per calendar year. Baked-in at construction:
- `year` — calendar year
- No threshold — temperature values are continuous

`compute()` returns a Grid where each cell = **mean temperature (°C) over the winter period** for this year.

The winter period is baked into the source ID and instance at construction: `winterStart` (MM-DD) and `winterEnd` (MM-DD). This ensures cache keys are stable when UI sliders change — a new source instance is created with a new ID.

### Source ID

`ngcd-temp-mean-{year}-{winterStart}-{winterEnd}` — e.g. `ngcd-temp-mean-2020-12-01-03-31`

### `compute(tileId, signal)` algorithm

```
1. Fetch full-year CSV for this.year and tileId extent
2. Filter dates to winter period (winterStart–winterEnd, wrapping year boundary)
3. For each cell, compute mean of winter-period values
4. Return Grid({ data: meanGrid, dtype: 'float32', width, height })
```

### Winter period wrapping

The winter period spans a year boundary (Dec 1 → Mar 31). The filter logic:
```javascript
const inWinter = (mmdd) => mmdd >= winterStart || mmdd <= winterEnd
```
Where `mmdd` is a `'MM-DD'` string. This works because `'12-01' >= '12-01'` (Dec is in winter), `'01-15' <= '03-31'` (Jan is in winter), and `'07-01'` fails both (summer).

---

## NgcdTempMaxSource

### Purpose

Same structure as `NgcdTempMeanSource` but fetches `tx` instead of `tg`.

`compute()` returns a Grid where each cell = **count of winter-period days with max temp > 0°C** (melt risk count). Stored as Uint8.

**Note**: The raw temp-max source stores a useful melt-day count per year directly — it does NOT store the raw daily temperature series. This is the same approach as SeNorge: heavy aggregation in `compute()`, lightweight result in cache.

### Source ID

`ngcd-temp-max-{year}-{winterStart}-{winterEnd}` — e.g. `ngcd-temp-max-2020-12-01-03-31`

### `compute(tileId, signal)` algorithm

```
1. Fetch full-year CSV for this.year and tileId extent
2. Filter dates to winter period
3. For each cell, count days where temp_max > 0°C
4. Cap count at 255
5. Return Grid({ data: meltDays, dtype: 'uint8', width, height })
```

---

## CSV format

Same format as SeNorge CSV, with `tg` or `tx` as the value column:
```
date,lat,lon,tg
2020-01-01T12:00:00Z,64.5,15.3,-5.2
2020-01-01T12:00:00Z,64.5,15.4,-4.8
...
```

---

## Error handling

Same as SeNorge: HTTP errors throw, AbortErrors re-throw, empty CSV returns null Grid.

---

## Test cases

### NgcdTempMeanSource

**1. compute() returns winter-period mean temperature**
Fixture CSV with 4 cells × 365 days. Winter period: Dec 1 → Mar 31.
- Cell A has mean winter temp of -8.5°C
- Cell B has mean winter temp of -2.1°C

Mock fetch with fixture. Verify returned Grid dtype is `'float32'`. Verify cell A ≈ -8.5 (±0.1°C), cell B ≈ -2.1.

**2. winter period filter wraps year boundary correctly**
Fixture includes days in Dec 2019, Jan–Mar 2020, and Apr–Jun 2020.
Verify only Dec, Jan, Feb, Mar days are included in the mean computation.
Verify Apr–Jun days do NOT affect the result.

**3. single cell, all winter days same temperature**
4 cells, all winter days = -10.0°C. Expected mean = -10.0.

**4. HTTP error → throws**
Mock fetch returns 503. Verify `compute()` throws.

**5. abort signal respected**
Pre-aborted signal. Verify `AbortError` thrown without fetching.

**6. cache hit on second get()**
Call `source.get()` twice. Verify `fetch` called only once.

### NgcdTempMaxSource

**7. compute() counts melt days correctly**
Fixture: 4 cells × 90 days (Dec–Mar). Cell A has 5 days with temp_max > 0°C, Cell B has 0.
Verify Grid dtype `'uint8'`. Cell A = 5, Cell B = 0.

**8. melt day count capped at 255**
Cell with 300 melt days (artificially short winter period, many melt days). Verify stored as 255.

**9. NaN/no-data values treated as non-melt**
Some dates have NaN for temp_max. Verify these days do NOT increment the melt count.

---

## Fixture files

- `tests/fixtures/ngcd-temp-mean-2020.csv` — real THREDDS NCSS CSV for a small spatial area, at least 4 cells, full year 2020. Should include winter dates (Dec, Jan, Feb, Mar) with realistic mean temps for inland Scandinavia (typically -5°C to -15°C). At least one summer date (July) to verify winter filter exclusion.

- `tests/fixtures/ngcd-temp-max-2020.csv` — same spatial area as temp-mean fixture, with `tx` values. Should include days where max > 0 (melt days) during winter to allow asserting melt count.
