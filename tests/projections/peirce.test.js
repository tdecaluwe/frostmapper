import {before, expect, test} from 'vitest'
import proj4 from 'proj4'
import {GRIEGER_CODE, NormalizedPeirceCoords, registerAffine, registerGrieger, registerPeirce, registerPipeline, Stereographic, WGS84Coords} from '../../demo/peirce.js'

registerPeirce(proj4)
registerAffine(proj4)
registerPipeline(proj4)
registerGrieger(proj4)

const S = 1
const SAMPLE_LATITUDES = [...new Array(17).keys()].map((x) => 80 - 10 * x)
const SAMPLE_LONGITUDES = [...new Array(37).keys()].map((x) => -180 + 10 * x)
const ROUND_TRIP_CASES = SAMPLE_LATITUDES.flatMap((lat) => SAMPLE_LONGITUDES.map((lon) => ({lon, lat})))

test('WGS84Coords stores coordinates and seals instances', () => {
  const point = new WGS84Coords(12.5, -48.25)

  expect(point.x).toBe(12.5)
  expect(point.y).toBe(-48.25)
  expect(Object.isSealed(point)).toBe(true)
  expect(Object.isExtensible(point)).toBe(false)
})

test('WGS84Coords.forward converts radians to degrees', () => {
  expect(WGS84Coords.forward({x: 0, y: 0})).toEqual({x: 0, y: 0})
  expect(WGS84Coords.forward({x: Math.PI, y: Math.PI / 2})).toEqual({x: 180, y: 90})
  expect(WGS84Coords.forward({x: -Math.PI / 2, y: -Math.PI / 4})).toEqual({x: -90, y: -45})
})

test('WGS84Coords.inverse converts degrees to radians', () => {
  const {x: lonRad, y: latRad} = WGS84Coords.inverse(new WGS84Coords(180, 90))

  expect(lonRad).toBeCloseTo(Math.PI, 12)
  expect(latRad).toBeCloseTo(Math.PI / 2, 12)
})

test('WGS84Coords.to returns an equivalent WGS84Coords instance', () => {
  const point = new WGS84Coords(-73.9857, 40.7484)
  const copy = point.to(WGS84Coords)

  expect(copy).not.toBe(point)
  expect(copy).toEqual(point)
})

test('WGS84Coords.from copies another WGS84Coords instance', () => {
  const point = new WGS84Coords(7.1, 52.3);
  const copy = WGS84Coords.from(point);

  expect(copy).not.toBe(point)
  expect(copy).toEqual(point)
})

test('Stereographic remains stable under repeated round-trips', () => {
  const samples = [
    new WGS84Coords(0, 0),
    new WGS84Coords(45, 10),
    new WGS84Coords(-90, -30),
    new WGS84Coords(135, 40),
  ]

  for (const sample of samples) {
    let current = sample

    for (let i = 0; i < 25; i += 1) {
      current = current.to(Stereographic).to(WGS84Coords)
    }

    expect(current.x).toBeCloseTo(sample.x, 10)
    expect(current.y).toBeCloseTo(sample.y, 10)
  }
})

test('ob_tran with identity forward maps the rotated poles', () => {
  const rotated = proj4('EPSG:4326', '+proj=ob_tran +o_proj=identity +o_lat_p=-45 +o_lon_p=45')

  expectPointClose({x: rotated.forward([0, 90])[0], y: rotated.forward([0, 90])[1]}, {x: 45, y: -45}, 12)
  expectPointClose({x: rotated.forward([0, -90])[0], y: rotated.forward([0, -90])[1]}, {x: -135, y: 45}, 12)
})

test('ob_tran with identity inverse maps the rotated poles back', () => {
  const rotated = proj4('EPSG:4326', '+proj=ob_tran +o_proj=identity +o_lat_p=-45 +o_lon_p=45')

  expectPointClose({x: rotated.inverse([45, -45])[0], y: rotated.inverse([45, -45])[1]}, {x: 0, y: 90}, 12)
  expectSameSpherePoint({x: rotated.inverse([-135, 45])[0], y: rotated.inverse([-135, 45])[1]}, {x: 0, y: -90})
})

test('ob_tran with identity sends Greenwich down from center', () => {
  const rotated = proj4('EPSG:4326', '+proj=ob_tran +o_proj=identity +o_lat_p=-45 +o_lon_p=45')

  expectPointClose({x: rotated.forward([0, -45])[0], y: rotated.forward([0, -45])[1]}, {x: -135, y: 0}, 12)
  expectPointClose({x: rotated.forward([90, 0])[0], y: rotated.forward([90, 0])[1]}, {x: 135, y: 0}, 12)
})

