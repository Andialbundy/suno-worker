import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json', 'utf8'))
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()

const BIO = `The Andra Network — underground electronic music label. Dark, hypnotic soundscapes from human curation and AI-assisted production. Six artist identities: hardstyle, trance, psytrance, ambient techno, deep house, ambient psy. Lossless digital releases.`

await page.goto('https://andra-network.bandcamp.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(4000)

// --- Bio: a.bio-text-add per JS klicken, dann füllen (force) ---
await page.evaluate(() => {
  const link = document.querySelector('a.bio-text-add')
  if (link) link.click()
})
console.log('bio trigger force-clicked')
await page.waitForTimeout(1500)
const ta = page.locator('form.edit-bio-text-form textarea')
if (await ta.count()) {
  await ta.fill(BIO, { force: true })
  const saveBtn = page.locator('form.edit-bio-text-form button').filter({ hasText: 'save' }).first()
  if (await saveBtn.count()) {
    await saveBtn.click({ force: true })
    console.log('bio save clicked')
  } else {
    await page.locator('form.edit-bio-text-form').evaluate((f) => f.requestSubmit && f.requestSubmit())
    console.log('bio form submitted')
  }
  await page.waitForTimeout(6000)
} else {
  console.log('WARN: no bio textarea')
}

// --- Profilbild: File-Input direkt setzen ---
const fileInput = page.locator('div.html5-upload-wrapper input[type=file], input[type=file][accept="image/*"]').first()
if (await fileInput.count()) {
  await fileInput.setInputFiles('/tmp/opencode/bandcamp/profile-symbol.png')
  console.log('photo file set')
  await page.waitForTimeout(8000)
} else {
  console.log('WARN: no file input')
}

const t = await page.evaluate(() => document.body.innerText.slice(0, 400))
console.log('PAGE TEXT:', JSON.stringify(t.replace(/\n+/g, ' | ')))
const bioPicImg = await page.evaluate(() => {
  const img = document.querySelector('div.artists-bio-pic img')
  return img ? { src: img.src.slice(0, 90), w: img.naturalWidth } : null
})
console.log('BIO PIC IMG:', JSON.stringify(bioPicImg))
await page.screenshot({ path: '/tmp/opencode/bandcamp/bandpage-after.png', fullPage: false })
await browser.close()
console.log('done')