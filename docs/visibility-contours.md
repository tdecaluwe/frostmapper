# Visibility-driven scale contours

The main controls are independent:

```js
new BoundedProjectionContourAtlas(target, source, {
  minScale: -20,
  minPatchPixels: 10,
  tolerance: 0.01,
  steps: 4
})
```

`minScale` selects the lowest relative log₂ scale in the ladder (within the
supported range). `minPatchPixels` selects the minimum useful patch span.
`tolerance` controls sampled log₂ field residual along retained curves. Neither
changing the cutoff nor changing the pixel threshold shifts the other rule.
`minZoom` remains a compatibility alias when `minScale` is omitted.

For a contour at level L and highest supported zoom Z, evaluate visibility at
`clamp(Z + L, 0, Z)`. With Z=20, level −20 is evaluated at viewing zoom 0 and
level −15 at viewing zoom 5. A patch must span at least `minPatchPixels` in
width or height in the **displayed target projection** at that zoom. It is not
measured in Web Mercator metres, ground distance, path length, or source extent.
Periodic target x coordinates are unwrapped before measuring span.

The projection adapter supplies the target transform, target wrapping width,
and a default resolution ladder based on the larger target extent dimension
and a 256-pixel root tile. Override `visibility.resolutionAtZoom` for a different
map resolution ladder; the callback must support fractional zoom values.
For the lower-level numerical engine, provide the display metric explicitly:

```js
new CompactContourAtlas({
  sample: sourceScaleField,
  extent: sourceExtent,
  periodicX: sourceCanWrap,
  minScale: -20,
  minPatchPixels: 10,
  tolerance: 0.01,
  visibility: {
    project: sourceToTarget,       // forward coordinate evaluation
    resolutionAtZoom: targetResolutionAtZoom,
    worldWidth: targetWrapWidth    // 0 for a nonperiodic target
  }
})
```

Without a visibility transform, the engine treats its own coordinate extent
as the display space. That default is suitable for scalar-field examples; a
reprojection needs its actual target metric. Set `minPatchPixels:0` to disable
visibility filtering and the associated discovery stopping rules.

## Work allocation

1. Refine the retained global mesh using field interpolation error and sampled
   target footprints. Once a cell is too small to contain a relevant visible
   feature, stop discovering features inside it. Existing contours crossing
   many such cells are still extracted and corrected, rather than broken up.
2. Stop local minimum/maximum searches after a seed is beyond the requested
   scale ladder. For local minima, also stop when the remaining search region
   is subthreshold at its relevant viewing zoom. There is no need to locate an
   invisible minimum to machine precision to trace its larger outer contours.
3. Build a conforming candidate contour graph from edge brackets. Accurate
   edge roots are **deferred**. Reject a whole candidate component when its
   sampled bracket envelope is invisible, before doing its root solves.
4. Solve the surviving roots, fit smooth implicit cubics, then measure and
   validate the whole result. Reject the entire component if it is invisible,
   cannot meet sampled accuracy, cannot be oriented, or exceeds its budget.
5. Publish complete global passes. Retain previous complete levels only after
   revalidating their accuracy and visibility. Work exhaustion preserves the
   preceding publication. The mesh and bounded sample cache survive passes.

Discovery footprint tests use a safety factor of 2 and sampled envelopes.
They are smoothness-based heuristics, not rigorous interval bounds on arbitrary
black-box functions. Unknown/nonfinite display transforms prevent culling
rather than silently classifying a patch as invisible. These cases are reported.
The Grieger 10-pixel benchmark's mesh-cell culling counter is zero: most savings
there come from stopping extrema searches and rejecting components before
accurate roots/fitting. The synthetic regression also exercises actual early
cell subdivision pruning.

The default compact preset is now `balanced`: three full-density publications.
With visibility pruning it gives a faster first atlas containing all relevant
reference paths on the benchmark. The optional `responsive` and `fast` previews
remain available, as do arbitrary explicit `passes` schedules. Their early
accuracy/coverage tradeoffs are still explicit; visibility pruning does not
make a sparse preview equivalent to a full-density atlas.

## Accuracy and durability

