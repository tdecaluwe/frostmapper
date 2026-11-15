# Frostmapper

A static OpenLayers topographic map. Serve this directory with any static web server, for example `python3 -m http.server`, and open localhost:8000. ES modules and map tiles require network access. No build step is required.

The `src/map` directory separates layers, controls, view state, and projection code. `docs` records data sources and design decisions. GitHub Pages serves the repository root directly from the main branch.

The map uses CDN-hosted OpenLayers and proj4js modules. The URL stores latitude, longitude and zoom as `?loc=@latitude,longitude,zoomz`; rotation and projection are stored in the browser. See [data notes](docs/data.md) for attribution and coverage.
