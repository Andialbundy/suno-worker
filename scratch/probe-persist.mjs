import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
await page.goto('https://andra-network.bandcamp.com/edit_album', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
const title = await page.locator('input.title.required').inputValue().catch(()=>'')
console.log('title:', JSON.stringify(title))
const tracks = await page.locator('ol.tracks li.track').count()
console.log('track rows:', tracks)
for (let i=0;i<tracks;i++){
  const v = await page.locator('ol.tracks li.track').nth(i).locator('input[placeholder*="track"], input.track-title').first().inputValue().catch(()=>'')
  console.log(' track', i, JSON.stringify(v.slice(0,50)))
}
const albumURL = page.url()
console.log('URL:', albumURL)
await browser.close()
