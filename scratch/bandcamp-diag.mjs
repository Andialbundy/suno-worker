import { chromium } from 'playwright'

const ctx = await chromium.launchPersistentContext('/home/crd-remote/.bandcamp-profile', {
  headless: true,
  args: ['--no-sandbox'],
})
const page = await ctx.newPage()
await page.goto('https://bandcamp.com/band_settings', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(4000)
console.log('URL:', page.url())

const inputs = await page.evaluate(() =>
  Array.from(document.querySelectorAll('input')).map((i) => ({
    name: i.name, id: i.id, type: i.type, placeholder: i.placeholder, value: (i.value || '').slice(0, 40),
  }))
)
console.log('INPUTS:', JSON.stringify(inputs, null, 1))

const textareas = await page.evaluate(() =>
  Array.from(document.querySelectorAll('textarea')).map((t) => ({ id: t.id, name: t.name, ph: t.placeholder, val: (t.value || '').slice(0, 40) }))
)
console.log('TEXTAREAS:', JSON.stringify(textareas))

const selects = await page.evaluate(() =>
  Array.from(document.querySelectorAll('select')).map((s) => ({ id: s.id, name: s.name }))
)
console.log('SELECTS:', JSON.stringify(selects))

const buttons = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button, input[type=submit], a.button'))
    .map((b) => (b.textContent || b.value || '').trim().slice(0, 40))
    .filter(Boolean).slice(0, 40)
)
console.log('BUTTONS:', JSON.stringify(buttons))

const labels = await page.evaluate(() =>
  Array.from(document.querySelectorAll('label')).map((l) => ({ for: l.htmlFor, text: (l.textContent || '').trim().slice(0, 50) })).slice(0, 40)
)
console.log('LABELS:', JSON.stringify(labels))

await page.screenshot({ path: '/tmp/opencode/bandcamp/band-settings-diag.png', fullPage: false })
await ctx.close()
console.log('diag done')