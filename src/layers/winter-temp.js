import { RasterLayer } from '../core/layer.js'

export class WinterTempLayer extends RasterLayer {
  get layerType()  { return 'soft-filter' }
  get hue()        { return 30 }
  get valueRange() { return this.params.valueRange }
  get threshold()  { return 0 }
}
