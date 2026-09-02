import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
for (const slug of ['signal-depth','signal-depth-2','signal-depth-3']) {
  await page.goto(`https://andra-network.bandcamp.com/album/${slug}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  const editLink = await page.evaluate(() => {
    const a = document.querySelector('a[href*="edit_album"]')
    return a ? a.getAttribute('href') : null
  })
  console.log(slug, 'editLink=', editLink)
  if (editLink) {
    await page.goto('https://andra-network.bandcamp.com' + editLink, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    const info = await page.evaluate(() => {
      const bodyTxt = (document.body.innerText||'')
      const delHints = bodyTxt.split('\n').filter(l=>/delete|discard|remove/i.test(l)).slice(0,6)
      const delLinks = Array.from(document.querySelectorAll('a[href*="delete"], form[action*="delete"], button, [class*="menu"] a, [class*="dropdown"] a, [data-test*="delete"]'))
        .filter(x => /delete|discard/i.test((x.innerText||'')+(x.getAttribute('href')||'')+(x.getAttribute('data-test')||'')))
        .map(x => ({ tag:x.tagName, href:x.getAttribute('href'), dt:x.getAttribute('data-test'), txt:(x.innerText||'').trim().slice(0,40), cls:(x.className||'').toString().slice(0,60) }))
      return { url: location.href, delHints, delLinks }
    })
    console.log(JSON.stringify(info))
  }
}
await browser.close()
