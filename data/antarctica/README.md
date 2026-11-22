# Antarctic relief basemap

The Antarctica layer uses the public British Antarctic Survey raster tile service:

- [Dataset and attribution](https://data.bas.ac.uk/maps/5001)
- [Service metadata](https://tiles.arcgis.com/tiles/tPxy1hrFDhJfZ0Mf/arcgis/rest/services/Antarctica_and_the_Southern_Ocean/MapServer?f=pjson)
- Tile URL: `…/MapServer/tile/{z}/{y}/{x}`
- Projection: WGS 84 Antarctic Polar Stereographic, EPSG:3031
- Native origin: `[-30635955.4472718, 30635955.4472718]`
- Resolution zero: `239343.40193181095` m/pixel, halved at each level
- Tile size: 256 pixels; published cache limit: level 13
- Licence: Open Government Licence 3.0, with BAS attribution retained in the map

This is shaded surface relief, coastline and ocean bathymetry. It is not a
contour-line or labelled route-map overlay. BAS's newer composite basemap also
uses vector coastline services; this implementation deliberately uses their
complete public raster basemap within the approved application dependencies.
The NPI internal Antarctic service was not used because its published
service description requires permission.

The layer supports ordinary guarded raster reprojection, and a native
EPSG:3031 view covers the South Pole itself. The arrow alongside its layer
control switches to that view. The Web Mercator base is hidden in the native
polar view while the Antarctic layer is enabled, avoiding redundant Mercator
requests at the pole. Showing the trek returns to Web Mercator if necessary.
No Antarctic tiles are requested for the Norway viewport.

Checks cover pole transforms, native tile addressing, level limits,
out-of-coverage rejection, real browser tile loading at the pole, and return
to the Norway trek. Application projection registries and workers register
3031 consistently; only tile grids using this service use its native grid.
