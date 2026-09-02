import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
const out = {}
for (const id of ['4050194320']) {
  await page.goto(`https://andra-network.bandcamp.com/edit_album?id=${id}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  out[id] = await page.evaluate(() => {
    const dels = Array.from(document.querySelectorAll('a, button, [class*="del"], [data-test*="del"]'))
      .filter(d => /delete|remove|destroy/i.test((d.innerText||'')+(d.getAttribute('data-test')||'')+(d.getAttribute('href')||'')))
      .map(d => ({ tag: d.tagName, dt: d.getAttribute('data-test'), href: (d.getAttribute('href')||'').slice(0,80), txt: (d.innerText||'').trim().slice(0,40), cls: (d.className||'').toString().slice(0,50) }))
    const footer = Array.from(document.querySelectorAll('a')).filter(a=>/delete/i.test(a.getAttribute('href')||'')).slice(0,5).map(a=>a.getAttribute('href'))
    return { dels, footer }
  })
}
console.log(JSON.stringify(out, null, 1))
await browser.close()
