import {hasCell,CHUNK_SIZE,CHUNK_CELLS} from './chunk-codec.js?v=snow-serial-v6'
import {chunkKey,chunkCell,nativeCell,CHUNK_METRES} from './chunk-grid.js?v=snow-serial-v6'
import {SNOW_EXTENT} from './grid.js?v=snow-serial-v6'
import {snowFetchBlock,FETCH_BLOCK_SIZE} from './area-grid.js?v=snow-serial-v6'
const WORDS=Math.ceil(CHUNK_CELLS/32)
function popcount(n){n-=n>>>1&0x55555555;n=(n&0x33333333)+(n>>>2&0x33333333);return Math.imul((n+(n>>>4)&0x0f0f0f0f),0x01010101)>>>24}
/** Uniform pending-bit sampling with a mild viewport-centre acceptance bias.
 * Known cells are removed in bulk when a chunk loads; reserved cells are removed
 * before dispatch. A bounded pending bitset per chunk, no per-cell job objects. */
export class SnowCollectionQueue{
 constructor({random=Math.random}={}){this.random=random;this.jobs=new Map();this.reserved=new Map();this.extent=null;this.total=0;this.completed=0}
 has(key){return this.jobs.has(key)}
 setViewport(extent){
  this.extent=extent?.every(Number.isFinite)&&extent[0]<extent[2]&&extent[1]<extent[3]?[...extent]:null
  for(const job of this.jobs.values())this.updateVisible(job)
 }
 addChunk(chunk){
  const key=chunkKey(chunk.cx,chunk.cy);if(this.jobs.has(key))return
  const width=Math.max(0,Math.min(CHUNK_SIZE,(SNOW_EXTENT[2]-SNOW_EXTENT[0])/1000-chunk.cx*CHUNK_SIZE)),height=Math.max(0,Math.min(CHUNK_SIZE,(SNOW_EXTENT[3]-SNOW_EXTENT[1])/1000-chunk.cy*CHUNK_SIZE))
  if(chunk.cx<0||chunk.cy<0||!width||!height)return
  const job={cx:chunk.cx,cy:chunk.cy,pending:new Uint32Array(WORDS),visible:new Uint32Array(WORDS),count:0,visibleCount:0,width,height}
  for(let row=0;row<height;row++)for(let col=0;col<width;col++){
   const i=row*CHUNK_SIZE+col
   if(!hasCell(chunk,i)){job.pending[i>>>5]|=1<<(i&31);job.count++}
  }
  this.total+=width*height;this.completed+=width*height-job.count;this.jobs.set(key,job);this.updateVisible(job)
 }
 updateVisible(job){
  job.visible.fill(0);job.visibleCount=0;if(!this.extent)return
  const left=SNOW_EXTENT[0]+job.cx*CHUNK_METRES,top=SNOW_EXTENT[3]-job.cy*CHUNK_METRES
  const c0=Math.max(0,Math.floor((this.extent[0]-left)/1000)),c1=Math.min(job.width,Math.ceil((this.extent[2]-left)/1000)),r0=Math.max(0,Math.floor((top-this.extent[3])/1000)),r1=Math.min(job.height,Math.ceil((top-this.extent[1])/1000))
  for(let row=r0;row<r1;row++){
   const first=row*CHUNK_SIZE+c0,last=row*CHUNK_SIZE+c1;if(first>=last)continue
   for(let word=first>>>5;word<=((last-1)>>>5);word++){
    const lo=Math.max(0,first-word*32),hi=Math.min(32,last-word*32),mask=(0xffffffff>>>32-(hi-lo))<<lo
    job.visible[word]|=mask
   }
  }
  for(let word=0;word<WORDS;word++)job.visibleCount+=popcount(job.pending[word]&job.visible[word])
 }
 take({background=true}={}){
  let count=0,visible=true
  for(const job of this.jobs.values())count+=job.visibleCount
  if(!count){if(!background)return null;visible=false;for(const job of this.jobs.values())count+=job.count}
  if(!count)return null
  for(;;){
   let rank=Math.floor(this.random()*count),selected=null,index=-1
   for(const job of this.jobs.values()){
    const n=visible?job.visibleCount:job.count;if(rank>=n){rank-=n;continue}
    selected=job
    for(let word=0;word<WORDS;word++){
     let bits=(job.pending[word]&(visible?job.visible[word]:0xffffffff))>>>0,n=popcount(bits)
     if(rank>=n){rank-=n;continue}
     while(rank-->0)bits=(bits&(bits-1))>>>0
     index=word*32+31-Math.clz32((bits&-bits)>>>0);break
    }
    break
   }
   const cell=nativeCell(selected.cx,selected.cy,index)
   if(visible){
    const [left,bottom,right,top]=this.extent,nx=(cell.x-(left+right)/2)/((right-left)/2),ny=(cell.y-(bottom+top)/2)/((top-bottom)/2),weight=1+.5*Math.exp(-2*(nx*nx+ny*ny))
    if(this.random()*1.5>weight)continue
   }
   const word=index>>>5,bit=1<<(index&31);selected.pending[word]&=~bit;selected.count--;if(selected.visible[word]&bit)selected.visibleCount--
   this.reserved.set(cell.key,{job:selected,index});return cell
  }
 }
 takeBlock({background=true}={}){
  const seed=this.take({background});if(!seed)return null
  const {job,index}=this.reserved.get(seed.key),left=Math.floor(index%CHUNK_SIZE/FETCH_BLOCK_SIZE)*FETCH_BLOCK_SIZE,top=Math.floor(Math.floor(index/CHUNK_SIZE)/FETCH_BLOCK_SIZE)*FETCH_BLOCK_SIZE
  const block=snowFetchBlock(job.cx*(CHUNK_SIZE/FETCH_BLOCK_SIZE)+left/FETCH_BLOCK_SIZE,job.cy*(CHUNK_SIZE/FETCH_BLOCK_SIZE)+top/FETCH_BLOCK_SIZE),cells=[{...seed,localIndex:(Math.floor(index/CHUNK_SIZE)-top)*block.width+index%CHUNK_SIZE-left}]
  for(let row=top;row<top+block.height;row++)for(let col=left;col<left+block.width;col++){
   const i=row*CHUNK_SIZE+col,word=i>>>5,bit=1<<(i&31);if(!(job.pending[word]&bit))continue
   job.pending[word]&=~bit;job.count--;if(job.visible[word]&bit)job.visibleCount--
   const cell=nativeCell(job.cx,job.cy,i);this.reserved.set(cell.key,{job,index:i});cells.push({...cell,localIndex:(row-top)*block.width+col-left})
  }
  for(let i=cells.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[cells[i],cells[j]]=[cells[j],cells[i]]}
  return {...block,cells}
 }
 completeBlock(block){for(const cell of block.cells)this.complete(cell)}
 retryBlock(block){for(const cell of block.cells)this.retry(cell)}
 complete(cell){if(this.reserved.delete(cell.key))this.completed++}
 retry(cell){
  const task=this.reserved.get(cell.key);if(!task)return
  this.reserved.delete(cell.key);const {job,index}=task,word=index>>>5,bit=1<<(index&31);job.pending[word]|=bit;job.count++;if(job.visible[word]&bit)job.visibleCount++
 }
}
