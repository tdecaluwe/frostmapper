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

The depth slider selects **0, 5, 10, 15 or 20 cm**. Zero means positive
snow depth; the other minima are inclusive. The preference is saved locally.
All five thresholds are fetched and calculated together, regardless of the
selected height or layer visibility. Positive depth at this native 1 km resolution does
not establish 100% ground coverage within that square. A fractional snow-cover
requirement would be a separate condition using NVE's `sca` product.

For each season, identify its longest uninterrupted snow-covered run. A real
snow-free day splits a run. Equal-length runs select the earlier run. A season
with no snow remains in the 20-year denominator.

The 0 cm interval is the main annual season. For each higher threshold, choose
the longest uninterrupted run **inside the preceding lower-depth interval**.
Thus every year has five nested intervals. This intentionally excludes a deeper
run in a different, shorter snow episode. Empty inner intervals remain empty.

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
The source immediately converts centimetres to five threshold bands without
using rendered map colours. The archive uses the same native 1 km UTM
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

The annual estimator compares the longest run with unresolved days treated as
bare and covered, inside the already-certain parent interval. Equal winning
endpoints prove the interval invariant for every intermediate assignment.
Otherwise that threshold and deeper thresholds remain unknown for the year.
The cache stores the known prefix length separately, rather than fabricating an
empty season. A SWE-recovered day is certain at 0 cm and unknown at higher minima.

The 95% summary bounds unknown yearly endpoints by empty/full possibilities.
A period is displayed only when its endpoints are invariant, or every possibility
has zero length. Unknown years stay in the denominator and full-period coverage
is reported as a range. The older `season-estimator.js` remains the independent
point-diagnostic implementation, including its exhaustive missing-day bounds.

Do not silently combine `sd3h` or `fsm2_sd` with `sd`: they are different data
products. The sampled FSM2 history did not cover all 20 years despite the
advertised theme start date.

## Responsibilities

- `annual-seasons.js`: nested annual runs, known-depth prefixes, endpoint
  quantiles, uncertainty bounds and leap-day calendar conversion.
- `season-estimator.js`: cohort and independent point-diagnostic reference.
- `archive-source.js`: numeric DAP2 windows, shared request pool, packed daily
  states, positive-SWE recovery and in-memory retry checkpoints.
- `area-grid.js`: 111×111 native fetch geometry and model-edge clipping.
- `nve-source.js`: point-feed diagnostics and comparison.
- `interval-codec.js`: bounded arithmetic coding of five half-open intervals
  into exactly eight bytes, including empty intervals and leap years.
- `annual-chunk-codec.js`: year-major interval words, three-bit quality prefixes,
  pending mask, binary format, selected-depth summary cache and native DEFLATE.
- `chunk-codec.js`: legacy two-byte codec, retained for diagnostic tests.
- `chunk-grid.js`: 111×111 storage/display geometry.
- `store.js`: IndexedDB `chunks` store, partial-block persistence, bounded decoded
  memory and 30-day expiry. The new namespace ignores older formats; no migration.
- `collection-queue.js`: pending-cell bitsets, weighted viewport sampling and
  fetch-block reservations that exclude cells already known or in flight.
- `season-worker.js`: background scheduling, estimation, caching, display and
  inspection requests.
- `tile-renderer.js`: cooperative worker-side aggregation of cached scalar
  summaries into display pixels.
- `render-queue.js`: shared rendering, viewport/scale priority, preemption of
  preload work and cancellation of obsolete depth/metric selections.
- `raster-source.js`: canvas-backed OpenLayers source, updated on chunk changes.
- `layers/snow-season.js`: controls, viewport priority, worker RPC and inspection.
- `tab-recovery.js`: tab/connection lifecycle, debounced worker liveness probes
  and one bounded worker replacement when a visible tab cannot reach its worker.

### Spatial and temporal fetching

One 111×111 storage chunk is also one spatial request block. Fetches are aligned
with the model's northwest corner (-75000, 8000000) and clipped at its edges.
The model has 1195×1550 native cells: 154 chunks (11×14). Edge chunks are
85 cells wide and 107 cells high. Stored/display blocks leave padding unknown.

Requests span **September–December, January–April, May–August**, each within
one calendar-year file. A 20-winter chunk requires 60 depth requests, versus
540 for the previous nine 37×37 subdivisions. The total value count is unchanged.
The largest response contains 123 days and approximately 6.06 MB of Float32
values. Native fetch/DataView reads one numeric DAP2 array without a NetCDF library.

