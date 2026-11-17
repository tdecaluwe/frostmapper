Current visibility-driven design and API: [visibility-contours.md](visibility-contours.md). Earlier benchmark sections below retain historical configurations.

# Progressive logarithmic contour ladder

This implementation uses Frostmapper commit `426797765aec0ad4255ed6acdede2067e99b55bf` as its base. It adds a bounded, projection-agnostic contour engine, an optional projection-pair adapter, a different mesh-free correction candidate, a periodic index fix, and executable comparisons with the original builder.

The running map's worker has not been switched to the new engine. The numerical benchmark and actual band-mask planner have been tested; browser rendering and worker integration have not. The optional adapter retains the existing version-3 atlas schema.

## Definition and use

In source coordinates, the scalar field is

`q(s) = -0.5 * log2(abs(det(D(target <- source)(s))))`.

This is the repository's area-derived linear scale, rather than a directional maximum stretch. A contour has `q = step / steps`. Consequently `steps=1` doubles linear scale per contour; `steps=4` uses four intervals per doubling. The caller can provide another scalar scale metric without changing the contour engine.

```js
import {BoundedContourAtlas} from './src/map/reprojection/bounded-contours.js'

const builder = new BoundedContourAtlas({
  sample: scaleAtSourceCoordinate, // finite number; NaN/null outside the domain
  extent: sourceExtent,
  periodicX: sourceWrapsHorizontally,
  steps: 4,
  tolerance: 0.025,             // log2 zoom steps
  highestZoom: 20,                // caps the requested ladder to [-20, 20]
})
try {
  for (let result; (result = builder.next()); ) {
    publish(result.atlas, result.stage)
    // Yield to the worker event loop before calling next() again.
  }
} finally {
  builder.dispose()
}
```

`next()` constructs a complete global atlas before returning. Previous publications are independent objects and remain usable during refinement. Numeric refinement buffers and the sample callback are released immediately when the final pass completes. `dispose()` also releases them when a consumer cancels.

`BoundedProjectionContourAtlas` in `bounded-contour-atlas-builder.js` supplies the repository's constructor / `refineBlock()` interface. Use its `scaleSample` option for an analytic or differentiated scale field. Its fallback is the original `DistortionField`; contouring cannot correct numerical defects already present in that field. The exported generator disposes state in `finally`, including when its consumer stops early.

## Algorithm

1. Sample a nine-point stencil on a packed quadtree. Start with a small global discovery floor, then increase the floor and reduce the scalar interpolation tolerance on each pass. Tolerances scale with `1/steps`. Keep the tree between passes; keep only a bounded, direct-mapped cache of field values.
2. Search bracketed interior extrema with constrained pattern descent. Search shared edges of depth-limited cells with golden-section minimization and maximization. Insert successful extrema as shared mesh vertices. This recovers small closed loops that ordinary marching squares can miss between grid samples. No geographic seed coordinates are supplied.
3. Obtain neighboring leaf boundaries by tree lookup. Both sides of every edge, including a periodic seam, use the same partition and extremum seeds. Triangulate each leaf with a center fan. This removes T junctions without a globally uniform finest grid or retained edge maps.
4. Build one contour level's graph at a time, pruning tree nodes by their sampled ranges. Recompute those ranges after neighboring subdivisions and extremum insertion: an exposed edge extremum may lie outside the original coarse stencil's range. Solve shared edge roots with a canonical guarded secant/bisection bracket. Shared root keys give degree-two loops or degree-one domain endpoints.
5. Where a triangle crosses an invalid domain, bisect the valid/invalid edges and clip it. Domain endpoints are approximate edge intersections, rather than abandoned interior fragments. This assumes a sufficiently resolved, ordinary domain boundary.
6. Trace entire components in an unwrapped periodic chart. Fit cubics with shared Hermite derivatives, including the closing tangent. Sample cubic interiors; where needed, insert a point corrected toward the implicit level by trust-limited normal Newton iterations, then refit. Orient an entire component coherently with high values on the left. Reversing individual cubic segments would destroy connectedness.
7. Publish the whole atlas. Return to step 1 for the next global pass.

Periodicity is a generic topology parameter, not a projection-specific region. Winding loops may end one world width from their start in the unwrapped chart; they are closed on the cylinder. The modified `ContourAtlasIndex` indexes canonical translated copies and translates queries for arbitrary positive or negative world offsets, without duplicating a seam segment.

