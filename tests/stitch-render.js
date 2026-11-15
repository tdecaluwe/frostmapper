import '../src/map/projections/index.js?v=triptychial'
import XYZ from 'ol/source/XYZ.js'
import TileState from 'ol/TileState.js'
import {get,transform} from 'ol/proj.js'
import {guardReprojection,MAX_SOURCE_AREA_RATIO} from '../src/map/layers/reprojection-budget.js'

// Synthetic tiles exercise the actual Canvas stitching path without network.
const images=Array.from({length:8},(_,i)=>{
 const canvas=document.createElement('canvas');canvas.width=canvas.height=256
 const context=canvas.getContext('2d');context.fillStyle=`hsl(${i*45},70%,50%)`;context.fillRect(0,0,256,256)
 context.fillStyle='rgba(0,0,0,.35)'
 for(let j=0;j<256;j+=32){context.fillRect(j,0,2,256);context.fillRect(0,j,256,2)}
 return canvas.toDataURL()
})
function source(){return new XYZ({url:'https://example.test/{z}/{x}/{y}',maxZoom:17,tileLoadFunction(tile,url){const values=new URL(url).pathname.split('/').filter(Boolean).map(Number);const index=Math.abs(values.reduce((sum,value)=>sum+value,0))%images.length;tile.getImage().src=images[index]}})}
const plain=source(),guarded=source();guardReprojection(guarded)
const projection=get('FROST:TRIPTYCHIAL'),grid=guarded.getTileGridForProjection(projection),sourceGrid=guarded.getTileGridForProjection(guarded.getProjection())
const center=grid.getTileCoordForCoordAndZ(transform([-90,70],'EPSG:4326',projection),6)
let candidate,reference
for(let dx=-8;dx<=8&&!candidate;dx++)for(let dy=-8;dy<=8&&!candidate;dy++){
 const coord=[center[0],center[1]+dx,center[2]+dy]
 const actual=guarded.getTile(...coord,1,projection),original=plain.getTile(...coord,1,projection)
 if(actual.sourceTileGrid_&&actual.sourceZ_===original.sourceZ_&&actual.sourceTileGrid_.getResolution(actual.sourceZ_)>sourceGrid.getResolution(actual.sourceZ_)){candidate=actual;reference=original}
}
if(!candidate)throw Error('Could not find a scaled tile at the original zoom')
function load(tile){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Tile load timed out')),10000);tile.addEventListener('change',()=>{if(tile.getState()===TileState.LOADED){clearTimeout(timer);resolve()}else if(tile.getState()===TileState.ERROR){clearTimeout(timer);reject(Error('Tile failed to load'))}});tile.load()})}
// Record Canvas allocations during the scaled render. The unguarded reference
// can legitimately exceed the budget, so load it before installing the hook.
await load(reference)
let maxCanvasArea=0
const originalDescriptors={}
for(const name of ['width','height']){
 const descriptor=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,name)
 originalDescriptors[name]=descriptor
 Object.defineProperty(HTMLCanvasElement.prototype,name,{...descriptor,set(value){descriptor.set.call(this,value);maxCanvasArea=Math.max(maxCanvasArea,this.width*this.height)}})
}
try{await load(candidate)}finally{for(const name of ['width','height'])Object.defineProperty(HTMLCanvasElement.prototype,name,originalDescriptors[name])}
if(maxCanvasArea>256*256*MAX_SOURCE_AREA_RATIO)throw Error(`Stitch canvas exceeded budget: ${maxCanvasArea} pixels`)
const pixels=tile=>tile.getImage().getContext('2d').getImageData(0,0,256,256).data
const a=pixels(reference),b=pixels(candidate);let occupied=0,missing=0,difference=0
for(let i=0;i<a.length;i+=4)if(a[i+3]>20){occupied++;if(b[i+3]<20)missing++;for(let j=0;j<3;j++)difference+=Math.abs(a[i+j]-b[i+j])}
const mean=difference/(occupied*3)
if(!occupied||missing>occupied*.01||mean>20)throw Error(`Scaled rendering differs: ${missing} missing pixels, mean color difference ${mean}`)
document.querySelector('#results').textContent=`Passed scaled stitch render: ${missing} missing pixels, mean color difference ${mean.toFixed(2)}`
