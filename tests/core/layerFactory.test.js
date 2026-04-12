import { describe, it, expect, beforeAll, vi } from 'vitest'
import { registerCRS } from '../../src/core/primitives.js'
import { LayerFactory } from '../../src/core/layerFactory.js'
import { SnowSeasonLayer } from '../../src/layers/snow-season.js'
import { WinterTempLayer } from '../../src/layers/winter-temp.js'
import { MeltRiskLayer } from '../../src/layers/melt-risk.js'
import { SlopeLayer } from '../../src/layers/slope.js'
import { SnowSeasonSource } from '../../src/sources/snow-season.js'
import { WinterTempSource } from '../../src/sources/winter-temp.js'
import { MeltRiskSource } from '../../src/sources/melt-risk.js'
import { SlopeSource } from '../../src/sources/slope.js'

beforeAll(() => {
  registerCRS({
    'EPSG:3035':  '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs',
    'EPSG:25833': '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
    'EPSG:4326':  '+proj=longlat +datum=WGS84 +no_defs',
  })
})

function makeAppState(overrides = {}) {
  return {
    timePeriod:    20,
    winterPeriod:  { start: '12-01', end: '03-31' },
    percentile:    25,
    snowThreshold: 10,
    keyStoreState: 'uninitialised',
    ...overrides,
  }
}

function makeRenderer() {
  return { register: vi.fn() }
}

function makeKeyStore(hasKey = false) {
  return {
    _keys: hasKey ? { openrouteservice: 'abc123' } : {},
  }
}

describe('LayerFactory.createAll() — structure', () => {
  it('returns an object with all 7 expected layer keys', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    const layers = factory.createAll()
    expect(Object.keys(layers)).toEqual(expect.arrayContaining([
      'snowSeason', 'winterTemp', 'meltRisk', 'slope',
      'roadAccess', 'transportStops', 'isochrones',
    ]))
    expect(Object.keys(layers)).toHaveLength(7)
  })
})

describe('LayerFactory.createAll() — raster layers are real instances', () => {
  it('snowSeason is a SnowSeasonLayer instance', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    const { snowSeason } = factory.createAll()
    expect(snowSeason).toBeInstanceOf(SnowSeasonLayer)
  })

  it('winterTemp is a WinterTempLayer instance', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    const { winterTemp } = factory.createAll()
    expect(winterTemp).toBeInstanceOf(WinterTempLayer)
  })

  it('meltRisk is a MeltRiskLayer instance', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    const { meltRisk } = factory.createAll()
    expect(meltRisk).toBeInstanceOf(MeltRiskLayer)
  })

  it('slope is a SlopeLayer instance', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    const { slope } = factory.createAll()
    expect(slope).toBeInstanceOf(SlopeLayer)
  })
})

describe('LayerFactory.createAll() — raster layer sources are real derived-source instances', () => {
  it('snowSeason.source is a SnowSeasonSource', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    const { snowSeason } = factory.createAll()
    expect(snowSeason.source).toBeInstanceOf(SnowSeasonSource)
  })

  it('meltRisk.source is a MeltRiskSource', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    const { meltRisk } = factory.createAll()
    expect(meltRisk.source).toBeInstanceOf(MeltRiskSource)
  })

  it('winterTemp.source is a WinterTempSource', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    const { winterTemp } = factory.createAll()
    expect(winterTemp.source).toBeInstanceOf(WinterTempSource)
  })

  it('winterTemp.source is NOT a SnowSeasonSource', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    const { winterTemp } = factory.createAll()
    expect(winterTemp.source).not.toBeInstanceOf(SnowSeasonSource)
  })

  it('slope.source is a SlopeSource', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    const { slope } = factory.createAll()
    expect(slope.source).toBeInstanceOf(SlopeSource)
  })
})

describe('LayerFactory.createAll() — isRasterLayer flag', () => {
  it('snowSeason, winterTemp, meltRisk, slope all have isRasterLayer=true', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    const layers = factory.createAll()
    expect(layers.snowSeason.isRasterLayer).toBe(true)
    expect(layers.winterTemp.isRasterLayer).toBe(true)
    expect(layers.meltRisk.isRasterLayer).toBe(true)
    expect(layers.slope.isRasterLayer).toBe(true)
  })

  it('roadAccess, transportStops, isochrones have isRasterLayer=false', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    const layers = factory.createAll()
    expect(layers.roadAccess.isRasterLayer).toBe(false)
    expect(layers.transportStops.isRasterLayer).toBe(false)
    expect(layers.isochrones.isRasterLayer).toBe(false)
  })
})

