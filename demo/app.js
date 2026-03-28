import Map from 'ol/Map.js'
import View from 'ol/View.js'
import WMTSCapabilities from 'ol/format/WMTSCapabilities.js'
import {DEVICE_PIXEL_RATIO} from 'ol/has.js'
import TileLayer from 'ol/layer/Tile.js'
import XYZ from 'ol/source/XYZ.js'
import WMTS, {optionsFromCapabilities} from 'ol/source/WMTS.js'
import WMTSTileGrid from 'ol/tilegrid/WMTS.js'
import {getWidth} from 'ol/extent.js'
import {fromLonLat, get as getProjection, transform} from 'ol/proj.js'
import {register} from 'ol/proj/proj4.js'
import proj4 from 'proj4'
import chBorderRingsFlat from './data/ch-border.js'
import frBorderRingsFlat from './data/fr-border.js'
import beBorderRingsFlat from './data/be-border.js'
import deBorderRingsFlat from './data/de-border.js'
import atBorderRingsFlat from './data/at-border.js'
import itBzBorderRingsFlat from './data/it-bz-border.js'

proj4.defs('EPSG:3035', '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs')
proj4.defs('EPSG:25833', '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs')
proj4.defs('EPSG:2056', '+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.4,15.1,405.3,0,0,0,0 +units=m +no_defs')
register(proj4)

getProjection('EPSG:3035')?.setExtent([1900000, 900000, 6900000, 5500000])
getProjection('EPSG:25833')?.setExtent([-1200000, 3500000, 2500000, 8500000])
getProjection('EPSG:2056')?.setExtent([2420000, 1030000, 2900000, 1350000])

const DEFAULT_CENTER_LON_LAT = [10.5, 59.9]
const DEFAULT_ZOOM = 4

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
    const pixelRatio = frameState.pixelRatio || 1

    ctx.save()
    ctx.beginPath()

    for (const ring of polygonRings) {
      for (let i = 0; i < ring.length; i += 1) {
        const coord3857 = transform(ring[i], 'EPSG:4326', 'EPSG:3857')
        const x = (matrix[0] * coord3857[0] + matrix[1] * coord3857[1] + matrix[4]) * pixelRatio
        const y = (matrix[2] * coord3857[0] + matrix[3] * coord3857[1] + matrix[5]) * pixelRatio
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
    }

    ctx.clip()
  }
}

function restoreRenderState(event) {
  if (event.context) event.context.restore()
}

function zoomBy(delta) {
  const view = map.getView()
  view.setZoom((view.getZoom() || 0) + delta)
}

function panByPixels(deltaX, deltaY) {
  const view = map.getView()
  const resolution = view.getResolution()
  const center = view.getCenter()
  if (!resolution || !center) return
  view.setCenter([
    center[0] + deltaX * resolution,
    center[1] - deltaY * resolution,
  ])
}

function isEditableTarget(target) {
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)
  )
}

function handleGlobalKeydown(event) {
  if (event.defaultPrevented || isEditableTarget(event.target)) return

  const isZoomIn = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd'
  const isZoomOut = event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract'
  const panStep = 160

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
    panByPixels(-panStep, 0)
    return
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault()
    panByPixels(panStep, 0)
    return
  }

  if (!isZoomIn && !isZoomOut) return

  event.preventDefault()
  zoomBy(isZoomIn ? 1 : -1)
}

const swissPolygonRings = chBorderRingsFlat.map((ring) => flatToPairs(Array.from(ring)))
const francePolygonRings = frBorderRingsFlat.map((ring) => flatToPairs(Array.from(ring)))
const belgiumPolygonRings = beBorderRingsFlat.map((ring) => flatToPairs(Array.from(ring)))
const germanyPolygonRings = deBorderRingsFlat.map((ring) => flatToPairs(Array.from(ring)))
const austriaPolygonRings = atBorderRingsFlat.map((ring) => flatToPairs(Array.from(ring)))
const italyPolygonRings = itBzBorderRingsFlat.map((ring) => flatToPairs(Array.from(ring)))

const fallbackLayer = new TileLayer({
  source: new XYZ({
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    attributions: '© OpenTopoMap contributors',
    crossOrigin: 'anonymous',
    maxZoom: 17,
  }),
})

const norwayLayer = new TileLayer({
  source: new XYZ({
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png',
    attributions: '© Kartverket',
    crossOrigin: 'anonymous',
    maxZoom: 20,
  }),
})

const switzerlandLayer = new TileLayer()
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
  source: new WMTS({
    url: 'https://data.geopf.fr/wmts',
    layer: 'PLAN-IGN',
    matrixSet: 'PM',
    format: 'image/png',
    projection: 'EPSG:3857',
    tileGrid: new WMTSTileGrid({
      origin: [-20037508, 20037508],
      resolutions: franceResolutions,
      matrixIds: franceMatrixIds,
    }),
    style: 'CLASSIQUE',
    attributions: '© IGN',
    crossOrigin: 'anonymous',
  }),
})
franceLayer.on('prerender', makeRenderClip(francePolygonRings))
franceLayer.on('postrender', restoreRenderState)

