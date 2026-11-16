import '../src/map/projections/index.js?v=grieger-wrap'
import XYZ from 'ol/source/XYZ.js'
import TileState from 'ol/TileState.js'
import {get} from 'ol/proj.js'
import {guardReprojection} from '../src/map/layers/reprojection-budget.js?v=contour-bands'
import {ContourReprojection} from '../src/map/reprojection/contour-reprojection.js?v=worker-plans-r3'
import {AssembledZoomTile} from '../src/map/reprojection/source-assembler.js?v=worker-plans-r3'

const errors=[],projection=get('FROST:TRIPTYCHIAL'),sourceProjection=get('EPSG:3857')
let activeProjection=projection
const map={on(){},getView(){return {getProjection:()=>activeProjection,getResolution:()=>1,calculateExtent:()=>projection.getExtent()}},getSize(){return [0,0]}}
const source=new XYZ({projection:'EPSG:3857',tileUrlFunction:([z])=>`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="hsl(${z*24} 80% 50%)"/></svg>`)}`,maxZoom:14,crossOrigin:'anonymous'})
guardReprojection(source)
const manager=new ContourReprojection(map);manager.addSource(source)
const targetData=await(await fetch('../data/contours/frost-triptychial.json')).json(),sourceData=await(await fetch('../data/contours/source-frost-triptychial.json')).json()
manager.atlases.set(projection.getCode(),new (await import('../src/map/reprojection/contour-atlas.js')).ContourAtlas(targetData))
manager.sourceAtlases.set(projection.getCode(),new (await import('../src/map/reprojection/contour-atlas.js')).ContourAtlas(sourceData))
manager.planWorker.register(`${projection.getCode()}:target`,targetData);manager.planWorker.register(`${projection.getCode()}:source`,sourceData)
const grid=source.getTileGridForProjection(projection),sourceGrid=source.getTileGridForProjection(sourceProjection),coord=[5,7,0],extent=grid.getTileCoordExtent(coord),size=grid.getTileSize(coord[0]),width=typeof size==='number'?size:size[0],height=typeof size==='number'?size:size[1],field=manager.field(projection,sourceProjection)
const incrementalWidth=512,incrementalHeight=512,incrementalKey=`${coord[0]}/${coord[1]}/${coord[2]}/${incrementalWidth}/${incrementalHeight}/q${4*(Math.round(Math.log2(sourceGrid.getResolution(0)/grid.getResolution(coord[0])))-sourceGrid.getMaxZoom())}`
let sawPartial=false
const receive=manager.planWorker.receive.bind(manager.planWorker)
manager.planWorker.receive=message=>{const result=receive(message),state=manager.planWorker.peek(`${projection.getCode()}:target`,incrementalKey);if(state?.ready&&!state.complete&&state.spans?.length)sawPartial=true;return result}
manager.targetPlan(source,projection.getCode(),coord[0],coord,extent,incrementalWidth,incrementalHeight,field)
await manager.planWorker.whenIdle()
if(!sawPartial)errors.push('worker did not publish a usable partial mask')
if(!manager.planWorker.peek(`${projection.getCode()}:target`,incrementalKey)?.complete)errors.push('partial mask was not finalized')
manager.targetPlan(source,projection.getCode(),coord[0],coord,extent,width,height,field)
await manager.planWorker.whenIdle()
const reference=Math.round(Math.log2(sourceGrid.getResolution(0)/grid.getResolution(coord[0]))),minimumQuarter=4*(reference-sourceGrid.getMaxZoom()),targetKey=`${coord[0]}/${coord[1]}/${coord[2]}/${width}/${height}/q${minimumQuarter}`,targetPlan=manager.planWorker.peek(`${projection.getCode()}:target`,targetKey)
if(!targetPlan?.ready||!targetPlan.spans)errors.push('target contour plan did not complete')
let reprojection=source.getTile(...coord,1,projection)
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
