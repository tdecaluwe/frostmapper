import { test, expect } from '@playwright/test'
import { installApiMocks } from './helpers/mock-routes.js'

const BASE_URL = 'http://localhost:4321'
const JOTUNHEIMEN_HASH = '#lat=61.5&lng=9.0&zoom=8'

test('SHADER-DIAG3: trace shader compile timing and errors', async ({ page }) => {
  const errors = []
  const consoleMessages = []
  page.on('pageerror', err => errors.push({ time: Date.now(), msg: err.message }))
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleMessages.push({ type: msg.type(), text: msg.text() })
    }
  })

  const t0 = Date.now()
  await installApiMocks(page)
  await page.goto(`${BASE_URL}${JOTUNHEIMEN_HASH}`)
  await page.waitForFunction(() => window.__frostDebug !== undefined, { timeout: 30_000 })
  console.log(`__frostDebug ready at ${Date.now() - t0}ms`)

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
  console.log(`canvas ready at ${Date.now() - t0}ms`)

  const programInfo = await page.evaluate(() => {
    const r = window.__frostDebug?.getRenderer?.()
    if (!r) return { error: 'no renderer' }
    const program = r._RasterRenderer__program
    return {
      programIsNull: program === null,
      programIsUndefined: program === undefined,
      programType: typeof program,
    }
  })
  console.log('Program info immediately after ready:', JSON.stringify(programInfo))

  await page.waitForTimeout(2000)
  console.log(`After 2s wait at ${Date.now() - t0}ms`)

  const afterWait = await page.evaluate(() => {
    const r = window.__frostDebug?.getRenderer?.()
    return {
      chunkCount: r?.getChunkCount?.() ?? -1,
      programIsNull: r?._RasterRenderer__program === null,
    }
  })
  console.log('After 2s:', JSON.stringify(afterWait))

  console.log('Errors:', JSON.stringify(errors))
  console.log('Console errors/warnings:', JSON.stringify(consoleMessages.slice(0, 10)))

  const screenshot = await page.locator('#map').screenshot()
  await page.screenshot({ path: 'tests/browser/screenshots/shader-diag3-full.png' })
  await page.evaluate(() => window.__frostDebug.toggleBasemap(false))
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'tests/browser/screenshots/shader-diag3-nobasemap.png' })

  let nonZero = 0
  for (let i = 0; i < screenshot.length; i++) {
    if (screenshot[i] > 10) nonZero++
  }
  console.log('Map area non-zero fraction:', nonZero / screenshot.length)

  expect(programInfo.programIsNull).toBe(false)
})
