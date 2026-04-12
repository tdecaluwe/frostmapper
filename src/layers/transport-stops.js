/**
 * Public transport stops layer.
 *
 * Type: annotation
 * Source: transport-stops
 *
 * Bus and train stops rendered as point markers.
 * Zoom-dependent visibility.
 */

import { getSource } from '../core/cache.js';

export default {
  id: 'transport-stops',
  type: 'annotation',
  source: 'transport-stops',

  defaultParams: {
    minZoom: 9,
  },

  _active: false,
  _mapLayerIds: ['layer-transport-stops-circle', 'layer-transport-stops-label'],
  _mapSourceId: 'src-transport-stops',

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

    const effectiveParams = { ...this.defaultParams, ...params };
    if (viewport.zoom < effectiveParams.minZoom) {
      // Below min zoom — hide if shown
      const existing = map.getSource(this._mapSourceId);
      if (existing) {
        existing.setData({ type: 'FeatureCollection', features: [] });
      }
      return;
    }

    const source = getSource(this.source);
    if (!source) return;

    try {
      const result = await source.get(viewport.bounds, 1, null);
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

        // Circle markers
        map.addLayer({
          id: 'layer-transport-stops-circle',
          type: 'circle',
          source: this._mapSourceId,
          paint: {
            'circle-radius': [
              'match', ['get', 'type'],
              'rail', 6,
              4,
            ],
            'circle-color': [
              'match', ['get', 'type'],
              'rail', '#e74c3c',
              '#3498db',
            ],
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 1.5,
          },
        });

        // Labels
        map.addLayer({
          id: 'layer-transport-stops-label',
          type: 'symbol',
          source: this._mapSourceId,
          layout: {
            'text-field': ['get', 'name'],
            'text-size': 11,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
            'text-optional': true,
          },
          paint: {
            'text-color': '#e0e0e0',
            'text-halo-color': 'rgba(0,0,0,0.7)',
            'text-halo-width': 1,
          },
          minzoom: 11,
        });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Transport stops layer update failed:', err);
    }
  },
};
