import assert from 'node:assert/strict'
import {register,createRequire} from 'node:module'
import {resolve} from 'node:path'
register('./node-real-ol-loader.mjs',import.meta.url)
const require=createRequire(resolve('tests/node-deps/package.json'))
const {createCanvas}=require('@napi-rs/canvas')
globalThis.document={createElement:()=>createCanvas(300,150)}
const {default:Tile}=await import('ol/Tile.js')
const {default:TileState}=await import('ol/TileState.js')
const {createXYZ}=await import('ol/tilegrid.js')
const {AssembledZoomTile}=await import('../src/map/reprojection/source-assembler.js')
class ImageTile extends Tile {
 constructor(color){super([0,0,0],TileState.LOADED);this.image=createCanvas(256,256);if(color){const c=this.image.getContext('2d');c.fillStyle=color;c.fillRect(0,0,256,256)}}
 getImage(){return this.image}
}
const grid=createXYZ({maxZoom:4}),extent=grid.getTileCoordExtent([1,0,0])
const coarse=new ImageTile('purple'),detail=new ImageTile(),ctx=detail.image.getContext('2d')
// Include transparent terrain and partially transparent pixels, both of which
// must replace coarse classifications rather than blend with them.
ctx.fillStyle='rgba(0,255,0,0.5)';ctx.fillRect(0,0,128,256)
const parents=new Map([
 ['coarse',{zoom:1,coord:[1,0,0],tile:coarse}],
 ['fine',{zoom:2,coord:[2,0,0],tile:detail}]
])
const tile=new AssembledZoomTile([1,0,0],parents,[{x:0,y:0,width:128,height:128,zoom:2}],extent,grid,256,256,{interpolate:false})
tile.load()
const actual=tile.getImage().getContext('2d').getImageData(0,0,256,256).data
const expected=createCanvas(256,256),e=expected.getContext('2d')
e.fillStyle='purple';e.fillRect(0,0,256,256);e.clearRect(0,0,128,128)
e.imageSmoothingEnabled=false;e.drawImage(detail.image,0,0,128,128)
const wanted=e.getImageData(0,0,256,256).data
for(let i=0;i<actual.length;i++)assert.equal(actual[i],wanted[i],`assembled RGBA byte ${i} must match replacement, including transparent pixels`)
// Failed detail still retains the coarse image.
detail.state=TileState.ERROR
tile.render(tile.loadedParents())
assert.deepEqual([...tile.getImage().getContext('2d').getImageData(100,10,1,1).data],[128,0,128,255])
console.log('Transparent, translucent, adjacent-region and failed-detail assembly checks passed')