function expectPointClose(actual, expected, tolerance = 0.5) {
  expect(actual.x).toBeCloseTo(expected.x, tolerance)
  expect(actual.y).toBeCloseTo(expected.y, tolerance)
}

function expectPointNearEither(actual, expectedA, expectedB, tolerance = 0.5) {
  const okA = Math.abs(actual.x - expectedA.x) <= tolerance && Math.abs(actual.y - expectedA.y) <= tolerance
  const okB = Math.abs(actual.x - expectedB.x) <= tolerance && Math.abs(actual.y - expectedB.y) <= tolerance
  expect(okA || okB).toBe(true)
}

function toUnitSphere({x: lon, y: lat}) {
  const lonRad = lon * Math.PI / 180
  const latRad = lat * Math.PI / 180
  const cosLat = Math.cos(latRad)

  return {
    x: cosLat * Math.cos(lonRad),
    y: cosLat * Math.sin(lonRad),
    z: Math.sin(latRad),
  }
}

function expectSameSpherePoint(actual, expected, tolerance = 1e-6) {
  const a = toUnitSphere(actual)
  const b = toUnitSphere(expected)

  expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThanOrEqual(tolerance)
}

test('Peirce forward: center, non-conformal points, corners, equator midpoints', () => {
  expectPointClose(new WGS84Coords(0, 0).to(NormalizedPeirceCoords), {x: 0, y: -1}, 6)
  expectPointClose(new WGS84Coords(90, 0).to(NormalizedPeirceCoords), {x: 1, y: 0}, 6)
  expectPointClose(new WGS84Coords(0, 90).to(NormalizedPeirceCoords), {x: 0, y: 0}, 6)
  expectPointClose(new WGS84Coords(0, -90).to(NormalizedPeirceCoords), {x: 1, y: -1}, 6)
  expectPointClose(new WGS84Coords(45, 0).to(NormalizedPeirceCoords), {x: 0.5, y: -0.5}, 6)
  expectPointClose(new WGS84Coords(-45, 0).to(NormalizedPeirceCoords), {x: -0.5, y: -0.5}, 6)
  expectPointClose(new WGS84Coords(180, 0).to(NormalizedPeirceCoords), {x: 0, y: 1}, 6)
  expectPointClose(new WGS84Coords(0, 45).to(NormalizedPeirceCoords), {x: 0, y: -0.316887101}, 6)
  expectPointClose(new WGS84Coords(0, -45).to(NormalizedPeirceCoords), {x: 0.683112899, y: -1}, 6)
})

test.each([
  {name: 'origin', point: {x: 0, y: 0}, expected: {x: 0, y: 90}},
  {name: 'south edge', point: {x: 0, y: -1}, expected: {x: 0, y: 0}},
])('Peirce inverse: $name', ({point, expected}) => {
  expectSameSpherePoint(new NormalizedPeirceCoords(point.x, point.y).to(WGS84Coords), expected)
})

test.each(ROUND_TRIP_CASES)('Peirce round-trips lon=$lon lat=$lat', ({lon, lat}) => {
  const projected = new WGS84Coords(lon, lat).to(NormalizedPeirceCoords)
  const inverted = new NormalizedPeirceCoords(projected.x, projected.y).to(WGS84Coords)

  expect(Number.isFinite(projected.x)).toBe(true)
  expect(Number.isFinite(projected.y)).toBe(true)
  expect(Number.isFinite(inverted.x)).toBe(true)
  expect(Number.isFinite(inverted.y)).toBe(true)
  expectSameSpherePoint(inverted, {x: lon, y: lat})
})

test('Normalized Peirce round-trips canonical points', () => {
  const samples = [
    new WGS84Coords(-1, 0),
    new WGS84Coords(0, -1),
    new WGS84Coords(1, 2),
    new WGS84Coords(2, 1),
  ]

  for (const sample of samples) {
    const projected = sample.to(NormalizedPeirceCoords)
    const inverted = new NormalizedPeirceCoords(projected.x, projected.y).to(WGS84Coords)
    expectSameSpherePoint(inverted, sample)
  }
})

test('Grieger Triptychial round-trips representative points', () => {
  const grieger = proj4('EPSG:4326', GRIEGER_CODE)
  const samples = [
    [0, 0],
    [45, 10],
    [-90, -30],
    [135, 40],
  ]

  for (const [lon, lat] of samples) {
    const projected = grieger.forward([lon, lat])
    const inverted = grieger.inverse(projected)
    expectSameSpherePoint({x: inverted[0], y: inverted[1]}, {x: lon, y: lat})
  }
})
