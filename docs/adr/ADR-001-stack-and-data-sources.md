# ADR-001: Technology Stack and Data Sources

**Date:** 2026-03-09
**Status:** Accepted

## Context

This application is a personal, browser-based spatial visualization tool for identifying suitable dogsledding locations in Scandinavia. It runs as a static site on GitHub Pages (HTML + JavaScript only), with no backend. Data is fetched at runtime, aggregated client-side, and cached in IndexedDB. The choice of mapping library and data sources has significant architectural implications.

## Decisions

### 1. Mapping library: MapLibre GL JS

Chosen over Leaflet for the following reasons:
- Native Cloud Optimized GeoTIFF support via `maplibre-cog-protocol`, required for GLO-30 terrain data
- Native contour line rendering via `maplibre-contour`
- Built-in raster layer blending, core to the overlay architecture
- Smooth WebGL rendering when multiple raster overlays are active
- Native vector tile support for future-proofing

Known tradeoffs:
- Steeper learning curve than Leaflet
- More verbose style specification for dynamic layer manipulation

### 2. Basemap tiles

Layered strategy based on map bounds:
- **Norway**: Kartverket WMTS — official topo, free, no auth
- **Sweden**: Lantmäteriet WMTS — official topo, free, requires token
- **Global fallback**: OpenTopoMap — no auth, contour lines, consistent topo aesthetic

### 3. Climate and snow data: THREDDS/MET Norway

Accessible directly from the browser (confirmed via testing — CORS open, no auth required). Provides:
- **SeNorge**: snow depth, snow water equivalent, bulk snow density at 1 km resolution from 1957
- **NGCD**: daily temperature and precipitation covering Norway, Sweden and Finland at 1 km resolution from 1961

Rejected alternatives:
- **Open-Meteo**: browser accessible and no auth, but 10 km resolution insufficient for mountainous terrain
- **Copernicus CDS**: CORS unverified, requires API key, added complexity without clear benefit given THREDDS availability

### 4. Terrain data: hoydedata.no DTM + Mapzen Terrain Tiles fallback

**Primary (Norway)**: hoydedata.no ArcGIS ImageServer, confirmed browser accessible (CORS open, no auth). Provides Norway's National Detailed Elevation Model at 0.25m resolution (F32 pixel type) via `exportImage` REST endpoint. Returns a temporary GeoTIFF URL for any requested bounding box and size. Coordinates in EPSG:25833 — bounding boxes must be reprojected from WGS84 before requesting.

**Fallback (global)**: Mapzen Terrain Tiles hosted on AWS S3. Browser accessible, no auth, ~30m resolution, served as standard z/x/y tiles with elevation encoded in RGB pixel values. MapLibre has native support.

Used to derive:
- Terrain passability (slope at scale, percentile within window)

Rejected alternatives:
- **Copernicus GLO-30 on AWS S3**: CORS not enabled on the S3 bucket — browser fetch blocked
- **OpenTopoData**: rate limited (1000 calls/day), unsuitable for gridded overlays

### 5. Routing and isochrones: OpenRouteService

Free tier, browser accessible, OSM-based, returns GeoJSON isolines directly. Used for travel time annotations (e.g. distance from nearest international airport). Requires a free API key.

## Consequences

- No backend required — static GitHub Pages deployment is viable
- All data fetching, aggregation and caching happens client-side
- IndexedDB used for caching computed tiles to avoid redundant requests
- Lantmäteriet and OpenRouteService require API keys — stored in browser, entered by user on first launch
- THREDDS requests are chunked and queued sequentially — pending chunks are cancellable when the user pans or changes parameters
