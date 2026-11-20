import assert from 'node:assert/strict'
import {getDistance} from 'ol/sphere.js'
import {kilometreSegments} from '../src/map/layers/track-segments.js'
const points=[[7,62,100],[7,62.012,200],[7,62.027,300]]
const segments=kilometreSegments(points)
assert.equal(segments.length,4)
assert.deepEqual(segments[0][0],points[0]);assert.deepEqual(segments.at(-1).at(-1),points.at(-1))
for(let i=0;i<segments.length;i++){
 const length=segments[i].slice(1).reduce((sum,p,j)=>sum+getDistance(segments[i][j],p,6378137),0)
 if(i<segments.length-1)assert.ok(Math.abs(length-1000)<.01);else assert.ok(length>0&&length<1000)
 if(i)assert.deepEqual(segments[i][0],segments[i-1].at(-1))
}
assert.deepEqual(kilometreSegments([[7,62],[7,62]]),[])
assert.throws(()=>kilometreSegments(points,0))
console.log('Kilometre intervals, shared boundaries, elevations, final remainder and zero-length tracks passed')

const offset=kilometreSegments(points,1000,1750)
const firstLength=offset[0].slice(1).reduce((sum,p,i)=>sum+getDistance(offset[0][i],p,6378137),0)
assert.ok(Math.abs(firstLength-250)<.01)
console.log('Continuous kilometre count across hut stops passed')
