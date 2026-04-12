import { test, expect } from '@playwright/test'

const BASE_URL = 'http://localhost:4321'

test('SHADER DIAG: does #version 300 es shader compile in SwiftShader WebGL2?', async ({ page }) => {
  await page.goto(BASE_URL)
  await page.waitForLoadState('domcontentloaded')

  const result = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    const gl = canvas.getContext('webgl2')
    if (!gl) return { error: 'no webgl2' }

    const VERT = `#version 300 es
in vec2 position;
in vec2 texCoord;
uniform mat4 matrix;
out vec2 uv;
void main() {
  uv = texCoord;
  gl_Position = matrix * vec4(position, 0.0, 1.0);
}`

    const FRAG = `#version 300 es
precision mediump float;
uniform sampler2D chunkData;
uniform int layerType;
uniform float hue;
uniform float valueMin;
uniform float valueMax;
uniform float threshold;
in vec2 uv;
out vec4 fragColor;
void main() {
  float value = texture(chunkData, uv).r;
  fragColor = vec4(value, 0.0, 0.0, 1.0);
}`

    function compileShader(gl, type, src) {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, src)
      gl.compileShader(shader)
      const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS)
      const log = gl.getShaderInfoLog(shader)
      return { ok, log }
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG)

    return { vs, fs, isWebGL2: gl instanceof WebGL2RenderingContext }
  })

  console.log('SHADER DIAG result:', JSON.stringify(result))
  expect(result.vs.ok).toBe(true)
  expect(result.fs.ok).toBe(true)
})