Tolerance is an **absolute log₂ residual**, independent of visibility. Built-in
coarse/medium/fine targets are 4×/2×/1× the configured tolerance. Cubics are
checked at endpoints and 15 interior points. The numerical field itself is
estimated with adaptive finite differences and consistent one-sided quadrants
at folds. Construction uses forward/inverse coordinate evaluations only.

`atlas.quality` reports the requested and sampled acceptance tolerances,
maximum sampled residual, minimum scale, pixel threshold, viewing-zoom limit,
visibility metric, unknown visibility count, discovery policy, and termination.
Each path also reports `quality.sampledMaxError`, `quality.patchPixels`, and
`quality.visibilityZoom`. A null pixel span denotes disabled or unmeasurable
visibility; it must not be interpreted as a zero-size patch.

These checks do not mathematically bound residual between probes or finite-
difference bias. A curvature-normalized error certificate is not claimed.
Whole contours are published or omitted: no fitting prefix or dangling interior
fragment is emitted. Paths retain coherent `high-left` orientation and source
seam connectivity. The output cap, component/level workspaces, extrema seeds,
field evaluation budgets, and display evaluation budgets remain bounded.

The new deferred-root workspace adds 200,704 bytes to the compact engine.
Its numeric workspace is about 1.80 MB, and a post-GC retained-state check
measured approximately 2.6 MB excluding atlas output. The larger bounded
candidate uses about 4.05 MB of numeric workspace and 4.8 MB retained state.
Those are not peak process-memory measurements. Refinement buffers and field/
display callbacks are released when construction stops. Maximum discovery depth
is 25 so packed lattice keys remain exact doubles; seed IDs use a disjoint
negative range.

## Projection validity in the application adapter

For a source-coordinate atlas, `BoundedProjectionContourAtlas` now defaults to
adaptive finite differences and `sourceDomainPolicy:'forward'`. A finite forward
projection inside the source domain defines the field. Target extent clipping
belongs to display, and inverse round-trip noise is not used to punch holes in
otherwise finite forward results. No analytic projection derivative is used.

Use `sourceDomainPolicy:'roundtrip'` to request the previous strict target-extent
and inverse-round-trip checks. Custom `scaleSample` callbacks retain control of
their own domain. Standalone legacy `DistortionField` users retain their default
strict policy unless they explicitly choose `domainPolicy:'forward'`.

## Results

Web Mercator → Grieger, steps=4, minScale=−20, minPatchPixels=10. The full
analytical reference has 346 paths. Applying the target-space 10-pixel rule to
that **previous full atlas** requires 212 paths. Comparing only to a newly
pruned reference would risk concealing a shared discovery error, so both checks
were performed. All 212 numerical paths match distinct required reference
paths by level, closure, position, and comparable size: zero missing or extras.

Direct forward-evaluator benchmark, tolerance=0.01:

| Publication | Pass time | Relevant paths | Max sampled reference error, log₂ |
| --- | ---: | ---: | ---: |
| Coarse | 1.86 s | 212 / 212 | 0.01880 |
| Medium | 2.40 s | 212 / 212 | 0.00954 |
| Fine | 5.11 s | 212 / 212 | 0.00415 |

Total: **9.36 s**. The earlier implementation took 29.50 s constructing 315
paths, of which the same 212 pass this visibility rule. Those earlier 212 paths
had the same maximum sampled error, 0.00415 log₂. This comparison therefore
preserves relevant coverage and worst sampled accuracy while avoiding work on
irrelevant patches. The new final output has 806 cubics versus 820 for the
previous visible subset (1,338 for its complete unfiltered output).

The diagnostic derivative adapter with the same rules took about 6.62 s and
also produced all 212 required paths. It is only used for evaluation.
The actual OpenLayers/proj4 projection adapter was tested separately: it also
produced 212 paths in every pass, with final maximum reference error 0.00415,
first publication 2.83 s, and total 16.16 s. Its transform-call overhead means
its wall timings are not interchangeable with the direct evaluator benchmark.

## Coarse root-solve tuning

