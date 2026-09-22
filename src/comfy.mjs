// src/comfy.mjs
// Image generation via ganty32's ai-engine REST API (ComfyUI wrapper).
// Primary: ganty32 ai-engine (free local GPU)
// Fallback: Replicate FLUX (paid — only if ganty32 unreachable)

const AI_BASE = 'http://100.100.71.76:8190'

// Replicate fallback config (see project_andranet_replicate_budget.md)
const REPLICATE_API = 'https://api.replicate.com'
// Note: Replicate budget was paused 2026-07-02 (~$13.50 remaining at that time).
// Only use as fallback when ganty32 is completely unreachable.

export const FLUX_SCHNELL = 'RealVisXL_V5.0_fp16.safetensors'
export const FLUX_PRO = 'flux1-dev-fp8.safetensors'

// Primary model mapping for Replicate fallback (FLUX concept → Replicate model)
export const REPLICATE_MODEL = {
  [FLUX_SCHNELL]: 'black-forest-labs/flux-schnell',
  [FLUX_PRO]: 'black-forest-labs/flux-pro',
}

// Free local GPU — kept for budget tracking compat (zero cost).
export const COST_PER_MODEL = { [FLUX_SCHNELL]: 0, [FLUX_PRO]: 0 }

// Fallback cost (for budget tracking — Replicate is paid)
export const REPLICATE_COST = {
  [FLUX_SCHNELL]: 0.003,
  [FLUX_PRO]: 0.025,
}

async function safeText(res) {
  try { return await res.text() } catch { return '' }
}

// ── Primary: ganty32 ai-engine (ComfyUI wrapper) ──────────────────────────

async function createJob(token, prompt, opts, fetchImpl) {
  const res = await fetchImpl(`${AI_BASE}/api/generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      model: opts.model,
      width: opts.width,
      height: opts.height,
      steps: opts.steps,
      mode: 'base',
    }),
  })
  if (!res.ok) throw new Error(`comfy generate ${res.status}: ${await safeText(res)}`)
  return res.json()
}

async function pollJob(token, jobId, { maxWait = 120000, interval = 2000 } = {}, fetchImpl) {
  const deadline = Date.now() + maxWait
  while (Date.now() < deadline) {
    const res = await fetchImpl(`${AI_BASE}/api/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`comfy poll ${res.status}: ${await safeText(res)}`)
    const j = await res.json()
    const status = j.status || (j.state ? j.state.toLowerCase() : null)
    if (status === 'done' || status === 'completed' || status === 'succeeded') return j
    if (status === 'failed' || status === 'errored') {
      throw new Error('comfy failed: ' + (j.error || j.message || JSON.stringify(j)))
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error('comfy poll timeout')
}

async function fetchOutput(token, filename, fetchImpl) {
  const res = await fetchImpl(`${AI_BASE}/outputs/${encodeURIComponent(filename)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`comfy output ${res.status}: ${await safeText(res)}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function generateCoverAI(token, { model = FLUX_SCHNELL, prompt, width = 1024, height = 1024, steps = 15 } = {}, deps = {}) {
  if (!token) throw new Error('AI_ENGINE_TOKEN missing')
  const { fetchImpl = fetch } = deps
  const created = await createJob(token, prompt, { model, width, height, steps }, fetchImpl)
  const jobId = created.job_id ?? created.id
  if (!jobId) throw new Error('comfy create: no job_id in response')
  const finished = await pollJob(token, jobId, {}, fetchImpl)
  const filename = finished.outputs?.[0]?.filename ?? finished.output_filename ?? finished.output?.filename ?? finished.filename
  if (!filename) throw new Error('comfy poll: no output filename in response')
  return fetchOutput(token, filename, fetchImpl)
}

// ── Fallback: Replicate FLUX ──────────────────────────────────────────────

async function replicateGenerate(token, { model, prompt, width = 1024, height = 1024 }, fetchImpl) {
  const replicateModel = REPLICATE_MODEL[model] || model
  const res = await fetchImpl(`${REPLICATE_API}/v1/models/${replicateModel}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=60',
    },
    body: JSON.stringify({
      input: { prompt, aspect_ratio: '1:1', output_format: 'png', num_outputs: 1, width, height },
    }),
  })
  if (!res.ok) throw new Error(`replicate create ${res.status}: ${await safeText(res)}`)
  const p = await res.json()

  // If Prefer: wait=60 already returned succeeded
  if (p.status === 'succeeded') {
    const outUrl = Array.isArray(p.output) ? p.output[0] : p.output
    const dl = await fetchImpl(outUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (!dl.ok) throw new Error(`replicate download ${dl.status}`)
    return Buffer.from(await dl.arrayBuffer())
  }
  if (p.status === 'failed') throw new Error('replicate failed: ' + JSON.stringify(p.error))

  // Poll for completion (max 60s)
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000))
    const poll = await fetchImpl(`${REPLICATE_API}/v1/predictions/${p.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const pollJson = await poll.json()
    if (pollJson.status === 'succeeded') {
      const outUrl = Array.isArray(pollJson.output) ? pollJson.output[0] : pollJson.output
      const dl = await fetchImpl(outUrl, { headers: { Authorization: `Bearer ${token}` } })
      if (!dl.ok) throw new Error(`replicate download ${dl.status}`)
      return Buffer.from(await dl.arrayBuffer())
    }
    if (pollJson.status === 'failed') throw new Error('replicate failed: ' + JSON.stringify(pollJson.error))
  }
  throw new Error('replicate poll timeout')
}

// ── Public API: primary with automatic fallback ───────────────────────────

export async function generateCover(token, { model = FLUX_SCHNELL, prompt, width = 1024, height = 1024, steps = 15 } = {}, deps = {}) {
  const { fetchImpl = fetch } = deps
  // Primary: ganty32 ai-engine
  let primaryError
  try {
    return await generateCoverAI(token, { model, prompt, width, height, steps }, { fetchImpl })
  } catch (e) {
    console.warn(`[comfy] ganty32 failed (${e.message}), falling back to Replicate...`)
    primaryError = e
  }
  // Fallback: Replicate
  if (!process.env.REPLICATE_API_TOKEN) throw new Error('AI_ENGINE_TOKEN missing and REPLICATE_API_TOKEN not set')
  try {
    return await replicateGenerate(process.env.REPLICATE_API_TOKEN, { model, prompt, width, height }, fetchImpl)
  } catch (e2) {
    throw new Error(`comfy generate failed (primary + fallback): ${primaryError?.message ?? 'unknown'} | replicate: ${e2.message}`)
  }
}
