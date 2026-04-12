/**
 * Travel time isochrones source.
 *
 * Depends on airports source for airport locations.
 * Computes drive-time isochrones via OpenRouteService.
 */

import { getKey } from '../core/crypto.js';

export default {
  id: 'isochrones',
  dependencies: ['airports'],
  persist: false,
  queue: 'openrouteservice',
  baseResolution: 0.009,
  chunkCells: 256,
  defaultParams: {
    intervals: [3600, 7200, 10800], // seconds: 1h, 2h, 3h
    minPassengers: 100000,
  },

  async compute(boundingBox, stride, params, signal, dependencies) {
    const { intervals = [3600, 7200, 10800] } = params;

    const apiKey = getKey('openrouteservice');
    if (!apiKey) {
      throw new Error('OpenRouteService API key not configured');
    }

    const airportsSource = dependencies['airports'];
    if (!airportsSource) throw new Error('Missing dependency: airports');

    const airportData = await airportsSource.get(boundingBox, stride, signal, params);
    if (!airportData?.data?.features) return { type: 'FeatureCollection', features: [] };

    const allFeatures = [];

    for (const airport of airportData.data.features) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const [lon, lat] = airport.geometry.coordinates;

      try {
        const url = 'https://api.openrouteservice.org/v2/isochrones/driving-car';
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': apiKey,
          },
          body: JSON.stringify({
            locations: [[lon, lat]],
            range: intervals,
            range_type: 'time',
          }),
          signal,
        });

        if (!resp.ok) {
          console.warn(`Isochrone failed for ${airport.properties.iata}: ${resp.status}`);
          continue;
        }

        const data = await resp.json();

        // Add airport info to each isochrone feature
        for (const feature of (data.features || [])) {
          feature.properties = {
            ...feature.properties,
            airport: airport.properties.name,
            iata: airport.properties.iata,
          };
          allFeatures.push(feature);
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.warn(`Isochrone error for ${airport.properties.iata}:`, err);
      }
    }

    return { type: 'FeatureCollection', features: allFeatures };
  },
};
