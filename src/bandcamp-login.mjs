import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const EMAIL = 'info@andra.network'
const PASSWORD = 'Produkt8600?'
const OUT = '/tmp/opencode/bandcamp'

const ctx = await chromium.launchPersistentContext('/home/crd-remote/.bandcamp-profile', {
  headless: false,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
})
const page = ctx.pages()[0] ?? (await ctx.newPage())

await page.goto('https://bandcamp.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(4000)

let loggedIn = page.url().includes('/login')
if (loggedIn) {
  await page.fill('#username-field', EMAIL)
  await page.fill('#password-field', PASSWORD)
  await page.evaluate(() => {
    const form = document.querySelector('form')
    if (form && typeof form.requestSubmit === 'function') form.requestSubmit()
  })
  await page.waitForTimeout(9000)
}
console.log('POST-LOGIN URL:', page.url())

const state = await ctx.storageState()
writeFileSync(`${OUT}/storage.json`, JSON.stringify(state))
console.log('storage.json saved')

await page.goto('https://bandcamp.com/band_settings', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(6000)
console.log('SETTINGS URL:', page.url())
console.log('SETTINGS TEXT:', JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 500)))

const inputs = await page.evaluate(() =>
  Array.from(document.querySelectorAll('input')).map((i) => ({ name: i.name, id: i.id, type: i.type, ph: i.placeholder, val: (i.value || '').slice(0, 40) }))
)
console.log('INPUTS:', JSON.stringify(inputs, null, 1))
const textareas = await page.evaluate(() =>
  Array.from(document.querySelectorAll('textarea')).map((t) => ({ id: t.id, name: t.name, ph: t.placeholder, val: (t.value || '').slice(0, 40) }))
)
console.log('TEXTAREAS:', JSON.stringify(textareas))
const buttons = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button, input[type=submit], a.button'))
    .map((b) => (b.textContent || b.value || '').trim().slice(0, 50)).filter(Boolean).slice(0, 50)
)
console.log('BUTTONS:', JSON.stringify(buttons))
const labels = await page.evaluate(() =>
  Array.from(document.querySelectorAll('label')).map((l) => ({ for: l.htmlFor, text: (l.textContent || '').trim().slice(0, 50) })).slice(0, 50)
)
console.log('LABELS:', JSON.stringify(labels))

await page.screenshot({ path: `${OUT}/band-settings-diag.png`, fullPage: false })
console.log('diag screenshot saved. keeping open 10 min ...')
await page.waitForTimeout(600000)
await ctx.close()
console.log('browser closed')