import { test, expect } from '@playwright/test'
import { installApiMocks } from './helpers/mock-routes.js'

const BASE_URL = 'http://localhost:4321'
const JOTUNHEIMEN_HASH = '#lat=61.5&lng=9.0&zoom=8'

test('COORD-DIAG: what coordinate space does MapLibre matrix expect?', async ({ page }) => {
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

  const info = await page.evaluate(() => {
    const MapLibre = window.maplibregl
    if (!MapLibre) return { error: 'no maplibregl' }

    const MercatorCoordinate = MapLibre.MercatorCoordinate
    if (!MercatorCoordinate) return { error: 'no MercatorCoordinate' }

    const coord = MercatorCoordinate.fromLngLat({ lng: 9.0, lat: 61.5 })
    return {
      mercatorX: coord.x,
      mercatorY: coord.y,
      mercatorZ: coord.z,
      meterInMercatorUnits: coord.meterInMercatorUnits ? coord.meterInMercatorUnits() : 'n/a',
    }
  })
  console.log('MercatorCoordinate(9.0, 61.5):', JSON.stringify(info))

  const matrixTest = await page.evaluate(() => {
    const map = window.maplibregl
    const maps = document.querySelectorAll('.maplibregl-canvas')
    return {
      canvasCount: maps.length,
    }
  })

  expect(info.error).toBeUndefined()
  expect(info.mercatorX).toBeDefined()
})