// Belgium TOPO layer
const belgiumLayer = new TileLayer({
  source: new WMTS({
    url: 'https://cartoweb.wmts.ngi.be/1.0.0/WMTSCapabilities.xml',
    layer: 'TOPO',
    matrixSet: '3857',
    format: 'image/png',
    projection: 'EPSG:3857',
    style: 'default',
    attributions: '© NGI (Nationaal Geografisch Instituut)',
    crossOrigin: 'anonymous',
  }),
  visible: false,
})
belgiumLayer.on('prerender', makeRenderClip(belgiumPolygonRings))
belgiumLayer.on('postrender', restoreRenderState)

// Germany basemap.de layer
const germanyLayer = new TileLayer({
  source: new WMTS({
    url: 'https://sgx.geodatenzentrum.de/wmts_basemapde',
    layer: 'de_basemapde_web_raster_farbe',
    matrixSet: 'EPSG:3857',
    format: 'image/png',
    projection: 'EPSG:3857',
    style: 'default',
    attributions: '© GeoBasis-DE / BKG (' + new Date().getFullYear() + ') CC BY 4.0',
    crossOrigin: 'anonymous',
  }),
  visible: false,
})
germanyLayer.on('prerender', makeRenderClip(germanyPolygonRings))
germanyLayer.on('postrender', restoreRenderState)

// Austria geolandbasemap layer
const austriaLayer = new TileLayer({
  source: new WMTS({
    url: 'https://mapsneu.wien.gv.at/basemapneu',
    layer: 'geolandbasemap',
    matrixSet: 'google3857',
    format: 'image/png',
    projection: 'EPSG:3857',
    style: 'normal',
    attributions: 'Data source: basemap.at',
    crossOrigin: 'anonymous',
  }),
  visible: false,
})
austriaLayer.on('prerender', makeRenderClip(austriaPolygonRings))
austriaLayer.on('postrender', restoreRenderState)

// Italy/Bolzano layer
const italyLayer = new TileLayer({
  source: new XYZ({
    url: 'https://b-tiles.buergernetz.bz.it/mapproxy/wmts/p_bz-BaseMap:Basemap-Standard/EPSG:3857/{z}/{x}/{y}.png',
    attributions: '© Autonome Provinz Bozen/Südtirol',
    crossOrigin: 'anonymous',
    maxZoom: 18,
  }),
  visible: false,
})
italyLayer.on('prerender', makeRenderClip(italyPolygonRings))
italyLayer.on('postrender', restoreRenderState)

const map = new Map({
  target: 'map',
  layers: [fallbackLayer, norwayLayer, switzerlandLayer, franceLayer, belgiumLayer, germanyLayer, austriaLayer, italyLayer],
  view: new View({
    projection: 'EPSG:3857',
    center: fromLonLat(DEFAULT_CENTER_LON_LAT),
    zoom: DEFAULT_ZOOM,
  }),
})

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

    switzerlandLayer.setSource(new WMTS({
      ...options,
      attributions: '© swisstopo',
      crossOrigin: 'anonymous',
      tilePixelRatio: DEVICE_PIXEL_RATIO > 1 ? 2 : 1,
      wrapX: false,
    }))
  })

function buildViewForProjection(projectionCode) {
  const projection = getProjection(projectionCode)
  const center = transform(DEFAULT_CENTER_LON_LAT, 'EPSG:4326', projectionCode)

  return new View({
    projection,
    center,
    zoom: DEFAULT_ZOOM,
    extent: projection?.getExtent() || undefined,
    constrainOnlyCenter: true,
  })
}

function switchProjection(projectionCode) {
  map.setView(buildViewForProjection(projectionCode))
}

document.getElementById('zoom-in')?.addEventListener('click', () => zoomBy(1))

document.getElementById('zoom-out')?.addEventListener('click', () => zoomBy(-1))

window.addEventListener('keydown', handleGlobalKeydown)

document.getElementById('projection-picker')?.addEventListener('change', (event) => {
  switchProjection(event.target.value)
})

document.getElementById('toggle-opentopo')?.addEventListener('change', (event) => {
  fallbackLayer.setVisible(event.target.checked)
})

document.getElementById('toggle-norway')?.addEventListener('change', (event) => {
  norwayLayer.setVisible(event.target.checked)
})

document.getElementById('toggle-switzerland')?.addEventListener('change', (event) => {
  switzerlandLayer.setVisible(event.target.checked)
})

document.getElementById('toggle-france')?.addEventListener('change', (event) => {
  franceLayer.setVisible(event.target.checked)
})

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
  getLayerInfo() {
    return [
      { name: 'opentopomap', visible: fallbackLayer.getVisible() },
      { name: 'norway', visible: norwayLayer.getVisible() },
      { name: 'switzerland', visible: switzerlandLayer.getVisible() },
      { name: 'france', visible: franceLayer.getVisible() },
    ]
  },
}
