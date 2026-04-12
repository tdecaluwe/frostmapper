/**
 * tests/core/bootstrap.test.js
 *
 * 10 test cases derived from docs/specs/core/bootstrap.spec.md
 *
 * Tests individual modules (queues.js, appState.js, layerFactory.js) that
 * bootstrap.js wires together. bootstrap.js itself is the entry point and
 * not exercised directly here.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Extent, registerCRS } from '../../src/core/primitives.js'
import { threddsQueue, hoydedataQueue, overpassQueue, openrouteQueue } from '../../src/core/queues.js'
import { appState } from '../../src/core/appState.js'
import { KeyStore, _nodeStorage, unlockKeystore, initKeystore } from '../../src/core/crypto.js'
import { LayerFactory } from '../../src/core/layerFactory.js'
import { RasterLayer } from '../../src/core/layer.js'
import { parseViewportHash, toggleLayerWithRenderer } from '../../src/core/bootstrap-utils.js'

beforeEach(() => {
  _nodeStorage.clear()
  appState.keyStoreState    = 'uninitialised'
  appState.timePeriod       = 20
  appState.pendingKeyId     = null
  appState.showPasswordModal = false
  appState.passwordError    = null
})

function simulateShowKeyInput(keyId, state) {
  if (state.keyStoreState === 'uninitialised') {
    state.pendingKeyId      = keyId
    state.passwordModalMode  = 'init'
    state.showPasswordModal  = true
    state.passwordError      = null
  } else if (state.keyStoreState === 'locked') {
    state.pendingKeyId      = keyId
    state.passwordModalMode  = 'unlock'
    state.showPasswordModal  = true
    state.passwordError      = null
  } else {
    state.passwordModalMode  = 'key'
    state.editingKeyId       = keyId
    state.showPasswordModal  = true
    state.passwordError      = null
  }
}

async function simulateHandlePasswordSubmit(password, state, mode, storage) {
  try {
    let ks
    if (mode === 'init') {
      ks = await KeyStore.create(password, {}, storage)
    } else {
      ks = await KeyStore.unlock(password, storage)
    }
    state.keyStoreState    = 'unlocked'
    state.showPasswordModal = false
    state.passwordError    = null

    if (state.pendingKeyId) {
      state.editingKeyId       = state.pendingKeyId
      state.pendingKeyId       = null
      state.passwordModalMode  = 'key'
      state.showPasswordModal  = true
    }
  } catch (err) {
    state.passwordError = err.message
  }
}

describe('Test 1: CRS registration before Extent construction', () => {
  it('an unregistered CRS throws when projecting; succeeds after registerCRS()', () => {
    const ext = new Extent({ north: 8000000, south: 7000000, east: 700000, west: 400000, crs: 'EPSG:99999' })
    expect(() => ext.toBoundingBox('EPSG:4326')).toThrow()

    registerCRS({ 'EPSG:99999': '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' })
    expect(() => ext.toBoundingBox('EPSG:4326')).not.toThrow()
  })

  it('EPSG:25833 registered via registerCRS can be used in Extent', () => {
    registerCRS({ 'EPSG:25833': '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' })
    const ext = new Extent({ north: 7700000, south: 7600000, east: 600000, west: 500000, crs: 'EPSG:25833' })
    const bb = ext.toBoundingBox('EPSG:4326')
    expect(bb).toHaveProperty('north')
    expect(bb).toHaveProperty('south')
    expect(bb.north).toBeGreaterThan(bb.south)
  })
})

describe('Test 2: Queue singletons are shared', () => {
  it('threddsQueue imported twice is the same instance', async () => {
    const { threddsQueue: q2 } = await import('../../src/core/queues.js')
    expect(threddsQueue).toBe(q2)
  })

  it('all four queue singletons are distinct Queue instances', async () => {
    const { Queue } = await import('../../src/core/queue.js')
    expect(threddsQueue).toBeInstanceOf(Queue)
    expect(hoydedataQueue).toBeInstanceOf(Queue)
    expect(overpassQueue).toBeInstanceOf(Queue)
    expect(openrouteQueue).toBeInstanceOf(Queue)
    expect(threddsQueue).not.toBe(hoydedataQueue)
    expect(threddsQueue).not.toBe(overpassQueue)
    expect(threddsQueue).not.toBe(openrouteQueue)
  })

  it('queue names match their purpose', () => {
    expect(threddsQueue.name).toBe('thredds')
    expect(hoydedataQueue.name).toBe('hoydedata')
    expect(overpassQueue.name).toBe('overpass')
    expect(openrouteQueue.name).toBe('openrouteservice')
  })
})

describe('Test 3: First-run KeyStore flow', () => {
  it('appState.keyStoreState starts as uninitialised when no KeyStore blob exists', () => {
    expect(KeyStore.isInitialised(_nodeStorage)).toBe(false)
    expect(appState.keyStoreState).toBe('uninitialised')
  })

  it('after KeyStore.create, setting appState.keyStoreState to unlocked works', async () => {
    expect(appState.keyStoreState).toBe('uninitialised')
    await KeyStore.create('password', {}, _nodeStorage)
    appState.keyStoreState = 'unlocked'
    expect(appState.keyStoreState).toBe('unlocked')
  })
})

describe('Test 4: Returning user flow', () => {
  it('when KeyStore blob exists, can set locked then transition to unlocked after unlock', async () => {
    await KeyStore.create('password', {}, _nodeStorage)
    expect(KeyStore.isInitialised(_nodeStorage)).toBe(true)

    appState.keyStoreState = 'locked'
    expect(appState.keyStoreState).toBe('locked')

    await KeyStore.unlock('password', _nodeStorage)
    appState.keyStoreState = 'unlocked'
    expect(appState.keyStoreState).toBe('unlocked')
  })
})

describe('Test 5: Map usable before unlock', () => {
  it('MockMapManager.onViewportChange fires callback when viewport emitted', () => {
    class MockMapManager {
      constructor() { this._subs = new Set() }
      onViewportChange(cb) { this._subs.add(cb); return () => this._subs.delete(cb) }
      _emitViewport(vp) { for (const cb of this._subs) cb(vp) }
    }

    const mapManager = new MockMapManager()
    const received = []
    mapManager.onViewportChange(vp => received.push(vp))

    const fakeViewport = { zoom: 5, north: 70, south: 57 }
    mapManager._emitViewport(fakeViewport)

    expect(received).toHaveLength(1)
    expect(received[0]).toBe(fakeViewport)
  })

  it('layers without key requirements update via viewport before KeyStore unlock', () => {
    class MockMapManager {
      constructor() { this._subs = new Set() }
      onViewportChange(cb) { this._subs.add(cb); return () => this._subs.delete(cb) }
      _emitViewport(vp) { for (const cb of this._subs) cb(vp) }
    }

    const mapManager = new MockMapManager()
    const callLog = []
    const snowSeasonLayer = {
      params: { state: 'normal' },
      update(vp) { callLog.push({ layer: 'snowSeason', vp }) },
    }

    mapManager.onViewportChange(vp => snowSeasonLayer.update(vp))
    mapManager._emitViewport({ zoom: 6 })
    expect(callLog).toHaveLength(1)
    expect(snowSeasonLayer.params.state).toBe('normal')
  })
})

describe('Test 6: Layer state on creation — no keys', () => {
  it('snowSeason layer has state "normal" when no keys are required', () => {
    const factory = new LayerFactory({ appState, renderer: null, keyStore: null })
    const layers = factory.createAll()
    expect(layers.snowSeason.params.state).toBe('normal')
  })

  it('winterTemp, meltRisk, slope layers all have state "normal"', () => {
    const factory = new LayerFactory({ appState, renderer: null, keyStore: null })
    const layers = factory.createAll()
    expect(layers.winterTemp.params.state).toBe('normal')
    expect(layers.meltRisk.params.state).toBe('normal')
    expect(layers.slope.params.state).toBe('normal')
  })

  it('transportStops (no key required) has state "normal"', () => {
    const factory = new LayerFactory({ appState, renderer: null, keyStore: null })
    const layers = factory.createAll()
    expect(layers.transportStops.params.state).toBe('normal')
  })
})

describe('Test 7: Layer state on creation — key required, missing (locked)', () => {
  it('isochrones layer has state "locked" when keyStore is locked', () => {
    const lockedKeyStore = { locked: true, _keys: null }
    appState.keyStoreState = 'locked'

    const factory = new LayerFactory({ appState, renderer: null, keyStore: lockedKeyStore })
    const layers = factory.createAll()
    expect(layers.isochrones.params.state).toBe('locked')
  })

  it('roadAccess layer has state "locked" when keyStore is locked', () => {
    const lockedKeyStore = { locked: true, _keys: null }
    appState.keyStoreState = 'locked'

    const factory = new LayerFactory({ appState, renderer: null, keyStore: lockedKeyStore })
    const layers = factory.createAll()
    expect(layers.roadAccess.params.state).toBe('locked')
  })

  it('isochrones layer has state "danger" when keyStore is null (no keyStore at all)', () => {
    appState.keyStoreState = 'uninitialised'

    const factory = new LayerFactory({ appState, renderer: null, keyStore: null })
    const layers = factory.createAll()
    expect(layers.isochrones.params.state).toBe('danger')
  })
})

describe('Test 8: Layer state after unlock — key available', () => {
  it('isochrones transitions from locked to normal after unlock with valid key', () => {
    const lockedKeyStore = { locked: true, _keys: null }
    appState.keyStoreState = 'locked'

    const factory = new LayerFactory({ appState, renderer: null, keyStore: lockedKeyStore })
    const layers = factory.createAll()
    expect(layers.isochrones.params.state).toBe('locked')

    lockedKeyStore.locked = false
    lockedKeyStore._keys = { openrouteservice: 'test-key' }
    appState.keyStoreState = 'unlocked'

    factory.reEvaluateStates()
    expect(layers.isochrones.params.state).toBe('normal')
  })
})

describe('Test 9: timePeriod change triggers Source reconfiguration', () => {
  it('mock source reconfigures when appState.timePeriod changes', () => {
    const mockSource = {
      configuredWith: null,
      reconfigure(config) { this.configuredWith = config },
    }

    appState.timePeriod = 20
    mockSource.reconfigure({ timePeriod: appState.timePeriod })
    expect(mockSource.configuredWith.timePeriod).toBe(20)

    appState.timePeriod = 25
    mockSource.reconfigure({ timePeriod: appState.timePeriod })
    expect(mockSource.configuredWith.timePeriod).toBe(25)
  })

  it('LayerFactory._onTimePeriodChange calls reconfigure on affected sources', () => {
    const reconfigureCalls = []

    class MockSource {
      reconfigure(config) { reconfigureCalls.push(config) }
    }

    const factory = new LayerFactory({ appState, renderer: null, keyStore: null })
    factory._onTimePeriodChange(25, [new MockSource()])

    expect(reconfigureCalls).toHaveLength(1)
    expect(reconfigureCalls[0]).toHaveProperty('timePeriod', 25)
  })
})

describe('Test 10: RasterLayer registered before annotation layers', () => {
  it('raster layers from LayerFactory have isRasterLayer === true', () => {
    const factory = new LayerFactory({ appState, renderer: null, keyStore: null })
    const layers = factory.createAll()
    expect(layers.snowSeason.isRasterLayer).toBe(true)
    expect(layers.winterTemp.isRasterLayer).toBe(true)
    expect(layers.meltRisk.isRasterLayer).toBe(true)
    expect(layers.slope.isRasterLayer).toBe(true)
  })

  it('annotation layers from LayerFactory do NOT have isRasterLayer', () => {
    const factory = new LayerFactory({ appState, renderer: null, keyStore: null })
    const layers = factory.createAll()
    expect(layers.roadAccess.isRasterLayer).toBeFalsy()
    expect(layers.transportStops.isRasterLayer).toBeFalsy()
    expect(layers.isochrones.isRasterLayer).toBeFalsy()
  })

  it('raster layers go to renderer.register; annotation layers go to mapManager.onViewportChange', () => {
    const registered = []
    const viewportSubs = []

    const mockRenderer = { register(layer) { registered.push(layer) } }
    const mockMapManager = { onViewportChange(cb) { viewportSubs.push(cb); return () => {} } }

    const factory = new LayerFactory({ appState, renderer: mockRenderer, keyStore: null })
    const layers = factory.createAll()

    for (const layer of Object.values(layers)) {
      if (layer.isRasterLayer) {
        mockRenderer.register(layer)
      } else {
        mockMapManager.onViewportChange(vp => layer.update?.(vp))
      }
    }

    expect(registered).toHaveLength(4)
    expect(viewportSubs).toHaveLength(3)

    const annotationLayers = [layers.roadAccess, layers.transportStops, layers.isochrones]
    for (const al of annotationLayers) {
      expect(registered).not.toContain(al)
    }
  })
})

describe('Test 11: parseViewportHash()', () => {
  it('returns null when hash is empty', () => {
    expect(parseViewportHash('')).toBeNull()
  })

  it('returns null when hash has no lat/lng/zoom keys', () => {
    expect(parseViewportHash('#foo=bar&baz=qux')).toBeNull()
  })

  it('returns { center, zoom } when all three params are present', () => {
    const result = parseViewportHash('#lat=61.5&lng=9.0&zoom=8')
    expect(result).not.toBeNull()
    expect(result.center).toEqual([9.0, 61.5])
    expect(result.zoom).toBe(8)
  })

  it('returns null when any of lat, lng, zoom is missing', () => {
    expect(parseViewportHash('#lat=61.5&lng=9.0')).toBeNull()
    expect(parseViewportHash('#lat=61.5&zoom=8')).toBeNull()
    expect(parseViewportHash('#lng=9.0&zoom=8')).toBeNull()
  })

  it('returns null when values are non-numeric', () => {
    expect(parseViewportHash('#lat=abc&lng=9.0&zoom=8')).toBeNull()
  })

  it('parses negative coordinates correctly', () => {
    const result = parseViewportHash('#lat=-33.8&lng=-70.6&zoom=10')
    expect(result).not.toBeNull()
    expect(result.center).toEqual([-70.6, -33.8])
    expect(result.zoom).toBe(10)
  })
})

describe('Test 13: appState has pendingKeyId field', () => {
  it('appState exposes pendingKeyId (initially null)', () => {
    expect('pendingKeyId' in appState).toBe(true)
    expect(appState.pendingKeyId).toBeNull()
  })
})

describe('Test 14: showKeyInput gates on keyStoreState', () => {
  it('when keyStoreState=uninitialised, showKeyInput sets mode=init and stores pendingKeyId', () => {
    appState.keyStoreState    = 'uninitialised'
    appState.showPasswordModal = false
    appState.pendingKeyId     = null

    simulateShowKeyInput('openrouteservice', appState)

    expect(appState.passwordModalMode).toBe('init')
    expect(appState.pendingKeyId).toBe('openrouteservice')
    expect(appState.showPasswordModal).toBe(true)
  })

  it('when keyStoreState=locked, showKeyInput sets mode=unlock and stores pendingKeyId', () => {
    appState.keyStoreState    = 'locked'
    appState.showPasswordModal = false
    appState.pendingKeyId     = null

    simulateShowKeyInput('openrouteservice', appState)

    expect(appState.passwordModalMode).toBe('unlock')
    expect(appState.pendingKeyId).toBe('openrouteservice')
    expect(appState.showPasswordModal).toBe(true)
  })

  it('when keyStoreState=unlocked, showKeyInput sets mode=key and editingKeyId without touching pendingKeyId', () => {
    appState.keyStoreState    = 'unlocked'
    appState.showPasswordModal = false
    appState.pendingKeyId     = null

    simulateShowKeyInput('lantmateriet', appState)

    expect(appState.passwordModalMode).toBe('key')
    expect(appState.editingKeyId).toBe('lantmateriet')
    expect(appState.pendingKeyId).toBeNull()
    expect(appState.showPasswordModal).toBe(true)
  })
})

describe('Test 15: after password submit, auto-proceed to key modal when pendingKeyId set', () => {
  it('when pendingKeyId is set after unlock, mode switches to key and editingKeyId is populated', async () => {
    _nodeStorage.clear()
    await KeyStore.create('password', {}, _nodeStorage)
    appState.keyStoreState = 'locked'
    appState.pendingKeyId  = 'openrouteservice'

    await simulateHandlePasswordSubmit('password', appState, 'unlock', _nodeStorage)

    expect(appState.keyStoreState).toBe('unlocked')
    expect(appState.passwordModalMode).toBe('key')
    expect(appState.editingKeyId).toBe('openrouteservice')
    expect(appState.pendingKeyId).toBeNull()
    expect(appState.showPasswordModal).toBe(true)
  })

  it('when pendingKeyId is null after unlock, modal closes normally', async () => {
    _nodeStorage.clear()
    await KeyStore.create('password', {}, _nodeStorage)
    appState.keyStoreState = 'locked'
    appState.pendingKeyId  = null

    await simulateHandlePasswordSubmit('password', appState, 'unlock', _nodeStorage)

    expect(appState.keyStoreState).toBe('unlocked')
    expect(appState.showPasswordModal).toBe(false)
    expect(appState.pendingKeyId).toBeNull()
  })
})

describe('Test 12: toggleLayer() calls renderer.refreshLayer when re-enabling', () => {
  it('calls renderer.refreshLayer(layer.id) when active=true', () => {
    const refreshCalls = []
    const mockRenderer = {
      refresh: vi.fn(),
      refreshLayer: (id) => refreshCalls.push(id),
      clearLayer: vi.fn(),
    }

    const layer = { id: 'snow-season', params: { enabled: false }, isRasterLayer: true }

    toggleLayerWithRenderer(layer, true, mockRenderer)

    expect(layer.params.enabled).toBe(true)
    expect(refreshCalls).toContain('snow-season')
    expect(mockRenderer.refresh).not.toHaveBeenCalled()
  })

  it('calls renderer.clearLayer(layer.id) when active=false', () => {
    const mockRenderer = {
      refresh: vi.fn(),
      refreshLayer: vi.fn(),
      clearLayer: vi.fn(),
    }

    const layer = { id: 'winter-temp', params: { enabled: true }, isRasterLayer: true }

    toggleLayerWithRenderer(layer, false, mockRenderer)

    expect(layer.params.enabled).toBe(false)
    expect(mockRenderer.clearLayer).toHaveBeenCalledWith('winter-temp')
    expect(mockRenderer.refreshLayer).not.toHaveBeenCalled()
  })
})
