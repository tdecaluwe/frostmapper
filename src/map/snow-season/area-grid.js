import {SNOW_EXTENT} from './grid.js?v=snow-serial-v6'
export const FETCH_BLOCK_SIZE=111
const COLS=(SNOW_EXTENT[2]-SNOW_EXTENT[0])/1000,ROWS=(SNOW_EXTENT[3]-SNOW_EXTENT[1])/1000
export function snowFetchBlock(bx,by,size=FETCH_BLOCK_SIZE){
 if(!Number.isInteger(size)||size<1||size>222)throw new RangeError('Invalid snow fetch size')
 if(!Number.isInteger(bx)||!Number.isInteger(by)||bx<0||by<0||bx*size>=COLS||by*size>=ROWS)throw new RangeError('Invalid snow fetch block')
 const width=Math.min(size,COLS-bx*size),height=Math.min(size,ROWS-by*size),left=SNOW_EXTENT[0]+bx*size*1000,top=SNOW_EXTENT[3]-by*size*1000
 return {key:`${bx}/${by}`,bx,by,width,height,cells:width*height,xFirst:bx*size,xLast:bx*size+width-1,yFirst:ROWS-by*size-height,yLast:ROWS-by*size-1,extent:[left,top-height*1000,left+width*1000,top]}
}
export function intersectsViewport(block,extent){return Boolean(extent&&extent[0]<block.extent[2]&&extent[2]>block.extent[0]&&extent[1]<block.extent[3]&&extent[3]>block.extent[1])}
