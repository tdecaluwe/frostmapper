/**
 * Layer panel UI component.
 *
 * Renders layer toggles with hue dot, inline progress bar,
 * and error states in the accordion panel.
 */

import { getSource } from '../core/cache.js';
import { getKey } from '../core/crypto.js';

/**
 * Create the layer panel Vue component definition.
 */
export function createLayerPanel(layers, appState) {
  return {
    name: 'LayerPanel',
    template: `
      <div class="panel">
        <div class="panel-header" @click="$emit('toggle-panel', 'layers')">
          <span>Layers</span>
          <span class="chevron" :class="{ open: open }">&#9654;</span>
        </div>
        <div class="panel-body" v-if="open">
          <div
            v-for="layer in layers"
            :key="layer.id"
            class="layer-row"
            :class="{ disabled: layer._error }"
          >
            <span
              class="layer-dot"
              :style="{ background: layer.type === 'annotation' ? '#888' : dotColor(layer) }"
            ></span>
            <input
              type="checkbox"
              class="layer-toggle"
              :checked="layer._active"
              :disabled="layer._error && !layer._errorAction"
              @change="toggleLayer(layer, $event.target.checked)"
            />
            <span class="layer-name">{{ layer.label || layer.id }}</span>
            <button
              v-if="layer._error && layer._errorAction"
              class="layer-error-btn"
              @click="layer._errorAction()"
            >
              {{ layer._errorLabel || 'Fix' }}
            </button>
          </div>
          <div
            v-for="layer in activeLayers"
            :key="'progress-' + layer.id"
            style="margin-top: 4px;"
          >
            <div style="font-size: 10px; opacity: 0.5; margin-bottom: 2px;">
              {{ layer.label || layer.id }}
            </div>
            <div class="layer-progress">
              <div
                class="layer-progress-bar"
                :style="{
                  width: (layer._progress || 0) + '%',
                  background: dotColor(layer),
                }"
              ></div>
            </div>
          </div>
        </div>
      </div>
    `,

    props: {
      open: Boolean,
    },

    emits: ['toggle-panel'],

    data() {
      return { layers };
    },

    computed: {
      activeLayers() {
        return this.layers.filter(l => l._active && !l._error);
      },
    },

    methods: {
      dotColor(layer) {
        if (layer.type === 'hard-filter') return '#888';
        const hue = layer.hue ?? 200;
        return `hsl(${hue}, 80%, 55%)`;
      },

      toggleLayer(layer, active) {
        layer._active = active;
        if (appState.map) {
          layer.toggle(appState.map, active);
          if (active) {
            layer.update(appState.map, appState.viewport, appState.globalParams);
          }
        }
      },
    },
  };
}
