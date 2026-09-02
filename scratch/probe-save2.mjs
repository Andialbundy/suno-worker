import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
page.on('console', m => { const t = m.text(); if (/validate|encoding|EncodingsPoller|upload|error/i.test(t) && m.type()!=='log' ) console.log('C['+m.type()+']', t.slice(0,160)) })
await page.goto('https://andra-network.bandcamp.com/edit_album', { waitUntil: 'domcontentloaded' })
await page.locator('input.title.required').fill('SAVE PROBE 2')
await page.locator('ol.tracks li.add-audio input[type=file]').first().setInputFiles('/tmp/opencode/bc-masters/GH_EXT.flac')
for (let k=0;k<30;k++){
  await page.waitForTimeout(5000)
  const cls = await page.locator('ol.tracks li.track').first().getAttribute('class').catch(()=>'')
  if (cls.includes('has-audio')) { console.log('audio done'); break }
}
await page.evaluate(() => {
  const rows = document.querySelectorAll('ol.tracks li.track')
  const el = rows[0]; const vm = window.ko.dataFor(el)
  vm.title('Glass Halo Drift (Extended)')
})
await page.waitForTimeout(3000)
const info = await page.evaluate(() => {
  const s = document.querySelector('a.save-draft')
  const out = { disabled: s ? s.hasAttribute('disabled') : null, cls: s ? s.className : null }
  if (s && typeof window.ko !== 'undefined') {
    const vm = window.ko.dataFor(s)
    if (vm) {
      const keys = Object.keys(vm)
      const rel = keys.filter(k => /save|draft|valid|dirty|enabl|disabl|pending|processing/i.test(k))
      out.vmKeys = rel.slice(0,25)
      for (const k of rel.slice(0,8)) { try { const v = vm[k]; out[k] = typeof v === 'function' ? String(v()).slice(0,60) : String(v).slice(0,60) } catch(e){ out[k]='err' } }
    }
  }
  const enc = document.querySelectorAll('input[name$="pending_encodings_id"]')
  out.encodings = Array.from(enc).map(e => e.value)
  out.formValid = document.getElementById('edit-tralbum-form') ? window.ko.dataFor(document.getElementById('edit-tralbum-form')) : null
  return out
})
console.log('INFO:', JSON.stringify(info, null, 0).slice(0, 2000))
await browser.close()
