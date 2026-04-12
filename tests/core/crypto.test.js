/**
 * tests/core/crypto.test.js
 *
 * Unit tests for KeyStore in core/crypto.js
 * Tests spec cases 1–7.
 *
 * Uses _nodeStorage (in-memory Map) to avoid localStorage dependency.
 * Uses real Web Crypto API (available in Node 18+).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  KeyStore,
  KeyStoreNotInitialisedError,
  KeyStoreDecryptionError,
  KeyStoreLockedError,
  _nodeStorage,
} from '../../src/core/crypto.js'

// Reset storage before each test for isolation
beforeEach(() => {
  _nodeStorage.clear()
})

const ST = _nodeStorage  // shorthand

// ---------------------------------------------------------------------------
// Test 1: create and retrieve
// ---------------------------------------------------------------------------

describe('KeyStore — test 1: create and retrieve', () => {
  it('stores and returns initial keys', async () => {
    const ks = await KeyStore.create('password123', { lantmateriet: 'abc' }, ST)
    expect(await ks.get('lantmateriet')).toBe('abc')
    expect(await ks.get('openrouteservice')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Test 2: persist and unlock
// ---------------------------------------------------------------------------

describe('KeyStore — test 2: persist and unlock', () => {
  it('roundtrips through storage', async () => {
    await KeyStore.create('password123', { lantmateriet: 'abc' }, ST)
    const ks2 = await KeyStore.unlock('password123', ST)
    expect(await ks2.get('lantmateriet')).toBe('abc')
  })
})

// ---------------------------------------------------------------------------
// Test 3: wrong password
// ---------------------------------------------------------------------------

describe('KeyStore — test 3: wrong password', () => {
  it('throws KeyStoreDecryptionError', async () => {
    await KeyStore.create('password123', {}, ST)
    await expect(KeyStore.unlock('wrongpassword', ST)).rejects.toBeInstanceOf(KeyStoreDecryptionError)
  })
})

// ---------------------------------------------------------------------------
// Test 4: set() and re-unlock
// ---------------------------------------------------------------------------

describe('KeyStore — test 4: set and re-unlock', () => {
  it('persists key updates after set()', async () => {
    const ks = await KeyStore.create('password123', {}, ST)
    await ks.set('openrouteservice', 'xyz')

    const ks2 = await KeyStore.unlock('password123', ST)
    expect(await ks2.get('openrouteservice')).toBe('xyz')
  })
})

// ---------------------------------------------------------------------------
// Test 5: lock clears memory
// ---------------------------------------------------------------------------

describe('KeyStore — test 5: lock', () => {
  it('get() throws KeyStoreLockedError after lock()', async () => {
    const ks = await KeyStore.create('password123', { lantmateriet: 'abc' }, ST)
    await ks.lock()
    await expect(ks.get('lantmateriet')).rejects.toBeInstanceOf(KeyStoreLockedError)
  })

  it('set() throws KeyStoreLockedError after lock()', async () => {
    const ks = await KeyStore.create('password123', {}, ST)
    await ks.lock()
    await expect(ks.set('lantmateriet', 'val')).rejects.toBeInstanceOf(KeyStoreLockedError)
  })
})

// ---------------------------------------------------------------------------
// Test 6: isInitialised
// ---------------------------------------------------------------------------

describe('KeyStore — test 6: isInitialised', () => {
  it('returns false when no blob exists', () => {
    expect(KeyStore.isInitialised(ST)).toBe(false)
  })

  it('returns true after create()', async () => {
    await KeyStore.create('password123', {}, ST)
    expect(KeyStore.isInitialised(ST)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test 7: IV uniqueness
// ---------------------------------------------------------------------------

describe('KeyStore — test 7: IV uniqueness', () => {
  it('generates a different IV on each set() call', async () => {
    const ks = await KeyStore.create('password123', {}, ST)

    const blob1 = JSON.parse(ST.getItem('geo-scouting-keystore'))
    await ks.set('lantmateriet', 'abc')
    const blob2 = JSON.parse(ST.getItem('geo-scouting-keystore'))
    await ks.set('lantmateriet', 'def')
    const blob3 = JSON.parse(ST.getItem('geo-scouting-keystore'))

    expect(blob1.iv).not.toBe(blob2.iv)
    expect(blob2.iv).not.toBe(blob3.iv)
  })
})

// ---------------------------------------------------------------------------
// Error: unlock when not initialised
// ---------------------------------------------------------------------------

describe('KeyStore — unlock not initialised', () => {
  it('throws KeyStoreNotInitialisedError when storage is empty', async () => {
    await expect(KeyStore.unlock('anything', ST)).rejects.toBeInstanceOf(KeyStoreNotInitialisedError)
  })
})
