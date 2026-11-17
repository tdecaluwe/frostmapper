import assert from 'node:assert/strict'
import {CompactContourAtlas} from '../src/map/reprojection/compact-contours.js'
import {fitFieldContour} from '../src/map/reprojection/field-curve-fit.js'
import {ContourBudgetError} from '../src/map/reprojection/bounded-contours.js'
const pass={stage:'test',minimumDepth:3,maxDepth:7,boundaryDepth:5,tolerance:.1}
const options={sample:([x,y])=>x+y,steps:1,minZoom:0,maxZoom:2,passes:[pass,pass]}
const engine=new CompactContourAtlas(options),first=engine.next(),snapshot=JSON.stringify(first.atlas)
assert.ok(first.atlas.paths.length)
engine.maxSamplesPerPass=1
const stopped=engine.next()
assert.ok(stopped.done);assert.equal(stopped.atlas,first.atlas);assert.equal(JSON.stringify(first.atlas),snapshot)
assert.ok(stopped.stats.retainedPreviousAtlas);assert.equal(engine.sample,null);assert.equal(engine.children,null)
const invalid=new CompactContourAtlas({...options,sample:()=>{throw Error('Projection domain')},passes:[pass]})
const empty=invalid.next();assert.ok(empty.done);assert.deepEqual(empty.atlas.paths,[]);assert.ok(empty.stats.evaluationFailures)
const limited=new CompactContourAtlas({...options,passes:[pass],maxOutputCurves:1})
const output=limited.next();assert.ok(output.atlas.paths.reduce((n,p)=>n+p.curves.length,0)<=1)
assert.throws(()=>fitFieldContour([[0,0],[1,0]],false,0,{sample:()=>1,tolerance:.01,maxSegments:4}),ContourBudgetError)
for(const option of ['maxSamplesPerPass','maxSamplesPerComponent','maxOutputCurves','maxExtremumSeeds'])assert.throws(()=>new CompactContourAtlas({...options,[option]:0}))
assert.throws(()=>new CompactContourAtlas({...options,steps:10000}),/level limit/)
class RegressingDiscovery extends CompactContourAtlas {
 extract(step){return this.pass===1?[]:super.extract(step)}
}
const regressing=new RegressingDiscovery(options),original=regressing.next(),saved=JSON.stringify(original.atlas)
const recovered=regressing.next()
assert.equal(recovered.atlas.paths.length,original.atlas.paths.length)
assert.ok(recovered.stats.reusedLevels>0)
assert.equal(JSON.stringify(original.atlas),saved)
assert.ok(recovered.atlas.quality.sampledMaxError<=recovered.atlas.quality.sampledAcceptanceTolerance)
console.log('Durability, work limits, projection exceptions, output cap and failed-fit rejection passed')
