import {fitContour} from './curve-fit.js'

export function createAdaptiveContourWorkspace(maxDepthX=9,maxDepthY=9){
 const nx=2**(maxDepthX+1),ny=2**(maxDepthY+1)
 // The finest lattice would be enormous at deep passes. Allocate small
 // sample blocks only where the adaptive tree actually visits.
 return {maxDepthX,maxDepthY,nx,ny,blockSize:8,blocks:new Map()}
}

// Build contours from an anisotropic quadtree. Cells split independently in
// X and Y; edge samples are shared so neighboring leaves stitch exactly.
export function buildAdaptiveContourPaths({sample,extent,atlasExtent,levels,maxDepthX=8,maxDepthY=8,minimumDepth=7,validityTolerance=1/512,contourValidityTolerance=1/262144,curvatureTolerance=.08,workspace=null,reuseSamples=false}={}){
 if(typeof sample!=='function'||extent?.length!==4||atlasExtent?.length!==4||!levels?.length)throw Error('Invalid adaptive contour request')
 const [left,bottom,right,top]=extent,[ax0,ay0,ax1,ay1]=atlasExtent
 const spanX=right-left,spanY=top-bottom
 if(!(spanX>0&&spanY>0&&ax1>ax0&&ay1>ay0))throw Error('Invalid adaptive contour extent')
 const nx=2**(maxDepthX+1),ny=2**(maxDepthY+1)
 workspace??=createAdaptiveContourWorkspace(maxDepthX,maxDepthY)
 if(workspace.maxDepthX<maxDepthX||workspace.maxDepthY<maxDepthY)throw Error('Adaptive contour workspace is too small')
 const scaleX=workspace.nx/nx,scaleY=workspace.ny/ny,{blockSize,blocks}=workspace
 if(!Number.isInteger(scaleX)||!Number.isInteger(scaleY))throw Error('Adaptive contour workspace depth mismatch')
 if(!reuseSamples)blocks.clear()
 const makeSegmentStore=()=>({ids:new Map(),points:[],adjacency:[],pairs:[]})
 const sortedLevels=levels.slice().sort((a,b)=>a.value-b.value),integerLevels=sortedLevels.filter(({value})=>Number.isInteger(value)).map(({value})=>value),segments=new Map(levels.map(({value})=>[value,makeSegmentStore()])),leaves=[]
 const pointKey=(x,y)=>`${x},${y}`
 const blocksWide=Math.ceil((workspace.nx+1)/blockSize)
 const slot=(x,y,create=false)=>{
  const ix=x*scaleX,iy=y*scaleY,bx=Math.floor(ix/blockSize),by=Math.floor(iy/blockSize),key=by*blocksWide+bx
  let block=blocks.get(key)
  if(!block&&create){block=new Float32Array(blockSize*blockSize);block.fill(Infinity);blocks.set(key,block)}
  return block?{block,index:(iy%blockSize)*blockSize+(ix%blockSize)}:null
 }
 const cached=(x,y)=>{const at=slot(x,y);return at?at.block[at.index]:Infinity}
 const store=(x,y,value)=>{const at=slot(x,y,true);at.block[at.index]=value}
 const read=(x,y)=>{
  const cachedValue=cached(x,y)
  if(cachedValue!==Infinity)return cachedValue
  const value=sample([left+x/nx*spanX,bottom+y/ny*spanY])
  store(x,y,Number.isFinite(value)?value:NaN)
  return cached(x,y)
 }
 const crosses=(a,b,level)=>(a>=level)!==(b>=level)
 const nearLevel=value=>{
  let lo=0,hi=integerLevels.length
  while(lo<hi){const mid=(lo+hi)>>1;if(integerLevels[mid]<value)lo=mid+1;else hi=mid}
  return Math.min(Math.abs(value-(integerLevels[lo]??Infinity)),Math.abs(value-(integerLevels[lo-1]??-Infinity)))<=.5
 }
 const levelRange=(min,max)=>{
  let lo=0,hi=sortedLevels.length
  while(lo<hi){const mid=(lo+hi)>>1;if(sortedLevels[mid].value<min)lo=mid+1;else hi=mid}
  let end=lo;while(end<sortedLevels.length&&sortedLevels[end].value<=max)end++
  return [lo,end]
 }
 const addSegment=(level,a,b)=>{
  if(a.key===b.key)return
  const store=segments.get(level)
  const vertexId=crossing=>{
   let id=store.ids.get(crossing.key)
   if(id===undefined){id=store.points.length;store.ids.set(crossing.key,id);store.points.push(crossing.point);store.adjacency.push([])}
   return id
  }
  const aId=vertexId(a),bId=vertexId(b),id=store.pairs.length/2
  store.pairs.push(aId,bId);store.adjacency[aId].push(id);store.adjacency[bId].push(id)
 }

 const splitAxes=(values9,width,height)=>{
  const [a,b,c,d,bm,rm,tm,lm,cm]=values9
  const rows=[[d,tm,c],[lm,cm,rm],[a,bm,b]]
  const finite=rows.flat().map(Number.isFinite)
  let splitX=false,splitY=false
  if(finite.some(value=>value!==finite[0])){
   for(const row of rows)for(let x=0;x<2;x++)if(Number.isFinite(row[x])!==Number.isFinite(row[x+1]))splitX=true
   for(let x=0;x<3;x++)for(let y=0;y<2;y++)if(Number.isFinite(rows[y][x])!==Number.isFinite(rows[y+1][x]))splitY=true
   const finiteValues=values9.filter(Number.isFinite)
   const nearContour=finiteValues.some(nearLevel)
   const variation=finiteValues.length>1?Math.max(...finiteValues)-Math.min(...finiteValues):0
   const tolerance=nearContour&&variation>.05?contourValidityTolerance:validityTolerance
   if(Math.max(width/nx,height/ny)<=tolerance)return [false,false]
   if(!splitX&&!splitY)splitX=splitY=true
   return [splitX,splitY]
  }
  const errorsX=[Math.abs(bm-(a+b)/2),Math.abs(tm-(d+c)/2),Math.abs(cm-(lm+rm)/2)]
  const errorsY=[Math.abs(lm-(a+d)/2),Math.abs(rm-(b+c)/2),Math.abs(cm-(bm+tm)/2)]
  if(Math.max(...errorsX)>curvatureTolerance)splitX=true
  if(Math.max(...errorsY)>curvatureTolerance)splitY=true
  const values=rows.flat()
  const min=Math.min(...values),max=Math.max(...values)
  const [levelStart,levelEnd]=levelRange(min,max)
  for(let levelIndex=levelStart;levelIndex<levelEnd;levelIndex++){
   const level=sortedLevels[levelIndex].value
   const coarse=[a,b,c,d]
   const coarseCross=crosses(a,b,level)||crosses(b,c,level)||crosses(c,d,level)||crosses(d,a,level)
   let fineCrossX=false,fineCrossY=false
   for(const row of rows)for(let x=0;x<2;x++)fineCrossX||=crosses(row[x],row[x+1],level)
   for(let x=0;x<3;x++)for(let y=0;y<2;y++)fineCrossY||=crosses(rows[y][x],rows[y+1][x],level)
   // Discover contour loops or branches visible only at the midpoint stencil.
   if(!coarseCross&&(fineCrossX||fineCrossY)){splitX||=fineCrossX;splitY||=fineCrossY}
  }
  return [splitX,splitY]
 }

 const visit=(x,y,width,height,depthX,depthY)=>{
  const mx=x+width/2,my=y+height/2
  const stencil=[read(x,y),read(x+width,y),read(x+width,y+height),read(x,y+height),read(mx,y),read(x+width,my),read(mx,y+height),read(x,my),read(mx,my)]
  let [splitX,splitY]=splitAxes(stencil,width,height)
  // Seed the whole extent before trusting local adaptivity. This discovers
  // valid islands that are missed when every corner and midpoint is invalid.
  if(depthX<minimumDepth)splitX=true
  if(depthY<minimumDepth)splitY=true
  splitX=splitX&&depthX<maxDepthX;splitY=splitY&&depthY<maxDepthY
  if(splitX&&splitY){
   visit(x,y,width/2,height/2,depthX+1,depthY+1)
   visit(mx,y,width/2,height/2,depthX+1,depthY+1)
   visit(x,my,width/2,height/2,depthX+1,depthY+1)
   visit(mx,my,width/2,height/2,depthX+1,depthY+1)
  }else if(splitX){
   visit(x,y,width/2,height,depthX+1,depthY)
   visit(mx,y,width/2,height,depthX+1,depthY)
  }else if(splitY){
   visit(x,y,width,height/2,depthX,depthY+1)
   visit(x,my,width,height/2,depthX,depthY+1)
  }else leaves.push(x,y,width,height)
 }
 visit(0,0,nx,ny,0,0)

 const linePoints=(vertical,fixed,min,max)=>{
  const points=[]
  for(let position=Math.ceil(min);position<=max;position++){
   const x=vertical?fixed:position,y=vertical?position:fixed,value=cached(x,y)
   if(value===Infinity)continue
   if(!Number.isFinite(value))continue
   points.push(vertical?{x:fixed,y:position,value}:{x:position,y:fixed,value})
  }
  points.sort((a,b)=>vertical?a.y-b.y:a.x-b.x)
  return points
 }
 const edgeKey=(a,b,level)=>[pointKey(a.x,a.y),pointKey(b.x,b.y)].sort().join('|')+`@${level}`
 const marchSquare=(level,corners)=>{
  const crossings=[]
  const edge=(i,j)=>{
   const a=corners[i],b=corners[j]
   if(!crosses(a.value,b.value,level))return
   const t=(level-a.value)/(b.value-a.value),key=t<1e-10?pointKey(a.x,a.y):t>1-1e-10?pointKey(b.x,b.y):edgeKey(a,b,level)
   crossings.push({key,point:[a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t]})
  }
  edge(0,1);edge(1,2);edge(3,2);edge(0,3)
  if(crossings.length===2)addSegment(level,crossings[0],crossings[1])
  else if(crossings.length===4){
   const [a,b,c,d]=corners.map(point=>point.value),decider=(a-level)*(c-level)-(b-level)*(d-level)
   if(decider>=0){addSegment(level,crossings[0],crossings[1]);addSegment(level,crossings[2],crossings[3])}
   else{addSegment(level,crossings[0],crossings[3]);addSegment(level,crossings[1],crossings[2])}
  }
 }
 for(let leaf=0;leaf<leaves.length;leaf+=4){
  const x=leaves[leaf],y=leaves[leaf+1],width=leaves[leaf+2],height=leaves[leaf+3]
  const xs=new Set([...linePoints(false,y,x,x+width),...linePoints(false,y+height,x,x+width)].map(point=>point.x))
  const ys=new Set([...linePoints(true,x,y,y+height),...linePoints(true,x+width,y,y+height)].map(point=>point.y))
  const columns=[...xs].sort((a,b)=>a-b),rows=[...ys].sort((a,b)=>a-b)
  for(let j=0;j<rows.length-1;j++)for(let i=0;i<columns.length-1;i++){
   const corners=[[columns[i],rows[j]],[columns[i+1],rows[j]],[columns[i+1],rows[j+1]],[columns[i],rows[j+1]]].map(([px,py])=>({x:px,y:py,value:read(px,py)}))
   if(corners.some(point=>!Number.isFinite(point.value)))continue
   const min=Math.min(...corners.map(point=>point.value)),max=Math.max(...corners.map(point=>point.value))
   const [levelStart,levelEnd]=levelRange(min,max)
   for(let levelIndex=levelStart;levelIndex<levelEnd;levelIndex++)marchSquare(sortedLevels[levelIndex].value,corners)
  }
 }

 const trace=store=>{
  const {pairs,points,adjacency}=store,lines=pairs.length/2,visited=new Uint8Array(lines),paths=[]
  const follow=(first,start)=>{
   const pathPoints=[],origin=start;let index=first,current=start
   while(index!==undefined&&!visited[index]){
    visited[index]=1
    const a=pairs[index*2],b=pairs[index*2+1],next=a===current?b:a
    pathPoints.push(points[current]);current=next
    index=adjacency[current].find(id=>!visited[id])
   }
   pathPoints.push(points[current])
   return {points:pathPoints,closed:current===origin}
  }
  for(let vertex=0;vertex<adjacency.length;vertex++)if(adjacency[vertex].length===1&&!visited[adjacency[vertex][0]])paths.push(follow(adjacency[vertex][0],vertex))
  for(let i=0;i<lines;i++)if(!visited[i])paths.push(follow(i,pairs[i*2]))
  return paths
 }
 const tolerance=Math.min(spanX/2**maxDepthX,spanY/2**maxDepthY)*.025
 const round=value=>Math.round(value*1e8)/1e8,paths=[]
 for(const {step,value} of levels)for(const path of trace(segments.get(value))){
  if(path.points.length<2)continue
  const coordinates=path.points.map(([x,y])=>[left+x/nx*spanX,bottom+y/ny*spanY])
  const curves=fitContour(coordinates,tolerance).map(curve=>curve.flatMap(([x,y])=>[
   round((x-ax0)/(ax1-ax0)),round((y-ay0)/(ay1-ay0))
  ]))
  paths.push({step,closed:path.closed,curves})
 }
 return paths
}
