import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
await page.goto('https://andra-network.bandcamp.com/edit_album?id=1331079057', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
const r = await page.evaluate(() => {
  const html = document.documentElement.outerHTML
  const m = html.match(/[^>]{0,90}delete[^<]{0,120}/gi) || []
  return m.slice(0, 20)
})
console.log(r.join('\n---\n'))
await browser.close()
