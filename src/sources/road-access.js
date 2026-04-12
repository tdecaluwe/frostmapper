/**
 * Road accessibility source.
 *
 * Fetches road network from OSM via Overpass API.
 * Returns GeoJSON of roads matching classification threshold.
 */

export default {
  id: 'road-access',
  dependencies: [],
  persist: false,
  queue: 'overpass',
  baseResolution: 0.009,
  chunkCells: 256,
  defaultParams: {
    minClassification: 'tertiary',
    distanceThreshold: 2000,  // meters
  },

  async compute(boundingBox, stride, params, signal) {
    const { minClassification = 'tertiary' } = params;

    // Map classification to Overpass highway values
    const classHierarchy = [
      'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
      'unclassified', 'residential', 'service', 'track'
    ];
    const minIdx = classHierarchy.indexOf(minClassification);
    const allowedClasses = classHierarchy.slice(0, minIdx + 1);

    const bbox = `${boundingBox.south},${boundingBox.west},${boundingBox.north},${boundingBox.east}`;

    // Build Overpass query
    const query = `
      [out:json][timeout:30];
      (
        ${allowedClasses.map(c => `way["highway"="${c}"](${bbox});`).join('\n        ')}
      );
      out geom;
    `;

    const url = 'https://overpass-api.de/api/interpreter';

    try {
      const resp = await fetch(url, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal,
      });

      if (!resp.ok) throw new Error(`Overpass error: ${resp.status}`);

      const json = await resp.json();
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      return osmToGeoJSON(json);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      console.warn('Road access fetch failed:', err);
      return null;
    }
  },
};

/**
 * Convert Overpass JSON to GeoJSON FeatureCollection.
 */
function osmToGeoJSON(osmData) {
  const features = [];

  for (const element of (osmData.elements || [])) {
    if (element.type === 'way' && element.geometry) {
      features.push({
        type: 'Feature',
        properties: {
          highway: element.tags?.highway || 'unknown',
          name: element.tags?.name || '',
          id: element.id,
        },
        geometry: {
          type: 'LineString',
          coordinates: element.geometry.map(p => [p.lon, p.lat]),
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}
