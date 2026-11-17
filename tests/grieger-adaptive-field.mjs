import {project} from './grieger-projection-field.mjs'
import {finiteDifferenceScale} from '../src/map/reprojection/finite-difference-scale.js'
import {HORIZONTAL_HALF_HEIGHT as K} from '../src/map/projections/peirce-horizontal.js'
const R=6378137,W=2*Math.PI*R,TW=4*K*R
export function griegerField([u,v]){
 const value=finiteDifferenceScale([(u-.5)*W,(v-.5)*W],{sample:p=>project(...p),step:Number(process.env.FD_STEP||100),worldWidth:TW,curvatureTolerance:Number(process.env.FD_CURVATURE||.02)})
 return value===null?NaN:-value
}

// Same finite-only domain as the reference, with a single fixed stencil.
export function griegerFixedRawField([u,v]){
 const value=finiteDifferenceScale([(u-.5)*W,(v-.5)*W],{sample:p=>project(...p),worldWidth:TW,maxRefinements:0,curvatureTolerance:1e100})
 return value===null?NaN:-value
}
