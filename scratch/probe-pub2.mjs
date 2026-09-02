import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
await page.goto('https://andra-network.bandcamp.com/edit_album?id=781157310', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
const dump = await page.evaluate(() => {
  const texts = Array.from(document.querySelectorAll('.publish-confirm, .publish-modal, .modal, [class*="publish"], #dialog, [role="dialog"]'))
    .map(d => ({ cls: (d.className||'').toString().slice(0,50), txt: (d.innerText||'').slice(0,300).replace(/\s+/g,' ') }))
    .filter(x => x.txt)
  const visible = Array.from(document.querySelectorAll('button, a.btn, a[class*="btn"]'))
    .filter(b => b.offsetParent !== null && /publish|confirm|ready|yes|sell/i.test(b.innerText||''))
    .map(b => ({ tag: b.tagName, cls: (b.className||'').join?.()||(b.className||'').toString().slice(0,60), txt: (b.innerText||'').trim().slice(0,60), dt: b.getAttribute('data-test') }))
  return { dialogs: texts, btns: visible }
})
console.log(JSON.stringify(dump, null, 1))
await browser.close()
