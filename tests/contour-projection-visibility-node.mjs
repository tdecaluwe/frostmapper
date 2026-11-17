// Run with --experimental-loader ./tests/node-real-ol-loader.mjs.
import assert from 'node:assert/strict'
import '../src/map/projections/index.js'
import {get} from 'ol/proj.js'
import {DistortionField} from '../src/map/reprojection/distortion.js'
import {BoundedProjectionContourAtlas} from '../src/map/reprojection/bounded-contour-atlas-builder.js'
import {audit} from './contour-candidates-node.mjs'
import {griegerField as reference} from './grieger-field.mjs'
import {writeFile} from 'node:fs/promises'
const target=get('FROST:TRIPTYCHIAL'),source=get('EPSG:3857'),W=2*Math.PI*6378137
const strict=new DistortionField(target,source,{adaptive:true}),forward=new DistortionField(target,source,{adaptive:true,domainPolicy:'forward'}),p=[(.249995-.5)*W,(.500005-.5)*W]
assert.equal(strict.atSource(p),null)
assert.ok(Math.abs(forward.atSource(p)-reference([.249995,.500005]))<.002)
const engine=new BoundedProjectionContourAtlas(target,source,{minScale:-20,minPatchPixels:10,tolerance:.01}),runs=[]
while(true){
 const r=audit(engine.data,reference)
 assert.equal(engine.data.paths.length,212)
 assert.equal(r.invalid,0);assert.equal(r.topology.interiorEnds,0);assert.equal(r.topology.discontinuous,0)
 runs.push({stage:engine.stage,...engine.stats,paths:engine.data.paths.length,maxError:r.maxErrorSteps/4,invalid:r.invalid,topology:r.topology})
 if(engine.complete){assert.ok(r.maxErrorSteps/4<.01);assert.equal(engine.engine.rootBrackets,null);break}
 engine.refineBlock()
}
engine.dispose()
if(process.env.REPORT_FILE)await writeFile(process.env.REPORT_FILE,JSON.stringify(runs,null,2))
console.log(JSON.stringify(runs))
