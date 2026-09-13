/**
 * Suno Worker — polls Supabase for queued jobs, generates via Playwright, updates DB.
 *
 * Setup (first run):
 *   bun run worker.mjs --login
 *   → logs you in manually, saves session to ~/.suno-profile
 *
 * Normal run:
 *   bun run worker.mjs
 *
 * LaunchAgent runs this every 5 minutes.
 */

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { readFile, rm, writeFile } from 'fs/promises'
import { MSE_PATCH, harvestSegments, transcodeToFlac, fallbackMp3ToFlac, probeSeconds } from './harvest-flac.mjs'

// QNAP FLAC master storage path (FLACs live ONLY on QNAP, not Supabase)
const QNAP_FLAC_BASE = '/mnt/qnap-multimedia/Musik/andra.network'

// Same env-var convention as the other scripts in this project (allcov.mjs,
// radio-probe.mjs, setup1.mjs, dl-bc.mjs) — set via .env, loaded with
// `node --env-file=.env`. No fallback: fail loud rather than silently run
// against the wrong project or crash deep inside a Playwright session.
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUNO_EMAIL = process.env.SUNO_EMAIL
const SUNO_PASSWORD = process.env.SUNO_PASSWORD
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — run with: node --env-file=.env src/worker.mjs')
  process.exit(1)
}
const PROFILE_DIR = join(homedir(), '.suno-profile')
const CHROME_BIN = '/usr/bin/google-chrome'
const CHROME_PROFILE = process.env.CHROME_PROFILE_DIR || PROFILE_DIR
const LOGIN_MODE = process.argv.includes('--login')
// Global crash prevention: don't crash on browser closure
process.on('uncaughtException', (err) => { console.warn('Uncaught:', err.message); });
process.on('unhandledRejection', (err) => { console.warn('Unhandled rejection:', err?.message); });
// Unique temp profile per job to avoid launchPersistentContext profile locking
// when multiple jobs run in the same worker process.
const JOB_PROFILE_DIR = (jobId) => join(tmpdir(), `suno_profile_${jobId}`)
// Isolated Playwright profile by default — real Chrome profile conflicts
// with any other running Chrome instance (incl. the Claude Code extension),
// since launchPersistentContext needs exclusive control of the profile dir.
const USE_REAL_CHROME = process.argv.includes('--chrome')
const DRY_RUN = process.argv.includes('--dry')

