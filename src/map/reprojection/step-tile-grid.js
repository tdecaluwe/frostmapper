import TileGrid from 'ol/tilegrid/TileGrid.js'

// OL 10.6.1 validates strictly decreasing resolutions. Construct with logical
// resolutions, then install repeated physical resolutions and rebuild ranges.
// All extent/range calculations use physical resolution; only level selection
// uses the continuous logical scale. Keep this adapter isolated from OL internals.
export class StepTileGrid extends TileGrid {
 constructor(base,steps=4){
  if(!Number.isInteger(steps)||steps<1)throw Error('Invalid step count')
  const count=base.getResolutions().length*steps,r0=base.getResolution(0)
  super({extent:base.getExtent(),origin:base.getOrigin(0),tileSize:base.getTileSize(0),resolutions:Array.from({length:count},(_,z)=>r0*2**(-z/steps))})
  this.steps=steps;this.logicalResolutions=this.resolutions_
  this.resolutions_=Array.from({length:count},(_,z)=>base.getResolution(Math.floor(z/steps)))
  this.zoomFactor_=undefined
  if(this.getExtent())this.calculateTileRanges_(this.getExtent())
 }
 getZForResolution(resolution){
  return Math.max(this.getMinZoom(),Math.min(this.getMaxZoom(),Math.floor(this.steps*Math.log2(this.logicalResolutions[0]/resolution)+1e-10)))
 }
 phase(z){return (z%this.steps)/this.steps}
}
