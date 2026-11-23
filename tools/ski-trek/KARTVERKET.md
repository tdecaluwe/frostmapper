# Kartverket terrain routing

The native UTM32 source is `nhm_dtm_topo_25832`, sampled at **1 m** through
Kartverket WCS. Unknown cells are closed. Cached height tiles include derivative
halos. Native slope and exact segment/cell integration handle cost and cliff
checks. A separate gradient across **10 m** handles direction of travel.

## One objective

For terrain slope `s`, let `g = tan(s)` be rise/run grade, independently of
track direction. Integrate this cost over horizontal track distance:

```
cost per metre = 1 + 10*g + 6**(5*g - 1) - 1/6
```

Flat terrain costs its distance; there is no low-slope cutoff. All published
minima use the same objective. Above 10 degrees in the 10 m gradient field,
the track must stay within `90 - 3*s` degrees of either fall-line direction.
A common 45-degree native slope ceiling is retained from the previous model.
It is a search constraint, not a skiing suitability claim.

## Find a minimum before applying eligibility limits

The old 25/35 km cutoffs and distance pressure are **not** used in minimum
refinement. Named valleys are starting suggestions, not mandatory waypoints.

`kartverket-basin.cpp` searches the entire route at once in a sparse graph:

1. Build a corridor around the current polyline, retaining both hut endpoints.
2. Search shortest cost with a 4 m mesh throughout a 600 m neighborhood and
   a 1 m mesh within 20 m of the complete polyline. All edges integrate every
   crossed native cell. No intermediate point is pinned.
3. Replace the route when cost improves by more than `max(0.25, 0.0002*cost)`
   equivalent metres, rebuild the corridor and repeat.
4. Once stable, repeat with **1200 m / 60 m** widths. If this finds a decrease,
   resume descent and recheck. Publication requires a final wider/finer pass
   with no qualifying decrease. Hitting the iteration limit fails the search.

Corridor radii describe rasterized vertex disks; broad stamps are padded
to enclose segments between samples.

Search slope codes round upward to 0.01 degrees; independently reported
metrics use the unrounded gradient.

The input route remains available in the graph and supplies an upper bound.
A* uses ground distance as an admissible lower bound. Its search is purely
cost based; it does not discard a cheaper arrival for being longer. Sparse
row intervals store dense and coarse runs without allocating the entire
bounding rectangle. No large raster or graph is shipped to the browser.

This certifies a finite **mixed-mesh corridor neighborhood**, not every
continuous curve, every missing terrain region or a global optimum. Native
cell checking does not turn the 4 m search mesh into a global 1 m search.
The 1 m band permits small whole-route changes; the outer mesh tests much
larger detours. Metadata records every pass and its tolerance, dimensions,
node counts and time. Independent validation recomputes native gradients
and route metrics from the cached float heights.

`kartverket-discover-minima.py` uses the previous named/alternative proposals,
an unrestricted cost-search seed, and a near-distance-only seed. Additional
geographically different cached proposals are explored, up to seven seeds per
leg. Every seed descends under the same cost. This is a multistart heuristic,
not exhaustive enumeration. Reverse routes have the same minima because both
the cost and the bidirectional fall-line constraint are symmetric.

## Which minima warrant an option?

`MinimumPolicy` in `kartverket-minima.py` owns the configurable selection rules.
Apply them separately to each pair of endpoints, **after convergence**:

- Let `L` be the shortest length among all converged minima found, including
  candidates later merged or rejected by cost. Accept lengths at most **2L**.
  Recompute this when a shorter minimum is discovered.
- Let `C` be the best cost among those length-eligible minima. Require cost at
  most **1.35C**. This initial 35% quality budget is an explicit heuristic.
- Compare routes using 25 m chainage samples. The separation threshold is
  `max(150 m, min(500 m, 0.025L))`. **Both** routes must have at least 15% of
  their length beyond that threshold, including a continuous run at least
  `max(750 m, 0.12L)` long. A short spike or one-sided loop fails.
- Process candidates from lowest cost upward and merge geographic duplicates
  into the cheapest representative. There is no quota that forces two options.

This combines a repeatable local-minimum check, relative cost quality and
substantial geometric separation. It is not a mathematical saddle-height or
homotopy classification. All seed outcomes, rejections and reference values
are recorded in `minimum-summary.json` and exported in `kartverket-analysis.json`.

## Reproduce

Offline tools use Python, NumPy/SciPy/Pillow, GDAL and a C++ compiler. These
are not browser dependencies. From the repository root:

```sh
python3 tools/ski-trek/kartverket-terrain.py WORKING_DIRECTORY data/ski-trek/kartverket-coverage.json
python3 tools/ski-trek/kartverket-heading.py WORKING_DIRECTORY
g++ -O3 -std=c++17 tools/ski-trek/kartverket-search.cpp -o WORKING_DIRECTORY/search
g++ -O3 -std=c++17 tools/ski-trek/kartverket-basin.cpp -o WORKING_DIRECTORY/basin
python3 tools/ski-trek/kartverket-discover-minima.py WORKING_DIRECTORY
python3 tools/ski-trek/kartverket-export.py WORKING_DIRECTORY OUTPUT_DIRECTORY
python3 tests/kartverket-minima.py
python3 tests/kartverket-data.py
```

A fresh terrain working directory bootstraps hut positions, displayed route
seeds and the shortest-reference seeds from the deployed JSON/GeoJSON. An existing working directory can also supply
previous binary candidates from `kartverket-routes.py`,
`kartverket-geographic.py` and `kartverket-named-corridors.py`. Those older
tools are **seed generators**;
their fixed limits or pinned checkpoints do not define final minima. An
existing `before-minima-manifest.json` preserves the original seed manifest.
Descent caches are keyed by input geometry, the minimum-search executable
and algorithm, grid metadata and downloaded tile inventory. If slope or
heading rasters are rebuilt with changed preparation logic, clear the
`minimum-*.json` records before rerunning descent.
The exact tile inventory is in `kartverket-coverage.json`.
`minimum-reference-seeds.json` retains the shortest found minimum for each
leg as compact, checksummed native-grid deltas. These are revalidated starting
seeds, not extra displayed options. This preserves a shorter reference even
when geographic merging chooses a slightly longer, cheaper representative.

## Profiles and display

`elevation-profile.py` resamples heights at 5 m horizontal chainage, smooths
with a 10 m Gaussian kernel and counts reversals with 3 m hysteresis. Endpoint
heights are retained and raw gain/loss remain in the GeoJSON. Profile smoothing
does not change the native slope field or routing cost.

Click a track for its metrics, profile and GPX. Overlapping tracks have a route
selector. The selected six-day GPX uses the chosen daily variants. Rendering
keeps alternating 1 km opacity. The steepness overlay still uses Terrarium;
it is a different terrain model from these tracks. Snow, ice and avalanche
assessment are outside the cost calculation.
