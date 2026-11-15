import '../src/map/projections/index.js?v=grieger-wrap'
import {get} from 'ol/proj.js'
import {getForProjection} from 'ol/tilegrid.js'
import {DistortionField} from '../src/map/reprojection/distortion.js'
import {ContourAtlas} from '../src/map/reprojection/contour-atlas.js'
import {BandMaskPlanner} from '../src/map/reprojection/band-mask.js'
const p=get('FROST:TRIPTYCHIAL'),src=get('EPSG:3857'),field=new DistortionField(p,src),atlas=new ContourAtlas(await(await fetch('../data/contours/frost-triptychial.json')).json()),planner=new BandMaskPlanner(),grid=getForProjection(p),domain=p.getExtent(),result={},errors=[]
for(let z=2;z<=8;z++){
 const range=grid.getTileRangeForExtentAndZ(domain,z),counts={curves:0,sampled:0,unavailable:0}
 for(let x=range.minX;x<=range.maxX;x++)for(const y of [...new Set([range.minY,range.maxY])]){
  const extent=grid.getTileCoordExtent([z,x,y]),a=field.at([(extent[0]+extent[2])/2,(extent[1]+extent[3])/2])
  let spans=planner.plan(atlas,extent,256,256,a)
  if(spans&&!planner.validate(spans,extent,256,256,field))spans=null
  if(spans)counts.curves++
  else if(planner.sampledPlan(extent,256,256,field))counts.sampled++
  else counts.unavailable++
 }
 if(counts.unavailable)errors.push(`z${z}: ${counts.unavailable} tiles lacked a band plan`)
 result[z]=counts
}
// Check the exceptional sampled masks against independent points around the
// Grieger singularities; avoid ambiguous samples very near a band boundary.
let checked=0,wrong=0,maxError=0
for(const [z,x,y] of [[7,31,0],[7,32,0],[7,31,63],[7,33,63],[7,95,0],[8,63,0],[8,64,127]]){
 const e=grid.getTileCoordExtent([z,x,y]),spans=planner.sampledPlan(e,256,256,field)
 for(let py=7;py<256;py+=16)for(let px=7;px<256;px+=16){
  const q=field.at([e[0]+(e[2]-e[0])*(px+.5)/256,e[3]-(e[3]-e[1])*(py+.5)/256])
  if(q===null||Math.abs(q-Math.round(q))<.15)continue
  const span=spans?.find(s=>s.y===py&&s.x<=px&&s.x+s.width>px)
  if(!span)continue
  const error=Math.abs(span.band-Math.floor(q));checked++;if(error){wrong++;maxError=Math.max(maxError,error)}
 }
}
if(checked<1000||wrong/checked>.01||maxError>1)errors.push(`sampled edge masks: ${wrong}/${checked} incorrect; max error ${maxError}`)
result.sampledAccuracy={checked,wrong,maxError}
document.querySelector('#results').textContent=(errors.length?'Failed':'Passed')+' Grieger edge band checks\n'+JSON.stringify(result,null,2)
if(errors.length)throw Error(errors.join('\n'))
