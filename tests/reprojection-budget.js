import '../src/map/projections/index.js?v=triptychial'
import XYZ from 'ol/source/XYZ.js'
import TileState from 'ol/TileState.js'
import Triangulation from 'ol/reproj/Triangulation.js'
import {createXYZ} from 'ol/tilegrid.js'
import {get,transform} from 'ol/proj.js'
import {createEmpty,extend} from 'ol/extent.js'
import {guardReprojection,MAX_SOURCE_AREA_RATIO} from '../src/map/layers/reprojection-budget.js'

const guarded=new XYZ({url:'https://example.test/{z}/{x}/{y}.png',maxZoom:17})
const plain=new XYZ({url:'https://example.test/{z}/{x}/{y}.png',maxZoom:17})
guardReprojection(guarded)
const errors=[]
let checked=0
function check(code,lon,lat,z,compare){
 const projection=get(code),targetGrid=guarded.getTileGridForProjection(projection)
 const coord=targetGrid.getTileCoordForCoordAndZ(transform([lon,lat],'EPSG:4326',projection),z)
 const tile=guarded.getTile(...coord,1,projection)
 if(tile.getState()===TileState.EMPTY)return
 const sourceGrid=guarded.getTileGridForProjection(guarded.getProjection()),sourceExtent=createEmpty()
 for(const item of tile.sourceTiles_){const extent=sourceGrid.getTileCoordExtent(item.tile.tileCoord);extent[0]+=item.offset;extent[2]+=item.offset;extend(sourceExtent,extent)}
 if(sourceExtent.every(Number.isFinite)){
  const r=sourceGrid.getResolution(tile.sourceZ_),width=Math.round((sourceExtent[2]-sourceExtent[0])/r),height=Math.round((sourceExtent[3]-sourceExtent[1])/r)
  const tileSize=targetGrid.getTileSize(z),[w,h]=typeof tileSize==='number'?[tileSize,tileSize]:tileSize
  if(width*height>w*h*MAX_SOURCE_AREA_RATIO)errors.push(`${code} ${lon},${lat} z${z}: ${width}×${height}`)
  checked++
 }
 if(compare){const old=plain.getTile(...coord,1,projection);if(old.sourceZ_!==tile.sourceZ_)errors.push(`unnecessary downscaling: ${code}, ${lon},${lat}, z${z}`)}
}
for(const z of [4,6,8,10,12])for(const lat of [0,47,80,85,89,90])check('FROST:TRIPTYCHIAL',0,lat,z,lat===47)
for(const z of [4,8,12]){
 check('EPSG:3035',10,50,z,true)
 for(const lon of [-179,-90,0,90,179])for(const lat of [-80,0,80,89])check('EPSG:PEIRCE',lon,lat,z,false)
}
// If the source offers no coarser zoom, the oversized target tile must be empty.
const restricted=new XYZ({url:'https://example.test/{z}/{x}/{y}.png',tileGrid:createXYZ({minZoom:8,maxZoom:8})})
guardReprojection(restricted)
const trip=get('FROST:TRIPTYCHIAL'),grid=restricted.getTileGridForProjection(trip)
const polar=grid.getTileCoordForCoordAndZ(transform([0,80],'EPSG:4326',trip),3)
let rejected=false
for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
 const tile=restricted.getTile(polar[0],polar[1]+dx,polar[2]+dy,1,trip)
 if(tile.getState()===TileState.EMPTY && !('sourceZ_' in tile))rejected=true
}
if(!rejected)errors.push('oversized tile was not rejected when no coarser zoom was available')
// The guarded call should reuse OpenLayers' triangulation, not create another.
const savedGetTriangles=Triangulation.prototype.getTriangles,seen=new Set()
Triangulation.prototype.getTriangles=function(...args){seen.add(this);return savedGetTriangles.apply(this,args)}
try{
 const view=get('FROST:TRIPTYCHIAL'),tileGrid=guarded.getTileGridForProjection(view)
 const coord=tileGrid.getTileCoordForCoordAndZ(transform([8,47],'EPSG:4326',view),8)
 guarded.getTile(...coord,1,view)
 if(seen.size!==1)errors.push(`expected one triangulation, saw ${seen.size}`)
 if(Triangulation.prototype.getTriangles===savedGetTriangles)errors.push('test hook was not restored')
}finally{Triangulation.prototype.getTriangles=savedGetTriangles}
// Both temporary overrides must also be restored if tile creation fails.
const failing=new XYZ({url:'https://example.test/{z}/{x}/{y}.png'})
failing.getTile=()=>{throw new Error('test failure')}
guardReprojection(failing)
const failingGrid=failing.getTileGridForProjection(failing.getProjection()),savedGridMethod=failingGrid.getZForResolution
try{failing.getTile(4,1,1,1,get('FROST:TRIPTYCHIAL'));errors.push('expected error from tile creation')}catch(error){if(error.message!=='test failure')errors.push(`unexpected error: ${error.message}`)}
if(Triangulation.prototype.getTriangles!==savedGetTriangles||failingGrid.getZForResolution!==savedGridMethod)errors.push('temporary hooks not restored after error')
if(!checked)errors.push('no reprojected tiles were checked')
document.querySelector('#results').textContent=errors.length?errors.join('\n'):`Passed ${checked} reprojection budget checks`
if(errors.length)throw Error(errors.join('\n'))
