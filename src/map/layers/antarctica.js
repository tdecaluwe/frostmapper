import XYZ from 'ol/source/XYZ.js'
import TileLayer from 'ol/layer/Tile.js'
import TileGrid from 'ol/tilegrid/TileGrid.js'
import {get as getProjection} from 'ol/proj.js'
import {createMapView} from '../projections/view.js?v=viewport-model'
import {guardReprojection} from './reprojection-budget.js?v=contour-bands'

// BAS public raster service (OGL 3.0). Its cache uses Antarctic stereographic
// metres, not Web Mercator XYZ resolutions. Native 3031 also covers the pole.
export const ANTARCTIC_SERVICE='https://tiles.arcgis.com/tiles/tPxy1hrFDhJfZ0Mf/arcgis/rest/services/Antarctica_and_the_Southern_Ocean/MapServer'
export const ANTARCTIC_EXTENT=[-4898635.244666592,-4898635.24466659,4898635.24466659,4898635.244666592]
export function createAntarcticSource(){
 const source=new XYZ({projection:'EPSG:3031',crossOrigin:'anonymous',wrapX:true,transition:0,maxZoom:13,
  tileGrid:new TileGrid({extent:ANTARCTIC_EXTENT,origin:[-30635955.4472718,30635955.4472718],resolutions:Array.from({length:14},(_,z)=>239343.40193181095/2**z),tileSize:256}),
  url:`${ANTARCTIC_SERVICE}/tile/{z}/{y}/{x}`,
  attributions:'<a href="https://data.bas.ac.uk/maps/5001">Antarctica and the Southern Ocean basemap, British Antarctic Survey</a> (OGL 3.0)'
 })
 guardReprojection(source);return source
}
export function addAntarcticaLayer(map){
 const layer=new TileLayer({properties:{storageLabel:'Antarctica · BAS'},source:createAntarcticSource(),visible:true,zIndex:1,preload:2,cacheSize:512});map.addLayer(layer)
 const row=document.createElement('div');row.className='trek-row'
 const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=true;label.append(input,' Antarctica · BAS');row.append(label)
 const show=document.createElement('button');show.type='button';show.textContent='↗';show.title='Show Antarctica';show.setAttribute('aria-label',show.title);row.append(show);document.querySelector('#layers').append(row)
 const base=map.getLayers().item(0)
 const update=()=>{base.setVisible(!(layer.getVisible()&&map.getView().getProjection().getCode()==='EPSG:3031'))}
 input.addEventListener('change',()=>{layer.setVisible(input.checked);update()});map.on('change:view',update)
 show.addEventListener('click',()=>{
  layer.setVisible(true);input.checked=true
  map.setView(createMapView('EPSG:3031',[0,-90],2,0,{exactRotation:true}))
  document.querySelector('#projection').value='EPSG:3031'
  const extent=getProjection('EPSG:3031').getExtent();map.getView().fit(extent,{size:map.getSize(),padding:[20,55,20,20]})
  update()
 })
 update();return layer
}
