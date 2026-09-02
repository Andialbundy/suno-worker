import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const MP3s = [
  '/tmp/opencode/bc-release/GLASS_HALO_DRIFT_EXTENDED.mp3',
  '/tmp/opencode/bc-release/NEON_ORBIT_RITE_EXTENDED.mp3',
  '/tmp/opencode/bc-release/VOID_SPIRAL_EXTENDED.mp3',
  '/tmp/opencode/bc-release/NEXUS_SIGNAL_DEPTH_MIX.mp3',
]
const browser = await chromium.launch({ headless: true, args:['--no-sandbox'] })
const ctx = await browser.newContext({ acceptDownloads: true })
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
const shot = n => page.screenshot({ path: `/tmp/opencode/bandcamp/alb-${n}.png`, fullPage: true }).catch(()=>{})
await page.goto('https://andra-network.bandcamp.com/edit_album', { waitUntil:'domcontentloaded', timeout:45000 })
await page.waitForTimeout(2500)

await page.fill('input.title.required, input.force-placeholder-wrapper.title', 'NEXUS IV // 001 — SIGNAL DEPTH')
const rel = await page.$('input.title.required').then(()=>true)
console.log('title filled')

const audioInputSel = 'ol.tracks li.add-audio:last-of-type input[type=file], div.audio-upload input[type=file]'
for (const [i, mp3] of MP3s.entries()) {
  const inp = await page.$(audioInputSel)
  if(!inp){ console.log('AUDIO INPUT MISSING for', mp3); await shot('noinput'); break }
  await inp.setInputFiles(mp3)
  console.log('uploading', mp3.split('/').pop())
  // wait for track row count to reach i+1
  for (let t=0; t<40; t++){
    await page.waitForTimeout(2000)
    const cnt = await page.evaluate(() => document.querySelectorAll('ol.tracks li.track_row, ol.tracks li.track').length).catch(()=>0)
    const done = await page.evaluate(() => {
      const pct = document.querySelector('.upload-count')?.textContent
      const li = [...document.querySelectorAll('ol.tracks li')].filter(l => (l.className||'').includes('track'))
      return { liCount: li.length, pct }
    }).catch(()=>({liCount:0}))
    if (done.liCount >= i+1) { console.log('track', i+1, 'appeared'); break }
    if (t===39) { console.log('timeout waiting track', i+1, JSON.stringify(done)); await shot('stuck'); }
  }
}
await shot('tracks')

// album art
const artInput = await page.$('div.art-upload input[type=file]')
if(artInput){ await artInput.setInputFiles('/tmp/opencode/bc-release/artwork-1400.png'); console.log('art uploaded'); await page.waitForTimeout(8000) }
await shot('art')

// save draft
await page.evaluate(() => {
  const b = document.querySelector('a.save-draft')
  if(b) b.click()
})
await page.waitForTimeout(6000)
console.log('URL after save:', page.url())
await shot('saved')
await browser.close()
