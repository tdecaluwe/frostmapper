const DAY=86400000
export function archiveQuery(url){
 const u=new URL(url),file=/\/(sd|swe)_(\d{4})\.nc\.dods$/.exec(u.pathname),expression=decodeURIComponent(u.search.slice(1)),range=/\[(\d+):(\d+)\]\[(\d+):(\d+)\]\[(\d+):(\d+)\]$/.exec(expression)
 if(!file||!range)throw new Error('Unexpected archive query')
 const [first,last,yFirst,yLast,xFirst,xLast]=range.slice(1).map(Number),year=Number(file[2]),width=xLast-xFirst+1,height=yLast-yFirst+1,days=last-first+1
 return {theme:file[1],year,first,last,yFirst,yLast,xFirst,xLast,width,height,days,start:Date.UTC(year,0,1)/DAY+first}
}
export function archiveFixture(url,{value=1,overrides=[]}={}){
 const q=archiveQuery(url),variable=q.theme==='sd'?'snow_depth':'snow_water_equivalent',count=q.days*q.width*q.height
 let header=`Dataset {\n Structure {\n  Float32 ${variable}[time = ${q.days}][y = ${q.height}][x = ${q.width}];\n } ${variable};\n} test;\n`
 header+=' '.repeat((4-(header.length+6)%4)%4);header+='Data:\n'
 const bytes=new Uint8Array(header.length+8+4*count),view=new DataView(bytes.buffer);bytes.set(new TextEncoder().encode(header));view.setUint32(header.length,count);view.setUint32(header.length+4,count)
 const pattern=new ArrayBuffer(4);new DataView(pattern).setFloat32(0,value);new Uint32Array(bytes.buffer,header.length+8,count).fill(new Uint32Array(pattern)[0])
 for(const rule of overrides){
  if(rule.theme&&rule.theme!==q.theme||rule.x<q.xFirst||rule.x>q.xLast||rule.y<q.yFirst||rule.y>q.yLast)continue
  for(let t=0;t<q.days;t++){const day=q.start+t,v=typeof rule.value==='function'?rule.value(day,q):rule.value;if(v===undefined)continue;const index=t*q.width*q.height+(rule.y-q.yFirst)*q.width+rule.x-q.xFirst;view.setFloat32(header.length+8+4*index,v)}
 }
 return bytes
}
