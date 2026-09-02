import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'
const browser = await chromium.launchPersistentContext(join(homedir(), '.suno-profile'), { headless: false, args: ['--no-sandbox'] })
const page = browser.pages()[0] || await browser.newPage()
await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(3000)
const advBtn = await page.$('button[aria-label="Advanced"]')
if (advBtn) {
  const cls = await advBtn.getAttribute('class') || ''
  if (!cls.includes('active')) { await advBtn.click(); await page.waitForTimeout(1000) }
}
const info = await page.evaluate(() => {
  return [...document.querySelectorAll('textarea')].map(e => {
    const r = e.getBoundingClientRect()
    return {
      aria: e.getAttribute('aria-label'), ph: e.getAttribute('placeholder'),
      visible: r.width > 0 && r.height > 0, w: r.width, h: r.height,
      disabled: e.disabled, cls: e.className?.toString().slice(0,50)
    }
  })
})
console.log(JSON.stringify(info, null, 1))
await browser.close()
