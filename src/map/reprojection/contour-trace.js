// Trace a regularly sampled scalar field. Values are row-major and NaN marks
// an invalid sample. Endpoints retain the grid edge they crossed so adjacent
// cells share exactly the same vertices.
export function traceContours(values,width,height,level){
 if(width<2||height<2||values.length!==width*height||!Number.isFinite(level))throw Error('Invalid contour grid')
 const segments=[],adjacent=new Map()
 const edge=(x,y,axis,a,b)=>{
  const t=(level-a)/(b-a),key=`${axis}:${x}:${y}`
  return {key,point:axis==='h'?[x+t,y]:[x,y+t]}
 }
 const add=(a,b)=>{
  const id=segments.length;segments.push([a,b])
  for(const e of [a,b]){if(!adjacent.has(e.key))adjacent.set(e.key,[]);adjacent.get(e.key).push(id)}
 }
 for(let y=0;y<height-1;y++)for(let x=0;x<width-1;x++){
  const a=values[y*width+x],b=values[y*width+x+1],c=values[(y+1)*width+x+1],d=values[(y+1)*width+x]
  if(![a,b,c,d].every(Number.isFinite))continue
  const crossings=[]
  if((a>=level)!==(b>=level))crossings.push(edge(x,y,'h',a,b))
  if((b>=level)!==(c>=level))crossings.push(edge(x+1,y,'v',b,c))
  if((d>=level)!==(c>=level))crossings.push(edge(x,y+1,'h',d,c))
  if((a>=level)!==(d>=level))crossings.push(edge(x,y,'v',a,d))
  if(crossings.length===2)add(crossings[0],crossings[1])
  else if(crossings.length===4){
   // Bilinear asymptotic decider handles saddle cells without arbitrary joins.
   const determinant=(a-level)*(c-level)-(b-level)*(d-level)
   if(determinant>=0){add(crossings[0],crossings[1]);add(crossings[2],crossings[3])}
   else{add(crossings[0],crossings[3]);add(crossings[1],crossings[2])}
  }
 }
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
 return paths
}
