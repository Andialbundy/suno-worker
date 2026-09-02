import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BRAND = '/tmp/opencode/andranet-next/public/brand'
const OUT = '/tmp/opencode/bandcamp'
const ctx = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const page = await ctx.newPage()

// --- Profilbild: Portal-A Symbol, transparent, 600x600 ---
await page.setViewportSize({ width: 600, height: 600 })
await page.goto(`file://${BRAND}/portal-a-symbol-positive.svg`)
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/profile-symbol.png`, omitBackground: true, clip: { x: 0, y: 0, width: 600, height: 600 } })
console.log('profile-symbol.png done')

// --- Banner: dunkler Verlauf + Wordmark (white), 1400x300 ---
const wordmark = readFileSync(`${BRAND}/wordmark-andra-negative.svg`, 'utf8')
const html = `<!doctype html><html><head><style>
  * { margin:0; padding:0; }
  body { width:1400px; height:300px; overflow:hidden;
    background: linear-gradient(135deg, #07030b 0%, #150a1e 38%, #2a0a33 62%, #09060f 100%); }
  .glow { position:absolute; width:520px; height:520px; border-radius:50%;
    background: radial-gradient(circle, rgba(157,0,255,0.35) 0%, rgba(0,245,255,0.12) 45%, transparent 70%);
    top:-260px; right:-60px; }
  .glow2 { position:absolute; width:460px; height:460px; border-radius:50%;
    background: radial-gradient(circle, rgba(0,245,255,0.22) 0%, transparent 65%);
    bottom:-230px; left:-80px; }
  .wm { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; }
  .wm svg { width: 560px; height: auto; }
</style></head><body>
  <div class="glow"></div><div class="glow2"></div>
  <div class="wm">${wordmark}</div>
</body></html>`
const { writeFileSync } = await import('node:fs')
writeFileSync(`${OUT}/banner.html`, html)
await page.setViewportSize({ width: 1400, height: 300 })
await page.goto(`file://${OUT}/banner.html`)
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/banner-wordmark.png`, clip: { x: 0, y: 0, width: 1400, height: 300 } })
console.log('banner-wordmark.png done')

await ctx.close()
console.log('done')