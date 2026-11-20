import assert from 'node:assert/strict'
import {SLOPE_BANDS,slopeBand,slopeDegrees,groundSpacing,shadeSlope,terrariumElevation} from '../src/map/terrain/slope.js'
assert.equal(terrariumElevation(128,0,0),0)
assert.equal(terrariumElevation(128,1,128),1.5)
assert.deepEqual([14.99,15,19.99,20,39.99,40,44.99,45,90].map(slopeBand),[-1,0,0,1,4,5,5,6,6])
assert.equal(SLOPE_BANDS.length,7)
for(const band of SLOPE_BANDS){
 const max=Math.max(...band.color),min=Math.min(...band.color)
 assert.ok(Math.abs(max/255-.9)<.003)
 assert.ok(Math.abs((max-min)/max-.9)<.005)
}
assert.ok(Math.abs(slopeDegrees(0,2,0,0,1)-45)<1e-10)
const z=10,y=296,spacing=groundSpacing(z,y*256+128),grade=Math.tan(32*Math.PI/180)
const plane=(tx,ty)=>Float32Array.from({length:65536},(_,i)=>(tx*256+i%256)*spacing*grade)
const center=plane(559,296),west=plane(558,296),east=plane(560,296),north=plane(559,295),south=plane(559,297)
const image=shadeSlope(center,west,east,north,south,z,y)
for(const px of [0,1,128,254,255])assert.deepEqual(Array.from(image.slice((128*256+px)*4,(128*256+px)*4+4)),[...SLOPE_BANDS[3].color,255])
const flat=new Float32Array(65536)
assert.ok(shadeSlope(flat,flat,flat,flat,flat,z,y).every(v=>v===0))
console.log('Slope thresholds, HSV palette, Terrarium decoding, latitude correction, flat terrain and seam gradients passed')
