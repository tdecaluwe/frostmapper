# Spec: `sources/snow-season.js` and `sources/melt-risk.js`

## Purpose

Derived `Source` subclasses that aggregate multiple per-year raw sources into a single Nth-percentile result per spatial chunk.

- `SnowSeasonSource` — consumes N × `SeNorgeSnowSource` instances (one per year × threshold), computes Nth-percentile season length
- `MeltRiskSource` — consumes N × `NgcdTempMaxSource` instances (one per year), computes Nth-percentile melt day count

Both old implementations are plain objects and must be **discarded and rewritten**.

---

## SnowSeasonSource

### Purpose

Derived source. Accepts a list of child `SeNorgeSnowSource` instances (one per year) and a `percentile` parameter. Returns a Grid where each cell = Nth-percentile season length across all years.

### Construction

```javascript
new SnowSeasonSource({
  id: 'snow-season-p25-t10',
  childSources: [/* SeNorgeSnowSource instances for years 2005–2024, threshold=10 */],
  percentile: 25,  // from appState
  transform,
  dtype: 'uint8',
  persist: true
})
```

The `id` encodes the percentile and threshold to keep cache keys stable.

### `compute(tileId, signal)` algorithm

```
1. For each childSource in this.childSources:
   a. Call childSource.get(tileId.extent, tileId.stride * transform.baseResolution, signal)
   b. Collect all yielded Chunks (should be exactly 1 per child for this tileId)
2. Gather the cell value for each year at each spatial cell
3. For each cell, sort the per-year values and pick the Nth percentile
4. Return Grid({ data: percentileGrid, dtype: 'uint8', width, height })
```

### Percentile formula

```javascript
const idx = Math.floor(percentile / 100 * (values.length - 1))
result[cell] = sortedValues[idx]
```

### Notes

- Uses `merge()` + `groupBy()` from `core/generators.js` to aggregate per-year chunks concurrently:
  ```javascript
  const merged = merge(...this.childSources.map(s => s.get(extent, resolution, signal)))
  for await (const group of groupBy(merged, chunkKey, this.childSources.length)) {
    yield this.#aggregate(group)
  }
  ```
- The source does NOT override `compute()` directly — it overrides `get()` entirely, bypassing the base class cache mechanism. The base class cache is used by child sources; this derived source caches its own result separately.

**Actually** — to keep the cache model clean, `SnowSeasonSource` DOES use the base class `compute(tileId, signal)` pattern. The `compute()` method awaits all child sources for the given `tileId` and returns the aggregated Grid. The base class handles caching the result.

### Source ID encoding

The source ID must encode all parameters that affect the output:
- `snow-season-t{threshold}-p{percentile}-y{startYear}-{endYear}`

---

## MeltRiskSource

### Purpose

Derived source. Consumes N × `NgcdTempMaxSource` instances. Returns Nth-percentile melt day count.

### Construction

```javascript
new MeltRiskSource({
  id: 'melt-risk-p25',
  childSources: [/* NgcdTempMaxSource instances for years 2005–2024 */],
  percentile: 25,
  transform,
  dtype: 'uint8',
  persist: true
})
```

### `compute(tileId, signal)` algorithm

Identical to `SnowSeasonSource` but uses `NgcdTempMaxSource` children:
```
1. Collect Chunks from all child NgcdTempMaxSource instances for this tileId
2. For each cell, sort melt-day counts and pick Nth percentile
3. Return Grid({ data: percentileGrid, dtype: 'uint8' })
```

---

## Test cases

### SnowSeasonSource

**1. percentile computation — p25 of [10, 20, 30, 40] = 17**
Four child sources yield Grids with single cells: values 10, 20, 30, 40.
Compute p25. Expected: `Math.floor(0.25 * 3) = 0` → index 0 of sorted [10, 20, 30, 40] = 10.

Actually: `idx = Math.floor(25/100 * (4-1)) = Math.floor(0.75) = 0` → sorted[0] = 10.

Verify `compute()` returns Grid with cell value 10.

**2. percentile computation — p50 of [10, 20, 30, 40] = 20**
`idx = Math.floor(0.5 * 3) = 1` → sorted[1] = 20. Verify.

**3. abort propagates to child sources**
One child source awaits a slow fetch. Abort the signal mid-computation. Verify the child source's fetch is cancelled (mock fetch tracks abort).

**4. dtype is uint8**
Verify returned Grid has `dtype === 'uint8'`.

**5. child source with 0 season length contributes to percentile**
Mix of child sources with 0 and non-zero season lengths. Verify 0 values are included in the percentile computation (not ignored).

### MeltRiskSource

**6. percentile computation — p25 of melt day counts**
Four children yield values [0, 5, 10, 15]. p25 = 0. Verify Grid cell = 0.

**7. p75 of melt day counts**
Values [0, 5, 10, 15]. p75: `idx = Math.floor(0.75 * 3) = 2` → sorted[2] = 10. Verify.

**8. dtype is uint8**
Verify returned Grid has `dtype === 'uint8'`.

**9. single year — percentile is the value itself**
One child source yields a Grid with cell value 7. Any percentile returns 7. Verify.
