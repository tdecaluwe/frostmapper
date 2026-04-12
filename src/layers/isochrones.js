/**
 * Travel time isochrones layer.
 *
 * Type: annotation
 * Source: isochrones
 *
 * Drive time isolines from qualifying airports.
 */

import { getSource } from '../core/cache.js';
import { getKey } from '../core/crypto.js';

export default {
  id: 'isochrones',
  type: 'annotation',
  source: 'isochrones',

  defaultParams: {
    intervals: [3600, 7200, 10800],
    minPassengers: 100000,
  },

  _active: false,
  _mapLayerIds: ['layer-isochrones-fill', 'layer-isochrones-line', 'layer-isochrones-label'],
  _mapSourceId: 'src-isochrones',

  requiresKey: 'openrouteservice',

  toggle(map, active) {
    this._active = active;
    for (const layerId of this._mapLayerIds) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', active ? 'visible' : 'none');
      }
    }
  },

  async update(map, viewport, params) {
    if (!this._active) return;

    if (!getKey('openrouteservice')) {
      console.warn('Isochrones layer requires OpenRouteService API key');
      return;
    }

    const source = getSource(this.source);
    if (!source) return;

    const effectiveParams = { ...this.defaultParams, ...params };

    try {
      const result = await source.get(viewport.bounds, 1, null, effectiveParams);
      if (!result?.data) return;

      const geojson = result.data;

      const existing = map.getSource(this._mapSourceId);
      if (existing) {
        existing.setData(geojson);
      } else {
        map.addSource(this._mapSourceId, {
          type: 'geojson',
          data: geojson,
        });

        // Fill polygons with decreasing opacity
        map.addLayer({
          id: 'layer-isochrones-fill',
          type: 'fill',
          source: this._mapSourceId,
          paint: {
            'fill-color': [
              'match', ['get', 'value'],
              3600, 'rgba(46, 204, 113, 0.15)',
              7200, 'rgba(241, 196, 15, 0.1)',
              10800, 'rgba(231, 76, 60, 0.08)',
              'rgba(150, 150, 150, 0.05)',
            ],
            'fill-outline-color': 'transparent',
          },
        });

        // Contour lines
        map.addLayer({
          id: 'layer-isochrones-line',
          type: 'line',
          source: this._mapSourceId,
          paint: {
            'line-color': [
              'match', ['get', 'value'],
              3600, '#2ecc71',
              7200, '#f1c40f',
              10800, '#e74c3c',
              '#999',
            ],
            'line-width': 1.5,
            'line-opacity': 0.7,
            'line-dasharray': [2, 2],
          },
        });

        // Labels at isochrone boundaries
        map.addLayer({
          id: 'layer-isochrones-label',
          type: 'symbol',
          source: this._mapSourceId,
          layout: {
            'text-field': [
              'concat',
              ['get', 'iata'],
              ' ',
              ['/', ['get', 'value'], 3600],
              'h',
            ],
            'text-size': 10,
            'symbol-placement': 'line',
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': '#e0e0e0',
            'text-halo-color': 'rgba(0,0,0,0.7)',
            'text-halo-width': 1,
          },
          minzoom: 7,
        });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Isochrones layer update failed:', err);
    }
  },
};
