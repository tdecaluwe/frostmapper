/**
 * FrostMapper — Geo Scouting Tool
 *
 * Main application entry point.
 * Initialises the map, registers sources and layers, mounts the Vue UI.
 */

import { createApp, reactive } from 'vue';
import { initMap, getMap, viewport, onViewportChange, addLantmaterietSource } from './core/map.js';
import { registerSource, getSource } from './core/cache.js';
import { createQueues } from './core/queue.js';
import {
  hasKeystore, initKeystore, unlockKeystore,
  getKey, setKey, isUnlocked, keyStatus
} from './core/crypto.js';

// ── Sources ──
import seNorgeSnow from './sources/seNorge-snow.js';
import ngcdTempMean from './sources/ngcd-temp-mean.js';
import ngcdTempMax from './sources/ngcd-temp-max.js';
import glo30Elevation from './sources/glo30-elevation.js';
import snowSeason from './sources/snow-season.js';
import meltRisk from './sources/melt-risk.js';
import slope from './sources/slope.js';
import roadAccess from './sources/road-access.js';
import transportStops from './sources/transport-stops.js';
import airports from './sources/airports.js';
import isochrones from './sources/isochrones.js';

// ── Layers ──
import snowSeasonLayer from './layers/snow-season.js';
import winterTempLayer from './layers/winter-temp.js';
import meltRiskLayer from './layers/melt-risk.js';
import slopeLayer from './layers/slope.js';
import elevationLayer from './layers/elevation.js';
import roadAccessLayer from './layers/road-access.js';
import transportStopsLayer from './layers/transport-stops.js';
import isochronesLayer from './layers/isochrones.js';

// ── Initialise queues ──
const queues = createQueues();

// ── Register all sources ──
const sources = [
  seNorgeSnow, ngcdTempMean, ngcdTempMax, glo30Elevation,
  snowSeason, meltRisk, slope, roadAccess,
  transportStops, airports, isochrones,
];

for (const source of sources) {
  registerSource(source, queues);
}

// ── Layer definitions with display metadata ──
const layers = [
  { ...snowSeasonLayer, label: 'Snow Season Length', _active: false, _progress: 0, _error: null },
  { ...winterTempLayer, label: 'Winter Temperature', _active: false, _progress: 0, _error: null },
  { ...meltRiskLayer, label: 'Melt Risk Days', _active: false, _progress: 0, _error: null },
  { ...slopeLayer, label: 'Average Slope', _active: false, _progress: 0, _error: null },
  { ...elevationLayer, label: 'Elevation', _active: false, _progress: 0, _error: null },
  { ...roadAccessLayer, label: 'Road Accessibility', _active: false, _progress: 0, _error: null },
  { ...transportStopsLayer, label: 'Transport Stops', _active: false, _progress: 0, _error: null },
  { ...isochronesLayer, label: 'Travel Isochrones', _active: false, _progress: 0, _error: null,
    _errorCheck: () => !getKey('openrouteservice') ? 'key' : null },
];

// ── Reactive application state ──
const state = reactive({
  openPanel: null,       // 'layers' | 'settings' | 'keys' | null
  showPasswordModal: false,
  passwordModalMode: 'unlock',   // 'unlock' | 'init' | 'key'
  editingKeyId: null,
  passwordError: null,
  keyStatus: { lantmateriet: false, openrouteservice: false },

  globalParams: {
    timePeriod: 20,
    winterStart: '12-01',
    winterEnd: '03-31',
    percentile: 25,
    snowThreshold: 10,
    startYear: 2006,
    endYear: 2025,
  },

  layers,
});

