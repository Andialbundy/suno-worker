import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const DIR = '/tmp/opencode/bc-masters'
const TRACKS = [
  { file: 'GH_EXT.flac', title: 'Glass Halo Drift (Extended)' },
  { file: 'NR_EXT.flac', title: 'Neon Orbit Rite (Extended)' },
  { file: 'VS_EXT.flac', title: 'Void Spiral (Extended)' },
  { file: 'MIX.flac', title: 'NEXUS IV — Signal Depth (Continuous Mix)' },
]
const log = (m) => console.log(new Date().toISOString().slice(11,19), m)
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
page.on('console', m => { if (m.type()==='error') log('ERR: ' + m.text().slice(0,250)) })
page.on('pageerror', e => log('PAGEERR: ' + String(e).slice(0,250)))
await page.goto('https://andra-network.bandcamp.com/edit_album', { waitUntil: 'domcontentloaded' })
log('page loaded, URL=' + page.url())
await page.locator('input.title.required').fill('SIGNAL DEPTH')
log('album title set')
for (const [i, t] of TRACKS.entries()) {
  const input = page.locator('ol.tracks li.add-audio input[type=file]').first()
  await input.setInputFiles({ name: t.file, mimeType: 'audio/flac', buffer: readFileSync(`${DIR}/${t.file}`) })
  log(`track ${i+1}/4 file set: ${t.file}`)
  const started = Date.now()
  let ok = false
  while (Date.now() - started < 600000) {
    const rows = page.locator('ol.tracks li.track')
    const n = await rows.count()
    if (n > i) {
      const titleIn = rows.nth(i).locator('input.track-title, input[placeholder*="track"]')
      if (await titleIn.count()) {
        const v = await titleIn.first().inputValue()
        const rowTxt = (await rows.nth(i).innerText().catch(()=> '')).slice(0,80)
        if (v === t.title || (!v && !/processing|validating|spinner/.test(rowTxt) && Date.now() - started > 10000)) {
          if (!v && Date.now() - started > 10000) await titleIn.first().fill(t.title)
          log(`track ${i+1} row ready (${Math.round((Date.now()-started)/1000)}s)`)
          ok = true; break
        }
      }
    }
    await page.waitForTimeout(5000)
  }
  if (!ok) { log(`WARN track ${i+1} not confirmed ready after 10min`); break }
}
const art = page.locator('div.art-upload div.html5-upload-wrapper div.input-wrapper input[type=file]').first()
await art.setInputFiles({ name: 'artwork.png', mimeType: 'image/png', buffer: readFileSync('/tmp/opencode/bc-release/artwork-1400.png') })
log('artwork set')
await page.waitForTimeout(30000)
await page.screenshot({ path: '/tmp/opencode/bandcamp/up4-before-save.png', fullPage: false })
const save = page.locator('a.save-draft')
await save.click().catch(e => { log('save click err: ' + e.message.slice(0,120)); return page.evaluate(() => { const a = document.querySelector('a.save-draft'); if (a) a.click() }) })
log('save-draft clicked')
let moved = false
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(5000)
  const u = page.url()
  if (!u.includes('/edit_album')) { log('URL changed to: ' + u); moved = true; break }
}
if (!moved) log('URL STILL edit_album after 120s')
await page.screenshot({ path: '/tmp/opencode/bandcamp/up4-after-save.png', fullPage: false })
await browser.close()
log('done')
