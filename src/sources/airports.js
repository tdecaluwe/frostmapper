/**
 * Airport data source.
 *
 * Fetches live airport data from OpenFlights and enriches with
 * bundled passenger figures. Falls back to bundled JSON silently.
 */

const OPENFLIGHTS_URL = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat';

export default {
  id: 'airports',
  dependencies: [],
  persist: false,
  queue: null,
  baseResolution: 0.009,
  chunkCells: 256,
  defaultParams: {
    minPassengers: 100000,
  },

  async compute(boundingBox, stride, params, signal) {
    const { minPassengers = 100000 } = params;

    let airports;

    try {
      // Try live fetch from OpenFlights
      airports = await fetchOpenFlights(boundingBox, signal);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      console.warn('OpenFlights fetch failed, using bundled data:', err);
    }

    // Fall back to bundled JSON
    if (!airports) {
      try {
        const resp = await fetch('./data/airports.json', { signal });
        const data = await resp.json();
        airports = data.airports || data;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.warn('Bundled airports load failed:', err);
        return { type: 'FeatureCollection', features: [] };
      }
    }

    // Enrich with passenger data and filter
    const bundledPassengers = await loadBundledPassengers(signal);

    const features = airports
      .filter(a => {
        const lat = parseFloat(a.lat ?? a.latitude);
        const lon = parseFloat(a.lon ?? a.longitude);
        if (isNaN(lat) || isNaN(lon)) return false;

        // Geographic filter — Scandinavia region (broad)
        if (lat < 54 || lat > 72 || lon < -5 || lon > 35) return false;

        // Passenger threshold
        const passengers = bundledPassengers[a.iata] || a.passengers || 0;
        return passengers >= minPassengers;
      })
      .map(a => {
        const lat = parseFloat(a.lat ?? a.latitude);
        const lon = parseFloat(a.lon ?? a.longitude);
        const passengers = bundledPassengers[a.iata] || a.passengers || 0;

        return {
          type: 'Feature',
          properties: {
            name: a.name,
            iata: a.iata || '',
            city: a.city || '',
            country: a.country || '',
            passengers,
          },
          geometry: {
            type: 'Point',
            coordinates: [lon, lat],
          },
        };
      });

    return { type: 'FeatureCollection', features };
  },
};

async function fetchOpenFlights(boundingBox, signal) {
  const resp = await fetch(OPENFLIGHTS_URL, { signal });
  if (!resp.ok) throw new Error(`OpenFlights error: ${resp.status}`);

  const text = await resp.text();
  const lines = text.trim().split('\n');

  return lines.map(line => {
    const parts = line.split(',').map(s => s.replace(/"/g, ''));
    return {
      id: parts[0],
      name: parts[1],
      city: parts[2],
      country: parts[3],
      iata: parts[4],
      icao: parts[5],
      lat: parts[6],
      lon: parts[7],
      altitude: parts[8],
    };
  }).filter(a => a.iata && a.iata !== '\\N');
}

async function loadBundledPassengers(signal) {
  try {
    const resp = await fetch('./data/airports.json', { signal });
    const data = await resp.json();
    const map = {};
    const list = data.passengers || data;
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (entry.iata) map[entry.iata] = entry.passengers || 0;
      }
    }
    return map;
  } catch {
    return {};
  }
}
