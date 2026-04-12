import { test, expect } from '@playwright/test'

const DEMO_URL = 'http://localhost:4322/demo/demo.html'

async function waitForMap(page) {
  await page.waitForFunction(
    () => window.__demoDebug && window.__demoDebug.getMap(),
    { timeout: 20_000 },
  )
}

test.describe('FrostMapper OpenLayers Demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO_URL, { waitUntil: 'load' })
    await waitForMap(page)
  })

  test('page loads with a map container and canvas', async ({ page }) => {
    const mapEl = page.locator('#map')
    await expect(mapEl).toBeVisible()
    const canvas = page.locator('#map canvas')
    await expect(canvas).toBeVisible()
  })

  test('zoom controls are visible in the UI', async ({ page }) => {
    const zoomIn = page.locator('#zoom-in')
    const zoomOut = page.locator('#zoom-out')
    await expect(zoomIn).toBeVisible()
    await expect(zoomOut).toBeVisible()
  })

  test('zoom in button increases the zoom level', async ({ page }) => {
    const before = await page.evaluate(() => window.__demoDebug.getZoom())
    await page.locator('#zoom-in').click()
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => window.__demoDebug.getZoom())
    expect(after).toBeGreaterThan(before)
  })

  test('zoom out button decreases the zoom level', async ({ page }) => {
    await page.locator('#zoom-in').click()
    await page.waitForTimeout(300)
    const before = await page.evaluate(() => window.__demoDebug.getZoom())
    await page.locator('#zoom-out').click()
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => window.__demoDebug.getZoom())
    expect(after).toBeLessThan(before)
  })


  test('Shift+ArrowRight rotates the viewport', async ({ page }) => {
    const before = await page.evaluate(() => window.__demoDebug.getRotation())
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.up('Shift')
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => window.__demoDebug.getRotation())
    expect(after).toBeGreaterThan(before)
  })

  test('plain ArrowRight pans without rotating', async ({ page }) => {
    const beforeRotation = await page.evaluate(() => window.__demoDebug.getRotation())
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(300)
    const afterRotation = await page.evaluate(() => window.__demoDebug.getRotation())
    expect(afterRotation).toBe(beforeRotation)
  })

  test('shortcuts still work after toggling a basemap checkbox', async ({ page }) => {
    await page.locator('#toggle-belgium').click()
    const before = await page.evaluate(() => window.__demoDebug.getRotation())
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.up('Shift')
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => window.__demoDebug.getRotation())
    expect(after).toBeLessThan(before)
  })

  test('shortcuts still work after changing projection', async ({ page }) => {
    await page.locator('#projection-picker').selectOption('EPSG:3035')
    await page.waitForTimeout(300)
    const before = await page.evaluate(() => window.__demoDebug.getZoom())
    await page.keyboard.press('+')
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => window.__demoDebug.getZoom())
    expect(after).toBeGreaterThan(before)
  })

  test('projection picker exists and lists expected projections', async ({ page }) => {
    const select = page.locator('#projection-picker')
    await expect(select).toBeVisible()
    const options = await select.locator('option').allTextContents()
    const expectedLabels = ['EPSG:3857', 'EPSG:3035', 'Peirce Quincuncial']
    for (const label of expectedLabels) {
      expect(options).toContainEqual(expect.stringContaining(label))
    }
  })

  test('changing projection picker updates the view projection', async ({ page }) => {
    const select = page.locator('#projection-picker')
    await select.selectOption('EPSG:3035')
    await page.waitForTimeout(500)
    const proj = await page.evaluate(() => window.__demoDebug.getProjection())
    expect(proj).toBe('EPSG:3035')
  })

  test('switching back to EPSG:3857 restores Mercator', async ({ page }) => {
    const select = page.locator('#projection-picker')
    await select.selectOption('EPSG:3035')
    await page.waitForTimeout(500)
    await select.selectOption('EPSG:3857')
    await page.waitForTimeout(500)
    const proj = await page.evaluate(() => window.__demoDebug.getProjection())
    expect(proj).toBe('EPSG:3857')
  })

  test('projection switch keeps clipped layers registered', async ({ page }) => {
    const select = page.locator('#projection-picker')
    await select.selectOption('EPSG:3035')
    await page.waitForTimeout(500)
    const info = await page.evaluate(() => window.__demoDebug.getLayerInfo())
    const names = info.map((l) => l.name)
    expect(names).toContain('switzerland')
    expect(names).toContain('france')
    expect(names).toContain('italy')
    expect(names).toContain('austria')
    expect(names).not.toContain('germany')
  })

  test('__demoDebug exposes layer visibility info', async ({ page }) => {
    const info = await page.evaluate(() => window.__demoDebug.getLayerInfo())
    expect(info).toBeDefined()
    expect(Array.isArray(info)).toBe(true)
    expect(info.length).toBeGreaterThanOrEqual(3)
    const names = info.map((l) => l.name)
    expect(names).toContain('opentopomap')
    expect(names).toContain('norway')
    expect(names).toContain('switzerland')
  })

  test('Norway Kartverket layer is present and visible', async ({ page }) => {
    const info = await page.evaluate(() => window.__demoDebug.getLayerInfo())
    const noLayer = info.find((l) => l.name === 'norway')
    expect(noLayer).toBeDefined()
    expect(noLayer.visible).toBe(true)
  })

  test('Switzerland topo layer is present and visible', async ({ page }) => {
    const info = await page.evaluate(() => window.__demoDebug.getLayerInfo())
    const chLayer = info.find((l) => l.name === 'switzerland')
    expect(chLayer).toBeDefined()
    expect(chLayer.visible).toBe(true)
  })

  test('OpenTopoMap fallback layer is present', async ({ page }) => {
    const info = await page.evaluate(() => window.__demoDebug.getLayerInfo())
    const otm = info.find((l) => l.name === 'opentopomap')
    expect(otm).toBeDefined()
    expect(otm.visible).toBe(true)
  })
})
