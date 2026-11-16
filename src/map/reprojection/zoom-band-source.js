import {guardReprojection} from '../layers/reprojection-budget.js?v=contour-bands'

// Shared source integration for XYZ and WMTS; the manager owns the atlas and
// source-tile assembler, while the guard bounds each ReprojTile stitch.
export function ZoomBandSource(Base){
 return class extends Base {
  constructor(options){super(options);guardReprojection(this)}
  configureZoomBands(manager){manager.addSource(this)}
 }
}