The compact preset uses 28 edge-root iterations in its coarse publication;
medium and fine retain the engine default of 56. This is an iteration cap,
not a requested error tolerance. Roots still stop early when their field
residual reaches the existing threshold. With 28 iterations the coarse atlas
matched all 212 required paths and had the same maximum sampled error as at 56
iterations (0.01880 log₂). It used 138,958 rather than 143,726 scalar field
samples. Caps of 20 or fewer omitted paths and took longer, so 28 is the
lowest tested setting that retained full benchmark coverage.

Paired full-build runs (56 then 28 iterations, same process environment) gave
these elapsed times:

| Pair | Coarse pass, 56 → 28 | Full build, 56 → 28 | Final paths / max sampled error |
| --- | ---: | ---: | ---: |
| 1 | 2.03 → 1.75 s | 10.42 → 10.05 s | 212 / 0.00415 |
| 2 | 3.11 → 2.73 s | 15.73 → 14.14 s | 212 / 0.00415 |
| 3 | 1.98 → 1.70 s | 10.10 → 10.08 s | 212 / 0.00415 |

The median coarse saving was about 0.37 s (roughly 14%). The median full-build
saving was about 0.37 s (roughly 3.5%); later-stage timing variation was much
larger than the coarse-stage change. All final runs retained the same coverage,
806 curves, and sampled error distribution. A separate actual OpenLayers/proj4
adapter run with the tuned preset took 13.95 s total (2.45 / 3.42 / 8.08 s by
stage), with the same 212 paths and 0.00415 final sampled error.

For an application-level comparison, the existing worker builder was also run
on the same OpenLayers/proj4 pair in the same workspace: it took 18.86 s and
emitted 291 final paths. The new builder took 13.95 s (about 26% less wall
time) and emitted the 212 paths that pass the configured 10-pixel visibility
rule. This is a useful end-to-end estimate, not a strict equal-output speedup:
the old worker did not apply that visibility cutoff, and its output was not
audited against the new builder's final tolerance in that timing run.

The Peirce forward and inverse functions in this working tree were also timed
against the repository version using 40,000 inputs per operation and seven
alternating runs. Median isolated forward time changed from 10.92 ms to 8.49 ms
(about 22% faster); inverse time changed from 195.60 ms to 32.56 ms (about 6×
the throughput). These microbenchmarks isolate the projection functions; they
do not translate directly into the same percentage gain for atlas generation.
The projection and distortion reference suites pass, as do the atlas coverage
and topology audits. All reported contour errors are sampled checks, not formal
error certificates.

Independent policy checks:

| minScale | minPatchPixels | Required reference paths | Numerical paths | Max sampled log₂ error |
| ---: | ---: | ---: | ---: | ---: |
| −20 | 1 | 240 | 240 | 0.00776 |
| −20 | 10 | 212 | 212 | 0.00415 |
| −20 | 16 | 208 | 208 | 0.00415 |
| −10 | 10 | 186 | 186 | 0.00415 |

At tolerance=0.005 and the default visibility limits, all 212 paths remain;
maximum sampled reference error falls to 0.00231 log₂, with 902 cubics and
11.49 s total direct construction. Every tested final atlas has zero invalid
audit samples, zero interior dangling endpoints, and no positional breaks.
Coverage, extrema, periodic seams, source-domain policy, budget handling,
progressive immutability, and memory release have regression checks.

Reproduction:

```sh
node tests/contour-coverage-node.mjs
MIN_PATCH_PIXELS=1 RESULT_DIR=/tmp/one-pixel node tests/contour-coverage-node.mjs
MIN_SCALE=-10 RESULT_DIR=/tmp/scale-ten node tests/contour-coverage-node.mjs
TOLERANCE=0.005 RESULT_DIR=/tmp/tight node tests/contour-coverage-node.mjs
ADAPTER=analytical RESULT_DIR=/tmp/reference node tests/contour-coverage-node.mjs
node tests/compare-visible-coverage-node.mjs full-reference.json numerical-fine.json
node --experimental-loader ./tests/node-real-ol-loader.mjs tests/contour-projection-visibility-node.mjs
```

Saved reports: `docs/contour-ladder-results/visibility-*.json`.

## Progressive viewing zooms

