import {SNOW_EXTENT} from './grid.js?v=snow-refresh-v4'
export const FETCH_BLOCK_SIZE=37
const COLS=(SNOW_EXTENT[2]-SNOW_EXTENT[0])/1000,ROWS=(SNOW_EXTENT[3]-SNOW_EXTENT[1])/1000
export function snowFetchBlock(bx,by){
 if(!Number.isInteger(bx)||!Number.isInteger(by)||bx<0||by<0||bx*FETCH_BLOCK_SIZE>=COLS||by*FETCH_BLOCK_SIZE>=ROWS)throw new RangeError('Invalid snow fetch block')
 const width=Math.min(FETCH_BLOCK_SIZE,COLS-bx*FETCH_BLOCK_SIZE),height=Math.min(FETCH_BLOCK_SIZE,ROWS-by*FETCH_BLOCK_SIZE),left=SNOW_EXTENT[0]+bx*FETCH_BLOCK_SIZE*1000,top=SNOW_EXTENT[3]-by*FETCH_BLOCK_SIZE*1000
 return {key:`${bx}/${by}`,bx,by,width,height,cells:width*height,xFirst:bx*FETCH_BLOCK_SIZE,xLast:bx*FETCH_BLOCK_SIZE+width-1,yFirst:ROWS-by*FETCH_BLOCK_SIZE-height,yLast:ROWS-by*FETCH_BLOCK_SIZE-1,extent:[left,top-height*1000,left+width*1000,top]}
}
export function intersectsViewport(block,extent){return Boolean(extent&&extent[0]<block.extent[2]&&extent[2]>block.extent[0]&&extent[1]<block.extent[3]&&extent[3]>block.extent[1])}
