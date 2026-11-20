# Current trek model: steep-ground exposure and fall-line direction

This replaces the earlier maximum-slope objective. The old files and README
remain as an archive; the map now loads `exposure-routes.geojson`.

## Requirements

- Primary comparison: horizontal distance travelled on **terrain** steeper
  than 15°, using the full magnitude of the terrain gradient.
- Above a 10° terrain slope `s`, travel must stay within `30 − s` degrees of
  either uphill or downhill fall line. This gives ±20° at 10°, ±15° at 15°,
  ±10° at 20°, and ±5° at 25°. Slopes above 30° cannot satisfy this rule.
- Days 1–5: prefer 18 km, maximum 25 km. Return alternatives on day 6:
  maximum 35 km, following the revised request.
- Try to keep day 1 below 20° terrain slope.
- Display alternatives where distance, steep-ground exposure and maximum
  slope have different trade-offs. Kilometre opacity continues through huts.

## Day 1 candidates

| Option | Distance | Distance on >15° terrain | Max traversed terrain slope |
| --- | ---: | ---: | ---: |
| A: shorter day | 17.52 km | 1,860 m | 26.9° |
| B: lower peak, under 18 km | 17.86 km | 2,241 m | 24.9° |
| C: lower peak, about 20 km | 19.96 km | 1,451 m | 24.5° |
| D: least exposure found | 23.23 km | 736 m | 27.4° |
| E: lowest peak among daily candidates | 24.99 km | 1,148 m | 23.9° |

Option D is initially selected because it has the least >15° exposure among
these daily candidates. A and C are initially displayed for comparison. A/B
meet the 18 km preference. Selecting an option updates the planned track,
later kilometre phases and the selected-plan GPX. Comparison overlays are
optional; they are not additional legs of the itinerary.

**A day-1 route below 20° and within 25 km has not been found.** A search with
176 directions, then a finer 640-direction stencil, found no connection in
the 25 km reachable domain under the heading rule and a 20° cap. A sub-20°
candidate found with a larger domain is 33.37 km, with 2,930 m above 15° and
maximum slope 19.994°. It is displayed only as an optional diagnostic and
cannot be selected into the daily plan. This is a result of the raster
search, not a proof that no continuous field route exists.

## Other legs and return choices

| Day / option | Distance | Distance on >15° terrain | Maximum terrain slope |
| --- | ---: | ---: | ---: |
| 2: Veltdalshytta → Torsbu | 10.94 km | 0 m | 15.0° |
| 3: Torsbu → Pyttbua | 11.76 km | 27 m | 15.3° |
| 4: Pyttbua → Vakkerstøylen | 13.57 km | 0 m | 14.9° |
| 5: Vakkerstøylen → Tjønnebu | 12.63 km | 13 m | 15.6° |
| 6 R: retrace day 5 | 12.63 km | 13 m | 15.6° |
| 6 F: lower-valley diversion | 13.98 km | 58 m | 19.6° |
| 6 G: wider eastern loop | 19.31 km | 437 m | 28.9° |

R remains selected by default. F is shown for comparison; G can be enabled.
The return diversions share the upper route rather than providing wholly
independent hut-to-hut corridors. They were found by excluding 500 m disks
on different lower-valley sections of the outbound track. Excluding a full
500/1,000 m outbound corridor, except hut approaches, found no connection
with the heading constraint in the searches run. G is a geography/variety
option, not an improvement over F in exposure, length or maximum grade.

Angles and very short exposure lengths are DEM estimates, not measurement
accuracy. Values rounded to 15.0° can be fractionally below 15° and therefore
have zero positive-length exposure above the strict threshold.

## Algorithm and limits

Inputs are the same ~8.9 m Terrarium elevation mosaic and public hut positions
documented in README.md. Central differences define gradient magnitude and
fall line. Headings compare in the conformal Mercator plane; ground distances
use the latitude correction. Both ascending and descending directions count.

The direction-aware graph uses primitive displacements out to eight cells:
176 headings rather than the former eight. Straight segments are clipped
exactly against raster squares. Each positive-length intersection contributes
its ground length to the >15° cost and must satisfy its own local heading
allowance. Merely checking endpoint headings would be insufficient. Touching
corner cells must also satisfy the terrain cap, but a zero-length corner
contact adds no exposure. Long flat-region moves can use a shorter stencil.

A family of shortest paths minimizes
`distance_above_15 + lambda * total_distance` for sampled `lambda` values,
with terrain caps 20°, 22.5°, 25° and 29.9°. Length-ineligible outputs are
excluded from the selectable plan. This produces supported candidate
trade-offs; it **does not certify the exact resource-constrained global
minimum**. Thus descriptions use “least exposure found.” Day-1 cap checks
were also repeated with the 640-heading stencil.

Independent Python code re-integrated every exported candidate across all
intersected cells, recomputed length and exposure, and checked
`abs(deviation) − (30 − slope) < 0` wherever slope exceeds 10°. This includes
F/G and the long diagnostic. Coordinates retain double precision: rounding
can otherwise alter a heading with a small remaining angular margin.
Analytic-plane checks cover heading rejection, slope caps, gentle terrain,
exposure integration and avoidance of an isolated steeper cell.

The model remains terrain-only. Snow, ice, avalanche exposure, obstacles and
bridges are outside this calculation, as requested.

## Reproduce

First download and build the working rasters using README.md. Then:

```sh
c++ -O3 -o /tmp/tafjord-analysis/exposure tools/ski-trek/exposure.cpp
python3 tests/exposure-routing.py /tmp/tafjord-analysis/exposure
python3 tools/ski-trek/search-exposure.py /tmp/tafjord-analysis
python3 tools/ski-trek/export-exposure.py /tmp/tafjord-analysis data/ski-trek
```

`exposure-trek.gpx` is the initially selected six-day plan. The map generates
an updated GPX when choices change. `day1-exposure-options.gpx` contains the
five eligible day-1 choices; `return-exposure-options.gpx` contains R/F/G.
`day1-under20-overlimit.gpx` is the separate diagnostic, not a daily option.
All route preparation is offline; the render loop only draws prepared features.
