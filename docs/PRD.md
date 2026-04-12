# Product Requirements Document — Geo Scouting Tool

## 1. Vision & Goals

This tool is a personal, browser-based map visualization application designed to help identify geographically suitable areas in Scandinavia for a dogsledding operation. It is not just a map viewer — a core part of its value is **aggregating and deriving metrics from raw gridded data sources** that are not available directly. For example, SeNorge provides daily snow cover data, but the average first or last snow-free day of the year requires aggregation over a time series. This tool performs that aggregation and exposes the results as map overlays.

The core interaction model is a map with toggleable overlays, each representing a different criterion:

- **Hard filters** gray out areas that fail a binary threshold (e.g. terrain too steep)
- **Soft filters** apply gradient overlays for criteria where more or less is better within a range (e.g. average annual snow cover duration)
- **Annotations** mark discrete points or lines of interest (e.g. public transport stops, airport travel time isolines)

Success means being able to browse Scandinavia, toggle relevant layers, and visually identify candidate areas worth investigating further — without needing to manually scroll through time series. A future extension may include surfacing properties for sale within areas of interest.

The application runs entirely in the browser (HTML + JavaScript), deployable as a static site on GitHub Pages. Cached and computed data is stored in IndexedDB or SessionStorage.

---

---

## 3. Non-Functional Requirements

### 3.1 Performance

**Progressive data loading**: THREDDS-sourced layers initiate a low-resolution pass first (high stride value), then progressively refine as more data loads. The map always displays something useful rather than remaining blank during loading. No fixed time target is specified — progressive rendering is the requirement.

**Viewport-aware progress indication**: each data source exposes a per-source loading indicator showing the proportion of cells loaded relative to what is needed for the current viewport. The indicator updates dynamically when the user pans or zooms.

**Layer toggling**: toggling a layer that is already cached must feel instant — no perceptible delay.

**Rendering**: map panning and zooming must remain smooth at 60fps with multiple layers active simultaneously.

### 3.2 Compatibility

- Target: modern desktop browsers (Chrome, Firefox, Safari, Edge — latest 2 major versions)
- Mobile: not a priority but the app should not actively break on mobile
- WebGPU is used for slope computation where available, with a Web Worker CPU fallback for unsupported browsers

### 3.3 Reliability

- If any individual data source is unavailable, the affected layer shows a clear error state. The rest of the application continues to function normally.
- IndexedDB cache persists across sessions — no reprocessing required on browser refresh unless the time period parameter has changed.
- THREDDS requests are chunked and queued sequentially. Pending chunks are cancelled when they are no longer necessary.

### 3.4 Security

API keys (Lantmäteriet token, OpenRouteService key) are stored in a locally encrypted key store, unlocked at app launch with a single user-provided master password. Encryption is implemented using the native Web Crypto API — no external library required.

### 3.5 Maintainability

- No build pipeline. All code must run directly in the browser without a compilation or bundling step.
- A single lightweight UI framework available via CDN (e.g. Alpine.js or Petite-Vue) is permitted if it improves maintainability of the UI layer.
- The layer system must be modular — adding a new layer should not require changes to unrelated code.
- Code style: clean, well-structured, KISS principles throughout.

---

## 4. Architecture Overview

The application is a fully static single-page app deployable on GitHub Pages. All data fetching, processing and rendering happens client-side. There is no backend.

Key architectural decisions are documented in the ADRs:
- **ADR-001**: mapping library (MapLibre GL JS), basemap sources, climate and terrain data sources, routing
- **ADR-002**: THREDDS data fetching via NCSS, client-side aggregation, IndexedDB caching strategy, incremental cache management

The rendering pipeline per layer is: fetch raw data from source → aggregate and derive metrics client-side → cache results in IndexedDB → render via MapLibre. For terrain layers, WebGPU accelerates the derivation step.

API keys are managed separately from application state, unlocked once at launch via a master password using the Web Crypto API.

---

## 2. Functional Requirements

### 2.1 Map Interface

The map is the primary UI element, always displayed at full viewport width and height. All other UI elements are rendered as overlays on top of the map and can be individually toggled to maximise visible information.

The map initialises centred on Scandinavia at an appropriate zoom level and supports free panning and zooming. No geographic restrictions are imposed.

Basemap tiles are blended based on map bounds:
- **Norway**: Kartverket WMTS (official topo, free, no auth)
- **Sweden**: Lantmäteriet WMTS (official topo, free, requires user-provided token)
- **Global fallback**: OpenTopoMap (no auth, contour lines, consistent topo aesthetic)

### 2.2 Layer System

Layers are organised into three types:

- **Hard filters**: binary — cells failing the threshold are grayed out
- **Soft filters**: gradient overlay — more or less favorable shown as a color gradient
- **Annotations**: point or line features rendered as GeoJSON

