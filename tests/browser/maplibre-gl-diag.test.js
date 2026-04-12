import { test, expect } from '@playwright/test'

const BASE_URL = 'http://localhost:4321'
const JOTUNHEIMEN_HASH = '#lat=61.5&lng=9.0&zoom=8'

test('MAPLIBRE DIAG: what GL context does MapLibre pass to custom layer onAdd?', async ({ page }) => {
  const errors = []
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  await page.goto(`${BASE_URL}${JOTUNHEIMEN_HASH}`)
  
  const result = await page.evaluate(() => {
    return new Promise((resolve) => {
      if (!window.maplibregl) return resolve({ error: 'no maplibregl' })

      const container = document.createElement('div')
      container.style.cssText = 'width:400px;height:300px;position:absolute;left:-9999px'
      document.body.appendChild(container)
      
      const map = new window.maplibregl.Map({
        container,
        style: { version: 8, sources: {}, layers: [] },
        center: [9, 61.5],
        zoom: 8,
      })

      let glInfo = null
      const testLayer = {
        id: 'test-layer',
        type: 'custom',
        onAdd(m, gl) {
          glInfo = {
            isWebGL2: gl instanceof WebGL2RenderingContext,
            isWebGL1: gl instanceof WebGLRenderingContext,
            version: gl.getParameter(gl.VERSION),
            shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
          }

          const FRAG = `#version 300 es
precision mediump float;
uniform sampler2D chunkData;
in vec2 uv;
out vec4 fragColor;
void main() {
  fragColor = vec4(1.0, 0.0, 0.0, 1.0);
}`
          const shader = gl.createShader(gl.FRAGMENT_SHADER)
          gl.shaderSource(shader, FRAG)
          gl.compileShader(shader)
          glInfo.shaderOk = gl.getShaderParameter(shader, gl.COMPILE_STATUS)
          glInfo.shaderLog = gl.getShaderInfoLog(shader)
        },
        render() {},
      }

      map.on('load', () => {
        map.addLayer(testLayer)
        setTimeout(() => resolve({ glInfo }), 500)
      })
      
      map.on('error', e => resolve({ error: e.message ?? String(e) }))
      
      setTimeout(() => resolve({ timeout: true, glInfo }), 10000)
    })
  })

  console.log('MAPLIBRE GL DIAG:', JSON.stringify(result))
  expect(result.error).toBeUndefined()
  expect(result.glInfo).toBeTruthy()
  expect(result.glInfo.shaderOk).toBe(true)
})
