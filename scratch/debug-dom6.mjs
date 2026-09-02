import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'
const browser = await chromium.launchPersistentContext(join(homedir(), '.suno-profile'), { headless: false, args: ['--no-sandbox'] })
const page = browser.pages()[0] || await browser.newPage()
await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(3000)
console.log('BEFORE click URL:', page.url())
const advBtn = await page.$('button[aria-label="Advanced"]')
console.log('advBtn found:', !!advBtn)
if (advBtn) {
  const cls = await advBtn.getAttribute('class') || ''
  console.log('advBtn class:', cls)
  await advBtn.click()
  await page.waitForTimeout(2000)
}
console.log('AFTER click URL:', page.url())
await page.screenshot({ path: 'debug2.png', fullPage: true })
const count = await page.evaluate(() => document.querySelectorAll('textarea').length)
console.log('textarea count after click:', count)
await browser.close()
