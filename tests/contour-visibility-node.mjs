import assert from 'node:assert/strict'
import {ContourVisibility} from '../src/map/reprojection/contour-visibility.js'
import {CompactContourAtlas} from '../src/map/reprojection/compact-contours.js'
const visibility=new ContourVisibility({minPatchPixels:10,resolutionAtZoom:z=>2**-z})
assert.equal(visibility.pixels([[0,0],[10,0]],-20),10)
assert.equal(visibility.pixels([[0,0],[10/32,0]],-15),10)
assert.ok(!visibility.visible([[0,0],[9/32,0]],-15))
const reduced=new ContourVisibility({highestZoom:20,zoomOffset:4,resolutionAtZoom:z=>2**-z})
assert.equal(reduced.zoom(-10),6);assert.equal(reduced.zoom(3),16);assert.equal(reduced.zoom(-20),0)
const seam=new ContourVisibility({worldWidth:1,resolutionAtZoom:()=>.001})
assert.ok(Math.abs(seam.pixels([[.99,.5],[.01,.5]],0)-20)<1e-10)
const scaled=new ContourVisibility({project:([x,y])=>[100*x,y],resolutionAtZoom:()=>1})
assert.equal(scaled.pixels([[0,0],[.2,0]],-20),20)
assert.ok(new ContourVisibility({project:()=>{throw Error('domain')}}).visible([[0,0]],0))
assert.ok(new ContourVisibility({resolutionAtZoom:()=>{throw Error('domain')}}).visible([[0,0]],0))
const sample=([x,y])=>Math.max(Math.exp(-((x-.25)**2+(y-.5)**2)/.00001),Math.exp(-((x-.75)**2+(y-.5)**2)/.0025))-.5
const options={sample,steps:1,minScale:0,maxZoom:0,highestZoom:0,tolerance:.0025,passes:[{stage:'test',minimumDepth:4,maxDepth:9,boundaryDepth:4,fitTolerance:.01}]}
const all=new CompactContourAtlas({...options,minPatchPixels:0}),allResult=all.next()
assert.equal(allResult.atlas.paths.length,2)
const filtered=new CompactContourAtlas({...options,minPatchPixels:10}),result=filtered.next()
assert.equal(result.atlas.paths.length,1);assert.ok(result.atlas.paths[0].closed)
assert.equal(result.atlas.paths[0].orientation,'high-left');assert.ok(result.stats.visibilityLimitedCells>0)
assert.ok(result.stats.invisibleComponents>0)
assert.ok(result.atlas.paths[0].curves[0][0]>.5)
assert.equal(filtered.rootBrackets,null);assert.equal(filtered.rootRefined,null)
// The lowest scale is retained when its patch is large enough at zoom 0.
const broad=new CompactContourAtlas({sample:([x,y])=>(x-.5)**2+(y-.5)**2-20.1,minScale:-20,maxZoom:-20,steps:1,minPatchPixels:10,passes:[{stage:'test',minimumDepth:3,maxDepth:8,boundaryDepth:3,meshTolerance:.05,fitTolerance:.01}]})
assert.equal(broad.next().atlas.paths.length,1)
// The same small patch fails at level -20 / viewing zoom 0 but is visible
// at level -15 / viewing zoom 5; minScale does not shift the viewing rule.
for(const [level,expected] of [[-20,0],[-15,1]]){
 const e=new CompactContourAtlas({sample:([x,y])=>Math.exp(-((x-.5)**2+(y-.5)**2)/.00001)-.5+level,minScale:level,maxZoom:level,steps:1,minPatchPixels:10,passes:options.passes})
 const r=e.next();assert.equal(r.atlas.paths.length,expected)
 if(expected){assert.equal(r.atlas.paths[0].quality.visibilityZoom,5);assert.ok(r.atlas.paths[0].quality.patchPixels>=10)}
}
assert.equal(filtered.visibility.project,null)
// Later viewing zooms resume discovery and add the same patch without
// changing the scale/pixel limits or mutating the previous publication.
const staged=new CompactContourAtlas({sample:([x,y])=>Math.exp(-((x-.5)**2+(y-.5)**2)/.00001)-.5-15,minScale:-15,maxZoom:-15,steps:1,minPatchPixels:10,
 passes:[4,2,0].map(visibilityZoomOffset=>({...options.passes[0],visibilityZoomOffset,fitTolerance:.01}))})
const first=staged.next(),snapshot=JSON.stringify(first.atlas)
assert.equal(first.atlas.paths.length,0)
const middle=staged.next();assert.equal(middle.atlas.paths.length,1);assert.equal(middle.atlas.paths[0].quality.visibilityZoom,3)
const last=staged.next();assert.equal(last.atlas.paths.length,1);assert.equal(last.atlas.paths[0].quality.visibilityZoom,5)
assert.equal(JSON.stringify(first.atlas),snapshot)
const min=new CompactContourAtlas({sample:([x,y])=>x+y,minScale:1,maxZoom:2,minPatchPixels:0,passes:options.passes})
assert.equal(min.next().atlas.minStep,4)
assert.throws(()=>new CompactContourAtlas({sample,passes:[{stage:'invalid',minimumDepth:1,maxDepth:26,boundaryDepth:1}]}))
for(const invalid of [{minPatchPixels:-1},{minScale:NaN},{visibility:{worldWidth:-1}},{visibility:{discoverySafety:.5}}])assert.throws(()=>new CompactContourAtlas({sample,...invalid}))
console.log('Visibility scale/pixel limits, target metric, seams, conservative unknowns, early discovery pruning, whole-loop rejection and release passed')
