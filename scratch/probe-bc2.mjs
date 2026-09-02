import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true, args:['--no-sandbox'] })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
await page.goto('https://andra-network.bandcamp.com/', { waitUntil:'domcontentloaded', timeout:45000 })
await page.waitForTimeout(2000)
await page.evaluate(() => document.querySelector('a.add-music-link').click())
await page.waitForTimeout(3500)
const r = await page.evaluate(() => {
  const url = location.href
  const buttons = [...document.querySelectorAll('button,a,input,textarea,select,label')].map(e => ({
    tag:e.tagName, type:e.type||'', cls:(e.getAttribute('class')||'').slice(0,40), txt:(e.textContent||'').trim().slice(0,40), ph:(e.getAttribute('placeholder')||'')
  })).filter(e => e.txt || e.type==='file' || e.tag==='INPUT'||e.tag==='TEXTAREA'||e.tag==='SELECT').slice(0,80)
  return { url, buttons }
})
console.log(JSON.stringify(r,null,1))
await browser.close()
