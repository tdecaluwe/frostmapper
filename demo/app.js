import Map from 'ol/Map.js'
import View from 'ol/View.js'
import WMTSCapabilities from 'ol/format/WMTSCapabilities.js'
import {DEVICE_PIXEL_RATIO} from 'ol/has.js'
import TileLayer from 'ol/layer/Tile.js'
import XYZ from 'ol/source/XYZ.js'
import WMTS, {optionsFromCapabilities} from 'ol/source/WMTS.js'
import WMTSTileGrid from 'ol/tilegrid/WMTS.js'
import {containsCoordinate, getWidth} from 'ol/extent.js'
import {fromLonLat, get as getProjection, transform} from 'ol/proj.js'
import {register} from 'ol/proj/proj4.js'
import {apply as applyTransform} from 'ol/transform.js'
import proj4 from 'proj4'
import chBorderRingsFlat from './data/ch-border.js'
import frBorderRingsFlat from './data/fr-border.js'
import beBorderRingsFlat from './data/be-border.js'
import itBzBorderRingsFlat from './data/it-bz-border.js'
import {
  GRIEGER_CODE,
  GRIEGER_EXTENT,
  registerAffine,
  registerGrieger,
  registerPeirce,
  registerPipeline,
  PEIRCE_CODE,
  PEIRCE_EXTENT,
  PEIRCE_WORLD_EXTENT,
} from './peirce.js'

proj4.defs('EPSG:3035', '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs')
proj4.defs('EPSG:25833', '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs')
registerPeirce(proj4)
registerAffine(proj4)
registerPipeline(proj4)
registerGrieger(proj4)
register(proj4)
getProjection(PEIRCE_CODE)?.setExtent(PEIRCE_EXTENT)
getProjection(PEIRCE_CODE)?.setWorldExtent(PEIRCE_WORLD_EXTENT)
getProjection(PEIRCE_CODE)?.setGlobal(true)
getProjection(GRIEGER_CODE)?.setExtent(GRIEGER_EXTENT)
getProjection(GRIEGER_CODE)?.setWorldExtent(PEIRCE_WORLD_EXTENT)
getProjection(GRIEGER_CODE)?.setGlobal(false)

getProjection('EPSG:3035')?.setExtent([1900000, 900000, 6900000, 5500000])
getProjection('EPSG:25833')?.setExtent([-1200000, 3500000, 2500000, 8500000])

const DEFAULT_CENTER_LON_LAT = [10.5, 59.9]
const DEFAULT_ZOOM = 4
const LAYER_STORAGE_KEY = 'frostmapper.layerVisibility.v1'
const VIEW_STORAGE_KEY = 'frostmapper.viewState.v1'

function flatToPairs(flat) {
  const pairs = []
  for (let i = 0; i < flat.length; i += 2) {
    pairs.push([flat[i], flat[i + 1]])
  }
  return pairs
}

function makeRenderClip(polygonRings) {
  return (event) => {
    const ctx = event.context
    const frameState = event.frameState
    if (!ctx || !frameState || polygonRings.length === 0) return

    const matrix = frameState.coordinateToPixelTransform
    const inverse = event.inversePixelTransform
    if (!matrix || !inverse) return

    const projection = frameState.viewState?.projection || 'EPSG:3857'

    ctx.save()
    ctx.beginPath()

    for (const ring of polygonRings) {
      for (let i = 0; i < ring.length; i += 1) {
        const px = transform(ring[i], 'EPSG:4326', projection)
        applyTransform(matrix, px)   // → CSS pixels (rotated)
        applyTransform(inverse, px)  // → canvas pixels (unrotated)
        if (i === 0) ctx.moveTo(px[0], px[1])
        else ctx.lineTo(px[0], px[1])
      }
      ctx.closePath()
    }

    ctx.clip()
  }
}

function restoreRenderState(event) {
  if (event.context) event.context.restore()
}

