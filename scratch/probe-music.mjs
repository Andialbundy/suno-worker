import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
await page.goto('https://andra-network.bandcamp.com/music', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
const d = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('ol li.album, ol li[class*="draft"], .music-column, li'))
    .filter(i => /album|draft|PROBE|TEST|SIGNAL/i.test((i.className||'')+ ' ' + (i.innerText||'')))
    .slice(0, 30)
    .map(i => { const a = i.querySelector('a[href*="album"]'); return { cls: (i.className||'').toString().slice(0,40), href: a?a.getAttribute('href'):null, txt: (i.innerText||'').replace(/\s+/g,' ').slice(0,60) } })
  const del = Array.from(document.querySelectorAll('a[href*="delete"], [data-test*="delete"], form[action*="delete"], a[title*="delete"]'))
    .map(a => ({ href: a.getAttribute('href'), dt: a.getAttribute('data-test'), txt: (a.innerText||'').trim().slice(0,30) })).slice(0,10)
  return { items, del }
})
console.log(JSON.stringify(d, null, 1))
await browser.close()
