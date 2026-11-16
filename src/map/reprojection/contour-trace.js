// Trace all requested levels in one pass over the sampled scalar field.
// Values are row-major and NaN marks an invalid sample.
export function traceContoursMulti(values,width,height,levels){
 if(width<2||height<2||values.length!==width*height||!levels.every(Number.isFinite))throw Error('Invalid contour grid')
 const sorted=[...new Set(levels)].sort((a,b)=>a-b),groups=new Map(sorted.map(level=>[level,{segments:[],adjacent:new Map()}]))
 const edge=(x,y,axis,a,b,level)=>{
  const t=(level-a)/(b-a),key=`${axis}:${x}:${y}`
  return {key,point:axis==='h'?[x+t,y]:[x,y+t]}
 }
 const add=(group,a,b)=>{
  const id=group.segments.length;group.segments.push([a,b])
  for(const e of [a,b]){if(!group.adjacent.has(e.key))group.adjacent.set(e.key,[]);group.adjacent.get(e.key).push(id)}
 }
 const upperBound=(value)=>{
  let low=0,high=sorted.length
  while(low<high){const middle=(low+high)>>>1;if(sorted[middle]<=value)low=middle+1;else high=middle}
  return low
 }
 for(let y=0;y<height-1;y++)for(let x=0;x<width-1;x++){
  const a=values[y*width+x],b=values[y*width+x+1],c=values[(y+1)*width+x+1],d=values[(y+1)*width+x]
  if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(c)||!Number.isFinite(d))continue
  const min=Math.min(a,b,c,d),max=Math.max(a,b,c,d)
  const first=upperBound(min),last=upperBound(max)
  for(let index=first;index<last;index++){
   const level=sorted[index],crossings=[]
   if((a>=level)!==(b>=level))crossings.push(edge(x,y,'h',a,b,level))
   if((b>=level)!==(c>=level))crossings.push(edge(x+1,y,'v',b,c,level))
   if((d>=level)!==(c>=level))crossings.push(edge(x,y+1,'h',d,c,level))
   if((a>=level)!==(d>=level))crossings.push(edge(x,y,'v',a,d,level))
   const group=groups.get(level)
   if(crossings.length===2)add(group,crossings[0],crossings[1])
   else if(crossings.length===4){
    // Bilinear asymptotic decider handles saddle cells without arbitrary joins.
    const determinant=(a-level)*(c-level)-(b-level)*(d-level)
    if(determinant>=0){add(group,crossings[0],crossings[1]);add(group,crossings[2],crossings[3])}
    else{add(group,crossings[0],crossings[3]);add(group,crossings[1],crossings[2])}
   }
  }
 }
 const result=new Map()
 for(const [level,{segments,adjacent}] of groups){
  const visited=new Uint8Array(segments.length),paths=[]
  function follow(id,start){
   const points=[],first=start.key;let next=start
   while(id!==undefined&&!visited[id]){
    visited[id]=1;const [a,b]=segments[id],other=a.key===next.key?b:a
    points.push(next.point);next=other
    id=(adjacent.get(next.key)||[]).find(index=>!visited[index])
   }
   points.push(next.point)
   return {points,closed:next.key===first}
  }
  // Begin at open ends before loops so every segment is visited once.
  for(const [key,ids] of adjacent)if(ids.length===1&&!visited[ids[0]]){
   const segment=segments[ids[0]],start=segment[0].key===key?segment[0]:segment[1]
   paths.push(follow(ids[0],start))
  }
  for(let i=0;i<segments.length;i++)if(!visited[i])paths.push(follow(i,segments[i][0]))
  result.set(level,paths)
 }
 return result
}

export function traceContours(values,width,height,level){
 if(!Number.isFinite(level))throw Error('Invalid contour grid')
 return traceContoursMulti(values,width,height,[level]).get(level)||[]
}