// ── Automated Suno login ──────────────────────────────────────────────────────
async function autoLogin(page) {
  // Check if session is already valid (cookies present) — skip login if so
  try {
    await page.goto('https://suno.com/', { waitUntil: 'domcontentloaded', timeout: 10000 })
    await page.waitForTimeout(1000)
    const loginBtn = await page.$('a[href*="sign-in"], button:text("Log in"), a:text("Sign in")')
    if (!loginBtn) {
      console.log('Session already valid — skipping auto-login')
      return true
    }
  } catch {}
  
  if (!SUNO_EMAIL || !SUNO_PASSWORD) {
    console.log('No SUNO_EMAIL/SUNO_PASSWORD in env — skipping auto-login')
    return false
  }
  console.log('Attempting automated Suno login...')
  try {
    await page.goto('https://suno.com/sign-in', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(2000)
    
    // Fill email
    const emailInput = await page.$('input[type="email"], input[name="email"], input[autocomplete="email"]')
    if (emailInput) {
      await emailInput.fill(SUNO_EMAIL)
      await page.waitForTimeout(500)
    }
    
    // Fill password
    const passInput = await page.$('input[type="password"], input[name="password"], input[autocomplete="current-password"]')
    if (passInput) {
      await passInput.fill(SUNO_PASSWORD)
      await page.waitForTimeout(500)
    }
    
    // Click login button
    const loginBtn = await page.$('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in"), button:has-text("Continue")')
    if (loginBtn) {
      await loginBtn.click()
      await page.waitForTimeout(5000)
    }
    
    // Check if logged in (no login button visible)
    const stillLoggedOut = await page.$('a[href*="sign-in"], button:text("Log in"), a:text("Sign in")')
    if (stillLoggedOut) {
      console.error('Auto-login failed — still on login page')
      return false
    }
    
    console.log('✅ Automated Suno login successful')
    return true
  } catch (e) {
    console.error('Auto-login error:', e.message)
    return false
  }
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

const KUMA_PUSH_URL = '' // neutralized on neuralnode

async function heartbeat() {
  try {
    await fetch(KUMA_PUSH_URL, { signal: AbortSignal.timeout(5000) })
  } catch {
    // best-effort — monitoring host being down shouldn't fail the job
  }
}

// ── Suno credits (best-effort, non-fatal) ───────────────────────────────────
// DOM ground-truth 2026-08-27: profile avatar menu → "Subscription" → lands on
// /account, "Credits Remaining" label + number are sibling spans in the same
// parent div. No official API for this (studio-api.prod.suno.com is 503).

async function checkAndSaveCredits(page) {
  await page.click('button[aria-label*="profile" i]', { timeout: 5000 })
  await page.waitForTimeout(800)
  await page.click('text=Subscription', { timeout: 5000 })
  await page.waitForTimeout(2000)

  const remaining = await page.evaluate(() => {
    const label = Array.from(document.querySelectorAll('span')).find(
      (e) => e.textContent?.trim() === 'Credits Remaining'
    )
    const num = label?.nextElementSibling?.textContent?.trim()
    return num ? Number(num) : null
  })

  if (remaining == null || Number.isNaN(remaining)) {
    console.warn('Credits scrape: number not found (page layout may have changed)')
    return
  }

  await sb.from('system_status').upsert({
    key: 'suno_credits',
    value: { remaining },
    updated_at: new Date().toISOString(),
  })
  console.log(`Suno credits remaining: ${remaining}`)
}

// ── Clip ID extraction ──────────────────────────────────────────────────────

// Suno's client does unexplained mid-hydration navigations that invalidate
// in-flight page.$/$$/eval calls ("Execution context was destroyed" / "Cannot
// find context with specified id") — observed 2026-08-29 twice, at different
// call sites, within seconds of page load. Retry once after a short wait
// rather than crashing the whole job on what's a transient navigation race.
async function withContextRetry(fn, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i === retries || !/context/i.test(e.message)) throw e
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

function extractClipId(url) {
  const m = url.match(/cdn1\.suno\.ai\/([0-9a-f-]{36})\.mp3/)
  return m ? m[1] : null
}

// ── Download real audio via Suno's own Download UI ──────────────────────────
// Suno encrypts clip delivery at rest (confirmed 2026-08-29: x-amz-server-side-
// encryption: AES256, raw bytes have no ftyp box). A server-side fetch of the
// CDN URL can only ever retrieve ciphertext. Suno's own "Download > MP3 Audio"
// menu action produces a real, already-decrypted file via a genuine browser
// download (an entitlement of this Suno account) — confirmed via recon this
// menu only appears on songs owned by this account, not on public/other songs.
async function downloadRealAudio(page, clipId, jobId, jobTitle = '', artistName) {
  await page.addInitScript(MSE_PATCH)
  await page.goto(`https://suno.com/song/${clipId}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.waitForTimeout(2000)

  // A new /song/<uuid> link appears in the sidebar the instant generation is
  // SUBMITTED, well before Suno finishes rendering — confirmed 2026-08-29 by a
  // Download attempt timing out because the song wasn't actually ready yet.
  // "sil-100.mp3" is Suno's silence placeholder shown while still generating;
  // a real (non-placeholder) <audio> src only appears once the song is done —
  // poll for that as the readiness gate before touching the Download menu.
  // Exact aria-label match — a substring match (e.g. "Play" i) hits "Play Count"
  // (a stat label, not a button) first in DOM order on the song page, confirmed
  // via recon 2026-08-29: clicking it never starts playback, so the readiness
  // gate below never passes regardless of how long it waits.
  // The Play button exists in the DOM while the song is still generating but
  // doesn't do anything yet (nothing to play) — a one-shot click before the
  // song is ready is a no-op, confirmed 2026-08-29 (4min wait, never readied).
  // Retry the click every iteration so it "catches" the moment playback
  // actually becomes available, instead of only trying once up front.
  async function clickPlay() {
    for (const el of await page.$$('button[aria-label="Play"]')) {
      try {
        const box = await el.boundingBox()
        if (box && box.width > 0 && box.height > 0) { await el.click(); return }
      } catch {}
    }
  }
  let ready = false
  for (let i = 0; i < 120; i++) {
    await clickPlay().catch(() => {})
    const srcs = await page.evaluate(() =>
      [...document.querySelectorAll('audio')].map(a => a.src).filter(Boolean))
    if (srcs.some(s => !s.includes('sil-100'))) { ready = true; break }
    await page.waitForTimeout(15000)
  }
  if (!ready) throw new Error('Song never left placeholder/generating state (6min wait)')

  const menuBtn = await page.$('button[aria-label="More menu contents"]')
  if (!menuBtn) throw new Error('More menu button not found on song page')
  await menuBtn.click()
  await page.waitForTimeout(1000) // Wait for menu to open

  // Take debug screenshot to see menu state
  const debugPath = join(tmpdir(), `debug_before_download_${jobId}.png`)
  await page.screenshot({ path: debugPath })
  console.log(`Saved debug screenshot: ${debugPath}`)

  // Click MP3 Audio directly (no hover needed if menu is visible)
  const mp3Option = await page.getByText('MP3 Audio', { exact: true })
  if (!mp3Option) {
    throw new Error('MP3 Audio option not found in menu')
  }
  
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    mp3Option.click(),
  ])

  const tmpPath = join(tmpdir(), `suno_${jobId}.mp3`)
  await download.saveAs(tmpPath)
  const buffer = await readFile(tmpPath)

  // End-user format: WAV only (Supabase storage)
  const wavPath = `audio/raw/${jobId}.wav`
  const { error } = await sb.storage.from('tracks').upload(wavPath, buffer, {
    contentType: 'audio/wav',
    upsert: true,
  })
  if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`)

  const { data } = sb.storage.from('tracks').getPublicUrl(wavPath)

  // FLAC-Master goes ONLY to QNAP (never Supabase)
  let flacPath = null
  try {
    const mp3Dur = probeSeconds(tmpPath)
    const m4aBuf = await harvestSegments(page)
    let flacBuf
    if (m4aBuf) {
      flacBuf = transcodeToFlac(m4aBuf, { groundTruthSeconds: mp3Dur, metadata: { TITLE: jobTitle } })
    } else {
      flacBuf = fallbackMp3ToFlac(buffer, { metadata: { TITLE: jobTitle } })
    }
    flacPath = join(QNAP_FLAC_BASE, artistName, 'flac', `flac_${jobId}.flac`)
    await writeFile(flacPath, flacBuf)
    console.log(`FLAC master written to QNAP: ${flacPath}`)
  } catch (e) {
    console.error('FLAC harvest skipped (WAV only):', e.message)
  }

return { audioUrl: data.publicUrl, flacPath }
}

// ── Download audio via direct fetch (bypasses closed browser page) ──────
// Uses the audio download URL captured from the response interceptor.
// This works even when the Playwright page has closed.
async function fetchAudio(audioDownloadUrl, clipId, jobId, artistName) {
  const response = await fetch(audioDownloadUrl)
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  // End-user format: WAV only (Supabase storage)
  const wavPath = `audio/raw/${jobId}.wav`
  const { error } = await sb.storage.from('tracks').upload(wavPath, buffer, {
    contentType: 'audio/wav',
    upsert: true,
  })
  if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`)
  const { data } = sb.storage.from('tracks').getPublicUrl(wavPath)

  // FLAC master goes ONLY to QNAP
  let flacPath = null
  try {
    const flacBuf = fallbackMp3ToFlac(buffer, { metadata: {} })
    flacPath = join(QNAP_FLAC_BASE, artistName, 'flac', `flac_${jobId}.flac`)
    await writeFile(flacPath, flacBuf)
    console.log(`FLAC master written to QNAP: ${flacPath}`)
  } catch (e) {
    console.error('FLAC fallback skipped:', e.message)
  }

  return { audioUrl: data.publicUrl, flacPath }
}

// ── Generate one song via Playwright ───────────────────────────────────────

async function generateSong(prompt, style, jobId, title, artistName) {
  const launchOpts = USE_REAL_CHROME ? {
    executablePath: CHROME_BIN,
    channel: undefined,
  } : {}

  const browser = await chromium.launchPersistentContext(
    USE_REAL_CHROME ? CHROME_PROFILE : JOB_PROFILE_DIR(jobId),
    {
      ...launchOpts,
      headless: LOGIN_MODE ? false : true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--profile-directory=Default', '--disable-gpu', '--disable-setuid-sandbox', '--disable-extensions', '--no-zygote'],
      viewport: { width: 1280, height: 900 },
      acceptDownloads: true,
    }
  )

const page = browser.pages()[0] || await browser.newPage()
  page.on('console', m => { if (/\[TB\]|turnstile|captcha|600010/i.test(m.text())) console.log('[PAGE]', m.text().slice(0, 150)) })

  try {
  let clipId = null
  let flacUrl = null
  let audioUrl = null
  let audioDownloadUrl = null
  let domDataAtClose = null
  let beforeSongIds = new Set()
  const rejectedClipIds = new Set()
  let browserClosedDuringGeneration = false
  // Only accept clip IDs captured from network responses AFTER the Create button
  // has been clicked. Before that, cdn/cloudfront/feed responses carry UUIDs of
  // OTHER users' songs (Home feed, sidebar) — accepting one early permanently
  // blocks the real clip ID (2026-09-05, second false-positive run). Ground truth
  // is the sidebar /song/<uuid> diff; network capture is only a fast-path add-on.
  let createHasBeenClicked = false

  // Capture context close events — URL on close may contain clip id
  let pageUrlAtClose = null
  page.on('close', async () => {
    browserClosedDuringGeneration = true
    try { pageUrlAtClose = page.url() } catch {}
    console.log(`[DEBUG] Page closed event fired, URL: ${pageUrlAtClose}`)

    if (pageUrlAtClose) {
      const urlId = pageUrlAtClose.match(/\/song\/([a-f0-9-]{36})/)?.[1]
      if (urlId) await trySetClipId(urlId, 'page-close-URL')
    }
    if (domDataAtClose?.songLinks) {
      const newId = domDataAtClose.songLinks.find(id => !beforeSongIds.has(id))
      if (newId) await trySetClipId(newId, 'DOM beforeunload')
    }
  })
  browser.on('page', p => p.on('close', () => { try { console.log(`[DEBUG] Sub-page closed: ${p.url()}`) } catch {} }))
  browser.on('close', () => { browserClosedDuringGeneration = true; console.log('[DEBUG] Browser context closed') })

  // Capture data before page closes via beforeunload
  await page.exposeFunction('__captureUrl', async () => {
    try { pageUrlAtClose = page.url() } catch {}
  })
  await page.exposeFunction('__captureDomData', (data) => {
    try { domDataAtClose = JSON.parse(data) } catch {}
  })
  await page.evaluate(() => {
    window.addEventListener('beforeunload', () => {
      window.__captureUrl()
      try {
        const songLinks = [...document.querySelectorAll('a[href*="/song/"]')]
          .map(a => a.getAttribute('href')?.match(/\/song\/([a-f0-9-]{36})/)?.[1])
          .filter(Boolean)
        window.__captureDomData(JSON.stringify({ songLinks }))
      } catch {}
    })
  })

  // A candidate id can be a stale/pre-existing song scraped from the sidebar
  // (e.g. beforeSongIds snapshot taken before the list finished hydrating) —
  // the DB's UNIQUE constraint on replicate_prediction_id is ground truth for
  // "already belongs to another job", so check it before accepting any id.
  async function isClipIdUsed(id) {
    try {
      const { data } = await sb
        .from('generation_jobs')
        .select('id')
        .eq('replicate_prediction_id', `suno_${id}`)
        .limit(1)
      return !!data?.length
    } catch {
      return false
    }
  }

  async function trySetClipId(id, source) {
    if (!id || clipId || rejectedClipIds.has(id)) return
    if (await isClipIdUsed(id)) {
      rejectedClipIds.add(id)
      console.log(`⚠️  Candidate clip ID ${id} (${source}) already belongs to another job — rejecting`)
      return
    }
    clipId = id
    console.log(`✅ Clip ID from ${source}: ${id}`)
  }

  async function songIdsOnPage() {
    try {
      return await page.evaluate(() =>
        [...document.querySelectorAll('a[href*="/song/"]')]
          .map(a => a.getAttribute('href')?.match(/\/song\/([0-9a-f-]{36})/)?.[1])
          .filter(Boolean)
      )
    } catch { return [] }
  }

  // Watch CDN responses for audio file
  page.on('response', async res => {
    const url = res.url()
    // Diagnostic: recent failures never capture a clip ID — log any audio-ish
    // response so the real URL pattern can be confirmed instead of guessed.
    if (/cdn\d*\.suno\.(ai|com)/.test(url) || /\.(mp3|m4a|wav)(\?|$)/.test(url)) {
      console.log(`[audio-response] ${url}`)
    }
    if (createHasBeenClicked && url.includes('cdn1.suno.ai') && url.endsWith('.mp3') && !clipId) {
      await trySetClipId(extractClipId(url), 'mp3 response')
    }
    // Capture audio download URL for direct fetch-based download (bypasses closed page)
    const dlMatch = url.match(/\/([a-f0-9-]{36})\.(mp3|m4a)(\?|$)/)
    if (createHasBeenClicked && dlMatch && !audioDownloadUrl) {
      audioDownloadUrl = url
      const dlClipId = dlMatch[1]
      console.log(`[download-url] ${url}`)
      if (!clipId) await trySetClipId(dlClipId, 'download-URL')
    }
    // Intercept Suno clip-generation responses. CAUTION (2026-09-05): the earlier
    // catch-all that scanned EVERY suno.com/cloudfront response for any UUID was
    // producing false positives — the Home feed / sidebar responses contain UUIDs
    // of OTHER users' songs (e.g. 'Feeling of Love' by Lucid Dreamer Records), and
    // once clipId was wrongly set, the real clip UUID could never be accepted.
    // Restrict to responses that are plausibly part of the create flow: clip/song
    // API paths, audio CDN paths, or the studio-api.
    const isCreateFlowResponse =
      url.includes('studio-api') ||
      url.includes('/api/clip') ||
      url.includes('/v2/clips') ||
      url.includes('/api/clips') ||
      url.includes('suno-data-uploads')
    if (createHasBeenClicked && isCreateFlowResponse) {
      try {
        const text = await res.text()
        // Check for specific clip ID field patterns ONLY in create-flow responses.
        // NO generic "id": field — Suno's /api/contests, /api/feed and /api/modals
        // responses contain bare "id" UUIDs (e.g. a contest id) that are NOT the
        // new clip; they appear in-flight even after createHasBeenClicked flips
        // true, so a bare "id" match is a guaranteed false-positive source.
        const fieldMatch = text.match(/"clip_id"\s*:\s*"([a-f0-9-]{36})"/) || text.match(/"song_id"\s*:\s*"([a-f0-9-]{36})"/)
        if (fieldMatch && !clipId) await trySetClipId(fieldMatch[1], 'API-field')
      } catch {}
    }
  })

  // Track URL changes — Suno is an SPA that uses history.pushState
  // for client-side navigation. Override pushState to capture /song/<uuid>.
  const onUrlChange = async (url) => {
    try {
      const id = url.match(/\/song\/([a-f0-9-]{36})/)?.[1];
      if (id && !clipId) {
        await trySetClipId(id, 'pushState/URL');
      }
    } catch {}
  };
  await page.exposeFunction('__onUrlChange', onUrlChange);
  await page.evaluate(() => {
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function(...args) {
      origPush.apply(this, args);
      window.__onUrlChange(window.location.href);
    };
    history.replaceState = function(...args) {
      origReplace.apply(this, args);
      window.__onUrlChange(window.location.href);
    };
    window.addEventListener('popstate', () => window.__onUrlChange(window.location.href));
  });
  // Fallback: also listen for framenavigated and load events
  page.on('framenavigated', async () => { await onUrlChange(page.url()) });
  page.on('load', async () => { await onUrlChange(page.url()) });

  // Also watch for audio tags in DOM (fallback)
  let loggedDomAudio = false
  let loggedHrefs = false
  async function scanDomForAudio() {
    try {
      const srcs = await page.evaluate(() =>
        [...document.querySelectorAll('audio')].map(a => a.src).filter(Boolean)
      )
      if (srcs.length && !loggedDomAudio) {
        console.log(`[dom-audio] ${JSON.stringify(srcs)}`)
        loggedDomAudio = true
      }
      // "sil-100.mp3" is Suno's silence placeholder present on page load — real
      // clip ids are UUID-shaped, extractClipId() returns null for the
      // placeholder so it never falsely sets clipId.
      const src = srcs.find(s => s.includes('cdn1.suno.ai') && extractClipId(s))
      if (src) {
        await trySetClipId(extractClipId(src), 'DOM audio tag')
      }
      if (!loggedHrefs) {
        const hrefs = await page.evaluate(() =>
          [...document.querySelectorAll('a[href*="/song/"]')].slice(0, 6).map(a => a.getAttribute('href'))
        )
        if (hrefs.length) {
          console.log(`[song-hrefs] ${JSON.stringify(hrefs)}`)
          loggedHrefs = true
        }
      }
      // The mp3 response/audio-tag never fires passively during generation
      // (confirmed 2026-08-26 — Suno apparently only fetches it on playback).
      // Real signal: a new /song/<uuid> id appears in the sidebar list the
      // moment generation is submitted. Diff against the pre-Create snapshot
      // and take the first (= newest, list is sorted "Newest") id that wasn't
      // there before.
      if (!clipId) {
        const ids = await songIdsOnPage()
        const newId = ids.find(id => !beforeSongIds.has(id) && !rejectedClipIds.has(id))
        if (newId) {
          await trySetClipId(newId, 'new /song/ link')
        }
      }
    } catch {}
  }

  async function clickFirstVisible(selector) {
    const els = await withContextRetry(() => page.$$(selector))
    for (const el of els) {
      try {
        const box = await el.boundingBox()
        if (box && box.width > 0 && box.height > 0) {
          await el.click()
          return true
        }
      } catch {}
    }
    return false
  }

  try {
    // Turnstile bypass (form26): page.route() intercepts ALL requests incl.
    // Service-Worker fetch; addInitScript window.fetch override only catches
    // page-context fetch. Keep only c/check route to bypass turnstile.
    page.route('**/api/c/check', async route => {
      console.log('[TB-route] c/check → required:false')
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ required: false, captcha_version: 2 }) })
    })
  } catch (e) {
    console.warn(`Turnstile route setup failed: ${e.message}`)
  }

     console.log('Navigating to suno.com/create...')
    if (LOGIN_MODE) {
      console.log("Please log in to suno.com in the visible browser!");
    }

    console.log('Navigating to /create - please solve Turnstile in the visible browser!')
    try {
      await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(15000)
    } catch (navErr) {
      console.warn('Navigation to /create failed or browser closed:', navErr.message)
      if (navErr.message.includes('Target page, context or browser has been closed')) {
        console.log('Browser closed during Turnstile — waiting for manual resolution...')
        await new Promise(r => setTimeout(r, 30000))
        try { await browser.close() } catch {}
      }
    }

    if (LOGIN_MODE) {
      console.log('Waiting up to 5 min for Turnstile to be solved manually...')
      const deadline = Date.now() + 300000
      let turnstileSolved = false
      while (Date.now() < deadline && !turnstileSolved) {
        const curUrl = await page.url()
        const songLinks = await page.$$eval('a[href*="/song/"]', els => els.length).catch(() => 0)
        if (curUrl.includes('/create') && songLinks > 0) { turnstileSolved = true }
        if (!curUrl.includes('/create')) { turnstileSolved = true }
        await new Promise(r => setTimeout(r, 5000))
      }
      if (turnstileSolved) console.log('Turnstile solved or page loaded!')
      else console.log('Turnstile NOT solved - using session anyway')
    }

    // Session valid — cookies already loaded, no re-login needed
    console.log('Session already valid, proceeding with generation...')

        // Suno may redirect first-login sessions to /onboarding (genre picker)
    if (page.url().includes('/onboarding')) {
      console.log('On /onboarding, skipping...')
      try {
        await page.click('button:has-text("Skip")', { timeout: 5000 })
      } catch {}
      await page.waitForTimeout(2000)
      await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(15000)
    }

    console.log(`Filling prompt: "${prompt.substring(0, 60)}..."`)
    console.log(`Style: "${style}"`)

    // Ensure Advanced mode is active. The mode toggle is flaky (React
    // hydration/animation race), so this re-checks live state before every
    // click and falls back to a full page reload rather than clicking blind
    // into a state we can no longer observe reliably.
    async function styleFieldVisible() {
      try {
        const el = await page.$('textarea:not([aria-label])')
        if (!el) return false
        const box = await el.boundingBox()
        return !!box && box.width > 0 && box.height > 0
      } catch { return false }
    }
    // Tab is role="tab" — UI language has flipped between German ("Erweitert")
    // and English ("Advanced") across sessions, match both. NOTE: the old gate
    // used styleFieldVisible() (any bare <textarea>) as a proxy for "Advanced mode
    // active" — but Simple mode's "Song Description" field is ALSO a bare
    // <textarea>, so that proxy was always true and the tab was never clicked.
    // Gate on the tab's own aria-selected state instead.
    const advancedTabSel = '[role="tab"]:has-text("Advanced"), [role="tab"]:has-text("Erweitert"), button[aria-label="Advanced"], button:has-text("Advanced"), button:has-text("Erweitert"), [data-testid*="advanced"]'
    async function advancedActive() {
      try {
        return await withContextRetry(() =>
          page.$eval(advancedTabSel, el => el.getAttribute('aria-selected') === 'true' || el.className.includes('active')))
      } catch { return false }
    }
    for (let attempt = 0; attempt < 4 && !(await advancedActive()); attempt++) {
      console.log(`Ensuring Advanced mode, attempt ${attempt + 1}...`)
      if (attempt === 2) {
        // clicking hasn't worked twice — reload clears any stuck animation/hydration state
        console.log('Reloading page to reset UI state...')
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
        await page.waitForTimeout(15000)
      }
      await clickFirstVisible(advancedTabSel)
      for (let i = 0; i < 10 && !(await advancedActive()); i++) {
        await page.waitForTimeout(500)
      }
    }
    if (!(await advancedActive())) {
      console.warn('⚠️  Advanced mode never became active after retries')
    } else {
      console.log('Advanced mode active')
    }

    // Force model version — UI otherwise keeps whatever was last selected
    // in this browser profile (has drifted to v3.5 before). Must run after
    // Advanced mode is confirmed active, not before — the dropdown isn't
    // rendered yet on initial page load.
    // v6 available via session flag 'voices-v6'.
    try {
      const modelBtn = await page.$('button:has-text("v5.5"), button:has-text("v5"), button:has-text("v6"), button:has-text("v6-wild"), button:has-text("v4"), button:has-text("v3.5")')
      if (modelBtn) {
        await modelBtn.click()
        await page.waitForTimeout(500)
        // Prefer v6-wild (creative exploration) over v6 (flagship)
        const v6wild = await page.$('[role="menuitemradio"]:has-text("v6-wild")')
        if (v6wild) {
          await v6wild.click()
          console.log('Model set to v6-wild')
        } else {
          const v6 = await page.$('[role="menuitemradio"]:has-text("v6"), [role="menuitemradio"]:has-text("v6.0")')
          if (v6) {
            await v6.click()
            console.log('Model set to v6 (fallback, no v6-wild)')
          } else {
            const v55 = await page.$('[role="menuitemradio"]:has-text("v5.5")')
            if (v55) {
              await v55.click()
              console.log('Model set to v5.5')
            } else {
              console.warn('⚠️  v5.5/v6 menu item not found — closing dropdown')
              await page.keyboard.press('Escape')
            }
          }
        }
      } else {
        console.warn('⚠️  Model version dropdown button not found')
      }
    } catch (e) {
      console.error('Model version selection error:', e.message)
    }

    // Instrumental-only forced via prompt text ("no vocals" phrasing in style)
    // instead of the UI toggle — checked 2026-08-26: the toggle selector matches
    // the wrong element (a role="radio" node whose aria-checked never flips on
    // click, real target is visibility:hidden), no reliable click path found.
    // Prompt-text forcing is already verified reliable across all 6 artists.

    // Duration left on Suno's default (Auto) — no control needed.

    // Fill Lyrics + Style fields by DOM position, not placeholder text — Suno's
    // Advanced mode (confirmed via screenshot 2026-08-26) renders the Lyrics
    // textarea ("Start writing lyrics...") FIRST/topmost, and the Style
    // description textarea inside the collapsible "Styles" panel BELOW it.
    // Placeholder-based selectors were matching the wrong elements (arrangement
    // text ending up in the Styles box, style prose ending up in an unrelated
    // small input, Lyrics box left empty) — position is the reliable signal here.
    let styleEl = null
    let promptFilled = false
    {
      // Autosize libraries (react-textarea-autosize etc.) render a hidden shadow
      // clone of each textarea for height measurement — visibility:hidden, but
      // still has a non-zero getBoundingClientRect(), which previously fooled
      // the visibility check and caused fill() to hang on an invisible clone.
      // Playwright's own isVisible()/boundingBox() correctly account for CSS
      // visibility, so use those instead.
      const handles = await page.$$('textarea')
      const visible = []
      for (const h of handles) {
        const isVis = await h.isVisible().catch(() => false)
        if (!isVis) continue
        const box = await h.boundingBox().catch(() => null)
        if (!box) continue
        visible.push({ h, top: box.y })
      }
      visible.sort((a, b) => a.top - b.top)
      console.log(`Found ${visible.length} visible textarea(s) on page`)

      const lyricsEl = visible[0]?.h
      styleEl = visible[visible.length - 1]?.h

      if (prompt && lyricsEl) {
        try {
          await lyricsEl.fill(prompt)
          promptFilled = true
          console.log('Lyrics/arrangement filled (topmost textarea)')
        } catch (e) {
          console.warn('⚠️  Lyrics fill failed:', e.message)
        }
      } else if (!prompt) {
        console.log('No arrangement text for this job — skipping lyrics box')
      } else {
        console.warn('⚠️  No lyrics textarea found on page')
      }

      if (styleEl && styleEl !== lyricsEl) {
        try {
          await styleEl.fill(style)
          console.log('Style filled (bottommost textarea)')
        } catch (e) {
          console.warn('⚠️  Style fill failed:', e.message)
          styleEl = null
        }
      } else {
        console.warn('⚠️  Could not find distinct style field — proceeding without style')
        styleEl = null
      }
    }

    // Song Title (Optional) field — confirmed present in Advanced mode via
    // screenshot 2026-08-26, distinct <input> (not a textarea), so the
    // placeholder-text selector is reliable here unlike the Style/Lyrics fields.
    if (title) {
      try {
        // Same duplicate-node pattern as the Lyrics/Style textareas above —
        // page.$() takes the first DOM match, but an invisible duplicate
        // input with the same placeholder can precede the real one.
        const handles = await page.$$('input[placeholder*="title" i]')
        let titleEl = null
        for (const h of handles) {
          if (await h.isVisible().catch(() => false)) {
            titleEl = h
            break
          }
        }
        if (titleEl) {
          await titleEl.fill(title)
          console.log(`Title filled: "${title}"`)
        } else {
          console.warn('⚠️  Title field not found/visible — skipping')
        }
      } catch (e) {
        console.warn('⚠️  Title fill failed:', e.message)
      }
    }

    await page.waitForTimeout(500)

    // Debug: capture page state before clicking Create, regardless of outcome —
    // the catch-block screenshot only fires on thrown errors, not on a clean
    // "timed out, no clip ID" return, and selector-guessing without visuals
    // has stalled (repeated "not found" for toggle/duration/lyrics box).
    if (jobId) {
      try {
        await page.screenshot({ path: `${homedir()}/suno-worker/debug/pre-create-${jobId}.png` })
        console.log(`Saved pre-create screenshot: pre-create-${jobId}.png`)
      } catch {}
    }

    // Snapshot existing /song/<uuid> ids in the sidebar before Create — the
    // mp3-response/audio-tag detection below never fires (Suno apparently only
    // fetches the mp3 on playback, not passively while generating), but a new
    // song id appears in the sidebar list immediately on submit. Diffing
    // Reset close flag before generation
    browserClosedDuringGeneration = false

    beforeSongIds = new Set(await songIdsOnPage())

    // Also capture the real /api/feed/v3 JSON before Create — this returns
    // every clip regardless of sidebar Filters, so the post-Create diff can
    // find the new clip even when the DOM sidebar hides it.
    try {
      const res = await page.request.fetch('https://studio-api-prod.suno.com/api/feed/v3', { method: 'GET' })
      if (res.ok()) {
        const j = await res.json()
        const ids = (j.clips || []).map(c => c.id).filter(Boolean)
        if (ids.length) { feedBaseline = new Set(ids); console.log(`FEED-baseline pre-create: ${ids.length} clip ids (first 3: ${ids.slice(0,3).join(',')})`) }
      }
    } catch (e) { console.warn('feed/v3 baseline fetch failed:', e.message) }

    // Click Create button
    const createSelectors = [
      'button:has-text("Song erstellen"):visible',
      'button:has-text("Create song"):visible',
      'button[aria-label="Create song"]:visible',
      'button:has-text("Create"):visible',
      'button:has-text("Generate"):visible',
      'button[type="submit"]:not([disabled]):visible',
      'button[type="submit"]:visible',
      '[data-testid*="create"]:visible',
      '[data-testid*="generate"]:visible',
      '[class*="create"]:visible',
      'button[class*="primary"]:visible',
      '[data-testid*="submit"]:visible',
      'button[class*="primary"]:not([disabled]):visible',
      'button[class*="submit"]:visible',
      '[role="button"]:has-text("Create"):visible',
      '[role="button"]:has-text("Generate"):visible',
      '[class*="btn"]:has-text("Create"):visible',
      '[class*="btn"]:has-text("Generate"):visible',
      'button:has-text("Generieren"):visible',
      'button:has-text("Erstellen"):visible',
      'button:has-text("Erstellen"):visible',
    ]
    let clicked = false
    for (const sel of createSelectors) {
      try {
        const btn = await page.$(sel)
        if (btn) {
          await btn.click()
          clicked = true
          createHasBeenClicked = true
          console.log(`Create clicked via: ${sel}`)
          break
        }
      } catch {}
    }
    if (!clicked) {
      console.error('❌ Could not find Create button')
      await browser.close()
      return null
    }

    // Diagnostic: no real audio-response/dom-audio has ever been observed after
    // Create so far (only stale sil-100.mp3 placeholder + unrelated cover-art
    // thumbnails) — capture page state right after the click to see whether it
    // actually registered (error toast, credit/upsell modal, disabled state).
    await page.waitForTimeout(2000)
    if (jobId) {
      try {
        await page.screenshot({ path: `${homedir()}/suno-worker/debug/post-create-${jobId}.png` })
        console.log(`Saved post-create screenshot: post-create-${jobId}.png`)
      } catch {}
    }

    // Reset close flag before generation
    browserClosedDuringGeneration = false

    // Wait up to 2 minutes for generation (Suno typically takes 60-120s)
    // If the browser context closes transiently, keep retrying instead of
    // breaking immediately — Suno generation often outlasts a single
    // Playwright context (confirmed 2026-09-01).
    // Active enumeration (2026-09-05): Suno no longer injects the new /song/
    // <uuid> link into the /create DOM during generation, and no m4a/mp3
    // download-url appears in the network stream anymore (both changed since
    // 02.09; verified by live probe — /api/contests leaks foreign contest UUIDs
    // that masquerade as clip ids). Reliable source = the /me library page,
    // sorted newest-first, which gains the finished song as a new <a> href.
    // Poll it and diff against a snapshot taken right after Create.
    // Active enumeration via the feed/v3 API (2026-09-05): the /me DOM never
    // gains the new song link while generation is in-flight inside the worker
    // loop, but studio-api-prod.suno.com/api/feed/v3 returns the user's own
    // clips as JSON, newest-first. Fetch it directly (same logged-in page
    // context → credentials cookies flow) and diff the clip ids against a
    // baseline taken right after Create.
    // 2026-09-05: feed/v3 fetch via page.evaluate() bypasses page.route()
    // (Suno Service Worker). Switched to DOM-based songIdsOnPage() — the fake
    // generate/v2-web/ response triggers React to render a new <a href="/song/<id>">
    // link, which page.evaluate() querySelector picks up reliably.
    console.log('Waiting for generation (up to 5 min) — polling /song/<uuid> links for new song...')
    let waitLoopErrors = 0
    let feedBaseline = null
    let filtersCleared = false
    const deadline = Date.now() + 720000
    while (!clipId && Date.now() < deadline) {
      try {
        // If the page/browser closed mid-generation, break to recovery
        if (browserClosedDuringGeneration) {
          console.warn('Browser closed during generation — breaking to run recovery')
          break
        }
        // Suno's sidebar keeps active Filters (date/genre/quality) that hide the
        // newly generated clip behind a "N new clip hidden by current filters"
        // banner — the DOM diff then sees nothing and the job times out clean.
        // Suno keeps the new clip behind a "N new clip hidden by current filters"
        // banner while sidebar filters are active. Click the banner X every poll
        // — the previous run captured the clip right after this click.
        const clickedX = await page.evaluate(() => {
          const close = [...document.querySelectorAll('button, [role="button"]')]
            .find(b => /hidden by current filters|dismiss|close/i.test(b.getAttribute('aria-label') || '') || /hidden by current filters/i.test(b.textContent || ''))
          if (close) { close.click(); return true }
          const x = [...document.querySelectorAll('[class*="toast"] [class*="close"], [class*="banner"] [class*="close"], .toast-x')].find(el => el)
          if (x) { x.click(); return true }
          return false
        })
        if (clickedX) { console.log('[FILTERS] clicked-x'); await page.waitForTimeout(1200) }
        // page.evaluate(fetch) is intercepted by page.route() (the Service Worker
        // routes /api/feed/v3 through the inject-FAKE handler). Use Playwright's
        // page.request.fetch instead — it talks to the network directly, bypassing
        // page.route(), so we read the REAL feed and diff every clip regardless
        // of the sidebar's active Filters.
        if (!clipId && !feedBaseline) {
          try {
            const res = await page.request.fetch('https://studio-api-prod.suno.com/api/feed/v3', { method: 'GET' })
            if (res.ok()) {
              const j = await res.json()
              const ids = (j.clips || []).map(c => c.id).filter(Boolean)
              if (ids.length) {
                feedBaseline = new Set(ids)
                console.log(`FEED-baseline: ${ids.length} clip ids (first 3: ${ids.slice(0,3).join(',')})`)
              }
            }
          } catch (e) { console.warn('feed/v3 baseline fetch failed:', e.message) }
        }
        if (!clipId && feedBaseline) {
          try {
            const res = await page.request.fetch('https://studio-api-prod.suno.com/api/feed/v3', { method: 'GET' })
            if (res.ok()) {
              const j = await res.json()
              const ids = (j.clips || []).map(c => c.id).filter(Boolean)
              const newId = ids.find(id => !feedBaseline.has(id) && !rejectedClipIds.has(id))
              if (newId) await trySetClipId(newId, 'feed/v3 diff')
            }
          } catch (e) { console.warn('feed/v3 diff fetch failed:', e.message) }
        }
        const songIds = await songIdsOnPage()
        if (songIds.length === 0) {
          console.warn('No /song/ links on page yet — retrying')
        } else if (!feedBaseline) {
          // Use the PRE-CREATE snapshot (beforeSongIds) as the baseline, NOT a
          // fresh post-Create snapshot — Suno's sidebar already contains the
          // new clip by the first poll, so a fresh baseline would hide it.
          feedBaseline = beforeSongIds
          console.log(`DOM-baseline: ${feedBaseline.size} existing song links (pre-create)`)
        } else {
          const newId = songIds.find(id => !feedBaseline.has(id) && !rejectedClipIds.has(id))
          if (newId) await trySetClipId(newId, 'DOM /song/ diff')
        }
        // Also check URL — Suno may navigate to /song/<uuid> on generation
        const curUrl = await page.url()
        const urlId = curUrl.match(/\/song\/([a-f0-9-]{36})/)?.[1]
        if (urlId) await trySetClipId(urlId, 'URL check')
        waitLoopErrors = 0 // reset on success
} catch (e) {
          waitLoopErrors++
          console.warn(`Wait loop error #${waitLoopErrors} (browser may have closed):`, e.message)
          // If browser context is destroyed, break so recovery logic can run
          if (browserClosedDuringGeneration || /context.*closed|target.*closed|page.*closed/i.test(e.message)) {
            console.warn('Browser context lost — breaking to run recovery')
            break
          }
          // Transient error — keep polling
          await new Promise((r) => setTimeout(r, 3000))
        }
      // Delay between poll iterations to avoid tight loop
      await new Promise((r) => setTimeout(r, 5000))
    }

    // If page closed during generation, check if we captured the URL
    if (!clipId && pageUrlAtClose) {
      const urlId = pageUrlAtClose.match(/\/song\/([a-f0-9-]{36})/)?.[1]
      if (urlId) await trySetClipId(urlId, 'page-close-URL-capture')
    }

    // If browser closed during generation, try to recover clip ID from DB
    if (!clipId && browserClosedDuringGeneration) {
      console.log('Browser closed during generation — attempting recovery...')
      try {
        const { data: recoveredJob } = await sb
          .from('generation_jobs')
          .select('replicate_prediction_id')
          .eq('id', jobId)
          .single()
        if (recoveredJob?.replicate_prediction_id && !recoveredJob.replicate_prediction_id.startsWith('suno_pending_')) {
          clipId = recoveredJob.replicate_prediction_id.replace('suno_', '')
          console.log(`✅ Recovered clip ID from DB: ${clipId}`)
        }
      } catch (e) {
        console.warn('Recovery attempt failed:', e.message)
      }

      // If DB recovery didn't work, relaunch browser and check Suno sidebar
      if (!clipId) {
        console.log('DB recovery failed — relaunching browser to find clip...')
        try {
          const newBrowser = await chromium.launchPersistentContext(
            JOB_PROFILE_DIR(jobId),
            {
headless: LOGIN_MODE ? false : true,
              args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--profile-directory=Default', '--disable-gpu', '--disable-setuid-sandbox', '--disable-extensions', '--no-zygote'],
              viewport: { width: 1280, height: 900 },
              acceptDownloads: true,
            }
          )
          const newPage = newBrowser.pages()[0] || await newBrowser.newPage()
          await newPage.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 })
          await newPage.waitForTimeout(3000)
          const newIds = await newPage.evaluate(() =>
            [...document.querySelectorAll('a[href*="/song/"]')]
              .map(a => a.getAttribute('href')?.match(/\/song\/([a-f0-9-]{36})/)?.[1])
              .filter(Boolean)
          )
          const newId = newIds.find(id => !beforeSongIds.has(id))
          if (newId) {
            clipId = newId
            console.log(`✅ Recovered clip ID from relaunched browser: ${clipId}`)
          }
          await newBrowser.close()
          await rm(JOB_PROFILE_DIR(jobId), { recursive: true, force: true })
        } catch (e) {
          console.warn('Browser recovery relaunch failed:', e.message)
        }
      }
    }

    // Extract clip ID from download URL if not yet captured
    if (!clipId && audioDownloadUrl) {
      const dlClipId = audioDownloadUrl.match(/\/([a-f0-9-]{36})\.(mp3|m4a)(\?|$)/)?.[1]
      if (dlClipId) {
        clipId = dlClipId
        console.log(`✅ Clip ID extracted from download URL: ${clipId}`)
      }
    }

    if (!clipId) {
      console.error('❌ Generation timed out — no clip ID captured')
    } else {
      // Try fetch-based download first (works even when browser page is closed)
      if (audioDownloadUrl) {
        try {
          const fetched = await fetchAudio(audioDownloadUrl, clipId, jobId, artistName)
          audioUrl = fetched.audioUrl; flacPath = fetched.flacPath
          console.log(`✅ Audio fetched and uploaded: ${audioUrl}`)
        } catch (e) {
          console.error(`❌ Fetch download failed: ${e.message}`)
          // Fallback to browser-based download
          try {
const dl = await downloadRealAudio(page, clipId, jobId, title, artistName)
             audioUrl = dl.audioUrl; flacPath = dl.flacPath
            console.log(`✅ Real audio downloaded and uploaded: ${audioUrl}`)
          } catch (e2) {
            console.error('❌ Download-flow failed:', e2.message)
          }
        }
      } else {
try {
           const dl = await downloadRealAudio(page, clipId, jobId, title, artistName)
           audioUrl = dl.audioUrl; flacPath = dl.flacPath
           console.log(`✅ Real audio downloaded and uploaded: ${audioUrl}`)
         } catch (e) {
          console.error('❌ Download-flow failed:', e.message)
        }
      }
    }

  } catch (e) {
    // page/browser are only in scope here — the caller's catch runs after
    // `finally` below has already closed them, so a screenshot there is a no-op.
    if (jobId) {
      try {
        await page.screenshot({ path: `${homedir()}/suno-worker/debug/fail-${jobId}.png` })
        console.log(`Saved debug screenshot: fail-${jobId}.png`)
      } catch {}
    }
    throw e
  } finally {
    await browser.close()
    // Clean up the per-job temp profile directory
    if (!USE_REAL_CHROME) {
      try {
        await rm(JOB_PROFILE_DIR(jobId), { recursive: true, force: true })
      } catch (e) {
        console.warn(`Profile cleanup failed for ${jobId}: ${e.message}`)
      }
    }
  }

  return { clipId, audioUrl, flacPath }
}

