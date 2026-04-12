# Spec: Raster Layer Subclasses

## Purpose

This spec defines the four concrete `RasterLayer` subclasses that implement the raster overlay pipeline. Each subclass declares its rendering identity (`layerType`, `hue`, `valueRange`, `threshold`) by delegating to the Vue reactive `params` object passed at construction.

The existing `src/layers/snow-season.js`, `winter-temp.js`, `melt-risk.js`, and `slope.js` use the **old canvas-based MapLibre image source pattern** and must be **discarded and rewritten** as proper `RasterLayer` subclasses as defined here.

---

## Base class contract (recap)

Each subclass extends `RasterLayer` from `core/layer.js`. The base class provides:
- `update(viewport, signal)` — calls `source.get()`, uploads chunks to renderer
- `generateMesh(chunk, targetCRS)` — adaptive N×N mesh generation

The subclass must implement four getters:
```javascript
get layerType()   // → 'soft-filter' | 'hard-filter'
get hue()         // → number (degrees 0–360, soft filter only)
get valueRange()  // → { from: number, to: number } (soft filter only)
get threshold()   // → number (hard filter only)
```

All getters read from `this.params` — the reactive object passed to the constructor. This means the renderer picks up UI changes (slider moves, period changes) on the next frame without re-uploading data.

---

## SnowSeasonLayer (`src/layers/snow-season.js`)

### Purpose

Soft filter. Displays the Nth-percentile snow season length (days) across years. Longer seasons are more favourable. Hue: blue (200°).

### Source

`SnowSeasonSource` — yields Chunks where each cell is the Nth-percentile season length in days (Uint8).

### Class definition

```javascript
export class SnowSeasonLayer extends RasterLayer {
  get layerType()  { return 'soft-filter' }
  get hue()        { return 200 }  // blue — fixed, not reactive
  get valueRange() { return this.params.valueRange }  // reactive { from: 0, to: 180 }
  get threshold()  { return 0 }    // unused for soft filter
}
```

### Default params

```javascript
{
  enabled:    true,
  state:      'normal',
  valueRange: { from: 0, to: 180 },  // 0 days = transparent, 180 days = fully saturated blue
}
```

### Notes

- `valueRange.from = 0`: cells with zero snow season days are fully transparent — they have no coverage, not "bad".
- `valueRange.to = 180`: corresponds to ~6 months of continuous snow, the upper bound for practical purposes. Cells above 180 days are clamped to full opacity.
- The source (`SnowSeasonSource`) performs all aggregation (season length computation, percentile selection). The layer receives ready-to-render Uint8 Chunks.

---

## WinterTempLayer (`src/layers/winter-temp.js`)

### Purpose

Soft filter. Displays mean winter temperature (°C) averaged over all years and the winter period. Warmer is worse (higher temperature = less favourable). Hue: orange (30°).

### Source

`NgcdTempMeanSource` — yields Chunks where each cell is the mean temperature in °C over the configured winter period × time period (float32, scaled to a normalised 0–1 range for rendering is handled via `valueRange`).

### Class definition

```javascript
export class WinterTempLayer extends RasterLayer {
  get layerType()  { return 'soft-filter' }
  get hue()        { return 30 }   // orange — warmer areas stand out
  get valueRange() { return this.params.valueRange }  // reactive { from: 0, to: -20 }
  get threshold()  { return 0 }
}
```

### Default params

```javascript
{
  enabled:    true,
  state:      'normal',
  valueRange: { from: 0, to: -20 },  // 0°C = transparent (bad), -20°C = fully saturated (good)
}
```

### Notes

- The value range is inverted: colder is better. `from: 0` (warmer, transparent) to `to: -20` (cold, fully opaque orange).
- The shader's `normalized = clamp((value - valueMin) / (valueMax - valueMin), 0, 1)` naturally handles inverted ranges: `valueMin = 0`, `valueMax = -20` → a value of `−10°C` normalises to `0.5`.
- The source yields float32 temperature values in °C. No pre-scaling by the source — the layer's `valueRange` handles the display mapping.

---

## MeltRiskLayer (`src/layers/melt-risk.js`)

### Purpose

Soft filter. Displays the Nth-percentile count of melt-risk days (days where daily max temp > 0°C) during the winter period. Fewer melt days is better. Hue: red (0°).

### Source

`MeltRiskSource` — yields Chunks where each cell is the Nth-percentile melt day count (Uint8, max 120 days).

