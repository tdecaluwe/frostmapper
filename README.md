# Frostmapper

A static OpenLayers topographic map. Serve this directory with any static web server, for example `python3 -m http.server`, and open localhost:8000. ES modules and map tiles require network access. No build step is required.

The `src/map` directory separates layers, controls, view state, and projection code. `docs` records data sources and design decisions. GitHub Pages deploys the repository root through the included workflow.
