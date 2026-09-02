import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
page.on('console', m => { if (m.type()==='error') console.log('ERR:', JSON.stringify(m.args().map(a=>a.toString().slice(0,400)))) })
page.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0,400)))
await page.goto('https://andra-network.bandcamp.com/edit_album', { waitUntil: 'domcontentloaded' })
await page.locator('input.title.required').fill('PROBE TEST')
const input = page.locator('ol.tracks li.add-audio input[type=file]').first()
await input.setInputFiles({ name: 'glass.mp3', mimeType: 'audio/mpeg', buffer: readFileSync('/tmp/opencode/bc-release/GLASS_HALO_DRIFT_EXTENDED.mp3') })
await page.waitForTimeout(8000)
const rows = await page.locator('ol.tracks li').count()
console.log('li count:', rows)
for (let i=0;i<rows;i++){
  const c = await page.locator('ol.tracks li').nth(i).getAttribute('class')
  const txt = (await page.locator('ol.tracks li').nth(i).innerText().catch(()=>'')).slice(0,120)
  console.log(i, c, JSON.stringify(txt))
}
await browser.close()
