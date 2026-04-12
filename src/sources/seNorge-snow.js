import { Source } from '../core/cache.js'
import { Grid } from '../core/primitives.js'

const THREDDS_BASE = 'https://thredds.met.no/thredds/ncss/senorge/seNorge_snow/fsw'

const SENORGE_COVERAGE_WEST  =  4
const SENORGE_COVERAGE_EAST  = 32
const SENORGE_COVERAGE_SOUTH = 57
const SENORGE_COVERAGE_NORTH = 71
function buildUrl(year, bbox, stride) {
  const snowYearStart = `${year - 1}-07-01T00:00:00Z`
  const snowYearEnd   = `${year}-06-30T00:00:00Z`
  const params = new URLSearchParams({
    var:          'snow_amount',
    north:        bbox.north,
    south:        bbox.south,
    east:         bbox.east,
    west:         bbox.west,
    horizStride:  stride,
    time_start:   snowYearStart,
    time_end:     snowYearEnd,
    timeStride:   1,
    accept:       'netCDF',
  })
  return `${THREDDS_BASE}/fsw_${year}.nc?${params}`
}

/**
 * Parse a CDF-1 (NetCDF3) binary buffer.
 * Returns { ntime, ny, nx, recSize, snowOffset } or null if parsing fails.
 *
 * Layout assumptions (derived from real seNorge fsw files):
 *   dims: time (record dim, size=0 in header), y, x
 *   vars: snow_amount(time,y,x):float32, time(time):float64
 *   All values big-endian, no global/variable attributes.
 */
function parseNetCdf3(buffer) {
  const bytes = new Uint8Array(buffer)
  const dv    = new DataView(buffer)

  // Validate magic: CDF\x01
  if (bytes[0] !== 0x43 || bytes[1] !== 0x44 || bytes[2] !== 0x46 || bytes[3] !== 0x01) return null

  const numrecs = dv.getUint32(4, false)
  let pos = 8

  function readUint32() {
    const v = dv.getUint32(pos, false)
    pos += 4
    return v
  }

  function readNcStr() {
    const n   = readUint32()
    const str = new TextDecoder().decode(bytes.subarray(pos, pos + n))
    pos += n + (4 - n % 4) % 4
    return str
  }

  // Skip an att_list (global or per-variable attributes)
  function skipAttList() {
    const tag = readUint32() // NC_ATTRIBUTE (0xC) or ABSENT (0)
    if (tag !== 0 && tag !== 0xC) return // unexpected — best effort
    const count = readUint32()
    for (let i = 0; i < count; i++) {
      readNcStr()
      const nc_type = readUint32()
      const nelems  = readUint32()
      // byte sizes per nc_type: NC_BYTE=1, NC_CHAR=1, NC_SHORT=2, NC_INT=4, NC_FLOAT=4, NC_DOUBLE=8
      const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 6: 8 }
      const nbytes = (sizes[nc_type] || 1) * nelems
      pos += nbytes + (4 - nbytes % 4) % 4
    }
  }

  // Read dim_list
  const dimTag = readUint32() // NC_DIMENSION (0xA) or ABSENT
  if (dimTag !== 0 && dimTag !== 0xA) return null
  const ndims = readUint32()
  const dims  = []
  for (let i = 0; i < ndims; i++) {
    const name = readNcStr()
    const size = readUint32()
    dims.push({ name, size: size === 0 ? numrecs : size })
  }

  skipAttList() // global attributes

  // Read var_list
  const varTag = readUint32() // NC_VARIABLE (0xB) or ABSENT
  if (varTag !== 0 && varTag !== 0xB) return null
  const nvars = readUint32()

  let snowOffset  = -1
  let snowPerRec  = 0
  let totalRecSize = 0
  let ny = 0
  let nx = 0
  const ntime = numrecs

  for (let i = 0; i < nvars; i++) {
    const name     = readNcStr()
    const ndimids  = readUint32()
    const dimIds   = []
    for (let j = 0; j < ndimids; j++) dimIds.push(readUint32())
    skipAttList()
    /* const nc_type = */ readUint32()
    const vsize  = readUint32()
    const offset = readUint32()

    // Accumulate total record size (sum of all record-variable vsizes)
    totalRecSize += vsize

    if (name === 'snow_amount') {
      snowOffset = offset
      snowPerRec = vsize
      if (dimIds.length >= 3) {
        ny = dims[dimIds[1]]?.size ?? 0
        nx = dims[dimIds[2]]?.size ?? 0
      }
    }
  }

  if (snowOffset < 0 || ny === 0 || nx === 0) return null

  return { ntime, ny, nx, recSize: totalRecSize, snowOffset }
}

function longestConsecutiveRun(series, threshold) {
  let best    = 0
  let current = 0
  for (const val of series) {
    if (val >= threshold) {
      current++
      if (current > best) best = current
    } else {
      current = 0
    }
  }
  return Math.min(best, 255)
}

export class SeNorgeSnowSource extends Source {
  #year
  #threshold
  #fetch

  constructor({ id, year, threshold, transform, dtype, persist, _store, _fetch }) {
    super({ id, transform, dtype: dtype ?? 'uint8', persist: persist ?? false, _store })
    this.#year      = year
    this.#threshold = threshold
    this.#fetch     = _fetch ?? globalThis.fetch.bind(globalThis)
  }

  async compute(tileId, signal) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const bbox = tileId.extent.toBoundingBox('EPSG:4326')
    if (bbox.east  < SENORGE_COVERAGE_WEST  ||
        bbox.west  > SENORGE_COVERAGE_EAST  ||
        bbox.north < SENORGE_COVERAGE_SOUTH ||
        bbox.south > SENORGE_COVERAGE_NORTH) {
      return null
    }

    const url  = buildUrl(this.#year, bbox, tileId.stride)

    const response = await this.#fetch(url, { signal })
    if (!response.ok) return null

    const buffer = await response.arrayBuffer()
    const parsed = parseNetCdf3(buffer)
    if (!parsed) return null

    const { ntime, ny, nx, recSize, snowOffset } = parsed
    const dv   = new DataView(buffer)
    const n    = ny * nx
    const data = new Uint8Array(n)

    for (let cell = 0; cell < n; cell++) {
      const y      = Math.floor(cell / nx)
      const x      = cell % nx
      const series = []
      for (let t = 0; t < ntime; t++) {
        const byteOff = snowOffset + t * recSize + (y * nx + x) * 4
        series.push(dv.getFloat32(byteOff, false)) // big-endian
      }
      data[cell] = longestConsecutiveRun(series, this.#threshold)
    }

    return new Grid({ data, width: nx, height: ny, dtype: 'uint8' })
  }
}
