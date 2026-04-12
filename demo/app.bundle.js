// Global namespace references from CDN bundles
const ol = window.ol;
const proj4 = window.proj4;

// Destructure commonly used OpenLayers classes
const Map = ol.Map;
const View = ol.View;
const WMTSCapabilities = ol.format.WMTSCapabilities;
const DEVICE_PIXEL_RATIO = ol.has.DEVICE_PIXEL_RATIO;
const TileLayer = ol.layer.Tile;
const XYZ = ol.source.XYZ;
const WMTS = ol.source.WMTS;
const optionsFromCapabilities = ol.source.optionsFromCapabilities;
const WMTSTileGrid = ol.tilegrid.WMTS;
const getWidth = ol.extent.getWidth;
const fromLonLat = ol.proj.fromLonLat;
const getProjection = ol.proj.get;
const transform = ol.proj.transform;
const register = ol.proj.proj4.register;

// Import your custom modules
import chBorderRingsFlat from './data/ch-border.js';
import frBorderRingsFlat from './data/fr-border.js';
import beBorderRingsFlat from './data/be-border.js';
import itBzBorderRingsFlat from './data/it-bz-border.js';
import {
  PEIRCE_CODE,
  PEIRCE_WARP_CODE,
  projectLonLatToPeirce,
  projectLonLatToWarpedPeirce,
  registerPeirceProjection,
  unprojectPeirceToLonLat,
  unprojectWarpedPeirceToLonLat,
} from './peirce.js';

// Define projections
proj4.defs('EPSG:3035', '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs');
proj4.defs('EPSG:25833', '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs');
register(proj4);
registerPeirceProjection();

// Set projection extents
getProjection('EPSG:3035')?.setExtent([1900000, 900000, 6900000, 5500000]);
getProjection('EPSG:25833')?.setExtent([-1200000, 3500000, 2500000, 8500000]);

const DEFAULT_CENTER_LON_LAT = [10.5, 59.9];
const DEFAULT_ZOOM = 4;

// Helper functions
function flatToPairs(flat) {
  const pairs = [];
  for (let i = 0; i < flat.length; i += 2) {
    pairs.push([flat[i], flat[i + 1]]);
  }
  return pairs;
}

function makeRenderClip(polygonRings) {
  return (event) => {
    const ctx = event.context;
    const frameState = event.frameState;
    if (!ctx || !frameState || polygonRings.length === 0) return;

    const matrix = frameState.coordinateToPixelTransform;
    const pixelRatio = frameState.pixelRatio || 1;

    ctx.save();
    ctx.beginPath();

    for (const ring of polygonRings) {
      for (let i = 0; i < ring.length; i += 1) {
        const viewProjection = frameState.viewState?.projection || 'EPSG:3857';
        const projectedCoord = transform(ring[i], 'EPSG:4326', viewProjection);
        const x = (matrix[0] * projectedCoord[0] + matrix[1] * projectedCoord[1] + matrix[4]) * pixelRatio;
        const y = (matrix[2] * projectedCoord[0] + matrix[3] * projectedCoord[1] + matrix[5]) * pixelRatio;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    ctx.clip();
  };
}

function restoreRenderState(event) {
  if (event.context) event.context.restore();
}

function zoomBy(delta) {
  const view = map.getView();
  view.setZoom((view.getZoom() || 0) + delta);
}

function panByPixels(deltaX, deltaY) {
  const view = map.getView();
  const resolution = view.getResolution();
  const center = view.getCenter();
  if (!resolution || !center) return;
  view.setCenter([
    center[0] + deltaX * resolution,
    center[1] - deltaY * resolution,
  ]);
}

function rotateBy(deltaRadians) {
  const view = map.getView();
  view.setRotation((view.getRotation() || 0) + deltaRadians);
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA') return true;
  if (target.tagName !== 'INPUT') return false;
  const type = (target.getAttribute('type') || 'text').toLowerCase();
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range'].includes(type);
}

function handleGlobalKeydown(event) {
  if (event.defaultPrevented || isEditableTarget(event.target)) return;

  const isZoomIn = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd';
  const isZoomOut = event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract';
  const panStep = 160;
  const rotationStep = Math.PI / 12;

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    panByPixels(0, -panStep);
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    panByPixels(0, panStep);
    return;
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) rotateBy(-rotationStep);
    else panByPixels(-panStep, 0);
    return;
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) rotateBy(rotationStep);
    else panByPixels(panStep, 0);
    return;
  }

  if (!isZoomIn && !isZoomOut) return;

  event.preventDefault();
  zoomBy(isZoomIn ? 1 : -1);
}

