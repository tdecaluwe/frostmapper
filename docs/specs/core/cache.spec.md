# Spec: `core/cache.js`

## Purpose

Provides the base class `Source` that all data sources extend. Owns cache reads and writes (both in-memory and IndexedDB), chunk boundary math, bounding box to TileId mapping, and cache key construction. Subclasses only implement `compute()`.

Sources are purely data concerns — they serve data at any stride for any bounding box. Viewport logic, priority ordering, and queue management live in Layers and subclasses respectively.

---

## Base class interface

```javascript
class Source {
  constructor(options)
  async *get(extent, resolution, signal)           // public — called by Layers/composite Sources
  async compute(tileId, signal)                    // override in subclass, returns Grid
  async #getCached(tileId)                         // private — returns Chunk | null
  async #setCached(tileId, chunk)                  // private — writes to both cache tiers
}
```

---

## Constructor options

```javascript
{
  id:        string,        // unique source identifier e.g. 'seNorge-snow-t10-2020'
  transform: GridTransform, // describes the source's chunk grid — origin, chunkSize, baseResolution, nativeCRS
  dtype:     string,        // TypedArray dtype: 'float32' | 'uint8' | 'uint16'
  persist:   boolean,       // whether to write to IndexedDB (default false)
}
```

Subclass constructors extend these options with their own concerns (queue, etc.). The base class does not need to know about queues.

The Source uses `transform` and `dtype` to reconstruct Chunks from cached ArrayBuffers via `#getCached` — no serialisation header needed because all metadata is on the `GridTransform`.

---

## `get(extent, resolution, signal)`

The primary public method. Called by Layers or composite Sources to request data for a geographic area at a given resolution. Returns an async generator that yields Chunks as they become available.

### Parameters
- `extent` — `Extent` instance in any CRS. The Source calls `extent.cover(nativeCRS)` internally.
- `resolution` — requested resolution in meters per cell. Source translates to native CRS and selects appropriate power-of-2 stride internally.
- `signal` — `AbortSignal`. If aborted, the generator stops yielding.

### Note on params
Source-specific configuration (e.g. year, threshold) is baked into the Source instance at construction time — not passed per call. This ensures cache keys are stable and time period extensions only fetch missing years rather than invalidating existing cache entries.

### Returns
`AsyncGenerator<Chunk>` — yields Chunks in source native CRS as they become available.

### Algorithm

1. Call `extent.cover(this.transform.nativeCRS)` to get a covering Extent in the source's native CRS
2. Translate resolution: `nativeResolution = extent.translateResolution(resolution, this.transform.nativeCRS)`
3. Select stride: `stride = nearestPowerOf2AboveOrEqual(nativeResolution / this.transform.baseResolution)`
4. Map covered extent to intersecting chunk coordinates using `transform`:
   ```javascript
   minChunkX = Math.floor((nativeExtent.west  - transform.originX) / transform.chunkSize)
   maxChunkX = Math.floor((nativeExtent.east  - transform.originX) / transform.chunkSize)
   minChunkY = Math.floor((nativeExtent.south - transform.originY) / transform.chunkSize)
   maxChunkY = Math.floor((nativeExtent.north - transform.originY) / transform.chunkSize)
   ```
5. For each `(chunkX, chunkY)` in the intersecting range:
   a. Construct `const tileId = new TileId({ chunkX, chunkY, stride, transform: this.transform })`
   b. Try cache: `const cached = await this.#getCached(tileId)`
   c. If hit: yield cached Chunk immediately, continue
   d. If miss: check `pendingComputes` for `this.id + ':' + tileId.toString()` — await existing or call `this.compute(tileId, signal)`
   e. On success: construct `new Chunk({ tileId, grid })`, call `this.#setCached(tileId, chunk)`, yield Chunk
6. Cache hits yield immediately, misses yield as they complete

---

## `compute(tileId, signal)`

**Must be overridden by subclasses. Base class implementation throws `NotImplementedError`.**

### Parameters
- `tileId` — `TileId` instance — identifies the chunk to compute. Subclass uses `tileId.extent` for the geographic bounds and `tileId.cellsPerSide` for expected Grid dimensions.
- `signal` — `AbortSignal`

