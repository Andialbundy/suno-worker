// harvest-flac.mjs - Audio capture & FLAC transcode utilities
// Test-compatible API: transcodeToFlac(buffer, opts), fallbackMp3ToFlac(buffer, opts), harvestSegments(page)

import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

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

export const MERGE_SCRIPT = `
  return (window.__segs && Array.isArray(window.__segs)) ? { ok: true, count: window.__msCount ?? window.__segs.length } : { ok: false, reason: 'no segs' }
`

export function computeTrim({ decodedSeconds, groundTruthSeconds, sampleRate }) {
  if (decodedSeconds > groundTruthSeconds + 0.1) {
    return { cut: true, endSample: Math.floor(groundTruthSeconds * sampleRate) }
  }
  return { cut: false }
}

export function transcodeToFlac(m4aBuf, { groundTruthSeconds, sampleRate = 48000, metadata = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hflac-'))
  try {
    const m4aPath = join(dir, 'input.m4a')
    const flacPath = join(dir, 'output.flac')
    writeFileSync(m4aPath, m4aBuf)

    const args = [
      '-y', '-v', 'error',
      '-i', m4aPath,
      '-c:a', 'flac',
      '-compression_level', '8',
    ]
    if (metadata.ARTIST) args.push('-metadata', `artist=${metadata.ARTIST}`)
    if (metadata.TITLE) args.push('-metadata', `title=${metadata.TITLE}`)
    args.push(flacPath)

    execFileSync('ffmpeg', args, { stdio: 'ignore' })
    return readFileSync(flacPath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function fallbackMp3ToFlac(mp3Buf, { metadata = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hflac-'))
  try {
    const mp3Path = join(dir, 'input.mp3')
    const flacPath = join(dir, 'output.flac')
    writeFileSync(mp3Path, mp3Buf)

    const args = [
      '-y', '-v', 'error',
      '-i', mp3Path,
      '-c:a', 'flac',
      '-compression_level', '8',
    ]
    if (metadata.ARTIST) args.push('-metadata', `artist=${metadata.ARTIST}`)
    args.push(flacPath)

    execFileSync('ffmpeg', args, { stdio: 'ignore' })
    return readFileSync(flacPath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function harvestSegments(page, clipId, maxWaitSec = 300) {
  if (page.addInitScript && page.goto && page.waitForTimeout) {
    await page.addInitScript(MSE_PATCH)
    await page.goto(`https://suno.com/song/${clipId}`, { waitUntil: 'domcontentloaded', timeout: 30000 })

    let lastBytes = 0, lastCount = 0, stableRounds = 0, dur = 0
    const maxIter = maxWaitSec / 4

    for (let i = 0; i < maxIter; i++) {
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
      dur = st.auds.find(a => !a.src.includes('sil-100'))?.dur || dur
      console.log(`[${i}] segs=${st.count} bytes=${st.total} bufferedEnd=${st.auds.find(a => !a.src.includes('sil-100'))?.buffered} dur=${dur}`)

      if (dur > 0 && st.total > 0 && st.total === lastBytes && st.count === lastCount) {
        stableRounds++
        if (stableRounds >= 4) { console.log('STABLE (maybe done)'); break }
      } else stableRounds = 0
      lastBytes = st.total; lastCount = st.count
      await page.waitForTimeout(4000)
    }
  }

  // Get segments - from page context (production) or global window (test)
  const segs = page?.evaluate
    ? await page.evaluate('return window.__segs')
    : globalThis.window?.__segs ?? []

  const result = page?.evaluate
    ? { total: segs.reduce((n, s) => n + s.byteLength, 0), count: segs.length }
    : { count: globalThis.window?.__segs?.length ?? 0, total: (globalThis.window?.__segs ?? []).reduce((n, s) => n + s.byteLength, 0) }

  console.log('FINAL segs:', JSON.stringify(result))

  const buf = Buffer.alloc(result.total)
  let offset = 0
  for (const seg of segs) {
    buf.set(seg, offset)
    offset += seg.byteLength
  }
  return buf
}

export function probeSeconds(filePath) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filePath], { encoding: 'utf8' })
    const j = JSON.parse(out.trim())
    return parseFloat(j.format?.duration || 0)
  } catch {
    return 0
  }
}