`preset:'progressive'` applies viewing-zoom offsets 4, 2, 0 to coarse, medium,
and fine. With highest supported zoom 20, these publications target maximum
viewing zooms 16, 18, 20. For each stage, the visibility test uses
`clamp(effectiveMaximum + level, 0, effectiveMaximum)`. The pixel threshold,
minimum scale, contour ladder density, and fitting targets remain independent.
Later passes discover/refine additional patches as the effective maximum rises.

```js
new BoundedProjectionContourAtlas(target, source, {
  minScale:-20, minPatchPixels:10, tolerance:0.01,
  preset:'progressive'
})

// Equivalent per-stage overrides on the default schedule:
new CompactContourAtlas({
  sample, /* extent and target visibility metric as above */
  coarse:{visibilityZoomOffset:4},
  medium:{visibilityZoomOffset:2}
})
```

`quality.visibilityZoomOffset` and `quality.effectiveVisibilityHighestZoom`
identify each publication's viewing detail. Each path's `visibilityZoom` uses
that publication's effective maximum. Previous publications remain immutable.
Custom `passes` can specify any nonnegative `visibilityZoomOffset`. The default
`balanced` preset retains offset 0 at every publication; the progressive policy
is opt-in.

Grieger with the 10-pixel rule:

| Publication | Maximum viewing zoom | Required / retained paths | Pass time | Max sampled log₂ error |
| --- | ---: | ---: | ---: | ---: |
| Coarse | 16 | 180 / 180 | 1.68 s | 0.01880 |
| Medium | 18 | 196 / 196 | 2.04 s | 0.00954 |
| Fine | 20 | 212 / 212 | 5.41 s | 0.00415 |

Reference matching was performed separately under each stage's visibility rule;
there were no missing or extra paths, invalid audit samples, or dangling ends.
The coarse latency gain against a nearby full-zoom run (1.90 s) is about 11%.
This is a modest gain. Coarser mesh experiments did not produce a better
coverage/speed tradeoff and are not part of the preset.

Coarse fitting accuracy can also be overridden independently, for example
`coarse:{fitTolerance:0.08}`. `medium` supports the same per-stage overrides;
`passes` remains the complete custom-schedule interface. These changes leave
the final tolerance unchanged. First-pass fitting-only experiments:

| Coarse target, log₂ | First pass | Paths | Max sampled reference error, log₂ |
| ---: | ---: | ---: | ---: |
| 0.04 (default at final tolerance 0.01) | 1.90 s | 212 | 0.01880 |
| 0.08 | 1.84 s | 212 | 0.03155 |
| 0.12 | 1.84 s | 212 | 0.04474 |
| 0.20 | 1.80 s | 212 | 0.07048 |
| 0.40 | 2.02 s | 212 | 0.14313 |

The small timing differences are noisy; field-call counts fell from 143,726
at 0.04 to 137,726 at 0.20, only about 4%. Discovery and root solving dominate
this stage, so loosening fitting alone gives little benefit. Its default is
unchanged.

For benchmark overrides use `COARSE_ZOOM_OFFSET`, `MEDIUM_ZOOM_OFFSET`,
`COARSE_TOLERANCE`, and `COARSE_MESH_TOLERANCE` with
`tests/contour-coverage-node.mjs`. `PRESET=progressive` selects the 4/2/0
schedule directly. Reports are saved as `coarse-tolerance-*.json` and
`progressive-zoom-offsets.json` in the results directory.

A more widely spaced progression can use maximum viewing zooms 10, 15, 20:

```js
new CompactContourAtlas({
  sample, /* extent and target metric as above */
  minScale:-20, minPatchPixels:10, tolerance:0.01,
  coarse:{visibilityZoomOffset:10},
  medium:{visibilityZoomOffset:5}
})
```

The numerical Grieger benchmark retained 132, 172, and 212 paths respectively,
matching every required reference path at each stage, with no extras. Pass
runtimes were 1.57 s, 1.84 s, and 6.15 s; total 9.56 s. Maximum sampled log₂
errors were 0.01880, 0.00954, and 0.00415. First publication was about 17% faster
than the nearby 1.90 s full-viewing-zoom baseline. It delays more fine patches
than 16/18/20 while preserving the requested ladder density. This run did not
show a total-runtime improvement; wall times vary and fine-pass work is the
same. Report: `progressive-zoom-10-15-20.json`.
