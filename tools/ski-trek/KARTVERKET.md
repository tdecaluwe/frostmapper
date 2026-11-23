# Native Kartverket terrain routing

The new pipeline is independent of the previous Terrarium search. The native
UTM32 terrain source is `nhm_dtm_topo_25832`, requested at **1 m** through WCS.
Only downloaded, valid cells are traversable. Tiles have a one-cell derivative
halo. Missing terrain never becomes a zero-height or flat shortcut.

`kartverket-terrain.py` downloads a padded union of the existing candidate
corridors, retaining native heights and centidegree-rounded-up 1 m slopes.
`kartverket-heading.py` builds a separate fall-line field: height differences
across **10 m** in each direction. This leaves native cliff checks untouched.
`kartverket-search.cpp` searches a mesh, integrating cost and constraints over
**every intersected native cell**, rather than testing only graph vertices.
`kartverket-validate.py` independently recomputes slopes, headings and metrics
from the original float heights using segment/cell clipping.

## Objective

Let `s` be terrain slope in degrees and `g = tan(s)` its rise/run grade.
The current cost per horizontal metre is the user's linear/exponential model:

```
cost = 1 + P * (10*g + 6**(5*g - 1) - 1/6)
```

`P=1` is the specified formula. A stronger penalty can generate proposal
seeds, but every published candidate is refined and scored using `P=1`. The subtraction makes flat terrain cost exactly its horizontal
distance. There is no low-slope cutoff. This replaces the earlier quadratic
proposal and intentionally has a nonzero derivative at flat terrain.
The full expression scales with distance, so sampling and segmentation do
not introduce a fixed per-edge penalty. Grade is terrain rise/run, not track
incline; 30% is `0.30`, approximately 16.7 degrees.

The 10 m heading field must satisfy `deviation <= 90 - 3 * slope` where its
slope exceeds 10 degrees; either uphill or downhill is acceptable. The maximum
slope cap and cost use native 1 m slope. Search quantization is conservative;
validation reports unrounded native values.

## Scope and bounds

The mesh and finite corridor coverage mean these are discrete candidates,
not a global continuous optimum. A failed search does not establish that no
field route exists. A* minimizes the terrain cost plus a tunable distance pressure. When the
lowest-cost route is too long, the driver increases that pressure and keeps
qualifying alternatives. It does not discard a more expensive short arrival
just because a cheap long arrival reached the same node first. This is a
Lagrangian candidate search, not an exact multi-label resource-constrained
optimum. `kartverket-geographic.py` re-scores native-verified proposal geometries under
one common objective, refines them locally and removes geographical duplicates. Returned tracks must pass native checks
and the actual distance limit before publication. Compare candidates under
18 km when available; hard daily limit 25 km, optional Tjønnebu returns 35 km.
A sub-20-degree first-night alternative, when found, ends at Torsbu and is
separate. The current search did not find one; archived coarse-model tracks
must not be reused as if they had passed the new terrain checks.

The terrain model describes ground, not snow cover. Neither ice nor avalanche
assessment is included. These remain planning candidates.

## Running

Python tools use the offline NumPy/Pillow stack and GDAL already used by the
previous analysis. No new browser dependencies or server are introduced.
Caches and large working rasters stay outside the deployed repository.

