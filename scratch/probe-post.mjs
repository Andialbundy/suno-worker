import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
page.on('request', r => {
  if (r.url().includes('edit_album_v2') || r.url().includes('save_album')) {
    console.log('POST to:', r.url())
    try { const d = r.postData(); if (d) console.log('BODY:', d.slice(0, 600).replace(/[&]/g,'\n&')) } catch(e){}
  }
})
page.on('response', r => { if (r.url().includes('edit_album_v2')) console.log('RESP:', r.status(), r.url()) })
await page.goto('https://andra-network.bandcamp.com/edit_album', { waitUntil: 'domcontentloaded' })
const ti = page.locator('input.title.required')
await ti.click()
await page.keyboard.type('SIGNAL DEPTH', { delay: 20 })
console.log('typed album title')
await ti.press('Tab')
await page.waitForTimeout(500)
console.log('observable readback:', await page.evaluate(() => { const i = document.querySelector('input.title.required'); const v = window.ko.dataFor(i); return v && typeof v.title === 'function' ? v.title() : '??' }))
await page.locator('ol.tracks li.add-audio input[type=file]').first().setInputFiles('/tmp/opencode/bc-masters/GH_EXT.flac')
for (let k=0;k<30;k++){
  await page.waitForTimeout(5000)
  const cls = await page.locator('ol.tracks li.track').first().getAttribute('class').catch(()=>'')
  if (cls.includes('has-audio')) { console.log('audio done'); break }
}
await page.evaluate(() => { const el = document.querySelectorAll('ol.tracks li.track')[0]; window.ko.dataFor(el).title('Glass Halo Drift (Extended)') })
await page.waitForTimeout(1000)
await page.locator('[data-test="save-draft-button"]').click()
console.log('save clicked')
await page.waitForTimeout(8000)
console.log('URL:', page.url())
await browser.close()
