# Artist-Cover Consistency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every official track gets a uniform per-artist cover: a Replicate FLUX base image styled by each artist's template (plus a per-track creative variant) with the existing HUD overlay applied.

**Architecture:** Extract three pure/injectable modules (`cover-prompt`, `replicate`, `spend-tracker`), repoint `finalize-gp.mjs`'s `genCover` from the offline local SD engine to Replicate, populate `artists.image_prompt_template`, then add a `regen-covers.mjs` helper that re-runs base-gen + HUD for official tracks with a budget guard and pilot mode.

**Tech Stack:** Node 22 (ESM, `node --test`), `@supabase/supabase-js`, Replicate REST API (`black-forest-labs/flux-schnell`, `flux-pro`), Playwright chromium (existing HUD renderer).

**Spec:** `/home/crd-remote/projects/andranet-next/docs/superpowers/specs/2026-09-03-artist-cover-templates-design.md` (travels with this plan; executors read both).

## Global Constraints

- Replicate token = `REPLICATE_API_TOKEN` in `suno-worker/.env` (gitignored). NO Billing/usage REST endpoint exists — spend is ESTIMATED. Walk away from nothing here; this is the contract.
- Account balance = $10 USD (as of 2026-09-03). **ALERT THE USER when cumulative estimated spend reaches $9** (≈ $1 left). Stop batch when crossing.
- Cost estimates: `flux-schnell` ≈ $0.003/img, `flux-pro` ≈ $0.025/img.
- Base images: 1024×1024, FLUX. Replicate `output` is an ARRAY (e.g. `['https://...out-0.webp']`) OR a string — handle both.
- Remove the hardcoded `, glitch distortion, digital artwork` suffix from cover generation.
- Final prompt = `{artist.image_prompt_template} + ', {track_variant}, high detail, 8k, cinematic lighting'`. Variant precedence: `image_prompt` → `mood` → `title`; empty → template only.
- HUD overlay (existing `renderHudCover`, `src/render-cover-hud.mjs`) is UNCHANGED — do not edit its approved layout.
- Pipeline repo = `/home/crd-remote/suno-worker` (separate git repo from `andranet-next`). Pipeline code lives here; spec lives in `andranet-next`.
- No existing test suite; use Node 22 built-in `node --test`. Each `.mjs` module runs standalone; guard any top-level side effects behind an `import.meta.url` main-check so tests can import safely.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REPLICATE_API_TOKEN` all present in `suno-worker/.env`. Run stateful modules with `node --env-file=.env`.

---

### Task 1: Prompt composition (`src/cover-prompt.mjs`)

**Files:**
- Create: `src/cover-prompt.mjs`
- Test: `test/cover-prompt.test.mjs`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `resolveVariant({ image_prompt, mood, title }) → string`; `composePrompt(template, trackLike) → string`. Used by Tasks 4 & 6.

- [ ] **Step 1: Write the failing test**

```js
// test/cover-prompt.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveVariant, composePrompt } from '../src/cover-prompt.mjs'

test('resolveVariant precedence: image_prompt > mood > title', () => {
  assert.equal(resolveVariant({ image_prompt: 'neon grid', mood: 'dark', title: 'Track 5' }), 'neon grid')
  assert.equal(resolveVariant({ image_prompt: '', mood: 'euphoric', title: 'Pulse' }), 'euphoric')
  assert.equal(resolveVariant({ image_prompt: '', mood: '', title: 'Crystal' }), 'Crystal')
  assert.equal(resolveVariant({ image_prompt: '', mood: '', title: '   ' }), '')
})

test('resolveVariant strips trailing "mood: ..." wart from image_prompt', () => {
  assert.equal(resolveVariant({ image_prompt: 'neon glacier, mood: uplifting', mood: 'x' }), 'neon glacier')
})

test('composePrompt appends variant + quality suffix', () => {
  const out = composePrompt('ice cathedral', { mood: 'cold', title: 'N' })
  assert.equal(out, 'ice cathedral, cold, high detail, 8k, cinematic lighting')
})

test('composePrompt template-only when no variant', () => {
  assert.equal(composePrompt('ice cathedral', { image_prompt: '', mood: '', title: '' }), 'ice cathedral, high detail, 8k, cinematic lighting')
})