```
python3 tools/ski-trek/kartverket-terrain.py WORKING_DIRECTORY data/ski-trek/kartverket-coverage.json
python3 tools/ski-trek/kartverket-heading.py WORKING_DIRECTORY
g++ -O3 -std=c++17 tools/ski-trek/kartverket-search.cpp -o WORKING_DIRECTORY/search
python3 tools/ski-trek/kartverket-routes.py WORKING_DIRECTORY PREVIOUS_WORKING_DIRECTORY
python3 tools/ski-trek/kartverket-returns.py WORKING_DIRECTORY PREVIOUS_WORKING_DIRECTORY
g++ -O3 -std=c++17 tools/ski-trek/kartverket-local.cpp -o WORKING_DIRECTORY/local
python3 tools/ski-trek/kartverket-geographic.py WORKING_DIRECTORY
python3 tools/ski-trek/kartverket-via-huts.py WORKING_DIRECTORY PREVIOUS_WORKING_DIRECTORY
python3 tools/ski-trek/kartverket-geographic.py WORKING_DIRECTORY
g++ -O3 -std=c++17 tools/ski-trek/kartverket-corridor.cpp -o WORKING_DIRECTORY/corridor
python3 tools/ski-trek/kartverket-named-corridors.py WORKING_DIRECTORY
python3 tools/ski-trek/kartverket-export.py WORKING_DIRECTORY OUTPUT_DIRECTORY
python3 tests/kartverket-routing.py
```

## Local stability and geography

The final candidates share a 45-degree native one-metre slope ceiling and
identical fall-line rules. The under-20-degree first-night diagnostic uses
its own stricter ceiling. The 45-degree ceiling is a search constraint, not
a statement about skiing suitability; actual maxima are reported separately.

`kartverket-local.cpp` refines overlapping 1 km windows inside a 300 m
neighborhood at 4 m search spacing, then 100 m windows inside a 25 m
neighborhood at 1 m spacing. It repeats until neither scale improves the
route meaningfully. The relative tolerance is 0.5% of window cost; the
absolute tolerances are 2 equivalent metres and 0.25 equivalent metres,
respectively. Local distance-constrained cases use a Pareto-label search
when Lagrangian bounds cannot certify the window. The Pareto search has an
explicit five-million-label limit; exceeding it fails the check rather than
claiming convergence. Macro refinement skips the endpoint neighborhoods
already searched at 1 m; checkpoints are aligned to the coarse grid.

Only converged candidates with no unresolved window checks are published.
This is a finite, explicitly defined local-optimality check, not a proof about
every continuous curve or every possible rerouting neighborhood.

Geographic alternatives must have a continuous section at least 1 km long
that is at least 500 m from the other corridor (checked in both directions).
Proposal waypoints and exclusion circles are removed during refinement.
Candidates that collapse into the same corridor are discarded. These
thresholds reject cosmetic variations; they do not classify named valleys
or establish topological equivalence.

The exact downloaded tile inventory is retained in `kartverket-coverage.json`.
Working elevation arrays, intermediate proposal routes and caches are not
shipped to the browser. The deployed app reads static native-validated tracks.

## Named corridors and elevation profiles

`kartverket-named-corridors.py` uses ordered circular regions on the same
native-cell graph. Region crossings are optimized jointly, then retained as
checkpoints during local refinement. These are constrained local candidates;
the local test does not optimize checkpoint locations again. Official SSR
place coordinates and identifiers are in `route-landmarks.json`.

The active first-day candidate passes Styggedalen. The northern alternative
has no verified result. Day 2 passes the Veltdalsvatnet valley and Kupevatnet;
day 3 uses the valley north of Tordsvatnet, west of Hellarhøa. Jervebua–Mebua
first climbs toward Istjønna (approximately 242 m elevation gain to the initial
region), then passes 995 m from Midthøa. The complete candidate is 17.25 km.
The native search did not establish a geographically distinct Tjønnebu return;
the published return follows the outward corridor in reverse.

`elevation-profile.py` resamples heights at 5 m horizontal chainage, smooths
with a 10 m Gaussian kernel, retains endpoint heights and counts reversals
with 3 m hysteresis. This suppresses raster-scale noise in ascent/descent
without accumulating every one-metre oscillation. Raw totals remain in route
metadata. Profiles and filtered totals are exported together. Native terrain
maxima and route cost are computed independently of this smoothing.

Clicking a route opens its bottom details panel and elevation profile. Profile
inspection places a marker on the track; overlapping routes have a selector.
The compact menu retains route visibility and selection. Six-day GPX export
uses the selected daily candidates. Tracks retain alternating 1 km opacity.
