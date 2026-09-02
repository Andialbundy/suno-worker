import { chromium } from 'playwright'
import os from 'os'
import path from 'path'

const PROFILE_DIR = path.join(os.homedir(), '.suno-profile')

const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--profile-directory=Default'],
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
})

const page = browser.pages()[0] ?? (await browser.newPage())
await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(8000)

console.log('=== URL:', page.url())

const info = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('button')].map(b => ({
    text: (b.textContent || '').trim().slice(0, 60),
    aria: b.getAttribute('aria-label'),
    disabled: b.disabled,
  }))
  const inputs = [...document.querySelectorAll('input')].map(i => ({
    ph: i.placeholder,
    aria: i.getAttribute('aria-label'),
    type: i.type,
    name: i.name,
  }))
  const textareas = [...document.querySelectorAll('textarea')].map(t => ({
    ph: t.placeholder,
    aria: t.getAttribute('aria-label'),
    rows: t.rows,
  }))
  const bodyText = document.body.innerText.slice(0, 4000)
  return { buttons, inputs, textareas, bodyText }
})

console.log('=== BUTTONS:')
info.buttons.forEach(b => console.log(' ', JSON.stringify(b)))
console.log('=== INPUTS:')
info.inputs.forEach(i => console.log(' ', JSON.stringify(i)))
console.log('=== TEXTAREAS:')
info.textareas.forEach(t => console.log(' ', JSON.stringify(t)))
console.log('=== BODYTEXT (4000):')
console.log(info.bodyText)

await browser.close()