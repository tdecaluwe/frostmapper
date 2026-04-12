import { RasterLayer } from '../core/layer.js'

export class MeltRiskLayer extends RasterLayer {
  get layerType()  { return 'soft-filter' }
  get hue()        { return 0 }
  get valueRange() { return this.params.valueRange }
  get threshold()  { return 0 }
}
