# Map and border sources

The base map is OpenTopoMap, using OpenStreetMap and SRTM data. The overlays use swisstopo, IGN Géoplateforme and Kartverket WMTS services. Availability, coverage, attribution and usage terms are controlled by those providers.

The Swiss and metropolitan French clip paths come from the supplied demo. Norway was extracted without simplification from the supplied World_Countries_Boundaries.geojson using its ISO2 fields (NO, SJ). French overseas regions are not included. The source attributes credit WHO and Fondation Jean-Jacques Laffont - Toulouse Sciences Economiques. Borders are approximate and should not be treated as authoritative. 

Peirce's approximation and affine/pipeline helpers were adapted from the supplied demo. The Grieger projection is deferred pending a verified oblique transformation and comparison with reference results.
