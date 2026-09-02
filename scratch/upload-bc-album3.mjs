import { chromium } from 'playwright'
import fs from 'fs'
const log = (...a) => console.log(new Date().toISOString().slice(11,19), ...a)
const state = JSON.parse(fs.readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const FILES = [
  ['/tmp/opencode/bc-release/GLASS_HALO_DRIFT_EXTENDED.mp3', 'Glass Halo Drift (Extended)'],
  ['/tmp/opencode/bc-release/NEON_ORBIT_RITE_EXTENDED.mp3', 'Neon Orbit Rite (Extended)'],
  ['/tmp/opencode/bc-release/VOID_SPIRAL_EXTENDED.mp3', 'Void Spiral (Extended)'],
  ['/tmp/opencode/bc-release/NEXUS_SIGNAL_DEPTH_MIX.mp3', 'NEXUS IV — Signal Depth (Continuous Mix)'],
]
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
page.on('console', m => { if (m.type() === 'error') log('CONSOLE-ERR:', m.text().slice(0,150)) })
await page.goto('https://andra-network.bandcamp.com/edit_album', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
log('URL:', page.url())
await page.locator('input.title.required').first().fill('SIGNAL DEPTH')
log('album title set')
for (const [path, name] of FILES) {
  const input = page.locator('ol.tracks li.add-audio input[type=file]').first()
  if (await input.count() === 0) { log('NO add-audio input for', name); break }
  await input.setInputFiles(path)
  log('file set:', name)
  let row = null
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(5000)
    row = await page.locator('li.track input[placeholder*="track"], li.track input.track-title').first().count()
    if (row > 0) break
  }
  if (row === 0) { log('ROW NOT FOUND for', name); continue }
  const ti = page.locator('li.track input[placeholder*="track"], li.track input.track-title').first()
  const cur = await ti.inputValue().catch(() => '')
  if (!cur.trim()) await ti.fill(name)
  log('track title:', cur.trim() ? 'KEPT:' + cur.trim() : 'SET:' + name)
}
log('all files set — waiting for processing to finish')
let done = false
for (let i = 0; i < 72; i++) {
  await page.waitForTimeout(5000)
  const busy = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('ol.tracks li.track')]
    const progs = rows.map(r => {
      const p = r.querySelector('.progress, .percent, [class*="progress"]')
      const sp = r.querySelector('.spinner, [class*="processing"], [class*="loading"]')
      return (p ? (p.textContent||'').trim() : '') + (sp ? 'SPIN' : '')
    })
    return progs.filter(Boolean)
  })
  if (busy.length === 0) { done = true; log('processing complete'); break }
  if (i % 6 === 0) log('still processing:', JSON.stringify(busy))
}
if (!done) log('WARN: processing may still be running')
await page.screenshot({ path: '/tmp/opencode/bandcamp/up3-before-save.png' })
await page.locator('a.save-draft').first().click().catch(() => log('save-draft click FAILED'))
log('save-draft clicked')
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(5000)
  if (!page.url().includes('edit_album')) { log('SAVED, new URL:', page.url()); break }
  if (i === 11) log('WARN: URL still edit_album after 60s')
}
await page.screenshot({ path: '/tmp/opencode/bandcamp/up3-after-save.png' })
await browser.close()
log('DONE')