[MET's THREDDS guidance](https://thredds.met.no/thredds/catalog.html) asks clients
to avoid parallel downloads. `download-gate.js` holds an origin-wide Web Lock
through each response body, shared by cooperating tabs and workers. There is
one local request slot, with dynamic foreground priority. A second region lock
protects each annual read/modify/save transaction, preventing two tabs from
fetching the same completed snow year. Ownership locks are temporary; the browser
releases them on worker termination. A suspended owner can delay other tabs until
its request finishes or is cancelled. Older running versions must be reloaded to
participate. Browsers without Web Locks keep cached display available but do not
start uncoordinated downloads.

A small IndexedDB coordination record persists pacing and overload deadlines,
not lock ownership. A successful download leaves a 250 ms gap. HTTP 429 honors
an accessible `Retry-After` value (seconds or HTTP date); otherwise its initial
backoff is 30 s. HTTP 5xx starts at 5 s and transport failures at 1 s, with
exponential growth, jitter and a 5-minute cap on inferred delays. Explicit
`Retry-After` is not capped. CORS must expose that header to the browser; when
it does not, the inferred delay applies. Permanent HTTP errors are not retried.
Individual requests have up to three attempts. Exhausted retries pause the local
collector for 30 s. Tab resume/manual retry cannot clear the shared deadline.
Streaming response progress keeps healthy large downloads from appearing stalled.

`chunk-collector.js` processes one September–August winter at a time. Daily depth
bands occupy one nibble per uncached cell/day: at most 2,254,743 bytes for one
111×111 leap-year history (about 2.15 MiB). Two active collectors need at most
4.30 MiB for packed histories, plus one ~5.78 MiB response, transient body copies,
lookup arrays, decoded chunks and runtime overhead. These are component estimates,
not an RSS limit. Ordinary background work uses one collector; a new foreground
area may use a second. Raw histories are never persisted and are released after
annual estimation. Processing yields regularly.

Annual encoded words are saved before releasing the region lock. A 20-bit annual
completion bitmap occupies the existing SSC3 header's reserved word at byte 28.
Older chunks read as bitmap zero; known cells are preserved and excluded from
calculation. Pending cells become visible only after their entire 20-year cohort
is complete. Reopening a tab rechecks disk under the region lock and skips saved
years. No cache migration or namespace change is required.

A small sequential transport sample on 2026-11-27 (two requests per size, same
123-day period near Tafjordsfjella) measured 37×37 at 2.120–2.805 s and 111×111 at
1.388–1.767 s. Response sizes were 673,701 and 6,062,087 bytes respectively. This
supports reducing request overhead, but is not a sustained throughput guarantee.

For cells with up to eight unresolved dates, the worker requests the necessary
SWE date windows over the same area. Positive SWE establishes snow presence;
zero/missing SWE remains unknown. Fully missing model cells do not trigger
thousands of supplementary requests. Supplementary failures retain successful
work for retry; they do not silently convert unknown ground to bare ground.

### Encoded storage blocks

Each cell stores 20 annual **eight-byte words**: 160 bytes of interval payload.
A word represents five nested half-open intervals `[start,end)` in the actual
September–August year. Equal endpoints mean empty. The endpoint alphabet has
366 boundaries in a normal year and 367 in a leap year; both fit in 64 bits.
No leap day or short interval is dropped.

Words are arranged year-major so spatial neighbours remain adjacent. Separate
three-bit values record how many leading depth thresholds are certain (0–5),
and one bit per cell distinguishes fetched from pending. A full 111×111, 20-year
block is 1,971,360 interval bytes + 92,408 quality bytes + 1,541 known-cell bytes
+ a 32-byte `SSC3` header: **2,065,341 bytes before DEFLATE**. Missing evidence is
quality information, not an empty interval. No daily histories or per-cell JSON
summaries reach IndexedDB.

The arithmetic codec uses a 52-bit bounded state and polynomial run-tail
batching; it needs no runtime BigInts or lookup tables. Tests check the exact
finite-precision grid-width bound, empty suffixes and leap-year round trips.

Keys include `v3/annual-depths` and the cohort, but **not** the selected depth.
Older summaries cannot supply the missing depth/year information, so the new
namespace is populated afresh without migration. The disk overview still counts
older stored data. IndexedDB retains up to 512 blocks across namespaces. Four
clean populated chunks are kept in memory; dirty chunks remain pinned until
saved. Empty uncached chunks allocate only their known-cell mask. Selected-depth
summaries use small typed arrays and are invalidated on writes or depth changes.

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
minimum depth, metric or projection reuses the same annual words. The slider
invalidates display tiles without scheduling a new history download.

Collection slices yield after about 6 ms; rendering yields in roughly 4 ms
slices. Inspection messages bypass the rendering queue. Repeated requests for
the same tile share work, each receiving its own transferable pixel buffer.
Visible tiles at the current display scale take priority over preload tiles.
A changed depth/metric cancels obsolete queued and running renders.

New cells mark affected native tiles dirty, without clearing their images or
invalidating in-flight initial loads. Refreshes are coalesced and published only
after replacement pixels are available; OpenLayers retains the previous
reprojection while the next revision renders. Hidden and off-viewport refreshes
wait until needed. Background collection continues independently. Fully bounded
and incomplete scalar summaries are both cached, preserving their quality fields.

The progress indicator counts only actual annual calculation as processing,
excluding network waits and disk flushes. Cached inspections normally update
without a loading message; the message appears only after 150 ms. Moving the map,
changing depth or hiding the layer cancels the old readout, so a late result
cannot reopen it for the wrong view.

### Returning to suspended tabs

`pageshow`, foreground visibility and `online` events trigger a debounced local
worker probe. A responsive worker clears network backoff and restarts only groups
with no response progress for at least 15 seconds; an `online` transition forces
old connections to restart. Completed temporal windows stay in the in-memory
checkpoint, so reconnecting retries unfinished windows rather than restarting
all 20 years. Intentional interruptions do not produce a `Load failed` alert.
Healthy recent transfers are left running on ordinary foreground events.

A visible tab replaces a worker that fails to answer within 10 seconds, rejects
its abandoned RPCs and reconstructs work from IndexedDB. Hidden tabs cancel the
probe, not background collection. A late event from the old worker cannot stop
its replacement. Persisted annual chunks and the selected depth are preserved;
completed snow years survive worker discard; an unfinished year may need to be fetched again.

IndexedDB handles clear on unexpected close or version change. Reads/writes
retry a closed/interrupted transaction once with a fresh connection. A failed
read is not silently classified as a cache miss, and failed writes leave dirty
chunks intact for a later save. This uses the existing `SSC3` format and cache
namespace; no migration or cache reset is required.

 The snow-data progress line and
retry control remain visible in the menu when display settings are collapsed.

## Reproduce

No new runtime dependencies or build tools are required. Use a recent Node.js
with built-in fetch:

```sh
node --test tests/snow-season-node.mjs tests/snow-chunks-node.mjs tests/snow-archive-node.mjs tests/snow-depths-node.mjs tests/snow-render-node.mjs tests/snow-recovery-node.mjs
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
and checks four-month bounds, 111×111 block geometry, serial download concurrency,
active-view priority, hidden-layer collection, immediate cache-hit credit,
111×111 compressed partial chunks, reload reuse, persisted depth selection, depth-dependent pixels and actual Web
Mercator reprojection on an iPhone-sized viewport. Old formats are explicitly
ignored; no migration is tested or performed.

A real-browser check from the GitHub Pages origin fetched all 60 archive windows
for the Tafjordsfjella point (120500, 6908500). Its period (30 October–10 July,
254.25 mean days) and 18/20 whole-period coverage matched the point-feed estimator.
The archive needed no SWE recovery there; the point feed used three SWE dates.

`tests/snow-refresh-browser.cjs` additionally checks an update arriving during
initial loading, coalesced refreshes, hidden refresh suspension, and continuous
nontransparent pixels through an actual Web Mercator reprojection refresh. The
chunk integration check measures cached inspection while a large overview render
is pending, and rejects obsolete readouts after a view change. These checks use
synthetic data rather than downloading seNorge archives.

The chunk browser check also restores a responsive tab, simulates a silently
terminated worker and verifies its replacement can read existing cached cells.
It closes a real IndexedDB connection and checks that reading the same cached
cell reopens it. Node recovery tests cover transient retries, bounded failures,
stalled-window checkpoints, abortable retry delays and hidden-tab watchdogs.

`tests/snow-download-node.mjs` checks whole-body lock scope, shared backoff,
annual checkpoint recovery and concurrent collectors. `tests/snow-download-browser.cjs`
uses two real tabs/workers to verify a maximum of one concurrent download,
persistent cooldown after the owner closes, and lock release on worker termination.