## Memory model and limits

Default fixed typed-array workspace: **3,244,032 bytes**. It contains 87,381 tree-node slots, 65,536 cached samples, one level's 16,384-vertex graph and hash table, and tracing indices. There are at most 512 extremum seeds and 2,048 points in one fitted path. The implementation throws `ContourBudgetError` rather than silently exceeding a capacity or publishing a partially built graph. An earlier published atlas remains valid after such a failure.

The measured post-GC retained intermediate state on the Grieger benchmark was **3,785,296 bytes** after the coarse pass and **3,815,168 bytes** after the medium pass, including JavaScript heap growth over the baseline and excluding the atlas output. After completion, retained numeric buffer storage was **zero**. The residual heap delta also includes JIT/runtime bookkeeping.

This is a bound on algorithm-owned intermediate structures, not a 4 MB limit on process RSS, transient GC garbage, output curves, renderer indices, or copies retained by subscribers. The final four-step atlas is about 4.6 MB as uncompressed JSON. Consumers retaining every global publication must account for those output objects themselves. Measured memory is runtime-dependent; raw numeric capacities are exact. Custom capacities can exceed the default memory target.

## Benchmark and retained candidates

All candidates use the same scale oracle and source-coordinate extent. The oracle differentiates Frostmapper's actual Grieger / oblique Peirce equations. It uses algebraically stable Cartesian rotation, angular-distance, and rationalized half-angle expressions. It contains no geographic masks or hard-coded extremum seeds. Projection-specific mathematics belongs to this benchmark adapter, not to the contour algorithm.

A fixed 100 m finite difference is unreliable near projection cuts and singularities. The comparison records disagreement with an independent 25 m finite difference, but that disagreement is not treated as ground-truth contour error in those regions. The original trigonometric equations are additionally evaluated and differentiated independently at 60 decimal digits in `grieger-reference.py`.

The full comparison, individual pass results, topology checks, and negative results are recorded in `contour-ladder-results/`. Tolerance is configurable in log₂ zoom steps; stage multipliers are 12, 4, and 1, with the final spatial interpolation tolerance matching the requested value. Timings are single runs in this environment, not statistically established speed claims. Auditing and serialization are excluded from individual pass timings; total elapsed times include auditing.

Retained approaches:

- **Bounded adaptive mesh + extremum search + Newton curve correction**: the preferred completeness/accuracy candidate. For `steps=4`, all three publications contain 346 paths: 344 closed and two terminating at the rectangular source domain boundary. Final maximum sampled error is about 0.119 contour step; there are no measured broken joins, tangent discontinuities, dangling interior ends, or invalid curve probes. Final numeric workspace is released.
- **Fixed uniform mesh + edge root solving + curve correction**: faster, simpler, and capable of a much smaller workspace. The 128-by-128 final mesh yields only 218 paths, so it is retained for the speed/memory tradeoff, not for dependable extremum discovery. The slim configuration uses 21,845 nodes, a 32,768-entry sample cache, and a 2,048-vertex graph: **929,792 bytes** of numeric workspace, with a final pass around 1.73 s in its separate run.
- **Mesh-free Newton continuation**: `refineContourAtlas()` corrects existing knots and cubic interiors using an existing atlas as its only discovery seed. A correction pass took about 107 ms for `steps=4`, or 41 ms for `steps=1`, excluding seed generation. It retains only the seed's components: 198 and 50 paths respectively. It is useful for refining trusted cached topology, and cannot discover a missing loop.

Rejected / control approaches:

- **Linear edge interpolation without root solving**: even with fine adaptive subdivision and curve correction, the retained knots are misplaced near singularities. The final measured worst error was about 36.5 steps. It also made correction slower. Root solving matters more than simply increasing the mesh density.
- **Original repository builder**: its first pass used 4,260,096 bytes of raw sample blocks before accounting for the JavaScript maps, leaves, segment graph, or fitting scratch. It took roughly 0.34–0.60 s in observed runs. That first publication had 40 measured interior dangling ends, 102 disconnected joins, and about 67.3 steps worst sampled error over the full requested ladder. Refinement exceeded the benchmark guard of 8 MB raw sample blocks or two million oracle evaluations per pass. **No completed original final atlas was measured**, so these numbers must not be described as a final-versus-final speed/accuracy comparison. The original code remains available unmodified for reproducing this comparison.

