/**
 * Road accessibility layer.
 *
 * Type: hard filter
 * Source: road-access
 *
 * Cells more than N km from the nearest qualifying road are grayed out.
 * Uses Turf-style distance buffering on GeoJSON road network.
 */

import { getSource } from '../core/cache.js';
import { targetStride } from '../core/map.js';

export default {
  id: 'road-access',
  type: 'hard-filter',
  source: 'road-access',

  defaultParams: {
    minClassification: 'tertiary',
    distanceThreshold: 2000, // meters
  },

  _active: false,
  _mapLayerId: 'layer-road-access-mask',
  _mapSourceId: 'src-road-access-mask',

  toggle(map, active) {
    this._active = active;
    try {
      if (typeof map.getLayer === 'function' && map.getLayer(this._mapLayerId)) {
        map.setLayoutProperty(this._mapLayerId, 'visibility', active ? 'visible' : 'none');
      }
    } catch (e) {
      // Some map objects may not expose getLayer — ignore silently
    }
  },

  async update(map, viewport, params) {
    if (!this._active) return;

    const source = getSource(this.source);
    if (!source) return;

    const effectiveParams = { ...this.defaultParams, ...params };

    try {
      // Use a stride appropriate for the viewport zoom to create a reasonable raster mask
      const stride = targetStride(0.009, viewport.zoom);
      const result = await source.get(viewport.bounds, stride, null, effectiveParams);
      if (!result?.data) return;

      const geojson = result.data;

      // Build list of line segments in projected meters for fast distance checks
      const segs = [];
      for (const f of (geojson.features || [])) {
        if (!f.geometry || f.geometry.type !== 'LineString') continue;
        const coords = f.geometry.coordinates;
        for (let i = 0; i + 1 < coords.length; i++) {
          segs.push([coords[i], coords[i + 1]]);
        }
      }

      // If no road geometry, create a fully opaque mask (no access)
      const { west, east, north, south } = viewport.bounds;
      const lonSpan = east - west;
      const latSpan = north - south;
      const width = Math.max(1, Math.round(lonSpan / stride));
      const height = Math.max(1, Math.round(latSpan / stride));

      // Helper: convert lon/lat to meters using equirectangular approx centered at viewport center
      const centerLat = (north + south) / 2;
      const metersPerDegLat = 111320;
      const metersPerDegLon = Math.abs(Math.cos(centerLat * Math.PI / 180) * 111320);

      const lonToX = (lon) => (lon - west) * metersPerDegLon;
      const latToY = (lat) => (north - lat) * metersPerDegLat; // y downwards

      // Precompute segment bbox in meters to accelerate checks
      const segBoxes = segs.map(s => {
        const [a, b] = s;
        const xs = [lonToX(a[0]), lonToX(b[0])];
        const ys = [latToY(a[1]), latToY(b[1])];
        return { s, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
      });

      const thresholdM = effectiveParams.distanceThreshold || 2000;

      // Create canvas and image
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(width, height);

      for (let y = 0; y < height; y++) {
        const lat = north - (y + 0.5) * (latSpan / height);
        for (let x = 0; x < width; x++) {
          const lon = west + (x + 0.5) * (lonSpan / width);
          const px = (y * width + x) * 4;

          // point in meters
          const pxX = lonToX(lon);
          const pxY = latToY(lat);

          // find min distance to segments with bbox check
          let minDist = Infinity;
          for (const box of segBoxes) {
            if (pxX + thresholdM < box.minX || pxX - thresholdM > box.maxX || pxY + thresholdM < box.minY || pxY - thresholdM > box.maxY) continue;
            const [a, b] = box.s;
            // convert segment endpoints to meters
            const ax = lonToX(a[0]);
            const ay = latToY(a[1]);
            const bx = lonToX(b[0]);
            const by = latToY(b[1]);

            // projection of P onto AB
            const vx = bx - ax;
            const vy = by - ay;
            const wx = pxX - ax;
            const wy = pxY - ay;
            const vlen2 = vx * vx + vy * vy;
            let t = vlen2 === 0 ? 0 : (wx * vx + wy * vy) / vlen2;
            t = Math.max(0, Math.min(1, t));
            const projX = ax + t * vx;
            const projY = ay + t * vy;
            const dx = pxX - projX;
            const dy = pxY - projY;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < minDist) minDist = d;
            if (minDist === 0) break;
          }

          // If farther than threshold, paint semi-opaque gray; otherwise transparent
          if (minDist > thresholdM) {
            imageData.data[px] = 80; // gray
            imageData.data[px + 1] = 80;
            imageData.data[px + 2] = 80;
            imageData.data[px + 3] = 160; // ~63% opacity
          } else {
            imageData.data[px] = 0;
            imageData.data[px + 1] = 0;
            imageData.data[px + 2] = 0;
            imageData.data[px + 3] = 0;
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);

      // Try to update an existing source if possible. Some map objects (or
      // test harnesses) may not implement getSource; attempt to add the
      // source and layer, and fall back to updateImage when available.
      let existing = null;
      try {
        if (typeof map.getSource === 'function') existing = map.getSource(this._mapSourceId);
      } catch (_) {
        existing = null;
      }

      if (!existing) {
        // Try to add source/layer — this will succeed on a normal MapLibre map
        try {
          map.addSource(this._mapSourceId, {
            type: 'image',
            url: canvas.toDataURL(),
            coordinates: [
              [west, north],
              [east, north],
              [east, south],
              [west, south],
            ],
          });
          map.addLayer({
            id: this._mapLayerId,
            type: 'raster',
            source: this._mapSourceId,
            paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 },
          });
        } catch (err) {
          // addSource/addLayer may fail in non-standard maps; attempt a best-effort
          // lookup in style and treat that as existing.
          try {
            const style = typeof map.getStyle === 'function' ? map.getStyle() : (map.getStyle || {});
            if (style && style.sources && style.sources[this._mapSourceId]) {
              existing = style.sources[this._mapSourceId];
            }
          } catch (e2) {
            // ignore
          }
        }
      }

      if (existing && typeof existing.updateImage === 'function') {
        try {
          existing.updateImage({
            url: canvas.toDataURL(),
            coordinates: [
              [west, north],
              [east, north],
              [east, south],
              [west, south],
            ],
          });
        } catch (e) {
          // ignore update errors
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Road access layer update failed:', err);
    }
  },
};
