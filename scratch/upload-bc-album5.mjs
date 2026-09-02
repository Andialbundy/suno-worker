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
page.on('console', m => { if (m.type()==='error') log('ERR:', JSON.stringify(m.args().map(a=>a.toString().slice(0,300)))) })
await page.goto('https://andra-network.bandcamp.com/edit_album', { waitUntil: 'domcontentloaded' })
log('page loaded, URL=', page.url())
await page.locator('input.title.required').fill('SIGNAL DEPTH')
log('album title set')
for (const f of FILES) {
  const inp = page.locator('ol.tracks li.add-audio input[type=file]').first()
  await inp.setInputFiles(f.p)
  log('set file', f.p.split('/').pop())
  let ok = false
  for (let i = 0; i < 120 && !ok; i++) {
    await page.waitForTimeout(5000)
    const rows = await page.locator('ol.tracks li.track').count()
    if (rows > 0) {
      const ti = page.locator('ol.tracks li.track').last().locator('input[placeholder*="track"], input.track-title').first()
      const has = await ti.count()
      const val = has ? await ti.inputValue().catch(()=>'') : ''
      const prog = await page.locator('ol.tracks li.track').last().locator('.progress-count, .spinner').count()
      if (has && prog === 0) { ok = true; log('track row ready, title=', JSON.stringify(val.slice(0,40)), 'after', ((Date.now()-t0)/1000).toFixed(0)+'s') }
    }
    if (i % 6 === 5) log('...waiting track', f.t, ((Date.now()-t0)/1000).toFixed(0)+'s')
  }
  if (!ok) { log('FAILED to confirm track', f.t); await browser.close(); process.exit(1) }
  const ti = page.locator('ol.tracks li.track').last().locator('input[placeholder*="track"], input.track-title').first()
  const val = await ti.inputValue().catch(()=>'')
  if (!val.trim()) await ti.fill(f.t).catch(()=>{})
  log('title ensured:', f.t)
}
const art = page.locator('div.art-upload input[type=file]').first()
await art.setInputFiles('/tmp/opencode/bc-release/artwork-1400.png')
log('artwork set')
await page.waitForTimeout(30000)
await page.screenshot({ path: '/tmp/opencode/bandcamp/up5-before-save.png' })
await page.locator('a.save-draft').click().catch(async () => { await page.evaluate(() => document.querySelector('a.save-draft')?.click()) })
log('save-draft clicked')
let moved = false
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(5000)
  if (!page.url().includes('/edit_album')) { moved = true; log('URL changed to', page.url()); break }
}
await page.screenshot({ path: '/tmp/opencode/bandcamp/up5-after-save.png' })
log(moved ? 'DONE - navigated away' : 'STILL on edit_album')
await browser.close()
process.exit(moved ? 0 : 2)
