// Runtime curve index shared by the UI thread and the plan worker. This file
// has no projection-library imports so it can load in a module worker.
export class ContourAtlasIndex {
 constructor(data,{indexSize=32}={}){
  if(![1,2,3].includes(data.version)||!Array.isArray(data.extent)||!Array.isArray(data.paths))throw Error('Invalid contour atlas')
  this.data=data;this.indexSize=indexSize;this.cells=new Map();this.segments=[]
  for(const path of data.paths)for(let index=0;index<path.curves.length;index++){
   const curve=path.curves[index]
   const xs=[curve[0],curve[2],curve[4],curve[6]],ys=[curve[1],curve[3],curve[5],curve[7]]
   const step=path.step??(data.steps?path.quarter:(path.quarter??0)/4),level=step/(data.steps||1)
   const oriented=path.orientations?path.orientations[index]===true:path.orientation==='high-left'
   const segment={step,level,curve,oriented,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]},id=this.segments.push(segment)-1
   const [x0,y0,x1,y1]=this.cellRange(segment.bounds)
   for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const key=y*indexSize+x;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(id)
   }
  }
 }
 cellRange(extent){const clamp=value=>Math.max(0,Math.min(this.indexSize-1,Math.floor(value*this.indexSize)));return extent.map(clamp)}
 query(extent){
  const [minX,minY,maxX,maxY]=extent
  if(maxX<0||minX>1||maxY<0||minY>1)return []
  const [x0,y0,x1,y1]=this.cellRange(extent),ids=new Set(),result=[]
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)for(const id of this.cells.get(y*this.indexSize+x)||[])ids.add(id)
  for(const id of ids){const s=this.segments[id],b=s.bounds;if(b[0]<=maxX&&b[2]>=minX&&b[1]<=maxY&&b[3]>=minY)result.push(s)}
  return result
 }
}

export {ContourAtlasIndex as ContourAtlas}
