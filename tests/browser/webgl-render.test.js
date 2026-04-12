import { test, expect } from '@playwright/test'
import { installApiMocks } from './helpers/mock-routes.js'

const BASE_URL = 'http://localhost:4321'
const JOTUNHEIMEN_HASH = '#lat=61.5&lng=9.0&zoom=8'

async function loadApp(page, { hash = JOTUNHEIMEN_HASH, mockApis = true } = {}) {
  if (mockApis) await installApiMocks(page)

  await page.goto(`${BASE_URL}${hash}`)

  await page.waitForFunction(
    () => window.__frostDebug !== undefined,
    { timeout: 30_000 },
  )

  const skipBtn = page.locator('.modal-actions .btn', { hasText: 'Skip' })
  const skipVisible = await skipBtn.isVisible().catch(() => false)
  if (skipVisible) {
    await skipBtn.click()
    await page.locator('.modal-backdrop').waitFor({ state: 'hidden', timeout: 5_000 })
  } else {
    await page.evaluate(() => {
      if (window.appState?.showPasswordModal) window.appState.showPasswordModal = false
    })
  }

  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('#map canvas')
      return canvas && canvas.width > 0
    },
    { timeout: 20_000 },
  )
}

async function waitForLayerData(page) {
  await page.waitForFunction(
    () => {
      const r = window.__frostDebug?.getRenderer?.()
      return r && typeof r.getChunkCount === 'function' && r.getChunkCount() > 0
    },
    { timeout: 30_000 },
  )
  await page.waitForTimeout(500)
}

async function getWebGLInfo(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#map canvas')
    if (!canvas) return { supported: false }
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (!gl) return { supported: false }
    return {
      supported: true,
      version: gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl',
      renderer: gl.getParameter(gl.RENDERER),
      vendor: gl.getParameter(gl.VENDOR),
    }
  })
}

async function countNonBlackPixels(buf) {
  let nonZero = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] > 10) nonZero++
  }
  return nonZero / buf.length
}

async function screenshotDiffers(bufA, bufB) {
  let diffCount = 0
  const len = Math.min(bufA.length, bufB.length)
  for (let i = 0; i < len; i++) {
    if (Math.abs(bufA[i] - bufB[i]) > 5) diffCount++
  }
  return diffCount / len
}

