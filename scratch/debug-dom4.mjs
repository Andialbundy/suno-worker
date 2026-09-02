import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'
const browser = await chromium.launchPersistentContext(join(homedir(), '.suno-profile'), { headless: false, args: ['--no-sandbox'] })
const page = browser.pages()[0] || await browser.newPage()
await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(3000)
const info = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button[aria-label="Simple"], button[aria-label="Advanced"]')]
  return btns.map(e => ({
    aria: e.getAttribute('aria-label'), pressed: e.getAttribute('aria-pressed'),
    cls: e.className, dataState: e.getAttribute('data-state')
  }))
})
console.log(JSON.stringify(info, null, 1))
await browser.close()
