# Logical reprojection steps

`StepTileGrid` assigns `steps` logical levels to each physical target tile
resolution (four by default). Levels 0–3 have the same geometry; 4–7 use half
the map units per pixel. Its level selector advances on the continuous view
resolution, independently of panning. Provider grids retain ordinary zooms.

The phase within a group adds 0, 1/4, 1/2 or 3/4 to the supervisor's source
zoom reference. Each band rounds the combined reference minus its distortion
correction, so intermediate steps can change source imagery without changing
target extent or canvas size.

`StepTilePool` compares candidates within one physical tile, pixel ratio,
projection and source revision. Sharing requires the same requested source
zoom and stitch resolution, and an exact match of ordered source dependencies,
wrap offsets, effective source-zoom spans, initial loading zoom and native
parent identities. This intentionally permits false negatives (extra renders),
but never shares on matching min/max zoom alone. Pending plans continue to use
the existing ordinary reprojection fallback.

`StepTile` forwards image, state and change events from the shared payload.
OL retains its standard integer coordinate cache keys and fallback behavior.
Shells own reference counts; evicting the last shell releases the payload.
Dependency comparisons store numeric native identities, not extra references
to decoded images. The existing OL LRU governs shell eviction; byte budgets
and custom eviction priorities are not introduced by this change.

The grid adapter touches OL 10.6.1's private resolution array, zoom factor and
range calculation because the stock constructor rejects equal resolutions.
The integration test covers repeated extents, range lookup, logical selection,
mask differences, sharing, change forwarding, release order, and actual OL
canvas reprojection. Recheck this adapter when upgrading OpenLayers.