function getStoredLayerVisibility() {
  try {
    const raw = window.localStorage.getItem(LAYER_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function storeLayerVisibility(visibility) {
  try {
    window.localStorage.setItem(LAYER_STORAGE_KEY, JSON.stringify(visibility))
  } catch {
  }
}

function readViewStateFromLocation() {
  const match = window.location.search.match(/[?&]loc=(@[^&]+)/)
  if (!match) return null
  const parsed = match[1].match(/^@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)m$/)
  if (!parsed) return null
  return {
    lat: Number(parsed[1]),
    lon: Number(parsed[2]),
    zoom: Math.round(Math.log2(40075016.68557849 / (256 * Number(parsed[3])))),
  }
}

function readViewStateFromStorage() {
  try {
    const raw = window.localStorage.getItem(VIEW_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeViewStateToStorage(view) {
  const center = view.getCenter()
  if (!center) return
  const projection = view.getProjection()
  const lonLat = transform(center, projection, 'EPSG:4326')
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({
      projection: projection.getCode(),
      lon: lonLat[0],
      lat: lonLat[1],
      zoom: view.getZoom() ?? 0,
      rotation: view.getRotation() ?? 0,
    }))
  } catch {
  }
}

function writeLocationToUrl(view) {
  const center = view.getCenter()
  if (!center) return
  const projection = view.getProjection()
  const lonLat = transform(center, projection, 'EPSG:4326')
  const meters = (view.getResolution() ?? 0) * (projection.getMetersPerUnit() || 1)
  const next = `?loc=@${lonLat[1].toFixed(7)},${lonLat[0].toFixed(7)},${meters.toFixed(0)}m`
  if (window.location.search !== next) {
    window.history.replaceState(null, '', `${next}${window.location.hash}`)
  }
}

function applyViewStateToView(view, state) {
  if (!state) return false
  const projection = view.getProjection()
  view.setCenter(transform([state.lon, state.lat], 'EPSG:4326', projection))
  view.setZoom(state.zoom)
  if (Number.isFinite(state.rotation)) {
    view.setRotation(state.rotation)
  }
  return true
}

function syncVisibleUiFromLayers() {
  const mappings = [
    ['toggle-opentopo', fallbackLayer],
    ['toggle-norway', norwayLayer],
    ['toggle-switzerland', switzerlandLayer],
    ['toggle-france', franceLayer],
    ['toggle-belgium', belgiumLayer],
    ['toggle-austria', austriaLayer],
    ['toggle-italy', italyLayer],
  ]
  for (const [id, layer] of mappings) {
    const el = document.getElementById(id)
    if (el) el.checked = layer.getVisible()
  }
}

function bindViewStateListener(view) {
  view.on(['change:center', 'change:resolution'], () => {
    writeLocationToUrl(view)
    writeViewStateToStorage(view)
    updateProjectionPickerState()
  })
}

function zoomBy(delta) {
  const view = map.getView()
  view.setZoom((view.getZoom() || 0) + delta)
}

function panByPixels(deltaX, deltaY) {
  const view = map.getView()
  const center = view.getCenter()
  if (!center) return
  const centerPixel = map.getPixelFromCoordinate(center)
  if (!centerPixel) return
  const nextCenter = map.getCoordinateFromPixel([
    centerPixel[0] + deltaX,
    centerPixel[1] + deltaY,
  ])
  if (!nextCenter) return
  view.setCenter(nextCenter)
}

function rotateBy(deltaRadians) {
  const view = map.getView()
  view.setRotation((view.getRotation() || 0) + deltaRadians)
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.tagName === 'TEXTAREA') return true
  if (target.tagName !== 'INPUT') return false
  const type = (target.getAttribute('type') || 'text').toLowerCase()
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range'].includes(type)
}

function handleGlobalKeydown(event) {
  if (event.defaultPrevented || isEditableTarget(event.target)) return

  const isZoomIn = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd'
  const isZoomOut = event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract'
  const panStep = 160
  const rotationStep = Math.PI / 12

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    panByPixels(0, -panStep)
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    panByPixels(0, panStep)
    return
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    event.stopPropagation()
    if (event.shiftKey) rotateBy(-rotationStep)
    else panByPixels(-panStep, 0)
    return
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault()
    event.stopPropagation()
    if (event.shiftKey) rotateBy(rotationStep)
    else panByPixels(panStep, 0)
    return
  }

  if (!isZoomIn && !isZoomOut) return

  event.preventDefault()
  zoomBy(isZoomIn ? 1 : -1)
}

const swissPolygonRings = chBorderRingsFlat.map((ring) => flatToPairs(Array.from(ring)))
const francePolygonRings = frBorderRingsFlat.map((ring) => flatToPairs(Array.from(ring)))
const belgiumPolygonRings = beBorderRingsFlat.map((ring) => flatToPairs(Array.from(ring)))
const italyPolygonRings = itBzBorderRingsFlat.map((ring) => flatToPairs(Array.from(ring)))

const fallbackLayer = new TileLayer({
  preload: 2,
  source: new XYZ({
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    attributions: '© OpenTopoMap contributors',
    crossOrigin: 'anonymous',
    maxZoom: 17,
  }),
})

const norwayLayer = new TileLayer({
  preload: 2,
  source: new XYZ({
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png',
    attributions: '© Kartverket',
    crossOrigin: 'anonymous',
    maxZoom: 20,
  }),
})

const switzerlandLayer = new TileLayer({preload: 2})
switzerlandLayer.on('prerender', makeRenderClip(swissPolygonRings))
switzerlandLayer.on('postrender', restoreRenderState)

const franceProjection = getProjection('EPSG:3857')
const franceResolutions = []
const franceMatrixIds = []
const franceMaxResolution = getWidth(franceProjection.getExtent()) / 256

for (let i = 0; i < 20; i += 1) {
  franceMatrixIds[i] = i.toString()
  franceResolutions[i] = franceMaxResolution / Math.pow(2, i)
}

const franceLayer = new TileLayer({
  preload: 2,
  source: new WMTS({
    url: 'https://data.geopf.fr/wmts',
    layer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2',
    matrixSet: 'PM',
    format: 'image/png',
    projection: 'EPSG:3857',
    tileGrid: new WMTSTileGrid({
      origin: [-20037508, 20037508],
      resolutions: franceResolutions,
      matrixIds: franceMatrixIds,
    }),
    style: 'normal',
    attributions: '© IGN',
    crossOrigin: 'anonymous',
  }),
})
franceLayer.on('prerender', makeRenderClip(francePolygonRings))
franceLayer.on('postrender', restoreRenderState)

// Belgium TOPO layer
const belgiumLayer = new TileLayer({visible: false, preload: 2})
belgiumLayer.on('prerender', makeRenderClip(belgiumPolygonRings))
belgiumLayer.on('postrender', restoreRenderState)

const austriaLayer = new TileLayer({
  preload: 2,
  visible: false,
  source: new XYZ({
    url: 'https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/{z}/{y}/{x}.png',
    attributions: '© basemap.at',
    crossOrigin: 'anonymous',
    maxZoom: 19,
  }),
})

// Italy/Bolzano layer
const italyLayer = new TileLayer({
  preload: 2,
  source: new XYZ({
    url: 'https://b-tiles.buergernetz.bz.it/mapproxy/root/wmts/p_bz-BaseMap:Basemap-Standard/EPSG_3857/{z}/{x}/{y}.jpeg',
    attributions: '© Autonome Provinz Bozen/Südtirol',
    crossOrigin: 'anonymous',
  }),
  visible: false,
})
italyLayer.on('prerender', makeRenderClip(italyPolygonRings))
italyLayer.on('postrender', restoreRenderState)

const storedViewState = readViewStateFromStorage()
const urlViewState = readViewStateFromLocation()
const initialViewState = urlViewState
  ? {
      ...storedViewState,
      ...urlViewState,
      projection: storedViewState?.projection || urlViewState.projection || 'EPSG:3857',
    }
  : storedViewState
const map = new Map({
  target: 'map',
  layers: [fallbackLayer, norwayLayer, switzerlandLayer, franceLayer, belgiumLayer, austriaLayer, italyLayer],
  view: buildViewForProjection(initialViewState?.projection || 'EPSG:3857'),
})

if (initialViewState) {
  applyViewStateToView(map.getView(), initialViewState)
}

const swissCapabilitiesUrl = 'https://wmts.geo.admin.ch/EPSG/3857/1.0.0/WMTSCapabilities.xml'

fetch(swissCapabilitiesUrl)
  .then((response) => response.text())
  .then((text) => {
    const parser = new WMTSCapabilities()
    const capabilities = parser.read(text)
    const options = optionsFromCapabilities(capabilities, {
      layer: 'ch.swisstopo.pixelkarte-farbe',
      matrixSet: '3857_19',
    })

    const swissTileGrid = options.tileGrid
    const originalGetZForResolution = swissTileGrid.getZForResolution.bind(swissTileGrid)
    swissTileGrid.getZForResolution = (resolution, direction) => {
      const baseZ = originalGetZForResolution(resolution, direction)
      return Math.min(baseZ + 1, swissTileGrid.getResolutions().length - 1)
    }

    switzerlandLayer.setSource(new WMTS({
      ...options,
      url: 'https://wmts.geo.admin.ch/EPSG/3857/1.0.0/',
      requestEncoding: 'REST',
      tileGrid: swissTileGrid,
      attributions: '© swisstopo',
      crossOrigin: 'anonymous',
      wrapX: false,
    }))
  })


function setLayerSourceFromCapabilities(layer, capabilitiesText, options, extraOptions = {}) {
  const parser = new WMTSCapabilities()
  const capabilities = parser.read(capabilitiesText)
  const sourceOptions = optionsFromCapabilities(capabilities, options)
  if (!sourceOptions) return
  layer.setSource(new WMTS({
    ...sourceOptions,
    crossOrigin: 'anonymous',
    ...extraOptions,
  }))
}

fetch('https://cartoweb.wmts.ngi.be/1.0.0/WMTSCapabilities.xml')
  .then((response) => response.text())
  .then((text) => {
    setLayerSourceFromCapabilities(belgiumLayer, text, {
      layer: 'topo',
      matrixSet: '3857',
    }, {
      attributions: '© NGI (Nationaal Geografisch Instituut)',
      wrapX: false,
    })
  })


function buildViewForProjection(projectionCode) {
  const projection = getProjection(projectionCode)
  const center = transform(DEFAULT_CENTER_LON_LAT, 'EPSG:4326', projectionCode)
  const zoom = projectionCode === PEIRCE_CODE ? 2 : DEFAULT_ZOOM

  return new View({
    projection,
    center,
    zoom,
    extent: projection?.getExtent() || undefined,
    constrainOnlyCenter: projectionCode !== PEIRCE_CODE,
    multiWorld: projectionCode === PEIRCE_CODE,
  })
}

function switchProjection(projectionCode) {
  const currentView = map.getView()
  const currentCenter = currentView.getCenter()
  const currentProjectionCode = currentView.getProjection().getCode()
  const nextView = buildViewForProjection(projectionCode)
  if (currentCenter) {
    const centerLonLat = transform(currentCenter, currentProjectionCode, 'EPSG:4326')
    nextView.setCenter(transform(centerLonLat, 'EPSG:4326', projectionCode))
  }
  const currentZoom = currentView.getZoom()
  if (Number.isFinite(currentZoom)) {
    nextView.setZoom(currentZoom)
  }
  nextView.setRotation(currentView.getRotation() || 0)
  map.setView(nextView)
  bindViewStateListener(nextView)
  bindScaleBarListener(nextView)
  writeViewStateToStorage(nextView)
  updateProjectionPickerState()
}

function updateProjectionPickerState() {
  const view = map.getView()
  const center = view.getCenter()
  if (!center) return

  const currentProjectionCode = view.getProjection().getCode()
  const centerLonLat = transform(center, currentProjectionCode, 'EPSG:4326')

  const picker = document.getElementById('projection-picker')
  if (!picker) return

  picker.value = currentProjectionCode

  for (const option of picker.options) {
    if (option.value === currentProjectionCode) {
      option.disabled = false
      continue
    }

    const projection = getProjection(option.value)
    const extent = projection?.getExtent()
    if (!extent) {
      option.disabled = false
      continue
    }

    const centerInProjection = transform(centerLonLat, 'EPSG:4326', option.value)
    option.disabled = !containsCoordinate(extent, centerInProjection)
  }
}

function applyStoredLayerVisibility() {
  const stored = getStoredLayerVisibility()
  if (!stored) return
  fallbackLayer.setVisible(stored.opentopomap ?? true)
  norwayLayer.setVisible(stored.norway ?? true)
  switzerlandLayer.setVisible(stored.switzerland ?? true)
  franceLayer.setVisible(stored.france ?? true)
  belgiumLayer.setVisible(stored.belgium ?? false)
  austriaLayer.setVisible(stored.austria ?? false)
  italyLayer.setVisible(stored.italy ?? false)
}

applyStoredLayerVisibility()
syncVisibleUiFromLayers()
updateProjectionPickerState()

bindViewStateListener(map.getView())

document.getElementById('zoom-in')?.addEventListener('click', () => zoomBy(1))

document.getElementById('zoom-out')?.addEventListener('click', () => zoomBy(-1))

window.addEventListener('keydown', handleGlobalKeydown)

document.getElementById('projection-picker')?.addEventListener('change', (event) => {
  switchProjection(event.target.value)
})

document.getElementById('toggle-opentopo')?.addEventListener('change', (event) => {
  fallbackLayer.setVisible(event.target.checked)
  storeLayerVisibility({
    opentopomap: event.target.checked,
    norway: norwayLayer.getVisible(),
    switzerland: switzerlandLayer.getVisible(),
    france: franceLayer.getVisible(),
    belgium: belgiumLayer.getVisible(),
    austria: austriaLayer.getVisible(),
    italy: italyLayer.getVisible(),
  })
})

document.getElementById('toggle-norway')?.addEventListener('change', (event) => {
  norwayLayer.setVisible(event.target.checked)
  storeLayerVisibility({
    opentopomap: fallbackLayer.getVisible(),
    norway: event.target.checked,
    switzerland: switzerlandLayer.getVisible(),
    france: franceLayer.getVisible(),
    belgium: belgiumLayer.getVisible(),
    austria: austriaLayer.getVisible(),
    italy: italyLayer.getVisible(),
  })
})

document.getElementById('toggle-switzerland')?.addEventListener('change', (event) => {
  switzerlandLayer.setVisible(event.target.checked)
  storeLayerVisibility({
    opentopomap: fallbackLayer.getVisible(),
    norway: norwayLayer.getVisible(),
    switzerland: event.target.checked,
    france: franceLayer.getVisible(),
    belgium: belgiumLayer.getVisible(),
    austria: austriaLayer.getVisible(),
    italy: italyLayer.getVisible(),
  })
})

document.getElementById('toggle-france')?.addEventListener('change', (event) => {
  franceLayer.setVisible(event.target.checked)
  storeLayerVisibility({
    opentopomap: fallbackLayer.getVisible(),
    norway: norwayLayer.getVisible(),
    switzerland: switzerlandLayer.getVisible(),
    france: event.target.checked,
    belgium: belgiumLayer.getVisible(),
    austria: austriaLayer.getVisible(),
    italy: italyLayer.getVisible(),
  })
})

document.getElementById('toggle-belgium')?.addEventListener('change', (event) => {
  belgiumLayer.setVisible(event.target.checked)
  storeLayerVisibility({
    opentopomap: fallbackLayer.getVisible(),
    norway: norwayLayer.getVisible(),
    switzerland: switzerlandLayer.getVisible(),
    france: franceLayer.getVisible(),
    belgium: event.target.checked,
    austria: austriaLayer.getVisible(),
    italy: italyLayer.getVisible(),
  })
})

document.getElementById('toggle-austria')?.addEventListener('change', (event) => {
  austriaLayer.setVisible(event.target.checked)
  storeLayerVisibility({
    opentopomap: fallbackLayer.getVisible(),
    norway: norwayLayer.getVisible(),
    switzerland: switzerlandLayer.getVisible(),
    france: franceLayer.getVisible(),
    belgium: belgiumLayer.getVisible(),
    austria: event.target.checked,
    italy: italyLayer.getVisible(),
  })
})

document.getElementById('toggle-italy')?.addEventListener('change', (event) => {
  italyLayer.setVisible(event.target.checked)
  storeLayerVisibility({
    opentopomap: fallbackLayer.getVisible(),
    norway: norwayLayer.getVisible(),
    switzerland: switzerlandLayer.getVisible(),
    france: franceLayer.getVisible(),
    belgium: belgiumLayer.getVisible(),
    austria: austriaLayer.getVisible(),
    italy: event.target.checked,
  })
})

function haversineDistance(lonLatA, lonLatB) {
  const R = 6371000
  const toRad = Math.PI / 180
  const dLat = (lonLatB[1] - lonLatA[1]) * toRad
  const dLon = (lonLatB[0] - lonLatA[0]) * toRad
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lonLatA[1] * toRad) * Math.cos(lonLatB[1] * toRad) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function getNiceDistance(meters) {
  const km = meters / 1000
  const niceValues = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
  let best = niceValues[0]
  for (const nice of niceValues) {
    if (Math.abs(nice - km) < Math.abs(best - km)) best = nice
  }
  return best * 1000
}

function formatDistance(meters) {
  if (meters >= 1000) {
    const km = meters / 1000
    return `${km} km`
  }
  return `${Math.round(meters)} m`
}

const scaleBarEl = document.querySelector('.scalebar-track')
const scaleLabelEl = document.querySelector('#scalebar-end-label')
const REFERENCE_PX = 100
const TARGET_PX = 150
const MIN_BAR_PX = 40
const MAX_BAR_PX = 200
let lastMousePixel = null
let scaleBarRafId = null

function updateScaleBar(pixel) {
  if (!scaleBarEl || !scaleLabelEl) return
  if (!pixel) return

  const projectionCode = map.getView().getProjection().getCode()
  const pixelA = [pixel[0], pixel[1]]
  const pixelB = [pixel[0] + REFERENCE_PX, pixel[1]]

  const coordA = map.getCoordinateFromPixel(pixelA)
  const coordB = map.getCoordinateFromPixel(pixelB)
  if (!coordA || !coordB) return
  if (!coordA.every(Number.isFinite) || !coordB.every(Number.isFinite)) return

  const lonLatA = transform(coordA, projectionCode, 'EPSG:4326')
  const lonLatB = transform(coordB, projectionCode, 'EPSG:4326')
  if (!lonLatA || !lonLatB) return
  if (!lonLatA.every(Number.isFinite) || !lonLatB.every(Number.isFinite)) return

  const geodesicDistance = haversineDistance(lonLatA, lonLatB)
  if (!isFinite(geodesicDistance) || geodesicDistance <= 0) return

  const metersPerPixel = geodesicDistance / REFERENCE_PX
  const candidateDistance = metersPerPixel * TARGET_PX
  const niceKmValues = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]

  let niceDistance = getNiceDistance(candidateDistance)
  let barWidthPx = niceDistance / metersPerPixel
  let bestDiff = Math.abs(barWidthPx - TARGET_PX)

  for (const nice of niceKmValues) {
    const candidate = nice * 1000
    const w = candidate / metersPerPixel
    if (w >= MIN_BAR_PX && w <= MAX_BAR_PX) {
      const diff = Math.abs(w - TARGET_PX)
      if (diff < bestDiff) {
        bestDiff = diff
        niceDistance = candidate
        barWidthPx = w
      }
    }
  }

  scaleBarEl.style.width = `${Math.round(barWidthPx)}px`
  scaleLabelEl.textContent = formatDistance(niceDistance)
}

