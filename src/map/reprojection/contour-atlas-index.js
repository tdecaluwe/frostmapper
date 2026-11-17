// Runtime curve index shared by the UI thread and the plan worker. This file
// has no projection-library imports so it can load in a module worker.
export class ContourAtlasIndex {
 constructor(data,{indexSize=32}={}){
  if(![1,2,3].includes(data.version)||!Array.isArray(data.extent)||!Array.isArray(data.paths))throw Error('Invalid contour atlas')
  this.data=data;this.steps=data.steps??(data.paths.some(path=>path.step===undefined&&path.quarter!==undefined)?4:1);this.indexSize=indexSize;this.cells=new Map();this.segments=[];this.originalSegments=0
  for(const path of data.paths)for(let index=0;index<path.curves.length;index++){
   const input=path.curves[index],originId=this.originalSegments++
   // Periodic paths stay continuous in an unwrapped chart. Index copies of
   // each curve in the canonical tile so BOTH sides of the seam are visible.
   const minX=Math.min(input[0],input[2],input[4],input[6]),maxX=Math.max(input[0],input[2],input[4],input[6])
   const first=data.periodicX?Math.ceil(-maxX):0,last=data.periodicX?Math.floor(1-minX):0
   for(let shift=first;shift<=last;shift++){
    const curve=shift?input.map((v,i)=>i%2?v:v+shift):input
    const xs=[curve[0],curve[2],curve[4],curve[6]],ys=[curve[1],curve[3],curve[5],curve[7]]
    const step=path.step??(path.quarter===undefined?0:(this.steps===4?path.quarter:path.quarter/4)),level=step/this.steps
    const oriented=path.orientations?path.orientations[index]===true:path.orientation==='high-left'
    const segment={step,level,curve,oriented,originId,copyShift:shift,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]},id=this.segments.push(segment)-1
    const [x0,y0,x1,y1]=this.cellRange(segment.bounds)
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
     const key=y*indexSize+x;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(id)
    }
   }
  }
 }
 cellRange(extent){const clamp=value=>Math.max(0,Math.min(this.indexSize-1,Math.floor(value*this.indexSize)));return extent.map(clamp)}
 query(extent){
  if(!this.data.periodicX)return this.queryCanonical(extent)
  const [minX,minY,maxX,maxY]=extent,seen=new Set(),result=[]
  for(let world=Math.floor(minX);world<=Math.floor(maxX);world++){
   for(const s of this.queryCanonical([Math.max(0,minX-world),minY,Math.min(1,maxX-world),maxY])){
    const key=`${s.originId}:${s.copyShift+world}`
    if(seen.has(key))continue
    seen.add(key)
    result.push(world?{...s,curve:s.curve.map((v,i)=>i%2?v:v+world),bounds:s.bounds.map((v,i)=>i%2?v:v+world)}:s)
   }
  }
  return result
 }
 queryCanonical(extent){
  const [minX,minY,maxX,maxY]=extent
  if(maxX<0||minX>1||maxY<0||minY>1)return []
  const [x0,y0,x1,y1]=this.cellRange(extent),ids=new Set(),result=[]
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)for(const id of this.cells.get(y*this.indexSize+x)||[])ids.add(id)
  for(const id of ids){const s=this.segments[id],b=s.bounds;if(b[0]<=maxX&&b[2]>=minX&&b[1]<=maxY&&b[3]>=minY)result.push(s)}
  return result
 }
}

export {ContourAtlasIndex as ContourAtlas}
