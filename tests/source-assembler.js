import '../src/map/projections/index.js?v=grieger-wrap'
import Map from 'ol/Map.js'
import XYZ from 'ol/source/XYZ.js'
import TileState from 'ol/TileState.js'
import {get} from 'ol/proj.js'
import {createMapView} from '../src/map/projections/view.js?v=viewport-model'
import {guardReprojection} from '../src/map/layers/reprojection-budget.js?v=contour-bands'
import {ContourReprojection} from '../src/map/reprojection/contour-reprojection.js?v=stable-contours'
import {AssembledSourceTile} from '../src/map/reprojection/source-assembler.js?v=stable-contours'
const errors=[],map=new Map({target:'map',layers:[],controls:[],view:createMapView('FROST:TRIPTYCHIAL',[8.54,47.37],5)})
const source=new XYZ({projection:'EPSG:3857',tileUrlFunction:([z])=>`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="hsl(${z*24} 80% 50%)"/></svg>`)}`,maxZoom:14,crossOrigin:'anonymous'})
guardReprojection(source)
const manager=new ContourReprojection(map);manager.addSource(source)
for(let i=0;i<200&&!manager.sourceAtlases.get('FROST:TRIPTYCHIAL');i++)await new Promise(resolve=>setTimeout(resolve,25))
const atlas=manager.sourceAtlases.get('FROST:TRIPTYCHIAL')
if(!atlas)errors.push('source projection atlas did not load')
let reproj
if(atlas){
 const grid=source.getTileGridForProjection(get('FROST:TRIPTYCHIAL')),coord=grid.getTileCoordForCoordAndZ(get('EPSG:3857').getExtent().slice(0,2),5)
 // Search visible target tiles for one whose source footprint intersects bands.
 const extent=map.getView().calculateExtent(map.getSize()),z=grid.getZForResolution(map.getView().getResolution()),range=grid.getTileRangeForExtentAndZ(extent,z)
 for(let y=range.minY;y<=range.maxY&&!reproj;y++)for(let x=range.minX;x<=range.maxX&&!reproj;x++){const tile=source.getTile(z,x,y,1,get('FROST:TRIPTYCHIAL'));if(tile.sourceTiles_?.some(({tile})=>tile instanceof AssembledSourceTile))reproj=tile;else tile.release()}
 if(!reproj)errors.push('ReprojTile did not receive assembled source tiles')
}
if(reproj){
 const assembled=reproj.sourceTiles_.filter(({tile})=>tile instanceof AssembledSourceTile)
 if(!assembled.length)errors.push('no assembled tile')
 const multi=assembled.find(({tile})=>new Set(tile.spans.map(s=>s.zoom)).size>1)
 if(!multi)errors.push('no source tile crossed a fixed contour')
 reproj.load()
 for(let i=0;i<400&&[TileState.IDLE,TileState.LOADING].includes(reproj.getState());i++)await new Promise(resolve=>setTimeout(resolve,20))
 if(reproj.getState()!==TileState.LOADED)errors.push(`ReprojTile state ${reproj.getState()}`)
 else if(!reproj.getImage()?.width||!reproj.getImage()?.height)errors.push('ReprojTile canvas missing')
 reproj.release()
}
map.setTarget(undefined)
document.querySelector('#results').textContent=errors.length?errors.join('\n'):'Passed source assembler integration checks'
if(errors.length)throw Error(errors.join('\n'))
