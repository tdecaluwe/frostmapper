import '../src/map/projections/index.js?v=triptychial'
import {get,transform} from 'ol/proj.js'
import {guardPolarReprojection} from '../src/map/layers/polar-guard.js'
const projection=get('FROST:TRIPTYCHIAL'),sourceProjection=get('EPSG:3857')
const pole=transform([0,90],'EPSG:4326',projection),swiss=transform([8,47],'EPSG:4326',projection)
const sourceGrid={getZForResolution(){return 12},getMinZoom(){return 0}}
const original=sourceGrid.getZForResolution
const targetGrid={getTileCoordExtent([,x]){const center=x===0?pole:swiss;return [center[0]-1000,center[1]-1000,center[0]+1000,center[1]+1000]}}
const source={getProjection(){return sourceProjection},getTileGridForProjection(p){return p===sourceProjection?sourceGrid:targetGrid},getTile(){return sourceGrid.getZForResolution(1)}}
guardPolarReprojection(source)
const errors=[]
if(source.getTile(12,0,0,1,projection)!==3)errors.push('pole tile was not capped')
if(source.getTile(12,1,0,1,projection)!==12)errors.push('non-polar tile was capped')
if(source.getTile(12,0,0,1,sourceProjection)!==12)errors.push('other projection was capped')
if(sourceGrid.getZForResolution!==original)errors.push('source grid was not restored')
document.querySelector('#results').textContent=errors.length?errors.join('\n'):'Passed polar source-zoom and grid restoration checks'
if(errors.length)throw Error(errors.join('\n'))
