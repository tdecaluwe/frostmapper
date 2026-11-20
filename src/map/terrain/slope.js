// HSV: evenly spaced hues from blue-green (165°) to purple (285°).
export const SLOPE_BANDS=Array.from({length:7},(_,i)=>{
 const hue=165+i*20,saturation=.9,value=.9,c=value*saturation
 const h=hue/60,x=c*(1-Math.abs(h%2-1)),m=value-c
 const rgb=h<3?[0,c,x]:h<4?[0,x,c]:[x,0,c]
 return {minimum:15+i*5,label:i===6?'45°+':`${15+i*5}–${20+i*5}°`,color:rgb.map(v=>Math.round((v+m)*255))}
})
export function slopeBand(degrees){return degrees<15?-1:Math.min(6,Math.floor((degrees-15)/5))}
export function terrariumElevation(r,g,b){return r*256+g+b/256-32768}
const EARTH_RADIUS=6378137
export function groundSpacing(z,row){
 const world=2*Math.PI*EARTH_RADIUS,pixelResolution=world/(256*2**z)
 const mercatorY=world/2-(row+.5)*pixelResolution
 return pixelResolution/Math.cosh(mercatorY/EARTH_RADIUS)
}
export function slopeDegrees(left,right,up,down,spacing){
 return Math.atan(Math.hypot(right-left,down-up)/(2*spacing))*180/Math.PI
}
// A one-pixel halo ensures adjacent tiles calculate the same derivative.
export function shadeSlope(center,west,east,north,south,z,tileY){
 const output=new Uint8ClampedArray(256*256*4)
 for(let y=0;y<256;y++){
  const spacing=groundSpacing(z,tileY*256+y)
  for(let x=0;x<256;x++){
   const i=y*256+x
   const left=x?center[i-1]:west[y*256+255],right=x<255?center[i+1]:east[y*256]
   const up=y?center[i-256]:north[255*256+x],down=y<255?center[i+256]:south[x]
   if(![left,right,up,down].every(Number.isFinite))continue
   const band=slopeBand(slopeDegrees(left,right,up,down,spacing))
   if(band<0)continue
   output.set(SLOPE_BANDS[band].color,i*4);output[i*4+3]=255
  }
 }
 return output
}