function bindScaleBarListener(view) {
  view.on(['change:center', 'change:resolution', 'change:rotation'], () => {
    if (lastMousePixel) {
      updateScaleBar(lastMousePixel)
    } else {
      const center = view.getCenter()
      if (center) {
        const centerPixel = map.getPixelFromCoordinate(center)
        if (centerPixel) updateScaleBar(centerPixel)
      }
    }
  })
}

map.on('pointermove', (evt) => {
  lastMousePixel = evt.pixel
  if (scaleBarRafId) return
  scaleBarRafId = requestAnimationFrame(() => {
    scaleBarRafId = null
    updateScaleBar(lastMousePixel)
  })
})

const initialCenter = map.getView().getCenter()
if (initialCenter) {
  const initialPixel = map.getPixelFromCoordinate(initialCenter)
  if (initialPixel) updateScaleBar(initialPixel)
}

bindScaleBarListener(map.getView())

window.__demoDebug = {
  getMap() {
    return map
  },
  getZoom() {
    return map.getView().getZoom()
  },
  getProjection() {
    return map.getView().getProjection().getCode()
  },
  projectLonLat(lon, lat) {
    return projectLonLatToPeirce([lon, lat])
  },
  unprojectCoordinate(x, y) {
    return unprojectPeirceToLonLat([x, y])
  },
  getRotation() {
    return map.getView().getRotation() || 0
  },
  getLayerInfo() {
    return [
      { name: 'opentopomap', visible: fallbackLayer.getVisible() },
      { name: 'norway', visible: norwayLayer.getVisible() },
      { name: 'switzerland', visible: switzerlandLayer.getVisible() },
      { name: 'france', visible: franceLayer.getVisible() },
      { name: 'belgium', visible: belgiumLayer.getVisible() },
      { name: 'austria', visible: austriaLayer.getVisible() },
      { name: 'italy', visible: italyLayer.getVisible() },
    ]
  },
}
