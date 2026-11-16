import {ContourAtlas} from '../src/map/reprojection/contour-atlas.js'
import {BandMaskPlanner} from '../src/map/reprojection/band-mask.js'
const errors=[],check=(v,m)=>{if(!v)errors.push(m)}
const atlas=new ContourAtlas({version:1,extent:[0,0,1,1],paths:[{quarter:-4,curves:[[.1,.1,.2,.2,.3,.3,.4,.4]]},{quarter:4,curves:[[.7,.7,.8,.8,.9,.9,1,1]]}]})
check(atlas.query([0,0,.5,.5]).length===1,'contour index lookup')
check(atlas.query([.9,.9,1,1]).length===1,'segment bounding box lookup')
check(atlas.query([2,2,3,3]).length===0,'outside extent lookup')
{
 const atlas=new ContourAtlas({version:1,extent:[0,0,1,1],minQuarter:-8,maxQuarter:8,paths:[{quarter:4,curves:[[.5,0,.5,.33,.5,.66,.5,1]]}]})
 const spans=new BandMaskPlanner().plan(atlas,[0,0,1,1],20,10,.99)
 check(spans&&spans.length===20,'vertical contour should split every row')
 check(spans&&spans.filter(s=>s.band===0&&s.x===0&&s.width===10).length===10,'left side band')
 check(spans&&spans.filter(s=>s.band===1&&s.x===10&&s.width===10).length===10,'right side band')
}
{
 const atlas=new ContourAtlas({version:1,extent:[0,0,1,1],minQuarter:-8,maxQuarter:8,paths:[{quarter:4,curves:[[0,.5,.33,.5,.66,.5,1,.5]]}]})
 const spans=new BandMaskPlanner().plan(atlas,[0,0,1,1],20,10,.99)
 check(spans&&spans.length===10,'horizontal contour should preserve complete rows')
 check(spans&&new Set(spans.map(s=>s.band)).size===2,'horizontal contour should change bands')
}
{
 // A diagonal contour crosses the common edge of two target tiles. The
 // independently planned masks must agree at corresponding edge pixels.
 const atlas=new ContourAtlas({version:1,extent:[0,0,1,1],minQuarter:-8,maxQuarter:8,paths:[{quarter:4,curves:[[0,0,.33,.33,.66,.66,1,1]]}]})
 const planner=new BandMaskPlanner(),left=planner.plan(atlas,[0,0,.5,1],40,40,1.25),right=planner.plan(atlas,[.5,0,1,1],40,40,.75)
 for(let y=0;y<40;y++){
  const a=left?.find(s=>s.y===y&&s.x+s.width===40),b=right?.find(s=>s.y===y&&s.x===0)
  if(y!==20)check(a&&b&&a.band===b.band,`adjacent tile band mismatch at row ${y}`)
 }
}
{
 for(const file of ['epsg-3035','epsg-peirce','frost-triptychial']){
  const response=await fetch(`../data/contours/${file}.json`),data=await response.json(),atlas=new ContourAtlas(data)
  check(data.paths.length>0&&atlas.segments.length>0,`${file} missing contour data`)
  check(atlas.query([0,0,1,1]).length===atlas.segments.length,`${file} index dropped segments`)
  check(data.paths.every(path=>path.quarter%4===0),`${file} contains a fractional contour`)
 }
}
document.querySelector('#results').textContent=errors.length?errors.join('\n'):'Passed fixed contour atlas and band mask checks'
if(errors.length)throw Error(errors.join('\n'))