With requested tolerance `0.025`, `steps=1` has 88 paths and approximately 0.070 maximum final sampled error. At `steps=8`, it has 690 paths and approximately 0.210 maximum final sampled error. All passes in those runs have zero measured dangling interior ends or disconnected joins.

Tolerance sweep at `steps=4`: requested `0.025` completed in about 20.6 seconds and measured 0.208 maximum error (zero samples above half a step); requested `0.01` completed in about 29.9 seconds but measured 1.25 steps maximum near singular contours (14 samples above half a step). This is an important limit: reducing the cell interpolation tolerance does not guarantee a corresponding geometric residual near degenerate contours. The default is therefore `0.025`; `0.01` remains configurable for applications that value extra subdivision, but it does not meet the half-step benchmark bound with this curve correction. Improving critical-point handling or using an implicit representation is required before recommending `0.01`.

## Validation and its limits

- Eight synthetic test groups cover affine fields, interior maxima and minima, two smooth off-grid extrema, C1 joins including loop closure, invalid-domain clipping, periodic winding, immutable publications, capacity failure, disposal, configuration, zoom capping and translated periodic queries.
- A dense `steps=4` final audit samples 119,688 cubic-interior points at parameters different from those used for Newton correction. None exceed half a contour step.
- An independent 60-digit reference checks 80 selected points spanning deep singular loops and ordinary contours. Worst error: about **0.120 step**; none exceed half a step.
- The actual `BandMaskPlanner` is tested at three difficult locations and zooms 6, 10, 16, and 20: twelve probes, thousands of pixels, zero band disagreements outside a 0.2-step boundary margin. No render-time corrective sampling is supplied in these tests.
- Retained intermediate memory and final buffer release are checked with `node --expose-gc`.

These are measured results and strong regression coverage, not an arbitrary-smooth-function completeness proof. A finite sampler can miss an arbitrarily narrow smooth bump, disconnected valid island, or unresolved domain feature. Local optimization additionally assumes its bracket does not hide multiple unresolved extrema. All returned atlases explicitly carry `quality.certified=false`. A mathematical discovery guarantee would require extra information such as a minimum feature width and domain reach, certified derivative/range bounds, or an interval-valued oracle, plus a resolution budget sufficient to resolve them. The stable path counts across passes are evidence for this benchmark, not a proof for every projection.

A small field residual is also not a universal pixel-distance bound where the gradient is near zero. Pixel-level band tests complement the scalar residual checks. Performance optimality has not been proved. Multi-level root reuse, a cheaper differentiated field, anisotropic trees and stronger analytic bounds are plausible future improvements, with additional complexity or storage tradeoffs.

## Reproduce

From the repository root, with Node 24 (no npm packages needed):

```sh
node tests/bounded-contours-node.mjs
CANDIDATES=bounded,linear,uniform,continuation,original RESULT_DIR=work/results node tests/contour-candidates-node.mjs
node tests/bounded-mask-node.mjs work/results/bounded-4.json
node --expose-gc tests/bounded-memory-node.mjs
STEPS=1 CANDIDATES=bounded RESULT_DIR=work/results1 node tests/contour-candidates-node.mjs
STEPS=8 CANDIDATES=bounded RESULT_DIR=work/results8 node tests/contour-candidates-node.mjs
```

For the high-precision reference (Python with `mpmath`):

```sh
python tests/grieger-reference.py work/results/bounded-4.json
```

The original builder is deliberately guarded during comparison to prevent an uncontrolled memory run. Its recorded error is an expected negative benchmark result, not a successful completed atlas. The benchmark command writes partial comparison results even if a candidate fails.

Base materials: https://github.com/tdecaluwe/frostmapper/tree/426797765aec0ad4255ed6acdede2067e99b55bf. The differentiated benchmark follows the PROJ equations already ported by Frostmapper; see `licenses/PROJ.txt`.

## Compact implicit-geometry candidate

`CompactContourAtlas` in `compact-contours.js` retains the shared conforming mesh for topology discovery, reduces mesh density and buffer capacities, and constructs cubic tangents from the field gradient. Damped normal Newton correction inserts points where curve residual is large. A correction is accepted when it improves residual, including where floating-point noise prevents meeting an unnecessarily tight knot tolerance. There are no geographic seeds or projection regions. The optional projection adapter now selects this candidate by default; `algorithm: 'bounded'` selects the previous implementation. The running map worker has not been switched.

