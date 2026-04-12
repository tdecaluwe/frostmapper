import { Extent, Viewport } from './primitives.js'

// ---------------------------------------------------------------------------
// Tile bounding box (standard XYZ / Web Mercator formula)
// ---------------------------------------------------------------------------

export function tileBounds(z, x, y) {
  const n     = Math.pow(2, z)
  const west  = (x / n) * 360 - 180
  const east  = ((x + 1) / n) * 360 - 180
  const north = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI
  const south = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI
  return { north, south, east, west }
}

// ---------------------------------------------------------------------------
// Coverage extents for each basemap provider (WGS84)
// ---------------------------------------------------------------------------

export const PROVIDER_COVERAGE = {
  kartverket:   new Extent({ north: 72, south: 57, east: 32, west:  4, crs: 'EPSG:4326' }),
  lantmateriet: new Extent({ north: 70, south: 55, east: 25, west: 10, crs: 'EPSG:4326' }),
  opentopomap:  null,  // global — always serves
}

/**
 * Compute a power-of-two `stride` for a source with `baseResolution` (degrees per cell)
 * for a given map `zoom`. This returns the smallest power-of-two >= desired stride
 * that makes `baseResolution * stride` roughly match the map pixel resolution.
 *
 * This is conservative and doesn't require viewport latitude; it's sufficient
 * for selecting an appropriate overview level for raster sources.
 */
export function targetStride(baseResolution, zoom) {
  // Approximate degrees per screen pixel at given zoom (world width = 360°)
  const degPerPixel = 360 / (256 * Math.pow(2, zoom))
  const desired = degPerPixel / baseResolution
  if (desired <= 1) return 1
  let stride = 1
  while (stride < desired) stride *= 2
  return stride
}


// ---------------------------------------------------------------------------
// MapManager
// ---------------------------------------------------------------------------

export class MapManager {
  /**
   * @param {object} options
   * @param {string}   options.container      - DOM element ID for MapLibre
   * @param {function} [options.MapLibre]     - MapLibre constructor (default: window.maplibregl.Map)
   * @param {number[]} [options.initialCenter]- [lon, lat], default [15.0, 65.0]
   * @param {number}   [options.initialZoom]  - default 5
   * @param {string}   [options.lantmaterietToken] - Token for Lantmäteriet tiles
   */
  constructor({
    container,
    MapLibre,
    initialCenter = [15.0, 65.0],
    initialZoom   = 5,
    lantmaterietToken = null,
  } = {}) {
    this._lantmaterietToken = lantmaterietToken
    this._subscribers       = new Set()
    this._destroyed         = false

    // Resolve MapLibre constructor
    const ML = MapLibre ?? (typeof maplibregl !== 'undefined' ? maplibregl.Map : null)
    if (!ML) throw new Error('MapLibre constructor not provided and window.maplibregl is not available')

    this._ML = ML

    // Build basemap style
    const style = this._buildStyle()

    this._map = new ML({ container, style, center: initialCenter, zoom: initialZoom, canvasContextAttributes: { preserveDrawingBuffer: true } })

    // Viewport subscription
    this._onMove = () => {
      if (this._destroyed) return
      const vp = this._buildViewport()
      for (const cb of this._subscribers) cb(vp)
    }
    this._map.on('moveend', this._onMove)
  }

  get map() { return this._map }

  setLantmaterietToken(token) {
    this._lantmaterietToken = token
  }

  // --------------------------------------------------------------------------
  // Viewport
  // --------------------------------------------------------------------------

  /**
   * Subscribe to viewport changes. Returns an unsubscribe function.
   * @param {function} callback - (Viewport) => void
   * @returns {function}
   */
  onViewportChange(callback) {
    this._subscribers.add(callback)
    return () => this._subscribers.delete(callback)
  }

  /**
   * Returns the current Viewport synchronously.
   * @returns {Viewport}
   */
  getViewport() {
    return this._buildViewport()
  }

