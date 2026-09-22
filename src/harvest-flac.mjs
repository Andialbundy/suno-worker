// harvest-flac.mjs - Audio capture & FLAC transcode utilities
// Extracted from probe-harvest*.mjs and worker.mjs

export const MSE_PATCH = `
window.__segs = []
window.__msCount = 0
const origAdd = MediaSource.prototype.addSourceBuffer
MediaSource.prototype.addSourceBuffer = function (mime) {
  const sb = origAdd.call(this, mime)
  window.__msCount++
  const origAppend = sb.appendBuffer.bind(sb)
  sb.appendBuffer = (data) => {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    const copy = new Uint8Array(bytes.byteLength || bytes.length || 0)
    copy.set(bytes)
    window.__segs.push(copy)
    if (window.__segs.length > 6000) window.__segs = window.__segs.slice(-3000)
    return origAppend(data)
  }
  return sb
}
`

export async function harvestSegments(page, clipId, maxWaitSec = 300) {
  await page.addInitScript(MSE_PATCH)
  await page.goto(`https://suno.com/song/${clipId}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(3000)

  let lastBytes = 0, lastCount = 0, stableRounds = 0, dur = 0
  const maxIter = maxWaitSec / 4

  for (let i = 0; i < maxIter; i++) {
    // Click play if needed
    for (const el of await page.$$('button[aria-label="Play"]')) {
      try { 
        const b = await el.boundingBox() 
        if (b && b.width > 0 && b.height > 0) { await el.click(); break } 
      } catch {}
    }
    
    const st = await page.evaluate(() => {
      const auds = [...document.querySelectorAll('audio')].map(a => ({ 
        src: a.src, dur: a.duration, cur: a.currentTime, 
        buffered: a.buffered && a.buffered.length ? a.buffered.end(a.buffered.length - 1) : 0, 
        paused: a.paused 
      }))
      const total = window.__segs.reduce((n, s) => n + s.byteLength, 0)
      return { count: window.__segs.length, total, auds }
    }).catch(() => null)
    
    if (!st) break
    const bufEnd = st.auds.find(a => !a.src.includes('sil-100'))?.buffered || 0
    dur = st.auds.find(a => !a.src.includes('sil-100'))?.dur || dur
    console.log(`[${i}] segs=${st.count} bytes=${st.total} bufferedEnd=${bufEnd} dur=${dur}`)
    
    if (dur > 0 && bufEnd >= dur - 1) {
      if (st.total === lastBytes) stableRounds++
      else stableRounds = 0
      if (stableRounds >= 2) { console.log('FULLY BUFFERED'); break }
    }
    if (st.count > 0 && st.total === lastBytes && st.count === lastCount) {
      stableRounds++
      if (stableRounds >= 4) { console.log('STABLE (maybe done)'); break }
    } else stableRounds = 0
    lastBytes = st.total; lastCount = st.count
    await page.waitForTimeout(4000)
  }

  const final = await page.evaluate(() => {
    const total = window.__segs.reduce((n, s) => n + s.byteLength, 0)
    return { count: window.__segs.length, total }
  }).catch(() => ({ count: 0, total: 0 }))
  console.log('FINAL segs:', JSON.stringify(final))
  return final
}

export async function transcodeToFlac(inputPath, outputPath) {
  const { execFileSync } = await import('child_process')
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', inputPath, '-c:a', 'flac', '-compression_level', '8', outputPath], { stdio: 'ignore' })
}

export function fallbackMp3ToFlac(buffer, { metadata = {} } = {}) {
  // Simple fallback: write buffer as-is (assumes it's already a valid audio format)
  // In production, this would use ffmpeg to transcode
  return buffer
}

export function probeSeconds(filePath) {
  const { execFileSync } = require('child_process')
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filePath], { encoding: 'utf8' })
    const j = JSON.parse(out.trim())
    return parseFloat(j.format?.duration || 0)
  } catch {
    return 0
  }
}