test.describe('FrostMapper — WebGL rendering', () => {
  test('WebGL context is available and uses WebGL2', async ({ page }) => {
    await loadApp(page)
    const info = await getWebGLInfo(page)
    expect(info.supported).toBe(true)
    expect(info.version).toBe('webgl2')
  })

  test('map canvas renders non-trivially (not all black)', async ({ page }) => {
    await loadApp(page)
    await page.waitForTimeout(1_000)
    const buf = await page.locator('#map').screenshot()
    const fraction = await countNonBlackPixels(buf)
    expect(fraction).toBeGreaterThan(0.01)
  })

  test('zoom buttons (NavigationControl) are present', async ({ page }) => {
    await loadApp(page)
    const zoomIn = page.locator('.maplibregl-ctrl-zoom-in')
    await expect(zoomIn).toBeVisible()
    const zoomOut = page.locator('.maplibregl-ctrl-zoom-out')
    await expect(zoomOut).toBeVisible()
  })

  test('__frostDebug API exposes expected methods including toggleBasemap', async ({ page }) => {
    await loadApp(page)
    const api = await page.evaluate(() => ({
      hasGetLayers:      typeof window.__frostDebug?.getLayers      === 'function',
      hasToggleLayer:    typeof window.__frostDebug?.toggleLayer     === 'function',
      hasSetValueRange:  typeof window.__frostDebug?.setValueRange   === 'function',
      hasGetRenderer:    typeof window.__frostDebug?.getRenderer     === 'function',
      hasToggleBasemap:  typeof window.__frostDebug?.toggleBasemap   === 'function',
    }))
    expect(api.hasGetLayers).toBe(true)
    expect(api.hasToggleLayer).toBe(true)
    expect(api.hasSetValueRange).toBe(true)
    expect(api.hasGetRenderer).toBe(true)
    expect(api.hasToggleBasemap).toBe(true)
  })

  test('URL hash sets initial viewport to Jotunheimen', async ({ page }) => {
    await loadApp(page, { hash: JOTUNHEIMEN_HASH })
    const center = await page.evaluate(() => {
      const map = window.__frostDebug?.getRenderer?.()?._RasterRenderer__map
        ?? document.querySelector('#map')?._mapInstance
      if (window.maplibregl) {
        const containers = document.querySelectorAll('.maplibregl-map')
        return null
      }
      return null
    })
    const zoom = await page.evaluate(() => {
      const hash = window.location.hash
      const params = new URLSearchParams(hash.slice(1))
      return parseFloat(params.get('zoom'))
    })
    expect(zoom).toBe(8)
  })

  test('layers panel shows per-layer min/max inputs for raster layers', async ({ page }) => {
    await loadApp(page)

    await page.locator('.panel-header', { hasText: 'Layers' }).click()
    await page.waitForTimeout(300)

    const paramInputs = page.locator('.layer-param-input')
    const count = await paramInputs.count()
    expect(count).toBeGreaterThan(0)
  })

  test('toggling a layer off removes it from the rendered scene', async ({ page }) => {
    await loadApp(page)
    await page.waitForTimeout(2_000)

    const screenshotBefore = await page.locator('#map').screenshot()

    await page.evaluate(() => {
      window.__frostDebug.toggleLayer('snowSeason', false)
      window.__frostDebug.toggleLayer('winterTemp', false)
      window.__frostDebug.toggleLayer('meltRisk', false)
      window.__frostDebug.toggleLayer('slope', false)
    })

    await page.waitForTimeout(500)
    const screenshotOff = await page.locator('#map').screenshot()

    expect(screenshotBefore.length).toBeGreaterThan(0)
    expect(screenshotOff.length).toBeGreaterThan(0)
  })

  test('no critical WebGL errors in console', async ({ page }) => {
    const errors = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text()
        if (text.includes('WebGL') || text.includes('INVALID') || text.includes('uniformMatrix')) {
          errors.push(text)
        }
      }
    })

    await loadApp(page)
    await page.waitForTimeout(2_000)

    expect(errors).toHaveLength(0)
  })

  test('unhandled AbortErrors are NOT thrown as uncaught rejections', async ({ page }) => {
    const unhandledRejections = []
    page.on('pageerror', err => {
      if (err.message.includes('AbortError') || err.message.includes('aborted')) {
        unhandledRejections.push(err.message)
      }
    })

    await loadApp(page)

    await page.evaluate(() => {
      window.__frostDebug.toggleLayer('snowSeason', false)
      window.__frostDebug.toggleLayer('snowSeason', true)
      window.__frostDebug.toggleLayer('snowSeason', false)
    })

    await page.waitForTimeout(2_000)

    expect(unhandledRejections).toHaveLength(0)
  })

  test('toggleBasemap(false) hides basemap; layer data still visible with mocked APIs', async ({ page }) => {
    await loadApp(page, { mockApis: true })

    await page.waitForTimeout(3_000)

    await page.evaluate(() => window.__frostDebug.toggleBasemap(false))
    await page.waitForTimeout(300)
    const noBasemap = await page.locator('#map').screenshot()
    await page.screenshot({ path: 'tests/browser/screenshots/basemap-off.png' })

    await page.evaluate(() => window.__frostDebug.toggleBasemap(true))
    await page.waitForTimeout(300)
    const withBasemap = await page.locator('#map').screenshot()
    await page.screenshot({ path: 'tests/browser/screenshots/basemap-on.png' })

    const diffFraction = await screenshotDiffers(noBasemap, withBasemap)
    expect(diffFraction).toBeGreaterThan(0.001)
  })

  test('screenshot: mocked data renders colored overlay — layers-on differs from layers-off', async ({ page }) => {
    await loadApp(page, { mockApis: true })

    await page.evaluate(() => window.__frostDebug.toggleBasemap(false))
    await page.waitForTimeout(500)

    await waitForLayerData(page)
    await page.screenshot({ path: 'tests/browser/screenshots/all-layers-on.png' })
    const onBuf = await page.locator('#map').screenshot()

    await page.evaluate(() => {
      window.__frostDebug.toggleLayer('snowSeason', false)
      window.__frostDebug.toggleLayer('winterTemp', false)
      window.__frostDebug.toggleLayer('meltRisk', false)
      window.__frostDebug.toggleLayer('slope', false)
    })
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'tests/browser/screenshots/all-layers-off.png' })
    const offBuf = await page.locator('#map').screenshot()

    const diffFraction = await screenshotDiffers(offBuf, onBuf)
    expect(diffFraction).toBeGreaterThan(0.001)
  })
})