  _buildViewport() {
    const b        = this._map.getBounds()
    const zoom     = this._map.getZoom()
    const el       = this._map.getContainer()
    const widthPx  = el?.clientWidth  ?? 1024
    const heightPx = el?.clientHeight ?? 768

    const proj4 = (typeof globalThis.proj4 !== 'undefined') ? globalThis.proj4 : null
    let west, south, east, north
    if (proj4) {
      ;[west, south] = proj4('EPSG:4326', 'EPSG:3857', [b.getWest(), b.getSouth()])
      ;[east, north] = proj4('EPSG:4326', 'EPSG:3857', [b.getEast(), b.getNorth()])
    } else {
      west  = b.getWest()
      south = b.getSouth()
      east  = b.getEast()
      north = b.getNorth()
    }

    return new Viewport({ north, south, east, west, zoom, widthPx, heightPx })
  }

  // --------------------------------------------------------------------------
  // Custom data layers
  // --------------------------------------------------------------------------

  /**
   * Add a MapLibre Custom Layer for a data overlay.
   * If a layer with the same id already exists, removes it first.
   * @param {{ id: string, type: 'custom', onAdd, render, onRemove }} customLayer
   */
  addDataLayer(customLayer) {
    if (this._map.getLayer?.(customLayer.id)) {
      this._map.removeLayer(customLayer.id)
    }
    this._map.addLayer(customLayer)
  }

  /**
   * Remove a Custom Layer by id. No-op if not found.
   * @param {string} id
   */
  removeDataLayer(id) {
    if (this._map.getLayer?.(id)) {
      this._map.removeLayer(id)
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Remove all event listeners and destroy the MapLibre instance.
   */
  destroy() {
    this._destroyed = true
    this._subscribers.clear()
    this._map.off('moveend', this._onMove)
    this._map.remove()
  }


  // --------------------------------------------------------------------------
  // Basemap style
  // --------------------------------------------------------------------------


  _buildStyle() {
    return {
      version: 8,
      sources: {
        opentopomap: {
          type: 'raster',
          tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenTopoMap contributors',
        },
        kartverket: {
          type: 'raster',
          tiles: ['https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png'],
          tileSize: 256,
          attribution: '© Kartverket',
        },
      },
      layers: [
        { id: 'basemap-opentopomap', type: 'raster', source: 'opentopomap' },
        { id: 'basemap-kartverket',  type: 'raster', source: 'kartverket'  },
      ],
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    }
  }
}

// ---------------------------------------------------------------------------
// Compatibility helpers: singleton manager + simple exported API used by app
// ---------------------------------------------------------------------------

let _manager = null
let viewport = null
const _onViewportSubs = new Set()

export function initMap(container, MapLibre, options = {}) {
  if (!_manager) {
    _manager = new MapManager({ container, MapLibre, lantmaterietToken: options.lantmaterietToken })
    _manager.onViewportChange((vp) => {
      viewport = vp
      for (const cb of _onViewportSubs) cb(vp)
    })
  }
  // Convenience: expose simple helpers on `window` for interactive debugging
  if (typeof globalThis !== 'undefined' && typeof globalThis.window !== 'undefined') {
    try {
      globalThis.window.getMap = getMap
      globalThis.window.initMap = initMap
      globalThis.window.onViewportChange = onViewportChange
      globalThis.window.addLantmaterietSource = addLantmaterietSource

      // Quick overlay helpers
      globalThis.window.showAllOverlays = () => {
        const m = getMap();
        if (!m) return;
        const ids = ['layer-snow-season','layer-winter-temp','layer-melt-risk','layer-slope','layer-elevation','layer-road-access','layer-transport-stops','layer-isochrones'];
        for (const id of ids) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'visible');
      }
      globalThis.window.hideAllOverlays = () => {
        const m = getMap();
        if (!m) return;
        const ids = ['layer-snow-season','layer-winter-temp','layer-melt-risk','layer-slope','layer-elevation','layer-road-access','layer-transport-stops','layer-isochrones'];
        for (const id of ids) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none');
      }
      globalThis.window.toggleOverlay = (id, visible) => {
        const m = getMap();
        if (!m) return;
        if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    } catch (e) {
      // ignore in non-browser environments
    }
  }

  return _manager?._map ?? null
}

export function getMap() {
  return _manager?._map ?? null
}

export function onViewportChange(cb) {
  _onViewportSubs.add(cb)
  return () => _onViewportSubs.delete(cb)
}

export function addLantmaterietSource(token) {
  if (!_manager) {
    // Store nothing; when initMap is called later the token can be passed via options
    return
  }
  _manager.setLantmaterietToken(token)
}

export { viewport }
