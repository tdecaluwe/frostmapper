/**
 * Public transport stops source.
 *
 * Fetches bus and train stops from OSM via Overpass API.
 * Returns GeoJSON point features.
 */

export default {
  id: 'transport-stops',
  dependencies: [],
  persist: false,
  queue: 'overpass',
  baseResolution: 0.009,
  chunkCells: 256,
  defaultParams: {},

  async compute(boundingBox, stride, params, signal) {
    const bbox = `${boundingBox.south},${boundingBox.west},${boundingBox.north},${boundingBox.east}`;

    const query = `
      [out:json][timeout:30];
      (
        node["public_transport"="stop_position"](${bbox});
        node["highway"="bus_stop"](${bbox});
        node["railway"="station"](${bbox});
        node["railway"="halt"](${bbox});
      );
      out body;
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
      console.warn('Transport stops fetch failed:', err);
      return null;
    }
  },
};

function osmToGeoJSON(osmData) {
  const features = [];

  for (const el of (osmData.elements || [])) {
    if (el.type === 'node' && el.lat != null && el.lon != null) {
      const stopType = el.tags?.railway ? 'rail' : 'bus';
      features.push({
        type: 'Feature',
        properties: {
          name: el.tags?.name || '',
          type: stopType,
          operator: el.tags?.operator || '',
          id: el.id,
        },
        geometry: {
          type: 'Point',
          coordinates: [el.lon, el.lat],
        },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}
