# Historical snow-season endpoints

The first snow-season component estimates **separate 95% onset and melt dates**,
using daily model data from NVE/seNorge. It is a pure JavaScript estimator with a tiled OpenLayers display layer, a
dedicated browser worker, and a private per-browser encoded chunk cache. Histories
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

The map reads the numeric NVE seNorge snow archive hosted by MET Norway:
`https://thredds.met.no/thredds/dodsC/senorge/seNorge_snow/`.
Its `sd_YYYY.nc` files expose `snow_depth` in centimetres as Float32 arrays.
The source compares positive depth (or a configured threshold converted to mm)
without using rendered map colours. The archive uses the same native 1 km UTM
zone 33 grid, with rows increasing south-to-north; the source reverses rows for
our north-to-south tile layout. Browser CORS access is supported. Attribution
remains NVE/seNorge under NLOD.

`nve-source.js` remains available for point diagnostics and comparison. It reads
raw GTS or the CORS-enabled service used by the seNorge website.

The point-feed samples contained missing depth on **18 January,
17 February and 18 February 2024**. Missing values are never treated as bare
terrain. For a zero-depth threshold, a positive **daily `swe` value** from the
same point and date establishes snow presence where depth is missing. The archive already supplies depth on some of those dates. Positive SWE
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

- `season-estimator.js`: cohort, annual runs, endpoint quantiles, leap days and
  uncertainty. No network, OpenLayers or storage.
- `archive-source.js`: numeric DAP2 windows, shared request pool, packed daily
  states, positive-SWE recovery and in-memory retry checkpoints.
- `area-grid.js`: 37×37 native fetch geometry and model-edge clipping.
- `nve-source.js`: point-feed diagnostics and comparison.
- `chunk-codec.js`: exact two-byte periods, exceptions, pending mask, quality
  metadata, binary format and browser-native DEFLATE.
- `chunk-grid.js`: 111×111 storage/display geometry.
- `store.js`: IndexedDB `chunks` store, partial-block persistence, bounded decoded
  memory and 30-day expiry. The new namespace ignores older formats; no migration.
- `collection-queue.js`: pending-cell bitsets, weighted viewport sampling and
  fetch-block reservations that exclude cells already known or in flight.
- `season-worker.js`: background scheduling, estimation, caching, display and
  inspection requests.
- `tile-renderer.js`: worker-side aggregation of cached cells into display pixels.
- `raster-source.js`: canvas-backed OpenLayers source, updated on chunk changes.
- `layers/snow-season.js`: controls, viewport priority and asynchronous inspection.

### Spatial and temporal fetching

One 111×111 storage chunk contains nine 37×37 fetch blocks. Fetches are aligned
to the model's northwest corner (-75000, 8000000) and clipped at the model edges.
The model has 1195×1550 native cells: 154 storage chunks (11×14), or 1386 fetch
blocks (33×42). Last storage chunks are 85 cells wide and 107 cells high; last
fetch blocks are 11 wide and 33 high. Storage/display blocks retain their square
shape and leave out-of-domain padding unknown and transparent.

Requests span **September–December, January–April, May–August**. Each remains
inside one calendar-year NetCDF file. The 2005-09-01 to 2025-08-31 cohort needs
60 depth requests per fetch block; each is at most 123 days and approximately
674 kB. We read one numeric DAP2 array using native fetch/DataView; no NetCDF
library, backend or distributed archive is required.

The shared pool permits eight requests in total, including any SWE recovery.
Current-view requests take priority when slots become available. Up to four
working blocks are permitted for foreground responsiveness; ordinary background
work is limited to two. Completed depth windows are retained in bounded worker
memory across retries, avoiding an automatic redownload of successful windows.
A failed request cancels its block's remaining requests and pauses new work for
30 seconds. Retry can resume earlier.

Daily values are converted to bare/snow/unknown and packed at two bits per day,
only for uncached cells. A fully uncached 37×37 block needs about 2.5 MB for its
20-year packed history. Four working histories plus eight maximum-size decoded
responses total approximately 15.4 MB, excluding cache/render buffers, browser
network copies and runtime overhead. Calculation and parsing yield regularly
so worker-side display requests remain responsive. The packed histories are
released after estimation; only encoded results reach IndexedDB.