describe('LayerFactory.createAll() — params values reflect appState', () => {
  it('snowSeason params.valueRange.to equals 180 (default snow season range)', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    const { snowSeason } = factory.createAll()
    expect(snowSeason.params.valueRange).toBeDefined()
    expect(snowSeason.params.valueRange.to).toBe(180)
  })

  it('winterTemp params.valueRange.from equals 0, to equals -20 (default winter temp range)', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    const { winterTemp } = factory.createAll()
    expect(winterTemp.params.valueRange.from).toBe(0)
    expect(winterTemp.params.valueRange.to).toBe(-20)
  })

  it('meltRisk params.valueRange.to equals 30 (default melt risk range)', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    const { meltRisk } = factory.createAll()
    expect(meltRisk.params.valueRange.to).toBe(30)
  })

  it('slope params.slopeThreshold equals 15 (default)', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    const { slope } = factory.createAll()
    expect(slope.params.slopeThreshold).toBe(15)
  })
})

describe('LayerFactory.createAll() — timePeriod controls child source count', () => {
  it('snowSeason source has timePeriod number of child sources when timePeriod=5', () => {
    const appState = makeAppState({ timePeriod: 5 })
    const factory = new LayerFactory({ appState, renderer: makeRenderer(), keyStore: makeKeyStore() })
    const { snowSeason } = factory.createAll()
    expect(snowSeason.source._childSources?.length ?? snowSeason.source.childSourceCount).toBe(5)
  })

  it('meltRisk source has timePeriod number of child sources when timePeriod=3', () => {
    const appState = makeAppState({ timePeriod: 3 })
    const factory = new LayerFactory({ appState, renderer: makeRenderer(), keyStore: makeKeyStore() })
    const { meltRisk } = factory.createAll()
    expect(meltRisk.source._childSources?.length ?? meltRisk.source.childSourceCount).toBe(3)
  })
})

describe('LayerFactory — key-required layer state', () => {
  it('roadAccess params.state = "danger" when no keyStore', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: null })
    const { roadAccess } = factory.createAll()
    expect(roadAccess.params.state).toBe('danger')
  })

  it('roadAccess params.state = "locked" when keyStore present but appState.keyStoreState = "locked"', () => {
    const appState = makeAppState({ keyStoreState: 'locked' })
    const factory = new LayerFactory({ appState, renderer: makeRenderer(), keyStore: makeKeyStore(false) })
    const { roadAccess } = factory.createAll()
    expect(roadAccess.params.state).toBe('locked')
  })

  it('roadAccess params.state = "normal" when keyStore has openrouteservice key', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore(true) })
    const { roadAccess } = factory.createAll()
    expect(roadAccess.params.state).toBe('normal')
  })

  it('isochrones state mirrors roadAccess state', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: null })
    const { roadAccess, isochrones } = factory.createAll()
    expect(isochrones.params.state).toBe(roadAccess.params.state)
  })
})

describe('LayerFactory.reEvaluateStates()', () => {
  it('updates roadAccess and isochrones state after keyStore changes', () => {
    const appState = makeAppState()
    const keyStore = makeKeyStore(false)
    const factory = new LayerFactory({ appState, renderer: makeRenderer(), keyStore })
    const layers = factory.createAll()

    expect(layers.roadAccess.params.state).toBe('danger')

    keyStore._keys.openrouteservice = 'newkey'
    factory.reEvaluateStates()

    expect(layers.roadAccess.params.state).toBe('normal')
    expect(layers.isochrones.params.state).toBe('normal')
  })

  it('does nothing if createAll() has not been called', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    expect(() => factory.reEvaluateStates()).not.toThrow()
  })
})

describe('LayerFactory.createAll() — all layers expose update()', () => {
  it('every returned layer has an update method', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore() })
    const layers = factory.createAll()
    for (const layer of Object.values(layers)) {
      expect(typeof layer.update).toBe('function')
    }
  })
})

describe('LayerFactory.createAll() — danger-state layers start disabled', () => {
  it('roadAccess has enabled=false when keyStore is null (danger state)', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: null })
    const { roadAccess } = factory.createAll()
    expect(roadAccess.params.state).toBe('danger')
    expect(roadAccess.params.enabled).toBe(false)
  })

  it('isochrones has enabled=false when keyStore is null (danger state)', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: null })
    const { isochrones } = factory.createAll()
    expect(isochrones.params.state).toBe('danger')
    expect(isochrones.params.enabled).toBe(false)
  })

  it('roadAccess has enabled=true when keyStore has openrouteservice key', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: makeKeyStore(true) })
    const { roadAccess } = factory.createAll()
    expect(roadAccess.params.state).toBe('normal')
    expect(roadAccess.params.enabled).toBe(true)
  })

  it('roadAccess has enabled=false when locked (key store exists but locked)', () => {
    const appState = makeAppState({ keyStoreState: 'locked' })
    const factory = new LayerFactory({ appState, renderer: makeRenderer(), keyStore: makeKeyStore(false) })
    const { roadAccess } = factory.createAll()
    expect(roadAccess.params.state).toBe('locked')
    expect(roadAccess.params.enabled).toBe(false)
  })

  it('transportStops (no key required) has enabled=true regardless of keyStore', () => {
    const factory = new LayerFactory({ appState: makeAppState(), renderer: makeRenderer(), keyStore: null })
    const { transportStops } = factory.createAll()
    expect(transportStops.params.enabled).toBe(true)
  })
})
