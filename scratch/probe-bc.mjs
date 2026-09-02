import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true, args:['--no-sandbox'] })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
await page.goto('https://andra-network.bandcamp.com/', { waitUntil:'domcontentloaded', timeout:45000 })
await page.waitForTimeout(2500)
const r = await page.evaluate(() => {
  const els = [...document.querySelectorAll('a,button,input[type=file],div')]
  const hits = els.filter(e => /album|track|song|add|upload|merch|photo|edit|gear/i.test((e.getAttribute('class')||'')+' '+(e.textContent||'').slice(0,60)))
    .slice(0,40).map(e => `<${e.tagName} class="${(e.getAttribute('class')||'').slice(0,50)}"> ${(e.textContent||'').trim().slice(0,50)}`)
  const files = [...document.querySelectorAll('input[type=file]')].map(f => ({accept:f.accept, parent:(f.parentElement?.className||'').slice(0,60)}))
  return { url: location.href, hits, files }
})
console.log(JSON.stringify(r, null, 1))
await browser.close()