// Create polygon rings for clipping
const swissPolygonRings = chBorderRingsFlat.map((ring) => flatToPairs(Array.from(ring)));
const francePolygonRings = frBorderRingsFlat.map((ring) => flatToPairs(Array.from(ring)));
const belgiumPolygonRings = beBorderRingsFlat.map((ring) => flatToPairs(Array.from(ring)));
const italyPolygonRings = itBzBorderRingsFlat.map((ring) => flatToPairs(Array.from(ring)));

// Create layers
const fallbackLayer = new TileLayer({
  preload: 2,
  source: new XYZ({
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    attributions: '© OpenTopoMap contributors',
    crossOrigin: 'anonymous',
    maxZoom: 17,
  }),
});

const norwayLayer = new TileLayer({
  preload: 2,
  source: new XYZ({
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png',
    attributions: '© Kartverket',
    crossOrigin: 'anonymous',
    maxZoom: 20,
  }),
});

const switzerlandLayer = new TileLayer({ preload: 2 });
switzerlandLayer.on('prerender', makeRenderClip(swissPolygonRings));
switzerlandLayer.on('postrender', restoreRenderState);

const franceProjection = getProjection('EPSG:3857');
const franceResolutions = [];
const franceMatrixIds = [];
const franceMaxResolution = getWidth(franceProjection.getExtent()) / 256;

for (let i = 0; i < 20; i += 1) {
  franceMatrixIds[i] = i.toString();
  franceResolutions[i] = franceMaxResolution / Math.pow(2, i);
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
});
franceLayer.on('prerender', makeRenderClip(francePolygonRings));
franceLayer.on('postrender', restoreRenderState);

const belgiumLayer = new TileLayer({ visible: false, preload: 2 });
belgiumLayer.on('prerender', makeRenderClip(belgiumPolygonRings));
belgiumLayer.on('postrender', restoreRenderState);

const austriaLayer = new TileLayer({
  preload: 2,
  visible: false,
  source: new XYZ({
    url: 'https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/{z}/{y}/{x}.png',
    attributions: '© basemap.at',
    crossOrigin: 'anonymous',
    maxZoom: 19,
  }),
});

const italyLayer = new TileLayer({
  preload: 2,
  source: new XYZ({
    url: 'https://b-tiles.buergernetz.bz.it/mapproxy/root/wmts/p_bz-BaseMap:Basemap-Standard/EPSG_3857/{z}/{x}/{y}.jpeg',
    attributions: '© Autonome Provinz Bozen/Südtirol',
    crossOrigin: 'anonymous',
  }),
  visible: false,
});
italyLayer.on('prerender', makeRenderClip(italyPolygonRings));
italyLayer.on('postrender', restoreRenderState);

// Create map
const map = new Map({
  target: 'map',
  layers: [fallbackLayer, norwayLayer, switzerlandLayer, franceLayer, belgiumLayer, austriaLayer, italyLayer],
  view: new View({
    projection: 'EPSG:3857',
    center: fromLonLat(DEFAULT_CENTER_LON_LAT),
    zoom: DEFAULT_ZOOM,
  }),
});

// Load Swiss capabilities
const swissCapabilitiesUrl = 'https://wmts.geo.admin.ch/EPSG/3857/1.0.0/WMTSCapabilities.xml';

