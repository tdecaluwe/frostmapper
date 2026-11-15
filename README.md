# Frostmapper

A static OpenLayers topographic map. Serve this directory with any static web server, for example `python3 -m http.server`, and open localhost:8000. ES modules and map tiles require network access. No build step is required.

The `src/map` directory separates layers, controls, view state, and projection code. `docs` records data sources and design decisions. GitHub Pages serves the repository root directly from the main branch.

The map uses CDN-hosted OpenLayers and proj4js modules. The URL stores latitude, longitude and zoom as `?loc=@latitude,longitude,zoomz`; rotation and projection are stored in the browser. See [data notes](docs/data.md) for attribution and coverage.

The Peirce picker uses `+proj=peirce_q +lon_0=25 +shape=horizontal`. The registered proj4js extension accepts this horizontal shape with a central longitude; other named shapes are not yet supported. Open `tests/projections.html` on the local server to run the PROJ reference checks.

The Grieger Triptychial option uses the pipeline shown in the PROJ Peirce documentation. Frostmapper accepts `o_type` and `o_scrollx` as aliases for `shape` and `scrollx` in this subset, reproducing the documented horizontal layout. Current PROJ releases accept the original names but ignore them; to reproduce this layout in current PROJ, use `+shape=horizontal +scrollx=-0.25` in the oblique step.

proj4js flattens repeated pipeline tokens, so register raw pipeline strings with `definePipeline(proj4, code, definition)` before passing the resulting named code to proj4js. The supported subset is a pipeline with an oblique Peirce horizontal step defined by `o_lat_p` and `o_lon_p`, and an affine step. This is not a general PROJ pipeline parser.
