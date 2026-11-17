import assert from 'node:assert/strict'
import {CompactContourAtlas,createCompactContourPasses} from '../src/map/reprojection/compact-contours.js'
const base={minimumDepth:2,maxDepth:5,boundaryDepth:3,meshTolerance:.1}
const passes=[16,8,4,2,1].map((fitToleranceMultiplier,i)=>({...base,stage:`pass-${i}`,fitToleranceMultiplier}))
const e=new CompactContourAtlas({sample:([x,y])=>x+y,steps:4,minZoom:0,maxZoom:2,tolerance:.01,passes})
let tree=null,snapshot=null,first=null
for(let i=0;i<passes.length;i++){
 const r=e.next();assert.equal(r.atlas.quality.sampledAcceptanceTolerance,.01*passes[i].fitToleranceMultiplier)
 assert.ok(r.atlas.paths.length);assert.ok(r.stats.passSamples<=r.stats.sampleBudget)
 if(i===0){tree=e.children;first=r.atlas;snapshot=JSON.stringify(first)}
 else{assert.equal(JSON.stringify(first),snapshot);if(!r.done)assert.equal(e.children,tree)}
 assert.equal(r.done,i===passes.length-1)
}
assert.equal(e.sample,null)
const recovery=new CompactContourAtlas({sample:([x,y])=>x+y,minZoom:0,maxZoom:1,passes:[{...base,stage:'limited',sampleBudget:1,onBudget:'continue'},{...base,stage:'finish',fitTolerance:.003}]})
const limited=recovery.next();assert.ok(!limited.done);assert.match(limited.stats.termination,/sample limit/);assert.equal(limited.stats.passSamples,1);assert.ok(recovery.children)
const finished=recovery.next();assert.ok(finished.done&&finished.atlas.paths.length);assert.equal(finished.atlas.quality.sampledAcceptanceTolerance,.003)
const sparse=new CompactContourAtlas({sample:([x,y])=>x+y,minZoom:0,maxZoom:2,steps:4,passes:[{...base,stage:'sparse',levelStride:4,fitTolerance:.01},{...base,stage:'dense',levelStride:1,fitTolerance:.01}]})
const preview=sparse.next();assert.ok(preview.atlas.paths.length);assert.ok(preview.atlas.paths.every(p=>p.step%4===0));assert.equal(preview.atlas.quality.levelStride,4)
const dense=sparse.next();assert.ok(dense.atlas.paths.some(p=>p.step%4!==0));assert.equal(dense.atlas.quality.levelStride,1)
assert.equal(createCompactContourPasses({preset:'responsive'})[0].levelStride,1)
assert.equal(createCompactContourPasses({preset:'fast',steps:4})[0].levelStride,4)
assert.equal(createCompactContourPasses({preset:'balanced'}).length,3)
assert.equal(createCompactContourPasses({preset:'balanced'})[0].rootIterations,28)
assert.equal(createCompactContourPasses({preset:'balanced'})[1].rootIterations,undefined)
assert.deepEqual(createCompactContourPasses({preset:'progressive'}).map(p=>p.visibilityZoomOffset??0),[4,2,0])
assert.equal(createCompactContourPasses({coarse:{fitTolerance:.08}})[0].fitTolerance,.08)
assert.equal(createCompactContourPasses({coarse:{fitTolerance:.08}})[2].fitToleranceMultiplier,1)
for(const invalid of [{fitTolerance:0},{meshTolerance:Infinity},{sampleBudget:0},{componentSampleBudget:-1},{rootIterations:65},{extrema:'no'},{levelStride:0},{onBudget:'retry'},{visibilityZoomOffset:-1},{visibilityZoomOffset:Infinity}])assert.throws(()=>new CompactContourAtlas({sample:()=>0,passes:[{...base,...invalid}]}))
console.log('Five-stage accuracy, state reuse, per-pass budgets/recovery, ladder density and configuration validation passed')
