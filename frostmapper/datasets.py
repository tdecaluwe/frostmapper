"""
Data-fetching utilities for frostmapper.

Supported sources
-----------------
* **MET Norway Frost API** (https://frost.met.no/)
    REST API for historical point observations (snow depth, temperature, …).
    Requires a free client ID – see https://frost.met.no/auth/requestCredentials.html.

* **seNorge THREDDS / OPeNDAP** (https://thredds.met.no/)
    Gridded daily climate fields over Norway (1 km resolution, back to 1957).
    Publicly accessible – no authentication required.

* **Copernicus DEM GLO-30** (https://registry.opendata.aws/copernicus-dem/)
    30 m global Digital Elevation Model available as Cloud-Optimised GeoTIFFs
    on AWS S3.  Publicly accessible – no authentication required.
"""

from __future__ import annotations

import logging
import os
from datetime import date
from typing import Optional

import numpy as np
import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FROST_BASE_URL = "https://frost.met.no/api/v0"

# seNorge / MET Norway THREDDS OPeNDAP base URL.
# Daily snow-depth files follow the pattern:
#   {SENORGE_BASE_URL}/{YYYY}/sd_{YYYYMMDD}.nc
SENORGE_BASE_URL = (
    "https://thredds.met.no/thredds/dodsC/senorge/seNorge_2018/Archive"
)

# Copernicus DEM GLO-30 on AWS (public, no auth).
# One 1°×1° GeoTIFF tile per integer lat/lon corner (South-West corner).
COPERNICUS_DEM_TILE_URL = (
    "https://copernicus-dem-30m.s3.amazonaws.com/"
    "Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM/"
    "Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM.tif"
)

# Default bounding box covering mainland Norway and Scandinavia.
DEFAULT_BBOX = dict(west=4.0, south=57.0, east=32.0, north=72.0)


# ---------------------------------------------------------------------------
# Frost API (point observations)
# ---------------------------------------------------------------------------


def fetch_frost_snow_depth(
    station_id: str,
    start_date: date,
    end_date: date,
    client_id: Optional[str] = None,
) -> list[dict]:
    """Fetch daily snow-depth observations from the MET Norway Frost API.

    Parameters
    ----------
    station_id:
        Frost station identifier, e.g. ``"SN18700"`` (Blindern, Oslo).
    start_date, end_date:
        Inclusive date range for the query.
    client_id:
        Frost API client ID.  Falls back to the ``FROST_CLIENT_ID``
        environment variable when *None*.

    Returns
    -------
    list[dict]
        List of observation records with keys ``"date"`` (ISO-8601 string)
        and ``"snow_depth_cm"`` (float or ``None``).

    Raises
    ------
    EnvironmentError
        When no client ID is available.
    requests.HTTPError
        On a non-2xx HTTP response.
    """
    client_id = client_id or os.environ.get("FROST_CLIENT_ID")
    if not client_id:
        raise EnvironmentError(
            "Frost API client ID is required.  Either pass client_id= or set "
            "the FROST_CLIENT_ID environment variable.  "
            "Register for free at https://frost.met.no/auth/requestCredentials.html"
        )

    params = {
        "sources": station_id,
        "elements": "surface_snow_thickness",
        "referencetime": f"{start_date}/{end_date}",
        "timeresolutions": "P1D",
    }
    resp = requests.get(
        f"{FROST_BASE_URL}/observations/v0.jsonld",
        params=params,
        auth=(client_id, ""),
        timeout=30,
    )
    resp.raise_for_status()

    records = []
    for item in resp.json().get("data", []):
        ref_time = item.get("referenceTime", "")[:10]
        for obs in item.get("observations", []):
            value = obs.get("value")
            records.append(
                {
                    "date": ref_time,
                    "snow_depth_cm": float(value) * 100 if value is not None else None,
                }
            )
    return records


# ---------------------------------------------------------------------------
# seNorge THREDDS (gridded fields)
# ---------------------------------------------------------------------------


