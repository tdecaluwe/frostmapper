import {ContourVisibility} from './contour-visibility.js'
// Projection-agnostic, conforming quadtree / implicit-curve atlas candidate.
// Coordinates and periodicity belong to the caller; no projection regions.
const finite=Number.isFinite
function hashPair(a,b){
 let h=Math.imul(a|0,73856093)^Math.imul((a/4294967296)|0,83492791)^Math.imul(b|0,19349663)^Math.imul((b/4294967296)|0,2654435761)
 h=Math.imul(h^(h>>>16),0x45d9f3b);return (h^(h>>>16))>>>0
}
const DEFAULT_PASSES=[
 {stage:'coarse',minimumDepth:4,maxDepth:8,boundaryDepth:5,toleranceMultiplier:12},
 {stage:'medium',minimumDepth:6,maxDepth:14,boundaryDepth:8,toleranceMultiplier:4},
 {stage:'fine',minimumDepth:7,maxDepth:23,boundaryDepth:10,toleranceMultiplier:1}
]
export class ContourBudgetError extends Error {}
export class ContourTopologyError extends Error {}
export class ContourPassBudgetError extends ContourBudgetError {}

export class BoundedContourAtlas {
 constructor({sample,extent=[0,0,1,1],steps=4,minZoom=-20,maxZoom=20,periodicX=false,
  passes=DEFAULT_PASSES,maxNodes=87381,cacheSize=65536,maxVertices=16384,rootIterations=56,extrema=true,polish=true,maxPathVertices=Math.min(2048,maxVertices),highestZoom=20,tolerance=.025,maxSamplesPerPass=4000000,maxSamplesPerComponent=100000,maxOutputCurves=65536,maxExtremumSeeds=512,maxLevels=4096,minScale=null,minPatchPixels=10,visibility={}}={}){
  if(minScale!==null){if(!finite(minScale))throw Error('Invalid minimum scale');minZoom=minScale}
  if(!finite(highestZoom)||highestZoom<0)throw Error('Invalid highest supported zoom')
  minZoom=Math.max(minZoom,-highestZoom);maxZoom=Math.min(maxZoom,highestZoom)
  if(typeof sample!=='function'||extent.length!==4||!extent.every(finite)||!(extent[2]>extent[0]&&extent[3]>extent[1]))throw Error('Invalid field or extent')
  if(!finite(tolerance)||tolerance<=0||!Number.isInteger(steps)||steps<1||!finite(minZoom)||!finite(maxZoom)||minZoom>maxZoom)throw Error('Invalid logarithmic ladder')
  if(!Number.isInteger(maxNodes)||maxNodes<5||!Number.isInteger(maxVertices)||maxVertices<16||!Number.isInteger(cacheSize)||cacheSize<16||(cacheSize&(cacheSize-1)))throw Error('Invalid workspace capacity')
  if(!Number.isInteger(rootIterations)||rootIterations<0||rootIterations>64||!passes.length||passes.some(p=>!Number.isInteger(p.maxDepth)||p.maxDepth<1||p.maxDepth>25||!Number.isInteger(p.minimumDepth)||p.minimumDepth<0||p.minimumDepth>p.maxDepth||!Number.isInteger(p.boundaryDepth)||p.boundaryDepth<0||p.boundaryDepth>p.maxDepth||!((p.tolerance??(p.toleranceMultiplier??1))>0)||!finite(p.tolerance??(p.toleranceMultiplier??1))))throw Error('Invalid refinement schedule')
  for(const p of passes){
   if(p.visibilityZoomOffset!==undefined&&(!finite(p.visibilityZoomOffset)||p.visibilityZoomOffset<0))throw Error('Invalid visibility zoom offset')
   for(const key of ['fitTolerance','fitToleranceMultiplier','meshTolerance'])if(p[key]!==undefined&&(!finite(p[key])||p[key]<=0))throw Error('Invalid pass accuracy')
   for(const key of ['sampleBudget','componentSampleBudget','levelStride'])if(p[key]!==undefined&&(!Number.isSafeInteger(p[key])||p[key]<1))throw Error('Invalid pass work limit')
   if(p.rootIterations!==undefined&&(!Number.isInteger(p.rootIterations)||p.rootIterations<0||p.rootIterations>64))throw Error('Invalid pass root iterations')
   if(p.extrema!==undefined&&typeof p.extrema!=='boolean')throw Error('Invalid pass extrema option')
   if(p.onBudget!==undefined&&!['stop','continue'].includes(p.onBudget))throw Error('Invalid pass budget policy')
  }
  if(!Number.isInteger(maxPathVertices)||maxPathVertices<4||maxPathVertices>maxVertices)throw Error('Invalid path workspace capacity')
  for(const n of [maxSamplesPerPass,maxSamplesPerComponent,maxOutputCurves,maxExtremumSeeds,maxLevels])if(!Number.isSafeInteger(n)||n<1)throw Error('Invalid work limit')
  Object.assign(this,{maxSamplesPerPass,maxSamplesPerComponent,maxOutputCurves,maxExtremumSeeds})
  this.visibility=new ContourVisibility({extent,highestZoom,minPatchPixels,...visibility})
  this.visibilitySamples=0;this.passVisibilitySamples=0
  this.passSamples=0;this.componentStart=null
  this.maxPathVertices=maxPathVertices
  this.sample=sample;this.extent=extent.slice();this.steps=steps;this.tolerance=tolerance;this.minStep=Math.ceil(minZoom*steps);this.maxStep=Math.floor(maxZoom*steps);this.periodicX=!!periodicX
  if(this.maxStep-this.minStep+1>maxLevels)throw Error('Contour ladder exceeds level limit')
  this.passes=passes.map(p=>({...p}));this.pass=0;this.complete=false;this.disposed=false;this.data=null;this.rootIterations=rootIterations;this.extrema=!!extrema;this.curvePolish=!!polish
  this.depth=Math.max(...passes.map(p=>p.maxDepth))+1;this.N=2**this.depth;this.stride=this.N+1
  this.children=new Uint32Array(maxNodes);this.lo=new Float32Array(maxNodes);this.hi=new Float32Array(maxNodes);this.nodes=1
  this.keys=new Float64Array(cacheSize);this.keys.fill(-1);this.values=new Float64Array(cacheSize);this.mask=cacheSize-1
  // One level's graph, discarded before the next level. Output curves are
  // the atlas, rather than retained intermediate state.
  this.capacity=maxVertices;this.tableSize=2**Math.ceil(Math.log2(maxVertices*2))
  this.keyA=new Float64Array(this.tableSize);this.keyB=new Float64Array(this.tableSize);this.ids=new Uint32Array(this.tableSize)
  this.xs=new Float64Array(maxVertices);this.ys=new Float64Array(maxVertices)
  this.a=new Int32Array(maxVertices);this.b=new Int32Array(maxVertices)
  this.boundary=new Uint8Array(maxVertices);this.seen=new Uint8Array(maxVertices);this.order=new Uint32Array(maxVertices+1)
  this.workspaceBytes=['children','lo','hi','keys','values','keyA','keyB','ids','xs','ys','a','b','boundary','seen','order'].reduce((n,k)=>n+this[k].byteLength,0)
  this.rootBrackets=this.visibility.enabled?new Float64Array(maxVertices*6):null
  this.rootRefined=this.visibility.enabled?new Uint8Array(maxVertices):null
  this.workspaceBytes+=(this.rootBrackets?.byteLength||0)+(this.rootRefined?.byteLength||0)
  this.edgeSeeds=new Map();this.centerSeeds=new Map();this.seedCount=0
  this.stats={samples:0,cacheHits:0,nodes:1,workspaceBytes:this.workspaceBytes}
 }
 get currentPass(){return this.passes[this.pass]||{}}
 get fittingTolerance(){return this.currentPass.fitTolerance??this.tolerance*(this.currentPass.fitToleranceMultiplier??(this.pass===0?4:this.pass===1?2:1))}
 get passSampleLimit(){return this.currentPass.sampleBudget??this.maxSamplesPerPass}
 get componentSampleLimit(){return this.currentPass.componentSampleBudget??this.maxSamplesPerComponent}
 chargeVisibility(){
  if(this.passVisibilitySamples>=this.passSampleLimit)throw new ContourPassBudgetError('Pass visibility evaluation limit reached')
  this.passVisibilitySamples++;this.visibilitySamples++
 }
 visible(points,level,safety=1){return this.visibility.visible(points,level,()=>this.chargeVisibility(),safety)}
 evaluate(point){
  if(this.passSamples>=this.passSampleLimit)throw new ContourPassBudgetError('Pass sample limit reached')
  if(this.componentStart!==null&&this.passSamples-this.componentStart>=this.componentSampleLimit)throw new ContourBudgetError('Component sample limit reached')
  this.passSamples++;this.stats.samples++
  try{return this.sample(point)}catch(error){
   if(error instanceof ContourBudgetError)throw error
   this.stats.evaluationFailures=(this.stats.evaluationFailures||0)+1;return NaN
  }
 }
 value(x,y){
  if(this.periodicX)x=((x%this.N)+this.N)%this.N
  const key=y*this.stride+x,slot=hashPair(x,y)&this.mask
  if(this.keys[slot]===key){this.stats.cacheHits++;return this.values[slot]}
  const e=this.extent,v=this.evaluate([e[0]+x/this.N*(e[2]-e[0]),e[1]+y/this.N*(e[3]-e[1])])
  this.keys[slot]=key;this.values[slot]=finite(v)?v:NaN;return this.values[slot]
 }
 direct(x,y){
  if(this.periodicX)x-=Math.floor(x)
  const e=this.extent,v=this.evaluate([e[0]+x*(e[2]-e[0]),e[1]+y*(e[3]-e[1])]);return finite(v)?v:NaN
 }
 split(node){
  if(this.nodes+4>this.children.length)throw new ContourBudgetError('Quadtree budget exhausted; last published atlas remains usable')
  const first=this.nodes;this.children[node]=first;this.nodes+=4;return first
 }
 refineMesh(pass){
  const tolerance=pass.meshTolerance??(pass.tolerance??this.tolerance*(pass.toleranceMultiplier??1))/this.steps
  let depthLimited=0
  const visit=(node,x,y,size,depth)=>{
   const h=size/2,coords=[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x+h,y],[x+size,y+h],[x+h,y+size],[x,y+h],[x+h,y+h]]
   const v=coords.map(p=>this.value(...p)),valid=v.filter(finite),mixed=valid.length>0&&valid.length<9
   let error=0
   if(valid.length===9){
    const deviations=[v[4]-(v[0]+v[1])/2,v[5]-(v[1]+v[2])/2,v[6]-(v[2]+v[3])/2,v[7]-(v[3]+v[0])/2,v[8]-(v[0]+v[1]+v[2]+v[3])/4]
    error=Math.max(...deviations.map(Math.abs))
   }
   // Below the visibility threshold, stop discovering features contained
   // inside this cell. Existing crossing contours are still extracted/fitted.
   const visible=depth<pass.minimumDepth||!valid.length||!this.visibility.enabled||this.visible(coords.map(p=>[p[0]/this.N,p[1]/this.N]),Math.max(...valid)+tolerance,this.visibility.discoverySafety)
   if(!visible)this.stats.visibilityLimitedCells++
   const shouldSplit=depth<pass.minimumDepth||(visible&&((mixed&&(depth<pass.boundaryDepth||Math.max(...valid)-Math.min(...valid)>.25/this.steps))||error>tolerance))
   if(shouldSplit&&depth>=pass.maxDepth)depthLimited++
   if(shouldSplit&&depth<pass.maxDepth&&!this.children[node])this.split(node)
   const child=this.children[node]
   if(child){
    visit(child,x,y,h,depth+1);visit(child+1,x+h,y,h,depth+1);visit(child+2,x,y+h,h,depth+1);visit(child+3,x+h,y+h,h,depth+1)
    this.lo[node]=Math.min(...this.lo.subarray(child,child+4));this.hi[node]=Math.max(...this.hi.subarray(child,child+4))
   }else{
    this.lo[node]=mixed?-Infinity:valid.length?Math.min(...valid)-tolerance:Infinity
    this.hi[node]=mixed?Infinity:valid.length?Math.max(...valid)+tolerance:-Infinity
   }
  }
  visit(0,0,0,this.N,0)
  if(pass.extrema??this.extrema)this.findExtrema(pass)
  else{this.edgeSeeds.clear();this.centerSeeds.clear();this.seedCount=0;this.stats.extremumSeeds=0}
  // Neighbor subdivision can expose an edge extremum outside a coarse
  // leaf's stencil range. Bounds must include the conforming boundary.
  const bounds=(node,x,y,size)=>{
   const h=size/2,c=this.children[node]
   if(c){bounds(c,x,y,h);bounds(c+1,x+h,y,h);bounds(c+2,x,y+h,h);bounds(c+3,x+h,y+h,h);this.lo[node]=Math.min(...this.lo.subarray(c,c+4));this.hi[node]=Math.max(...this.hi.subarray(c,c+4));return}
   const values=[this.centerSeeds.get(node)?.[2]??this.value(x+h,y+h)]
   for(let side=0;side<4;side++)for(const p of this.edgePoints(x,y,size,side))values.push(p[2]??this.value(...p))
   const valid=values.filter(finite),mixed=valid.length&&valid.length<values.length
   this.lo[node]=mixed?-Infinity:valid.length?Math.min(...valid)-tolerance:Infinity
   this.hi[node]=mixed?Infinity:valid.length?Math.max(...valid)+tolerance:-Infinity
  }
  bounds(0,0,0,this.N)
  this.stats.nodes=this.nodes;this.stats.depthLimited=depthLimited
 }
 // Neighbor lookup requires no leaf maps or stored edge lists. Every leaf's
 // boundary is partitioned using both sides of the edge, including the seam.
 leaf(x,y){
  if(this.periodicX)x=((x%this.N)+this.N)%this.N
  if(x<0||x>=this.N||y<0||y>=this.N)return null
  let node=0,left=0,bottom=0,size=this.N
  while(this.children[node]){size/=2;const ix=x>=left+size?1:0,iy=y>=bottom+size?1:0;node=this.children[node]+ix+2*iy;left+=ix*size;bottom+=iy*size}
  return {node,x:left,y:bottom,size}
 }
 baseEdgePoints(x,y,size,side){
  const out=[],vertical=side===1||side===3,start=vertical?y:x,end=start+size
  let pos=start
  while(pos<end){
   let qx=vertical?(side===1?x+size+.25:x-.25):pos+.25
   let qy=vertical?pos+.25:(side===2?y+size+.25:y-.25)
   const other=this.leaf(qx,qy),next=other?Math.min(end,(vertical?other.y:other.x)+other.size):end
   const fixed=vertical?(side===1?x+size:x):(side===2?y+size:y)
   out.push(vertical?[fixed,pos]:[pos,fixed]);pos=next
  }
  const fixed=vertical?(side===1?x+size:x):(side===2?y+size:y)
  out.push(vertical?[fixed,end]:[end,fixed]);return side>=2?out.reverse():out
 }
 edgeSeedKey(p,q){let a=this.vertexKey(p),b=this.vertexKey(q);return a<b?`${a}:${b}`:`${b}:${a}`}
 edgePoints(x,y,size,side){
  const base=this.baseEdgePoints(x,y,size,side),out=[]
  for(let i=0;i<base.length-1;i++){
   const p=base[i],q=base[i+1];out.push(p)
   const seed=this.edgeSeeds.get(this.edgeSeedKey(p,q))
   if(seed){const v=seed.slice();if(this.periodicX)v[0]+=Math.round((p[0]-v[0])/this.N)*this.N;out.push(v)}
  }
  out.push(base.at(-1));return out
 }
 findExtrema(pass){
  // Optimize only flagged deep cells and stencil-bracketed interior extrema.
  // Edge extrema are shared by BOTH cells, preserving mesh conformity.
  this.edgeSeeds.clear();this.centerSeeds.clear();this.seedCount=0
  const create=point=>{
   if(this.seedCount>=this.maxExtremumSeeds){this.stats.omittedExtremumSeeds=(this.stats.omittedExtremumSeeds||0)+1;return null}
   return [...point,-(2**50)-this.seedCount++]
  }
  const golden=(p,q,sign)=>{
   const f=t=>this.direct((p[0]+t*(q[0]-p[0]))/this.N,(p[1]+t*(q[1]-p[1]))/this.N)
   let a=0,b=1,c=b-(b-a)*.6180339887498949,d=a+(b-a)*.6180339887498949,fc=f(c),fd=f(d)
   for(let i=0;i<52;i++){
    if((sign===1&&Math.min(fc,fd)<this.minStep/this.steps-.001/this.steps)||(sign===-1&&Math.max(fc,fd)>this.maxStep/this.steps+.001/this.steps)){this.stats.scaleStoppedSearches++;break}
    if(sign===1&&this.visibility.enabled&&i%4===0&&finite(fc)&&finite(fd)){
     const region=[]
     for(let j=0;j<=4;j++){const t=a+(b-a)*j/4;region.push([(p[0]+t*(q[0]-p[0]))/this.N,(p[1]+t*(q[1]-p[1]))/this.N])}
     if(!this.visible(region,Math.min(fc,fd),this.visibility.discoverySafety)){this.stats.visibilityStoppedSearches++;break}
    }
    if(sign*fc<sign*fd){b=d;d=c;fd=fc;c=b-(b-a)*.6180339887498949;fc=f(c)}
    else{a=c;c=d;fc=fd;d=a+(b-a)*.6180339887498949;fd=f(d)}
   }
   const t=sign*fc<sign*fd?c:d,value=sign*fc<sign*fd?fc:fd
   return [p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1]),value]
  }
  const visit=(node,x,y,size,depth)=>{
   if(this.seedCount>=this.maxExtremumSeeds){this.stats.omittedExtremumSeeds=(this.stats.omittedExtremumSeeds||0)+1;return}
   const h=size/2,c=this.children[node]
   if(c){visit(c,x,y,h,depth+1);visit(c+1,x+h,y,h,depth+1);visit(c+2,x,y+h,h,depth+1);visit(c+3,x+h,y+h,h,depth+1);return}
   if(this.visibility.enabled){
    const values=[this.value(x,y),this.value(x+size,y),this.value(x,y+size),this.value(x+size,y+size),this.value(x+h,y+h)].filter(finite)
    if(values.length&&!this.visible([[x/this.N,y/this.N],[(x+size)/this.N,y/this.N],[(x+size)/this.N,(y+size)/this.N],[x/this.N,(y+size)/this.N]],Math.max(...values)+.25/this.steps,this.visibility.discoverySafety)){this.stats.visibilitySkippedExtrema++;return}
   }
   if(depth>=pass.maxDepth-1){
    for(let side=0;side<4;side++){
     const edge=this.baseEdgePoints(x,y,size,side)
     for(let i=0;i<edge.length-1;i++){
      if(this.seedCount>=this.maxExtremumSeeds)return
      const p=edge[i],q=edge[i+1],key=this.edgeSeedKey(p,q)
      if(this.edgeSeeds.has(key))continue
      const pv=this.value(...p),qv=this.value(...q)
      if(!finite(pv)||!finite(qv))continue
      for(const sign of [1,-1]){
       const seed=golden(p,q,sign),bound=sign===1?Math.min(pv,qv):Math.max(pv,qv)
       if(finite(seed[2])&&sign*(bound-seed[2])>.002/this.steps){const created=create(seed);if(created)this.edgeSeeds.set(key,created);break}
      }
     }
    }
   }
   const v=this.value(x+h,y+h),corners=[this.value(x,y),this.value(x+size,y),this.value(x,y+size),this.value(x+size,y+size)]
   if(!finite(v)||!corners.every(finite))return
   const sign=v<Math.min(...corners)?1:v>Math.max(...corners)?-1:0
   if(!sign)return
   let best=[x+h,y+h,v],step=h/2
   for(let i=0;i<80&&step>size*1e-12;i++){
    if((sign===1&&best[2]<this.minStep/this.steps-.001/this.steps)||(sign===-1&&best[2]>this.maxStep/this.steps+.001/this.steps)){this.stats.scaleStoppedSearches++;break}
    if(sign===1&&this.visibility.enabled&&i%4===0){
     const r=step*2,region=[[-r,-r],[r,-r],[r,r],[-r,r]].map(([dx,dy])=>[(best[0]+dx)/this.N,(best[1]+dy)/this.N])
     if(!this.visible(region,best[2],this.visibility.discoverySafety)){this.stats.visibilityStoppedSearches++;break}
    }
    let improved=false
    for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]){
     const px=best[0]+dx*step,py=best[1]+dy*step
     if(px<=x||px>=x+size||py<=y||py>=y+size)continue
     const value=this.direct(px/this.N,py/this.N)
     if(finite(value)&&sign*(value-best[2])<0){best=[px,py,value];improved=true}
    }
    if(!improved)step/=2
   }
   if(sign*(v-best[2])>.002/this.steps){const created=create(best);if(created)this.centerSeeds.set(node,created)}
  }
  visit(0,0,0,this.N,0);this.stats.extremumSeeds=this.seedCount
 }
 vertexKey(p){if(p[3]!==undefined)return p[3];return p[1]*this.stride+(this.periodicX&&p[0]===this.N?0:p[0])}
 graphVertex(ka,kb,x,y,boundary=false){
  if(ka>kb)[ka,kb]=[kb,ka]
  let slot=hashPair(ka,kb)&(this.tableSize-1)
  while(this.ids[slot]){if(this.keyA[slot]===ka&&this.keyB[slot]===kb)return this.ids[slot]-1;slot=(slot+1)&(this.tableSize-1)}
  const id=this.vertices++
  if(id>=this.capacity)throw new ContourBudgetError('Single contour level exceeds graph budget; increase maxVertices or reduce the ladder range')
  this.keyA[slot]=ka;this.keyB[slot]=kb;this.ids[slot]=id+1
  this.xs[id]=this.periodicX?((x%1)+1)%1:x;this.ys[id]=y;this.boundary[id]=boundary?1:0;return id
 }
 connect(a,b){
  if(a===b)return
  for(const [i,j] of [[a,b],[b,a]]){
   if(this.a[i]<0)this.a[i]=j
   else if(this.b[i]<0)this.b[i]=j
   else throw new ContourTopologyError('Non-manifold contour graph')
  }
 }
 // Canonical edge root: identical brackets and evaluation order on both
 // sides. A guarded secant prevents Newton jumping to another component.
 root(p,q,level,boundary=false,customKeys=null){
  let ka=customKeys?.[0]??this.vertexKey(p),kb=customKeys?.[1]??this.vertexKey(q)
  if(ka>kb){[p,q]=[q,p];[ka,kb]=[kb,ka]}
  let ax=p[0]/this.N,ay=p[1]/this.N,bx=q[0]/this.N,by=q[1]/this.N,av=p[2],bv=q[2]
  if(!finite(av)||!finite(bv)||(av>=level)===(bv>=level))return -1
  // Root lookup first; expensive edge solves happen only once per level.
  let slot=hashPair(ka,kb)&(this.tableSize-1)
  while(this.ids[slot]){if(this.keyA[slot]===ka&&this.keyB[slot]===kb)return this.ids[slot]-1;slot=(slot+1)&(this.tableSize-1)}
  const t=(level-av)/(bv-av)
  let x=ax+t*(bx-ax),y=ay+t*(by-ay)
  if(!this.rootBrackets){[x,y]=this.solveRoot(ax,ay,bx,by,av,bv,level)}
  const id=this.graphVertex(ka,kb,x,y,boundary)
  if(this.rootBrackets){this.rootBrackets.set([ax,ay,bx,by,av,bv],id*6);this.rootRefined[id]=0}
  return id
 }
 solveRoot(ax,ay,bx,by,av,bv,level){
  let t=(level-av)/(bv-av),x=ax+t*(bx-ax),y=ay+t*(by-ay)
  for(let i=0;i<(this.currentPass.rootIterations??this.rootIterations);i++){
   const v=this.direct(x,y)
   if(!finite(v)||Math.abs(v-level)<.001/this.steps)break
   if((v>=level)===(av>=level)){ax=x;ay=y;av=v}else{bx=x;by=y;bv=v}
   t=i%2===0?.5:Math.max(.01,Math.min(.99,(level-av)/(bv-av)));x=ax+t*(bx-ax);y=ay+t*(by-ay)
  }
  return [x,y]
 }
 refineRoot(id,level){
  if(!this.rootBrackets||this.rootRefined[id])return
  const i=id*6,b=this.rootBrackets,[x,y]=this.solveRoot(b[i],b[i+1],b[i+2],b[i+3],b[i+4],b[i+5],level)
  this.xs[id]=this.periodicX?((x%1)+1)%1:x;this.ys[id]=y;this.rootRefined[id]=1
 }

 clip(valid,invalid){
  let a=valid.slice(),b=invalid.slice()
  for(let i=0;i<32;i++){
   const x=(a[0]+b[0])/2,y=(a[1]+b[1])/2,v=this.direct(x/this.N,y/this.N)
   if(finite(v))a=[x,y,v];else b=[x,y,NaN]
  }
  return a
 }
 triangle(points,level,serial){
  const crossings=[],boundaryPoints=[]
  for(let i=0;i<3;i++){
   let p=points[i],q=points[(i+1)%3]
   if(!finite(p[2])&&!finite(q[2]))continue
   if(finite(p[2])!==finite(q[2])){
    const pValid=finite(p[2]),cut=this.clip(pValid?p:q,pValid?q:p);boundaryPoints.push(cut)
    // The key stays that of the original mesh edge after boundary clipping.
    const keys=[this.vertexKey(p),this.vertexKey(q)]
    const id=this.root(pValid?p:cut,pValid?cut:q,level,false,keys)
    if(id>=0)crossings.push(id)
   }else{const id=this.root(p,q,level);if(id>=0)crossings.push(id)}
  }
  if(boundaryPoints.length===2){
   const id=this.root(boundaryPoints[0],boundaryPoints[1],level,true,[-serial-1,-serial-1])
   if(id>=0)crossings.push(id)
  }
  if(crossings.length===2)this.connect(...crossings)
  else if(crossings.length===4){this.connect(crossings[0],crossings[1]);this.connect(crossings[2],crossings[3])}
  else if(crossings.length!==0)throw new ContourTopologyError(`Unresolved boundary topology: ${crossings.length}`)
 }
 extract(step){
  const level=step/this.steps;this.vertices=0;this.ids.fill(0);this.a.fill(-1);this.b.fill(-1);this.seen.fill(0)
  let serial=0
  const visit=(node,x,y,size)=>{
   if(level<this.lo[node]||level>this.hi[node])return
   const h=size/2,child=this.children[node]
   if(child){visit(child,x,y,h);visit(child+1,x+h,y,h);visit(child+2,x,y+h,h);visit(child+3,x+h,y+h,h);return}
   const center=this.centerSeeds.get(node)??[x+h,y+h,this.value(x+h,y+h)]
   for(let side=0;side<4;side++){
    const edge=this.edgePoints(x,y,size,side)
    for(let j=0;j<edge.length-1;j++){
     const p=edge[j],q=edge[j+1];this.triangle([center,p.length>=3?p:[...p,this.value(...p)],q.length>=3?q:[...q,this.value(...q)]],level,serial++)
    }
   }
  }
  visit(0,0,0,this.N)
  const paths=[];let outputCurves=0
  const follow=first=>{
   let prev=-1,current=first,count=0,closed=false
   while(current>=0&&!this.seen[current]){
    this.seen[current]=1;this.order[count++]=current
    const next=this.a[current]===prev?this.b[current]:this.a[current];prev=current;current=next
   }
   if(current===first){closed=true;this.order[count++]=first}
   if(count<2)return
   if(count>this.maxPathVertices){this.stats.omittedComponents++;return}
   if(this.rootBrackets){
    const engine=this
    const envelope=(function*(){
     for(let i=0;i<count;i++){
      const b=engine.rootBrackets,k=engine.order[i]*6
      for(let j=0;j<=4;j++){const t=j/4;yield [b[k]+t*(b[k+2]-b[k]),b[k+1]+t*(b[k+3]-b[k+1])]}
     }
    })()
    if(!this.visible(envelope,level,this.visibility.discoverySafety)){this.stats.invisibleComponents++;return}
    for(let i=0;i<count;i++)this.refineRoot(this.order[i],level)
   }
   const points=[];let lastX=this.xs[this.order[0]]
   for(let i=0;i<count;i++){
    const id=this.order[i];let x=this.xs[id]
    if(this.periodicX)x+=Math.round(lastX-x)
    points.push([x,this.ys[id]]);lastX=x
   }
   const firstId=this.order[0],lastId=this.order[count-1]
   const onEdge=id=>this.boundary[id]||this.ys[id]===0||this.ys[id]===1||(!this.periodicX&&(this.xs[id]===0||this.xs[id]===1))
   if(!closed&&(!onEdge(firstId)||!onEdge(lastId))){this.stats.omittedComponents++;return}
   if(!this.visible(points,level,this.visibility.discoverySafety)){this.stats.invisibleComponents++;return}
   const curves=this.curvePolish?this.polish(points,closed,level):smoothPath(points,closed)
   if(!curves){this.stats.omittedComponents++;return}
   const display=(function*(){for(const c of curves)for(let j=0;j<=16;j++)yield bezier(c,j/16)})()
   const patchPixels=this.visibility.enabled?this.visibility.pixels(display,level,()=>this.chargeVisibility()):null
   if(this.visibility.enabled&&patchPixels<this.visibility.minPatchPixels){this.stats.invisibleComponents++;return}
   if(this.visibility.enabled&&!finite(patchPixels))this.stats.unknownVisibilityComponents++
   const target=this.fittingTolerance
   let measured=0
   for(const c of curves){
    if(!c.every(finite)){this.stats.omittedComponents++;return}
    for(let j=0;j<=16;j++){
     const v=this.direct(...bezier(c,j/16)),error=Math.abs(v-level)
     if(!finite(error)||error>target){this.stats.omittedComponents++;return}
     measured=Math.max(measured,error)
    }
   }
   this.stats.maxSampledError=Math.max(this.stats.maxSampledError||0,measured)
   // Orient the whole connected path coherently. Never reverse individual
   // cubic segments: that would break the path's continuity.
   let reverse=false,oriented=false,vote=0
   // Use multiple well-separated normal probes. A single probe near a
   // critical point can be dominated by coordinate rounding.
   for(let k=0;k<Math.min(curves.length,16);k++){
    const curve=curves[Math.floor(k*curves.length/Math.min(curves.length,16))]
    for(const t of [.23,.51,.79]){
     const u=1-t,dx=3*(u*u*(curve[2]-curve[0])+2*u*t*(curve[4]-curve[2])+t*t*(curve[6]-curve[4])),dy=3*(u*u*(curve[3]-curve[1])+2*u*t*(curve[5]-curve[3])+t*t*(curve[7]-curve[5])),length=Math.hypot(dx,dy)
     if(!length)continue
     const m=bezier(curve,t),eps=Math.max(Number.EPSILON*2,Math.min(length*.05,1e-6))
     const l=this.direct(m[0]-dy/length*eps,m[1]+dx/length*eps),r=this.direct(m[0]+dy/length*eps,m[1]-dx/length*eps)
     if(finite(l)&&finite(r)&&Math.abs(l-r)>1e-7){vote+=Math.sign(l-r);oriented=true}
    }
   }
   if(!oriented||vote===0){this.stats.omittedComponents++;return}
   reverse=vote<0
   if(reverse){curves.reverse();for(let i=0;i<curves.length;i++){const c=curves[i];curves[i]=[c[6],c[7],c[4],c[5],c[2],c[3],c[0],c[1]]}}
   if(outputCurves+curves.length>this.maxOutputCurves)throw new ContourBudgetError('Level output curve limit reached')
   outputCurves+=curves.length
   paths.push({step,closed,quality:{sampledMaxError:measured,visibilityZoom:this.visibility.zoom(level),patchPixels:finite(patchPixels)?patchPixels:null},orientation:oriented?'high-left':undefined,periodic:closed&&Math.abs(points.at(-1)[0]-points[0][0])>.5,orientations:curves.map(()=>oriented),curves})
  }
  const attempt=i=>{
   this.componentStart=this.passSamples
   try{follow(i)}catch(error){
    if(!(error instanceof ContourBudgetError))throw error
    if(error instanceof ContourPassBudgetError||error.message==='Level output curve limit reached')throw error
    this.stats.omittedComponents++
   }finally{this.componentStart=null}
  }
  for(let i=0;i<this.vertices;i++)if(this.b[i]<0&&!this.seen[i]&&this.a[i]>=0)attempt(i)
  for(let i=0;i<this.vertices;i++)if(!this.seen[i]&&this.a[i]>=0)attempt(i)
  this.stats.maxGraphVertices=Math.max(this.stats.maxGraphVertices||0,this.vertices)
  return paths
 }
 polish(points,closed,level){return polishContour(points,closed,level,{sample:(x,y)=>this.direct(x,y),steps:this.steps,maxVertices:this.maxPathVertices,tolerance:this.fittingTolerance})}
 next(){
  if(this.disposed)throw Error('Atlas disposed')
  if(this.complete)return null
  const pass=this.passes[this.pass],start=performance.now()
  this.visibility.zoomOffset=pass.visibilityZoomOffset??0
  this.stats.sampleBudget=this.passSampleLimit;this.stats.componentSampleBudget=this.componentSampleLimit
  this.passVisibilitySamples=0;this.stats.scaleStoppedSearches=0;this.stats.visibilityStoppedSearches=0;this.stats.visibilityLimitedCells=0;this.stats.visibilitySkippedExtrema=0;this.stats.invisibleComponents=0;this.stats.unknownVisibilityComponents=0
  this.passSamples=0;this.stats.omittedComponents=0;this.stats.omittedLevels=0;this.stats.maxSampledError=0
  const paths=[];let reason=null,meshReady=false,curveCount=0
  const previousLevels=new Map()
  for(const path of this.data?.paths||[]){if(!previousLevels.has(path.step))previousLevels.set(path.step,[]);previousLevels.get(path.step).push(path)}
  this.stats.reusedLevels=0
  try{
   this.refineMesh(pass);meshReady=true
   for(let step=Math.ceil(this.minStep/(pass.levelStride??1))*(pass.levelStride??1);step<=this.maxStep;step+=pass.levelStride??1){
    try{
     let levelPaths=this.extract(step)
     const previous=previousLevels.get(step),target=this.fittingTolerance
     // Keep a previously published complete level if discovery regresses and
     // its geometry still meets the NEW pass's sampled accuracy requirement.
     if(previous&&previous.length>levelPaths.length){
      let valid=true,worst=0
      outer:for(const p of previous)for(const c of p.curves)for(let j=0;j<=16;j++){
       const error=Math.abs(this.direct(...bezier(c,j/16))-step/this.steps)
       if(!finite(error)||error>target){valid=false;break outer}
       worst=Math.max(worst,error)
      }
      if(valid&&this.visibility.enabled)for(const p of previous){const samples=(function*(){for(const c of p.curves)for(let j=0;j<=16;j++)yield bezier(c,j/16)})();if(!this.visible(samples,step/this.steps)){valid=false;break}}
      if(valid){levelPaths=previous;this.stats.reusedLevels++;this.stats.maxSampledError=Math.max(this.stats.maxSampledError,worst)}
     }
     const count=levelPaths.reduce((n,p)=>n+p.curves.length,0)
     if(curveCount+count>this.maxOutputCurves){this.stats.omittedLevels++;continue}
     paths.push(...levelPaths);curveCount+=count
    }catch(error){
     if(!(error instanceof ContourBudgetError||error instanceof ContourTopologyError))throw error
     if(error instanceof ContourPassBudgetError)throw error
     this.stats.omittedLevels++
    }
   }
  }catch(error){if(!(error instanceof ContourBudgetError))throw error;reason=error.message}
  // A pass interrupted by a work limit never replaces a previous publication.
  const retained=!!reason&&!!this.data
  const quality={certified:false,minScale:this.minStep/this.steps,minPatchPixels:this.visibility.minPatchPixels,visibilityPruning:'sampled-envelope',visibilityHighestZoom:this.visibility.highestZoom,visibilityZoomOffset:this.visibility.zoomOffset,effectiveVisibilityHighestZoom:Math.max(0,this.visibility.highestZoom-this.visibility.zoomOffset),visibilityMetric:'target-axis-span',unknownVisibilityComponents:this.stats.unknownVisibilityComponents,discovery:'stencil-and-local-extremum-search',requestedTolerance:this.tolerance,
   sampledAcceptanceTolerance:this.fittingTolerance,levelStride:pass.levelStride??1,stage:pass.stage,
   sampledMaxError:this.stats.maxSampledError,reusedLevels:this.stats.reusedLevels,omittedComponents:this.stats.omittedComponents,omittedLevels:this.stats.omittedLevels,
   discoveryLimited:!!this.stats.omittedExtremumSeeds,termination:reason||'pass-complete'}
  const data=retained?this.data:{version:3,orientation:'high-left',extent:this.extent.slice(),steps:this.steps,minStep:this.minStep,maxStep:this.maxStep,periodicX:this.periodicX,quality,paths:meshReady?paths:[]}
  this.data=data;this.pass++;this.complete=(!!reason&&pass.onBudget!=='continue')||this.pass===this.passes.length
  this.stats.termination=reason||'pass-complete';this.stats.retainedPreviousAtlas=retained

  const stats={...this.stats,visibilitySamples:this.visibilitySamples,passVisibilitySamples:this.passVisibilitySamples,passSamples:this.passSamples,elapsedMs:performance.now()-start}
  if(this.complete)this.release()
  return {stage:pass.stage,atlas:data,done:this.complete,stats}
 }
 release(){
  for(const k of ['children','lo','hi','keys','values','keyA','keyB','ids','xs','ys','a','b','boundary','seen','order','rootBrackets','rootRefined'])this[k]=null
  this.edgeSeeds.clear();this.centerSeeds.clear();this.sample=null;this.visibility.project=null;this.visibility.resolutionAtZoom=null
 }
 dispose(){this.release();this.data=null;this.disposed=true}
}
export function bezier(c,t){const u=1-t;return [0,1].map(i=>u**3*c[i]+3*u*u*t*c[i+2]+3*u*t*t*c[i+4]+t**3*c[i+6])}

