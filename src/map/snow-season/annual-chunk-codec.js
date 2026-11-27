import {CHUNK_SIZE,CHUNK_CELLS,hasCell} from './chunk-codec.js?v=snow-depth-v3'
import {summarizeAnnualSeasons} from './annual-seasons.js?v=snow-depth-v3'
import {depthIndex} from './depths.js?v=snow-depth-v3'
export {CHUNK_SIZE,CHUNK_CELLS,hasCell}
export function emptyChunk(cx,cy,{firstEndYear=new Date().getUTCFullYear()-20,years=20}={}){
 return {cx,cy,firstEndYear,years,data:new Uint8Array(0),quality:new Uint8Array(0),known:new Uint8Array(Math.ceil(CHUNK_CELLS/8)),revision:0,summary:null}
}
export function setChunkCell(chunk,index,annual){
 if(!Number.isInteger(index)||index<0||index>=CHUNK_CELLS||annual.data?.length!==chunk.years*8||annual.known?.length!==chunk.years)throw new RangeError('Invalid annual snow cell')
 if(!chunk.data.length){chunk.data=new Uint8Array(CHUNK_CELLS*chunk.years*8);chunk.quality=new Uint8Array(CHUNK_CELLS*chunk.years)}
 for(let y=0;y<chunk.years;y++){
  if(!Number.isInteger(annual.known[y])||annual.known[y]<0||annual.known[y]>5)throw new RangeError('Invalid annual snow quality')
  const row=y*CHUNK_CELLS+index;chunk.data.set(annual.data.subarray(y*8,y*8+8),row*8);chunk.quality[row]=annual.known[y]
 }
 chunk.known[index>>>3]|=1<<(index&7);chunk.revision++
 if(chunk.summary)chunk.summary.state[index]=0
}
export function annualCell(chunk,index){
 const data=new Uint8Array(chunk.years*8),known=new Uint8Array(chunk.years)
 for(let y=0;y<chunk.years;y++){const row=y*CHUNK_CELLS+index;data.set(chunk.data.subarray(row*8,row*8+8),y*8);known[y]=chunk.quality[row]}
 return {data,known}
}
/** One selected-depth summary cache per chunk, in bounded typed arrays. */
export function chunkRecord(chunk,index,minimumDepth=0){
 depthIndex(minimumDepth)
 if(!hasCell(chunk,index))return null
 if(!chunk.summary||chunk.summary.depth!==minimumDepth)chunk.summary={depth:minimumDepth,state:new Uint8Array(CHUNK_CELLS),start:new Uint16Array(CHUNK_CELLS),end:new Uint16Array(CHUNK_CELLS),total:new Uint16Array(CHUNK_CELLS),whole:new Uint8Array(CHUNK_CELLS)}
 const cache=chunk.summary
 if(cache.state[index]){
  if(cache.state[index]===2)return {status:'complete',days:0,start:null,end:null,minimumDepth,unknownYears:0,lengthBounds:{minimum:0,maximum:0},wholeYears:null}
  const date=n=>new Date(Date.UTC(2001,8,1)+n*86400000).toISOString().slice(5,10)
  const length=cache.end[index]-cache.start[index]+1
  return {status:'complete',days:cache.total[index]/chunk.years,start:date(cache.start[index]),end:date(cache.end[index]),wholeYears:{minimum:cache.whole[index],maximum:cache.whole[index]},minimumDepth,unknownYears:0,lengthBounds:{minimum:length,maximum:length}}
 }
 const record=summarizeAnnualSeasons(annualCell(chunk,index),{firstEndYear:chunk.firstEndYear,years:chunk.years},minimumDepth)
 // Keep uncertainty records uncached rather than losing their bounds.
 if(!record.unknownYears){
  cache.state[index]=record.days===0?2:1
  if(record.days){
   const day=md=>(Date.parse(`${md>='09-01'?2001:2002}-${md}T00:00:00Z`)-Date.UTC(2001,8,1))/86400000
   cache.start[index]=day(record.start);cache.end[index]=day(record.end);cache.total[index]=Math.round(record.days*chunk.years);cache.whole[index]=record.wholeYears.minimum
  }
 }
 return record
}
export function encodeChunk(chunk){
 const n=CHUNK_CELLS*chunk.years,qLength=Math.ceil(n*3/8),knownLength=chunk.known.length
 const dataLength=n*8,bytes=new Uint8Array(32+dataLength+qLength+knownLength),view=new DataView(bytes.buffer)
 bytes.set([83,83,67,51]);view.setUint16(4,CHUNK_SIZE,true);view.setUint16(6,CHUNK_SIZE,true);view.setInt16(8,chunk.cx,true);view.setInt16(10,chunk.cy,true)
 view.setUint16(12,chunk.firstEndYear,true);view.setUint8(14,chunk.years);view.setUint32(16,dataLength,true);view.setUint32(20,qLength,true);view.setUint32(24,knownLength,true)
 bytes.set(chunk.data,32);const q=32+dataLength
 for(let i=0;i<n;i++){
  const value=chunk.quality[i]??0,bit=i*3,j=q+(bit>>>3),shift=bit&7
  bytes[j]|=value<<shift;if(shift>5)bytes[j+1]|=value>>>(8-shift)
 }
 bytes.set(chunk.known,q+qLength);return bytes
}
export function decodeChunk(input){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input)
 if(bytes.length<32||bytes[0]!==83||bytes[1]!==83||bytes[2]!==67||bytes[3]!==51)throw new RangeError('Invalid annual snow chunk')
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),years=v.getUint8(14),firstEndYear=v.getUint16(12,true),n=CHUNK_CELLS*years
 const dataLength=n*8,qLength=Math.ceil(n*3/8),knownLength=Math.ceil(CHUNK_CELLS/8)
 if(v.getUint16(4,true)!==CHUNK_SIZE||v.getUint16(6,true)!==CHUNK_SIZE||years<1||years>100||firstEndYear<1901||firstEndYear+years>9999||v.getUint32(16,true)!==dataLength||v.getUint32(20,true)!==qLength||v.getUint32(24,true)!==knownLength||bytes.length!==32+dataLength+qLength+knownLength)throw new RangeError('Invalid annual chunk dimensions')
 const c=emptyChunk(v.getInt16(8,true),v.getInt16(10,true),{years,firstEndYear}),q=32+dataLength
 c.data=bytes.subarray(32,q);c.quality=new Uint8Array(n);c.known.set(bytes.subarray(q+qLength))
 for(let i=0;i<n;i++){
  const bit=i*3,j=q+(bit>>>3),shift=bit&7,value=((bytes[j]|((bytes[j+1]??0)<<8))>>>shift)&7
  if(value>5)throw new RangeError('Invalid annual quality count');c.quality[i]=value
 }
 return c
}
export async function compressChunk(chunk){
 const bytes=encodeChunk(chunk)
 if(!globalThis.CompressionStream)return {format:'raw',data:bytes.buffer}
 const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
 return {format:'deflate',data:await new Response(stream).arrayBuffer()}
}
export async function decompressChunk(payload){
 if(payload.format==='raw')return decodeChunk(payload.data)
 if(payload.format!=='deflate'||!globalThis.DecompressionStream)throw new RangeError('Unsupported annual chunk compression')
 return decodeChunk(await new Response(new Blob([payload.data]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())
}
