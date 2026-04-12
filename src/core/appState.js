function getReactive() {
  if (typeof window !== 'undefined' && window.Vue) return window.Vue.reactive
  return (obj) => obj
}

const reactive = getReactive()

export const appState = reactive({
  timePeriod:    20,
  winterPeriod:  { start: '12-01', end: '03-31' },
  percentile:    25,
  snowThreshold: 10,
  keyStoreState: 'uninitialised',

  openPanel:         null,
  showPasswordModal: false,
  passwordModalMode: 'unlock',
  editingKeyId:      null,
  pendingKeyId:      null,
  passwordError:     null,
  keyStatus:         { lantmateriet: false, openrouteservice: false },
})
