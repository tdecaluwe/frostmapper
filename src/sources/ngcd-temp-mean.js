import { Source } from '../core/cache.js'
import { Grid } from '../core/primitives.js'

const THREDDS_BASE = 'https://thredds.met.no/thredds/ncss/ngcd/type2/v1'

function buildUrl(year, variable, bbox, stride) {
  const params = new URLSearchParams({
    var:         variable,
    north:       bbox.north,
    south:       bbox.south,
    east:        bbox.east,
    west:        bbox.west,
    horizStride: stride,
    time_start:  `${year}-01-01`,
    time_end:    `${year}-12-31`,
    timeStride:  1,
    accept:      'csv',
  })
  return `${THREDDS_BASE}/${year}.nc?${params}`
}

function parseCsv(text, varName) {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return null

  const header  = lines[0].split(',')
  const dateIdx = header.indexOf('date')
  const latIdx  = header.indexOf('lat')
  const lonIdx  = header.indexOf('lon')
  const valIdx  = header.findIndex(h => h === varName)

  if (dateIdx === -1 || latIdx === -1 || lonIdx === -1 || valIdx === -1) return null

  const cellMap   = new Map()
  const cellOrder = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const cols = line.split(',')
    const lat  = parseFloat(cols[latIdx])
    const lon  = parseFloat(cols[lonIdx])
    const val  = parseFloat(cols[valIdx])
    const mmdd = cols[dateIdx].slice(5, 10)
    const key  = `${lat},${lon}`

    if (!cellMap.has(key)) {
      cellMap.set(key, [])
      cellOrder.push(key)
    }
    cellMap.get(key).push({ mmdd, val: isNaN(val) ? null : val })
  }

  return { cellOrder, cellMap }
}

function inWinter(mmdd, winterStart, winterEnd) {
  return mmdd >= winterStart || mmdd <= winterEnd
}

export class NgcdTempMeanSource extends Source {
  #year
  #winterStart
  #winterEnd
  #fetch

  constructor({ id, year, winterStart, winterEnd, transform, persist, _store, _fetch }) {
    super({ id, transform, dtype: 'float32', persist: persist ?? false, _store })
    this.#year        = year
    this.#winterStart = winterStart
    this.#winterEnd   = winterEnd
    this.#fetch       = _fetch ?? globalThis.fetch.bind(globalThis)
  }

  async compute(tileId, signal) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return null

    const text   = await response.text()
    const parsed = parseCsv(text, 'tg')
    if (!parsed) return null

    const { cellOrder, cellMap } = parsed
    const n    = cellOrder.length
    const side = Math.round(Math.sqrt(n))
    const data = new Float32Array(side * side)

    for (let i = 0; i < cellOrder.length; i++) {
      const entries = cellMap.get(cellOrder[i])
        .filter(e => inWinter(e.mmdd, this.#winterStart, this.#winterEnd) && e.val !== null)
      if (entries.length === 0) {
        data[i] = 0
        continue
      }
      const sum = entries.reduce((acc, e) => acc + e.val, 0)
      data[i] = sum / entries.length
    }

    return new Grid({ data, width: side, height: Math.ceil(n / side), dtype: 'float32' })
  }
}