At steps=4 and requested tolerance 0.01 log2, the fast configuration built all 346 paths in each of three global passes. Its measured pass times were 1.83 / 2.98 / 4.18 seconds (9.00 seconds computation), versus 3.90 / 5.65 / 12.17 seconds (21.72 seconds) for a fresh baseline run. Single-run times are indicative, not a controlled statistical speed comparison. Numeric workspace fell from 3,244,032 to 1,597,408 bytes. Post-GC live intermediates measured 2,161,936 bytes; all numeric buffers were released on completion. This is not process peak RSS or a transient-GC peak measurement.

Worst sampled final error was 0.00473 log2, versus 0.31232 log2 for the baseline. The independent 60-digit reference measured 0.00501 log2 on 80 selected samples. Curve count fell from 49,993 to 18,939. All eight synthetic test groups and twelve high-zoom band-mask probes passed. The final 99th percentile was worse than baseline: 0.00368 versus 0.00080 log2. This candidate therefore does not dominate every accuracy statistic. Topology, seam continuity, discovery and C1 joins tie the baseline at zero observed faults and equal path counts.

A tighter variant (`correctionSafety: 0.1`, allowing 4096 points per path) took 26.02 seconds. Its worst error was 0.00517 log2, 99th percentile 0.00084 log2, and 43,723 curves. At comparable compute cost its 99th percentile is similar to the old algorithm. It is retained for better worst-case error and lower workspace, not as a universal performance improvement. The fast variant (`correctionSafety: 1`, default) remains the recommended starting point. Neither variant certifies the residual everywhere or proves all extrema discovered for arbitrary smooth fields.

Additional fast runs at steps=1 and steps=8 retained respectively 88 and 690 paths, with zero observed topology faults. Steps=8 worst sampled final error was 0.00512 log2. Stronger memory and accuracy guarantees, and full browser integration, remain open.

Reproduce with `node tests/compact-contours-node.mjs`, `node tests/compact-candidates-node.mjs`, and `node --expose-gc tests/compact-memory-node.mjs`. Set `STEPS`, `TOLERANCE`, `CORRECTION_SAFETY`, and `RESULT_DIR` for other configurations. Use the existing mask and high-precision reference commands with the resulting atlas file.

## Output compression

`compressContourAtlas()` merges runs of adjacent Bézier segments by constrained least-squares fitting. It keeps endpoints and tangent directions, limits displacement from sampled input geometry, and samples the scale field at 31 interior positions before accepting a merge. It rejects merges whose rounded handles lose tangent alignment on tiny contours. Fitting scratch is bounded by `maxRun` (default 64 segments, 257 input samples). Output topology and winding are copied from the existing atlas: compression does not perform discovery. Sample checks are not a certified continuous error bound.

For the four-step fast atlas, output fell from 3,019,313 bytes and 18,939 cubics to **359,434 bytes and 2,154 cubics** (88.1% fewer bytes). All 346 paths, including 344 closed paths, two boundary paths and 28 winding seam loops, are retained. Worst error on an extra five probe positions per curve was **0.0051546371 log2**, identical for the compressed and uncompressed outputs. The original audit's 99th percentile changed from 0.00368 to 0.00400 log2. The independent 60-digit reference measured 0.0045571 log2 on its 80 selected points. All twelve high-zoom mask probes passed; no geometric tangent-direction breaks were detected.

Compression keeps G1 geometric smoothness. Bézier parameter speed may change at a join: equal uniform-parameter derivatives (C1 under that particular parameterization) are not preserved. The audit's legacy `tangentBreaks` field counts those speed changes and must not be read as visible corners. The compression test independently measures tangent direction, including closing joins, and reports zero breaks. Use `compress: false` to retain the original cubics and their uniform-parameter derivative equality.

Standalone compression measured about 0.79 seconds in a run without other benchmark processes. Compressing all three global publications measured 13.68 seconds total versus 10.51 seconds without compression in sequential runs; those single-run times include ordinary timing variability. The default is therefore `compress: 'final'`, preserving the early passes' work and compressing only the final publication. `compress: true` compresses every publication. Numeric workspace remains 1,597,408 bytes. A post-GC measurement with all-pass compression retained 2,246,112 bytes of live intermediate state; numeric buffers were released on completion. This does not bound transient process heap or output copies.

