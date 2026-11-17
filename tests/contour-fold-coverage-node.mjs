import assert from 'node:assert/strict'
import {CompactContourAtlas} from '../src/map/reprojection/compact-contours.js'
import {griegerField as numerical} from './grieger-adaptive-field.mjs'
import {griegerField as reference} from './grieger-field.mjs'
import {bezier} from '../src/map/reprojection/bounded-contours.js'
const extent=[.24998,.49998,.25002,.50002]
for(const sample of [reference,numerical]){
 const engine=new CompactContourAtlas({sample,extent,steps:4,minZoom:-8,maxZoom:-7,tolerance:.0025,passes:[{stage:'fine',minimumDepth:3,maxDepth:8,boundaryDepth:4,tolerance:.05}]})
 const {atlas}=engine.next()
 for(let step=-32;step<=-28;step++){
  const paths=atlas.paths.filter(p=>p.step===step)
  assert.equal(paths.length,1,`missing loop ${step/4}`);assert.ok(paths[0].closed);assert.equal(paths[0].orientation,'high-left')
  for(const c of paths[0].curves)for(let t=0;t<=1;t+=1/8){const p=bezier(c,t),q=[extent[0]+p[0]*(extent[2]-extent[0]),extent[1]+p[1]*(extent[3]-extent[1])];assert.ok(Math.abs(reference(q)-step/4)<.01)}
 }
 engine.dispose()
}
console.log('Both adapters recover all five closed, oriented fold loops within sampled 0.01 log2 error')