// Shared Hermite derivatives give C1 joins (also across periodic closures).
// Short handles limit overshoot; numerical error is independently measured.
export function smoothPath(points,closed){
 const last=points.length-1,delta=[points[last][0]-points[0][0],points[last][1]-points[0][1]]
 const tangent=i=>{
  const p=points[i],before=i?points[i-1]:closed?[points[last-1][0]-delta[0],points[last-1][1]-delta[1]]:p
  const after=i<last?points[i+1]:closed?[points[1][0]+delta[0],points[1][1]+delta[1]]:p
  const dx=after[0]-before[0],dy=after[1]-before[1],length=Math.hypot(dx,dy)
  const scale=length?Math.min(Math.hypot(p[0]-before[0],p[1]-before[1])||Infinity,Math.hypot(after[0]-p[0],after[1]-p[1])||Infinity)/length*.25:0
  return [dx*scale,dy*scale]
 }
 const curves=[];let t0=tangent(0)
 for(let i=0;i<last;i++){
  const a=points[i],b=points[i+1],t1=tangent(i+1)
  curves.push([a[0],a[1],a[0]+t0[0],a[1]+t0[1],b[0]-t1[0],b[1]-t1[1],b[0],b[1]]);t0=t1
 }
 return curves
}

export function polishContour(points,closed,level,{sample,steps=4,maxVertices=16384,tolerance=.025}={}){
  let curves
  for(let round=0;round<5;round++){
   curves=smoothPath(points,closed)
   const additions=[]
   for(let i=0;i<curves.length;i++){
    const c=curves[i];let worst=0,at=.5
    for(const t of [.2,.4,.6,.8]){const p=bezier(c,t),v=sample(...p),error=Math.abs(v-level);if(finite(v)&&error>worst){worst=error;at=t}}
    if(worst<=tolerance*.25/steps)continue
    const origin=bezier(c,at),length=Math.hypot(c[6]-c[0],c[7]-c[1]),h=Math.max(length*.02,Number.EPSILON*2)
    let p=origin.slice(),ok=false
    for(let j=0;j<16;j++){
     const v=sample(...p),e=v-level
     if(!finite(v))break
     if(Math.abs(e)<tolerance*.025/steps){ok=true;break}
     const gx=(sample(p[0]+h,p[1])-sample(p[0]-h,p[1]))/(2*h),gy=(sample(p[0],p[1]+h)-sample(p[0],p[1]-h))/(2*h),norm=gx*gx+gy*gy
     if(!(norm>0)||!finite(norm))break
     const factor=Math.min(1,length*.5/(Math.abs(e)/Math.sqrt(norm)))
     p=[p[0]-factor*e*gx/norm,p[1]-factor*e*gy/norm]
     if(Math.hypot(p[0]-origin[0],p[1]-origin[1])>length)break
    }
    if(ok)additions.push([i,p])
   }
   if(!additions.length)return curves
   if(points.length+additions.length>maxVertices)throw new ContourBudgetError('Curve correction budget exhausted')
   for(let j=additions.length-1;j>=0;j--){const [i,p]=additions[j];points.splice(i+1,0,p)}
  }
  return smoothPath(points,closed)
 }
