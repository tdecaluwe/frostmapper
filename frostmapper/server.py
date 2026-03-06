"""
Flask HTTP server for frostmapper.

Start with:
    python -m frostmapper.server

Then open http://localhost:5000 in your browser.

API endpoints
-------------
GET /
    Serves the index.html visualisation page.

GET /api/terrain-steepness
    Query parameters:
        west, south, east, north  – bounding box (degrees, default: Norway)
        resolution                – grid spacing in degrees (default 0.1)

GET /api/snow-depth/mean
GET /api/snow-depth/median
    Query parameters:
        west, south, east, north  – bounding box (default: Norway)
        resolution                – grid spacing in degrees (default 0.1)
        month                     – calendar month 1–12 (default 1)
        day                       – calendar day 1–31 (default 15)
        years                     – comma-separated years (default last 5 years)
"""

from __future__ import annotations

import logging
import os
from datetime import date
from pathlib import Path

import numpy as np
from flask import Flask, jsonify, request, send_file

from frostmapper import datasets, parameters

logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder=None)

# Directory that contains index.html (one level above this package)
_ROOT_DIR = Path(__file__).resolve().parent.parent

# Default bounding box: mainland Norway + Scandinavia
_DEFAULT_BBOX = dict(west=4.0, south=57.0, east=32.0, north=72.0)

# Default years for snow-depth statistics (last 5 complete years)
_CURRENT_YEAR = date.today().year
_DEFAULT_YEARS = list(range(_CURRENT_YEAR - 5, _CURRENT_YEAR))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_bbox() -> dict:
    """Parse bounding-box query parameters with sensible defaults."""
    return {
        "west": float(request.args.get("west", _DEFAULT_BBOX["west"])),
        "south": float(request.args.get("south", _DEFAULT_BBOX["south"])),
        "east": float(request.args.get("east", _DEFAULT_BBOX["east"])),
        "north": float(request.args.get("north", _DEFAULT_BBOX["north"])),
    }


def _parse_resolution() -> float:
    return float(request.args.get("resolution", 0.1))


def _grid_to_response(grid: np.ndarray, lats: np.ndarray, lons: np.ndarray, **meta) -> dict:
    """Serialise a 2-D numpy grid to a JSON-serialisable dict."""
    # Replace NaN with None for clean JSON serialisation
    data = [
        [None if np.isnan(v) else round(float(v), 3) for v in row]
        for row in grid
    ]
    payload = {
        "bounds": {
            "north": float(lats[-1]),
            "south": float(lats[0]),
            "east": float(lons[-1]),
            "west": float(lons[0]),
        },
        "grid": {
            "rows": int(grid.shape[0]),
            "cols": int(grid.shape[1]),
            "lat_step": round(float(lats[1] - lats[0]), 6) if len(lats) > 1 else 0.0,
            "lon_step": round(float(lons[1] - lons[0]), 6) if len(lons) > 1 else 0.0,
            "data": data,
        },
    }
    payload.update(meta)
    return payload


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/")
def index():
    """Serve the HTML visualisation page."""
    html_path = _ROOT_DIR / "index.html"
    if not html_path.exists():
        return "index.html not found", 404
    return send_file(html_path, mimetype="text/html")


@app.get("/api/terrain-steepness")
def terrain_steepness():
    """Return a gridded terrain slope (degrees) for the requested bounding box.

    The elevation data is sourced from a synthetic DEM for large grids, or
    from the OpenTopoData SRTM API for small grids (≤ 1 000 cells).

    Response JSON keys
    ------------------
    bounds      – {north, south, east, west}
    grid        – {rows, cols, lat_step, lon_step, data}  (degrees 0–90)
    unit        – "degrees"
    description – human-readable label
    """
    try:
        bbox = _parse_bbox()
        resolution = _parse_resolution()

        elevation, lats, lons = datasets.fetch_elevation_grid(
            west=bbox["west"],
            south=bbox["south"],
            east=bbox["east"],
            north=bbox["north"],
            resolution=resolution,
        )

        # Approximate horizontal cell size (metres) at the grid centre latitude
        centre_lat = (bbox["south"] + bbox["north"]) / 2.0
        cell_size_m = resolution * 111_000 * np.cos(np.radians(centre_lat))

        slope = parameters.compute_terrain_steepness(elevation, cell_size_m=cell_size_m)

        return jsonify(
            _grid_to_response(
                slope,
                lats,
                lons,
                unit="degrees",
                description="Terrain steepness (slope) in degrees",
            )
        )
    except Exception as exc:
        logger.exception("Error in /api/terrain-steepness")
        return jsonify({"error": str(exc)}), 500


def _snow_depth_response(stat: str):
    """Shared logic for mean / median snow-depth endpoints."""
    bbox = _parse_bbox()
    resolution = _parse_resolution()
    month = int(request.args.get("month", 1))
    day = int(request.args.get("day", 15))

    years_param = request.args.get("years")
    if years_param:
        years = [int(y.strip()) for y in years_param.split(",") if y.strip()]
    else:
        years = _DEFAULT_YEARS

    snow_fields = []
    errors = []
    for year in years:
        try:
            sd, lats, lons = datasets.fetch_senorge_snow_depth(
                year, month, day, bbox=bbox
            )
            # Resample to requested resolution if much coarser
            snow_fields.append(sd)
        except Exception as exc:
            logger.warning("Could not fetch seNorge data for %d-%02d-%02d: %s", year, month, day, exc)
            errors.append(f"{year}: {exc}")

    if not snow_fields:
        return jsonify(
            {
                "error": "Could not fetch seNorge data for any of the requested years.",
                "details": errors,
            }
        ), 502

    if stat == "mean":
        result = parameters.compute_mean_snow_depth(snow_fields)
        description = f"Mean snow depth for {month:02d}-{day:02d} across {len(snow_fields)} year(s)"
    else:
        result = parameters.compute_median_snow_depth(snow_fields)
        description = f"Median snow depth for {month:02d}-{day:02d} across {len(snow_fields)} year(s)"

    # Use lats/lons from the last successful fetch
    return jsonify(
        _grid_to_response(
            result,
            lats,
            lons,
            unit="mm",
            description=description,
            years=years,
            month=month,
            day=day,
            fetch_errors=errors if errors else None,
        )
    )


@app.get("/api/snow-depth/mean")
def snow_depth_mean():
    """Return mean snow depth for a given calendar day across multiple years."""
    try:
        return _snow_depth_response("mean")
    except Exception as exc:
        logger.exception("Error in /api/snow-depth/mean")
        return jsonify({"error": str(exc)}), 500


@app.get("/api/snow-depth/median")
def snow_depth_median():
    """Return median snow depth for a given calendar day across multiple years."""
    try:
        return _snow_depth_response("median")
    except Exception as exc:
        logger.exception("Error in /api/snow-depth/median")
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main():
    logging.basicConfig(level=logging.INFO)
    port = int(os.environ.get("PORT", 5000))
    logger.info("Starting frostmapper server on http://localhost:%d", port)
    app.run(host="0.0.0.0", port=port, debug=False)


if __name__ == "__main__":
    main()
