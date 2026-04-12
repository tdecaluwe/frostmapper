/**
 * Progress indicator — per-source viewport loading indicators.
 *
 * Shows progress as proportion of chunks loaded for current viewport.
 */

import { getSource } from '../core/cache.js';
import { targetStride } from '../core/map.js';

/**
 * Update progress percentage for a layer based on its source cache state.
 */
export function updateLayerProgress(layer, viewport, params) {
  const source = getSource(layer.source);
  if (!source || !source.progress) {
    layer._progress = 0;
    return;
  }

  const baseRes = source.baseResolution || 0.009;
  const stride = targetStride(baseRes, viewport.zoom);

  const { loaded, total } = source.progress(viewport.bounds, stride, params);
  layer._progress = total > 0 ? Math.round((loaded / total) * 100) : 0;
}

/**
 * Update progress for all active layers.
 */
export function updateAllProgress(layers, viewport, params) {
  for (const layer of layers) {
    if (layer._active) {
      updateLayerProgress(layer, viewport, params);
    }
  }
}
