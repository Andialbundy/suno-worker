import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
for (const path of ['/', '/radio']) {
  await page.goto('https://andra.network' + path, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(1500)
  for (let y = 0; y < 6; y++) { await page.evaluate(() => window.scrollBy(0, 800)); await page.waitForTimeout(400) }
  const broken = await page.evaluate(() => {
    const out = []
    for (const im of Array.from(document.images)) {
      const src = im.currentSrc || im.src || ''
      if (src.includes('covers/') && (im.complete && im.naturalWidth === 0)) out.push(src)
    }
    return out
  })
  console.log(path, '| broken covers:', broken.length, broken.slice(0, 8))
}
await browser.close()
