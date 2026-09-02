import { chromium } from 'playwright'
import { readFileSync, appendFileSync } from 'fs'
const log = m => appendFileSync('/tmp/opencode/bandcamp/up2.log', `${new Date().toISOString().slice(11,19)} ${m}\n`)
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const MP3s = [
  ['GLASS_HALO_DRIFT_EXTENDED.mp3','/tmp/opencode/bc-release/GLASS_HALO_DRIFT_EXTENDED.mp3'],
  ['NEON_ORBIT_RITE_EXTENDED.mp3','/tmp/opencode/bc-release/NEON_ORBIT_RITE_EXTENDED.mp3'],
  ['VOID_SPIRAL_EXTENDED.mp3','/tmp/opencode/bc-release/VOID_SPIRAL_EXTENDED.mp3'],
  ['NEXUS_SIGNAL_DEPTH_MIX.mp3','/tmp/opencode/bc-release/NEXUS_SIGNAL_DEPTH_MIX.mp3'],
]
const browser = await chromium.launch({ headless: true, args:['--no-sandbox'] })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
await page.goto('https://andra-network.bandcamp.com/edit_album', { waitUntil:'domcontentloaded', timeout:45000 })
await page.waitForTimeout(3000)
await page.fill('input.title.required', 'NEXUS IV // 001 — SIGNAL DEPTH')
log('title set')

const rowCount = () => page.evaluate(() => document.querySelectorAll('ol.tracks li.track_row').length)
const artInputSel = 'div.art-upload input[type=file]'

for (const [name, path] of MP3s) {
  const inp = await page.$('ol.tracks li.add-audio input[type=file]')
  if (!inp) { log(`NO INPUT for ${name}`); continue }
  await inp.setInputFiles(path)
  log(`set file ${name}`)
  let ok = false
  for (let t = 0; t < 90; t++) {          // up to 3 min
    await page.waitForTimeout(2000)
    const rows = await rowCount()
    // track row considered done when its title input has a value (filename) and no progress bar
    const done = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('ol.tracks li.track_row')]
      return rows.map(r => ({ title: r.querySelector('input.title, input[placeholder]')?.value ?? null,
        pct: r.querySelector('.progress-count, .upload-count')?.textContent ?? null,
        html: r.innerHTML.slice(0, 120) }))
    })
    if (done.length >= 1) { log(`track row present (${done.length}), sample=${JSON.stringify(done[0])}`) }
    if (done.length >= 1 && done.every(d => d.title && !d.pct)) { ok = true; break }
    if (t === 89) log(`TIMEOUT rows=${done.length} ${JSON.stringify(done).slice(0,300)}`)
  }
  if (!ok) log(`failed wait for ${name}`)
}
log('tracks done, rows=' + await rowCount())

const art = await page.$(artInputSel)
if (art) { await art.setInputFiles('/tmp/opencode/bc-release/artwork-1400.png'); log('art set'); await page.waitForTimeout(12000) }
else log('NO ART INPUT')

await page.screenshot({ path:'/tmp/opencode/bandcamp/alb-pre-save.png', fullPage:true })
await page.evaluate(() => document.querySelector('a.save-draft')?.click())
let savedUrl = page.url()
for (let i=0;i<30;i++){
  await page.waitForTimeout(2000)
  if (page.url() !== 'https://andra-network.bandcamp.com/edit_album') break
}
log('url=' + page.url())
await page.screenshot({ path:'/tmp/opencode/bandcamp/alb-after-save.png', fullPage:true })
await browser.close()
console.log('DONE url=' + page.url())
