import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('/tmp/opencode/bandcamp/storage.json','utf8'))
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
await ctx.addCookies(state.cookies)
const page = await ctx.newPage()
await page.goto('https://andra-network.bandcamp.com/edit_album?id=781157310', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
const inputs = await page.locator('input').all()
for (let i=0;i<inputs.length;i++){
  const el = inputs[i]
  const t = await el.getAttribute('type').catch(()=>null)
  const n = await el.getAttribute('name').catch(()=>null)
  const cls = await el.getAttribute('class').catch(()=>null)
  const ph = await el.getAttribute('placeholder').catch(()=>null)
  const v = await el.inputValue().catch(()=>null)
  if (t==='number' || n?.includes('price') || cls?.includes('price') || ph?.includes('price') || (t==='text'&&v?.includes('.'))) 
    console.log(`INPUT i${i} type=${t} name=${n} cls=${(cls||'').slice(0,40)} val=${v}`)
}
const sel = await page.locator('select').all()
for (let i=0;i<sel.length;i++){
  const n = await sel[i].getAttribute('name').catch(()=>null)
  const o = await sel[i].locator('option').all()
  const vals = []
  for (const op of o.slice(0,8)) vals.push(await op.getAttribute('value').catch(()=>null))
  console.log(`SELECT i${i} name=${n} options=${vals.join(',')}`)
}
for (const link of ['a.save-draft','[data-test="save-draft-button"]','a.publish','[class*="ublish"]','a[href*="publish"]']){
  const cnt = await page.locator(link).count().catch(()=>0)
  if (cnt) { const t = await page.locator(link).first().innerText().catch(()=>''); const dv = await page.locator(link).first().getAttribute('data-test').catch(()=>null); console.log(`LINK ${link}: cnt=${cnt} text="${(t||'').trim().slice(0,40)}" data-test=${dv}`) }
}
console.log('URL:', page.url())
await page.screenshot({ path: '/tmp/opencode/bandcamp/pub-probe.png' })
await browser.close()
