# Historical snow-season endpoints

The first snow-season component estimates **separate 95% onset and melt dates**,
using daily model data from NVE/seNorge. It is a pure JavaScript estimator with a visible OpenLayers image layer, a
dedicated browser worker, and a private per-browser summary cache. Histories
are fetched directly from NVE; no history archive or calculated regional raster
is distributed by Frostmapper.

## Definition

For reference year 2026, use 20 September–August seasons with **ending years
2006–2025**: 1 September 2005 through 31 August 2025. No 2026 data is included.
Ending-year labels avoid treating the two halves of winter as separate years.

Snow presence means **raw model snow depth > 0 mm** by default. The depth
threshold is configurable. Positive depth at this native 1 km resolution does
not establish 100% ground coverage within that square. A fractional snow-cover
requirement would be a separate condition using NVE's `sca` product.

For each season, identify its longest uninterrupted snow-covered run. A real
snow-free day splits a run. Equal-length runs select the earlier run. A season
with no snow remains in the 20-year denominator.

Sort the 20 start dates in seasonal calendar order and choose the 19th
(second-latest). Sort the 20 last-covered dates and choose the 2nd
(second-earliest). Each endpoint then has at least 19/20 empirical coverage.
These are discrete order statistics, without interpolating percentiles.

The common period runs inclusively between those dates. Inverted endpoints
mean zero days. The returned mean duration counts the actual leap days within
that fixed calendar period across the 20 seasons. It is **not** the mean of
annual run lengths or a percentile of annual lengths.

Endpoint coverage is marginal. The same full period can qualify in only 18/20
seasons; the implementation separately measures full-period historical
coverage. Neither quantity is a confidence bound on future snow conditions.

Dates are compared by month/day on a non-leap September–August calendar.
Feb 29 is retained when detecting real snow-free days. An onset on Feb 29 rounds
forward to Mar 1, and a last-covered date on Feb 29 rounds back to Feb 28 when
choosing a date that also exists in non-leap years.

## Source and missing data

