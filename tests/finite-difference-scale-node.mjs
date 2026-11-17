import assert from 'node:assert/strict'
import {finiteDifferenceScale} from '../src/map/reprojection/finite-difference-scale.js'
import {griegerField as numerical} from './grieger-adaptive-field.mjs'
import {griegerField as reference} from './grieger-field.mjs'
import {project} from './grieger-projection-field.mjs'
const affine=finiteDifferenceScale([10,20],{sample:([x,y])=>[2*x,3*y],step:1})
assert.ok(Math.abs(affine-Math.log2(6)/2)<1e-10)
assert.ok(Math.abs(finiteDifferenceScale([0,0],{sample:([x,y])=>x<0?null:[2*x,3*y],step:1})-Math.log2(6)/2)<1e-10)
const wrap=x=>((x%100)+100)%100
assert.ok(Math.abs(finiteDifferenceScale([99.9,3],{sample:([x,y])=>[wrap(2*x),y],worldWidth:100,step:1})-.5)<1e-10)
for(const p of [[.249999,.500001],[.249995,.500005],[.7499161375759194,.4999161375905438],[.5000863075,.3597250204]])assert.ok(Math.abs(numerical(p)-reference(p))<.002,JSON.stringify(p))
let calls=0
assert.equal(finiteDifferenceScale([0,0],{sample:()=>{calls++;throw Error('domain')}}),null);assert.equal(calls,1)
assert.equal(finiteDifferenceScale([0,0],{sample:p=>p,step:0}),null)
// Refinement is bounded even at a cusp that never becomes smooth.
calls=0;finiteDifferenceScale([0,0],{sample:([x,y])=>{calls++;return [Math.abs(x),y]},maxRefinements:3});assert.ok(calls<=49)
console.log('Adaptive derivatives: affine, seam, fold regressions, exceptions and work cap passed')
