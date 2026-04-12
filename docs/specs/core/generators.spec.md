# Spec: `core/generators.js`

## Purpose

Generic async generator utility functions for composing Source generators. Used by composite Sources (e.g. `SnowSeasonSource`) to orchestrate multiple child Source generators into a single coherent stream.

All functions are pure — they have no side effects, no knowledge of Sources, Chunks, or the cache. They work with any async generator.

---

## Interface

```javascript
merge(...generators)                        // → AsyncGenerator
groupBy(generator, keyFn, expectedCount)    // → AsyncGenerator
```

---

## `merge(...generators)`

Consumes multiple async generators concurrently and yields their values in arrival order — first-come-first-served. Does not wait for all generators to produce a value before yielding.

### Parameters
- `...generators` — one or more `AsyncGenerator` instances

### Returns
`AsyncGenerator` — yields values from all input generators as they arrive. Completes when all input generators are exhausted.

### Behaviour
- All generators are advanced concurrently — a slow generator does not block values from faster generators
- Order of yielded values is determined by arrival time, not generator order
- If one generator throws, the error propagates and remaining generators are abandoned
- If zero generators are passed, yields nothing and completes immediately
- If one generator is passed, equivalent to iterating it directly

### Implementation note
Uses `Promise.race` over pending `next()` calls from all generators. When one resolves, yield its value and immediately advance that generator again. Continue until all generators are done.

---

## `groupBy(generator, keyFn, expectedCount)`

Consumes an async generator and groups values by a key function. Yields each complete group as an array once `expectedCount` values with the same key have arrived.

### Parameters
- `generator` — `AsyncGenerator` producing values to group
- `keyFn` — `(value) => string` — function that returns a group key for each value
- `expectedCount` — number of values expected per group. When a group reaches this count, it is yielded and removed from the accumulator.

### Returns
`AsyncGenerator<Array>` — yields arrays of `expectedCount` values sharing the same key, in the order groups complete.

### Behaviour
- Groups are accumulated in memory until complete
- A group is yielded immediately once its `expectedCount` is reached
- Groups complete in the order their final value arrives — not the order their first value arrived
- Values with the same key but different arrival times are accumulated correctly
- If the generator completes before all groups reach `expectedCount`, incomplete groups are silently discarded — the caller is responsible for ensuring the upstream generator produces complete groups
- If `expectedCount` is 1, equivalent to mapping values through `keyFn` grouping — each value yields immediately as a single-element array
- Groups are plain arrays — values are appended in arrival order. There is no position concept within a group.

### Example usage in SnowSeasonSource
```javascript
// childSources: 20 SeNorgeSnowSource instances, one per year
// each yields one Chunk per spatial extent

const merged = merge(...childSources.map(s => s.get(extent, resolution, signal)))
const chunkKey = chunk => `${chunk.extent.west},${chunk.extent.south}`

for await (const yearlyChunks of groupBy(merged, chunkKey, childSources.length)) {
  // yearlyChunks: array of 20 Chunks covering the same spatial extent, one per year
  const grid = computeSeasonLengths(yearlyChunks, threshold)
  yield new Chunk({ extent: yearlyChunks[0].extent, grid })
}
```

---

## Error handling

### `merge`
- If any generator throws: the error propagates immediately from `merge`. Remaining in-progress generators are not explicitly cancelled — the caller is responsible for passing AbortSignals to child generators to stop them.
- Generators that have not yet produced a value when an error occurs are abandoned.

### `groupBy`
- If the upstream generator throws: the error propagates immediately from `groupBy`. Accumulated incomplete groups are discarded.
- Incomplete groups at exhaustion are silently discarded — not an error.

---

## Test cases

### merge

**1. Single generator passthrough**
`merge(gen([1, 2, 3]))` yields 1, 2, 3 in order.

**2. Two generators — all values yielded**
`merge(gen([1, 2]), gen([3, 4]))` yields all four values {1, 2, 3, 4} in some order. Verify no values are lost.

**3. Concurrency — faster generator yields first**
Create two generators where gen1 resolves after 10ms and gen2 resolves after 1ms. Verify gen2's value is yielded before gen1's value.

**4. Empty generator**
`merge(gen([]))` yields nothing and completes immediately.

**5. Zero generators**
`merge()` yields nothing and completes immediately.

**6. One generator throws**
`merge(gen([1, 2]), throwingGen())` — when the throwing generator throws, verify the error propagates from merge.

**7. Uneven generators**
`merge(gen([1, 2, 3]), gen([4]))` yields all 4 values. Verify merge completes only after both generators are exhausted.

### groupBy

**8. Basic grouping**
Generator yields `[{key:'a', v:1}, {key:'b', v:2}, {key:'a', v:3}]`. `keyFn = x => x.key`, `expectedCount=2`. Verify yields `[{key:'a',v:1}, {key:'a',v:3}]` once complete. Verify `{key:'b',v:2}` is discarded (incomplete group).

**9. Multiple complete groups**
Generator yields 4 values: 2 with key='a', 2 with key='b'. `expectedCount=2`. Verify both groups are yielded. Verify each group contains exactly 2 values with the correct key.

**10. expectedCount=1**
Every value is its own complete group. Verify each value is yielded immediately as a single-element array.

**11. Interleaved arrivals**
Generator yields a, b, a, b (alternating keys). `expectedCount=2`. Verify both groups complete correctly despite interleaved arrival order.

**12. Incomplete group at exhaustion**
Generator yields 3 values: 2 with key='a' (complete), 1 with key='b' (incomplete). `expectedCount=2`. Verify only the key='a' group is yielded. Verify no error is thrown for the incomplete key='b' group.

**13. Upstream generator throws**
Generator yields one value then throws. Verify error propagates from `groupBy`. Verify no partial groups are yielded after the error.

**14. Integration with merge**
`groupBy(merge(gen1, gen2), keyFn, 2)` where gen1 and gen2 each yield one Chunk per spatial extent. Verify all spatial extents produce complete groups of 2.
