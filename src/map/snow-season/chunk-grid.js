import {SNOW_EXTENT,CELL_SIZE,cellKey} from './grid.js?v=snow-111-37x4-v1'
import {CHUNK_SIZE} from './chunk-codec.js?v=snow-111-37x4-v1'
export const CHUNK_METRES=CHUNK_SIZE*CELL_SIZE
export const SNOW_RESOLUTIONS=[16000,8000,4000,2000,1000]
export const chunkKey=(cx,cy)=>`${cx}/${cy}`
export function chunkCell(key){
 const [x,y]=key.split('/').map(Number),col=x-SNOW_EXTENT[0]/1000,row=SNOW_EXTENT[3]/1000-y-1
 const cx=Math.floor(col/CHUNK_SIZE),cy=Math.floor(row/CHUNK_SIZE),index=(row-cy*CHUNK_SIZE)*CHUNK_SIZE+col-cx*CHUNK_SIZE
 return {cx,cy,index,key:chunkKey(cx,cy)}
}
export function nativeCell(cx,cy,index){
 const x=SNOW_EXTENT[0]+(cx*CHUNK_SIZE+index%CHUNK_SIZE+.5)*1000,y=SNOW_EXTENT[3]-(cy*CHUNK_SIZE+Math.floor(index/CHUNK_SIZE)+.5)*1000
 return {x,y,key:cellKey(x,y)}
}
export const inSnowDomain=({x,y})=>x>=SNOW_EXTENT[0]&&x<SNOW_EXTENT[2]&&y>=SNOW_EXTENT[1]&&y<SNOW_EXTENT[3]
export function chunksForExtent(extent){
 if(!extent||!extent.every(Number.isFinite))return []
 const left=Math.max(SNOW_EXTENT[0],extent[0]),bottom=Math.max(SNOW_EXTENT[1],extent[1]),right=Math.min(SNOW_EXTENT[2],extent[2]),top=Math.min(SNOW_EXTENT[3],extent[3])
 if(left>=right||bottom>=top)return []
 const result=[]
 for(let cy=Math.floor((SNOW_EXTENT[3]-top)/CHUNK_METRES);cy<Math.ceil((SNOW_EXTENT[3]-bottom)/CHUNK_METRES);cy++)for(let cx=Math.floor((left-SNOW_EXTENT[0])/CHUNK_METRES);cx<Math.ceil((right-SNOW_EXTENT[0])/CHUNK_METRES);cx++)result.push({cx,cy,key:chunkKey(cx,cy)})
 return result
}
export function displayTileExtent(z,x,y){
 const span=CHUNK_SIZE*SNOW_RESOLUTIONS[z],left=SNOW_EXTENT[0]+x*span,top=SNOW_EXTENT[3]-y*span
 return [left,top-span,left+span,top]
}
