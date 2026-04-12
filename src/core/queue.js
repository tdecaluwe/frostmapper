/**
 * core/queue.js
 *
 * Priority queue for managing sequential HTTP requests to a single API endpoint.
 * One Queue instance is created per API (THREDDS, hoydedata, Overpass, OpenRouteService).
 *
 * - At most one request in-flight at a time
 * - Tasks dispatched in priority order (lower priority value = dispatched first)
 * - Deduplication by id: re-enqueueing an existing id returns the existing promise
 * - Priority update: re-enqueueing an existing pending id with a new priority re-heapifies
 * - Cancellation of pending or in-flight tasks
 */

export class Queue {
  /**
   * @param {string} name - Debug label (e.g. 'thredds', 'hoydedata')
   */
  constructor(name) {
    this.name = name

    // Min-heap entries: { id, priority, taskFn, resolve, reject, promise }
    this._heap = []

    // O(1) lookup by id — covers ONLY pending (queued) tasks
    // value: heap entry object (same reference as in _heap)
    this._pending = new Map()

    // In-flight slot: { id, controller, promise } | null
    this._inflight = null
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Enqueue a task. Returns a Promise that resolves/rejects when the task settles.
   *
   * @param {function} taskFn   - async (signal: AbortSignal) => result
   * @param {number}   priority - Distance from viewport centre in metres. Lower = higher priority.
   * @param {string}   id       - Unique task identifier (used for deduplication and cancellation)
   * @returns {Promise<any>}
   */
  enqueue(taskFn, priority, id) {
    // --- Deduplication: already in-flight ---
    if (this._inflight && this._inflight.id === id) {
      return this._inflight.promise
    }

    // --- Deduplication / priority update: already pending ---
    if (this._pending.has(id)) {
      const existing = this._pending.get(id)
      if (existing.priority !== priority) {
        existing.priority = priority
        this._rebuild()
      }
      return existing.promise
    }

    // --- New task ---
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    const entry = { id, priority, taskFn, resolve, reject, promise }
    this._pending.set(id, entry)
    this._heapPush(entry)
    this._dispatch()
    return promise
  }

  /**
   * Cancel a task by id.
   * - Pending: removed from heap, promise rejects with AbortError.
   * - In-flight: AbortController is aborted; promise rejects when taskFn rejects.
   * - Not found: no-op.
   *
   * @param {string} id
   */
  cancel(id) {
    // Pending cancellation
    if (this._pending.has(id)) {
      const entry = this._pending.get(id)
      this._pending.delete(id)
      this._heapRemove(entry)
      entry.reject(new DOMException('Cancelled', 'AbortError'))
      return
    }
    // In-flight cancellation
    if (this._inflight && this._inflight.id === id) {
      this._inflight.controller.abort()
    }
  }

  /**
   * Cancel all pending tasks and the in-flight task if any.
   * All associated promises reject with AbortError.
   */
  cancelAll() {
    // Cancel all pending
    for (const entry of this._pending.values()) {
      entry.reject(new DOMException('Cancelled', 'AbortError'))
    }
    this._pending.clear()
    this._heap = []

    // Cancel in-flight
    if (this._inflight) {
      this._inflight.controller.abort()
    }
  }

  // ---------------------------------------------------------------------------
  // Internal dispatch loop
  // ---------------------------------------------------------------------------

  _dispatch() {
    // Only dispatch if idle
    if (this._inflight !== null) return
    if (this._heap.length === 0) return

    const entry = this._heapPop()
    this._pending.delete(entry.id)

    const controller = new AbortController()

    // Store inflight slot immediately so deduplication works
    this._inflight = { id: entry.id, controller, promise: entry.promise }

    entry.taskFn(controller.signal).then(
      result => {
        entry.resolve(result)
        this._inflight = null
        this._dispatch()
      },
      err => {
        entry.reject(err)
        this._inflight = null
        this._dispatch()
      }
    )
  }

  // ---------------------------------------------------------------------------
  // Min-heap operations (keyed by .priority)
  // ---------------------------------------------------------------------------

  _heapPush(entry) {
    this._heap.push(entry)
    this._siftUp(this._heap.length - 1)
  }

  _heapPop() {
    if (this._heap.length === 0) return undefined
    const top = this._heap[0]
    const last = this._heap.pop()
    if (this._heap.length > 0) {
      this._heap[0] = last
      this._siftDown(0)
    }
    return top
  }

  /** Remove a specific entry from the heap (linear scan). */
  _heapRemove(entry) {
    const idx = this._heap.indexOf(entry)
    if (idx === -1) return
    const last = this._heap.pop()
    if (idx < this._heap.length) {
      this._heap[idx] = last
      this._siftUp(idx)
      this._siftDown(idx)
    }
  }

  /** Rebuild heap from scratch (used after priority update). */
  _rebuild() {
    const entries = [...this._heap]
    this._heap = []
    for (const e of entries) this._heapPush(e)
  }

  _siftUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this._heap[parent].priority <= this._heap[i].priority) break
      this._swap(parent, i)
      i = parent
    }
  }

  _siftDown(i) {
    const n = this._heap.length
    while (true) {
      const left = 2 * i + 1
      const right = 2 * i + 2
      let smallest = i
      if (left < n  && this._heap[left].priority  < this._heap[smallest].priority) smallest = left
      if (right < n && this._heap[right].priority < this._heap[smallest].priority) smallest = right
      if (smallest === i) break
      this._swap(smallest, i)
      i = smallest
    }
  }

  _swap(a, b) {
    ;[this._heap[a], this._heap[b]] = [this._heap[b], this._heap[a]]
  }
}

/**
 * Backwards-compatible helper: create a set of named queues used by sources.
 * Returns an object mapping queue names to `Queue` instances. Callers can
 * pass this object into `registerSource()` (legacy API) but the new cache
 * implementation does not require it; we provide it for compatibility.
 */
export function createQueues() {
  return {
    thredds: new Queue('thredds'),
    s3: new Queue('s3'),
    overpass: new Queue('overpass'),
    openrouteservice: new Queue('openrouteservice'),
  }
}
