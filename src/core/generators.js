export async function* merge(...generators) {
  if (generators.length === 0) return

  const pending = new Map()

  for (let i = 0; i < generators.length; i++) {
    pending.set(i, { gen: generators[i], promise: null })
  }

  const advance = (i) => {
    const entry = pending.get(i)
    if (!entry) return
    entry.promise = entry.gen.next().then(
      result => ({ i, result }),
      err    => Promise.reject(err)
    )
  }

  for (const i of pending.keys()) advance(i)

  while (pending.size > 0) {
    const { i, result } = await Promise.race(
      Array.from(pending.values()).map(e => e.promise)
    )

    if (result.done) {
      pending.delete(i)
    } else {
      yield result.value
      advance(i)
    }
  }
}

export async function* groupBy(generator, keyFn, expectedCount) {
  const groups = new Map()

  for await (const value of generator) {
    const key = keyFn(value)
    if (!groups.has(key)) groups.set(key, [])
    const group = groups.get(key)
    group.push(value)
    if (group.length === expectedCount) {
      yield group
      groups.delete(key)
    }
  }
}
