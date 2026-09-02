import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
await page.goto('https://andra-network.bandcamp.com/edit_album', { waitUntil: 'domcontentloaded' })
await page.locator('input.title.required').fill('ROW PROBE')
await page.locator('ol.tracks li.add-audio input[type=file]').first().setInputFiles('/tmp/opencode/bc-masters/GH_EXT.flac')
for (let k=0;k<30;k++){
  await page.waitForTimeout(5000)
  const cls = await page.locator('ol.tracks li.track').first().getAttribute('class').catch(()=>'')
  if (cls.includes('has-audio')) { console.log('audio done'); break }
}
const vis = await page.evaluate(() => {
  const row = document.querySelector('ol.tracks li.track')
  if (!row) return 'no row'
  const out = []
  const all = row.querySelectorAll('*')
  for (const el of all) {
    if (el.offsetParent !== null || el.getClientRects().length > 0) {
      const r = el.getClientRects()[0]
      if (r && r.width > 0 && r.height > 0 && r.width < 800) {
        const tag = el.tagName.toLowerCase()
        const cls = (el.className && typeof el.className === 'string') ? el.className.slice(0,50) : ''
        const txt = (el.textContent||'').trim().slice(0,40).replace(/\s+/g,' ')
        if (tag==='input' || tag==='button' || tag==='a' || cls) out.push(tag+'.'+cls+' :: '+txt)
      }
    }
  }
  return out.slice(0, 40)
})
console.log('VISIBLE:', JSON.stringify(vis, null, 0))
const koInfo = await page.evaluate(() => {
  const wko = typeof window.ko !== 'undefined'
  let vm = null
  const inp = document.querySelector('ol.tracks li.track input[name^="track.title_"]')
  if (inp && wko) { try { const d = window.ko.dataFor(inp); vm = d ? Object.keys(d).slice(0,20) : 'none' } catch(e){ vm = 'err '+e.message } }
  return { ko: wko, vm }
})
console.log('KO:', JSON.stringify(koInfo))
await page.screenshot({ path: '/tmp/opencode/bandcamp/row-probe.png' })
await browser.close()
