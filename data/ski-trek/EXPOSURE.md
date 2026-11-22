# Current exposure model — widened fall-line rule

The current map uses `exposure-routes.geojson`. Earlier files are retained as
archived results, not mixed into the current route layer.

The objective remains distance on terrain steeper than 15°, with distance and
maximum-grade trade-offs shown separately. Above a 10° terrain slope `s`, the
heading allowance is now **90 − 3 × s degrees**, relative to either uphill or
downhill fall line. It gives ±60° at 10°, ±45° at 15°, ±30° at 20° and ±15° at
25°. All current tracks were recomputed and independently validated against
this widened rule. Terrain below 10° has no heading constraint.

Days 1–5 retain the 18 km preference and 25 km maximum. Tjønnebu return
alternatives may extend to 35 km. The six-day plan still visits Veltdalshytta;
the separate sub-20° alternatives now end at **Torsbu**, as requested.

## Veltdalshytta-bound day 1

| Option | Distance | Distance above 15° | Maximum terrain slope |
| --- | ---: | ---: | ---: |
| A | 16.97 km | 1,773 m | 29.7° |
| B | 17.26 km | 1,796 m | 24.9° |
| C | 20.09 km | 1,173 m | 24.9° |
| D | 21.59 km | 470 m | 28.5° |
| E | 23.57 km | 1,034 m | 23.5° |

D initially selects the least exposure found among these daily candidates.
A and C are shown for comparison. Choices update the selected-plan GPX and
all subsequent kilometre-opacity phases. Comparisons are not extra trip legs.

## Sub-20° overnight alternatives to Torsbu

- T: Danskehytta → Torsbu, **26.96 km**, **2,228 m above 15°**, maximum **19.95°**.
- U: same endpoints, **32.70 km**, **211 m above 15°**, maximum **19.04°**.

Both are genuine sub-20° terrain candidates under the new heading rule, but
both exceed the unchanged 25 km day limit. They are shown as different-night
alternatives and have separate GPX downloads. They cannot silently introduce
a discontinuity into the selected six-day GPX. The shorter T option is visible
by default. No qualifying Torsbu-bound path inside the 25 km reachable domain
was found in this discrete search; this is not a proof about every continuous
field route. The 27 km and 33 km searches use the larger domain.

## Additional direct links

The following are separate overlays/GPX files, not an automatic reordering of
all overnight stops. VP variants connect Veltdalshytta directly to Pyttbua,
without requiring an overnight at Torsbu.

| Link | Distance | Distance above 15° | Maximum terrain slope |
| --- | ---: | ---: | ---: |
| VP: Veltdalshytta → Pyttbua | 11.28 km | 27 m | 15.3° |
| VPm: Veltdalshytta → Pyttbua | 10.30 km | 75 m | 15.5° |
| VPs: Veltdalshytta → Pyttbua | 7.29 km | 2,241 m | 28.0° |
| VJ: Vakkerstøylen → Jervebua | 4.49 km | 0 m | 14.9° |
| JM: Jervebua → Mebua | 24.76 km | 0 m | 15.0° |
| JMc: Jervebua → Mebua | 17.16 km | 1,549 m | 20.0° |
| JMm: Jervebua → Mebua | 11.15 km | 622 m | 29.2° |
| JMs: Jervebua → Mebua | 8.69 km | 2,163 m | 28.6° |

Jervebua coordinates are 62.30769 N, 7.81791 E, as listed by
[iLende](https://www.ilende.no/hytte/jervebua). Mebua uses the UTM zone 32N
position 441454, 6910765 from
[Peakbook](https://peakbook.org/en/peakbook-element/66605/en/Mebua.html),
which agrees within about ten metres with
[iLende](https://ilende.app/en/hut/mebua). These identify the huts by
Vesle Hånådalsvatnet and Midtbottvatnet, respectively.

VP, VJ and JMc are initially shown. Other options can be enabled separately.
The VJ/JM branch's kilometre count continues through Jervebua. For a direct
VP comparison, chainage begins at the selected main plan's Veltdalshytta stop.

## Return alternatives

Current return alternatives are recomputed too. F is the lower-valley
variation (12.89 km, about 13 m above 15°, maximum 15.5°). G is a more substantial
upper-valley detour (18.05 km, about 1,424 m above 15°, maximum 29.5°).
They retain explicit 500 m local exclusion gates to create variety and share
parts of the ordinary corridor. R still retraces the selected outbound track.
The 35 km allowance is a ceiling, not a target length.

## Algorithm, accuracy and validation

Input DEM and original hut coordinates are described in README.md. Ground
pixels are about 8.9 m. Central differences supply full terrain-gradient
magnitude and aspect, independent of the uphill/downhill track grade.

The direction-aware graph uses 176 primitive travel directions (radius eight
cells). Straight segments are clipped exactly against raster squares. Each
positive-length intersection contributes to the above-15° exposure and must
satisfy its own local fall-line allowance. Zero-length corner contacts add no
exposure; touched cells still satisfy the chosen terrain cap. Distances use
latitude-corrected ground spacing. A shorter stencil is used in all-flat
neighborhoods. This work is offline; the render loop only draws geometry.

A family of paths minimizes `distance_above_15 + lambda * total_distance`,
with several terrain caps and lambda values. Length-ineligible outputs are
excluded from daily selections. These are supported candidate trade-offs,
**not certified global resource-constrained optima**. The fixed search grid,
DEM/source resolution and snow-free terrain model limit physical accuracy.

Independent Python integration checks every exported positive-length
segment/cell intersection using `deviation <= 90 - 3*slope` above 10°. This
covers all main, comparison, Torsbu and added-link options. Coordinates retain
double precision so rounding does not alter tight heading margins. Analytic
plane tests include headings accepted by the widened rule and rejected
outside it. No snow, ice, avalanche, bridge or obstacle model was added.

## Reproduce

Download and build the working rasters as in README.md, then:

```sh
c++ -O3 -o /tmp/tafjord-analysis/exposure tools/ski-trek/exposure.cpp
python3 tests/exposure-routing.py /tmp/tafjord-analysis/exposure
python3 tools/ski-trek/search-exposure.py /tmp/tafjord-analysis
python3 tools/ski-trek/export-exposure.py /tmp/tafjord-analysis data/ski-trek
```

The GPX controls generate the selected main plan. Standalone Torsbu and
additional-link downloads keep those variants separate. Earlier strict-rule
GPX files remain historical artifacts and are not linked by the current UI.
