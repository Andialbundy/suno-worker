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
page.on('console', m => { if (m.type()==='error') log('ERR:', JSON.stringify(m.args().map(a=>a.toString().slice(0,200)))) })
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
    else if (k % 12 === 11) log('track', i, 'waiting', ((Date.now()-t0)/1000).toFixed(0)+'s', cls.slice(0,30))
  }
  if (!done) { log('TRACK', i, 'NOT done'); await browser.close(); process.exit(1) }
}
for (let i = 0; i < FILES.length; i++) {
  const ti = rows.nth(i).locator('input[name^="track.title_"]').first()
  await ti.fill(FILES[i].t)
  const got = await ti.inputValue().catch(()=>'')
  log('title', i, got === FILES[i].t ? 'OK' : 'MISMATCH: '+JSON.stringify(got))
}
await page.locator('div.art-upload input[type=file]').first().setInputFiles('/tmp/opencode/bc-release/artwork-1400.png')
log('artwork set')
await page.waitForTimeout(30000)
await page.screenshot({ path: '/tmp/opencode/bandcamp/up7-before-save.png' })
await page.locator('a.save-draft').first().click().catch(async () => { await page.evaluate(() => document.querySelector('a.save-draft')?.click()) })
log('save-draft clicked')
await page.waitForTimeout(30000)
const url = page.url()
const titleAfter = await page.locator('input.title.required').inputValue().catch(()=>'')
const nrows = await page.locator('ol.tracks li.track').count()
log('after save: URL', url, '| title', JSON.stringify(titleAfter), '| tracks', nrows)
await page.screenshot({ path: '/tmp/opencode/bandcamp/up7-after-save.png' })
// reload-verification (draft might save without navigation)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
const titleR = await page.locator('input.title.required').inputValue().catch(()=>'')
const rowsR = await page.locator('ol.tracks li.track').count()
const artImg = await page.locator('div.art-upload img, .art-upload [class*="image"]').count().catch(()=>0)
log('RELOAD: title', JSON.stringify(titleR), '| tracks', rowsR, '| artEls', artImg)
await page.screenshot({ path: '/tmp/opencode/bandcamp/up7-reload.png' })
await browser.close()
const persisted = titleR === 'SIGNAL DEPTH' && rowsR >= 4
log(persisted ? 'PERSISTED OK' : 'NOT persisted')
process.exit(persisted ? 0 : 2)
