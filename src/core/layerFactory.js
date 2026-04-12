import { GridTransform } from './primitives.js'
import { SeNorgeSnowSource } from '../sources/seNorge-snow.js'
import { NgcdTempMeanSource } from '../sources/ngcd-temp-mean.js'
import { NgcdTempMaxSource } from '../sources/ngcd-temp-max.js'
import { SnowSeasonSource } from '../sources/snow-season.js'
import { WinterTempSource } from '../sources/winter-temp.js'
import { MeltRiskSource } from '../sources/melt-risk.js'
import { SlopeSource } from '../sources/slope.js'
import { SnowSeasonLayer } from '../layers/snow-season.js'
import { WinterTempLayer } from '../layers/winter-temp.js'
import { MeltRiskLayer } from '../layers/melt-risk.js'
import { SlopeLayer } from '../layers/slope.js'

function getReactive() {
  if (typeof window !== 'undefined' && window.Vue) return window.Vue.reactive
  return (obj) => obj
}

const reactive = getReactive()

const SENORGE_TRANSFORM = new GridTransform({
  originX: -75_000, originY: 6_450_000,
  chunkSize: 512_000, baseResolution: 1_000,
  nativeCRS: 'EPSG:3035',
})

const SLOPE_TRANSFORM = new GridTransform({
  originX: -75_000, originY: 6_450_000,
  chunkSize: 50_000, baseResolution: 250,
  nativeCRS: 'EPSG:25833',
})

const CURRENT_YEAR = new Date().getFullYear()

function yearsBack(n) {
  return Array.from({ length: n }, (_, i) => CURRENT_YEAR - 1 - i)
}

function nullStore() {
  return { get: () => null, set: () => {} }
}

function makeAnnotationLayerStub(id, params) {
  return { id, params, isRasterLayer: false, update() {} }
}

function determineKeyRequiredState(appState, keyStore) {
  if (!keyStore) return 'danger'
  if (appState.keyStoreState === 'locked') return 'locked'
  if (keyStore._keys && keyStore._keys.openrouteservice) return 'normal'
  return 'danger'
}

export class LayerFactory {
  constructor({ appState, renderer, keyStore }) {
    this._appState = appState
    this._renderer = renderer
    this._keyStore = keyStore
    this._layers   = null
  }

  createAll() {
    const { _appState: appState, _keyStore: keyStore } = this

    const { timePeriod, winterPeriod, percentile, snowThreshold } = appState
    const winterStart = winterPeriod?.start ?? '12-01'
    const winterEnd   = winterPeriod?.end   ?? '03-31'
    const years       = yearsBack(timePeriod)
    const store       = nullStore()

    const snowChildren = years.map(year =>
      new SeNorgeSnowSource({
        id: `senorge-snow-${year}`,
        year, threshold: snowThreshold,
        transform: SENORGE_TRANSFORM,
        persist: false, _store: store,
      })
    )

    const meltChildren = years.map(year =>
      new NgcdTempMaxSource({
        id: `ngcd-tx-${year}`,
        year, winterStart, winterEnd,
        transform: SENORGE_TRANSFORM,
        persist: false, _store: store,
      })
    )

    const tempChildren = years.map(year =>
      new NgcdTempMeanSource({
        id: `ngcd-tg-${year}`,
        year, winterStart, winterEnd,
        transform: SENORGE_TRANSFORM,
        persist: false, _store: store,
      })
    )

    const snowSeasonSource = new SnowSeasonSource({
      id: 'snow-season-source',
      childSources: snowChildren,
      percentile,
      transform: SENORGE_TRANSFORM,
      persist: false, _store: store,
    })

    const meltRiskSource = new MeltRiskSource({
      id: 'melt-risk-source',
      childSources: meltChildren,
      percentile,
      transform: SENORGE_TRANSFORM,
      persist: false, _store: store,
    })

    const winterTempSource = new WinterTempSource({
      id: 'winter-temp-source',
      childSources: tempChildren,
      percentile,
      transform: SENORGE_TRANSFORM,
      persist: false, _store: store,
    })

    const slopeSource = new SlopeSource({
      id: 'slope-source',
      elevationSource: { get: async function* () {} },
      kernelMeters: 50,
      radiusMeters: 100,
      transform: SLOPE_TRANSFORM,
      persist: false, _store: store,
    })

    const keyRequiredState = determineKeyRequiredState(appState, keyStore)
    const keyLayerEnabled  = keyRequiredState === 'normal'

    const layers = {
      snowSeason: new SnowSeasonLayer({
        id: 'snow-season',
        source: snowSeasonSource,
        renderer: this._renderer,
        params: reactive({ valueRange: { from: 0, to: 180 }, state: 'normal', enabled: true }),
      }),
      winterTemp: new WinterTempLayer({
        id: 'winter-temp',
        source: winterTempSource,
        renderer: this._renderer,
        params: reactive({ valueRange: { from: 0, to: -20 }, state: 'normal', enabled: true }),
      }),
      meltRisk: new MeltRiskLayer({
        id: 'melt-risk',
        source: meltRiskSource,
        renderer: this._renderer,
        params: reactive({ valueRange: { from: 0, to: 30 }, state: 'normal', enabled: true }),
      }),
      slope: new SlopeLayer({
        id: 'slope',
        source: slopeSource,
        renderer: this._renderer,
        params: reactive({ slopeThreshold: 15, state: 'normal', enabled: true }),
      }),
      roadAccess:     makeAnnotationLayerStub('road-access',  reactive({ state: keyRequiredState, enabled: keyLayerEnabled })),
      transportStops: makeAnnotationLayerStub('transport',    reactive({ state: 'normal',         enabled: true })),
      isochrones:     makeAnnotationLayerStub('isochrones',   reactive({ state: keyRequiredState, enabled: keyLayerEnabled })),
    }

    this._layers = layers
    return layers
  }

  reEvaluateStates() {
    if (!this._layers) return
    const newState = determineKeyRequiredState(this._appState, this._keyStore)
    this._layers.roadAccess.params.state  = newState
    this._layers.isochrones.params.state  = newState
  }

  _onTimePeriodChange(timePeriod, sources) {
    for (const source of sources) {
      source.reconfigure({ timePeriod })
    }
  }
}
