# Kartverket terrain candidates

The current map uses native **Kartverket NHM DTM at 1 m**, replacing the
[archived Terrarium analysis](ARCHIVED-TERRARIUM-EXPOSURE.md). The latter missed
a cliff and its slope claims must not be treated as validated routes.

The cost is integrated along the track:

```
distance × [1 + P × (10 × grade + 6^(5 × grade − 1) − 1/6)]
```

Grade is the magnitude of the terrain gradient (rise/run), not track incline.
`P=1` uses the requested formula. All published routes use this same cost;
alternatives represent different geographical corridors. Flat terrain costs exactly its distance. There is no cutoff.
All terms scale with distance, preventing the graph step size from changing
the meaning of the objective.

Cliff and maximum-slope checks use **1 m terrain slope**. The fall-line rule
uses height differences across **10 m** in each direction: above a 10-degree
slope in that field, stay within `90 - 3*slope` degrees of uphill or downhill.
A 4 m search mesh is refined to 1 m within 250 m of each hut; every edge is
integrated over the intersected native cells. The exporter independently
recomputes gradients and verifies heading, slope and actual route length.

Final candidates are refined at two scales: 1 km windows with a 300 m
neighborhood on the 4 m graph, and 100 m windows with a 25 m neighborhood on
the 1 m graph. Checks converge to a 0.5% window-cost tolerance (with small
absolute tolerances). Alternatives require at least a continuous kilometre
at least 500 m from the other corridor. Weight-only variations and forced
detours that collapse back into the same corridor are removed.

Distances below 18 km are preferred; normal daily candidates must remain
under 25 km. Different Tjønnebu return candidates can extend to 35 km. A
sub-20-degree first-night alternative would end at Torsbu and be separate;
none was found in the native-data searches. This is not a proof that no
continuous field route exists.

The finite search mesh and downloaded corridor coverage produce **candidates,
not certified global optima**. The one-metre maximum can reflect small rock
features. The model does not represent snow cover, lake ice or avalanche
exposure. These tracks are not field verified. The steepness overlay on the
map still uses Terrarium and does not validate these routes.

See [the current metrics and search timings](kartverket-analysis.json) and
[the algorithm and reproduction instructions](../../tools/ski-trek/KARTVERKET.md).
The current route geometries, parameters and validation results are in
`exposure-routes.geojson`; GPX downloads retain the source and model notes.

## Current corridors and profiles

The first-day candidate is the Styggedalen route (25.0 km); no second distinct
native-validated first-day route is published. Day 2 passes near Kupevatnet;
day 3 goes north of Tordsvatnet and west of Hellarhøa. The 17.25 km
Jervebua–Mebua option climbs toward Istjønna first, then passes within 995 m
of Midthøa. The current Tjønnebu return retraces the outward corridor.

Click a track for its metrics, GPX and elevation profile. Ascent/descent use
5 m chainage samples, 10 m Gaussian smoothing and a 3 m reversal threshold,
with endpoint elevations retained. Raw ascent/descent are retained in the
GeoJSON. This smoothing is solely for elevation totals and display; route
cost and maximum terrain slope use native one-metre gradients.