test('composePrompt never contains glitch', () => {
  assert.equal(composePrompt('a', { title: 'b' }).includes('glitch'), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cover-prompt.test.mjs`
Expected: FAIL — `Cannot find module '../src/cover-prompt.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/cover-prompt.mjs
const QUALITY_SUFFIX = 'high detail, 8k, cinematic lighting'

function stripMoodWart(s) {
  return s.replace(/,?\s*mood\s*:\s*[^,]+$/i, '').trim()
}

export function resolveVariant({ image_prompt, mood, title } = {}) {
  if (image_prompt && image_prompt.trim()) return stripMoodWart(image_prompt)
  if (mood && mood.trim()) return mood.trim()
  if (title && title.trim()) return title.trim()
  return ''
}

export function composePrompt(template, trackLike = {}) {
  const variant = resolveVariant(trackLike)
  const parts = []
  if (template && template.trim()) parts.push(template.trim())
  if (variant) parts.push(variant)
  parts.push(QUALITY_SUFFIX)
  return parts.filter(Boolean).join(', ')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/cover-prompt.test.mjs`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/cover-prompt.mjs test/cover-prompt.test.mjs
git commit -m "feat: cover prompt composition (template + variant)"
```

---

### Task 2: Replicate client (`src/replicate.mjs`)

**Files:**
- Create: `src/replicate.mjs`
- Test: `test/replicate.test.mjs`

**Interfaces:**
- Consumes: `REPLICATE_API_TOKEN` (passed in as `token` arg), nothing else.
- Produces: `FLUX_SCHNELL`, `FLUX_PRO`, `COST_PER_MODEL`, `generateCover(token, { model, prompt, width, height }, deps) → Promise<Buffer>`. Used by Tasks 4 & 6.

- [ ] **Step 1: Write the failing test**

```js
// test/replicate.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FLUX_SCHNELL, FLUX_PRO, COST_PER_MODEL, generateCover } from '../src/replicate.mjs'

function fakeFetch(sequence) {
  let i = 0
  return async (url, opts = {}) => {
    const step = sequence[i++]
    if (step.url === opts && false) {} // (unused; kept for clarity of intent)
    assert.equal(url, step.url)
    if (step.check) step.check(opts)
    return { ok: true, status: 200, json: async () => step.json, arrayBuffer: async () => step.buf }
  }
}

test('COST_PER_MODEL has both models', () => {
  assert.equal(COST_PER_MODEL[FLUX_SCHNELL], 0.003)
  assert.equal(COST_PER_MODEL[FLUX_PRO], 0.025)
})

test('generateCover POSTs prediction, polls, downloads array output', async () => {
  const buf = Buffer.from([0x52, 0x49, 0x46, 0x46])
  const seq = [
    { url: 'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions',
      check: (o) => {
        assert.equal(o.method, 'POST')
        assert.equal(o.headers.Authorization, 'Bearer tok')
        const body = JSON.parse(o.body)
        assert.equal(body.input.prompt, 'p')
        assert.equal(body.input.width, 1024)
        assert.equal(body.input.height, 1024)
      },
      json: { id: 'p1', status: 'starting' } },
    { url: 'https://api.replicate.com/v1/predictions/p1', json: { id: 'p1', status: 'processing' } },
    { url: 'https://api.replicate.com/v1/predictions/p1', json: { id: 'p1', status: 'succeeded', output: ['https://cdn/out.webp'] } },
    { url: 'https://cdn/out.webp', buf },
  ]
  const out = await generateCover('tok', { model: FLUX_SCHNELL, prompt: 'p' }, { fetchImpl: fakeFetch(seq) })
  assert.deepEqual(out, buf)
})

test('generateCover handles string output', async () => {
  const buf = Buffer.from([0x01, 0x02])
  const seq = [
    { url: 'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', json: { id: 'p2', status: 'starting' } },
    { url: 'https://api.replicate.com/v1/predictions/p2', json: { id: 'p2', status: 'succeeded', output: 'https://cdn/out.webp' } },
    { url: 'https://cdn/out.webp', buf },
  ]
  const out = await generateCover('tok', { model: FLUX_SCHNELL, prompt: 'q' }, { fetchImpl: fakeFetch(seq) })
  assert.deepEqual(out, buf)
})

test('generateCover rejects failed prediction', async () => {
  const seq = [
    { url: 'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', json: { id: 'p3', status: 'starting' } },
    { url: 'https://api.replicate.com/v1/predictions/p3', json: { id: 'p3', status: 'failed', error: 'boom' } },
  ]
  await assert.rejects(
    generateCover('tok', { model: FLUX_SCHNELL, prompt: 'x' }, { fetchImpl: fakeFetch(seq), maxWait: 60000 }),
    /replicate failed/
  )
})

test('generateCover times out', async () => {
  const seq = [
    { url: 'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', json: { id: 'p4', status: 'starting' } },
    { url: 'https://api.replicate.com/v1/predictions/p4', json: { id: 'p4', status: 'processing' } },
  ]
  await assert.rejects(
    generateCover('tok', { model: FLUX_SCHNELL, prompt: 'y' }, { fetchImpl: fakeFetch(seq), maxWait: 50, interval: 10 }),
    /replicate poll timeout/
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/replicate.test.mjs`
Expected: FAIL — `Cannot find module '../src/replicate.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/replicate.mjs
export const FLUX_SCHNELL = 'black-forest-labs/flux-schnell'
export const FLUX_PRO = 'black-forest-labs/flux-pro'
export const COST_PER_MODEL = { [FLUX_SCHNELL]: 0.003, [FLUX_PRO]: 0.025 }

async function safeText(res) {
  try { return await res.text() } catch { return '' }
}

async function createPrediction(token, model, prompt, { width = 1024, height = 1024, num_inference_steps = 4, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: { prompt, width, height, num_inference_steps } }),
  })
  if (!res.ok) throw new Error(`replicate create ${res.status}: ${await safeText(res)}`)
  return res.json()
}

async function pollPrediction(token, id, { maxWait = 60000, interval = 2000, fetchImpl = fetch } = {}) {
  const deadline = Date.now() + maxWait
  while (Date.now() < deadline) {
    const res = await fetchImpl(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`replicate poll ${res.status}: ${await safeText(res)}`)
    const p = await res.json()
    if (p.status === 'succeeded') return p
    if (p.status === 'failed') throw new Error('replicate failed: ' + (p.error ? JSON.stringify(p.error) : 'unknown'))
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error('replicate poll timeout')
}

async function downloadOutput(url, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`replicate output ${res.status}: ${await safeText(res)}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function generateCover(token, { model = FLUX_SCHNELL, prompt, width = 1024, height = 1024 }, deps = {}) {
  if (!token) throw new Error('REPLICATE_API_TOKEN missing')
  const created = await createPrediction(token, model, prompt, { width, height, ...deps })
  const finished = await pollPrediction(token, created.id, deps)
  const outUrl = Array.isArray(finished.output) ? finished.output[0] : finished.output
  return downloadOutput(outUrl, deps)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/replicate.test.mjs`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/replicate.mjs test/replicate.test.mjs
git commit -m "feat: replicate FLUX client (create/poll/download)"
```

---

### Task 3: Spend tracker (`src/spend-tracker.mjs`)

**Files:**
- Create: `src/spend-tracker.mjs`
- Test: `test/spend-tracker.test.mjs`

**Interfaces:**
- Consumes: `COST_PER_MODEL` (Task 2) for per-call cost lookup.
- Produces: `DEFAULT_PATH = '.replicate-spend.json'`, `ALERT_THRESHOLD_USD = 9`, `INITIAL_BALANCE_USD = 10`, `loadSpend(file)`, `saveSpend(state, file)`, `recordSpend(state, { model, predictionId, trackTitle, cost })`, `shouldAlert(state)`, `markAlerted(state)`, `remainingUsd(state)`. Used by Tasks 4 & 6.

- [ ] **Step 1: Write the failing test**

```js
// test/spend-tracker.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadSpend, saveSpend, recordSpend, shouldAlert, markAlerted,
  ALERT_THRESHOLD_USD, INITIAL_BALANCE_USD, remainingUsd,
} from '../src/spend-tracker.mjs'

test('threholds', () => {
  assert.equal(ALERT_THRESHOLD_USD, 9)
  assert.equal(INITIAL_BALANCE_USD, 10)
})

test('recordSpend accumulates total and remaining', () => {
  let s = recordSpend(loadSpend(), { model: 'flux-schnell', cost: 0.003, trackTitle: 'A', predictionId: 'p' })
  s = recordSpend(s, { model: 'flux-schnell', cost: 0.003, trackTitle: 'B', predictionId: 'q' })
  assert.equal(s.total_usd, 0.006)
  assert.equal(remainingUsd(s), 9.994)
  assert.equal(s.predictions.length, 2)
})

test('shouldAlert triggers only once crossing $9 and only before markAlerted', () => {
  let s = loadSpend()
  for (let i = 0; i < 3000; i++) s = recordSpend(s, { model: 'flux-schnell', cost: 0.003 })
  assert.ok(s.total_usd >= ALERT_THRESHOLD_USD)
  assert.equal(shouldAlert(s), true)
  s = markAlerted(s)
  assert.equal(shouldAlert(s), false)
})

test('loadSpend reads persisted file; saveSpend writes it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spend-'))
  const file = join(dir, 'ledger.json')
  try {
    const fresh = loadSpend(file)
    assert.equal(fresh.total_usd, 0)
    const s = recordSpend(fresh, { model: 'flux-pro', cost: 0.025, trackTitle: 'C', predictionId: 'r' })
    saveSpend(s, file)
    assert.ok(existsSync(file))
    const reloaded = loadSpend(file)
    assert.equal(reloaded.total_usd, 0.025)
    assert.equal(reloaded.predictions[0].trackTitle, 'C')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadSpend tolerates corrupt file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spend-'))
  const file = join(dir, 'bad.json')
  try {
    saveSpend(null, file)
    const s = loadSpend(file)
    assert.equal(s.total_usd, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/spend-tracker.test.mjs`
Expected: FAIL — `Cannot find module '../src/spend-tracker.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/spend-tracker.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

export const DEFAULT_PATH = '.replicate-spend.json'
export const ALERT_THRESHOLD_USD = 9
export const INITIAL_BALANCE_USD = 10

export function loadSpend(file = DEFAULT_PATH) {
  if (existsSync(file)) {
    try {
      const p = JSON.parse(readFileSync(file, 'utf8'))
      if (p && typeof p.total_usd === 'number') return { alerted: false, predictions: [], ...p }
    } catch { /* corrupt or null -> fall through */ }
  }
  return { total_usd: 0, usd_left: INITIAL_BALANCE_USD, predictions: [], alerted: false }
}

export function saveSpend(state, file = DEFAULT_PATH) {
  writeFileSync(file, JSON.stringify(state, null, 2))
}

export function recordSpend(state, { model, predictionId, trackTitle, cost, ts = new Date().toISOString() } = {}) {
  const next = { ...state, predictions: [...(state.predictions || [])] }
  next.total_usd = +((next.total_usd || 0) + (cost || 0)).toFixed(6)
  next.usd_left = +(INITIAL_BALANCE_USD - next.total_usd).toFixed(6)
  next.predictions.push({ model, predictionId, trackTitle, cost, ts })
  return next
}

export function remainingUsd(state) {
  return +(INITIAL_BALANCE_USD - (state.total_usd || 0)).toFixed(6)
}

export function shouldAlert(state) {
  return !state.alerted && (state.total_usd || 0) >= ALERT_THRESHOLD_USD
}

export function markAlerted(state) {
  return { ...state, alerted: true }
}
```

Note: the "corrupt file" test writes `saveSpend(null, file)` → `JSON.stringify(null)` = `"null"` which parses to `null`, and `loadSpend` falls through to fresh state. This exercises the corrupt-tolerant branch. Do not "fix" this branch.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/spend-tracker.test.mjs`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/spend-tracker.mjs test/spend-tracker.test.mjs .gitignore 2>/dev/null
git commit -m "feat: estimated spend tracker with $9 alert"
```

If `.replicate-spend.json` is not already gitignored, add `.replicate-spend.json` to `.gitignore` before committing.

---

### Task 4: Repoint `finalize-gp.mjs` cover generation to Replicate

**Files:**
- Modify: `src/finalize-gp.mjs` (imports, `genCover`, main loop cover line)
- Test: `test/gencover.test.mjs`

**Interfaces:**
- Consumes: `generateCover`/`FLUX_SCHNELL`/`COST_PER_MODEL` (Task 2), `composePrompt` (Task 1), `recordSpend`/`loadSpend`/`saveSpend`/`shouldAlert`/`markAlerted`/`remainingUsd` (Task 3).
- Produces: exported `genCover(prompt, { artist, title, model }, deps) → Promise<Buffer>` for Task 6 to reuse. ***Also makes the module import-safe**: the module's top-level DB side effects (the `const { data: jobs } = await sb.from('generation_jobs')...` block) must be moved behind an `import.meta.url` main-check so tests and Task 6 can import `genCover` without touching Supabase/env.

- [ ] **Step 1: Write the failing test**

```js
// test/gencover.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { genCover } from '../src/finalize-gp.mjs'

test('genCover returns raw replicate output (no HUD) when artist/title omitted', async () => {
  const fake = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const buf = await genCover('my prompt', {}, {
    generate: async () => fake,
  })
  assert.deepEqual(buf, fake)
})

test('genCover forwards the composed prompt verbatim to generate', async () => {
  const sent = []
  await genCover('ice cathedral, cold, high detail, 8k, cinematic lighting', {}, {
    generate: async (token, { prompt }) => { sent.push({ token, prompt }); return Buffer.from([1]) },
  })
  assert.equal(sent[0].prompt, 'ice cathedral, cold, high detail, 8k, cinematic lighting')
  assert.ok(sent[0].token) // token is the REPLICATE_API_TOKEN (may be undefined in tests; just confirm the arg is passed through)
})

test('genCover throws propagate from generate', async () => {
  await assert.rejects(
    genCover('x', {}, { generate: async () => { throw new Error('REPLICATE_API_TOKEN missing') } }),
    /missing/
  )
})
```

Note: the glitch-suffix removal itself is asserted in Task 1 (`composePrompt never contains glitch`), because genCover forwards the already-composed prompt and is not the place the suffix is stripped. The HUD path (`artist`+`title` given) is pre-existing, unchanged behavior (existing `renderHudCover`), exercised by the real rollout in Task 7 — not duplicated here to avoid launching chromium in unit tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/gencover.test.mjs`
Expected: FAIL — `Cannot find module` (no export yet) OR the module-level Supabase side effects throw on import (e.g. `SUPABASE_SERVICE_ROLE_KEY` missing / network error) because `genCover` isn't import-safe yet.

- [ ] **Step 3: Modify `src/finalize-gp.mjs`**

First make the module import-safe. Wrap the top-level main body (everything after the helper definitions, currently lines ~66-113) so it only runs when executed directly:

```js
if (import.meta.url === `file://${process.argv[1]}`) {
  // existing: const { data: jobs } = await sb.from('generation_jobs')...
  // ... through console.log('done')
}
```

`const sb`, `const AI`, `const JOB_IDS`, and the pure helpers (`isValidMedia`, `genCover`, `uploadBucket`) stay at module top level (import-safe). `process.env.SUPABASE_SERVICE_ROLE_KEY` is only read inside the guarded block, so importing the module in tests is safe.

Then replace the current `genCover` (old lines ~26-58) with a Replicate-backed version:

```js
import { renderHudCover } from './render-cover-hud.mjs'
import { generateCover, FLUX_SCHNELL, COST_PER_MODEL } from './replicate.mjs'
import { composePrompt } from './cover-prompt.mjs'
import { loadSpend, saveSpend, recordSpend, shouldAlert, markAlerted, remainingUsd } from './spend-tracker.mjs'
```

```js
async function genCover(prompt, { artist, title, model = FLUX_SCHNELL } = {}, deps = {}) {
  const gen = deps.generate ?? generateCover
  const base = await gen(process.env.REPLICATE_API_TOKEN, { model, prompt })
  if (!artist || !title) return base
  const dir = tmpdir()
  const basePath = join(dir, `cov-${randomUUID()}.png`)
  const outPath = join(dir, `cov-out-${randomUUID()}.png`)
  writeFileSync(basePath, base)
  try {
    await renderHudCover({ baseImg: basePath, artist, title, out: outPath })
    return readFileSync(outPath)
  } finally {
    rmSync(basePath, { force: true })
    rmSync(outPath, { force: true })
  }
}
```

Replace the main-loop cover line (old line ~77):

```js
const coverBuf = await genCover(job.image_prompt || 'dark electronic album cover, neon grid', { artist: artist?.name, title: job.title })
```

with:

```js
const template = artist?.image_prompt_template
const finalPrompt = composePrompt(template, { image_prompt: job.image_prompt, mood: job.mood, title: job.title })
const coverBuf = await genCover(finalPrompt, { artist: artist?.name, title: job.title })
```

Also wrap the per-job cover generation with spend tracking. Load the ledger once before the job loop, and record/alert per job inside the loop (after `cover_url` is assigned):

```js
// before the for-loop over jobs:
let spend = loadSpend()

// ... inside the job loop, after cover_url assigned:
spend = recordSpend(spend, { model: FLUX_SCHNELL, cost: COST_PER_MODEL[FLUX_SCHNELL], trackTitle: job.title, predictionId: job.id })
saveSpend(spend)
if (shouldAlert(spend)) {
  console.log('REPLICATE BUDGET ALERT:', remainingUsd(spend), 'USD left -', spend.total_usd, 'USD spent')
  spend = markAlerted(spend)
  saveSpend(spend)
}
```

Export `genCover` for Task 6:

```js
export async function genCover(prompt, { artist, title, model = FLUX_SCHNELL } = {}, deps = {}) { ... }
```

Keep `uploadBucket` and the rest of the loop unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/gencover.test.mjs`
Expected: PASS — all 3 tests green, import does not hit Supabase env.

- [ ] **Step 5: Sanity-run (integration) — dry, no spend**

Confirm the module still parses and the prompt path builds without hitting Replicate by importing and asserting prompt composition is wired: run the unit tests only (above). Do NOT run the full `finalize-gp.mjs` main here — that would consume real credits. Commit:

```bash
git add src/finalize-gp.mjs test/gencover.test.mjs
git commit -m "feat: finalize-gp cover gen via Replicate + spend ledger"
```

---

### Task 5: Populate `artists.image_prompt_template`

**Files:**
- Create: `src/set-artist-templates.mjs`
- Test: `test/set-artist-templates.test.mjs`

**Interfaces:**
- Consumes: a Supabase client (injected for tests).
- Produces: exported `TEMPLATES` (name → prompt) and `main(sb)`; writes the 6 templates to `artists.image_prompt_template`.

Prompt strings (copied verbatim from spec — do not "improve"):

```js
// src/set-artist-templates.mjs
export const TEMPLATES = {
  ANDRAMON: 'biomorphic fractal goa mandala forming a dark cosmic flower, tribal ethno patterns, swirling kaleidoscopic neon colors, deep space void background, hypnotic radial symmetry',
  BUNDIX: 'sublime neon glacier ice cathedral rising from a frozen electronic wasteland, cold cyan and white light rays piercing storm clouds, soaring supersaw light beams, euphoric atmosphere, crystalline geometric structures, emotional uplift',
  ANDRAX: 'brutal industrial steel rave arena, giant subwoofer towers and distortion smoke, brutalist concrete architecture, scorching red-orange furnace light, high-contrast metallic surfaces, powerful heroic stance, dark triumphant energy',
  DYBUN: 'raw underground concrete bunker tunnel, rusted iron machinery and industrial pipes, harsh tungsten spotlight beams cutting through dust and fog, grimy metallic textures, ominous filtered noise haze, brutalist minimal',
  AERYN: 'soft glowing cosmic nebulae drifting in deep space, dreamy ethereal starfields, gentle pastel aurora gradients, serene meditative void, delicate bell-like light motes, introspective calm vastness',
  NALDIX: 'minimalist dark geometric cuboids and clean mechanical lines receding into a deep floor, matte black and subtle gold metallic accents, precise optical perspective, hypnotic grid, sophisticated restrained minimalism, warm deep shadows',
}

export async function main(sb) {
  const { data: artists, error } = await sb.from('artists').select('id,name').in('name', Object.keys(TEMPLATES))
  if (error) throw new Error(error.message)
  const updates = []
  for (const a of artists ?? []) {
    const t = TEMPLATES[a.name]
    const { error: ue } = await sb.from('artists').update({ image_prompt_template: t }).eq('id', a.id)
    if (ue) throw new Error(ue.message)
    updates.push(a.name)
  }
  return updates
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const done = await main(sb)
  console.log('updated image_prompt_template for', done.length, 'artists:', done.join(', '))
}
```

- [ ] **Step 1: Write the failing test**

```js
// test/set-artist-templates.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TEMPLATES, main } from '../src/set-artist-templates.mjs'

function mockArtistRow(name) {
  return { id: 'id-' + name, update: async () => ({ error: null }), name }
}
function fakeSb() {
  return {
    from: (t) => ({
      select: () => ({ in: async () => ({ data: ['ANDRAMON', 'BUNDIX', 'ANDRAX', 'DYBUN', 'AERYN', 'NALDIX'].map(mockArtistRow), error: null }) }),
    }),
  }
}

test('TEMPLATES covers all 6 artists with non-empty prompts', () => {
  for (const name of ['ANDRAMON', 'BUNDIX', 'ANDRAX', 'DYBUN', 'AERYN', 'NALDIX']) {
    assert.ok(TEMPLATES[name], name)
    assert.ok(TEMPLATES[name].trim().length > 0)
  }
  assert.equal(Object.keys(TEMPLATES).length, 6)
})
```

Note: `main` interacts with the real Supabase schema (`artists.id`, `.update`, `.eq`). The mock above only covers `.select().in()`. For the unit test, assert only the export-level contract (`TEMPLATES` completeness). The actual DB write is an integration step verified at runtime in Step 4/5 below — do not try to fully mock the update path here (that is not under TDD's unit scope).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/set-artist-templates.test.mjs`
Expected: FAIL — `Cannot find module '../src/set-artist-templates.mjs'`

- [ ] **Step 3: Write `src/set-artist-templates.mjs`** (paste the block above).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/set-artist-templates.test.mjs`
Expected: PASS.

- [ ] **Step 5: Integration run — writes DB**

Run: `node --env-file=.env src/set-artist-templates.mjs`
Expected: `updated image_prompt_template for 6 artists: ANDRAMON, BUNDIX, ...`
Verify in Supabase: `SELECT name, image_prompt_template FROM artists;` shows all 6 populated, prompts match `TEMPLATES`.

- [ ] **Step 6: Commit**

```bash
git add src/set-artist-templates.mjs test/set-artist-templates.test.mjs
git commit -m "feat: populate artists.image_prompt_template for 6 artists"
```

---

### Task 6: Regen helper `src/regen-covers.mjs`

**Files:**
- Create: `src/regen-covers.mjs`
- Test: `test/regen-covers.test.mjs`

**Interfaces:**
- Consumes: `composePrompt` (Task 1), `genCover` (Task 4), `loadSpend`/`recordSpend`/`saveSpend`/`shouldAlert`/`markAlerted`/`remainingUsd` (Task 3), `COST_PER_MODEL`/`FLUX_SCHNELL`/`FLUX_PRO` (Task 2).
- Produces: `isOfficialTrack(track)`, `selectOfficialTracks(sb, artists)`, `budgetSafe(spend, nextCost)`; CLI entry to regenerate official covers in pilot or batch mode.

Design: tracks are considered "official" if `published` is true (or unset) AND title does not match the test-title exclusion. Exclusion regex:

```js
// src/regen-covers.mjs
export const OFFICIAL_TITLE_EXCLUDE = /Test|Chrome|Loop|\bTrack\s?\d|Final Stability|Recovery|Noise Loop|^Track/i

export function isOfficialTrack(t) {
  return !!t && !OFFICIAL_TITLE_EXCLUDE.test(t.title || '')
}

export function budgetSafe(spend, nextCost) {
  return remainingUsd(spend) - nextCost > 1
}

export async function selectOfficialTracks(sb, { pilot = false, pilotSeed = undefined } = {}) {
  const { data: artists } = await sb.from('artists').select('id,name,image_prompt_template')
  const { data: tracks } = await sb.from('tracks').select('id,title,artist_id,image_prompt,mood,cover_url,published')
  const rows = (tracks ?? []).filter(isOfficialTrack).map((tr) => ({
    ...tr,
    artist: (artists ?? []).find((a) => a.id === tr.artist_id),
  })).filter((tr) => tr.artist && tr.artist.image_prompt_template)
  if (!pilot) return rows
  if (!pilotSeed || !Array.isArray(pilotSeed)) throw new Error('pilot mode requires pilotSeed: [{artist, title}]')
  return pilotSeed
    .map(({ artist, title }) => rows.find((r) => r.artist.name === artist && r.title === title))
    .filter(Boolean)
}
```

CLI (guarded main):

```js
export async function regenAll(sb, { model, pilot = false, pilotSeed }) {
  const rows = await selectOfficialTracks(sb, { pilot, pilotSeed })
  let spend = loadSpend()
  let updated = []
  for (const track of rows) {
    const cost = COST_PER_MODEL[model]
    if (!budgetSafe(spend, cost)) { console.log('BUDGET STOP at', remainingUsd(spend)); break }
    const prompt = composePrompt(track.artist.image_prompt_template, { image_prompt: track.image_prompt, mood: track.mood, title: track.title })
    const buf = await genCover(prompt, { artist: track.artist.name, title: track.title, model })
    const url = await uploadBucket(sb, track.id, buf)   // helper below
    await sb.from('tracks').update({ cover_url: url }).eq('id', track.id)
    spend = recordSpend(spend, { model, cost, trackTitle: track.title })
    updated.push(track.title)
    if (shouldAlert(spend)) { console.log('ALERT $9 reached'); spend = markAlerted(spend) }
  }
  saveSpend(spend)
  return updated
}

async function uploadBucket(sb, trackId, buf) {
  const { error } = await sb.storage.from('tracks').upload(`covers/${trackId}.png`, buf, { contentType: 'image/png', upsert: true })
  if (error) throw new Error('upload: ' + error.message)
  return sb.storage.from('tracks').getPublicUrl(`covers/${trackId}.png`).data.publicUrl
}
```

- [ ] **Step 1: Write the failing test**

```js
// test/regen-covers.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOfficialTrack, budgetSafe } from '../src/regen-covers.mjs'

test('isOfficialTrack excludes test titles', () => {
  assert.equal(isOfficialTrack({ title: 'NEON PULSE PROTOCOL' }), true)  // no regex hit → official
  assert.equal(isOfficialTrack({ title: 'TEST DROP' }), false)           // matches 'Test' → excluded
  assert.equal(isOfficialTrack({ title: 'Final Stability' }), false)
  assert.equal(isOfficialTrack({ title: 'Noise Loop' }), false)
  assert.equal(isOfficialTrack({ title: 'Track 4' }), false)
  assert.equal(isOfficialTrack(null), false)
})

test('budgetSafe proceeds while ~$1+ remains, stops before running dry', () => {
  // remainingUsd derives from total_usd (10 - total). 10 - 8.99 = 1.01; 1.01 - 0.003 = 1.007 > 1 → safe
  assert.equal(budgetSafe({ total_usd: 8.99, usd_left: 1.01 }, 0.003), true)
  // 10 - 8.0 = 2.0; 2.0 - 0.003 = 1.997 > 1 → safe
  assert.equal(budgetSafe({ total_usd: 8.0, usd_left: 2.0 }, 0.003), true)
  // 10 - 8.998 = 1.002; 1.002 - 0.003 = 0.999 NOT > 1 → stop
  assert.equal(budgetSafe({ total_usd: 8.998, usd_left: 1.002 }, 0.003), false)
})

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/regen-covers.test.mjs`
Expected: FAIL — `Cannot find module '../src/regen-covers.mjs'`

- [ ] **Step 3: Write `src/regen-covers.mjs`** (paste the blocks above; the guarded main should accept CLI `--pilot` and `--model` flags and print the updated list; `--list` prints what would be regenerated WITHOUT spending).

CLI main:

```js
if (import.meta.url === `file://${process.argv[1]}`) {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const args = process.argv.slice(2)
  const pilot = args.includes('--pilot')
  const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : FLUX_SCHNELL
  if (args.includes('--list')) {
    const rows = await selectOfficialTracks(sb, { pilot, pilotSeed: PILOT_SEED })
    for (const r of rows) console.log(r.artist.name, '|', r.title)
    console.log('count:', rows.length)
    process.exit(0)
  }
  const updated = await regenAll(sb, { model, pilot, pilotSeed: PILOT_SEED })
  console.log('regen done for', updated.length, 'tracks')
}
```

Where `PILOT_SEED = [{ artist: 'ANDRAMON', title: <wanted track> }, ...]` for one track per artist. In Step 5 fill the 6 seed entries from the official catalog via the `--list` output.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/regen-covers.test.mjs`
Expected: PASS.

- [ ] **Step 5: Dry-run `--list` (no spend)**

Run: `node --env-file=.env src/regen-covers.mjs --list`
Expected: the full official-track list (every official non-test track) with counts, and no Replicate calls (no spend). Confirm the count is sane (< 237, excludes ~18 test titles).

Then pick one distinct title per artist from the output and set those into `PILOT_SEED` (name → the chosen title). Commit the seed values as part of the pilot.

- [ ] **Step 6: Commit**

```bash
git add src/regen-covers.mjs test/regen-covers.test.mjs
git commit -m "feat: regen-covers helper with pilot/batch + budget guard"
```

---

### Task 7: Rollout — pilot 6 covers, verify, then batch (verification + execution)

**Files:**
- Run: `src/regen-covers.mjs` (needs `--pilot` first, then full batch after approval)
- Verify with: `tesseract`, `python3` + PIL (per cover-hud-recipe)

**Interfaces:**
- Consumes: `regen-covers.mjs` (Task 6), `render-cover-hud.mjs` (existing), verify scripts.

- [ ] **Step 1: Pilot run — 6 covers (≈ $0.018, one per artist)**

```bash
cd /home/crd-remote/suno-worker
node --env-file=.env src/regen-covers.mjs --pilot
```
Expected: regenerates exactly 6 covers (one per `PILOT_SEED`), logs each `artist | title`, updates `cover_url` to `.../tracks/covers/<id>.png`, writes `.replicate-spend.json` total ≈ $0.018.

- [ ] **Step 2: Spend ledger check**

```bash
cat .replicate-spend.json
```
Expected: `total_usd ≈ 0.018`, 6 predictions. Confirm `usd_left ≈ 9.982`, far below the $9 alert.

- [ ] **Step 3: OCR + brightness verification on each of the 6 outputs (per cover-hud-recipe)**

For each cover URL (download from `cover_url` in Supabase or the public URL printed), run:
```bash
curl -s <cover_url> -o /tmp/cov_check.png
tesseract /tmp/cov_check.png stdout
```
Expected: text is clean — each shows the artist name badge (uppercase), the track title, no garbled glitch text.

Brightness region check (PIL): verify title region (bottom-left ~20% band) is not blown out and the HUD frame corners show the artist accent. Use the existing technique from `cover-hud-recipe` (PIL brightness regions) — sample the four corner regions and assert they are not all-white/near-black uniform.

- [ ] **Step 4: User visual approval**

Open the 6 covers in Chrome `file://` view (or via `google-chrome --no-sandbox --new-window ...`) and get the user's visual OK on artist identity + uniformity before spending on the full batch. Get an explicit yes.

- [ ] **Step 5: Budget preflight for batch**

```bash
cat .replicate-spend.json   # current total
```
Compute batch cost = `officialCount × flux-schnell ≈ 219 × $0.003 ≈ $0.66` (or flux-pro ≈ $5.5). Confirm estimated total stays below the $9 alert. If using `flux-pro` for the whole batch, flag that it approaches the $9 budget; default is `flux-schnell`.

- [ ] **Step 6: Full batch run**

```bash
node --env-file=.env src/regen-covers.mjs
```
Expected: regenerates all official tracks, updates each `cover_url` to a `.png`, ledger total stays under $9, no `ALERT` printed (or if printed, stop and notify user).

- [ ] **Step 7: Post-batch verification**

Verify batch completeness and cleanliness:
- `cover_url` now ends in `.png` (not `.jpg`/`.webp`) for all regenerated official tracks.
- Spot-check a sample of new covers with `tesseract` — clean text.
- Confirm the official-track count regenerated matches the `--list` count from Task 6 Step 5.
- Report remaining budget (`remainingUsd`) to the user.

- [ ] **Step 8: Update docs + memory**

Append the rollout result (count regenerated, final spend) to `docs/superpowers/plans/2026-09-03-artist-cover-consistency.md` and update the `suno-worker-state` memory block's REPLICATE COVER GEN section with the final spend figure and any model used. Commit any doc/memory-driven code notes if applicable (memory itself is not committed).

---

## Self-Review

**Spec coverage check:**
- Per-artist base prompt → Task 5 (populates `image_prompt_template`).
- Track variant precedence → Task 1 (`resolveVariant`).
- Remove glitch suffix → Task 4 (test asserts no `glitch`).
- Replicate base-gen (replace local engine) → Task 2 + Task 4.
- HUD overlay unchanged → Task 4 (still calls `renderHudCover`).
- New regen helper (pilot then batch, official only) → Task 6 `regen-covers.mjs`.
- Budget guard + `$9` alert → Task 3 (tracker) + Task 6 (`budgetSafe`) + Task 7.
- Spend logged per prediction, estimated → Task 3 + Task 4/6 wiring.
- Rollout pilot then batch → Task 7.
- Testing/verification (OCR + brightness + user approval) → Task 7 Steps 3-4.

**Known deliberate exceptions to TDD's unit scope** (called out in-task so executors don't force-fit): Task 5's DB write and Task 6's `selectOfficialTracks`/`regenAll` I/O are integration paths verified at runtime, while the pure predicates (`TEMPLATES` completeness, `isOfficialTrack`, `budgetSafe`) carry unit tests.

**Placeholder scan:** no TBD; every code step carries concrete implementation and real assertions. `PILOT_SEED` is a runtime value filled in Task 6 Step 5 from live catalog output (a data value, not a stub); a seed of an empty array would produce a no-op, which is acceptable for a `--list` dry run.

**Type/signature consistency:** `generateCover(token, { model, prompt, width, height }, deps)` matches Task 2's definition and Task 4's call site; `composePrompt(template, trackLike)` matches Task 1 and Tasks 4/6; `recordSpend(state, {model, predictionId, trackTitle, cost})`, `shouldAlert`, `markAlerted`, `remainingUsd`, `loadSpend`/`saveSpend`, `DEFAULT_PATH` all consistent across Tasks 3/4/6. `genCover(prompt, {artist,title,model}, deps)` uniform in Tasks 4/6.