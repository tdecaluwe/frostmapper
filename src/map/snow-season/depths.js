export const SNOW_DEPTHS_CM=Object.freeze([0,5,10,15,20])
export function depthIndex(cm=0){
 const index=SNOW_DEPTHS_CM.indexOf(cm)
 if(index<0)throw new RangeError('Snow depth must be 0, 5, 10, 15 or 20 cm')
 return index
}
// 0=bare, 1=>0–<5 cm, 2=5–<10, ..., 5=20+.
// SWE can establish positive snow without establishing a depth: state 6.
export const POSITIVE_DEPTH_UNKNOWN=6,DEPTH_UNKNOWN=7
export function snowDepthBand(cm){
 return !Number.isFinite(cm)||cm<0||cm===65535?DEPTH_UNKNOWN:cm===0?0:Math.min(5,1+Math.floor(cm/5))
}
