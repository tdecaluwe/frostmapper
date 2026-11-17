// Live retained intermediate state, excluding atlas output and JS runtime.
// This is not a claim about transient garbage, process RSS, or renderer memory.
import assert from 'node:assert/strict'
import {CompactContourAtlas as BoundedContourAtlas} from '../src/map/reprojection/compact-contours.js'
import {griegerField} from './grieger-field.mjs'
if(!global.gc)throw Error('Run node --expose-gc tests/bounded-memory-node.mjs')
global.gc();const base=process.memoryUsage(),results=[]
const atlas=new BoundedContourAtlas({sample:griegerField,periodicX:true})
while(!atlas.complete){
 let r=atlas.next();const stage=r.stage;atlas.data=null;r=null
 await new Promise(resolve=>setImmediate(resolve));global.gc();global.gc();const m=process.memoryUsage()
 results.push({stage,arrayBufferBytes:m.arrayBuffers-base.arrayBuffers,heapBytes:m.heapUsed-base.heapUsed,liveIntermediateBytes:m.arrayBuffers-base.arrayBuffers+m.heapUsed-base.heapUsed})
}
console.log(JSON.stringify({measurement:'post-GC retained state, atlas output excluded',results},null,2))
assert.ok(results.slice(0,-1).every(r=>r.liveIntermediateBytes<4e6),'Retained benchmark intermediates exceed 4MB')
assert.ok(atlas.children===null&&atlas.keys===null&&atlas.sample===null,'Completed atlas retained buffers')
assert.ok(results.at(-1).arrayBufferBytes<100000,'Completed atlas retained numeric storage')
