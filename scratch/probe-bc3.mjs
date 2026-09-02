import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true, args:['--no-sandbox'] })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
await page.goto('https://andra-network.bandcamp.com/edit_album', { waitUntil:'domcontentloaded', timeout:45000 })
await page.waitForTimeout(3000)
const r = await page.evaluate(() => {
  const files = [...document.querySelectorAll('input[type=file]')].map(f => ({accept:f.accept, parent:(f.parentElement?.className||f.closest('div')?.className||'').slice(0,70)}))
  const uploadZones = [...document.querySelectorAll('div,a,label')].filter(e => /upload|drop|drag|add (audio|files|image|artwork|photo)|image|artwork/i.test(e.textContent||'')).slice(0,20).map(e=>`<${e.tagName}.${(e.getAttribute('class')||'').slice(0,50)}> ${(e.textContent||'').trim().slice(0,60)}`)
  const actions = [...document.querySelectorAll('button,a')].filter(e=>/save|publish|continue|next|finish|done|cancel/i.test(e.textContent||'')).map(e=>`<${e.tagName}.${(e.getAttribute('class')||'').slice(0,40)}> ${(e.textContent||'').trim().slice(0,40)}`)
  return { files, uploadZones, actions }
})
console.log(JSON.stringify(r,null,1))
await browser.close()
