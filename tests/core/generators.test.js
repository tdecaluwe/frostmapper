import { describe, it, expect } from 'vitest'
import { merge, groupBy } from '../../src/core/generators.js'

async function* gen(values, delayMs = 0) {
  for (const v of values) {
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
    yield v
  }
}

async function* throwAfterFirst(firstValue) {
  yield firstValue
  throw new Error('generator error')
}

async function collect(asyncGen) {
  const results = []
  for await (const v of asyncGen) results.push(v)
  return results
}

describe('merge — single generator passthrough (test 1)', () => {
  it('yields all values from a single generator in order', async () => {
    const result = await collect(merge(gen([1, 2, 3])))
    expect(result).toEqual([1, 2, 3])
  })
})

describe('merge — two generators, all values yielded (test 2)', () => {
  it('yields all values from both generators (order may vary)', async () => {
    const result = await collect(merge(gen([1, 2]), gen([3, 4])))
    expect(result).toHaveLength(4)
    expect(result).toContain(1)
    expect(result).toContain(2)
    expect(result).toContain(3)
    expect(result).toContain(4)
  })
})

describe('merge — concurrency, faster generator yields first (test 3)', () => {
  it('gen2 (1ms delay) yields before gen1 (10ms delay)', async () => {
    async function* slowGen() { await new Promise(r => setTimeout(r, 10)); yield 'slow' }
    async function* fastGen() { await new Promise(r => setTimeout(r,  1)); yield 'fast' }
    const result = await collect(merge(slowGen(), fastGen()))
    expect(result[0]).toBe('fast')
    expect(result[1]).toBe('slow')
  })
})

describe('merge — empty generator (test 4)', () => {
  it('merge(gen([])) yields nothing', async () => {
    const result = await collect(merge(gen([])))
    expect(result).toEqual([])
  })
})

describe('merge — zero generators (test 5)', () => {
  it('merge() yields nothing and completes', async () => {
    const result = await collect(merge())
    expect(result).toEqual([])
  })
})

describe('merge — one generator throws (test 6)', () => {
  it('error from a throwing generator propagates out of merge', async () => {
    async function* throwingGen() { throw new Error('boom') }
    await expect(collect(merge(gen([1, 2]), throwingGen()))).rejects.toThrow('boom')
  })
})

describe('merge — uneven generators (test 7)', () => {
  it('yields all 4 values when generators have different lengths', async () => {
    const result = await collect(merge(gen([1, 2, 3]), gen([4])))
    expect(result).toHaveLength(4)
    expect(result).toContain(1)
    expect(result).toContain(4)
  })
})

describe('groupBy — basic grouping (test 8)', () => {
  it('yields complete group for key=a; discards incomplete key=b', async () => {
    const items = [{ key: 'a', v: 1 }, { key: 'b', v: 2 }, { key: 'a', v: 3 }]
    const groups = await collect(groupBy(gen(items), x => x.key, 2))
    expect(groups).toHaveLength(1)
    expect(groups[0].map(x => x.v).sort()).toEqual([1, 3])
  })
})

describe('groupBy — multiple complete groups (test 9)', () => {
  it('yields both groups when both reach expectedCount', async () => {
    const items = [
      { key: 'a', v: 1 }, { key: 'b', v: 2 },
      { key: 'a', v: 3 }, { key: 'b', v: 4 },
    ]
    const groups = await collect(groupBy(gen(items), x => x.key, 2))
    expect(groups).toHaveLength(2)
    for (const group of groups) {
      expect(group).toHaveLength(2)
      expect(group[0].key).toBe(group[1].key)
    }
  })
})

describe('groupBy — expectedCount=1 (test 10)', () => {
  it('each value is yielded immediately as a single-element array', async () => {
    const items = [{ k: 'a' }, { k: 'b' }, { k: 'c' }]
    const groups = await collect(groupBy(gen(items), x => x.k, 1))
    expect(groups).toHaveLength(3)
    for (const group of groups) {
      expect(group).toHaveLength(1)
    }
  })
})

describe('groupBy — interleaved arrivals (test 11)', () => {
  it('a,b,a,b pattern still produces two complete groups', async () => {
    const items = [
      { key: 'a', v: 1 }, { key: 'b', v: 2 },
      { key: 'a', v: 3 }, { key: 'b', v: 4 },
    ]
    const groups = await collect(groupBy(gen(items), x => x.key, 2))
    const aGroup = groups.find(g => g[0].key === 'a')
    const bGroup = groups.find(g => g[0].key === 'b')
    expect(aGroup).toBeDefined()
    expect(bGroup).toBeDefined()
    expect(aGroup.map(x => x.v).sort()).toEqual([1, 3])
    expect(bGroup.map(x => x.v).sort()).toEqual([2, 4])
  })
})

describe('groupBy — incomplete group at exhaustion (test 12)', () => {
  it('only yields complete groups; incomplete groups are silently dropped', async () => {
    const items = [
      { key: 'a', v: 1 }, { key: 'a', v: 2 },
      { key: 'b', v: 3 },
    ]
    const groups = await collect(groupBy(gen(items), x => x.key, 2))
    expect(groups).toHaveLength(1)
    expect(groups[0].every(x => x.key === 'a')).toBe(true)
  })
})

describe('groupBy — upstream throws (test 13)', () => {
  it('error propagates from groupBy when upstream generator throws', async () => {
    const source = throwAfterFirst({ key: 'a', v: 1 })
    await expect(collect(groupBy(source, x => x.key, 2))).rejects.toThrow('generator error')
  })
})

describe('groupBy — integration with merge (test 14)', () => {
  it('groupBy(merge(gen1, gen2), keyFn, 2) produces complete groups', async () => {
    const extents = ['e1', 'e2', 'e3']
    const makeChunk = (ext, src) => ({ ext, src })

    async function* gen1() { for (const e of extents) yield makeChunk(e, 'src1') }
    async function* gen2() { for (const e of extents) yield makeChunk(e, 'src2') }

    const groups = await collect(
      groupBy(merge(gen1(), gen2()), chunk => chunk.ext, 2)
    )
    expect(groups).toHaveLength(3)
    for (const group of groups) {
      expect(group).toHaveLength(2)
      expect(group[0].ext).toBe(group[1].ext)
      const sources = group.map(c => c.src).sort()
      expect(sources).toEqual(['src1', 'src2'])
    }
  })
})
