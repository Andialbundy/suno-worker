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
import { readFile, rm } from 'fs/promises'

// Same env-var convention as the other scripts in this project (allcov.mjs,
// radio-probe.mjs, setup1.mjs, dl-bc.mjs) — set via .env, loaded with
// `node --env-file=.env`. No fallback: fail loud rather than silently run
// against the wrong project or crash deep inside a Playwright session.
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — run with: node --env-file=.env src/worker.mjs')
  process.exit(1)
}
const PROFILE_DIR = join(homedir(), '.suno-profile')
const CHROME_BIN = '/usr/bin/google-chrome'
const CHROME_PROFILE = process.env.CHROME_PROFILE_DIR || join(homedir(), '.config/google-chrome')
const LOGIN_MODE = process.argv.includes('--login')
// Unique temp profile per job to avoid launchPersistentContext profile locking
// when multiple jobs run in the same worker process.
const JOB_PROFILE_DIR = (jobId) => join(tmpdir(), `suno_profile_${jobId}`)
// Isolated Playwright profile by default — real Chrome profile conflicts
// with any other running Chrome instance (incl. the Claude Code extension),
// since launchPersistentContext needs exclusive control of the profile dir.
const USE_REAL_CHROME = process.argv.includes('--chrome')
const DRY_RUN = process.argv.includes('--dry')

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
async function downloadRealAudio(page, clipId, jobId) {
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
    await page.waitForTimeout(3000)
  }
  if (!ready) throw new Error('Song never left placeholder/generating state (6min wait)')

  const menuBtn = await page.$('button[aria-label="More menu contents"]')
  if (!menuBtn) throw new Error('More menu button not found on song page')
  await menuBtn.click()
  await page.waitForTimeout(600)

  const downloadItem = await page.getByText('Download', { exact: true })
  await downloadItem.hover()
  await page.waitForTimeout(600)

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.getByText('MP3 Audio', { exact: true }).click(),
  ])

  const tmpPath = join(tmpdir(), `suno_${jobId}.mp3`)
  await download.saveAs(tmpPath)
  const buffer = await readFile(tmpPath)

  const path = `audio/raw/${jobId}.mp3`
  const { error } = await sb.storage.from('tracks').upload(path, buffer, {
    contentType: 'audio/mpeg',
    upsert: true,
  })
  if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`)

  const { data } = sb.storage.from('tracks').getPublicUrl(path)
  return data.publicUrl
}

// ── Download audio via direct fetch (bypasses closed browser page) ──────
// Uses the audio download URL captured from the response interceptor.
// This works even when the Playwright page has closed.
async function fetchAudio(audioDownloadUrl, clipId, jobId) {
  const response = await fetch(audioDownloadUrl)
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  const path = `audio/raw/${jobId}.mp3`
  const { error } = await sb.storage.from('tracks').upload(path, buffer, {
    contentType: 'audio/mpeg',
    upsert: true,
  })
  if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`)
  const { data } = sb.storage.from('tracks').getPublicUrl(path)
  return data.publicUrl
}

// ── Generate one song via Playwright ───────────────────────────────────────

