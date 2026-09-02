import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
await page.goto('https://andra-network.bandcamp.com/edit_album', { waitUntil: 'domcontentloaded' })
await page.locator('input.title.required').fill('BTN PROBE')
await page.locator('ol.tracks li.add-audio input[type=file]').first().setInputFiles('/tmp/opencode/bc-masters/GH_EXT.flac')
for (let k=0;k<30;k++){
  await page.waitForTimeout(5000)
  const cls = await page.locator('ol.tracks li.track').first().getAttribute('class').catch(()=>'')
  if (cls.includes('has-audio')) { console.log('audio done'); break }
}
await page.evaluate(() => { const el = document.querySelectorAll('ol.tracks li.track')[0]; window.ko.dataFor(el).title('Glass Halo Drift (Extended)') })
await page.waitForTimeout(2000)
const btns = await page.evaluate(() => {
  const out = []
  document.querySelectorAll('a.g-button, a.save-draft, .edit_album a.g-button, [data-test*="save"]').forEach(a => {
    out.push({ tag: a.tagName, cls: a.className, test: a.getAttribute('data-test'), disabled: a.hasAttribute('disabled'), vis: (a.getClientRects().length>0 && a.getClientRects()[0].width>0), text: (a.textContent||'').trim().replace(/\s+/g,' ').slice(0,30), bind: a.getAttribute('data-bind') })
  })
  const vis = document.querySelectorAll('a.g-button')
  return { btns: out, visCount: vis.length, saveDraftCount: document.querySelectorAll('a.save-draft').length }
})
console.log(JSON.stringify(btns, null, 1).slice(0, 2500))
await browser.close()
