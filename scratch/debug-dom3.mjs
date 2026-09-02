import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'
const browser = await chromium.launchPersistentContext(join(homedir(), '.suno-profile'), { headless: false, args: ['--no-sandbox'] })
const page = browser.pages()[0] || await browser.newPage()
await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(3000)
try { await page.click('text=Allow All', { timeout: 2000 }) } catch {}
await page.waitForTimeout(1000)
const info = await page.evaluate(() => {
  const all = [...document.querySelectorAll('*')]
  return all.filter(e => {
    const a = (e.getAttribute('aria-label')||'') + (e.getAttribute('title')||'') + (e.textContent||'')
    return /create|generate/i.test(e.getAttribute('aria-label')||'') || /^create$/i.test(e.textContent?.trim()||'')
  }).slice(0,30).map(e => ({
    tag: e.tagName, aria: e.getAttribute('aria-label'), text: e.textContent?.trim().slice(0,30),
    cls: e.className?.toString().slice(0,60), disabled: e.disabled
  }))
})
console.log(JSON.stringify(info, null, 1))
await browser.close()
