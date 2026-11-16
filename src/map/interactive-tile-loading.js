import ViewHint from 'ol/ViewHint.js'

// OpenLayers 10.6.1 does not expose a load-while-interacting option. Its map
// tile queue otherwise stops starting tiles when an interaction frame takes
// more than 8ms. Keep the normal interaction limit (8 active, 2 new per frame)
// while measuring that limit from the post-render time instead of frame start.
export function enableTileLoadingWhileInteracting(map){
 const handlePostRender=map.handlePostRender
 map.handlePostRender=function(...args){
  const frameState=this.frameState_
  if(!frameState?.viewHints[ViewHint.INTERACTING])return handlePostRender.apply(this,args)
  const frameTime=frameState.time
  frameState.time=Date.now()
  try{return handlePostRender.apply(this,args)}finally{frameState.time=frameTime}
 }
}