async function generateSong(prompt, style, jobId, title) {
  const launchOpts = USE_REAL_CHROME ? {
    executablePath: CHROME_BIN,
    channel: undefined,
  } : {}

  const browser = await chromium.launchPersistentContext(
    USE_REAL_CHROME ? CHROME_PROFILE : JOB_PROFILE_DIR(jobId),
    {
      ...launchOpts,
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--profile-directory=Default', '--disable-gpu', '--disable-setuid-sandbox', '--disable-extensions', '--no-zygote'],
      viewport: { width: 1280, height: 900 },
      acceptDownloads: true,
    }
  )

  const page = browser.pages()[0] || await browser.newPage()
  let clipId = null
  let audioUrl = null
  let audioDownloadUrl = null
  let domDataAtClose = null
  let beforeSongIds = new Set()
  const rejectedClipIds = new Set()
  let browserClosedDuringGeneration = false

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
    if (url.includes('cdn1.suno.ai') && url.endsWith('.mp3') && !clipId) {
      await trySetClipId(extractClipId(url), 'mp3 response')
    }
    // Capture audio download URL for direct fetch-based download (bypasses closed page)
    const dlMatch = url.match(/\/([a-f0-9-]{36})\.(mp3|m4a)(\?|$)/)
    if (dlMatch && !audioDownloadUrl) {
      audioDownloadUrl = url
      const dlClipId = dlMatch[1]
      console.log(`[download-url] ${url}`)
      if (!clipId) await trySetClipId(dlClipId, 'download-URL')
    }
    // Intercept Suno API responses for clip generation — check ALL suno.com responses
    // for any UUID pattern since the clip ID may appear in unexpected response formats
    if (url.includes('suno.com') || url.includes('suno.ai') || url.includes('suno-data-uploads') || url.includes('cloudfront.net')) {
      try {
        const text = await res.text()
        // Broader clip ID search — check for any UUID anywhere in the response
        const allUuidMatches = text.match(/[a-f0-9-]{36}/g) || []
        for (const uid of allUuidMatches) {
          if (!clipId && /^[a-f0-9-]{36}$/.test(uid) && !rejectedClipIds.has(uid)) {
            // Only accept if it looks like a real clip ID (not a placeholder like sil-100)
            await trySetClipId(uid, 'UUID-in-response')
          }
        }
        // Also check for specific clip ID field patterns
        const fieldMatch = text.match(/"id"\s*:\s*"([a-f0-9-]{36})"/) || text.match(/"clip_id"\s*:\s*"([a-f0-9-]{36})"/) || text.match(/"song_id"\s*:\s*"([a-f0-9-]{36})"/)
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
    console.log('Navigating to suno.com/create...')
    await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3000)

    if (LOGIN_MODE) {
      console.log('\n=== LOGIN MODE ===')
      console.log('Log in manually in the Chrome window, then press Ctrl+C')
      await page.waitForTimeout(300000)
      await browser.close()
      return null
    }

    // Check if logged in (no login button visible)
    const loginBtn = await withContextRetry(() =>
      page.$('a[href*="sign-in"], button:text("Log in"), a:text("Sign in")'))
    if (loginBtn) {
      console.error('❌ Not logged in. Run: bun run worker.mjs --login')
      await browser.close()
      return null
    }

        // Suno may redirect first-login sessions to /onboarding (genre picker)
    if (page.url().includes('/onboarding')) {
      console.log('On /onboarding, skipping...')
      try {
        await page.click('button:has-text("Skip")', { timeout: 5000 })
      } catch {}
      await page.waitForTimeout(2000)
      await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(3000)
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
        await page.waitForTimeout(3000)
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
    try {
      const modelBtn = await page.$('button:has-text("v5.5"), button:has-text("v5"), button:has-text("v4"), button:has-text("v3.5")')
      if (modelBtn) {
        await modelBtn.click()
        await page.waitForTimeout(500)
        const v55 = await page.$('[role="menuitemradio"]:has-text("v5.5")')
        if (v55) {
          await v55.click()
          console.log('Model set to v5.5')
        } else {
          console.warn('⚠️  v5.5 menu item not found — closing dropdown')
          await page.keyboard.press('Escape')
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
    console.log('Waiting for generation (up to 2 min)...')
    let waitLoopErrors = 0
    const deadline = Date.now() + 300000
    while (!clipId && Date.now() < deadline) {
      try {
        await page.waitForTimeout(2000)
        await scanDomForAudio()
        // Also check URL — Suno may navigate to /song/<uuid> on generation
        const curUrl = page.url()
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
              headless: true,
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
          audioUrl = await fetchAudio(audioDownloadUrl, clipId, jobId)
          console.log(`✅ Audio fetched and uploaded: ${audioUrl}`)
        } catch (e) {
          console.error(`❌ Fetch download failed: ${e.message}`)
          // Fallback to browser-based download
          try {
            audioUrl = await downloadRealAudio(page, clipId, jobId)
            console.log(`✅ Real audio downloaded and uploaded: ${audioUrl}`)
          } catch (e2) {
            console.error('❌ Download-flow failed:', e2.message)
          }
        }
      } else {
        try {
          audioUrl = await downloadRealAudio(page, clipId, jobId)
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

  return { clipId, audioUrl }
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
    .select('*, artists(*)')
    .eq('status', 'pending')
    .like('replicate_prediction_id', 'suno_pending_%')
    .limit(2) // max 2 at a time (Suno Pro allows parallel)

  if (!jobs?.length) {
    console.log('No queued Suno jobs.')
    return
  }

  console.log(`Found ${jobs.length} queued job(s)`)

  for (const job of jobs) {
    const artist = job.artists
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
      const result = await generateSong(prompt, style, job.id, job.title)
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
        // Mark as failed after too many attempts (optional: add attempt counter)
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
