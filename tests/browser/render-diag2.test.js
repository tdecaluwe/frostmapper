import { test, expect } from '@playwright/test'
import { installApiMocks } from './helpers/mock-routes.js'

const BASE_URL = 'http://localhost:4321'
const JOTUNHEIMEN_HASH = '#lat=61.5&lng=9.0&zoom=8'

test('RENDER-DIAG2: inspect chunk data and pixel values', async ({ page }) => {
  const errors = []
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', err => errors.push('pageerror: ' + err.message))

  await installApiMocks(page)
  await page.goto(`${BASE_URL}${JOTUNHEIMEN_HASH}`)
  await page.waitForFunction(() => window.__frostDebug !== undefined, { timeout: 30_000 })

  const skipBtn = page.locator('.modal-actions .btn', { hasText: 'Skip' })
  const skipVisible = await skipBtn.isVisible().catch(() => false)
  if (skipVisible) {
    await skipBtn.click()
    await page.locator('.modal-backdrop').waitFor({ state: 'hidden', timeout: 5_000 })
  }

  await page.waitForFunction(() => {
    const canvas = document.querySelector('#map canvas')
    return canvas && canvas.width > 0
  }, { timeout: 20_000 })

  await page.waitForFunction(() => {
    const r = window.__frostDebug?.getRenderer?.()
    return r && typeof r.getChunkCount === 'function' && r.getChunkCount() > 0
  }, { timeout: 30_000 })

  await page.waitForTimeout(1000)

  const info = await page.evaluate(() => {
    const r = window.__frostDebug?.getRenderer?.()
    const layers = window.__frostDebug?.getLayers?.()

    const chunkInfo = []
    const chunks = r?._RasterRenderer__globalChunks ?? []
    for (const c of chunks.slice(0, 3)) {
      const p = c.getParams?.()
      chunkInfo.push({
        layerId: c.layerId,
        vertexCount: c.vertexCount,
        params: p ? { enabled: p.enabled, hue: p.hue, valueMin: p.valueRange?.from, valueMax: p.valueRange?.to, layerType: p.layerType } : null,
      })
    }

    const snowLayer = layers?.snowSeason
    const params = snowLayer?.params
    return {
      chunkCount: r?.getChunkCount?.() ?? -1,
      chunks: chunkInfo,
      snowParams: params ? { enabled: params.enabled, hue: params.hue, valueMin: params.valueRange?.from, valueMax: params.valueRange?.to, layerType: params.layerType } : null,
    }
  })
  console.log('CHUNK INFO:', JSON.stringify(info, null, 2))

  const withBasemap = await page.locator('#map').screenshot()
  await page.screenshot({ path: 'tests/browser/screenshots/diag2-basemap-on.png' })

  await page.evaluate(() => window.__frostDebug.toggleBasemap(false))
  await page.waitForTimeout(500)
  const noBasemap = await page.locator('#map').screenshot()
  await page.screenshot({ path: 'tests/browser/screenshots/diag2-basemap-off.png' })

  let nonZeroBasemapOff = 0
  for (let i = 0; i < noBasemap.length; i++) {
    if (noBasemap[i] > 10) nonZeroBasemapOff++
  }

  let diffCount = 0
  const len = Math.min(withBasemap.length, noBasemap.length)
  for (let i = 0; i < len; i++) {
    if (Math.abs(withBasemap[i] - noBasemap[i]) > 5) diffCount++
  }

  console.log('basemap-off non-zero pixel fraction:', nonZeroBasemapOff / noBasemap.length)
  console.log('basemap-on vs basemap-off diff fraction:', diffCount / len)
  console.log('errors:', JSON.stringify(errors.slice(0, 10)))

  expect(info.chunkCount).toBeGreaterThan(0)
  expect(errors).toHaveLength(0)
})
