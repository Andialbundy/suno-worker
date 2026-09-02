import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
page.on('response', async r => {
  const u = r.url()
  if (/get_edit_tralbum|edit_album|tralbum|album_info|load_album/i.test(u) && !/\.js|\.css|ga\./i.test(u)) {
    try { const j = await r.json(); const s = JSON.stringify(j); if (s.includes('title') || s.includes('SIGNAL')) console.log('API:', u.slice(0,80), '=>', s.slice(0, 500)) } catch(e){}
  }
})
await page.goto('https://andra-network.bandcamp.com/edit_album?id=781157310', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
const dump = await page.evaluate(() => {
  const inp = document.querySelector('input.title.required')
  const koData = inp ? window.ko.dataFor(inp) : null
  return {
    inputVal: inp ? inp.value : null,
    koTitle: koData && typeof koData.title === 'function' ? koData.title() : null,
    untitled: koData ? (typeof koData.untitledAlbumText === 'function' ? koData.untitledAlbumText() : null) : null,
  }
})
console.log('DUMP:', JSON.stringify(dump))
await browser.close()
