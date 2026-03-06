"""Unit tests for frostmapper.parameters."""

import math
import numpy as np
import pytest

from frostmapper.parameters import (
    compute_terrain_steepness,
    compute_mean_snow_depth,
    compute_median_snow_depth,
    _validate_and_stack,
)


# ---------------------------------------------------------------------------
# compute_terrain_steepness
# ---------------------------------------------------------------------------

class TestComputeTerrainSteepness:
    def test_flat_surface_gives_zero_slope(self):
        """A uniform elevation surface has zero slope everywhere."""
        elevation = np.full((5, 5), 500.0)
        slope = compute_terrain_steepness(elevation, cell_size_m=1000.0)
        np.testing.assert_allclose(slope, 0.0, atol=1e-10)

    def test_known_slope(self):
        """A 1:1 rise/run (45 °) should be returned as 45 degrees."""
        # Build a ramp: each column increases by cell_size_m metres
        cell = 1000.0
        cols = 10
        rows = 5
        ramp = np.tile(np.arange(cols, dtype=float) * cell, (rows, 1))
        slope = compute_terrain_steepness(ramp, cell_size_m=cell)
        # Interior points should be ~45 °
        np.testing.assert_allclose(slope[:, 1:-1], 45.0, atol=0.1)

    def test_slope_is_nonnegative(self):
        """Slope values should never be negative."""
        rng = np.random.default_rng(42)
        elevation = rng.uniform(0, 2000, size=(20, 20))
        slope = compute_terrain_steepness(elevation, cell_size_m=500.0)
        assert np.all(slope >= 0)

    def test_slope_does_not_exceed_90(self):
        """Physical terrain slope cannot exceed 90 degrees."""
        rng = np.random.default_rng(0)
        elevation = rng.uniform(0, 2000, size=(30, 30))
        slope = compute_terrain_steepness(elevation, cell_size_m=30.0)
        assert np.all(slope <= 90.0)

    def test_nan_propagation(self):
        """NaN elevation cells cause NaN slope in neighbouring cells.

        ``np.gradient`` uses central differences: the gradient *at* a NaN cell
        is computed using its neighbours (so the NaN cell itself may not be NaN
        in the output).  However, the cells whose central-difference window
        *includes* the NaN cell will have NaN slope.
        """
        elevation = np.ones((5, 5)) * 100.0
        elevation[2, 2] = np.nan
        slope = compute_terrain_steepness(elevation, cell_size_m=1000.0)
        # Cells whose gradient computation uses elev[2,2] must propagate NaN
        assert np.isnan(slope[2, 1]) or np.isnan(slope[2, 3]) or np.isnan(slope[1, 2]) or np.isnan(slope[3, 2])

    def test_raises_on_1d_input(self):
        """1-D input should raise ValueError."""
        with pytest.raises(ValueError, match="2-D"):
            compute_terrain_steepness(np.arange(10, dtype=float), cell_size_m=100.0)

    def test_raises_on_non_positive_cell_size(self):
        """Non-positive cell_size_m should raise ValueError."""
        elev = np.ones((3, 3))
        with pytest.raises(ValueError, match="positive"):
            compute_terrain_steepness(elev, cell_size_m=0.0)
        with pytest.raises(ValueError, match="positive"):
            compute_terrain_steepness(elev, cell_size_m=-50.0)

    def test_output_shape_matches_input(self):
        """Output shape must equal input shape."""
        elevation = np.random.rand(12, 17) * 1000
        slope = compute_terrain_steepness(elevation, cell_size_m=250.0)
        assert slope.shape == elevation.shape

    def test_steep_centre_cell(self):
        """A single high-elevation cell surrounded by zeros creates steep slopes.

        The gradient at the peak *itself* is 0 (symmetric central difference),
        but the immediate neighbours have non-zero slope because their
        central-difference window spans across the peak.
        """
        elev = np.zeros((5, 5))
        elev[2, 2] = 1000.0
        slope = compute_terrain_steepness(elev, cell_size_m=1000.0)
        # Immediate neighbours of the peak should have measurable slope
        assert slope[2, 1] > 0 or slope[2, 3] > 0 or slope[1, 2] > 0 or slope[3, 2] > 0

    def test_docstring_example(self):
        """The example from the docstring should produce 45 degrees."""
        elev = np.array([[0.0, 0.0, 0.0],
                         [1000.0, 1000.0, 1000.0],
                         [2000.0, 2000.0, 2000.0]])
        slope = compute_terrain_steepness(elev, cell_size_m=1000)
        assert math.isclose(slope[1, 1], 45.0, rel_tol=1e-6)


# ---------------------------------------------------------------------------
# compute_mean_snow_depth
# ---------------------------------------------------------------------------

