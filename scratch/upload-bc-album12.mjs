import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const t0 = Date.now()
const log = (...a) => console.log(new Date().toTimeString().slice(0,8), ...a)
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
page.on('console', m => { const t = m.text(); if (/validate:|failed validation|Error/i.test(t) && m.type()!=='log') log('C['+m.type()+']', t.slice(0,110)) })
await page.goto('https://andra-network.bandcamp.com/edit_album', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
const tracks0 = await page.locator('ol.tracks li.track').count()
const title0 = await page.locator('input.title.required').inputValue().catch(()=>'')
log('initial: tracks', tracks0, '| albumtitle', JSON.stringify(title0))
// set album title via KO (album VM has title observable)
const setRes = await page.evaluate(() => {
  const inp = document.querySelector('input.title.required')
  if (!inp || typeof window.ko === 'undefined') return { err: 'no input/ko' }
  const vm = window.ko.dataFor(inp)
  if (!vm || typeof vm.title !== 'function') return { err: 'no vm.title', keys: Object.keys(vm).filter(k=>/title|name/i.test(k)).slice(0,5) }
  vm.title('SIGNAL DEPTH')
  return { ok: vm.title() }
})
log('album ko-set:', JSON.stringify(setRes).slice(0,120))
await page.waitForTimeout(2000)
// if tracks missing (fresh draft), re-upload
if (tracks0 < 4) {
  log('WARN: no existing tracks, re-uploading')
  const FILES = [
    { p: '/tmp/opencode/bc-masters/GH_EXT.flac' }, { p: '/tmp/opencode/bc-masters/NR_EXT.flac' },
    { p: '/tmp/opencode/bc-masters/VS_EXT.flac' }, { p: '/tmp/opencode/bc-masters/MIX.flac' },
  ]
  for (const f of FILES) await page.locator('ol.tracks li.add-audio input[type=file]').first().setInputFiles(f.p)
  const rows = page.locator('ol.tracks li.track')
  for (let i = 0; i < 4; i++) {
    const row = rows.nth(i)
    for (let k = 0; k < 120; k++) {
      await page.waitForTimeout(5000)
      const cls = await row.getAttribute('class').catch(()=>'')
      const prog = await row.locator('.progress-count, .spinner, .progress').count().catch(()=>99)
      if (cls.includes('has-audio') && prog === 0) break
    }
    log('track', i, 'audio done')
  }
  const T = ['Glass Halo Drift (Extended)','Neon Orbit Rite (Extended)','Void Spiral (Extended)','NEXUS IV - Signal Depth (Continuous Mix)']
  for (let i = 0; i < 4; i++) {
    await page.evaluate(({ idx, val }) => { const el = document.querySelectorAll('ol.tracks li.track')[idx]; window.ko.dataFor(el).title(val) }, { idx: i, val: T[i] })
  }
  log('re-uploaded + titles set')
}
await page.locator('a.save-draft.show-when-dirty, [data-test="save-draft-button"]').first().waitFor({ state: 'visible', timeout: 30000 }).catch(()=>log('save btn not visible'))
await page.screenshot({ path: '/tmp/opencode/bandcamp/up12-before.png' })
await page.locator('[data-test="save-draft-button"]').click().catch(async () => { await page.evaluate(() => document.querySelector('[data-test="save-draft-button"]')?.click()) })
log('save-draft clicked')
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(5000)
  if (!page.url().includes('/edit_album')) { log('URL changed to', page.url()); break }
  if (i === 20) log('still on edit_album', ((Date.now()-t0)/1000).toFixed(0)+'s')
}
await page.waitForTimeout(5000)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
const titleR = await page.locator('input.title.required').inputValue().catch(()=>'')
const rowsR = await page.locator('ol.tracks li.track').count()
const trackTitles = await page.evaluate(() => Array.from(document.querySelectorAll('ol.tracks li.track input[name^="track.title_"]')).map(i => i.value))
log('RELOAD: title', JSON.stringify(titleR), '| tracks', rowsR, '| titles', JSON.stringify(trackTitles))
await page.screenshot({ path: '/tmp/opencode/bandcamp/up12-reload.png' })
await browser.close()
const persisted = titleR === 'SIGNAL DEPTH' && rowsR >= 4
log(persisted ? 'PERSISTED OK - ALBUM COMPLETE' : 'NOT persisted')
process.exit(persisted ? 0 : 2)
