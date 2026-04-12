import { RasterLayer } from '../core/layer.js'

export class SlopeLayer extends RasterLayer {
  get layerType()  { return 'hard-filter' }
  get hue()        { return 0 }
  get valueRange() { return { from: 0, to: 1 } }
  get threshold()  { return this.params.slopeThreshold }

  async update(viewport, signal) {
    if (viewport.zoom < 10) return
    return super.update(viewport, signal)
  }
}
