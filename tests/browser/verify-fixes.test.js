import { test, expect } from '@playwright/test'
import { installApiMocks } from './helpers/mock-routes.js'

const BASE_URL = 'http://localhost:4321'
const HASH = '#lat=61.5&lng=9.0&zoom=8'

test('password modal is NOT shown on app startup', async ({ page }) => {
  await installApiMocks(page)
  await page.goto(`${BASE_URL}${HASH}`)
  await page.waitForFunction(() => typeof window.__frostDebug !== 'undefined', { timeout: 30_000 })
  await page.waitForTimeout(300)

  const modalVisible = await page.locator('.modal-backdrop').isVisible().catch(() => false)
  expect(modalVisible).toBe(false)
})

test('danger-state layers are disabled and unchecked on startup', async ({ page }) => {
  await installApiMocks(page)
  await page.goto(`${BASE_URL}${HASH}`)
  await page.waitForFunction(() => typeof window.__frostDebug !== 'undefined', { timeout: 30_000 })
  await page.waitForTimeout(300)

  await page.evaluate(() => {
    if (window.appState?.showPasswordModal) window.appState.showPasswordModal = false
  })

  await page.locator('.panel-header').first().click()
  await page.waitForTimeout(200)

  const layerState = await page.evaluate(() => {
    const layers = window.__frostDebug?.getLayers?.()
    if (!layers) return null
    return {
      roadAccessEnabled:  layers.roadAccess?.params?.enabled,
      roadAccessState:    layers.roadAccess?.params?.state,
      isochronesEnabled:  layers.isochrones?.params?.enabled,
      isochronesState:    layers.isochrones?.params?.state,
    }
  })

  expect(layerState.roadAccessState).toBe('danger')
  expect(layerState.roadAccessEnabled).toBe(false)
  expect(layerState.isochronesState).toBe('danger')
  expect(layerState.isochronesEnabled).toBe(false)
})

test('screenshot: app renders without startup modal', async ({ page }) => {
  await installApiMocks(page)
  await page.goto(`${BASE_URL}${HASH}`)
  await page.waitForFunction(() => typeof window.__frostDebug !== 'undefined', { timeout: 30_000 })
  await page.waitForFunction(
    () => { const c = document.querySelector('#map canvas'); return c && c.width > 0 },
    { timeout: 20_000 },
  )
  await page.waitForTimeout(500)

  await page.screenshot({ path: 'tests/browser/screenshots/verify-startup-no-modal.png' })
})