### Returns
`Promise<Grid>` — typed 2D raster data with dimensions `tileId.cellsPerSide × tileId.cellsPerSide`. Base class wraps into a `Chunk` before yielding and caching.

---

## Cache key

```
'{sourceId}:{tileId.toString()}'
// e.g. 'seNorge-snow-t10-2020:4,12:1'
```

The full cache key is always constructed as `this.id + ':' + tileId.toString()`. `TileId.toString()` returns `'{chunkX},{chunkY}:{stride}'`. No separate `makeKey()` method — key construction is inlined wherever needed.

---

## `#getCached(tileId)` → `Chunk | null`

Private base class method. Checks both cache tiers and returns a reconstructed Chunk if found, null if not.

1. Construct key: `this.id + ':' + tileId.toString()`
2. Check in-memory cache → if hit, reconstruct Chunk, update LRU timestamp, return Chunk
3. Check IndexedDB (if `persist: true`) → if hit, populate in-memory cache, reconstruct Chunk, return Chunk
4. Return null on miss

**Chunk reconstruction** from ArrayBuffer:
```javascript
const TypedArrayClass = { float32: Float32Array, uint8: Uint8Array, uint16: Uint16Array }[this.dtype]
const cells = tileId.cellsPerSide
const grid = new Grid({ data: new TypedArrayClass(buffer), width: cells, height: cells, dtype: this.dtype })
return new Chunk({ tileId, grid })
```

---

## `#setCached(tileId, chunk)` → `void`

Private base class method. Writes a Chunk to both cache tiers.

1. Construct key: `this.id + ':' + tileId.toString()`
2. Convert to ArrayBuffer: `chunk.grid.data.buffer`
3. Write to in-memory cache
4. Write to IndexedDB (if `persist: true`)

---

## Concurrent request deduplication

The base class maintains a module-level `Map<string, Promise<Grid>>` of in-flight `compute()` calls:

```javascript
const pendingComputes = new Map()  // key → Promise<Grid>
```

In `get()`, before calling `compute()`:
1. Check `pendingComputes` for the key — if found, await the existing promise without calling `compute()` again
2. If not found: create the promise, store in `pendingComputes`, await it
3. On resolution (success or error): remove from `pendingComputes`

This ensures concurrent `get()` calls for the same chunk never trigger duplicate `compute()` calls.

---

## Subclass queue usage

The base `Source` class does not know about queues. Remote-fetch Source subclasses own their queue and use it inside `compute()`:

```javascript
class SeNorgeSnowSource extends Source {
  constructor(options) {
    super(options)
    this.queue = options.queue  // Queue instance from core/queues.js
  }

  async compute(tileId, signal) {
    return this.queue.enqueue(
      async (signal) => this.#fetchAndParse(tileId.extent, tileId.cellsPerSide, signal),
      0,        // priority 0 = highest, acceptable for Phase 1
      this.id + ':' + tileId.toString()  // deduplication key
    )
  }
}
```

---

## `reconfigure({ years })` (derived Sources only)

Derived Sources that manage child Sources must implement `reconfigure()` to handle `appState.timePeriod` changes. This is not part of the base `Source` class:

```javascript
reconfigure({ years }) {
  const current = new Set(this.childSources.map(s => s.year))
  const target  = new Set(years)
  // Add new years
  for (const year of target) {
    if (!current.has(year)) {
      this.childSources.push(new SeNorgeSnowSource({ ...this.baseConfig, year }))
    }
  }
  // Remove years no longer needed — cache entries are retained (LRU handles eviction)
  this.childSources = this.childSources.filter(s => target.has(s.year))
}
```

---

## Chunk grid

The chunk grid geometry is fully described by `GridTransform` and `TileId` in `core/primitives.js`. The Source base class uses `transform` directly for chunk coordinate math — see the `get()` algorithm above and the `GridTransform`/`TileId` specs in primitives.spec.md.

---

## In-memory cache

A module-level `Map<string, ArrayBuffer>` shared across all Source instances. Never evicted during a session. Cleared on page refresh. Stores raw ArrayBuffers — the Source reconstructs Chunks from them via `#getCached` using `TileId` for dimensions and extent.

```javascript
const memoryCache = new Map() // key → ArrayBuffer
```

---

## IndexedDB cache

