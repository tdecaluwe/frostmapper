"""
Parameter computation functions for frostmapper.

All functions operate on plain NumPy arrays and are independent of any
specific data source, making them straightforward to test and reuse.
"""

from __future__ import annotations

from typing import Sequence

import numpy as np


# ---------------------------------------------------------------------------
# Terrain steepness (slope)
# ---------------------------------------------------------------------------


def compute_terrain_steepness(
    elevation: np.ndarray,
    cell_size_m: float,
) -> np.ndarray:
    """Compute terrain steepness (slope) from a gridded elevation model.

    Uses the standard 8-neighbour finite-difference gradient (Horn 1981) to
    estimate the rate of elevation change in both the x- and y-directions,
    then converts the magnitude to degrees.

    Parameters
    ----------
    elevation:
        2-D array of elevation values in metres.  Shape ``(rows, cols)``.
        *NaN* values are handled gracefully and propagated to the output.
    cell_size_m:
        Horizontal distance between adjacent grid cells in metres.  For a
        regular geographic grid with spacing *d* degrees at latitude *lat*,
        a reasonable approximation is
        ``cell_size_m = d * 111_000 * cos(lat_rad)``.

    Returns
    -------
    np.ndarray
        2-D array of slope values in **degrees** (0° = flat, 90° = vertical).
        Same shape as *elevation*.

    Examples
    --------
    >>> import numpy as np
    >>> from frostmapper.parameters import compute_terrain_steepness
    >>> # A north-south ramp rising 1 000 m per 1 000 m → 45 °
    >>> elev = np.array([[0.0, 0.0, 0.0],
    ...                  [1000.0, 1000.0, 1000.0],
    ...                  [2000.0, 2000.0, 2000.0]])
    >>> slope = compute_terrain_steepness(elev, cell_size_m=1000)
    >>> slope[1, 1]   # interior of 45-degree ramp
    np.float64(45.0)
    """
    if elevation.ndim != 2:
        raise ValueError(
            f"elevation must be a 2-D array, got shape {elevation.shape}"
        )
    if cell_size_m <= 0:
        raise ValueError(f"cell_size_m must be positive, got {cell_size_m}")

    # numpy.gradient uses central differences (2*cell_size) at interior points
    # and one-sided differences at edges.
    dz_dy, dz_dx = np.gradient(elevation, cell_size_m)

    slope_rad = np.arctan(np.sqrt(dz_dx**2 + dz_dy**2))
    return np.degrees(slope_rad)


# ---------------------------------------------------------------------------
# Snow-depth statistics
# ---------------------------------------------------------------------------


def compute_mean_snow_depth(
    snow_fields: Sequence[np.ndarray],
) -> np.ndarray:
    """Compute the element-wise mean snow depth across multiple annual fields.

    Parameters
    ----------
    snow_fields:
        Sequence of 2-D arrays with the same shape, each representing snow
        depth (in any consistent unit, typically mm or cm) for the same
        calendar day in different years.  *NaN* values are ignored so that a
        missing year does not blank out grid cells that have valid data in
        other years.

    Returns
    -------
    np.ndarray
        2-D array of mean snow depth.  Cells that are *NaN* in **all** input
        fields remain *NaN* in the output.

    Raises
    ------
    ValueError
        When *snow_fields* is empty or the arrays have inconsistent shapes.

    Examples
    --------
    >>> import numpy as np
    >>> from frostmapper.parameters import compute_mean_snow_depth
    >>> a = np.array([[10.0, 20.0], [30.0, np.nan]])
    >>> b = np.array([[20.0, 40.0], [10.0, 50.0]])
    >>> compute_mean_snow_depth([a, b])
    array([[15., 30.],
           [20., 50.]])
    """
    stack = _validate_and_stack(snow_fields)
    return np.nanmean(stack, axis=0)


def compute_median_snow_depth(
    snow_fields: Sequence[np.ndarray],
) -> np.ndarray:
    """Compute the element-wise median snow depth across multiple annual fields.

    Parameters
    ----------
    snow_fields:
        Sequence of 2-D arrays with the same shape, each representing snow
        depth for the same calendar day in different years.  *NaN* values are
        ignored (``nanmedian`` semantics).

    Returns
    -------
    np.ndarray
        2-D array of median snow depth.

    Raises
    ------
    ValueError
        When *snow_fields* is empty or the arrays have inconsistent shapes.

    Examples
    --------
    >>> import numpy as np
    >>> from frostmapper.parameters import compute_median_snow_depth
    >>> arrays = [np.full((2, 2), v, dtype=float) for v in [10, 30, 20]]
    >>> compute_median_snow_depth(arrays)
    array([[20., 20.],
           [20., 20.]])
    """
    stack = _validate_and_stack(snow_fields)
    return np.nanmedian(stack, axis=0)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _validate_and_stack(snow_fields: Sequence[np.ndarray]) -> np.ndarray:
    """Validate inputs and return a 3-D stack (years × rows × cols)."""
    if len(snow_fields) == 0:
        raise ValueError("snow_fields must contain at least one array")

    arrays = [np.asarray(f, dtype=float) for f in snow_fields]
    shape = arrays[0].shape
    for i, arr in enumerate(arrays[1:], start=1):
        if arr.shape != shape:
            raise ValueError(
                f"All snow fields must have the same shape.  "
                f"Field 0 has shape {shape}, field {i} has shape {arr.shape}."
            )
    return np.stack(arrays, axis=0)
