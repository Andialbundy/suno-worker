import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'
const browser = await chromium.launchPersistentContext(join(homedir(), '.suno-profile'), { headless: false, args: ['--no-sandbox'] })
const page = browser.pages()[0] || await browser.newPage()
await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(3000)
const info = await page.evaluate(() => {
  const els = [...document.querySelectorAll('textarea, button, input, [contenteditable]')]
  return els.slice(55, 100).map((e,i) => ({
    i: i+55, tag: e.tagName, ph: e.getAttribute('placeholder'), text: e.textContent?.trim().slice(0,40),
    aria: e.getAttribute('aria-label'), ce: e.getAttribute('contenteditable')
  }))
})
console.log(JSON.stringify(info, null, 1))
await browser.close()