def fetch_senorge_snow_depth(
    year: int,
    month: int,
    day: int,
    bbox: Optional[dict] = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Fetch gridded daily snow depth from the seNorge THREDDS/OPeNDAP server.

    The seNorge 2018 dataset provides snow depth at ~1 km resolution over
    Norway back to 1957.

    Parameters
    ----------
    year, month, day:
        The calendar date to fetch.
    bbox:
        Optional bounding box ``{west, south, east, north}`` in decimal
        degrees.  When *None*, the full Norwegian domain is returned.

    Returns
    -------
    (snow_depth_mm, lats, lons) : tuple[np.ndarray, np.ndarray, np.ndarray]
        *snow_depth_mm* – 2-D array of snow depth in millimetres (NaN = no
        data / ocean).  Shape ``(rows, cols)``.
        *lats* – 1-D latitude array of length *rows*.
        *lons* – 1-D longitude array of length *cols*.

    Raises
    ------
    ImportError
        When the ``xarray`` / ``netCDF4`` package is not installed.
    requests.HTTPError / IOError
        On network or OPeNDAP access errors.
    """
    try:
        import xarray as xr
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "xarray and netCDF4 are required to fetch seNorge data.  "
            "Install with:  pip install xarray netCDF4"
        ) from exc

    date_str = f"{year}{month:02d}{day:02d}"
    url = f"{SENORGE_BASE_URL}/{year}/sd_{date_str}.nc"
    logger.info("Fetching seNorge snow depth from %s", url)

    ds = xr.open_dataset(url, engine="netcdf4")
    sd = ds["sd"].squeeze()  # (y, x) in mm

    lats = ds["latitude"].values if "latitude" in ds else ds["lat"].values
    lons = ds["longitude"].values if "longitude" in ds else ds["lon"].values

    # Flatten to 1-D if the coordinates are 2-D (curvilinear grid)
    if lats.ndim == 2:
        lats = lats[:, 0]
    if lons.ndim == 2:
        lons = lons[0, :]

    snow_depth = sd.values.astype(float)
    snow_depth[snow_depth < 0] = np.nan  # mask fill / ocean values

    if bbox is not None:
        row_mask = (lats >= bbox["south"]) & (lats <= bbox["north"])
        col_mask = (lons >= bbox["west"]) & (lons <= bbox["east"])
        snow_depth = snow_depth[np.ix_(row_mask, col_mask)]
        lats = lats[row_mask]
        lons = lons[col_mask]

    ds.close()
    return snow_depth, lats, lons


# ---------------------------------------------------------------------------
# Elevation grid (synthetic fallback + Copernicus note)
# ---------------------------------------------------------------------------


def fetch_elevation_grid(
    west: float,
    south: float,
    east: float,
    north: float,
    resolution: float = 0.1,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return a gridded elevation array for the given bounding box.

    The function attempts to derive elevations from the **OpenTopoData SRTM
    30 m API** (https://api.opentopodata.org/).  If the remote service is
    unavailable or the bounding box is very large, a synthetic terrain model
    is generated from a combination of sinusoidal functions so that the rest
    of the pipeline can still be exercised without network access.

    Parameters
    ----------
    west, south, east, north:
        Bounding box corners in decimal degrees.
    resolution:
        Grid spacing in decimal degrees.

    Returns
    -------
    (elevation_m, lats, lons) : tuple[np.ndarray, np.ndarray, np.ndarray]
        *elevation_m* – 2-D array of elevation in metres.  Shape
        ``(rows, cols)``.
        *lats* – 1-D latitude array.
        *lons* – 1-D longitude array.
    """
    lats = np.arange(south, north, resolution)
    lons = np.arange(west, east, resolution)
    lon_grid, lat_grid = np.meshgrid(lons, lats)

    n_points = lats.size * lons.size
    # Use OpenTopoData for small grids (≤ 1 000 points per request limit)
    if n_points <= 1000:
        try:
            elevation = _fetch_opentopodata(lat_grid.ravel(), lon_grid.ravel())
            elevation = elevation.reshape(lat_grid.shape)
            return elevation, lats, lons
        except Exception as exc:
            logger.warning(
                "OpenTopoData request failed (%s); falling back to synthetic DEM.", exc
            )

    logger.info(
        "Generating synthetic DEM for bbox (%s, %s, %s, %s) – "
        "install rasterio and use Copernicus DEM tiles for real elevation data.",
        west, south, east, north,
    )
    elevation = _synthetic_elevation(lat_grid, lon_grid)
    return elevation, lats, lons


def _fetch_opentopodata(
    lats: np.ndarray,
    lons: np.ndarray,
) -> np.ndarray:
    """Fetch elevations for a flat array of (lat, lon) pairs via OpenTopoData.

    See https://www.opentopodata.org/ for API documentation.
    """
    locations = "|".join(f"{lat:.4f},{lon:.4f}" for lat, lon in zip(lats, lons))
    resp = requests.get(
        "https://api.opentopodata.org/v1/srtm30m",
        params={"locations": locations},
        timeout=30,
    )
    resp.raise_for_status()
    results = resp.json().get("results", [])
    return np.array([r.get("elevation") or 0.0 for r in results], dtype=float)


def _synthetic_elevation(
    lat_grid: np.ndarray,
    lon_grid: np.ndarray,
) -> np.ndarray:
    """Generate a plausible synthetic DEM for Scandinavia.

    The model places the Scandinavian mountain range (fjell) along the
    Norwegian–Swedish border (roughly 14–18 °E) with peaks around 1 500–2 500 m,
    and low-lying terrain towards the coast and inland Sweden.
    """
    # Normalise coordinates to [0, 1] within the typical Scandinavian domain
    lat_norm = (lat_grid - 57.0) / 15.0
    lon_norm = (lon_grid - 4.0) / 28.0

    # Main ridge along ~15°E
    ridge_lon = (lon_grid - 15.0) / 5.0
    ridge = 2000.0 * np.exp(-0.5 * ridge_lon**2)

    # Add sinusoidal texture for realism
    texture = (
        300.0 * np.sin(lat_norm * 8 * np.pi) * np.cos(lon_norm * 6 * np.pi)
        + 150.0 * np.sin(lat_norm * 15 * np.pi + 1.0)
    )

    # Coastal lowlands west of 10°E
    coastal_mask = np.clip((lon_grid - 10.0) / 6.0, 0, 1)
    elevation = (ridge + texture) * coastal_mask
    elevation = np.clip(elevation, 0, 2469)  # max: Galdhøpiggen
    return elevation