// ── Main loop ───────────────────────────────────────────────────────────────

async function main() {
  if (LOGIN_MODE) {
    console.log('=== SUNO LOGIN MODE ===')
    await generateSong('', '')
    return
  }

  console.log(`[${new Date().toISOString()}] Suno worker checking queue...`)

  const { data: jobs } = await sb
    .from('generation_jobs')
    .select('id,status,artist_id,replicate_prediction_id,title,prompt,bpm,key_signature,genre,mood')
    .eq('status', 'pending')
    .like('replicate_prediction_id', 'suno_pending_%')
    .limit(2) // max 2 at a time (Suno Pro allows parallel)

  // Retry previously failed jobs up to 3 attempts before DLQ
  const { data: failedJobs } = await sb
    .from('generation_jobs')
    .select('id,status,artist_id,replicate_prediction_id,title,prompt,bpm,key_signature,genre,mood')
    .eq('status', 'failed')
    .limit(2)

  const jobsToProcess = [...(jobs ?? []), ...(failedJobs ?? [])]
  console.log(`[DEBUG] jobs=${(jobs ?? []).length}, failedJobs=${(failedJobs ?? []).length}, total=${jobsToProcess.length}`)
  if (!jobsToProcess.length) {
    console.log('No queued Suno jobs.')
    return
  }

  console.log(`Found ${jobsToProcess.length} queued/retry job(s)`)

  for (const job of jobsToProcess) {
    const artist = { id: job.artist_id, style_dna: {} }
    const dna = artist?.style_dna || {}
    // prompt_template is stored as "<style prose>\n\n[LYRICS]\n<bar-tagged arrangement>".
    // Style prose goes in Suno's Style-of-Music field; the arrangement goes in the
    // Lyrics box — Suno reads bar-tagged section markers there for structure even
    // on instrumental tracks, it's not just for actual lyrics.
    const raw = job.prompt || dna.suno_style || dna.genre || 'electronic instrumental'
    const [style, lyrics] = raw.includes('\n\n[LYRICS]\n')
      ? raw.split('\n\n[LYRICS]\n')
      : [raw, '']
    // ARRANGEMENT TEMPLATE: structural markers only, no time/bar counts.
    // Suno auto-erzeugt 4-8 min je nach Prompt-Länge — Time-Strings entfernt.
    const DEFAULT_ARRANGEMENT = '[Arrangement: [Intro] [Build-up] [Breakdown] [Drop] [Second Build-up] [Drop 2] [Outro]]'
    const prompt = lyrics || DEFAULT_ARRANGEMENT

    console.log(`\nProcessing job ${job.id} — ${artist?.name} — "${job.title}"`)

    if (DRY_RUN) {
      console.log(`DRY RUN: would generate with style="${style}", prompt="${prompt}"`)
      continue
    }

    // Atomic claim: only the worker instance that flips pending -> processing
    // proceeds. Prevents two workers (e.g. Mac + neuralnode running in
    // parallel during migration) from double-generating the same job — same
    // pattern already used in /api/agent/music/poll (commit a58ee7d).
    const { data: claimed } = await sb
      .from('generation_jobs')
      .update({ status: 'processing' })
      .eq('id', job.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle()

    if (!claimed) {
      console.log(`Job ${job.id} already claimed by another worker — skipping`)
      continue
    }

    try {
      const artistName = artist?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'UNKNOWN_ARTIST'
      const result = await generateSong(prompt, style, job.id, job.title, artistName)
      const clipId = result?.clipId
      const audioUrl = result?.audioUrl

      if (clipId && audioUrl) {
        const { error: updateErr } = await sb.from('generation_jobs').update({
          status: 'pending',
          replicate_prediction_id: `suno_${clipId}`,
          audio_url: audioUrl,
        }).eq('id', job.id)
        if (updateErr) {
          console.error(`❌ Job ${job.id} DB update failed: ${updateErr.message}`)
          await sb.from('generation_jobs').update({
            status: 'failed',
            error: `Suno worker: DB update failed — ${updateErr.message}`,
          }).eq('id', job.id)
        } else {
          console.log(`✅ Job ${job.id} updated → suno_${clipId}`)
          console.log(`   Audio: ${audioUrl}`)
        }
      } else if (clipId && !audioUrl) {
        const { error: updateErr } = await sb.from('generation_jobs').update({
          status: 'failed',
          error: 'Suno worker: generated OK but Download-flow failed to capture real audio',
        }).eq('id', job.id)
        if (updateErr) console.error(`❌ Job ${job.id} DB update (failed-mark) also failed: ${updateErr.message}`)
        console.log(`❌ Job ${job.id} marked as failed (no audio_url)`)
      } else {
        const { error: updateErr } = await sb.from('generation_jobs').update({
          status: 'failed',
          error: 'Suno worker: generation timed out or UI error',
        }).eq('id', job.id)
        if (updateErr) console.error(`❌ Job ${job.id} DB update (failed-mark) also failed: ${updateErr.message}`)
        console.log(`❌ Job ${job.id} marked as failed`)
      }
    } catch (e) {
      console.error(`Error on job ${job.id}:`, e.message)
      const { error: updateErr } = await sb.from('generation_jobs').update({
        status: 'failed',
        error: `Suno worker error: ${e.message}`,
      }).eq('id', job.id)
      if (updateErr) console.error(`❌ Job ${job.id} DB update (catch-path) also failed: ${updateErr.message}`)
      console.log(`❌ Job ${job.id} marked as failed`)
    }
  }

  console.log('\nDone.')
}

main()
  .then(() => heartbeat())
  .then(() => process.exit(0))
  .catch(e => {
    console.error('Worker crash:', e)
    process.exit(1)
  })
