import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true, args:['--no-sandbox'] })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
await page.goto('https://andra-network.bandcamp.com/edit_album', { waitUntil:'domcontentloaded', timeout:45000 })
await page.waitForTimeout(2500)
const info = await page.evaluate(() => {
  const q = s => document.querySelector(s)
  const title = q('input.title.required')?.value ?? null
  const rows = [...document.querySelectorAll('ol.tracks li')].map(l => ({
    cls: l.className, title: l.querySelector('input.title, input[name*="title"]')?.value ?? null,
    hasInput: !!l.querySelector('input[type=file]'),
    addAudio: !!l.querySelector('.add-audio, a.add-audio, .audio-upload')
  }))
  const fileInputs = [...document.querySelectorAll('input[type=file]')].map(i => ({
    accept: i.getAttribute('accept'), cls: i.closest('li')?.className ?? i.closest('div')?.className ?? '', cls2: i.parentElement?.className
  }))
  const saveDraft = !!q('a.save-draft')
  const artImg = q('.art-upload img, .image-preview img')?.src ?? null
  const url = location.href
  return { title, url, rowsCount: rows.length, rows, fileInputs, saveDraft, artImg }
})
console.log(JSON.stringify(info, null, 1))
await browser.close()
