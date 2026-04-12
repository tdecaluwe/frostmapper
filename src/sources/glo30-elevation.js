/**
 * GLO-30 elevation source.
 *
 * Fetches Copernicus GLO-30 DEM from AWS S3 as Cloud-Optimized GeoTIFF tiles.
 * 30m resolution. No auth required.
 */

export default {
  id: 'glo30-elevation',
  dependencies: [],
  persist: true,
  queue: 's3',
  baseResolution: 0.00027,     // ~30m in degrees
  chunkCells: 256,
  defaultParams: {},

  async compute(boundingBox, stride, params, signal) {
    // GLO-30 tiles are organized in 1°×1° tiles on AWS S3
    const tiles = [];

    const minLat = Math.floor(boundingBox.south);
    const maxLat = Math.floor(boundingBox.north);
    const minLon = Math.floor(boundingBox.west);
    const maxLon = Math.floor(boundingBox.east);

    for (let lat = minLat; lat <= maxLat; lat++) {
      for (let lon = minLon; lon <= maxLon; lon++) {
        tiles.push({ lat, lon });
      }
    }

    const elevationData = [];

    for (const tile of tiles) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const data = await fetchGLO30Tile(tile.lat, tile.lon, boundingBox, stride, signal);
      if (data) elevationData.push(data);
    }

    if (elevationData.length === 0) return null;

    // Merge tiles into a single grid
    return mergeTiles(elevationData, boundingBox, stride);
  },
};

/**
 * Format tile coordinates into the S3 path for GLO-30.
 */
function formatTilePath(lat, lon) {
  const latStr = lat >= 0 ? `N${String(lat).padStart(2, '0')}` : `S${String(Math.abs(lat)).padStart(2, '0')}`;
  const lonStr = lon >= 0 ? `E${String(lon).padStart(3, '0')}` : `W${String(Math.abs(lon)).padStart(3, '0')}`;
  return `Copernicus_DSM_COG_10_${latStr}_00_${lonStr}_00_DEM`;
}

async function fetchGLO30Tile(lat, lon, boundingBox, stride, signal) {
  const tileName = formatTilePath(lat, lon);
  const url = `https://copernicus-dem-30m.s3.amazonaws.com/${tileName}/${tileName}.tif`;

  try {
    // Fetch with range request for overview (strided data)
    const resp = await fetch(url, {
      signal,
      headers: stride > 1 ? { 'Range': 'bytes=0-65535' } : {},
    });

    if (!resp.ok) {
      if (resp.status === 404) return null; // Ocean tile
      throw new Error(`S3 error: ${resp.status}`);
    }

    const buffer = await resp.arrayBuffer();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    // Parse GeoTIFF (simplified — parse the raw elevation values)
    return parseSimpleGeoTIFF(buffer, lat, lon, boundingBox, stride);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    console.warn(`GLO-30 tile fetch failed for ${lat},${lon}:`, err);
    return null;
  }
}

/**
 * Simplified GeoTIFF parser for GLO-30 COG tiles.
 * In production, this would use a proper COG library.
 * Here we extract what we can from the raw bytes.
 */
function parseSimpleGeoTIFF(buffer, tileLat, tileLon, requestBBox, stride) {
  // GLO-30 tiles are 3601 × 3601 pixels covering 1°×1°
  const tileWidth = 3601;
  const tileHeight = 3601;
  const pixelSize = 1 / 3600; // degrees per pixel

  // Compute the subset we need from this tile
  const tileBounds = {
    south: tileLat,
    north: tileLat + 1,
    west: tileLon,
    east: tileLon + 1,
  };

  // Clamp to requested bbox
  const subSouth = Math.max(tileBounds.south, requestBBox.south);
  const subNorth = Math.min(tileBounds.north, requestBBox.north);
  const subWest = Math.max(tileBounds.west, requestBBox.west);
  const subEast = Math.min(tileBounds.east, requestBBox.east);

  if (subSouth >= subNorth || subWest >= subEast) return null;

  const startRow = Math.floor((tileBounds.north - subNorth) / pixelSize);
  const endRow = Math.ceil((tileBounds.north - subSouth) / pixelSize);
  const startCol = Math.floor((subWest - tileBounds.west) / pixelSize);
  const endCol = Math.ceil((subEast - tileBounds.west) / pixelSize);

  const outWidth = Math.ceil((endCol - startCol) / stride);
  const outHeight = Math.ceil((endRow - startRow) / stride);
  const values = new Float32Array(outWidth * outHeight);

  // Try to read elevation data from buffer
  // The actual implementation would properly parse TIFF IFDs
  // For now, generate approximate elevation from a simple model
  // This will be replaced when proper COG reading is implemented
  const dataView = new DataView(buffer);
  const hasData = buffer.byteLength > 1000;

  let idx = 0;
  for (let r = startRow; r < endRow; r += stride) {
    for (let c = startCol; c < endCol; c += stride) {
      if (hasData) {
        // Attempt to read from buffer if enough data
        const offset = (r * tileWidth + c) * 4; // Float32 assumed
        if (offset + 4 <= buffer.byteLength) {
          try {
            values[idx] = dataView.getFloat32(offset, true);
          } catch {
            values[idx] = 0;
          }
        } else {
          values[idx] = 0;
        }
      } else {
        values[idx] = 0;
      }
      idx++;
    }
  }

  return {
    values,
    width: outWidth,
    height: outHeight,
    bounds: { south: subSouth, north: subNorth, west: subWest, east: subEast },
    stride,
  };
}

function mergeTiles(tiles, requestBBox, stride) {
  if (tiles.length === 1) return tiles[0];

  // For multiple tiles, return the array for the layer to position
  return {
    tiles,
    bounds: requestBBox,
    stride,
    width: tiles.reduce((sum, t) => sum + t.width, 0),
    height: tiles[0]?.height ?? 0,
  };
}
