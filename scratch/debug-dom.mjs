import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'
const browser = await chromium.launchPersistentContext(join(homedir(), '.suno-profile'), { headless: false, args: ['--no-sandbox'] })
const page = browser.pages()[0] || await browser.newPage()
await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(3000)
try { await page.click('text=Allow All', { timeout: 2000 }) } catch {}
await page.waitForTimeout(2000)
await page.screenshot({ path: 'debug.png', fullPage: true })
console.log('URL:', page.url())
console.log('TITLE:', await page.title())
const info = await page.evaluate(() => {
  const els = [...document.querySelectorAll('textarea, button, input, [contenteditable]')]
  return els.slice(0, 60).map(e => ({
    tag: e.tagName, ph: e.getAttribute('placeholder'), text: e.textContent?.trim().slice(0,40),
    testid: e.getAttribute('data-testid'), aria: e.getAttribute('aria-label'), type: e.getAttribute('type')
  }))
})
console.log(JSON.stringify(info, null, 1))
await browser.close()
