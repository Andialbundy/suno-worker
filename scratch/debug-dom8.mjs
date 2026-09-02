import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'
const browser = await chromium.launchPersistentContext(join(homedir(), '.suno-profile'), { headless: false, args: ['--no-sandbox'] })
const page = browser.pages()[0] || await browser.newPage()
await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(3000)
async function styleFieldVisible() {
  const el = await page.$('textarea:not([aria-label])')
  if (!el) return false
  const box = await el.boundingBox()
  return !!box && box.width > 0
}
if (!(await styleFieldVisible())) {
  const advBtn = await page.$('button[aria-label="Advanced"]')
  if (advBtn) await advBtn.click()
  for (let i=0;i<10 && !(await styleFieldVisible());i++) await page.waitForTimeout(500)
}
console.log('style visible:', await styleFieldVisible())
const info = await page.evaluate(() => {
  return [...document.querySelectorAll('button')].filter(b => /instrumental/i.test(b.getAttribute('aria-label')||'')).map(b => ({
    aria: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), text: b.textContent?.trim()
  }))
})
console.log(JSON.stringify(info, null, 1))
await browser.close()
