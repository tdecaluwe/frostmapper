import { registerCRS } from './primitives.js'
import { appState } from './appState.js'
import { LayerFactory } from './layerFactory.js'
import { KeyStore, hasKeystore, initKeystore, unlockKeystore, setKey, keyStatus } from './crypto.js'
import { RasterRenderer } from './renderer.js'
import { MapManager } from './map.js'
import { parseViewportHash, toggleLayerWithRenderer } from './bootstrap-utils.js'

registerCRS({
  'EPSG:25833': '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  'EPSG:3035':  '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs',
})

const storage = (typeof localStorage !== 'undefined') ? localStorage : null
const isInit  = storage ? KeyStore.isInitialised(storage) : false

let keyStore = null
if (isInit) {
  appState.keyStoreState = 'locked'
} else {
  appState.keyStoreState = 'uninitialised'
}

function run() {
  if (typeof window === 'undefined') return

  const MapLibre = window.maplibregl
  if (!MapLibre) return

  const viewport = parseViewportHash(window.location.hash)

  const mapManager = new MapManager({
    container:     'map',
    MapLibre:      MapLibre.Map,
    initialCenter: viewport?.center ?? [15.0, 65.0],
    initialZoom:   viewport?.zoom   ?? 5,
  })

  const renderer = new RasterRenderer({ mapManager })

  if (window.Vue) {
    const { createApp } = window.Vue
    const app = createApp({
      setup() {
        const LAYER_LABELS = {
          snowSeason:     'Snow Season Length',
          winterTemp:     'Winter Temperature',
          meltRisk:       'Melt Risk Days',
          slope:          'Average Slope',
          roadAccess:     'Road Accessibility',
          transportStops: 'Transport Stops',
          isochrones:     'Travel Isochrones',
        }

        function layerLabel(key) {
          return LAYER_LABELS[key] ?? key
        }

        function dotColor(layer) {
          if (!layer.isRasterLayer) return '#888'
          return `hsl(${layer.hue ?? 200}, 80%, 55%)`
        }

        function toggleLayer(layer, active) {
          toggleLayerWithRenderer(layer, active, renderer)
        }

        function showKeyInput(keyId) {
          appState.passwordError = null
          if (appState.keyStoreState === 'uninitialised') {
            appState.pendingKeyId      = keyId
            appState.passwordModalMode = 'init'
            appState.showPasswordModal = true
          } else if (appState.keyStoreState === 'locked') {
            appState.pendingKeyId      = keyId
            appState.passwordModalMode = 'unlock'
            appState.showPasswordModal = true
          } else {
            appState.editingKeyId      = keyId
            appState.passwordModalMode = 'key'
            appState.showPasswordModal = true
          }
        }

        async function handlePasswordSubmit(password) {
          const mode = appState.passwordModalMode
          try {
            if (mode === 'init') {
              keyStore = await initKeystore(password)
            } else {
              keyStore = await unlockKeystore(password)
            }
            appState.keyStoreState    = 'unlocked'
            appState.keyStatus        = keyStatus()
            appState.showPasswordModal = false
            appState.passwordError    = null

            if (appState.pendingKeyId) {
              appState.editingKeyId      = appState.pendingKeyId
              appState.pendingKeyId      = null
              appState.passwordModalMode = 'key'
              appState.showPasswordModal = true
            }
          } catch (err) {
            appState.passwordError = err.message
          }
        }

        async function handleKeySubmit(keyId, keyValue) {
          try {
            await setKey(keyId, keyValue)
            appState.keyStatus        = keyStatus()
            appState.showPasswordModal = false
          } catch (err) {
            appState.passwordError = err.message
          }
        }

        const factory = new LayerFactory({ appState, renderer, keyStore })
        const layers  = factory.createAll()

        mapManager.map.on('load', () => {
          mapManager.addDataLayer(renderer)
          mapManager.map.addControl(new MapLibre.NavigationControl())

          for (const layer of Object.values(layers)) {
            if (layer.isRasterLayer) {
              renderer.register(layer)
            } else {
              mapManager.onViewportChange(vp => layer.update(vp))
            }
          }

          window.__frostDebug = {
            getLayers: () => layers,
            getRenderer: () => renderer,
            toggleLayer: (key, active) => {
              const layer = layers[key]
              if (!layer) throw new Error(`Unknown layer: ${key}. Available: ${Object.keys(layers).join(', ')}`)
              toggleLayer(layer, active)
            },
            setValueRange: (key, min, max) => {
              const layer = layers[key]
              if (!layer) throw new Error(`Unknown layer: ${key}`)
              if (!layer.params) throw new Error(`Layer ${key} has no params`)
              layer.params.valueRange = { from: min, to: max }
              renderer.refresh()
            },
            toggleBasemap: (visible) => {
              const map = mapManager.map
              if (map.getLayer('basemap-layer')) {
                map.setLayoutProperty('basemap-layer', 'visibility', visible ? 'visible' : 'none')
              }
            },
          }
        })

        return { appState, layers, renderer, dotColor, layerLabel, toggleLayer, showKeyInput, handlePasswordSubmit, handleKeySubmit }
      },
    })
    app.mount('#ui')
  }
}

run()
