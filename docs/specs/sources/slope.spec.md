# Spec: `sources/slope.js`

## Purpose

Derived `Source` subclass that computes terrain slope from elevation data. Consumes `CompositeElevationSource` (which wraps hoydedata + Mapzen). Returns a Grid where each cell = 90th percentile slope (degrees) within a configurable window radius.

---

## Computation pipeline

Two steps per cell (per PRD section 3a):

**Step 1 — Slope at scale**: compute slope between cells separated by distance D (default 50m), not immediate neighbours. Filters out sub-scale terrain noise.

```
slopeAt(cell, D) = atan( |elevation[cell] - elevation[cell_D_away]| / D ) * (180/π)
```

Computed in 4 cardinal directions (N, S, E, W). The maximum directional slope is the cell's slope value.

**Step 2 — Percentile within window**: for each cell, compute the 90th percentile of slope values within radius R. Answers "how steep is the worst 10% of terrain in this area?"

R is zoom-dependent (baked into source at construction from viewport zoom):
- Zoom 10–11: R = 500m
- Zoom 12–13: R = 200m  
- Zoom 14+:   R = 100m

---

## GridTransform

Elevation data (hoydedata) uses EPSG:25833 at 0.25m native resolution, but slope is computed at coarser stride. The GridTransform matches the elevation source:

```javascript
new GridTransform({
  originX:       -75_000,   // EPSG:25833 extent covering Norway
  originY:     6_450_000,
  chunkSize:     50_000,    // 50km chunks
  baseResolution:    250,   // 0.25m (subsampled by stride)
  nativeCRS:  'EPSG:25833'
})
```

---

## Computation: CPU vs WebGPU

`compute()` attempts WebGPU first, falls back to CPU:

```javascript
if (typeof navigator !== 'undefined' && navigator.gpu) {
  try {
    return await this.#computeGPU(elevationGrid, tileId, signal)
  } catch {
    return this.#computeCPU(elevationGrid, tileId)
  }
}
return this.#computeCPU(elevationGrid, tileId)
```

### CPU implementation

Pure JS Sobel-like convolution:
1. For each cell (excluding border), compute slope at scale D in 4 directions
2. Store max directional slope
3. Compute 90th percentile within radius R using a sliding window

### WebGPU implementation

Separate compute shader pipeline:
1. Upload elevation texture to WebGPU
2. Dispatch compute shader for slope-at-scale pass
3. Dispatch compute shader for percentile-window pass
4. Read back result buffer as Float32Array

WebGPU results must match CPU results within ±0.5 degrees.

---

## Zoom restriction

The layer is not active below zoom 10. The `SlopeSource` itself has no zoom restriction — the `SlopeLayer`'s `update()` method skips the call when `viewport.zoom < 10`.

---

## Source ID

`slope-D{kernelMeters}-R{radiusMeters}-z{zoom}` — e.g. `slope-D50-R500-z11`

---

## Test cases

**1. CPU slope computation — flat terrain → slope 0**
Elevation Grid all same value (flat terrain). Verify all slope values = 0 or near-0 (floating point tolerance ±0.01°).

**2. CPU slope computation — uniform incline → known slope**
Elevation Grid with a uniform incline: cell[i] = i * cellSizeMeters * tan(15°). Kernel distance D = cellSizeMeters. Expect slope ≈ 15° for interior cells.

**3. 90th percentile window — mostly flat with a steep peak**
A 5×5 grid, all cells 0° except center cell at 45°. Radius R covers the full grid. 90th percentile of 25 values where 1 is 45° and 24 are 0°: at 90th percentile (index 22 of 25 sorted), result is 0°. Verify.

**4. 90th percentile window — mostly steep**
A 5×5 grid, all cells 20° except 2 cells at 5°. 90th percentile: sorted, index 22/25 → 20°. Verify.

**5. WebGPU fallback — no navigator.gpu → uses CPU**
Mock `navigator.gpu` as undefined. Verify CPU path executes (no error, returns valid Grid).

**6. WebGPU error → falls back to CPU**
Mock `navigator.gpu` exists but GPU compute throws. Verify CPU fallback runs and result is valid.

**7. abort signal cancels elevation fetch**
Child elevation source awaits network. Abort signal. Verify AbortError propagates.

**8. dtype is float32**
Verify returned Grid has `dtype === 'float32'`.
