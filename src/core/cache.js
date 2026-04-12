import { Grid, TileId, Chunk } from './primitives.js'

const memoryCache = new Map()

const pendingComputes = new Map()

let idbPromise = null

function getIdb() {
  if (idbPromise) return idbPromise
  idbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('geo-scouting-cache', 1)
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('chunks', { keyPath: 'key' })
    }
    req.onsuccess = e => resolve(e.target.result)
    req.onerror   = e => reject(e.target.error)
  })
  return idbPromise
}

async function idbGet(key) {
  try {
    const db = await getIdb()
    return await new Promise((resolve, reject) => {
      const tx  = db.transaction('chunks', 'readonly')
      const req = tx.objectStore('chunks').get(key)
      req.onsuccess = e => resolve(e.target.result ? e.target.result.data : null)
      req.onerror   = e => reject(e.target.error)
    })
  } catch (err) {
    console.warn('idbGet failed:', err)
    return null
  }
}

async function idbSet(key, buffer) {
  try {
    const db = await getIdb()
    await new Promise((resolve, reject) => {
      const tx    = db.transaction('chunks', 'readwrite')
      const store = tx.objectStore('chunks')
      const req   = store.put({ key, data: buffer, timestamp: Date.now() })
      req.onsuccess = () => resolve()
      req.onerror   = e => reject(e.target.error)
    })
  } catch (err) {
    console.warn('idbSet failed:', err)
  }
}

export function clearMemoryCache() {
  memoryCache.clear()
}

function nearestPowerOf2AboveOrEqual(x) {
  const rounded = Math.round(x * 1e6) / 1e6
  if (rounded <= 1) return 1
  let p = 1
  while (p < rounded) p *= 2
  return p
}

const TYPED_ARRAY_CTOR = {
  float32: Float32Array,
  uint8:   Uint8Array,
  uint16:  Uint16Array,
}

export class Source {
  constructor({ id, transform, dtype, persist = false, _store = null }) {
    this.id        = id
    this.transform = transform
    this.dtype     = dtype
    this.persist   = persist
    this._store    = _store
  }

  async *get(extent, resolution, signal) {
    const { nativeCRS } = this.transform
    const nativeExtent = extent.cover(nativeCRS)
    const nativeResolution = extent.translateResolution(resolution, nativeCRS)
    const stride = nearestPowerOf2AboveOrEqual(nativeResolution / this.transform.baseResolution)

    const { originX, originY, chunkSize } = this.transform
    const minChunkX = Math.floor((nativeExtent.west  - originX) / chunkSize)
    const maxChunkX = Math.floor((nativeExtent.east  - originX) / chunkSize)
    const minChunkY = Math.floor((nativeExtent.south - originY) / chunkSize)
    const maxChunkY = Math.floor((nativeExtent.north - originY) / chunkSize)

    for (let cy = minChunkY; cy <= maxChunkY; cy++) {
      for (let cx = minChunkX; cx <= maxChunkX; cx++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

        const tileId = new TileId({ chunkX: cx, chunkY: cy, stride, transform: this.transform })
        const cached = await this.#getCached(tileId)

        if (cached) {
          yield cached
          continue
        }

        const key = this.id + ':' + tileId.toString()
        let promise = pendingComputes.get(key)
        if (!promise) {
          promise = Promise.resolve().then(() => this.compute(tileId, signal))
          pendingComputes.set(key, promise)
          promise.catch(() => {}).finally(() => pendingComputes.delete(key))
        }

        const grid = await promise
        if (grid == null) continue
        const chunk = new Chunk({ tileId, grid })
        await this.#setCached(tileId, chunk)
        yield chunk
      }
    }
  }

  async compute(_tileId, _signal) {
    throw new Error('NotImplementedError: Source.compute() must be overridden')
  }

  async #storeGet(key) {
    if (this._store) return this._store.get(key)
    return idbGet(key)
  }

  async #storeSet(key, buffer) {
    if (this._store) return this._store.set(key, buffer)
    return idbSet(key, buffer)
  }

  async #getCached(tileId) {
    const key = this.id + ':' + tileId.toString()

    const memBuf = memoryCache.get(key)
    if (memBuf) {
      memoryCache.set(key + '__ts', Date.now())
      return this.#reconstruct(tileId, memBuf)
    }

    if (this.persist) {
      const buf = await this.#storeGet(key)
      if (buf) {
        memoryCache.set(key, buf)
        memoryCache.set(key + '__ts', Date.now())
        return this.#reconstruct(tileId, buf)
      }
    }

    return null
  }

  async #setCached(tileId, chunk) {
    const key    = this.id + ':' + tileId.toString()
    const buffer = chunk.grid.toArrayBuffer()
    memoryCache.set(key, buffer)
    memoryCache.set(key + '__ts', Date.now())
    if (this.persist) {
      await this.#storeSet(key, buffer)
    }
  }

  #reconstruct(tileId, buffer) {
    const Ctor  = TYPED_ARRAY_CTOR[this.dtype] ?? Float32Array
    const cells = tileId.cellsPerSide
    const grid  = new Grid({ data: new Ctor(buffer), width: cells, height: cells, dtype: this.dtype })
    return new Chunk({ tileId, grid })
  }
}
