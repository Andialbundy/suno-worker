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
