/** Lossless normalized September–August intervals. No OpenLayers or DOM. */
export const NO_SEASON=0xffff,UNKNOWN_PERIOD=0xfefe,ESCAPE_PERIOD=0xfdfd,CHUNK_SIZE=100,CHUNK_CELLS=10000
const REFERENCE=Date.UTC(2001,8,1),DAY=86400000
export function monthDay(index){return new Date(REFERENCE+index*DAY).toISOString().slice(5,10)}
export function dayIndex(md){
 if(!/^\d{2}-\d{2}$/.test(md??''))throw new RangeError('Invalid seasonal date')
 const index=(Date.parse(`${md.slice(0,2)>='09'?2001:2002}-${md}T00:00:00Z`)-REFERENCE)/DAY
 if(!Number.isInteger(index)||index<0||index>364||monthDay(index)!==md)throw new RangeError('Invalid seasonal date')
 return index
}
export function encodePeriod(start,end){
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>364||start>end)throw new RangeError('Invalid snow period')
 let a=start,b=364-end
 if(a<=255&&b<=255)return a|(b<<8)
 const duration=end-start+1,late=start>255,offset=late?364-end:start,large=256-duration,small=large-offset-1
 if(small<0||large>255||large+small<365)return ESCAPE_PERIOD
 a=late?small:large;b=late?large:small;return a|(b<<8)
}
export function decodePeriod(word,exception){
 if(!Number.isInteger(word)||word<0||word>65535)throw new RangeError('Invalid snow code')
 if(word===NO_SEASON||word===UNKNOWN_PERIOD)return null
 if(word===ESCAPE_PERIOD){
  if(!exception||exception.length!==2)throw new RangeError('Missing snow exception')
  encodePeriod(...exception);return [...exception]
 }
 const a=word&255,b=word>>>8
 if(a+b<365)return [a,364-b]
 if(a===b)throw new RangeError('Reserved snow code')
 const duration=256-Math.max(a,b),offset=Math.abs(a-b)-1
 const pair=a>b?[offset,offset+duration-1]:[365-offset-duration,364-offset]
 if(encodePeriod(...pair)!==word)throw new RangeError('Noncanonical snow code')
 return pair
}
export function emptyChunk(cx,cy){return {cx,cy,words:new Uint16Array(CHUNK_CELLS).fill(UNKNOWN_PERIOD),known:new Uint8Array(CHUNK_CELLS/8),exceptions:new Map(),metadata:new Map(),revision:0}}
export const hasCell=(chunk,index)=>Boolean(chunk.known[index>>>3]&(1<<(index&7)))
export function setChunkCell(chunk,index,record){
 if(!Number.isInteger(index)||index<0||index>=CHUNK_CELLS)throw new RangeError('Invalid chunk cell')
 let word=record.days===0?NO_SEASON:UNKNOWN_PERIOD
 chunk.exceptions.delete(index)
 if(record.start&&record.end){const pair=[dayIndex(record.start),dayIndex(record.end)];word=encodePeriod(...pair);if(word===ESCAPE_PERIOD)chunk.exceptions.set(index,pair)}
 chunk.words[index]=word;chunk.known[index>>>3]|=1<<(index&7)
 const {start,end,days,...metadata}=record
 // Preserve the estimator's exact mean (including leap days), bounds and quality.
 chunk.metadata.set(index,{...metadata,...(days!==null&&days!==0?{days}:{} )});chunk.revision++
}
export function chunkRecord(chunk,index){
 if(!hasCell(chunk,index))return null
 const word=chunk.words[index],pair=decodePeriod(word,chunk.exceptions.get(index))
 const metadata=chunk.metadata.get(index)??{}
 return {...metadata,start:pair?monthDay(pair[0]):null,end:pair?monthDay(pair[1]):null,days:pair?(metadata.days??pair[1]-pair[0]+1):word===NO_SEASON?0:null}
}
/** All words and escapes are explicitly little endian. Pending != known unknown. */
export function encodeChunk(chunk){
 const metadata=new TextEncoder().encode(JSON.stringify([...chunk.metadata])),exceptionCount=chunk.exceptions.size
 const bytes=new Uint8Array(24+20000+1250+exceptionCount*4+metadata.length),v=new DataView(bytes.buffer)
 bytes.set([83,83,67,49]);v.setUint16(4,100,true);v.setUint16(6,100,true);v.setInt16(8,chunk.cx,true);v.setInt16(10,chunk.cy,true);v.setUint32(12,exceptionCount,true);v.setUint32(16,metadata.length,true)
 for(let i=0;i<10000;i++)v.setUint16(24+2*i,chunk.words[i],true)
 bytes.set(chunk.known,20024);let pos=21274,count=0
 for(let i=0;i<10000;i++)if(hasCell(chunk,i)&&chunk.words[i]===ESCAPE_PERIOD){const pair=chunk.exceptions.get(i);decodePeriod(ESCAPE_PERIOD,pair);v.setUint16(pos,pair[0],true);v.setUint16(pos+2,pair[1],true);pos+=4;count++}
 if(count!==exceptionCount)throw new RangeError('Snow exception count mismatch')
 bytes.set(metadata,pos);return bytes
}
export function decodeChunk(input){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input)
 if(bytes.length<21274||bytes[0]!==83||bytes[1]!==83||bytes[2]!==67||bytes[3]!==49)throw new RangeError('Invalid snow chunk header')
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=v.getUint32(12,true),metadataLength=v.getUint32(16,true)
 if(v.getUint16(4,true)!==100||v.getUint16(6,true)!==100||count>10000||bytes.length!==21274+4*count+metadataLength)throw new RangeError('Invalid snow chunk size')
 const chunk=emptyChunk(v.getInt16(8,true),v.getInt16(10,true));chunk.known.set(bytes.subarray(20024,21274));let pos=21274,seen=0
 for(let i=0;i<10000;i++){
  chunk.words[i]=v.getUint16(24+2*i,true)
  if(!hasCell(chunk,i))continue
  if(chunk.words[i]===ESCAPE_PERIOD){if(++seen>count)throw new RangeError('Missing snow exception');chunk.exceptions.set(i,[v.getUint16(pos,true),v.getUint16(pos+2,true)]);pos+=4}
  decodePeriod(chunk.words[i],chunk.exceptions.get(i))
 }
 if(seen!==count)throw new RangeError('Snow exception count mismatch')
 const entries=JSON.parse(new TextDecoder().decode(bytes.subarray(pos)))
 if(!Array.isArray(entries)||entries.length>10000)throw new RangeError('Invalid snow metadata')
 for(const entry of entries){if(!Array.isArray(entry)||entry.length!==2||!Number.isInteger(entry[0])||entry[0]<0||entry[0]>=10000||!hasCell(chunk,entry[0])||!entry[1]||typeof entry[1]!=='object'||Array.isArray(entry[1])||chunk.metadata.has(entry[0]))throw new RangeError('Invalid snow metadata');chunk.metadata.set(...entry)}
 return chunk
}
export async function compressChunk(chunk){
 const bytes=encodeChunk(chunk)
 if(!globalThis.CompressionStream)return {format:'raw',data:bytes.buffer}
 const stream=new CompressionStream('deflate'),result=new Response(stream.readable).arrayBuffer(),writer=stream.writable.getWriter();await writer.write(bytes);await writer.close()
 return {format:'deflate',data:await result}
}
export async function decompressChunk(payload){
 if(payload.format==='raw')return decodeChunk(payload.data)
 if(payload.format!=='deflate'||!globalThis.DecompressionStream)throw new RangeError('Unsupported snow chunk compression')
 const stream=new DecompressionStream('deflate'),result=new Response(stream.readable).arrayBuffer(),writer=stream.writable.getWriter();await writer.write(payload.data);await writer.close();return decodeChunk(await result)
}
