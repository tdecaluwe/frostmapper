# ADR-002: Data Fetching, Processing and Caching Strategy

**Date:** 2026-03-11
**Status:** Accepted

## Context

The application needs to fetch, aggregate and cache large gridded climate datasets from THREDDS/MET Norway entirely client-side, with no backend. The core challenge is balancing data volume, interactivity and cache efficiency while keeping the architecture static and deployable on GitHub Pages.

## Decisions

### 1. Data fetching via THREDDS NCSS

Data is fetched from THREDDS using the NetCDF Subset Service (NCSS), which supports:
- **Bounding box subsetting** via `north`, `south`, `east`, `west` parameters — fetch only the visible extent
- **Stride parameter** (`horizStride`) — fetch every Nth point, matched to current zoom level to avoid fetching resolution beyond what the screen can display

Zoom level to stride mapping (approximate, at 65°N):
- Zoom 4-5: stride 4 (~4km effective resolution)
- Zoom 6-7: stride 2 (~2km effective resolution)
- Zoom 8+: stride 1 (full 1km resolution)

### 2. Request queuing and cancellation

THREDDS requests are split into small sequential chunks (e.g. one year at a time, or one spatial tile at a time) and dispatched one at a time to respect MET Norway's fair use policy. When the user pans, zooms or changes parameters, pending chunks that are no longer relevant are cancelled before the next request is dispatched. This keeps the app responsive while maintaining sequential access behaviour.

### 3. Client-side aggregation

Raw daily snow depth values are fetched and processed entirely in the browser. For the snow season length layer family, the aggregation algorithm per cell per snow year (July 1 → June 30) is:

- Find the longest consecutive run of days where snow depth ≥ threshold
- Store the result as a Uint8 value (0-255, season length in days)

This is computed for each of 4 discrete threshold levels: **5cm, 10cm, 15cm, 20cm**.

These threshold levels serve as climate scenario parameters — not just measurement calibration — allowing the user to assess how season length is affected as reliable snow depth requirements shift due to climate change.

### 4. Cache storage in IndexedDB

Computed season lengths are stored in IndexedDB as Uint8 arrays, keyed by:
`variable + threshold + year`

Storage estimate for full Norway + Sweden grid:
- ~770,000 cells × 4 thresholds × 20 years × 1 byte = **~62 MB**
- Well within IndexedDB limits
- Deflate compression deferred until needed

### 5. Percentile calculation at render time

The Nth percentile season length is computed at render time from the 20 cached yearly Uint8 arrays. This is a fast in-memory operation and requires no additional network requests. Both threshold and percentile parameters can be changed instantly without re-fetching.

### 6. Incremental cache management

The global time period parameter (default: 20 most recent years) is handled incrementally:
- **Lengthening** the time period: only the additional years are fetched and computed — existing cached years are untouched
- **Shortening** the time period: cached data for excluded years is retained in IndexedDB and evicted lazily using an LRU policy when space is needed for other data, in case the parameter is changed back

## Consequences

- No backend required — architecture remains fully static
- First load per variable is expensive (full THREDDS fetch + aggregation) but subsequent interactions are instant
- Threshold and percentile changes are free — purely local recalculation on cached data
- Time period lengthening is incremental — only new years are fetched
- Time period shortening is non-destructive — cached data retained until evicted by LRU policy
- THREDDS requests are chunked and cancellable to maintain map interactivity
- Deflate compression available as a future optimization if 62 MB becomes problematic
