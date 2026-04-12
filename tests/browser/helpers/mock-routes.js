import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(__dir, '..', 'fixtures')

function fixture(name) {
  return readFileSync(join(FIXTURES, name), 'utf8')
}

export async function installApiMocks(page) {
  const snowCsv    = fixture('snow-season.csv')
  const tempCsv    = fixture('ngcd-temp-mean.csv')
  const meltCsv    = fixture('ngcd-temp-max.csv')

  await page.route('**/thredds/ncss/senorge/**', route => {
    route.fulfill({ status: 200, contentType: 'text/plain', body: snowCsv })
  })

  await page.route('**/thredds/ncss/ngcd/**', route => {
    const url = route.request().url()
    if (url.includes('var=tg')) {
      route.fulfill({ status: 200, contentType: 'text/plain', body: tempCsv })
    } else {
      route.fulfill({ status: 200, contentType: 'text/plain', body: meltCsv })
    }
  })
}
