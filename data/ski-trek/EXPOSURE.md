# Kartverket terrain-cost minima

Routes use Kartverket NHM DTM sampled at **1 m**, replacing the
[archived Terrarium analysis](ARCHIVED-TERRARIUM-EXPOSURE.md). Cost integrates
`1 + 10*grade + 6**(5*grade - 1) - 1/6` over horizontal distance. Grade is the
full terrain gradient, not the incline along the track.

Native one-metre terrain determines cost and maximum slope. On the separate
10 m gradient field, terrain over 10 degrees requires travel within
`90 - 3*slope` degrees of either fall-line direction.

## Minima and alternatives

Every candidate undergoes whole-route shortest-cost descent in a recentered
corridor. Only the hut endpoints are fixed; named valleys are seeds. There
is no 25 km cutoff or extra distance pressure during refinement. A final
search must find no qualifying improvement in a 1200 m neighborhood on a
4 m mesh, with a 1 m band extending 60 m around the complete route. The cost
tolerance is 0.02% or 0.25 equivalent metres, whichever is larger.

This is a defined finite neighborhood check, not a proof of a global or
continuous optimum. Every graph edge is independently checked against native
terrain, but broad searches still have a 4 m mesh and finite data coverage.

For each leg, the maximum eligible length is **twice the shortest converged
minimum found**. This includes minima later merged or rejected by cost.
Options must also cost no more than **135% of the best length-eligible
minimum**. Geographically duplicate basins retain the cheapest representative.

Geographic distinction requires **both** routes to stay apart over at least
15% of their own length, including one continuous stretch at least
`max(750 m, 12% of the shortest minimum length)`. Separation is
`max(150 m, min(500 m, 2.5% of that reference length))`. Distances use 25 m
chainage samples. Short excursions do not create extra options. These are
explicit, configurable heuristics; they do not enumerate all possible minima.

## Inspect and download

Click a track for metrics, GPX and an elevation profile. Gain/loss use 5 m
samples, 10 m Gaussian smoothing and a 3 m reversal threshold, with endpoint
heights retained. Raw totals remain in the GeoJSON. Profile smoothing does
not alter route cost or terrain maxima.

See [candidate outcomes and eligibility references](kartverket-analysis.json)
and [the algorithm, limitations and reproduction instructions](../../tools/ski-trek/KARTVERKET.md).
The steepness overlay still uses Terrarium. Terrain models do not represent
snow cover, lake ice or avalanche exposure; the tracks are not field verified.