fetch(swissCapabilitiesUrl)
  .then((response) => response.text())
  .then((text) => {
    const parser = new WMTSCapabilities();
    const capabilities = parser.read(text);
    const options = optionsFromCapabilities(capabilities, {
      layer: 'ch.swisstopo.pixelkarte-farbe',
      matrixSet: '3857_19',
    });

    const swissTileGrid = options.tileGrid;
    const originalGetZForResolution = swissTileGrid.getZForResolution.bind(swissTileGrid);
    swissTileGrid.getZForResolution = (resolution, direction) => {
      const baseZ = originalGetZForResolution(resolution, direction);
      return Math.min(baseZ + 1, swissTileGrid.getResolutions().length - 1);
    };

    switzerlandLayer.setSource(new WMTS({
      ...options,
      url: 'https://wmts.geo.admin.ch/EPSG/3857/1.0.0/',
      requestEncoding: 'REST',
      tileGrid: swissTileGrid,
      attributions: '© swisstopo',
      crossOrigin: 'anonymous',
      wrapX: false,
    }));
  });

// Load Belgium capabilities
function setLayerSourceFromCapabilities(layer, capabilitiesText, options, extraOptions = {}) {
  const parser = new WMTSCapabilities();
  const capabilities = parser.read(capabilitiesText);
  const sourceOptions = optionsFromCapabilities(capabilities, options);
  if (!sourceOptions) return;
  layer.setSource(new WMTS({
    ...sourceOptions,
    crossOrigin: 'anonymous',
    ...extraOptions,
  }));
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
    });
  });

// Projection switching
function buildViewForProjection(projectionCode) {
  const projection = getProjection(projectionCode);
  const center = transform(DEFAULT_CENTER_LON_LAT, 'EPSG:4326', projectionCode);
  const zoom = projectionCode === PEIRCE_CODE || projectionCode === PEIRCE_WARP_CODE ? 2 : DEFAULT_ZOOM;

  return new View({
    projection,
    center,
    zoom,
    extent: projection?.getExtent() || undefined,
    constrainOnlyCenter: true,
  });
}

function switchProjection(projectionCode) {
  map.setView(buildViewForProjection(projectionCode));
}

// Event listeners
document.getElementById('zoom-in')?.addEventListener('click', () => zoomBy(1));
document.getElementById('zoom-out')?.addEventListener('click', () => zoomBy(-1));
window.addEventListener('keydown', handleGlobalKeydown);

document.getElementById('projection-picker')?.addEventListener('change', (event) => {
  switchProjection(event.target.value);
});

document.getElementById('toggle-opentopo')?.addEventListener('change', (event) => {
  fallbackLayer.setVisible(event.target.checked);
});

document.getElementById('toggle-norway')?.addEventListener('change', (event) => {
  norwayLayer.setVisible(event.target.checked);
});

document.getElementById('toggle-switzerland')?.addEventListener('change', (event) => {
  switzerlandLayer.setVisible(event.target.checked);
});

document.getElementById('toggle-france')?.addEventListener('change', (event) => {
  franceLayer.setVisible(event.target.checked);
});

document.getElementById('toggle-belgium')?.addEventListener('change', (event) => {
  belgiumLayer.setVisible(event.target.checked);
});

document.getElementById('toggle-austria')?.addEventListener('change', (event) => {
  austriaLayer.setVisible(event.target.checked);
});

document.getElementById('toggle-italy')?.addEventListener('change', (event) => {
  italyLayer.setVisible(event.target.checked);
});

// Debug API
window.__demoDebug = {
  getMap() {
    return map;
  },
  getZoom() {
    return map.getView().getZoom();
  },
  getProjection() {
    return map.getView().getProjection().getCode();
  },
  projectLonLat(lon, lat) {
    return projectLonLatToPeirce([lon, lat]);
  },
  projectLonLatWarped(lon, lat) {
    return projectLonLatToWarpedPeirce([lon, lat]);
  },
  unprojectCoordinate(x, y) {
    return unprojectPeirceToLonLat([x, y]);
  },
  unprojectWarpedCoordinate(x, y) {
    return unprojectWarpedPeirceToLonLat([x, y]);
  },
  getRotation() {
    return map.getView().getRotation() || 0;
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
    ];
  },
};