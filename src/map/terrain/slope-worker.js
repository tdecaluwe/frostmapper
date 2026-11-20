import {shadeSlope,terrariumElevation} from './slope.js?v=palette-v2'

const cache=new Map(),MAX_ELEVATION_TILES=32
async function elevation(z,x,y){
 const n=2**z;x=((x%n)+n)%n;y=Math.max(0,Math.min(n-1,y))
 const key=`${z}/${x}/${y}`
 if(cache.has(key)){const result=cache.get(key);cache.delete(key);cache.set(key,result);return result}
 const pending=(async()=>{
  const response=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`)
  if(!response.ok)throw Error(`Elevation tile: HTTP ${response.status}`)
  const bitmap=await createImageBitmap(await response.blob(),{colorSpaceConversion:'none',premultiplyAlpha:'none'})
  try{
   if(bitmap.width!==256||bitmap.height!==256)throw Error('Unexpected elevation tile dimensions')
   const context=new OffscreenCanvas(256,256).getContext('2d',{willReadFrequently:true})
   context.drawImage(bitmap,0,0)
   const rgba=context.getImageData(0,0,256,256).data,heights=new Float32Array(256*256)
   for(let i=0;i<heights.length;i++)heights[i]=rgba[i*4+3]?terrariumElevation(rgba[i*4],rgba[i*4+1],rgba[i*4+2]):NaN
   return heights
  }finally{bitmap.close()}
 })()
 cache.set(key,pending)
 while(cache.size>MAX_ELEVATION_TILES)cache.delete(cache.keys().next().value)
 try{return await pending}catch(error){cache.delete(key);throw error}
}
async function render({id,z,x,y}){
 try{
  const heights=await Promise.all([[x,y],[x-1,y],[x+1,y],[x,y-1],[x,y+1]].map(([tx,ty])=>elevation(z,tx,ty)))
  const pixels=shadeSlope(...heights,z,y),canvas=new OffscreenCanvas(256,256),ctx=canvas.getContext('2d')
  ctx.putImageData(new ImageData(pixels,256,256),0,0)
  self.postMessage({id,blob:await canvas.convertToBlob({type:'image/png'})})
 }catch(error){self.postMessage({id,error:error.message})}
}
// One active render bounds decoded working memory and concurrent terrain fetches.
let queue=Promise.resolve()
self.onmessage=({data})=>{queue=queue.then(()=>render(data))}