// ── Vue App ──
const app = createApp({
  data() {
    return { state };
  },

  computed: {
    activeLayers() {
      return this.state.layers.filter(l => l._active);
    },
  },

  methods: {
    togglePanel(name) {
      this.state.openPanel = this.state.openPanel === name ? null : name;
    },

    toggleLayer(layer, active) {
      layer._active = active;
      const map = getMap();
      if (!map) return;

      // Check for API key requirements
      if (active && layer._errorCheck) {
        const err = layer._errorCheck();
        if (err) {
          layer._error = err;
          layer._active = false;
          return;
        }
      }

      layer._error = null;
      layer.toggle(map, active);

      if (active) {
        this.updateLayer(layer);
      }
    },

    async updateLayer(layer) {
      const map = getMap();
      if (!map || !layer._active) return;

      try {
        await layer.update(map, viewport, this.computeLayerParams(layer));
      } catch (err) {
        console.error(`Layer ${layer.id} update error:`, err);
        layer._error = 'fetch';
      }
    },

    computeLayerParams(layer) {
      const gp = this.state.globalParams;
      return {
        ...layer.defaultParams,
        startYear: gp.endYear - gp.timePeriod + 1,
        endYear: gp.endYear,
        winterStart: gp.winterStart,
        winterEnd: gp.winterEnd,
        percentile: gp.percentile,
        threshold: gp.snowThreshold,
      };
    },

    updateAllActiveLayers() {
      for (const layer of this.state.layers) {
        if (layer._active) {
          this.updateLayer(layer);
        }
      }
    },

    changeSetting(key, value) {
      this.state.globalParams[key] = value;
      // Recalculate start year based on time period
      if (key === 'timePeriod') {
        this.state.globalParams.startYear = this.state.globalParams.endYear - value + 1;
      }
      this.updateAllActiveLayers();
    },

    // ── Password / key management ──
    showPasswordPrompt(mode = 'unlock', keyId = null) {
      this.state.passwordModalMode = mode;
      this.state.editingKeyId = keyId;
      this.state.showPasswordModal = true;
      this.state.passwordError = null;
    },

    async handlePasswordSubmit(password) {
      const mode = this.state.passwordModalMode;

      try {
        if (mode === 'init') {
          await initKeystore(password);
        } else if (mode === 'unlock') {
          await unlockKeystore(password);
        }

        this.state.keyStatus = keyStatus();
        this.state.showPasswordModal = false;
        this.state.passwordError = null;

        // Apply Lantmäteriet token if available
        const lmToken = getKey('lantmateriet');
        if (lmToken) {
          addLantmaterietSource(lmToken);
        }

        // Check layer error states
        for (const layer of this.state.layers) {
          if (layer._errorCheck) {
            layer._error = layer._errorCheck();
          }
        }
      } catch (err) {
        this.state.passwordError = err.message;
      }
    },

    async handleKeySubmit(keyId, keyValue) {
      if (!isUnlocked()) {
        this.showPasswordPrompt('unlock');
        return;
      }

      try {
        await setKey(keyId, keyValue);
        this.state.keyStatus = keyStatus();

        if (keyId === 'lantmateriet') {
          addLantmaterietSource(keyValue);
        }

        // Clear errors for affected layers
        for (const layer of this.state.layers) {
          if (layer._errorCheck) {
            layer._error = layer._errorCheck();
          }
        }

        this.state.showPasswordModal = false;
      } catch (err) {
        this.state.passwordError = err.message;
      }
    },

    showKeyInput(keyId) {
      if (!isUnlocked()) {
        this.showPasswordPrompt('unlock');
        return;
      }
      this.state.passwordModalMode = 'key';
      this.state.editingKeyId = keyId;
      this.state.showPasswordModal = true;
      this.state.passwordError = null;
    },

    dotColor(layer) {
      if (layer.type === 'hard-filter') return '#888';
      if (layer.type === 'annotation') return '#aaa';
      return `hsl(${layer.hue ?? 200}, 80%, 55%)`;
    },
  },

  mounted() {
    // Initialise the map
    const map = initMap('map');

    map.on('load', () => {
      // Prompt for master password
      if (hasKeystore()) {
        this.showPasswordPrompt('unlock');
      } else {
        this.showPasswordPrompt('init');
      }
    });

    // Update layers on viewport change
    let updateTimer = null;
    onViewportChange(() => {
      clearTimeout(updateTimer);
      updateTimer = setTimeout(() => {
        this.updateAllActiveLayers();
      }, 300); // Debounce
    });
  },

  template: `
      <!-- Layers Panel -->
      <div class="panel">
        <div class="panel-header" @click="togglePanel('layers')">
          <span>◉ Layers</span>
          <span class="chevron" :class="{ open: state.openPanel === 'layers' }">&#9654;</span>
        </div>
        <div class="panel-body" v-if="state.openPanel === 'layers'">
          <div
            v-for="layer in state.layers"
            :key="layer.id"
            class="layer-row"
            :class="{ disabled: !!layer._error }"
          >
            <span
              class="layer-dot"
              :style="{ background: dotColor(layer), opacity: layer._active ? 1 : 0.3 }"
            ></span>
            <input
              type="checkbox"
              class="layer-toggle"
              :checked="layer._active"
              @change="toggleLayer(layer, $event.target.checked)"
            />
            <span class="layer-name">{{ layer.label }}</span>
            <button
              v-if="layer._error === 'key'"
              class="layer-error-btn"
              @click.stop="showKeyInput(layer.requiresKey || 'openrouteservice')"
            >
              Add key
            </button>
            <span v-if="layer._error === 'fetch'" class="layer-error-btn" style="cursor:default;">Error</span>
          </div>

          <!-- Progress bars for active layers -->
          <template v-for="layer in activeLayers" :key="'p-'+layer.id">
            <div style="margin-top: 4px;">
              <div style="font-size:10px; opacity:0.5; margin-bottom:2px;">{{ layer.label }}</div>
              <div class="layer-progress">
                <div
                  class="layer-progress-bar"
                  :style="{ width: layer._progress + '%', background: dotColor(layer) }"
                ></div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- Settings Panel -->
      <div class="panel">
        <div class="panel-header" @click="togglePanel('settings')">
          <span>⚙ Settings</span>
          <span class="chevron" :class="{ open: state.openPanel === 'settings' }">&#9654;</span>
        </div>
        <div class="panel-body" v-if="state.openPanel === 'settings'">
          <div class="setting-row">
            <span class="setting-label">Time period (years)</span>
            <input class="setting-input" type="number" min="1" max="60"
              :value="state.globalParams.timePeriod"
              @change="changeSetting('timePeriod', parseInt($event.target.value))" />
          </div>
          <div class="setting-row">
            <span class="setting-label">Winter start</span>
            <input class="setting-input" type="text" placeholder="MM-DD"
              :value="state.globalParams.winterStart"
              @change="changeSetting('winterStart', $event.target.value)" />
          </div>
          <div class="setting-row">
            <span class="setting-label">Winter end</span>
            <input class="setting-input" type="text" placeholder="MM-DD"
              :value="state.globalParams.winterEnd"
              @change="changeSetting('winterEnd', $event.target.value)" />
          </div>
          <div class="setting-row">
            <span class="setting-label">Percentile</span>
            <input class="setting-input" type="number" min="1" max="99"
              :value="state.globalParams.percentile"
              @change="changeSetting('percentile', parseInt($event.target.value))" />
          </div>
          <div class="setting-row">
            <span class="setting-label">Snow threshold (cm)</span>
            <select class="setting-input" style="width:auto;"
              :value="state.globalParams.snowThreshold"
              @change="changeSetting('snowThreshold', parseInt($event.target.value))">
              <option value="5">5 cm</option>
              <option value="10">10 cm</option>
              <option value="15">15 cm</option>
              <option value="20">20 cm</option>
            </select>
          </div>
        </div>
      </div>

      <!-- API Keys Panel -->
      <div class="panel">
        <div class="panel-header" @click="togglePanel('keys')">
          <span>🔑 API Keys</span>
          <span class="chevron" :class="{ open: state.openPanel === 'keys' }">&#9654;</span>
        </div>
        <div class="panel-body" v-if="state.openPanel === 'keys'">
          <div class="setting-row">
            <span class="setting-label">Lantmäteriet</span>
            <span :class="['key-status', state.keyStatus.lantmateriet ? 'set' : 'missing']">
              {{ state.keyStatus.lantmateriet ? 'Set' : 'Missing' }}
            </span>
            <button class="btn" style="margin-left:8px;" @click="showKeyInput('lantmateriet')">
              {{ state.keyStatus.lantmateriet ? 'Update' : 'Set' }}
            </button>
          </div>
          <div class="setting-row">
            <span class="setting-label">OpenRouteService</span>
            <span :class="['key-status', state.keyStatus.openrouteservice ? 'set' : 'missing']">
              {{ state.keyStatus.openrouteservice ? 'Set' : 'Missing' }}
            </span>
            <button class="btn" style="margin-left:8px;" @click="showKeyInput('openrouteservice')">
              {{ state.keyStatus.openrouteservice ? 'Update' : 'Set' }}
            </button>
          </div>
        </div>
      </div>

    <!-- Master password / key input modal -->
    <div class="modal-backdrop" v-if="state.showPasswordModal" @click.self="state.showPasswordModal = false">
      <div class="modal">
        <h3 v-if="state.passwordModalMode === 'init'">Create Master Password</h3>
        <h3 v-else-if="state.passwordModalMode === 'unlock'">Unlock Keystore</h3>
        <h3 v-else>{{ state.editingKeyId === 'lantmateriet' ? 'Lantmäteriet Token' : 'OpenRouteService Key' }}</h3>

        <p v-if="state.passwordModalMode === 'init'" style="font-size:12px; opacity:0.7; margin-bottom:12px;">
          Choose a master password to encrypt your API keys locally.
        </p>

        <p v-if="state.passwordError" style="color:#ff6666; font-size:12px; margin-bottom:8px;">
          {{ state.passwordError }}
        </p>

        <template v-if="state.passwordModalMode !== 'key'">
          <input
            type="password"
            placeholder="Master password"
            @keydown.enter="handlePasswordSubmit($event.target.value)"
            ref="passwordInput"
          />
          <div class="modal-actions">
            <button class="btn" @click="state.showPasswordModal = false">Skip</button>
            <button class="btn btn-primary" @click="handlePasswordSubmit($refs.passwordInput?.value)">
              {{ state.passwordModalMode === 'init' ? 'Create' : 'Unlock' }}
            </button>
          </div>
        </template>

        <template v-else>
          <input
            type="text"
            :placeholder="state.editingKeyId === 'lantmateriet' ? 'Paste token...' : 'Paste API key...'"
            @keydown.enter="handleKeySubmit(state.editingKeyId, $event.target.value)"
            ref="keyInput"
          />
          <div class="modal-actions">
            <button class="btn" @click="state.showPasswordModal = false">Cancel</button>
            <button class="btn btn-primary" @click="handleKeySubmit(state.editingKeyId, $refs.keyInput?.value)">
              Save
            </button>
          </div>
        </template>
      </div>
    </div>
  `,
});

app.mount('#app-overlay');
