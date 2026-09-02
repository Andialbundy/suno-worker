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
log('page loaded')
await page.locator('input.title.required').fill('SIGNAL DEPTH')
for (const f of FILES) {
  await page.locator('ol.tracks li.add-audio input[type=file]').first().setInputFiles(f.p)
  log('set', f.p.split('/').pop())
}
for (let i = 0; i < FILES.length; i++) {
  const f = FILES[i]
  const row = page.locator('ol.tracks li.track').nth(i)
  const ti = row.locator('input[name^="track.title_"]').first()
  await ti.fill(f.t).catch(e => log('fill err', i, e.message.slice(0,80)))
  log('title set', i, f.t)
}
log('all titles set, waiting for uploads to finish...')
const rows = page.locator('ol.tracks li.track')
for (let i = 0; i < FILES.length; i++) {
  const row = rows.nth(i)
  let done = false
  for (let k = 0; k < 120 && !done; k++) {
    await page.waitForTimeout(5000)
    const cls = await row.getAttribute('class').catch(()=>'')
    const prog = await row.locator('.progress-count, .spinner, .progress').count().catch(()=>99)
    const errs = await row.locator('[class*="error"]').count().catch(()=>99)
    if (cls.includes('has-audio') && prog === 0) { done = true; log('track', i, 'audio done after', ((Date.now()-t0)/1000).toFixed(0)+'s') }
    else if (k % 12 === 11) log('track', i, 'still waiting', ((Date.now()-t0)/1000).toFixed(0)+'s', 'cls='+cls.slice(0,40), 'prog='+prog)
  }
  if (!done) { log('TRACK', i, 'NOT done after 10min'); await browser.close(); process.exit(1) }
}
await page.locator('div.art-upload input[type=file]').first().setInputFiles('/tmp/opencode/bc-release/artwork-1400.png')
log('artwork set, waiting 30s')
await page.waitForTimeout(30000)
await page.screenshot({ path: '/tmp/opencode/bandcamp/up6-before-save.png' })
const save = page.locator('a.save-draft').first()
await save.click().catch(async () => { await page.evaluate(() => document.querySelector('a.save-draft')?.click()) })
log('save-draft clicked')
let moved = false
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(5000)
  if (!page.url().includes('/edit_album')) { moved = true; log('URL changed to', page.url()); break }
}
await page.screenshot({ path: '/tmp/opencode/bandcamp/up6-after-save.png' })
log(moved ? 'DONE - navigated away' : 'STILL on edit_album after save')
await browser.close()
process.exit(moved ? 0 : 2)