Run `node tests/compress-contours-node.mjs input-atlas.json output-directory` to compare geometry and output size, then use the existing band-mask and high-precision reference tests on `output-directory/atlas.json`. The integrated builder handles one level at a time to avoid keeping a second whole input atlas solely for compression.

## Bounded best-effort construction

The compact and bounded builders now terminate normally on resource exhaustion.
`complete` / `done` means construction has stopped, including a work limit; inspect
`stats.termination` and atlas `quality` to distinguish this from successful refinement.
An interrupted pass retains the previous immutable atlas. If no publication exists,
it returns only finished paths (or an empty atlas when mesh discovery failed).
A graph/topology failure omits that entire level. A component that cannot be fit,
validated, or oriented is omitted whole. Refinement can therefore add or remove whole
components; it never publishes an unfinished fragment.

Configuration separates effort from accuracy:

| Option | Default | Meaning |
| --- | ---: | --- |
| `tolerance` | 0.01 for compact | Target absolute log₂ field error, independent of `steps` |
| `maxSamplesPerPass` | 4,000,000 | Maximum scalar field calls during one global pass |
| `maxSamplesPerComponent` | 100,000 | Maximum scalar field calls while fitting, checking, and orienting one component |
| `maxExtremumSeeds` | 512 | Retained extrema seeds; saturation is reported as discovery limited |
| `maxLevels` | 4,096 | Maximum contour ladder size; larger configurations are rejected |
| `maxOutputCurves` | 65,536 | Output cubic cap per atlas and temporary level |
| `maxNodes`, `cacheSize`, `maxVertices`, `maxPathVertices` | engine dependent | Mesh, cache, graph and component storage caps |
| `passes` | coarse / medium / fine | Minimum and maximum spatial discovery depths and discovery thresholds |
| `finiteDifferenceStep` | 100 | Projection adapter stencil spacing in coordinate units |

Published components pass endpoint and 15 interior checks per cubic. Early passes
use relaxed acceptance targets (4× and 2× tolerance); the final pass uses tolerance.
The fitter rejects its entire component when it reaches its depth/segment limit
without meeting its checks. Projection exceptions become invalid field samples.
Unexpected programming errors still propagate. A synchronous projection evaluator
must itself return; field-call limits cannot interrupt a stalled external function.

`quality.sampledMaxError` measures published paths in log₂ units;
`quality.omittedComponents`, `quality.omittedLevels`, and `quality.discoveryLimited`
expose omissions. `stats.retainedPreviousAtlas` identifies a publication retained
when a later pass exhausted its budget. The retained atlas keeps its original
quality record. `stats` describes the attempted pass, and sample counts are cumulative.

These numerical checks are not a mathematical error certificate. They do not
bound error between probes or finite-difference bias, nor guarantee discovery of
arbitrarily small extrema. Increasing budgets permits more work but does not
promise monotonic accuracy or completeness near singularities. Intermediate typed
array storage is fixed by configuration, seeds and output are capped, and refinement
storage is released on termination. Output and JavaScript object overhead are
additional to `workspaceBytes`.

Web Mercator → Grieger, steps=4, tolerance=0.01, default limits: coarse 0.98 s,
medium 2.94 s, final attempt 8.17 s (sample limit, retained medium). Retained atlas:
98 paths, 314 cubics, no invalid audit samples or interior dangling endpoints.
Independent diagnostic reference maximum error was 0.00954 log₂ and 99th percentile
0.00694 log₂. Medium omitted 57 components, so small singular-region contours remain
unresolved. The diagnostic reference is used only for evaluation; construction uses
finite differences of projection calls.

At tolerance=0.02, the retained atlas had 100 paths and 299 cubics; coarse took 0.94 s, medium 2.59 s, and the final budget-limited attempt 7.20 s. Maximum audit error was 0.01372 log₂. Both tested tolerance settings had zero invalid audit samples and interior dangling endpoints. Post-GC retained intermediate memory was approximately 2.2 MB excluding atlas output; this is not peak transient allocation.

## Numerical coverage versus the derivative reference