- [NVE GridTimeSeries API documentation](https://api.nve.no/doc/gridtimeseries-data-gts/)
- [NVE description of the daily 1 km snow model maps](https://www.nve.no/vann-og-vassdrag/vannets-kretsloep/snoe/snoekart-paa-senorge-no/)
- [Live theme metadata](https://gts.nve.no/api/GridTimeSeries/Themes/json)

The source adapter requests `GridTimeSeries/raw/.../sd.json` in UTM zone 33N,
using raw millimetres rather than rounded human-readable centimetres. It records
source URLs, retrieval time, mean cell elevation, and evidence provenance.
NVE data is attributed under NLOD, compatible with CC BY 3.0 Norway.

The initial 20-year samples contained missing depth on **18 January,
17 February and 18 February 2024**. Missing values are never treated as bare
terrain. For a zero-depth threshold, a positive **daily `swe` value** from the
same point and date establishes snow presence where depth is missing. This
recovers presence, not a depth estimate. Zero SWE remains unknown because of
quantization; SWE cannot establish a nonzero minimum depth. Valid depth always
takes precedence over SWE.

Remaining unknown presence values are enumerated as snow/bare assignments, up
to eight unknown days by default. The estimator returns bounds over every
assignment. It supplies a single period only if its endpoints are invariant.
Too many unknown days produce `insufficient-data`, not a shortened reference
window or a fabricated zero season. Supplementary-service errors preserve this
uncertainty and are recorded.

Do not silently combine `sd3h` or `fsm2_sd` with `sd`: they are different data
products. The sampled FSM2 history did not cover all 20 years despite the
advertised theme start date.

## Responsibilities

- `src/map/snow-season/season-estimator.js`: cohort selection, annual runs,
  endpoint order statistics, leap-day handling and missing-data bounds. No
  network, OpenLayers, DOM or application state.
- `src/map/snow-season/nve-source.js`: raw NVE data, units, missing-value codes,
  positive SWE evidence and provenance. No seasonal statistics.
- `src/map/snow-season/season-worker.js`: visible-cell request scheduling (four
  concurrent cells), cancellation, estimation and caching.
- `src/map/snow-season/store.js`: bounded IndexedDB summary cache; no raw daily
  histories. Entries expire after 30 days; cohort/version is part of the key.
- `src/map/snow-season/grid.js`: native 1 km grid and palettes.
- `src/map/snow-season/raster-source.js`: small native raster snapshots, rebuilt
  on results/metric changes. OpenLayers handles projection; the render path
  performs no history fetching or statistics.
- `src/map/layers/snow-season.js`: checkbox, length/start/end selector, progress,
  map readout and viewport selection.
- `tools/snow-season/sample.mjs`: reproducible offline diagnostic point export.

## Browser access and full coverage

The CORS-enabled service used by seNorge's own website is:

```
https://services.xgeo.no/seNorgeMapAppServices/Services/UIService.svc/GetMapGridInfo
```

A GET takes a JSON `request` query parameter with `x`, `y`, `id`,
`startDateTime` and `endDateTime`. Its `MapGridValue` array is normalized from
cm to mm before estimating; missing codes are preserved. A full 7,305-day
history was checked against the raw GTS feed and matched every value.

`NveBrowserSnowDepthSource` uses that service without a proxy or backend.
The worker downloads only the requested visible native 1 km cells, with four
concurrent requests, deduplication and cancellation of departed cells. Computed
summaries persist in IndexedDB (16,384 entries), with a 4,096-entry memory cache.
Changing display metric or projection reuses the same geographical cells.

Coverage is the full native seNorge model domain, including the covered part of
Sweden. Bounds from the official `seNorgeGrid/sd` ImageServer metadata are
`[-75000,6450000,1120000,8000000]` in EPSG:32633. Water/outside-model missing
cells remain transparent. There is no fixed regional pilot dataset.

Broad views with more than 4,096 native cells show a zoom-in prompt instead of
starting a large archive download. Cached cells remain visible in the overview.
The arrow button zooms to an appropriate
scale. Coverage is not region-limited, but this is a detail layer, not an
instant national overview. Results appear as individual cells finish.

NVE's batch API at `api/MultiPointTimeSeries/ByMapCoordinateCsv` was verified
with two cells and returns individual histories. It and the legacy raw GTS
endpoint currently omit browser CORS permission. The user chose the official
single-cell browser service with caching for now. Batching would require NVE
to enable CORS or a separate stateless relay; the statistics would still be
calculated client-side.

Enable **Snow season · 95%** in the layer menu. Choose length, start or end, and
tap the map for the fixed period and its full-period frequency. A URL can enable
it directly with `snow=length`, `snow=start` or `snow=end`. `loc` retains its
Google Maps format. No new application dependencies or build tools are used.

## Reproduce

No new runtime dependencies or build tools are required. Use a recent Node.js
with built-in fetch:

```sh
node --test tests/snow-season-node.mjs
node tools/snow-season/sample.mjs 120450 6908350 trek-season.json
```

On Node 24 behind an environment HTTP proxy, use `NODE_USE_ENV_PROXY=1`.

Initial real-data checks at reference year 2026:

| Sample (longitude, latitude) | Start | Last covered date | Mean fixed-period duration |
| --- | --- | --- | --- |
| Trek area (7.715058, 62.114905) | 30 October | 10 July | 254.25 days |
| Åre (13.077, 63.398) | 6 December | 19 March | 104.25 days |
| Bergen (5.3221, 60.3929) | No common period | — | 0 days |

The first two samples used positive SWE evidence on all three missing depth
dates. Each fixed full period qualifies in 18/20 years, illustrating the
separate-endpoint definition. Bergen retains two unresolved dates, but all four
assignments give zero days, so that conclusion is invariant.
