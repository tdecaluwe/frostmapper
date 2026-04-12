/**
 * Elevation layer.
 *
 * Type: informational overlay
 * Source: glo30-elevation
 *
 * Raw elevation displayed as a gradient overlay.
 */

import { getSource } from '../core/cache.js';
import { targetStride } from '../core/map.js';

export default {
  id: 'elevation',
  type: 'soft-filter',
  source: 'glo30-elevation',
  hue: 280,       // Purple
  valueRange: { from: 0, to: 2000 },  // 0m → 2000m gradient

  defaultParams: {},

  _active: false,
  _mapLayerId: 'layer-elevation',
  _mapSourceId: 'src-elevation',

  toggle(map, active) {
    this._active = active;
    if (map.getLayer(this._mapLayerId)) {
      map.setLayoutProperty(this._mapLayerId, 'visibility', active ? 'visible' : 'none');
    }
  },

  async update(map, viewport, params) {
    if (!this._active) return;

    const source = getSource(this.source);
    if (!source) return;

    const stride = targetStride(0.00027, viewport.zoom);

    try {
      const result = await source.get(viewport.bounds, stride, null);
      if (!result?.data) return;

      const data = result.data;
      if (data.values) {
        this._renderOverlay(map, data.values, data.width, data.height, data.bounds);
      } else if (data.tiles) {
        // Merge multi-tile into a single grid
        const merged = this._mergeTiles(data.tiles, data.bounds);
        if (merged) {
          this._renderOverlay(map, merged.values, merged.width, merged.height, merged.bounds);
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Elevation layer update failed:', err);
    }
  },

  _renderOverlay(map, values, width, height, bounds) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);

    const { from, to } = this.valueRange;
    const range = to - from;

    for (let i = 0; i < values.length; i++) {
      const val = values[i];
      const normalized = range !== 0 ? Math.max(0, Math.min(1, (val - from) / range)) : 0;

      // Elevation color ramp: green → brown → white
      let r, g, b;
      if (normalized < 0.3) {
        const t = normalized / 0.3;
        r = Math.round(50 + t * 100);
        g = Math.round(150 - t * 50);
        b = Math.round(50);
      } else if (normalized < 0.7) {
        const t = (normalized - 0.3) / 0.4;
        r = Math.round(150 + t * 50);
        g = Math.round(100 + t * 50);
        b = Math.round(50 + t * 80);
      } else {
        const t = (normalized - 0.7) / 0.3;
        r = Math.round(200 + t * 55);
        g = Math.round(150 + t * 105);
        b = Math.round(130 + t * 125);
      }

      const alpha = val > 0 ? 100 : 0;

      const px = i * 4;
      imageData.data[px] = r;
      imageData.data[px + 1] = g;
      imageData.data[px + 2] = b;
      imageData.data[px + 3] = alpha;
    }

    ctx.putImageData(imageData, 0, 0);

    const existing = map.getSource(this._mapSourceId);
    if (existing) {
      existing.updateImage({
        url: canvas.toDataURL(),
        coordinates: [
          [bounds.west, bounds.north],
          [bounds.east, bounds.north],
          [bounds.east, bounds.south],
          [bounds.west, bounds.south],
        ],
      });
    } else {
      map.addSource(this._mapSourceId, {
        type: 'image',
        url: canvas.toDataURL(),
        coordinates: [
          [bounds.west, bounds.north],
          [bounds.east, bounds.north],
          [bounds.east, bounds.south],
          [bounds.west, bounds.south],
        ],
      });
      map.addLayer({
        id: this._mapLayerId,
        type: 'raster',
        source: this._mapSourceId,
        paint: { 'raster-opacity': 0.5, 'raster-fade-duration': 0 },
      });
    }
  },

  /**
   * Merge multiple elevation tiles into a single value grid.
   * Tiles are assumed to be side-by-side horizontally with the same height.
   */
  _mergeTiles(tiles, bounds) {
    if (!tiles || tiles.length === 0) return null;
    if (tiles.length === 1) return tiles[0];

    const height = tiles[0].height;
    const totalWidth = tiles.reduce((sum, t) => sum + t.width, 0);
    const merged = new Float32Array(totalWidth * height);

    let xOffset = 0;
    for (const tile of tiles) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < tile.width; x++) {
          merged[y * totalWidth + xOffset + x] = tile.values[y * tile.width + x];
        }
      }
      xOffset += tile.width;
    }

    return { values: merged, width: totalWidth, height, bounds };
  },
};
