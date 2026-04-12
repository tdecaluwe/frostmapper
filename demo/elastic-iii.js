import Projection from 'ol/proj/Projection.js'
import {addCoordinateTransforms, addProjection, get as getProjection, transform} from 'ol/proj.js'

import elasticIIIText from './data/elastic-III.txt?raw'

export const ELASTIC_III_CODE = 'EPSG:ELASTIC_III'

const PI = Math.PI

function parseNums(line) {
  return line.split(',').map((part) => Number(part.trim()))
}

function parseData(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  let i = 0
  const next = () => lines[i++]

  const sections = []
  while (i < lines.length && !lines[i].startsWith('section ')) i += 1
  while (i < lines.length && lines[i].startsWith('section ')) {
    next()
    const boundaryHeader = next()
    const boundaryCount = Number(boundaryHeader.match(/\((\d+) vertices\)/)[1])
    const boundary = []
    for (let v = 0; v < boundaryCount; v += 1) {
      const [lat, lon] = parseNums(next())
      boundary.push([lon, lat])
    }

    const projectedHeader = next()
    const pm = projectedHeader.match(/\((\d+)x(\d+) points\)/)
    const rows = Number(pm[1])
    const cols = Number(pm[2])
    const projected = []
    for (let r = 0; r < rows; r += 1) {
      projected.push(parseNums(next()))
    }

    sections.push({ boundary, rows, cols, projected })
  }

  while (i < lines.length && !lines[i].startsWith('projected boundary')) i += 1
  const projectedBoundaryHeader = next()
  const boundaryCount = Number(projectedBoundaryHeader.match(/\((\d+) vertices\)/)[1])
  const projectedBoundary = []
  for (let v = 0; v < boundaryCount; v += 1) {
    const [x, y] = parseNums(next())
    projectedBoundary.push([x, y])
  }

  while (i < lines.length && !lines[i].startsWith('inverse-projected points')) i += 1
  const inverseHeader = next()
  const im = inverseHeader.match(/\((\d+)x(\d+) points\)/)
  const invRows = Number(im[1])
  const invCols = Number(im[2])
  const bbox = parseNums(next())
  const inverse = []
  for (let r = 0; r < invRows; r += 1) {
    inverse.push(parseNums(next()))
  }

  return {sections, projectedBoundary, inverse: {rows: invRows, cols: invCols, bbox, grid: inverse}}
}

const model = parseData(elasticIIIText)

function pointInRing(point, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const hit = (yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + 1e-12) + xi
    if (hit) inside = !inside
  }
  return inside
}

function chooseSection(lonLat) {
  return model.sections.find((section) => pointInRing(lonLat, section.boundary)) || model.sections[0]
}

function bilinear(table, rows, cols, rowF, colF) {
  const r0 = Math.max(0, Math.min(rows - 2, Math.floor(rowF)))
  const c0 = Math.max(0, Math.min(cols - 2, Math.floor(colF)))
  const r1 = r0 + 1
  const c1 = c0 + 1
  const tr = rowF - r0
  const tc = colF - c0
  const p00 = table[r0][c0]
  const p10 = table[r1][c0]
  const p01 = table[r0][c1]
  const p11 = table[r1][c1]
  if (![p00, p10, p01, p11].every((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return null
  const x = (1 - tr) * ((1 - tc) * p00[0] + tc * p01[0]) + tr * ((1 - tc) * p10[0] + tc * p11[0])
  const y = (1 - tr) * ((1 - tc) * p00[1] + tc * p01[1]) + tr * ((1 - tc) * p10[1] + tc * p11[1])
  return [x, y]
}

function rowPairs(gridRow) {
  const pairs = []
  for (let i = 0; i < gridRow.length; i += 2) pairs.push([gridRow[i], gridRow[i + 1]])
  return pairs
}

function forwardFromSection(section, lonLat) {
  const lon = lonLat[0]
  const lat = lonLat[1]
  const rowF = ((90 - lat) / 180) * (section.rows - 1)
  const colF = ((lon + 180) / 360) * (section.cols - 1)
  const grid = section.projected.map(rowPairs)
  return bilinear(grid, section.rows, section.cols, rowF, colF) || [NaN, NaN]
}

function inverseFromGrid(coords) {
  const {rows, cols, bbox, grid} = model.inverse
  const [minX, minY, maxX, maxY] = bbox
  const xF = ((coords[0] - minX) / (maxX - minX)) * (cols - 1)
  const yF = ((coords[1] - minY) / (maxY - minY)) * (rows - 1)
  const table = grid.map(rowPairs)
  return bilinear(table, rows, cols, yF, xF)
}

export function projectLonLatToElasticIII(lonLat) {
  return forwardFromSection(chooseSection(lonLat), lonLat)
}

export function unprojectElasticIIIToLonLat(coords) {
  const inverse = inverseFromGrid(coords)
  return inverse || [NaN, NaN]
}

export function registerElasticIIIProjection() {
  if (getProjection(ELASTIC_III_CODE)) return
  const projection = new Projection({
    code: ELASTIC_III_CODE,
    units: 'm',
    extent: [-14000000, -9000000, 14000000, 9000000],
    worldExtent: [-180, -90, 180, 90],
    global: true,
  })
  addProjection(projection)
  addCoordinateTransforms('EPSG:4326', projection, projectLonLatToElasticIII, unprojectElasticIIIToLonLat)
  addCoordinateTransforms(
    'EPSG:3857',
    projection,
    (coordinate) => projectLonLatToElasticIII(transform(coordinate, 'EPSG:3857', 'EPSG:4326')),
    (coordinate) => transform(unprojectElasticIIIToLonLat(coordinate), 'EPSG:4326', 'EPSG:3857'),
  )
}