The preferred numerical candidate now uses `finiteDifferenceScale` from
`src/map/reprojection/finite-difference-scale.js`. It needs only a coordinate
projection callback. It shrinks curved stencils, tries second-order one-sided
quadrants at folds/domain edges, and rejects quadrants whose mixed difference
crosses a crease. Each call uses at most 12 refinement rounds by default, with
bounded temporary storage. Its last finite estimate is best effort at unresolved
singularities; it is not a derivative accuracy certificate.

A cancellation in `horizontalForward` also needed correction: complementary
square roots are now rationalized instead of subtracting almost equal products.
This removes a narrow numerical plateau at a fold. Existing projection reference
and round-trip checks pass. The projection's polynomial and endpoint convention
are preserved.

The builder revalidates a previous complete contour level when a later pass
finds fewer components. It reuses that level only if its geometry meets the new
pass's sampled tolerance. This recovers coverage without publishing fragments,
duplicating components, or modifying earlier publications. `reusedLevels` counts
these replacements; omission counters count rejected attempts, not the final
number of missing reference paths.

Benchmark: Web Mercator → Grieger, steps=4, requested tolerance=0.01 log₂,
ladder −20…20, four million field calls allowed per pass. Errors below are
measured against the differentiated diagnostic adapter, which is never used by
the numerical constructor.

| Adapter | Final retained paths | First atlas | Total construction | Maximum sampled log₂ error | Finished fine pass |
| --- | ---: | ---: | ---: | ---: | --- |
| Previous fixed 100 m, extent clipped | 98 | 0.99 s | 11.10 s | 0.00954 | No, sample limit |
| Fixed 100 m, finite-only domain | 122 | 1.68 s | 16.34 s | 0.00954 | No, sample limit |
| Preferred adaptive + one-sided | 315 | 4.76 s | 29.50 s | 0.00933 | Yes |
| Differentiated diagnostic adapter | 346 | 1.44 s | 7.12 s | 0.00415 | Yes |

The finite-only fixed adapter is included to separate derivative improvements
from the old adapter's extent clipping. The adaptive and diagnostic adapters both
accept finite projection results; neither applies that old target extent mask.
Actual projection-domain validation remains the caller's responsibility. The
standard `DistortionField` adapter keeps its extent and round-trip checks.

All 315 adaptive paths match distinct reference paths by level, closure, position
and comparable size (periodic bounding-box matching). There are no unmatched
extra paths. All reference paths from scale −17.75 upward are recovered, including
all four at −7.5. The remaining 31 missing paths are below −17.75. Tiny components
still suffer finite projection precision; no complete-discovery guarantee is made.
The final atlas has 1,338 cubics, zero invalid audit samples, zero interior dangling
endpoints, and zero positional discontinuities. The audit's raw tangent-difference
counter compares handle lengths as well as directions; the separate contour
regressions check actual tangent alignment.

A starting stencil of 10 m retained 313 paths in 26.78 s, with maximum sampled
error 0.00817. A looser curvature threshold of 0.05 reduced work but lost more
final components (298 before previous-level recovery). The default candidate
keeps 100 m and a curvature threshold of 0.02 for coverage. These settings are
numerical controls rather than predictable accuracy guarantees.

Reproduce with `ADAPTER=analytical`, `ADAPTER=numerical`, `ADAPTER=fixed-raw`,
or `ADAPTER=adaptive` when running `node tests/contour-coverage-node.mjs`.
`FD_STEP`, `FD_CURVATURE`, `BUDGET`, and `RESULT_DIR` configure the numerical
experiment. Saved reports are in `docs/contour-ladder-results/coverage-*.json`.

For an application, `DistortionField(target,source,{adaptive:true})` enables the
new estimator, and `adaptiveFiniteDifferences:true` exposes it through
`BoundedProjectionContourAtlas`. Those adapters retain their existing domain
checks, so their coverage is not asserted to equal the finite-only benchmark.
A caller providing its own validated forward transform can instead supply the
numerical field directly:

```js
const scaleSample = point => {
  const value = finiteDifferenceScale(point, {
    sample: sourceToTarget, // forward projection evaluation only
    worldWidth: targetWorldWidth,
    step: 100
  })
  return value === null ? NaN : -value
}
```

## Tunable publications and faster previews

