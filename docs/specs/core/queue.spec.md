# Spec: `core/queue.js`

## Purpose

A priority queue for managing sequential HTTP requests to a single API endpoint. One Queue instance is created per API (THREDDS, hoydedata, Overpass, OpenRouteService). Ensures at most one request is in flight at a time, dispatches tasks in priority order, and supports cancellation of pending and in-flight tasks.

---

## Interface

```javascript
class Queue {
  constructor(name)
  enqueue(taskFn, priority, id)  // returns Promise
  cancel(id)                      // returns void
  cancelAll()                     // returns void
}
```

---

## Parameters

### `constructor(name)`
- `name` — string, used for debugging only (e.g. `'thredds'`, `'hoydedata'`)

### `enqueue(taskFn, priority, id)`
- `taskFn` — `async (signal) => result` — the work to perform. Receives an AbortSignal. Must check `signal.aborted` between sub-requests for cooperative cancellation.
- `priority` — number ≥ 0. Distance from viewport center in meters. Lower = higher priority. 0 = viewport center.
- `id` — string. Unique identifier for this task. Used for cancellation. If a task with the same `id` is already queued or in flight, the new enqueue call returns the existing promise without adding a duplicate.
- Returns a Promise that resolves with the task result or rejects if the task fails or is cancelled.

### `cancel(id)`
- If the task is pending: removes it from the queue and rejects its promise with `new DOMException('Cancelled', 'AbortError')`
- If the task is in flight: calls `controller.abort()` on its AbortController. The taskFn is responsible for detecting `signal.aborted` and stopping work. The promise rejects with `AbortError` when the taskFn rejects.
- If the task is not found: no-op.

### `cancelAll()`
- Cancels all pending tasks and the in-flight task if any.
- All associated promises reject with `AbortError`.

---

## Internal data structures

### Heap
A min-heap ordered by `priority` (ascending). Each heap entry:
```javascript
{
  id: string,
  priority: number,
  taskFn: async (signal) => any,
  resolve: Function,
  reject: Function
}
```

### In-flight slot
```javascript
{
  id: string,
  controller: AbortController
}
```
`null` when idle.

### ID index
A `Map<string, heapEntry>` for O(1) lookup by id. Entries are removed when dequeued or cancelled.

---

## Behaviour

### Dispatch loop
The queue maintains a single dispatch loop:
1. If in-flight slot is occupied, do nothing — dispatch is called again when the current task settles.
2. Pop the lowest-priority entry from the heap.
3. Create a new `AbortController`. Store `{ id, controller }` in the in-flight slot.
4. Call `taskFn(controller.signal)`.
5. On settle (resolve or reject): clear the in-flight slot, call dispatch again.

### Deduplication
`enqueue` checks the ID index before inserting. If the ID already exists in the heap or is currently in flight, return the existing promise. Do not insert a duplicate.

### Priority update
If `enqueue` is called with an existing `id` but a different `priority`:
- If the task is **pending**: update its priority in the heap and re-heapify. Return the existing promise.
- If the task is **in-flight**: no-op — the task is already executing, priority is irrelevant. Return the existing promise.
This allows Layers to re-submit chunks with updated priorities as the viewport changes without creating duplicates.

---

## Error handling
- If `taskFn` throws or rejects for any reason other than `AbortError`, the promise rejects with that error. The queue continues dispatching.
- `AbortError` rejections are expected and treated as normal cancellation — the queue continues dispatching.

---

## Test cases

### 1. Basic sequential dispatch
Enqueue 3 tasks with priorities 100, 50, 200. Verify they execute in order: 50, 100, 200. Verify each task starts only after the previous one resolves.

### 2. Priority ordering
Enqueue tasks A(priority=200), B(priority=50), C(priority=10) in that order, but fast enough that A is in flight before B and C are enqueued. Verify execution order is A, C, B (A already in flight, then lowest priority first).

### 3. Cancel pending task
Enqueue tasks A and B. While A is in flight, cancel B. Verify B's promise rejects with AbortError. Verify A completes normally.

### 4. Cancel in-flight task
Enqueue task A then task B. While A is in flight, cancel A. Verify signal.aborted is true inside taskFn. Verify A's promise rejects with AbortError. Verify B starts executing after A is cancelled.

### 5. Deduplication
Enqueue task with id='chunk-1' twice. Verify taskFn is only called once. Verify both enqueue calls return the same promise.

### 6. Priority update — pending task
Enqueue tasks A(id='a', priority=100) and B(id='b', priority=200). Then re-enqueue B with priority=10 before A completes. Verify B executes before any lower-priority tasks (i.e. B is next after A completes).

### 7. Priority update — in-flight task
Enqueue task A(id='a', priority=100). While A is in flight, re-enqueue A with priority=0. Verify the existing promise is returned unchanged. Verify A continues executing normally — no restart, no abort.

### 8. cancelAll
Enqueue 3 tasks. Call cancelAll(). Verify all promises reject with AbortError. Verify in-flight task receives abort signal.

### 9. Empty queue operations
Call `cancel('nonexistent-id')` on an empty queue. Verify no error thrown. Call `cancelAll()` on an empty queue. Verify no error thrown.

### 10. Queue resumes after failure
Enqueue tasks A and B. Task A rejects with a non-AbortError. Verify A's promise rejects with that error. Verify B still executes normally after A's failure.

### 11. Synchronous throw in taskFn
Enqueue a task whose taskFn throws synchronously (not returns a rejected promise). Verify the task's promise rejects. Verify the queue continues dispatching subsequent tasks.

### 12. Priority=0 minimum value
Enqueue a task with priority=0. Verify it is accepted and executes normally. Verify it executes before any task with priority > 0.

---

## Notes
- No retry logic — callers are responsible for re-enqueueing on failure if desired.
- The queue does not know about Sources, chunks, or viewports — it is a generic priority task queue.
- One Queue instance is shared across all Sources using the same API. Queue instances are created once at app startup and passed to Sources via dependency injection.
