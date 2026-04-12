export function parseViewportHash(hash) {
  if (!hash) return null
  const str = hash.startsWith('#') ? hash.slice(1) : hash
  const params = new URLSearchParams(str)
  const lat  = parseFloat(params.get('lat'))
  const lng  = parseFloat(params.get('lng'))
  const zoom = parseFloat(params.get('zoom'))
  if (isNaN(lat) || isNaN(lng) || isNaN(zoom)) return null
  return { center: [lng, lat], zoom }
}

export function toggleLayerWithRenderer(layer, active, renderer) {
  layer.params.enabled = active
  if (active) {
    renderer.refreshLayer(layer.id)
  } else {
    renderer.clearLayer(layer.id)
  }
}
