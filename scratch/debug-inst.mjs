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
const info = await page.$$eval('button[aria-label="Check this to generate an instrumental only song"]', els => els.map(e => {
  const r = e.getBoundingClientRect()
  return { w: r.width, h: r.height, disabled: e.disabled, cls: e.className, top: r.top, left: r.left }
}))
console.log('instrumental buttons:', JSON.stringify(info, null, 1))
await browser.close()
