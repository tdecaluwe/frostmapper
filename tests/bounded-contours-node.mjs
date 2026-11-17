import assert from 'node:assert/strict'
import {ContourAtlasIndex} from '../src/map/reprojection/contour-atlas-index.js'
import {BoundedContourAtlas,bezier,ContourBudgetError} from '../src/map/reprojection/bounded-contours.js'
const tests=[]
function run(name,fn){fn();tests.push(name)}
const passes=[{stage:'test',minimumDepth:4,maxDepth:10,boundaryDepth:7,tolerance:.025}]
function build(sample,options={}){const a=new BoundedContourAtlas({sample,steps:4,minZoom:-1,maxZoom:1,passes,...options});return [a,a.next()]}
function continuity(data){
 for(const p of data.paths){
  for(let i=1;i<p.curves.length;i++){
   const a=p.curves[i-1],b=p.curves[i];assert.ok(Math.hypot(a[6]-b[0],a[7]-b[1])<1e-12)
   assert.ok(Math.hypot((a[6]-a[4])-(b[2]-b[0]),(a[7]-a[5])-(b[3]-b[1]))<1e-12)
  }
  if(p.closed){const a=p.curves.at(-1),b=p.curves[0];assert.ok(Math.abs(a[7]-b[1])<1e-12);assert.ok(Math.abs(a[6]-b[0]-Math.round(a[6]-b[0]))<1e-12);assert.ok(Math.hypot(a[6]-a[4]-b[2]+b[0],a[7]-a[5]-b[3]+b[1])<1e-12)}
 }
}
run('affine field, edge completeness, C1, cap and disposal',()=>{
 const [a,r]=build(([x,y])=>x+y);assert.ok(r.atlas.paths.length);continuity(r.atlas)
 for(const p of r.atlas.paths){assert.ok(p.step<=4);for(const c of p.curves)for(const t of [0,.25,.5,.75,1]){const q=bezier(c,t);assert.ok(Math.abs(q[0]+q[1]-p.step/4)<1e-10)}}
 assert.ok(a.complete&&a.children===null&&a.sample===null);assert.ok(a.workspaceBytes<4.2e6)
})
run('interior maxima and minima produce closed loops',()=>{
 for(const sign of [-1,1]){
  const [,r]=build(([x,y])=>sign*(.8-4*((x-.487)**2+(y-.513)**2)))
  assert.ok(r.atlas.paths.filter(p=>p.closed).length>=3);continuity(r.atlas)
 }
})
run('two off-grid smooth extrema retain their separate components',()=>{
 const [,r]=build(([x,y])=>Math.exp(-((x-.2317)**2+(y-.4173)**2)/.002)+Math.exp(-((x-.7641)**2+(y-.5813)**2)/.002),{minZoom:.25,maxZoom:.75})
 for(const step of [1,2,3])assert.equal(r.atlas.paths.filter(p=>p.step===step&&p.closed).length,2)
 continuity(r.atlas)
})
run('periodic winding contour crosses seam without open ends',()=>{
 const [,r]=build(([x,y])=>y+.1*Math.sin(2*Math.PI*x),{periodicX:true})
 assert.ok(r.atlas.paths.some(p=>p.periodic));assert.ok(r.atlas.paths.filter(p=>p.step>0&&p.step<4).every(p=>p.closed));continuity(r.atlas)
})
run('invalid domain is clipped, rather than left as interior dangling ends',()=>{
 const [,r]=build(([x,y])=>(x-.5)**2+(y-.5)**2<.2?x+y:NaN)
 assert.ok(r.atlas.paths.length);continuity(r.atlas)
 for(const p of r.atlas.paths)if(!p.closed)for(const q of [p.curves[0].slice(0,2),p.curves.at(-1).slice(6)])assert.ok(Math.abs((q[0]-.5)**2+(q[1]-.5)**2-.2)<.003)
})
run('progressive immutable publications and graceful budget termination',()=>{
 const a=new BoundedContourAtlas({sample:([x,y])=>x*x+y*y,minZoom:0,maxZoom:1,passes:[{...passes[0],minimumDepth:2,maxDepth:4,boundaryDepth:4},{...passes[0],minimumDepth:4}]})
 const first=a.next(),snapshot=JSON.stringify(first.atlas);assert.ok(!first.done);a.next();assert.equal(JSON.stringify(first.atlas),snapshot)
 const b=new BoundedContourAtlas({sample:([x,y])=>x+y,maxNodes:5,passes});const stopped=b.next();assert.ok(stopped.done);assert.match(stopped.stats.termination,/budget/);assert.deepEqual(stopped.atlas.paths,[]);b.dispose()
})
run('invalid configuration rejected',()=>{
 for(const options of [{tolerance:0},{tolerance:Infinity},{steps:0},{minZoom:2,maxZoom:1},{cacheSize:3},{extent:[0,0,0,1]}])assert.throws(()=>new BoundedContourAtlas({sample:()=>0,...options}))
})
run('highest zoom cap and periodic index copies',()=>{
 const [,r]=build(([x,y])=>y+.1*Math.sin(2*Math.PI*x),{periodicX:true,minZoom:-100,maxZoom:100,highestZoom:1})
 assert.equal(r.atlas.minStep,-4);assert.equal(r.atlas.maxStep,4)
 const index=new ContourAtlasIndex({version:3,periodicX:true,extent:[0,0,1,1],paths:[{step:0,curves:[[.95,.5,.98,.5,1.02,.5,1.05,.5]]}]})
 assert.equal(index.query([0,.4,.05,.6]).length,1);assert.equal(index.query([.95,.4,1,.6]).length,1)
 assert.equal(index.query([1.95,.4,2.05,.6]).length,1);assert.equal(index.query([-2.05,.4,-1.95,.6]).length,1)
})
console.log(JSON.stringify({passed:tests},null,2))