The default compact schedule is now `preset:'responsive'`: preview, coarse,
medium, fine. The preview keeps the requested ladder density. `preset:'fast'`
uses one contour level per doubling for the preview and fills in all requested
levels on subsequent passes. `preset:'balanced'` keeps the previous three-stage
schedule and its more detailed first publication.

Sequential first-publication benchmarks with the numerical adapter, steps=4 and
final tolerance=0.01:

| Preset | First publication | Whole paths | Scalar field calls | Measured max log₂ error |
| --- | ---: | ---: | ---: | ---: |
| balanced (previous schedule) | 4.71 s | 326 | 220,414 | 0.01880 |
| responsive (new default) | 2.26 s | 211 | 103,315 | 0.03352 |
| fast | 0.72 s | 54 | 26,787 | 0.03247 |

All three first publications had zero invalid audit samples and no interior
dangling endpoints. The responsive and fast full runs both reached the same
315-path / 1,338-cubic final atlas as the previous schedule, with maximum sampled
reference error 0.00933 log₂. Faster initial output trades early coverage and
accuracy for latency. It does not improve the final accuracy limit. Adding a
preview adds work: the responsive run used about 103,000 additional field calls;
fast added about 26,000. Full-run wall timings vary and are not evidence of a
reduction in total work.

```js
new CompactContourAtlas({sample, steps:4, tolerance:0.01, preset:'fast'})

// Override only preview settings; subsequent stages use their normal targets.
new CompactContourAtlas({
  sample, steps:4, tolerance:0.01,
  preview:{
    fitToleranceMultiplier:8,
    sampleBudget:150000,
    componentSampleBudget:5000,
    levelStride:1, // all requested quarter-log levels
    maxDepth:6
  }
})
```

A `passes` array replaces the preset completely. Each stage may specify:

| Setting | Meaning |
| --- | --- |
| `fitTolerance` | Absolute sampled fitting/acceptance target in log₂ units |
| `fitToleranceMultiplier` | Target relative to the constructor's `tolerance`; ignored when `fitTolerance` is present |
| `meshTolerance` | Absolute log₂ interpolation threshold for mesh discovery |
| `minimumDepth`, `maxDepth`, `boundaryDepth` | Spatial discovery limits |
| `sampleBudget` | Maximum scalar field evaluations for this stage |
| `componentSampleBudget` | Maximum scalar field evaluations fitting/checking one component |
| `rootIterations` | Maximum iterations locating each mesh-edge crossing |
| `extrema` | Whether to run local extremum searches this stage |
| `levelStride` | Publish ladder indices divisible by this number; default 1 |
| `onBudget` | `stop` (default) terminates construction; `continue` permits the next scheduled stage |

For example, more than three useful global increments can use multipliers
16, 8, 4, 2, 1 with progressively increasing discovery depths and budgets. The
explicit targets apply to fitting, path validation, previous-level reuse, and
quality metadata. The built-in schedules use these explicit multipliers. Custom
schedules omitting both fitting settings retain the historical 4×/2×/1× fallback
for compatibility; new schedules should set fitting targets explicitly. Legacy
mesh `tolerance` and `toleranceMultiplier` retain their old units/behavior.

`quality.levelStride` declares preview ladder density; `steps` still identifies
the underlying requested ladder. Sparse preview levels are anchored at step 0,
including negative scales. Each publication still consists of whole closed or
boundary-terminated contours. A continued stage that exhausts its budget retains
the previous atlas if available; it does not change earlier publications. Without
an earlier atlas it may publish only finished levels or an empty result if mesh
discovery could not complete. Extremely small budgets need not yield a useful
first atlas.

`stats.passSamples`, `stats.sampleBudget`, and `stats.componentSampleBudget`
expose stage effort. Budgets count scalar field calls, not milliseconds or
individual projection evaluations. The numerical sampler itself bounds its
projection evaluations. Mesh and bounded sample-cache state survive stages;
contour graph extraction and fitting still repeat substantially. Additional
stages therefore have overhead. Existing subdivision is not coarsened when a
later stage specifies a smaller depth.

First-publication reports are saved as `schedule-first-*.json`. Reproduce with
`FIRST_ONLY=1 PRESET=responsive` (or `fast` / `balanced`) and
`node tests/contour-coverage-node.mjs`. `PREVIEW_STRIDE`, `PREVIEW_BUDGET`, and
`COMPONENT_BUDGET` override preview settings for this benchmark.