For cells with up to eight unresolved dates, the worker requests the necessary
SWE date windows over the same area. Positive SWE establishes snow presence;
zero/missing SWE remains unknown. Fully missing model cells do not trigger
thousands of supplementary requests. Supplementary failures retain successful
work for retry; they do not silently convert unknown ground to bare ground.

### Encoded storage blocks

A full storage block has 12,321 cells: 24,642 date bytes and a 1,541-byte known-cell
bitmap. An unset bit means pending; a known unknown cell has a set bit and the
unknown code. Exact mean lengths (including leap days), historical coverage
bounds and quality flags are retained as auxiliary metadata. Archive responses
do not provide cell altitude; new records leave altitude null.

Ordinary periods use `a=startDay`, `b=364-endDay`, `word=a|(b<<8)`.
For exceptional early/late periods, `large=256-duration` and
`small=large-boundaryOffset-1`; early uses `(a,b)=(large,small)`, late swaps them.
Accept the alternative only when `a+b>=365`. Its duration is `256-max(a,b)` and
its offset is `abs(a-b)-1`. Markers are `FFFF` (no common season), `FEFE`
(unknown) and `FDFD` (escape). Escaped start/end uint16 pairs follow in row-major
marker order. Every valid interval is preserved; 64,131 require no escape,
including every interval up to 37 days. Words are explicitly little endian.

The binary `SSC2` header records dimensions, coordinates, exception count and
metadata length. Browser-native DEFLATE compresses the payload, with a raw
fallback. Cache keys include `v2/archive-111`, cohort and depth threshold. Older
100×100 blocks and legacy summaries are ignored without migration; the disk
overview still reports their stored bytes. IndexedDB keeps up to 512 blocks
across namespaces. Decoded clean memory retains 12 blocks; dirty blocks remain
pinned until saved. Writes are batched and partial chunks survive reloads.

### Display and scheduling

Display tiles are 111×111 pixels, at 16, 8, 4, 2 and 1 km per pixel. At native
resolution a display tile matches one storage chunk. Coarser tiles average
valid scalar values before applying the palette, with alpha reflecting the
known valid fraction. Missing/pending cells are transparent. Zooming beyond
native resolution enlarges the same native cells.

Collection continues with the layer hidden. Pending visible cells are sampled
randomly, with the centre weighted up to 1.5 times the baseline. Selecting a cell
reserves its entire fetch block's pending cells before dispatch, preventing
duplicate overlapping work. Fully cached fetch blocks are skipped. A partially
cached block's response necessarily includes cached cells, but they are neither
recalculated nor overwritten. Cached cells immediately count in the same tally
as newly computed cells. Panning changes priorities without discarding queued
work. A fresh format version starts a fresh tally, as requested.

Aggregation, archive decoding, compression and seasonal statistics run in the
worker. OpenLayers receives RGBA tiles and handles map reprojection. Changing
metric or projection reuses encoded periods. The snow-data progress line and
retry control remain visible in the menu when display settings are collapsed.

## Reproduce

No new runtime dependencies or build tools are required. Use a recent Node.js
with built-in fetch:

```sh
node --test tests/snow-season-node.mjs tests/snow-chunks-node.mjs tests/snow-archive-node.mjs
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

### Browser integration check

`tests/snow-chunks.html` is a small standalone OpenLayers harness. The optional
`node tests/snow-chunks-browser.cjs` runner uses an existing Playwright install
and local OpenLayers/proj4 modules. Configure `PLAYWRIGHT_MODULE`,
`OL_NODE_MODULES`, and optionally `CHROMIUM_PATH`; `SNOW_TEST_ARTIFACTS` enables
screenshots and JSON results. It serves synthetic numeric DAP2 windows locally
and checks four-month bounds, 37×37 block geometry, eight-request concurrency,
active-view priority, hidden-layer collection, immediate cache-hit credit,
111×111 compressed partial chunks, reload reuse, coarse display and actual Web
Mercator reprojection on an iPhone-sized viewport. Old formats are explicitly
ignored; no migration is tested or performed.

A real-browser check from the GitHub Pages origin fetched all 60 archive windows
for the Tafjordsfjella point (120500, 6908500). Its period (30 October–10 July,
254.25 mean days) and 18/20 whole-period coverage matched the point-feed estimator.
The archive needed no SWE recovery there; the point feed used three SWE dates.
