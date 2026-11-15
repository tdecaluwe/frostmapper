import {ContourAtlas} from '../src/map/reprojection/contour-atlas.js'
import {BandSelector} from '../src/map/reprojection/band-selector.js'
import {BandMaskPlanner} from '../src/map/reprojection/band-mask.js'
const errors=[],check=(v,m)=>{if(!v)errors.push(m)}
const atlas=new ContourAtlas({version:1,extent:[0,0,1,1],paths:[{quarter:-1,curves:[[.1,.1,.2,.2,.3,.3,.4,.4]]},{quarter:1,curves:[[.7,.7,.8,.8,.9,.9,1,1]]}]})
check(atlas.query([0,0,.5,.5],1).length===1,'negative phase indexing')
check(atlas.query([0,0,.5,.5],3).length===0,'wrong phase returned')
check(atlas.query([.9,.9,1,1],3).length===1,'segment bounding box lookup')
check(atlas.query([2,2,3,3],1).length===0,'outside extent lookup')
{
 const atlas=new ContourAtlas({version:1,extent:[0,0,1,1],minQuarter:-8,maxQuarter:8,paths:[{quarter:4,curves:[[.5,0,.5,.33,.5,.66,.5,1]]}]})
 const spans=new BandMaskPlanner().plan(atlas,[0,0,1,1],0,20,10,.99)
 check(spans&&spans.length===20,'vertical contour should split every row')
 check(spans&&spans.filter(s=>s.band===0&&s.x===0&&s.width===10).length===10,'left side band')
 check(spans&&spans.filter(s=>s.band===1&&s.x===10&&s.width===10).length===10,'right side band')
}
{
 const atlas=new ContourAtlas({version:1,extent:[0,0,1,1],minQuarter:-8,maxQuarter:8,paths:[{quarter:4,curves:[[0,.5,.33,.5,.66,.5,1,.5]]}]})
 const spans=new BandMaskPlanner().plan(atlas,[0,0,1,1],0,20,10,.99)
 check(spans&&spans.length===10,'horizontal contour should preserve complete rows')
 check(spans&&new Set(spans.map(s=>s.band)).size===2,'horizontal contour should change bands')
}
{
 // A diagonal contour crosses the common edge of two target tiles. The
 // independently planned masks must agree at corresponding edge pixels.
 const atlas=new ContourAtlas({version:1,extent:[0,0,1,1],minQuarter:-8,maxQuarter:8,paths:[{quarter:4,curves:[[0,0,.33,.33,.66,.66,1,1]]}]})
 const planner=new BandMaskPlanner(),left=planner.plan(atlas,[0,0,.5,1],0,40,40,1.25),right=planner.plan(atlas,[.5,0,1,1],0,40,40,.75)
 for(let y=0;y<40;y++){
  const a=left?.find(s=>s.y===y&&s.x+s.width===40),b=right?.find(s=>s.y===y&&s.x===0)
  if(y!==20)check(a&&b&&a.band===b.band,`adjacent tile band mismatch at row ${y}`)
 }
}
{
 const selector=new BandSelector({hysteresis:.05}),samples=[{value:.1},{value:.2},{value:.3},{value:.4}]
 const phase=selector.choose(samples,5)
 check(phase>=0&&phase<4,'invalid selected phase')
 check(selector.choose(samples,5)===phase,'stable samples must retain the phase')
 check(selector.choose([],5)===phase,'missing samples must retain the phase')
}
{
 for(const file of ['epsg-3035','epsg-peirce','frost-triptychial']){
  const response=await fetch(`../data/contours/${file}.json`),data=await response.json(),atlas=new ContourAtlas(data)
  check(data.paths.length>0&&atlas.segments.length>0,`${file} missing contour data`)
  for(const phase of [0,1,2,3]){
   const indexed=atlas.query([0,0,1,1],phase).length
   const expected=atlas.segments.filter(s=>(((s.quarter+phase)%4)+4)%4===0).length
   check(indexed===expected,`${file} phase ${phase} index dropped segments`)
  }
 }
}
document.querySelector('#results').textContent=errors.length?errors.join('\n'):'Passed contour atlas and phase-selection checks'
if(errors.length)throw Error(errors.join('\n'))
