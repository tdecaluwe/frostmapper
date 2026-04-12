import { RasterLayer } from '../core/layer.js'

export class SnowSeasonLayer extends RasterLayer {
  get layerType()  { return 'soft-filter' }
  get hue()        { return 200 }
  get valueRange() { return this.params.valueRange }
  get threshold()  { return 0 }
}