Used only for Sources with `persist: true`.

### Database
- Name: `geo-scouting-cache`
- Version: 1
- Object store: `chunks`
  - Key: string (cache key)
  - Value: `{ key: string, data: ArrayBuffer, timestamp: number }`

### LRU eviction
When total stored size exceeds 200MB:
- Sort all entries by `timestamp` ascending
- Delete oldest entries until total size is under threshold
- Checked on every write

### Operations
```javascript
async function idbGet(key) → ArrayBuffer | null
async function idbSet(key, buffer) → void  // updates timestamp to Date.now()
```

### Note on size estimation
IndexedDB does not expose total storage size natively. Maintain a running size counter in memory, updated on every write. On app startup, reconstruct the counter by summing `data.byteLength` values from a cursor scan of the object store.

---

## Error handling
- IndexedDB read failure: log warning, treat as cache miss, continue
- IndexedDB write failure: log warning, continue (in-memory cache still works)
- `compute()` rejection with non-AbortError: propagate to caller's `get()` promise
- `compute()` rejection with `AbortError`: propagate to caller, do not write to cache

---

## Test cases

### 1. Single chunk — memory hit
Prime memory cache with key. Call `get()`. Verify `compute()` is never called. Verify yielded Chunk data matches cached value.

### 2. Single chunk — compute called on miss
Empty cache. Call `get()`. Verify `compute()` is called with a `TileId` whose `extent` matches the chunk grid position and whose `cellsPerSide` matches the expected stride. Verify result written to memory cache. Verify yielded Chunk data matches compute output.

### 3. Multi-chunk — correct chunk count
Request bounding box spanning 2×2 chunks. Verify generator yields exactly 4 Chunks. Verify each Chunk's `tileId` has correct `chunkX`/`chunkY` matching its chunk grid position.

### 4. IndexedDB persistence
Source with `persist: true`. Call `get()`. Verify result written to IndexedDB. Clear memory cache. Call `get()` again. Verify `compute()` not called — result served from IndexedDB.

### 5. persist: false — no IndexedDB write
Source with `persist: false`. Call `get()`. Verify IndexedDB is never written to. Verify result is still in memory cache.

### 6. Abort during compute
Call `get()`. Start iterating generator. Abort signal before `compute()` resolves. Verify generator stops yielding. Verify AbortError is thrown.

### 7. Stable cache key
Two `get()` calls for the same chunk on the same Source produce the same cache key (`this.id + ':' + tileId.toString()`). Two Sources with different `id` values produce different keys for the same chunk coordinates.

### 8. Chunk alignment expansion
Request bounding box not aligned to chunk boundaries. Verify all yielded Chunks have TileIds whose extents are aligned to chunk grid boundaries. Verify union of yielded Chunk extents fully covers the requested bounding box.

### 9. LRU eviction
Fill IndexedDB beyond 200MB threshold with old-timestamped entries. Write new entry. Verify oldest entries deleted and total size under threshold.

### 10. Stride selection from resolution
Source with `transform.baseResolution=1000m`. Request `resolution=3500m`. Verify stride=4 selected (nearest power-of-2 ≥ 3500/1000=3.5). Request `resolution=1000m`. Verify stride=1.

### 11. Cell dimensions at stride
Source with `transform.baseResolution=1000`, `transform.chunkSize=512_000`. Call `get()` at resolution=1000m (stride=1). Verify each yielded Chunk has `tileId.cellsPerSide === 512`. Call again at resolution=4000m (stride=4). Verify same TileId extent boundaries, `cellsPerSide === 128`.

### 12. Concurrent requests for same chunk
Call `get()` twice simultaneously for overlapping bounding boxes covering the same chunk. Verify `compute()` is called only once for the shared chunk. Verify both generators yield a Chunk with identical data.

### 13. Foreign CRS extent
Call `get()` with an Extent in EPSG:4326 (not the source's native CRS). Verify `cover(nativeCRS)` is called internally. Verify yielded Chunks have TileIds in the source's native CRS. Verify their extents cover the original WGS84 extent.

### 14. LRU timestamp update on cache hit
Write entry to IndexedDB. Read it via `get()` (cache hit). Verify the entry's timestamp is updated to now. Verify it is not evicted before older entries when LRU runs.
