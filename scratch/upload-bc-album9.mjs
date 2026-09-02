import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const t0 = Date.now()
const log = (...a) => console.log(new Date().toTimeString().slice(0,8), ...a)
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const FILES = [
  { p: '/tmp/opencode/bc-masters/GH_EXT.flac', t: 'Glass Halo Drift (Extended)' },
  { p: '/tmp/opencode/bc-masters/NR_EXT.flac', t: 'Neon Orbit Rite (Extended)' },
  { p: '/tmp/opencode/bc-masters/VS_EXT.flac', t: 'Void Spiral (Extended)' },
  { p: '/tmp/opencode/bc-masters/MIX.flac',  t: 'NEXUS IV - Signal Depth (Continuous Mix)' },
]
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
page.on('console', m => { const t = m.text(); if (t.includes('validate') || t.includes('failed') || m.type()==='error') log('C['+m.type()+']', t.slice(0,150)) })
await page.goto('https://andra-network.bandcamp.com/edit_album', { waitUntil: 'domcontentloaded' })
await page.locator('input.title.required').fill('SIGNAL DEPTH')
log('album title set')
for (const f of FILES) await page.locator('ol.tracks li.add-audio input[type=file]').first().setInputFiles(f.p)
log('4 files set')
const rows = page.locator('ol.tracks li.track')
for (let i = 0; i < FILES.length; i++) {
  const row = rows.nth(i)
  let done = false
  for (let k = 0; k < 120 && !done; k++) {
    await page.waitForTimeout(5000)
    const cls = await row.getAttribute('class').catch(()=>'')
    const prog = await row.locator('.progress-count, .spinner, .progress').count().catch(()=>99)
    if (cls.includes('has-audio') && prog === 0) { done = true; log('track', i, 'audio done', ((Date.now()-t0)/1000).toFixed(0)+'s') }
  }
  if (!done) { log('TRACK', i, 'NOT done'); await browser.close(); process.exit(1) }
}
for (let i = 0; i < FILES.length; i++) {
  const val = FILES[i].t
  const ok = await page.evaluate(({ idx, val }) => {
    const inp = document.querySelectorAll('ol.tracks li.track input[name^="track.title_"]')[idx]
    if (!inp) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(inp, val)
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    return inp.value
  }, { idx: i, val })
  log('title set', i, JSON.stringify(ok))
}
// wait for validation to enable save-draft
let enabled = false
for (let k = 0; k < 20 && !enabled; k++) {
  await page.waitForTimeout(3000)
  enabled = await page.evaluate(() => {
    const s = document.querySelector('a.save-draft')
    return s ? !s.hasAttribute('disabled') : false
  })
}
log('save-draft enabled:', enabled)
await page.locator('div.art-upload input[type=file]').first().setInputFiles('/tmp/opencode/bc-release/artwork-1400.png')
log('artwork set')
await page.waitForTimeout(30000)
await page.screenshot({ path: '/tmp/opencode/bandcamp/up9-before-save.png' })
await page.locator('a.save-draft').first().click().catch(async () => { await page.evaluate(() => document.querySelector('a.save-draft')?.click()) })
log('save-draft clicked')
await page.waitForTimeout(40000)
log('URL now:', page.url())
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
const titleR = await page.locator('input.title.required').inputValue().catch(()=>'')
const rowsR = await page.locator('ol.tracks li.track').count()
const trackTitles = await page.evaluate(() => Array.from(document.querySelectorAll('ol.tracks li.track input[name^="track.title_"]')).map(i => i.value))
log('RELOAD: title', JSON.stringify(titleR), '| tracks', rowsR, '| titles', JSON.stringify(trackTitles))
await page.screenshot({ path: '/tmp/opencode/bandcamp/up9-reload.png' })
await browser.close()
const persisted = titleR === 'SIGNAL DEPTH' && rowsR >= 4
log(persisted ? 'PERSISTED OK' : 'NOT persisted')
process.exit(persisted ? 0 : 2)
