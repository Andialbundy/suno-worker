import { chromium } from 'playwright'
import fs from 'fs'
const state = JSON.parse(fs.readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
await page.goto('https://andra-network.bandcamp.com', { waitUntil: 'domcontentloaded' })
// find add album link
const link = await page.evaluate(() => {
  const a = document.querySelector('a.add-music-link, a[href*="edit_album"], a[href*="edit_artist"]')
  return a ? a.href : null
})
console.log('ADD-LINK:', link)
if (!link) { console.log('NO ADD LINK - DOM:'); console.log((await page.content()).slice(0,500)); process.exit(1) }
await page.goto(link, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
console.log('URL:', page.url())
const titleSel = 'input.title.required, input#album-name, input[name*="title"][class*="title"]'
const hasTitle = await page.locator(titleSel).count()
console.log('TITLE-SEL count:', hasTitle, 'sel:', titleSel)
await page.locator(titleSel).first().fill('SIGNAL DEPTH')
console.log('title filled')
// set first track file
const fileInput = page.locator('ol.tracks li.add-audio input[type=file], div.audio-upload input[type=file]').first()
console.log('FILE-INPUT count:', await page.locator('input[type=file]').count())
await fileInput.setInputFiles('/tmp/opencode/bc-release/GLASS_HALO_DRIFT_EXTENDED.mp3')
console.log('file 1 set at', new Date().toISOString().slice(11,19))
// poll DOM for row lifecycle
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(5000)
  const info = await page.evaluate(() => {
    const lis = [...document.querySelectorAll('ol.tracks li')]
    const rows = lis.map(li => {
      const cls = li.className
      const hasTitle = !!li.querySelector('input.track-title, input[placeholder*="track"]')
      const prog = li.querySelector('[class*="progress"], [class*="percent"], .upload-progress')
      const pct = prog ? (prog.textContent||'').trim() : null
      const spinner = !!li.querySelector('.spinner, [class*="loading"]')
      return { cls: String(cls).slice(0,40), hasTitle, pct, spinner }
    })
    const saveDraft = !!document.querySelector('a.save-draft')
    return { rows, saveDraft }
  })
  console.log(i, JSON.stringify(info))
  if (info.rows.length >= 1 && info.rows[0].hasTitle && !info.rows[0].spinner) { console.log('ROW READY'); break }
}
await page.screenshot({ path: '/tmp/opencode/bandcamp/probe-upload.png' })
await browser.close()
