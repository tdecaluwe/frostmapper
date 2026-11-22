import assert from 'node:assert/strict'
import '../src/map/projections/index.js?v=antarctica-v1'
import {get,transform} from 'ol/proj.js'
import {createAntarcticSource,ANTARCTIC_EXTENT} from '../src/map/layers/antarctica.js'
const p=get('EPSG:3031'),source=createAntarcticSource(),grid=source.getTileGrid()
assert.ok(Math.hypot(...transform([0,-90],'EPSG:4326',p))<1e-6)
assert.deepEqual(p.getExtent(),ANTARCTIC_EXTENT)
assert.equal(grid.getMaxZoom(),13)
assert.deepEqual(grid.getTileCoordForCoordAndZ([0,0],3),[3,4,4])
assert.ok(source.getTileUrlFunction()([3,4,4],1,p).endsWith('/tile/3/4/4'))
const norway=transform([7.7,62.2],'EPSG:4326',p),coord=grid.getTileCoordForCoordAndZ(norway,6)
assert.equal(source.getTileCoordForTileUrlFunction(coord,p),null)
console.log('Antarctic stereographic pole, native tile grid, cache limit and out-of-coverage rejection passed')
