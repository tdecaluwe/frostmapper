import { test } from '@playwright/test'
import { readFileSync } from 'fs'

const snowCsv = readFileSync('/home/tom/git/frostmapper/tests/browser/fixtures/snow-season.csv', 'utf8')
const tempCsv = readFileSync('/home/tom/git/frostmapper/tests/browser/fixtures/ngcd-temp-mean.csv', 'utf8')
const meltCsv = readFileSync('/home/tom/git/frostmapper/tests/browser/fixtures/ngcd-temp-max.csv', 'utf8')

test('debug: thredds requests', async ({ page }) => {
  const requests = []
  page.on('request', req => {
    const url = req.url()
    if (url.includes('thredds') || url.includes('met.no')) requests.push(url)
  })

  await page.route('**/thredds/ncss/senorge/**', route =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: snowCsv }))
  await page.route('**/thredds/ncss/ngcd/**', route => {
    const url = route.request().url()
    if (url.includes('var=tg')) {
      route.fulfill({ status: 200, contentType: 'text/plain', body: tempCsv })
    } else {
      route.fulfill({ status: 200, contentType: 'text/plain', body: meltCsv })
    }
  })

  await page.goto('http://localhost:4321#lat=61.5&lng=9.0&zoom=8')
  await page.waitForFunction(() => window.__frostDebug !== undefined, { timeout: 30000 })
  await page.evaluate(() => { if (window.appState?.showPasswordModal) window.appState.showPasswordModal = false })
  await page.waitForTimeout(10000)

  for (const url of requests) {
    test.info().annotations.push({ type: 'request', description: url.substring(0, 150) })
  }
  console.log('TOTAL THREDDS REQUESTS:', requests.length)
  requests.forEach(u => console.log(' URL:', u.substring(0, 150)))

  const chunks = await page.evaluate(() => {
    try {
      const r = window.__frostDebug?.getRenderer?.()
      return r?._RasterRenderer__globalChunks?.length ?? -1
    } catch(e) { return 'err: ' + e.message }
  })
  console.log('CHUNK COUNT:', chunks)
})
