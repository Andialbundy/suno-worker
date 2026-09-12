/**
 * Regenerate FLAC masters for the 13 tracks whose source .m4a is corrupt
 * (no moov atom). Re-harvest each from Suno via MSE on the live clip,
 * transcode to FLAC, apply HUD cover + metadata, copy to QNAP.
 *
 * Usage:
 *   xvfb-run -a node --env-file=.env regen-missing-13.mjs          # all 13
 *   xvfb-run -a node --env-file=.env regen-missing-13.mjs 0        # only first (smoke)
 *   xvfb-run -a node --env-file=.env regen-missing-13.mjs 3 6      # tracks [3..6]
 *
 * Logs to /tmp/andra-regen13.log
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync, existsSync, rmSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'path'
import { chromium } from 'playwright'

import { transcodeToFlac, MSE_PATCH, harvestSegments, probeSeconds } from './src/harvest-flac.mjs'
import { renderHudCover } from './src/render-cover-hud.mjs'
// probeFlacSeconds moved to inline below; readFile import removed (was unused)

const QNAP_BASE = '/mnt/qnap-multimedia/Musik/andra.network'
const LOG_FILE = '/tmp/andra-regen13.log'
const CHROME_PROFILE = '/home/crd-remote/suno-regen-chrome'

const MISSING = [
  { id: '94f2dc7b-a866-49a5-8397-f1e920a44154', clip: '9a4c4329-9796-4090-8324-d40923de0c49', artist: 'ANDRAMON', title: 'THIRD LOOP', bpm: 144 },
  { id: 'a7f37fba-e879-4fed-aa2c-9993002dd0de', clip: 'd7ff4fce-346c-4b46-a972-51ed02fde6c5', artist: 'DYBUN', title: 'HOLLOW DRIFT ORIGINAL MIX', bpm: 122 },
  { id: 'b51dd0e5-4a9c-498d-bb87-2ae7e57f202b', clip: '734ac36b-69f6-45ec-94e4-53357dd41775', artist: 'NALDIX', title: 'DARK STRUCTURE EXTENDED MIX', bpm: 122 },
  { id: '51be242b-1c9c-4e4f-a68a-a1d9a41898dc', clip: '18ac9422-dc49-4a2c-89e0-e5a6f15c5062', artist: 'NALDIX', title: 'HYPNOTIC GROOVE EDIT', bpm: 122 },
  { id: '101c6ee8-fef6-4dec-be36-e8a7d4ca6b76', clip: '2bebf936-f694-4208-8bc1-4871989a1beb', artist: 'NALDIX', title: 'INNER SYSTEM', bpm: 118 },
  { id: 'ba8d5df8-2483-4986-ade0-758df9969e58', clip: 'c085a595-cf9e-41f8-bfea-48e8c01d6d85', artist: 'NALDIX', title: 'INNER SEQUENCE EDIT', bpm: 122 },
  { id: '719a8736-c926-42ec-bd53-6b47218724b8', clip: '819a3f93-2c09-48ca-b032-a16325bf9e59', artist: 'BUNDIX', title: 'UPLIFTING PULSE', bpm: 136 },
  { id: '88acecf2-a014-4ba5-9d4d-a3fa7d4a4db0', clip: 'a0f4edc6-45b9-4869-b1b2-31cbe302a008', artist: 'NALDIX', title: 'RAW PATTERN ORIGINAL MIX', bpm: 125 },
  { id: '2130c6e8-333c-43e0-b282-f9598261630b', clip: '1d3333c6-fbd8-4f37-80e9-b0d2c3e421cb', artist: 'NALDIX', title: 'MINIMAL PATTERN VIP', bpm: 123 },
  { id: 'e31e942d-88c4-44e5-9020-141303285a49', clip: 'ba1f7806-9e2d-4ead-bb14-6e220e2ad883', artist: 'NALDIX', title: 'DENSE MECHANISM EDIT', bpm: 118 },
  { id: '72049ea8-2bf8-4795-a930-2826a127871e', clip: '9bc1c221-ea0b-4175-8d47-f7d69b0e09fe', artist: 'ANDRAX', title: 'INTENSE WAVE', bpm: 150 },
  { id: '5c7303fc-a098-47f5-8297-dc1304593f70', clip: 'e4858f07-c1f5-489b-85a8-e7aa7e6d33e0', artist: 'NALDIX', title: 'DENSE MOTION', bpm: 119 },
  { id: '361e0a47-fb7e-48de-986a-af8801991500', clip: '34705f20-4005-4848-a8fb-4b798956096b', artist: 'NALDIX', title: 'SILENT CIRCUIT EDIT', bpm: 122 }
]

const ARTIST_CONFIG = {
  BUNDIX: { accent: '#7df9ff', accent2: '#4dd0e1', titleGradient: ['#eafcff', '#9de6ff', '#6ec6ff'] },
  ANDRAX: { accent: '#ff5a3c', accent2: '#ff9d2e', titleGradient: ['#fff3e8', '#ff9d5a', '#ff4d3c'] },
  DYBUN: { accent: '#7dff5a', accent2: '#39e675', titleGradient: ['#f2ffea', '#b4ff8a', '#55e675'] },
  ANDRAMON: { accent: '#c75bff', accent2: '#7a5bff', titleGradient: ['#ffffff', '#d88bff', '#a05bff'] },
  NALDIX: { accent: '#ffd166', accent2: '#ff9e4d', titleGradient: ['#fff8e6', '#ffd97a', '#ffa055'] },
  AERYN: { accent: '#b39dff', accent2: '#7d8bff', titleGradient: ['#ffffff', '#c7b3ff', '#8d7bff'] }
}

const SUPABASE_URL = 'https://sgvguaaccmzevipfwdbn.supabase.co'
const sb = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  writeFileSync(LOG_FILE, line + '\n', { flag: 'a' })
}

function runPython(script) {
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8', timeout: 120000 })
  if (result.status !== 0) throw new Error(`Python script failed: ${result.stderr}`)
  return result.stdout.trim()
}

async function downloadFile(url, destPath) {
  const response = await fetch(url, {
    headers: {
      'Origin': 'https://suno.com',
      'Referer': 'https://suno.com/'
    }
  })
  if (!response.ok) throw new Error(`Download failed: ${response.status}`)
  writeFileSync(destPath, Buffer.from(await response.arrayBuffer()))
}

function embedCoverAndMetadata(flacPath, coverPath, metadata) {
  const script = `
import sys
from mutagen.flac import FLAC, Picture
audio = FLAC("${flacPath}")
audio.clear_pictures()
with open("${coverPath}", 'rb') as f:
    pic = Picture()
    pic.type = 3
    pic.mime = 'image/jpeg'
    pic.desc = 'Cover'
    pic.data = f.read()
audio.add_picture(pic)
audio['artist'] = "${metadata.artist}"
audio['title'] = "${metadata.title}"
audio['album'] = 'ANDRA NETWORK'
audio['date'] = '2026'
audio['genre'] = "${metadata.genre}"
audio['label'] = 'ANDRA NETWORK'
audio['organization'] = 'ANDRA NETWORK'
audio['grouping'] = "${metadata.artist}"
audio['comment'] = "${metadata.comment}"
audio['replaygain_track_gain'] = '0.00 dB'
audio.save()
print("OK")
`
  runPython(script)
}

async function harvestFromSuno(clip, groundTruthSeconds) {
  const profileDir = '/home/crd-remote/.suno-profile'
  const browser = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    acceptDownloads: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--profile-directory=Default', '--disable-gpu', '--disable-setuid-sandbox', '--disable-extensions', '--no-zygote']
  })
  try {
    const page = browser.pages()[0] ?? await browser.newPage()
    await page.addInitScript(MSE_PATCH)

    let audioDownloadUrl = null
    page.on('response', async (res) => {
      const url = res.url()
      const ct = res.headers()['content-type'] || ''
      if ((url.includes('suno.com') || url.includes('suno.ai')) && !url.includes('sil-100') && (ct.includes('audio') || url.endsWith('.mp3') || url.endsWith('.m4a')) && !audioDownloadUrl) {
        audioDownloadUrl = url
        log(`  [dl] captured audio response: ${url.slice(0, 120)}`)
      }
    })

    await page.goto(`https://suno.com/song/${clip}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(3000)
    log(`  [dl] opened https://suno.com/song/${clip}`)

    // Retry Play click until the song leaves the sil-100 placeholder
    let ready = false
    for (let i = 0; i < 120; i++) {
      for (const el of await page.$$('button[aria-label="Play"]')) {
        try {
          const box = await el.boundingBox()
          if (box && box.width > 0 && box.height > 0) { await el.click(); break }
        } catch {}
      }
      const srcs = await page.evaluate(() =>
        [...document.querySelectorAll('audio')].map(a => a.src).filter(Boolean))
      if (srcs.some(s => !s.includes('sil-100'))) { ready = true; break }
      await page.waitForTimeout(15000)
    }
    if (!ready) throw new Error('Song never left placeholder state')
    log(`  [dl] playback ready`)

    // Harvest via MSE
    let m4aBuf = await harvestSegments(page)
    if (!m4aBuf || m4aBuf.length < 1000) {
      // MSE harvest failed; try download menu flow (worker.mjs method)
      log(`  [dl] MSE empty, trying download menu flow`)
      try {
// Suno may show "Restore to Library" instead of "Download" if the clip
    // was moved to Trash. Restore first, then the Download menu appears.
    let restored = false
    for (let attempt = 0; attempt < 3 && !restored; attempt++) {
      const menuBtn = await page.$('button[aria-label="More menu contents"]')
      if (!menuBtn) { log(`  [dl] more menu button not found (attempt ${attempt + 1})`); break }
      await menuBtn.click()
      await page.waitForTimeout(800)
      const items = await page.evaluate(() =>
        [...document.querySelectorAll('[role="menuitem"], button, a')].map(el => el.textContent?.trim()).filter(Boolean)
      )
      const hasRestore = items.some(t => /Restore to Library/i.test(t))
      const hasDownload = items.some(t => /^Download$/i.test(t))
      log(`  [dl] menu items: ${JSON.stringify(items.slice(0, 12))}`)
      if (hasRestore && !hasDownload) {
        log(`  [dl] clip in Trash — clicking Restore to Library`)
        const restoreBtn = await page.getByText('Restore to Library', { exact: true }).first()
        if (await restoreBtn.count()) {
          await restoreBtn.click()
          restored = true
          await page.waitForTimeout(3000)
          log(`  [dl] restored, re-opening More menu`)
          // After restore, we may need to reload the page or wait for UI to update
          // Try clicking the More menu again to see if Download appears
          const menuBtn2 = await page.$('button[aria-label="More menu contents"]')
          if (menuBtn2) {
            await menuBtn2.click()
            await page.waitForTimeout(1000)
            const items2 = await page.evaluate(() =>
              [...document.querySelectorAll('[role="menuitem"], button, a')].map(el => el.textContent?.trim()).filter(Boolean)
            )
            log(`  [dl] items after restore: ${JSON.stringify(items2.slice(0, 12))}`)
            const hasDownload2 = items2.some(t => /^Download$/i.test(t))
            if (hasDownload2) {
              restored = true
              log(`  [dl] Download found after restore`)
            } else {
              // Check if we're on a different URL now (new song page after restore)
              const currentUrl = page.url()
              log(`  [dl] current URL after restore: ${currentUrl}`)
              if (currentUrl.includes('/song/')) {
                // We're on a song page, but Download menu not visible yet
                // Maybe need to wait for page to fully load
                await page.waitForTimeout(5000)
                const items3 = await page.evaluate(() =>
                  [...document.querySelectorAll('[role="menuitem"], button, a')].map(el => el.textContent?.trim()).filter(Boolean)
                )
                const hasDownload3 = items3.some(t => /^Download$/i.test(t))
                if (hasDownload3) {
                  restored = true
                  log(`  [dl] Download found after page load`)
                }
              }
            }
          }
        }
      } else if (hasDownload) {
        restored = true
      } else {
        log(`  [dl] neither Restore nor Download in menu`)
        break
      }
    }

    // Now attempt to download regardless of restore state - check again
    const menuBtn = await page.$('button[aria-label="More menu contents"]')
    if (menuBtn) {
      await menuBtn.click()
      await page.waitForTimeout(800)
      const downloadItem = await page.getByText('Download', { exact: true }).first()
      if (await downloadItem.count()) {
        await downloadItem.hover()
        await page.waitForTimeout(400)
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 20000 }),
          page.getByText('MP3 Audio', { exact: true }).first().click(),
        ])
        const tmpPath = join(tmpdir(), `suno-download-${Date.now()}.mp3`)
        await download.saveAs(tmpPath)
        const mp3Buf = readFileSync(tmpPath)
        const flacBuf = transcodeToFlac(mp3Buf, { groundTruthSeconds: groundTruthSeconds || 240, metadata: { TITLE: 'ANDRA NETWORK' } })
        m4aBuf = flacBuf
        log(`  [dl] download menu succeeded, FLAC ${m4aBuf.length} bytes`)
        try { rmSync(tmpPath, { recursive: true, force: true }) } catch {}
      } else {
        // Last resort: try to find Download using broader search
        log(`  [dl] exact Download not found, trying broader search`)
        const allDownloadBtns = await page.getByText(/Download/, { exact: false }).all()
        if (await allDownloadBtns.count()) {
          const dlBtn = allDownloadBtns[0]
          await dlBtn.hover()
          await page.waitForTimeout(1000)
          const mp3Item = await page.getByText(/MP3 Audio/, { exact: false }).first()
          if (await mp3Item.count()) {
            const [download] = await Promise.all([
              page.waitForEvent('download', { timeout: 20000 }),
              mp3Item.click(),
            ])
            const tmpPath = join(tmpdir(), `suno-download-${Date.now()}.mp3`)
            await download.saveAs(tmpPath)
            const mp3Buf = readFileSync(tmpPath)
            const flacBuf = transcodeToFlac(mp3Buf, { groundTruthSeconds: groundTruthSeconds || 240, metadata: { TITLE: 'ANDRA NETWORK' } })
            m4aBuf = flacBuf
            log(`  [dl] broader search download succeeded, FLAC ${m4aBuf.length} bytes`)
            try { rmSync(tmpPath, { recursive: true, force: true }) } catch {}
          }
        }
      }
    } else {
      log(`  [dl] download menu button not found`)
    }
      } catch (menuErr) {
        log(`  [dl] download menu failed: ${menuErr.message}`)
      }
      // Last resort: use captured audioDownloadUrl from CDN response
      if ((!m4aBuf || m4aBuf.length < 1000) && audioDownloadUrl) {
        log(`  [dl] MSE empty, using captured audio URL: ${audioDownloadUrl.slice(0, 120)}`)
        try {
          const tmpPath = join(tmpdir(), `suno-direct-${Date.now()}.mp3`)
          await downloadFile(audioDownloadUrl, tmpPath)
          const mp3Buf = readFileSync(tmpPath)
          const flacBuf = transcodeToFlac(mp3Buf, { groundTruthSeconds: groundTruthSeconds || 240, metadata: { TITLE: 'ANDRA NETWORK' } })
          m4aBuf = flacBuf
          log(`  [dl] direct fetch FLAC ${m4aBuf.length} bytes`)
          try { rmSync(tmpPath, { recursive: true, force: true }) } catch {}
        } catch (dlErr) {
          log(`  [dl] direct download failed: ${dlErr.message}`)
        }
      }
      if (!m4aBuf || m4aBuf.length < 1000) {
        // Check if this is an unregenerable track (no Download menu in Suno UI)
        const menuBtn = await page.$('button[aria-label="More menu contents"]')
        let hasDownload = false
        if (menuBtn) {
          await menuBtn.click()
          await page.waitForTimeout(800)
          const items = await page.evaluate(() =>
            [...document.querySelectorAll('[role="menuitem"], button, a')].map(el => el.textContent?.trim()).filter(Boolean)
          )
          hasDownload = items.some(t => /^Download$/i.test(t))
        }
        if (!hasDownload) {
          log(`  [dl] UNREGENERABLE: No Download menu available in Suno UI (placeholder buffer ${m4aBuf?.length ?? 0} bytes). Skipping.`)
          return { unregenerable: true, reason: 'No Download menu in Suno UI; MSE harvest only captured sil-100 placeholder' }
        }
        throw new Error('MSE harvest returned empty or too small buffer, and all fallbacks failed')
      }
    } else {
      log(`  [dl] harvested MSE ${m4aBuf.length} bytes`)
    }

    // Transcode to FLAC
    // Try to get ground truth from the harvested m4a if not provided
    let gt = groundTruthSeconds
    if (!gt || gt <= 0) {
      // Decode m4a to wav to get duration
      const dir = mkdtempSync(join(tmpdir(), 'suno-flac-probe-'))
      try {
        const m4aPath = join(dir, 'src.m4a')
        writeFileSync(m4aPath, m4aBuf)
        const wavPath = join(dir, 'decoded.wav')
        execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', m4aPath, '-ac', '2', '-ar', '48000', '-f', 'wav', wavPath])
        const decodedSeconds = probeSeconds(wavPath)
        gt = decodedSeconds
        log(`  [dl] derived ground truth ${gt}s from harvested m4a`)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    const flacBuffer = transcodeToFlac(m4aBuf, { groundTruthSeconds: gt, metadata: { TITLE: 'ANDRA NETWORK' } })
    log(`  [dl] FLAC via MSE ${flacBuffer.length} bytes`)
    return flacBuffer
  } catch (err) {
    throw new Error(`Harvest failed: ${err.message}`)
  } finally {
    await browser.close()
  }
}

async function processTrack(track) {
  const { id, artist, title, clip, bpm } = track
  const artistDir = join(QNAP_BASE, artist, 'flac')
  const flacPath = join(artistDir, `flac_${id}.flac`)

  // Check if a real master FLAC already exists on QNAP; skip only if it's a real master.
  // A real master has duration >= 60s and size >= 5MB. Placeholder/truncated files are regenerated.
  if (existsSync(flacPath)) {
    const stats = statSync(flacPath)
    const duration = probeFlacSeconds(flacPath)
    const isRealMaster = duration >= 60 && stats.size >= 5 * 1024 * 1024
    if (isRealMaster) {
      log(`SKIP ${artist} - ${title} (real master, ${duration}s, ${stats.size} bytes)`)
      return { success: true, skipped: true }
    }
    log(`REGEN ${artist} - ${title} (existing FLAC not a real master: duration=${duration}s, size=${stats.size} bytes)`)
  }
  mkdirSync(artistDir, { recursive: true })
  const tmpDir = mkdtempSync(join(tmpdir(), `andra-r13-${id}-`))

  try {
    // 1. DB row for cover_url / genre / key
    const { data, error } = await sb.from('tracks').select('cover_url, genre, key_signature').eq('id', id).single()
    if (error || !data?.cover_url) throw new Error(`No cover_url (${error?.message ?? 'missing'})`)

    // 2. Cover download + HUD overlay + JPEG
    const coverPath = join(tmpDir, 'cover.png')
    await downloadFile(data.cover_url, coverPath)
    log('  cover downloaded')
    const hudPath = join(tmpDir, 'cover_hud.png')
    await renderHudCover({ baseImg: coverPath, artist, title, out: hudPath })
    const coverJpegPath = join(tmpDir, 'cover.jpg')
    runPython(`
from PIL import Image
img = Image.open("${hudPath}")
img.convert('RGB').save("${coverJpegPath}", "JPEG", quality=95)
print("OK")
`)
    log('  HUD cover rendered')

    // 3. Harvest FLAC from Suno
    log(`  harvesting ${clip} (groundTruth 240s)...`)
    const harvestResult = await harvestFromSuno(clip, 240)
    if (harvestResult.unregenerable) {
      log(`SKIP ${artist} - ${title} (${harvestResult.reason})`)
      return { success: true, skipped: true, reason: harvestResult.reason }
    }
    const flacBuffer = harvestResult
    const tmpFlacPath = join(tmpDir, 'track.flac')
    writeFileSync(tmpFlacPath, flacBuffer)
    log(`  FLAC ready (${flacBuffer.length} bytes, duration=${await probeFlacSeconds(tmpFlacPath)}s)`)

    // 4. Embed cover + metadata
    embedCoverAndMetadata(tmpFlacPath, coverJpegPath, {
      artist,
      title,
      genre: data.genre || 'Electronic',
      comment: `ANDRA NETWORK | ${artist} | ${data.genre || 'Electronic'} | ${bpm} BPM | ${data.key_signature || ''}`
    })

    // 5. Copy to QNAP
    const { copyFileSync } = await import('node:fs')
    copyFileSync(tmpFlacPath, flacPath)
    log(`  SAVED to QNAP: ${flacPath}`)

    // 6. Upload master to Supabase storage + write storage_path (so future batches can reuse)
    if (process.env.SUPABASE_URL) {
      const resp = await sb.storage
        .from('tracks')
        .upload(`audio/${id}.flac`, flacBuffer, { contentType: 'audio/flac', upsert: true })
      if (!resp.error) {
        const { data: pub } = sb.storage.from('tracks').getPublicUrl(`audio/${id}.flac`)
        await sb.from('tracks').update({ storage_path: pub.publicUrl }).eq('id', id)
        log(`  storage_path set`)
      } else {
        log(`  storage upload skipped: ${resp.error.message}`)
      }
    }

    return { success: true }
  } catch (error) {
    log(`  ERROR: ${error.message}`)
    return { success: false, error: error.message }
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

function probeFlacSeconds(flacPath) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', flacPath], { encoding: 'utf8', timeout: 30000 })
  if (r.status !== 0) return -1
  return Math.round(parseFloat(r.stdout.trim()))
}

async function main() {
  const from = parseInt(process.argv[2] ?? '0', 10)
  const to = parseInt(process.argv[3] ?? `${MISSING.length - 1}`, 10)
  const targets = MISSING.slice(from, to + 1)

  log(`=== REGEN-13 START (${targets.length} tracks: ${from}..${to}) ===`)
  let ok = 0, failed = 0
  for (const track of targets) {
    const res = await processTrack(track)
    if (res.success) ok++
    else failed++
    await new Promise((r) => setTimeout(r, 1000))
  }
  log(`=== REGEN-13 DONE: ok=${ok} failed=${failed} ===`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { log(`FATAL: ${e.message}`); process.exit(1) })