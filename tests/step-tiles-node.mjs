import assert from 'node:assert/strict'
import {createXYZ} from 'ol/tilegrid.js'
import Tile from 'ol/Tile.js'
import TileState from 'ol/TileState.js'
import {StepTileGrid} from '../src/map/reprojection/step-tile-grid.js'
import {StepTilePool} from '../src/map/reprojection/step-tile.js'
import {ZoomLevelSupervisor} from '../src/map/reprojection/zoom-level-supervisor.js'

globalThis.Image=class {}
const base=createXYZ({maxZoom:4}),grid=new StepTileGrid(base,4)
for(let z=0;z<16;z++){
 assert.equal(grid.getResolution(z),base.getResolution(Math.floor(z/4)))
 assert.deepEqual(grid.getTileCoordExtent([z,1,1]),base.getTileCoordExtent([Math.floor(z/4),1,1]))
 assert.equal(grid.getZForResolution(base.getResolution(0)*2**(-(z+.01)/4)),z)
}
// Repeated levels cover exactly the same coordinate range, including fallback.
assert.deepEqual(grid.getTileRangeForTileCoordAndZ([7,1,1],6),grid.getTileRangeForTileCoordAndZ([7,1,1],7))
const supervisor=new ZoomLevelSupervisor({preparer:{},steps:4})
assert.equal(supervisor.sourceZoomForBand('t','s',1,10.25,1,0,20),10)
assert.equal(supervisor.sourceZoomForBand('t','s',2,10.75,1,0,20),11)
let renders=0,releases=0
const native={}
function candidate(spans=[0,0,256,10]){
 const source={initialZoom:10,spans:Int32Array.from(spans),parents:new Map([['10/1/1',{tile:native}]])}
 const tile=new Tile([0,1,1],TileState.IDLE,{transition:0})
 tile.sourceTiles_=[{tile:source,offset:0}];tile.sourceZ_=10;tile.sourceTileGrid_={getResolution:()=>1}
 tile.getImage=()=>tile.canvas
 tile.load=()=>{renders++;tile.canvas={};tile.setState(TileState.LOADED)}
 tile.release=()=>{releases++;tile.canvas=null}
 return tile
}
const pool=new StepTilePool(),a=pool.wrap(candidate(),[0,1,1],'key','region'),b=pool.wrap(candidate(),[1,1,1],'key','region')
assert.equal(a.payload,b.payload)
a.load();assert.equal(b.getState(),TileState.LOADED);assert.equal(a.getImage(),b.getImage());assert.equal(renders,1)
const c=pool.wrap(candidate([0,0,128,10,128,0,128,11]),[2,1,1],'key','region')
assert.notEqual(a.payload,c.payload)
a.release();assert.ok(b.getImage());b.release();c.release();assert.equal(pool.entries.size,0)
assert.equal(releases,3)
console.log('Step grid geometry, quarter-step zoom choice, exact mask sharing, change forwarding and payload eviction passed')

// Exercise actual OL triangulation and canvas reprojection through the adapter.
const {createRequire}=await import('node:module')
const require=createRequire(new URL('./node-deps/package.json',import.meta.url))
const {createCanvas,Image}=require('@napi-rs/canvas')
globalThis.Image=Image
globalThis.document={createElement:()=>createCanvas(300,150)}
const {default:Projection}=await import('ol/proj/Projection.js')
const {addProjection,addCoordinateTransforms,get}=await import('ol/proj.js')
const {default:XYZ}=await import('ol/source/XYZ.js')
const {guardReprojection}=await import('../src/map/layers/reprojection-budget.js?v=contour-bands')
const {ContourReprojection}=await import('../src/map/reprojection/contour-reprojection.js')
const merc=get('EPSG:3857'),target=new Projection({code:'TEST:STEP',units:'m',extent:merc.getExtent()})
addProjection(target);addCoordinateTransforms(merc,target,p=>p.slice(),p=>p.slice())
const source=new XYZ({maxZoom:8,url:'test/{z}/{x}/{y}'})
source.getTileInternal=(z,x,y)=>{
 const tile=new Tile([z,x,y],TileState.IDLE)
 tile.canvas=createCanvas(256,256);const ctx=tile.canvas.getContext('2d');ctx.fillStyle=z%2?'red':'blue';ctx.fillRect(0,0,256,256)
 tile.getImage=()=>tile.canvas
 tile.load=()=>{if(tile.state===TileState.IDLE)tile.setState(TileState.LOADED)}
 return tile
}
guardReprojection(source)
const manager=new ContourReprojection({on(){},getView:()=>({getProjection:()=>merc})})
manager.zoomSupervisor.register(target.getCode(),merc.getCode(),'source').data={steps:4,minStep:-32,maxStep:32}
manager.sourcePlan=()=>({ready:true,complete:true,spans:Int32Array.from(Array.from({length:256},(_,y)=>[0,y,256,0]).flat())})
manager.addSource(source)
const t0=source.getTile(12,2,2,1,target),t1=source.getTile(13,2,2,1,target),t2=source.getTile(14,2,2,1,target)
assert.equal(t0.payload,t1.payload)
assert.notEqual(t0.payload,t2.payload)
await new Promise((resolve,reject)=>{
 const timeout=setTimeout(()=>reject(Error('OL reprojection timed out')),5000)
 t0.addEventListener('change',()=>{if(t0.getState()===TileState.LOADED){clearTimeout(timeout);resolve()}})
 t0.load()
})
assert.equal(t0.getImage(),t1.getImage())
assert.equal(t0.getImage().width,256)
assert.ok(t0.getImage().getContext('2d').getImageData(128,128,1,1).data[3]>0)
t0.release();assert.ok(t1.getImage());t1.release();t2.release()
console.log('Actual OL reprojection: identical quarter steps share a rendered canvas; next source-zoom step renders independently')
