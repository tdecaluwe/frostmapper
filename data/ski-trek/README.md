# Tafjordfjella ski trek: terrain minimax analysis

Computed 20 November 2026 for Danskehytta → Veltdalshytta → Torsbu →
Pyttbua → Vakkerstøylen → Tjønnebu → Vakkerstøylen.

The objective is the maximum **terrain** slope, using the full magnitude of
the elevation gradient, independent of direction of travel. Every slope at
or below 10° has equal cost. For each day, find the lowest slope threshold
permitting a route within the distance bound, then the shortest route at
that threshold. This is a terrain-only calculation. Snow, ice, avalanche
exposure, vegetation, buildings, bridges and other obstacles are not modeled.

| Day | Leg | Horizontal distance | Maximum DEM slope |
| --- | --- | ---: | ---: |
| 1 | Danskehytta → Veltdalshytta | 17.3 km | 22.6° |
| 2 | Veltdalshytta → Torsbu | 11.8 km | 11.6° |
| 3 | Torsbu → Pyttbua | 12.2 km | 15.3° |
| 4 | Pyttbua → Vakkerstøylen | 15.7 km | 10.2° |
| 5 | Vakkerstøylen → Tjønnebu | 12.9 km | 15.5° |
| 6 | Tjønnebu → Vakkerstøylen | 12.9 km | 15.5° |

Both the preferred 18 km bound and the hard 25 km bound produce the same
minimum thresholds and shortest tracks, at the analysis's 0.1° precision.
The last day reverses day 5. Day 1's unconstrained 17° solution is about
40 km, so it is excluded by both daily limits.

These decimal angles describe the raster calculation, not surveyed accuracy.

## Inputs

- Elevation: [Mapzen/AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/),
  Terrarium PNGs at XYZ zoom 13. Ground pixels are approximately 8.84–8.98 m
  across this study area. Native elevation-source resolution varies by tile;
  this sampling does not imply nine-metre measurement accuracy.
- Hut positions: Peakbook UTM zone 32N entries
  [Danskehytta](https://peakbook.org/en/peakbook-element/50116/en/Danskehytta.html),
  [Veltdalshytta](https://peakbook.org/en/peakbook-element/50118/en/Veltdalshytta.html),
  [Torsbu](https://peakbook.org/en/peakbook-element/50120/en/Torsbu.html),
  [Pyttbua](https://peakbook.org/en/peakbook-element/50121/en/Pyttbua.html),
  [Vakkerstøylen](https://peakbook.org/en/peakbook-element/50122/en/Vakkerst%C3%B8ylen.html),
  [Tjønnebu](https://peakbook.org/en/peakbook-element/50123/en/Tj%C3%B8nnebu.html).
  Endpoints use the nearest raster cell, within about six metres of those coordinates.

## Calculation and verification

A continuous 5,120 × 5,888 elevation mosaic uses 460 tiles, so slope calculation
crosses tile boundaries. Central differences use latitude-corrected ground
spacing. Slopes are rounded upward to 0.1° after applying the 10° floor.

A four-neighbor connectivity check gives the unconstrained minimum threshold.
Binary search then tests the shortest possible track at candidate thresholds
against 18 km and 25 km. The shortest-path solver uses an eight-neighbor grid
and A* with a lower-bound ground-distance heuristic. A diagonal is allowed
only when both adjacent orthogonal cells also satisfy the threshold.
Distance is horizontal ground distance, with latitude varying by raster row.

The downloaded domain extends at least 12.5 km beyond the hut bounding box,
including every point that could belong to a route of at most 25 km. Expanding
an initial smaller study domain left all five distinct results unchanged.

Verification independently recomputed every path's length and slope, checked
all diagonal gates, confirmed the endpoints, and confirmed that lowering each
threshold by 0.1° prevents any route of at most 25 km. Three-dimensional DEM
path lengths were also below 18 km for every day (day 1: approximately 17.52 km).
GPX retains all path cells; the GeoJSON removes only collinear grid points.

## Reproduce

Analysis tools use Python with NumPy, SciPy and Pillow, GDAL's `gdaltransform`,
`curl`, and a C++ compiler. They are not application dependencies.
From the repository root:

```sh
mkdir -p /tmp/tafjord-analysis
python3 tools/ski-trek/download-terrain.py /tmp/tafjord-analysis
python3 tools/ski-trek/build-raster.py /tmp/tafjord-analysis
c++ -O3 -o /tmp/tafjord-analysis/shortest tools/ski-trek/shortest.cpp
python3 tools/ski-trek/solve.py /tmp/tafjord-analysis
python3 tools/ski-trek/validate.py /tmp/tafjord-analysis
python3 tools/ski-trek/export.py /tmp/tafjord-analysis data/ski-trek
```

The terrain download and working rasters stay outside the repository. The map
loads `route.geojson`; `tafjord-ski-trek.gpx` contains six named daily tracks.

## Map display

The Ski trek layer draws alternating 100% / 40% opacity sections at 1 km
intervals. Distance counts continuously across hut stops, using geographic
ground distance independently of the display projection. Splitting happens
once when the track loads. The final return leg overlaps day 5; selecting day 6
in the daily-leg controls switches that shared section to day 6's distance phase.
