import {CHUNK_CELLS,CHUNK_SIZE,hasCell} from './annual-chunk-codec.js?v=snow-depth-v3'
import {depthIndex} from './depths.js?v=snow-depth-v3'
import {chunksForExtent,nativeCell,SNOW_RESOLUTIONS,displayTileExtent,inSnowDomain} from './chunk-grid.js?v=snow-depth-v3'
import {snowColor,seasonalDay} from './grid.js?v=snow-depth-v3'
/** Worker-side aggregation; neither NVE fetching nor statistics enter OL's render loop. */
export async function renderSnowTile(store,{z,x,y,metric,minimumDepth=0}){
 depthIndex(minimumDepth)
 if(!Number.isInteger(z)||z<0||z>=SNOW_RESOLUTIONS.length||!Number.isInteger(x)||!Number.isInteger(y)||!['length','start','end'].includes(metric))throw new RangeError('Invalid snow display tile')
 const extent=displayTileExtent(z,x,y),resolution=SNOW_RESOLUTIONS[z],sums=new Float64Array(CHUNK_CELLS),counts=new Uint16Array(CHUNK_CELLS),scale=resolution/1000
 for(const {cx,cy} of chunksForExtent(extent)){
  const chunk=await store.getChunk(cx,cy)
  for(let index=0;index<CHUNK_CELLS;index++){
   if(!hasCell(chunk,index))continue
   const cell=nativeCell(cx,cy,index);if(!inSnowDomain(cell)||cell.x<extent[0]||cell.x>=extent[2]||cell.y<extent[1]||cell.y>=extent[3])continue
   const record=store.record(chunk,index,minimumDepth),value=metric==='length'?record.days:seasonalDay(record[metric]);if(value===null||!Number.isFinite(value))continue
   const col=Math.floor((cell.x-extent[0])/resolution),row=Math.floor((extent[3]-cell.y)/resolution),i=row*CHUNK_SIZE+col;sums[i]+=value;counts[i]++
  }
 }
 const pixels=new Uint8ClampedArray(CHUNK_CELLS*4)
 for(let i=0;i<CHUNK_CELLS;i++)if(counts[i]){
  const value=sums[i]/counts[i],color=snowColor({days:value},'length')
  // Start uses the same date scale with reversed palette.
  const rgb=metric==='start'?snowColor({days:365-value},'length'):color
  pixels.set(rgb,i*4);pixels[i*4+3]=Math.max(1,Math.round(255*counts[i]/(scale*scale)))
 }
 return pixels
}
