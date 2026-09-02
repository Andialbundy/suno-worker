import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true, args:['--no-sandbox'] })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
await page.goto('https://andra-network.bandcamp.com/edit_album', { waitUntil:'domcontentloaded', timeout:45000 })
await page.waitForTimeout(3000)
const r = await page.evaluate(() => {
  const grab = sel => {
    const el = document.querySelector(sel)
    if(!el) return sel+': MISSING'
    return sel+' => '+el.outerHTML.slice(0,900)
  }
  return [
    grab('.audio-upload'),
    grab('.art-upload'),
    grab('div.tracks'),
  ]
})
console.log(r.join('\n\n---\n'))
await browser.close()
