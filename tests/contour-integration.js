import '../src/map/projections/index.js?v=grieger-wrap'
import XYZ from 'ol/source/XYZ.js'
import TileState from 'ol/TileState.js'
import {get} from 'ol/proj.js'
import {guardReprojection} from '../src/map/layers/reprojection-budget.js?v=contour-bands'
import {ContourReprojection} from '../src/map/reprojection/contour-reprojection.js?v=progressive-reproj-v1'
import {AssembledZoomTile} from '../src/map/reprojection/source-assembler.js?v=progressive-reproj-v1'

const errors=[],projection=get('FROST:TRIPTYCHIAL'),sourceProjection=get('EPSG:3857')
let activeProjection=projection
const map={on(){},getView(){return {getProjection:()=>activeProjection,getResolution:()=>1,calculateExtent:()=>projection.getExtent()}},getSize(){return [0,0]}}
const source=new XYZ({projection:'EPSG:3857',tileUrlFunction:([z])=>`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="hsl(${z*24} 80% 50%)"/></svg>`)}`,maxZoom:14,crossOrigin:'anonymous'})
guardReprojection(source)
const manager=new ContourReprojection(map)
const sourceData=await(await fetch('./fixtures/contours/source-frost-triptychial.json')).json()
manager.sourceAtlases.set(projection.getCode(),sourceData)
manager.planWorker.register(`${projection.getCode()}:source`,sourceData)
manager.addSource(source)
const grid=source.getTileGridForProjection(projection),sourceGrid=source.getTileGridForProjection(sourceProjection),coord=[5,7,0],extent=grid.getTileCoordExtent(coord),size=grid.getTileSize(coord[0]),width=typeof size==='number'?size:size[0],height=typeof size==='number'?size:size[1],field=manager.field(projection,sourceProjection)
const incrementalExtent=sourceGrid.getTileCoordExtent([5,15,16]),incrementalKey='incremental-source-mask'
let sawPartial=false
const receive=manager.planWorker.receive.bind(manager.planWorker)
manager.planWorker.receive=message=>{const result=receive(message),state=manager.planWorker.peek(`${projection.getCode()}:source`,incrementalKey);if(state?.ready&&!state.complete&&state.spans?.length)sawPartial=true;return result}
manager.sourcePlan(source,projection.getCode(),incrementalKey,incrementalExtent,512,512,-36,field)
await manager.planWorker.whenIdle()
if(!sawPartial)errors.push('worker did not publish a usable partial mask')
if(!manager.planWorker.peek(`${projection.getCode()}:source`,incrementalKey)?.complete)errors.push('partial mask was not finalized')
let reprojection=source.getTile(...coord,1,projection)
await manager.planWorker.whenIdle()
reprojection.release()
reprojection=source.getTile(...coord,1,projection)
await manager.planWorker.whenIdle()
reprojection.release()
reprojection=source.getTile(...coord,1,projection)
const assembled=reprojection.sourceTiles_?.filter(({tile})=>tile instanceof AssembledZoomTile)||[]
if(!assembled.length)errors.push('ReprojTile did not receive assembled source tiles')
if([...manager.planWorker.cache.values()].some(spans=>spans===null))errors.push('the worker cached a failed plan')
if(reprojection.getState()===TileState.ERROR)errors.push('the planned reprojection failed')
reprojection.release()
manager.planWorker.worker?.terminate();map.setTarget?.(undefined)
document.querySelector('#results').textContent=errors.length?errors.join('\n'):'Passed worker contour and source assembler integration checks'
if(errors.length)throw Error(errors.join('\n'))
