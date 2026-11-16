import {fitContour} from './curve-fit.js'

export function createAdaptiveContourWorkspace(maxDepthX=9,maxDepthY=9){
 const nx=2**(maxDepthX+1),ny=2**(maxDepthY+1)
 return {maxDepthX,maxDepthY,nx,ny,values:new Float32Array((nx+1)*(ny+1))}
}

// Build contours from an anisotropic quadtree. Cells split independently in
// X and Y; edge samples are shared so neighboring leaves stitch exactly.
export function buildAdaptiveContourPaths({sample,extent,atlasExtent,levels,maxDepthX=8,maxDepthY=8,curvatureTolerance=.08,workspace=null}={}){
 if(typeof sample!=='function'||extent?.length!==4||atlasExtent?.length!==4||!levels?.length)throw Error('Invalid adaptive contour request')
 const [left,bottom,right,top]=extent,[ax0,ay0,ax1,ay1]=atlasExtent
 const spanX=right-left,spanY=top-bottom
 if(!(spanX>0&&spanY>0&&ax1>ax0&&ay1>ay0))throw Error('Invalid adaptive contour extent')
 const nx=2**(maxDepthX+1),ny=2**(maxDepthY+1)
 workspace??=createAdaptiveContourWorkspace(maxDepthX,maxDepthY)
 if(workspace.maxDepthX<maxDepthX||workspace.maxDepthY<maxDepthY)throw Error('Adaptive contour workspace is too small')
 const scaleX=workspace.nx/nx,scaleY=workspace.ny/ny,stride=workspace.nx+1,values=workspace.values
 if(!Number.isInteger(scaleX)||!Number.isInteger(scaleY))throw Error('Adaptive contour workspace depth mismatch')
 values.fill(Infinity)
 const segments=new Map(levels.map(({value})=>[value,[]])),leaves=[]
 const pointKey=(x,y)=>`${x},${y}`,sampleKey=(x,y)=>(y*scaleY)*stride+x*scaleX
 const read=(x,y)=>{
  const key=sampleKey(x,y)
  if(values[key]!==Infinity)return values[key]
  const value=sample([left+x/nx*spanX,bottom+y/ny*spanY])
  values[key]=Number.isFinite(value)?value:NaN
  return values[key]
 }
 const crosses=(a,b,level)=>(a>=level)!==(b>=level)
 const addSegment=(level,a,b)=>{if(a.key!==b.key)segments.get(level).push({a,b})}

 const splitAxes=values9=>{
  const [a,b,c,d,bm,rm,tm,lm,cm]=values9
  const rows=[[d,tm,c],[lm,cm,rm],[a,bm,b]]
  const finite=rows.flat().map(Number.isFinite)
  let splitX=false,splitY=false
  if(finite.some(value=>value!==finite[0])){
   for(const row of rows)for(let x=0;x<2;x++)if(Number.isFinite(row[x])!==Number.isFinite(row[x+1]))splitX=true
   for(let x=0;x<3;x++)for(let y=0;y<2;y++)if(Number.isFinite(rows[y][x])!==Number.isFinite(rows[y+1][x]))splitY=true
   if(!splitX&&!splitY)splitX=splitY=true
   return [splitX,splitY]
  }
  const errorsX=[Math.abs(bm-(a+b)/2),Math.abs(tm-(d+c)/2),Math.abs(cm-(lm+rm)/2)]
  const errorsY=[Math.abs(lm-(a+d)/2),Math.abs(rm-(b+c)/2),Math.abs(cm-(bm+tm)/2)]
  if(Math.max(...errorsX)>curvatureTolerance)splitX=true
  if(Math.max(...errorsY)>curvatureTolerance)splitY=true
  let possible=false
  const min=Math.min(...rows.flat()),max=Math.max(...rows.flat())
  for(const {value:level} of levels){
   if(level<min||level>max)continue
   possible=true
   for(const row of rows)for(let x=0;x<2;x++)if(crosses(row[x],row[x+1],level))splitX=true
   for(let x=0;x<3;x++)for(let y=0;y<2;y++)if(crosses(rows[y][x],rows[y+1][x],level))splitY=true
  }
  if(possible&&!splitX&&!splitY)splitX=splitY=true
  return [splitX,splitY]
 }

 const visit=(x,y,width,height,depthX,depthY)=>{
  const mx=x+width/2,my=y+height/2
  const stencil=[read(x,y),read(x+width,y),read(x+width,y+height),read(x,y+height),read(mx,y),read(x+width,my),read(mx,y+height),read(x,my),read(mx,my)]
  let [splitX,splitY]=splitAxes(stencil)
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
  }else leaves.push({x,y,width,height})
 }
 visit(0,0,nx,ny,0,0)

 const linePoints=(vertical,fixed,min,max)=>{
  const points=[]
  for(let position=Math.ceil(min);position<=max;position++){
   const x=vertical?fixed:position,y=vertical?position:fixed,value=values[sampleKey(x,y)]
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
 for(const {x,y,width,height} of leaves){
  const xs=new Set([...linePoints(false,y,x,x+width),...linePoints(false,y+height,x,x+width)].map(point=>point.x))
  const ys=new Set([...linePoints(true,x,y,y+height),...linePoints(true,x+width,y,y+height)].map(point=>point.y))
  const columns=[...xs].sort((a,b)=>a-b),rows=[...ys].sort((a,b)=>a-b)
  for(let j=0;j<rows.length-1;j++)for(let i=0;i<columns.length-1;i++){
   const corners=[[columns[i],rows[j]],[columns[i+1],rows[j]],[columns[i+1],rows[j+1]],[columns[i],rows[j+1]]].map(([px,py])=>({x:px,y:py,value:read(px,py)}))
   if(corners.some(point=>!Number.isFinite(point.value)))continue
   const min=Math.min(...corners.map(point=>point.value)),max=Math.max(...corners.map(point=>point.value))
   for(const {value:level} of levels)if(min<=level&&level<=max)marchSquare(level,corners)
  }
 }

 const trace=level=>{
  const lines=segments.get(level),adjacent=new Map()
  for(let i=0;i<lines.length;i++)for(const endpoint of [lines[i].a,lines[i].b]){
   if(!adjacent.has(endpoint.key))adjacent.set(endpoint.key,[])
   adjacent.get(endpoint.key).push(i)
  }
  const visited=new Uint8Array(lines.length),paths=[]
  const follow=(first,start)=>{
   const points=[],origin=start.key;let index=first,current=start
   while(index!==undefined&&!visited[index]){
    visited[index]=1
    const segment=lines[index],next=segment.a.key===current.key?segment.b:segment.a
    points.push(current.point);current=next
    index=(adjacent.get(current.key)||[]).find(id=>!visited[id])
   }
   points.push(current.point)
   return {points,closed:current.key===origin}
  }
  for(const [key,ids] of adjacent)if(ids.length===1&&!visited[ids[0]]){
   const segment=lines[ids[0]],start=segment.a.key===key?segment.a:segment.b
   paths.push(follow(ids[0],start))
  }
  for(let i=0;i<lines.length;i++)if(!visited[i])paths.push(follow(i,lines[i].a))
  return paths
 }
 const tolerance=Math.min(spanX/2**maxDepthX,spanY/2**maxDepthY)*.025
 const round=value=>Math.round(value*1e8)/1e8,paths=[]
 for(const {quarter,value} of levels)for(const path of trace(value)){
  if(path.points.length<2)continue
  const coordinates=path.points.map(([x,y])=>[left+x/nx*spanX,bottom+y/ny*spanY])
  const curves=fitContour(coordinates,tolerance).map(curve=>curve.flatMap(([x,y])=>[
   round((x-ax0)/(ax1-ax0)),round((y-ay0)/(ay1-ay0))
  ]))
  paths.push({quarter,closed:path.closed,curves})
 }
 return paths
}
