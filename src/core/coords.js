/**
 * core/coords.js
 *
 * Web Mercator (EPSG:3857) projection utilities.
 * Used by Source base class for chunk grid coordinate math.
 */

const R = 6378137 // WGS84 semi-major axis in metres

/**
 * Longitude (degrees) → Web Mercator x (metres)
 * @param {number} lon
 * @returns {number}
 */
export function lonToMercatorX(lon) {
  return lon * (Math.PI * R) / 180
}

/**
 * Latitude (degrees) → Web Mercator y (metres)
 * @param {number} lat
 * @returns {number}
 */
export function latToMercatorY(lat) {
  const latRad = lat * Math.PI / 180
  return R * Math.log(Math.tan(Math.PI / 4 + latRad / 2))
}

/**
 * Web Mercator x (metres) → Longitude (degrees)
 * @param {number} x
 * @returns {number}
 */
export function mercatorXToLon(x) {
  return x * 180 / (Math.PI * R)
}

/**
 * Web Mercator y (metres) → Latitude (degrees)
 * @param {number} y
 * @returns {number}
 */
export function mercatorYToLat(y) {
  return (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI
}