class TestComputeMeanSnowDepth:
    def test_simple_average(self):
        """Mean of identical arrays equals the arrays themselves."""
        a = np.array([[10.0, 20.0], [30.0, 40.0]])
        result = compute_mean_snow_depth([a, a])
        np.testing.assert_array_equal(result, a)

    def test_average_two_fields(self):
        """Mean of two differing fields is computed element-wise."""
        a = np.array([[0.0, 100.0]])
        b = np.array([[50.0, 50.0]])
        result = compute_mean_snow_depth([a, b])
        np.testing.assert_array_equal(result, [[25.0, 75.0]])

    def test_nan_ignored(self):
        """NaN values are skipped (nanmean semantics)."""
        a = np.array([[10.0, 20.0], [30.0, np.nan]])
        b = np.array([[20.0, 40.0], [10.0, 50.0]])
        result = compute_mean_snow_depth([a, b])
        np.testing.assert_array_equal(result, [[15.0, 30.0], [20.0, 50.0]])

    def test_all_nan_remains_nan(self):
        """Cells that are NaN in all fields remain NaN."""
        a = np.array([[np.nan, 10.0]])
        b = np.array([[np.nan, 20.0]])
        result = compute_mean_snow_depth([a, b])
        assert np.isnan(result[0, 0])
        assert not np.isnan(result[0, 1])

    def test_single_field(self):
        """Mean of a single field equals that field."""
        a = np.array([[5.0, 15.0], [25.0, 35.0]])
        result = compute_mean_snow_depth([a])
        np.testing.assert_array_equal(result, a)

    def test_empty_raises(self):
        with pytest.raises(ValueError, match="at least one"):
            compute_mean_snow_depth([])

    def test_shape_mismatch_raises(self):
        a = np.ones((3, 3))
        b = np.ones((4, 3))
        with pytest.raises(ValueError, match="same shape"):
            compute_mean_snow_depth([a, b])

    def test_many_fields(self):
        """Mean across 10 fields with values 0–9 is 4.5."""
        fields = [np.full((4, 4), float(v)) for v in range(10)]
        result = compute_mean_snow_depth(fields)
        np.testing.assert_allclose(result, 4.5)

    def test_output_shape(self):
        fields = [np.random.rand(7, 11) for _ in range(5)]
        result = compute_mean_snow_depth(fields)
        assert result.shape == (7, 11)

    def test_docstring_example(self):
        a = np.array([[10.0, 20.0], [30.0, np.nan]])
        b = np.array([[20.0, 40.0], [10.0, 50.0]])
        result = compute_mean_snow_depth([a, b])
        np.testing.assert_array_equal(result, [[15., 30.], [20., 50.]])


# ---------------------------------------------------------------------------
# compute_median_snow_depth
# ---------------------------------------------------------------------------

class TestComputeMedianSnowDepth:
    def test_simple_median_odd(self):
        """Median of three values [10, 20, 30] is 20."""
        fields = [np.full((3, 3), float(v)) for v in [10, 30, 20]]
        result = compute_median_snow_depth(fields)
        np.testing.assert_array_equal(result, 20.0)

    def test_simple_median_even(self):
        """Median of four values [10, 20, 30, 40] is 25."""
        fields = [np.full((2, 2), float(v)) for v in [10, 40, 20, 30]]
        result = compute_median_snow_depth(fields)
        np.testing.assert_array_equal(result, 25.0)

    def test_nan_ignored(self):
        """NaN values are skipped (nanmedian semantics)."""
        a = np.array([[np.nan, 100.0]])
        b = np.array([[50.0, 200.0]])
        c = np.array([[80.0, 300.0]])
        result = compute_median_snow_depth([a, b, c])
        # First cell: median of [50, 80] = 65
        assert math.isclose(result[0, 0], 65.0)
        # Second cell: median of [100, 200, 300] = 200
        assert math.isclose(result[0, 1], 200.0)

    def test_single_field(self):
        a = np.array([[7.0, 14.0]])
        result = compute_median_snow_depth([a])
        np.testing.assert_array_equal(result, a)

    def test_empty_raises(self):
        with pytest.raises(ValueError, match="at least one"):
            compute_median_snow_depth([])

    def test_shape_mismatch_raises(self):
        a = np.ones((2, 5))
        b = np.ones((3, 5))
        with pytest.raises(ValueError, match="same shape"):
            compute_median_snow_depth([a, b])

    def test_output_shape(self):
        fields = [np.random.rand(6, 9) for _ in range(4)]
        result = compute_median_snow_depth(fields)
        assert result.shape == (6, 9)

    def test_docstring_example(self):
        arrays = [np.full((2, 2), v, dtype=float) for v in [10, 30, 20]]
        result = compute_median_snow_depth(arrays)
        np.testing.assert_array_equal(result, np.full((2, 2), 20.0))

    def test_median_less_affected_by_outliers(self):
        """Median should be more robust than mean to extreme outliers."""
        base = np.full((3, 3), 50.0)
        outlier = np.full((3, 3), 5000.0)
        fields_3 = [base, base, outlier]
        mean_val  = compute_mean_snow_depth(fields_3)[0, 0]
        median_val = compute_median_snow_depth(fields_3)[0, 0]
        assert median_val < mean_val


# ---------------------------------------------------------------------------
# _validate_and_stack (internal helper)
# ---------------------------------------------------------------------------

class TestValidateAndStack:
    def test_stacks_correctly(self):
        a = np.ones((2, 3))
        b = np.ones((2, 3)) * 2
        stack = _validate_and_stack([a, b])
        assert stack.shape == (2, 2, 3)
        np.testing.assert_array_equal(stack[0], a)
        np.testing.assert_array_equal(stack[1], b)

    def test_converts_to_float(self):
        a = np.array([[1, 2]], dtype=int)
        stack = _validate_and_stack([a])
        assert stack.dtype == float

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            _validate_and_stack([])

    def test_mismatched_shapes_raises(self):
        with pytest.raises(ValueError):
            _validate_and_stack([np.ones((2, 2)), np.ones((2, 3))])
