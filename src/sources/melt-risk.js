import { Source } from '../core/cache.js'
import { Grid } from '../core/primitives.js'

function percentileIndex(pct, length) {
  return Math.floor(pct / 100 * (length - 1))
}

async function aggregateByPercentile(childSources, tileId, signal, percentile, dtype) {
  const cellValues = []

  for (const child of childSources) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const { extent } = tileId
    const resolution = tileId.cellSize
    for await (const chunk of child.get(extent, resolution, signal)) {
      const data = chunk.grid.data
      for (let i = 0; i < data.length; i++) {
        if (!cellValues[i]) cellValues[i] = []
        cellValues[i].push(data[i])
      }
    }
  }

  if (cellValues.length === 0) return null

  const numCells = cellValues.length
  const Ctor = dtype === 'float32' ? Float32Array : Uint8Array
  const result = new Ctor(numCells)

  for (let i = 0; i < numCells; i++) {
    const sorted = cellValues[i].slice().sort((a, b) => a - b)
    result[i] = sorted[percentileIndex(percentile, sorted.length)]
  }

  const side = Math.round(Math.sqrt(numCells))
  return new Grid({ data: result, width: side, height: Math.ceil(numCells / side), dtype })
}

export class MeltRiskSource extends Source {
  #childSources
  #percentile

  constructor({ id, childSources, percentile, transform, persist, _store }) {
    super({ id, transform, dtype: 'uint8', persist: persist ?? false, _store })
    this.#childSources = childSources
    this.#percentile   = percentile
  }

  get childSourceCount() { return this.#childSources.length }

  async compute(tileId, signal) {
    return aggregateByPercentile(this.#childSources, tileId, signal, this.#percentile, 'uint8')
  }
}
