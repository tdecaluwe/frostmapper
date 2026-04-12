/**
 * tests/core/queue.test.js
 *
 * Unit tests for Queue in core/queue.js
 * Tests spec cases 1–7.
 */

import { describe, it, expect } from 'vitest'
import { Queue } from '../../src/core/queue.js'

// Helper: create a controlled async task
// resolveRef.resolve() / .reject() let tests control when tasks settle
function makeControlledTask() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  const taskFn = (_signal) => promise
  return { taskFn, resolve, reject, promise }
}

// Small sleep helper
const sleep = ms => new Promise(r => setTimeout(r, ms))

describe('Queue — basic sequential dispatch', () => {
  it('test 1: executes tasks in priority order (lower = first)', async () => {
    const q = new Queue('test')
    const order = []

    // Enqueue 3 tasks: first one (100) starts immediately and blocks
    const { taskFn: fn1, resolve: res1 } = makeControlledTask()
    const p1 = q.enqueue(async (sig) => { await fn1(sig); order.push(100); return 100 }, 100, 'a')

    // Wait a tick so 'a' is in-flight
    await sleep(5)

    // Enqueue remaining with different priorities
    const p2 = q.enqueue(async () => { order.push(50); return 50 }, 50, 'b')
    const p3 = q.enqueue(async () => { order.push(200); return 200 }, 200, 'c')

    // Let task A finish
    res1()
    const [r1, r2, r3] = await Promise.all([p1, p2, p3])

    // After A: B (priority 50) executes before C (priority 200)
    expect(order).toEqual([100, 50, 200])
    expect(r1).toBe(100)
    expect(r2).toBe(50)
    expect(r3).toBe(200)
  })
})

describe('Queue — cancel pending task', () => {
  it('test 3: cancel pending — rejects with AbortError, in-flight unaffected', async () => {
    const q = new Queue('test')
    const { taskFn: fn1, resolve: res1 } = makeControlledTask()

    // Task A in-flight
    const pA = q.enqueue(async s => { await fn1(s); return 'A' }, 0, 'taskA')
    await sleep(5)

    // Task B pending
    const pB = q.enqueue(async () => 'B', 1, 'taskB')

    // Cancel pending B
    q.cancel('taskB')

    await expect(pB).rejects.toMatchObject({ name: 'AbortError' })

    // A still completes normally
    res1()
    expect(await pA).toBe('A')
  })
})

describe('Queue — cancel in-flight task', () => {
  it('test 4: cancelling in-flight aborts the signal', async () => {
    const q = new Queue('test')
    let capturedSignal

    const pA = q.enqueue(async signal => {
      capturedSignal = signal
      await sleep(100)  // will be interrupted by abort
      if (signal.aborted) throw new DOMException('', 'AbortError')
      return 'done'
    }, 0, 'taskA')

    await sleep(5)
    q.cancel('taskA')

    await expect(pA).rejects.toMatchObject({ name: 'AbortError' })
    expect(capturedSignal.aborted).toBe(true)
  })

  it('queue continues dispatching after in-flight cancel', async () => {
    const q = new Queue('test')

    const pA = q.enqueue(async signal => {
      await sleep(50)
      if (signal.aborted) throw new DOMException('', 'AbortError')
      return 'A'
    }, 0, 'taskA')

    const pB = q.enqueue(async () => 'B', 1, 'taskB')

    await sleep(5)
    q.cancel('taskA')

    await expect(pA).rejects.toMatchObject({ name: 'AbortError' })
    expect(await pB).toBe('B')
  })
})

describe('Queue — deduplication', () => {
  it('test 5: same id returns same promise, taskFn called once', async () => {
    const q = new Queue('test')
    let callCount = 0

    const { taskFn: fn1, resolve: res1 } = makeControlledTask()
    // Keep queue busy so second enqueue is pending
    q.enqueue(async s => { await fn1(s) }, 0, 'blocker')
    await sleep(5)

    const taskFn = async () => { callCount++; return 'result' }
    const p1 = q.enqueue(taskFn, 10, 'dup-id')
    const p2 = q.enqueue(taskFn, 20, 'dup-id')

    expect(p1).toBe(p2)

    res1()
    await p1

    expect(callCount).toBe(1)
  })
})

describe('Queue — priority update', () => {
  it('test 6: re-enqueue with lower priority brings task forward', async () => {
    const q = new Queue('test')

    const { taskFn: fn1, resolve: res1 } = makeControlledTask()
    // A is in-flight
    const pA = q.enqueue(async s => { await fn1(s); return 'A' }, 0, 'A')
    await sleep(5)

    // B starts at priority 200, C at priority 10
    const pB = q.enqueue(async () => 'B', 200, 'B')
    const pC = q.enqueue(async () => 'C', 10, 'C')

    // Re-enqueue B with priority 1 — should jump ahead of C
    const pB2 = q.enqueue(async () => 'B', 1, 'B')
    expect(pB).toBe(pB2)  // same promise returned

    const order = []
    pB.then(() => order.push('B'))
    pC.then(() => order.push('C'))

    res1()
    await Promise.all([pA, pB, pC])

    expect(order).toEqual(['B', 'C'])
  })
})

describe('Queue — cancelAll', () => {
  it('test 7: cancelAll rejects all promises with AbortError', async () => {
    const q = new Queue('test')
    const { taskFn: fn1, resolve: res1 } = makeControlledTask()

    // A in-flight
    const pA = q.enqueue(async signal => {
      await fn1(signal)
      if (signal.aborted) throw new DOMException('', 'AbortError')
      return 'A'
    }, 0, 'A')
    await sleep(5)

    // B and C pending
    const pB = q.enqueue(async () => 'B', 1, 'B')
    const pC = q.enqueue(async () => 'C', 2, 'C')

    q.cancelAll()
    res1()  // unblock the in-flight task (it then sees signal.aborted)

    await expect(pA).rejects.toMatchObject({ name: 'AbortError' })
    await expect(pB).rejects.toMatchObject({ name: 'AbortError' })
    await expect(pC).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('Queue — error handling', () => {
  it('non-abort errors propagate and queue continues', async () => {
    const q = new Queue('test')

    const pA = q.enqueue(async () => { throw new Error('boom') }, 0, 'A')
    const pB = q.enqueue(async () => 'ok', 1, 'B')

    await expect(pA).rejects.toThrow('boom')
    expect(await pB).toBe('ok')
  })
})