All layers are individually toggleable. Parameters are configurable per layer unless stated otherwise.

#### Global parameters
- **Time period**: number of most recent years to include in historical calculations (default: 20 years). Applies to all THREDDS-sourced layers.
- **Winter period**: fixed date range applied to all temperature layers for fair cross-location comparison (default: December 1 → March 31)
- **Percentile**: Nth percentile of yearly values used for applicable soft filter layers (default: 25th)

---

#### Layer 1: Snow Season Length
**Type**: soft filter
**Source**: SeNorge daily snow depth via THREDDS

For each cell and each snow year (July 1 → June 30), the season length is defined as the longest consecutive run of days where snow depth ≥ threshold. Mid-season dips below the threshold terminate the current run. Years with no qualifying snow cover receive a season length of zero.

The displayed value is the Nth percentile of season lengths across all years in the global time period.

**Parameters**:
- Snow depth threshold — one of 4 discrete precomputed levels: 5cm, 10cm, 15cm, 20cm (default 10cm)
- Percentile — shared global parameter

**Storage**: Uint8 per cell per threshold level per year in IndexedDB (~62 MB for full Norway + Sweden grid across all threshold levels and 20 years)

---

#### Layer 2a: Average Winter Temperature
**Type**: soft filter
**Source**: NGCD daily mean temperature via THREDDS

Mean temperature over the global winter period, averaged across all years in the global time period. The same fixed window is applied to all cells for fair cross-location comparison. Warmer is worse (one-sided soft filter — no penalty for cold).

**Parameters**:
- Winter period — shared global parameter
- Time period — shared global parameter

---

#### Layer 2b: Melt Risk Days
**Type**: soft filter
**Source**: NGCD daily max temperature via THREDDS

Count of days within the global winter period where daily max temperature exceeds 0°C. The displayed value is the Nth percentile across all years in the global time period. Fewer melt days is better.

**Parameters**:
- Winter period — shared global parameter
- Percentile — shared global parameter
- Time period — shared global parameter

**Storage**: Uint8 per cell per year in IndexedDB

---

#### Layer 3a: Terrain Passability
**Type**: hard filter
**Source**: hoydedata.no DTM ImageServer (Norway, 0.25m resolution), Mapzen Terrain Tiles fallback (global, ~30m resolution)
**Minimum zoom**: 10

Terrain passability is computed in two steps:

**Step 1 — Slope at scale**: for each cell, slope is computed not from immediate neighbours but from cells distance D apart, where D is the minimum meaningful travel distance for a sled (default 50m). This filters out sub-scale terrain noise (individual rocks, furrows) that does not affect sled travel.

**Step 2 — Percentile within window**: for each cell, the 90th percentile of slope values within a radius R is computed. This answers "how steep is the worst 10% of terrain in this area?" — areas with isolated steep features are not penalised, but areas with sustained steep terrain are.

R scales with zoom level, keeping the metric consistent across scales:
- Zoom 10–11: R = 500m
- Zoom 12–13: R = 200m
- Zoom 14+: R = 100m

Cells where the 90th percentile slope exceeds the threshold are grayed out.

The layer is not active below zoom 10 — at lower zoom levels terrain passability is not meaningful at the regional scale.

Slope computation is GPU-accelerated via WebGPU, with a Web Worker CPU fallback for unsupported browsers.

**Parameters**:
- Slope threshold (degrees, default 15°)
- Kernel distance D (meters, default 50m)
- Window radius R (meters, zoom-dependent default as above, user-overridable)

---

#### Layer 4a: Road Accessibility
**Type**: hard filter
**Source**: OSM via Overpass API

Cells more than 2km from the nearest road of qualifying classification are grayed out. Road classification threshold is configurable to filter out unplowed private or forest roads.

**Parameters**:
- Minimum road classification (configurable)
- Distance threshold (default 2km)

---

#### Layer 4b: Public Transport Stops
**Type**: annotation
**Source**: OSM via Overpass API

Bus and train stops rendered as point markers. Visibility is zoom-dependent — stops only appear above a configurable zoom level to avoid clutter at low zoom.

**Parameters**:
- Minimum zoom level for visibility

---

#### Layer 4c: Travel Time Isochrones
**Type**: annotation
**Source**: OpenFlights (live, airport locations and metadata) + bundled static JSON (passenger figures) + OpenRouteService (isochrone computation)

On layer load, live airport data is fetched from OpenFlights and enriched with bundled passenger figures. Airports below the passenger threshold are excluded. Drive time isochrones are computed via OpenRouteService and rendered as GeoJSON isolines. If the live fetch fails, the bundled static JSON is used as fallback silently.

**Parameters**:
- Minimum annual passenger threshold
- Isochrone time intervals (e.g. 1h, 2h, 3h)