### Class definition

```javascript
export class MeltRiskLayer extends RasterLayer {
  get layerType()  { return 'soft-filter' }
  get hue()        { return 0 }   // red — high melt risk stands out
  get valueRange() { return this.params.valueRange }  // reactive { from: 0, to: 30 }
  get threshold()  { return 0 }
}
```

### Default params

```javascript
{
  enabled:    true,
  state:      'normal',
  valueRange: { from: 0, to: 30 },  // 0 melt days = transparent (good), 30 = fully saturated red (bad)
}
```

### Notes

- The range is NOT inverted: higher melt day counts are worse (more visible red overlay). `from: 0` maps to transparent; `to: 30` maps to full opacity.
- Cells with 0 melt days are fully transparent — these are the desirable cells.
- 30 days is approximately one month; areas above 30 melt days are clamped to full opacity.

---

## SlopeLayer (`src/layers/slope.js`)

### Purpose

Hard filter. Cells where terrain slope exceeds the threshold are grayed out (semi-transparent grey overlay). Cells that pass are transparent.

### Source

`SlopeSource` — yields Chunks where each cell is a computed slope value in degrees (float32). Slope values are already at the configured kernel distance (D) and window radius (R).

### Class definition

```javascript
export class SlopeLayer extends RasterLayer {
  get layerType()  { return 'hard-filter' }
  get hue()        { return 0 }   // unused for hard filter
  get valueRange() { return { from: 0, to: 1 } }  // unused
  get threshold()  { return this.params.slopeThreshold }  // reactive, default 15°
}
```

### Default params

```javascript
{
  enabled:        true,
  state:          'normal',
  slopeThreshold: 15,   // degrees — cells above this are grayed out
}
```

### Notes

- Only active at zoom ≥ 10. At lower zoom levels, `LayerFactory` should not register this layer with the renderer (or the layer's `update()` should be a no-op based on zoom). This zoom restriction is enforced in `LayerFactory` or the layer's `update()` method by checking `viewport.zoom`.
- The `SlopeSource` must be configured with the appropriate kernel distance and window radius at construction time — these are structural params, not per-call.

---

## Test cases

### SnowSeasonLayer

**1. layerType returns 'soft-filter'**
Construct `SnowSeasonLayer` with minimal params. Verify `layer.layerType === 'soft-filter'`.

**2. hue returns 200**
Verify `layer.hue === 200`.

**3. valueRange reads from params reactively**
Construct with `params.valueRange = { from: 0, to: 180 }`. Verify `layer.valueRange` returns `{ from: 0, to: 180 }`. Mutate `params.valueRange = { from: 10, to: 200 }`. Verify `layer.valueRange` returns the new value.

**4. update() uploads chunks to renderer**
Construct with a mock source that yields a single Chunk (Uint8 grid, 16×16 cells). Call `update()`. Verify `renderer.upload()` called with the Chunk's grid and mesh vertices.

### WinterTempLayer

**5. layerType returns 'soft-filter'**
Construct `WinterTempLayer`. Verify `layer.layerType === 'soft-filter'`.

**6. hue returns 30**
Verify `layer.hue === 30`.

**7. inverted valueRange handled correctly**
Construct with `params.valueRange = { from: 0, to: -20 }`. Verify `layer.valueRange` returns `{ from: 0, to: -20 }`. The shader (tested separately) handles inverted ranges via clamp.

### MeltRiskLayer

**8. layerType returns 'soft-filter'**
Verify `layer.layerType === 'soft-filter'`.

**9. hue returns 0**
Verify `layer.hue === 0`.

**10. valueRange reads from params**
Verify `layer.valueRange` returns the params object's valueRange.

### SlopeLayer

**11. layerType returns 'hard-filter'**
Construct `SlopeLayer`. Verify `layer.layerType === 'hard-filter'`.

**12. threshold reads from params reactively**
Construct with `params.slopeThreshold = 15`. Verify `layer.threshold === 15`. Mutate `params.slopeThreshold = 20`. Verify `layer.threshold === 20`.

**13. update() no-op below zoom 10**
Construct with viewport at zoom 9. Call `update()`. Verify `renderer.upload()` is NOT called.

**14. update() runs at zoom 10**
Construct with viewport at zoom 10. Mock source yields 1 Chunk. Call `update()`. Verify `renderer.upload()` IS called.
