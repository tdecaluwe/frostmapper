# ADR-003: Source Abstraction, Demand Model and Resolution Strategy

**Date:** 2026-03-14
**Status:** Accepted

## Context

The application fetches and derives data from multiple sources at varying resolutions, some expensive to compute and some cheap. A consistent abstraction is needed that supports dependency graphs between data sources, two-tier caching, progressive loading, and clean stride-based resolution management — while remaining modular enough that new sources can be added without touching existing code.

## Decisions

### 1. Single Source abstraction

All data is modelled as a **Source**. There is no separate DerivedSource concept — a Source with no dependencies fetches from a remote API, a Source with one or more dependencies computes from their outputs. The interface is identical in both cases.

```javascript
export default {
  id: 'source-id',
  dependencies: [],       // Empty for remote fetch Sources
  persist: true,
  queue: 'thredds',       // null for Sources with dependencies
  defaultParams: {},

  // boundingBox: { north, south, east, west } in WGS84
  // stride: power-of-2 multiple of base resolution
  // params: source-specific parameters
  // signal: AbortSignal for cooperative cancellation
  // dependencies: map of sourceId → Source instance (default {})
  async compute(boundingBox, stride, params, signal, dependencies = {}) { ... }
}
```

### 2. `get` method and chunk assembly

Each Source exposes a `get(boundingBox, stride, signal)` method provided by the core cache layer. `get` maps the bounding box to covering chunks, returns cached data immediately where available, submits tasks to the queue for missing chunks, and assembles all results into a single contiguous array before resolving.

Callers never need to know about chunk boundaries. Sources with different base resolutions and chunk sizes compose cleanly.

### 3. Promise-based dependency resolution

Sources with dependencies await their dependencies inside `compute` using `dependency.get()`:

```javascript
async compute(boundingBox, stride, params, signal, dependencies = {}) {
  const elevation = await dependencies['glo30-elevation'].get(boundingBox, stride, signal);
  // compute slope from elevation data
}
```

Dependency resolution is implicit — no central orchestrator needed. Cancellation propagates naturally through the AbortSignal.

### 4. Layer-driven demand

Layers drive data demand by observing viewport state and calling `source.get()` for needed chunks in priority order (viewport center outward, then prefetch zone). There is no central scheduler — Layers are the consumers that initiate demand.

The stop condition per Layer: all chunks in viewport + prefetch zone cached at target stride.

### 5. Chunk grid and cache keying

Fixed global chunk grid per source, aligned to base resolution. Chunk origins are always multiples of chunk size — no overlap, unambiguous cache keys.

| Source | Base resolution | Chunk size |
|--------|----------------|------------|
| SeNorge / NGCD | 1km | 256 × 256 cells (256 × 256 km) |
| hoydedata.no DTM | 0.25m | 256 × 256 cells (64 × 64 m) |
| Mapzen Terrain Tiles | ~30m | Standard z/x/y map tiles |

Cache keys: `sourceId + params + chunkX + chunkY + stride`

### 6. Resolution and stride strategy

Target stride = largest power-of-2 stride whose effective resolution is ≤ half the current screen pixel size. Data is always fetched at at least 2× finer resolution than needed.

- **Zoom prefetch**: next zoom level is implicitly prefetched
- **Data quality**: renderer averages sub-pixel data points rather than nearest-neighbour sampling

Stride ladders:
- SeNorge / NGCD (1km base): 1km, 2km, 4km, 8km...
- GLO-30 (30m base): 30m, 60m, 120m, 240m...

### 7. Progressive loading

Layers request chunks at target stride and simultaneously at coarser strides. Coarser data resolves first and renders as a placeholder. Target stride data replaces it when available.

### 8. Two-tier cache

- **In-memory**: all viewport data, all Sources
- **IndexedDB**: Sources with `persist: true`, LRU eviction, survives browser refresh

### 9. API queues and cancellation

One queue per API, sequential dispatch. Each in-flight request has an AbortController. Sources check `signal.aborted` cooperatively between sub-requests — this is critical for long-running Sources like snow season aggregation that span many sequential THREDDS requests.

| Queue | Sources |
|-------|---------|
| THREDDS | seNorge-snow, ngcd-temp-mean, ngcd-temp-max |
| hoydedata | hoydedata-elevation |
| Overpass | road-access, transport-stops |
| OpenRouteService | isochrones |

### 10. Layer rendering contracts

**Soft filter**: `valueRange: { from, to }` where `from` = unfavorable (opacity 0), `to` = favorable (opacity 1). Direction implicit in order. Each layer declares a unique `hue`. Multiple layers composited via transparency stacking.

**Hard filter**: failing cells rendered as 50% opacity grey. Multiple hard filters stack at same opacity.

**Annotation**: fully custom per layer.

Value ranges are fixed defaults per layer, user-configurable.

## Consequences

- Adding a new Source requires only a new self-contained module — no changes to existing code
- Adding a new Layer requires only a new module with a source reference and render logic
- No central scheduler — simpler system, Layers own their demand logic
- Promise-based dependency resolution is implicit and composable
- Cooperative cancellation via AbortSignal supports long-running multi-request computations
- Chunk assembly in `get` means dependency Sources with different resolutions compose cleanly
