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

- `season-estimator.js`: cohort, annual runs, endpoint quantiles, leap days and
  uncertainty. No network, OpenLayers or storage.
- `nve-source.js`: official single-cell daily histories and positive SWE evidence.
- `chunk-codec.js`: exact two-byte periods, exceptions, pending mask, quality
  metadata, binary format and browser-native DEFLATE.
- `chunk-grid.js`: stable 100×100 native-cell blocks and display tile geometry.
- `store.js`: IndexedDB v2 `chunks` store, partial-block persistence, bounded
  decoded memory, 30-day expiry and read-through migration of legacy summaries.
- `collection-queue.js`: pending-cell bitsets and weighted random viewport sampling.
- `season-worker.js`: four concurrent cell jobs, active-view priority, retained
  background work, estimation, caching and display tile requests.
- `tile-renderer.js`: worker-side aggregation of cached native cells into display
  pixels. This never fetches histories.
- `raster-source.js`: canvas-backed OpenLayers tile source, updated on chunk changes.
- `layers/snow-season.js`: controls, viewport priority and asynchronous inspection.

### Encoded blocks

Each storage block is 100×100 **native 1 km cells**, aligned to the model's
northwest corner (-75000, 8000000). Edge blocks retain their 100×100 shape;
out-of-domain padding is not fetched. A full block has 20,000 date bytes and a
1,250-byte known-cell bitmap. An unset bit means pending; a known unknown cell
has a set bit and an unknown code. Quality/uncertainty metadata and exact mean
lengths (including leap days) are retained separately in the same compressed
payload. Raw daily series are never stored.

Ordinary periods use `a=startDay`, `b=364-endDay`, `word=a|(b<<8)`.
For exceptional early/late periods, `large=256-duration` and
`small=large-boundaryOffset-1`; early uses `(a,b)=(large,small)`, late swaps them.
Accept the alternative only when `a+b>=365`. Its duration is `256-max(a,b)` and
its offset is `abs(a-b)-1`. Markers are `FFFF` (no common season), `FEFE`
(unknown) and `FDFD` (escape). Escaped start/end uint16 pairs follow in row-major
marker order. Every valid interval is preserved; 64,131 require no escape,
including every interval up to 37 days. All words are explicitly little endian.

The binary `SSC1` header records dimensions, chunk coordinates, exception count
and auxiliary metadata length. Browser-native DEFLATE compresses the entire
payload; a raw fallback is available when CompressionStream is absent. IndexedDB
stores the compression identifier, payload, namespace and timestamps. The
namespace includes estimator version, cohort and depth threshold. Up to 512
compressed blocks are retained across namespaces; decoded clean memory retains
12 blocks, while dirty blocks remain pinned until saved. Writes are batched.

### Display pyramid

Display tiles are also 100×100 pixels, at 16, 8, 4, 2 and 1 km per pixel.
At native resolution one display tile matches one storage chunk. Coarser tiles
aggregate cached native values before applying the palette; they do not average
colors or request a different upstream dataset. Pixel alpha reflects the known
valid fraction, and missing/pending cells remain transparent. Zooming beyond
native resolution enlarges the same native cells.

Both aggregation and history processing run in the worker. OpenLayers receives
RGBA tiles and handles map reprojection. Metric changes reuse the encoded
periods. No encoding, IndexedDB access or season calculation enters the main
OpenLayers render loop.

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
Collection runs in the background **even when the layer is hidden**. In the
map menu, the snow-data progress line and retry button remain visible below
the checkbox; only display settings collapse when the layer is hidden.

Pending visible native cells have first priority. Selection is random without
replacement across the entire viewport, with a smooth weighting giving the
centre up to 1.5 times the baseline odds.
After the viewport is filled, remaining queued cells are sampled randomly in
the background. A chunk's known-cell mask initializes its pending bitset in
bulk: cached cells immediately count toward the same ready-cell tally as new
downloads and never enter the sampling pool. Reservations clear pending bits
before dispatch, preventing duplicate in-flight requests. Legacy summaries are
also migrated in bulk before a chunk enters the queue.

Panning reprioritizes pending work without cancelling
up to four in-flight histories or discarding completed cells. Broad views queue
chunks lazily rather than allocating a job object for every native cell.
Failures pause collection for 30 seconds and retain the queue for retry.

The full native model domain, including the covered part of Sweden, is
`[-75000,6450000,1120000,8000000]` in EPSG:32633: 1,852,250 cells in 192
100×100 storage chunks (including partial edge chunks). Model-missing cells
remain transparent. Previous areas keep filling in the background; there is
no fixed regional dataset or visibility-dependent collection gate.

A chunk is a local storage unit, **not an upstream batch request**. Filling an
uncached chunk still requires individual daily histories. Reloads reuse known
cells, including partial blocks. The derived display layer reads those chunks
at every display zoom; it never fetches histories itself.

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
node --test tests/snow-season-node.mjs tests/snow-chunks-node.mjs
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
and local OpenLayers/proj4 modules; it does not add application dependencies.
Set `PLAYWRIGHT_MODULE`, `OL_NODE_MODULES`, and optionally `CHROMIUM_PATH` when
those tools are outside normal Node resolution. `SNOW_TEST_ARTIFACTS` enables
screenshots and JSON results. The runner serves fixtures locally and mocks NVE
histories. It checks hidden-layer collection, four-request concurrency, new-area
priority, immediate credit for 5,000 pre-cached cells without refetching, legacy migration, compressed partial-block persistence, reload reuse,
coarse display tiles and actual Web Mercator reprojection on an iPhone-sized
viewport. No historical dataset is included or fetched by this test.
