import Projection from 'ol/proj/Projection.js'
import {addCoordinateTransforms, addProjection, get as getProjection, transform} from 'ol/proj.js'

export const AUTHAGRAPH_CODE = 'EPSG:AUTHAGRAPH'

const PI = Math.PI
const SQRT2 = Math.SQRT2
const SQRT3 = Math.sqrt(3)
const NORTH_POLE = [PI / 2, 0, 0]

function coerceAngle(angle) {
  return ((angle + PI) % (2 * PI) + 2 * PI) % (2 * PI) - PI
}

function transformFromOblique(latF, lonF, pole) {
  if (!pole || (pole[0] === NORTH_POLE[0] && pole[1] === NORTH_POLE[1] && pole[2] === NORTH_POLE[2])) {
    return [latF, lonF]
  }

  const [lat0, lon0, tht0] = pole
  let lat1
  if (lat0 === PI / 2) lat1 = latF
  else lat1 = Math.asin(Math.sin(lat0) * Math.sin(latF) + Math.cos(lat0) * Math.cos(latF) * Math.cos(lon0 - lonF))

  let lon1
  if (lat0 === PI / 2) lon1 = lonF - lon0
  else if (lat0 === -PI / 2) lon1 = lon0 - lonF - PI
  else {
    lon1 = Math.acos((Math.cos(lat0) * Math.sin(latF) - Math.sin(lat0) * Math.cos(latF) * Math.cos(lon0 - lonF)) / Math.cos(lat1)) - PI
    if (Number.isNaN(lon1)) {
      if ((Math.cos(lon0 - lonF) >= 0 && latF < lat0) || (Math.cos(lon0 - lonF) < 0 && latF < -lat0)) lon1 = 0
      else lon1 = -PI
    } else if (Math.sin(lonF - lon0) > 0) {
      lon1 = -lon1
    }
  }

  lon1 = lon1 - tht0
  if (Math.abs(lon1) > PI) lon1 = coerceAngle(lon1)
  if (lon1 >= PI - 1e-7) lon1 = -PI
  return [lat1, lon1]
}

function transformToOblique(coords, pole) {
  if (!pole) return coords

  let [lat1, lon1] = coords
  const [lat0, lon0, tht0] = pole
  lon1 += tht0

  const latf = Math.asin(Math.sin(lat0) * Math.sin(lat1) - Math.cos(lat0) * Math.cos(lon1) * Math.cos(lat1))
  const innerFunc = Math.sin(lat1) / Math.cos(lat0) / Math.cos(latf) - Math.tan(lat0) * Math.tan(latf)
  let lonf
  if (lat0 === PI / 2) lonf = lon1 + lon0
  else if (lat0 === -PI / 2) lonf = -lon1 + lon0 + PI
  else if (Math.abs(innerFunc) > 1) {
    if ((lon1 === 0 && lat1 < -lat0) || (lon1 !== 0 && lat1 < lat0)) lonf = lon0 + PI
    else lonf = lon0
  } else if (Math.sin(lon1) > 0) lonf = lon0 + Math.acos(innerFunc)
  else lonf = lon0 - Math.acos(innerFunc)

  if (Math.abs(lonf) > PI) lonf = coerceAngle(lonf)
  return [latf, lonf, tht0]
}

function faceProject(lat, lon) {
  const tht = Math.atan((lon - Math.asin(Math.sin(lon) / SQRT3)) / PI * Math.sqrt(12))
  const p = (PI / 2 - lat) / Math.atan(SQRT2 / Math.max(0.2, Math.cos(lon)))
  const k = 0.68
  const r = Math.pow(Math.max(p, 1e-9), k) * SQRT3 / Math.max(0.2, Math.cos(tht))
  return [r, tht]
}

function faceInverse(r, th) {
  const lon = newtonSolve(th, th * 2, (l) => Math.atan((l - Math.asin(Math.sin(l) / SQRT3)) / PI * Math.sqrt(12)), 1e-6)
  const R = r / (SQRT3 / Math.cos(th))
  const k = 0.68
  return [PI / 2 - Math.pow(R, 1 / k) * Math.atan(SQRT2 / Math.cos(lon)), lon]
}

function newtonSolve(target, x0, f, tol) {
  let x = x0
  for (let i = 0; i < 8; i += 1) {
    const y = f(x)
    const error = y - target
    if (Math.abs(error) < tol) return x
    const h = 1e-6
    const dy = (f(x + h) - y) / h
    x -= error / dy
  }
  return x
}

function projectPoint(lat, lon) {
  const rel = transformFromOblique(lat, lon, [77 * PI / 180, 143 * PI / 180, 17 * PI / 180])
  return faceProject(rel[0], rel[1])
}

function inversePoint(x, y) {
  return transformToOblique(faceInverse(x, y), [77 * PI / 180, 143 * PI / 180, 17 * PI / 180])
}

export function projectLonLatToAuthagraph(lonLat) {
  const [lon, lat] = lonLat
  return projectPoint(lat * PI / 180, lon * PI / 180)
}

export function unprojectAuthagraphToLonLat(coords) {
  const [lat, lon] = inversePoint(coords[0], coords[1])
  return [lon * 180 / PI, lat * 180 / PI]
}

export function registerAuthagraphProjection() {
  if (getProjection(AUTHAGRAPH_CODE)) return
  const projection = new Projection({
    code: AUTHAGRAPH_CODE,
    units: 'm',
    extent: [-15000000, -12000000, 15000000, 12000000],
    worldExtent: [-180, -90, 180, 90],
    global: true,
  })
  addProjection(projection)
  addCoordinateTransforms('EPSG:4326', projection, projectLonLatToAuthagraph, unprojectAuthagraphToLonLat)
  addCoordinateTransforms(
    'EPSG:3857',
    projection,
    (coordinate) => projectLonLatToAuthagraph(transform(coordinate, 'EPSG:3857', 'EPSG:4326')),
    (coordinate) => transform(unprojectAuthagraphToLonLat(coordinate), 'EPSG:4326', 'EPSG:3857'),
  )
}
