# frostmapper

A Python application for answering geographical queries about Norway and
Scandinavia, similar to the [seNorge](https://www.senorge.no/) website but for
custom-computed parameters.

## Features

Compute and visualise the following parameters on an interactive map:

| Parameter | Description |
|---|---|
| **Terrain steepness** | Slope in degrees derived from a Digital Elevation Model |
| **Mean snow depth** | Average snow depth across years for a given calendar day |
| **Median snow depth** | Median snow depth across years for a given calendar day |

## Freely accessible datasets

| Dataset | URL | What it provides |
|---|---|---|
| **MET Norway Frost API** | <https://frost.met.no/> | Historical point observations (snow depth, temperature, precipitation, …) for all Norwegian weather stations. Free with registration. |
| **seNorge / MET Norway THREDDS** | <https://thredds.met.no/thredds/catalog/senorge/> | Gridded daily climate fields over Norway (snow depth, SWE, temperature, precipitation, …) at 1 km resolution, back to 1957. Publicly accessible via OPeNDAP. |
| **Copernicus DEM GLO-30** | <https://registry.opendata.aws/copernicus-dem/> | 30 m global Digital Elevation Model; tiles available as Cloud-Optimised GeoTIFFs on AWS S3 with no authentication required. |
| **SRTM 90 m** | <https://srtm.csi.cgiar.org/> | Shuttle Radar Topography Mission 90 m elevation tiles, freely downloadable. |

## Installation

```bash
pip install -r requirements.txt
```

A free **Frost API client ID** is required to fetch point observations.
Register at <https://frost.met.no/auth/requestCredentials.html> and export the
credential:

```bash
export FROST_CLIENT_ID=your_client_id_here
```

## Usage

Start the HTTP server:

```bash
python -m frostmapper.server
```

Then open <http://localhost:5000> in your browser to access the interactive map.

### API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | HTML visualisation page |
| `GET` | `/api/terrain-steepness` | Terrain slope grid for a bounding box |
| `GET` | `/api/snow-depth/mean` | Multi-year mean snow depth for a calendar day |
| `GET` | `/api/snow-depth/median` | Multi-year median snow depth for a calendar day |

#### Common query parameters

| Parameter | Default | Description |
|---|---|---|
| `west` | `4.0` | Western boundary (decimal degrees) |
| `south` | `57.0` | Southern boundary (decimal degrees) |
| `east` | `32.0` | Eastern boundary (decimal degrees) |
| `north` | `72.0` | Northern boundary (decimal degrees) |
| `resolution` | `0.1` | Grid cell size in degrees |

#### Snow-depth specific parameters

| Parameter | Example | Description |
|---|---|---|
| `month` | `1` | Calendar month (1–12) |
| `day` | `15` | Calendar day (1–31) |
| `years` | `2015,2016,2017,2018,2019` | Comma-separated list of years to aggregate |

### Python API

```python
from frostmapper import datasets, parameters

# Fetch a gridded snow-depth field from seNorge THREDDS
sd_2023, lats, lons = datasets.fetch_senorge_snow_depth(2023, 1, 15)

# Compute multi-year mean for 15 January
snow_fields = [datasets.fetch_senorge_snow_depth(y, 1, 15)[0] for y in range(2018, 2023)]
mean_sd = parameters.compute_mean_snow_depth(snow_fields)

# Fetch a DEM tile and compute terrain steepness
elevation, lats, lons = datasets.fetch_elevation_grid(west=4, south=57, east=32, north=72, resolution=0.1)
slope_deg = parameters.compute_terrain_steepness(elevation, cell_size_m=10_000)
```

## Project layout

```
frostmapper/
├── frostmapper/
│   ├── __init__.py      package init
│   ├── datasets.py      data fetching (Frost API, seNorge, Copernicus DEM)
│   ├── parameters.py    parameter computation (steepness, snow stats)
│   └── server.py        Flask HTTP API + static file serving
├── index.html           interactive Leaflet.js map
├── tests/
│   ├── __init__.py
│   └── test_parameters.py
└── requirements.txt
```
