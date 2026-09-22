// test/comfy.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FLUX_SCHNELL, FLUX_PRO, COST_PER_MODEL, REPLICATE_COST,
  REPLICATE_MODEL, generateCover, generateCoverAI,
} from '../src/comfy.mjs'

function fakeFetch(sequence) {
  let i = 0
  return async (url, opts = {}) => {
    const step = i < sequence.length ? sequence[i++] : sequence[sequence.length - 1]
    assert.equal(url, step.url)
    if (step.check) step.check(opts)
    return { ok: true, status: step.status ?? 200, json: async () => step.json, arrayBuffer: async () => step.buf }
  }
}

// ── Exports ──────────────────────────────────────────────────

test('exports', () => {
  assert.equal(typeof generateCover, 'function')
  assert.equal(typeof generateCoverAI, 'function')
  assert.equal(typeof FLUX_SCHNELL, 'string')
  assert.equal(typeof FLUX_PRO, 'string')
  assert.deepEqual(COST_PER_MODEL, { [FLUX_SCHNELL]: 0, [FLUX_PRO]: 0 })
  assert.deepEqual(REPLICATE_COST, { [FLUX_SCHNELL]: 0.003, [FLUX_PRO]: 0.025 })
})

test('REPLICATE_MODEL maps FLUX names to Replicate model IDs', () => {
  assert.equal(REPLICATE_MODEL[FLUX_SCHNELL], 'black-forest-labs/flux-schnell')
  assert.equal(REPLICATE_MODEL[FLUX_PRO], 'black-forest-labs/flux-pro')
})

test('COST_PER_MODEL: zero (primary local GPU)', () => {
  assert.equal(COST_PER_MODEL[FLUX_SCHNELL], 0)
  assert.equal(COST_PER_MODEL[FLUX_PRO], 0)
})

// ── Primary: ganty32 ai-engine ────────────────────────────────

test('generateCoverAI posts /api/generate, polls /api/jobs/{id}, fetches /outputs/{filename}', async () => {
  const buf = Buffer.from([0x52, 0x49, 0x46, 0x46])
  const seq = [
    {
      url: 'http://100.100.71.76:8190/api/generate', method: 'POST',
      check: (o) => {
        assert.equal(o.headers.Authorization, 'Bearer tok')
        const body = JSON.parse(o.body)
        assert.equal(body.prompt, 'p')
        assert.equal(body.model, FLUX_SCHNELL)
        assert.equal(body.width, 1024)
        assert.equal(body.height, 1024)
        assert.equal(body.steps, 15)
      },
      json: { job_id: 'job-1' },
    },
    { url: 'http://100.100.71.76:8190/api/jobs/job-1', json: { status: 'processing' } },
    { url: 'http://100.100.71.76:8190/api/jobs/job-1', json: { status: 'done', outputs: [{ filename: 'out.png' }] } },
    { url: 'http://100.100.71.76:8190/outputs/out.png', buf },
  ]
  const out = await generateCoverAI('tok', { model: FLUX_SCHNELL, prompt: 'p' }, { fetchImpl: fakeFetch(seq) })
  assert.deepEqual(out, buf)
})

test('generateCoverAI handles string job_id', async () => {
  const buf = Buffer.from([0x01, 0x02])
  const seq = [
    { url: 'http://100.100.71.76:8190/api/generate', json: { id: 'job-2' } },
    { url: 'http://100.100.71.76:8190/api/jobs/job-2', json: { status: 'done', outputs: [{ filename: 'out2.png' }] } },
    { url: 'http://100.100.71.76:8190/outputs/out2.png', buf },
  ]
  const out = await generateCoverAI('tok', { model: FLUX_PRO, prompt: 'q' }, { fetchImpl: fakeFetch(seq) })
  assert.deepEqual(out, buf)
})

test('generateCoverAI rejects failed job', async () => {
  const seq = [
    { url: 'http://100.100.71.76:8190/api/generate', json: { job_id: 'job-3' } },
    { url: 'http://100.100.71.76:8190/api/jobs/job-3', json: { status: 'failed', error: 'boom' } },
  ]
  await assert.rejects(
    generateCoverAI('tok', { model: FLUX_SCHNELL, prompt: 'x' }, { fetchImpl: fakeFetch(seq) }),
    /comfy failed/
  )
})

test('generateCoverAI reads output from outputs array with URL', async () => {
  const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const seq = [
    { url: 'http://100.100.71.76:8190/api/generate', json: { job_id: 'job-5' } },
    { url: 'http://100.100.71.76:8190/api/jobs/job-5', json: { status: 'done', outputs: [{ filename: 'path/out5.png', url: '/outputs/path/out5.png' }] } },
    { url: 'http://100.100.71.76:8190/outputs/path%2Fout5.png', buf },
  ]
  const out = await generateCoverAI('tok', { model: FLUX_SCHNELL, prompt: 'url-test' }, { fetchImpl: fakeFetch(seq) })
  assert.deepEqual(out, buf)
})

// ── Fallback: Replicate ───────────────────────────────────────

test('generateCover falls back to Replicate when ganty32 fails', async () => {
  const prevEnv = process.env.REPLICATE_API_TOKEN
  process.env.REPLICATE_API_TOKEN = 'rep-tok'
  const buf = Buffer.from([0x52, 0x49, 0x46, 0x47])
  let callPhase = 'primary'
  const seq = [
    { url: 'http://100.100.71.76:8190/api/generate', status: 503, json: { error: 'unreachable' } },
    { url: 'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', json: { id: 'r-1', status: 'succeeded', output: 'https://cdn/out.webp' } },
    { url: 'https://cdn/out.webp', buf },
  ]
  const out = await generateCover('tok', { model: FLUX_SCHNELL, prompt: 'fallback-test' }, {
    fetchImpl: async (url, opts) => {
      const step = seq.shift()
      assert.equal(url, step.url)
      if (url.startsWith('http://100.100.71.76:8190')) callPhase = 'primary'
      else callPhase = 'replicate'
      return { ok: true, status: step.status ?? 200, json: async () => step.json, arrayBuffer: async () => buf }
    },
  })
  assert.deepEqual(out, buf)
  assert.equal(callPhase, 'replicate')
  process.env.REPLICATE_API_TOKEN = prevEnv
})

test('generateCover throws when both primary and fallback fail', async () => {
  const prevEnv = process.env.REPLICATE_API_TOKEN
  process.env.REPLICATE_API_TOKEN = 'rep-tok'
  const seq = [
    { url: 'http://100.100.71.76:8190/api/generate', status: 503, json: { error: 'unreachable' } },
    { url: 'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', status: 500, json: { error: 'no credits' } },
  ]
  await assert.rejects(
    generateCover('tok', { model: FLUX_SCHNELL, prompt: 'total-fail' }, {
      fetchImpl: async (url) => {
        const step = seq.shift()
        return { ok: step.ok ?? false, status: step.status ?? 500, json: async () => step.json }
      },
    }),
    /primary \+ fallback/
  )
  process.env.REPLICATE_API_TOKEN = prevEnv
})

test('generateCover throws on missing token', async () => {
  await assert.rejects(
    generateCover('', { model: FLUX_SCHNELL, prompt: 'y' }),
    /AI_ENGINE_TOKEN missing/
  )
})

// ── Timeout ───────────────────────────────────────────────────

test('generateCover falls back to Replicate when ganty32 times out', async () => {
  const prevEnv = process.env.REPLICATE_API_TOKEN
  process.env.REPLICATE_API_TOKEN = 'rep-tok'
  let pollCount = 0
  const seq = [
    { url: 'http://100.100.71.76:8190/api/generate', json: { job_id: 'job-4' } },
    { url: 'http://100.100.71.76:8190/api/jobs/job-4', status: 500, json: { error: 'timeout' } },
    { url: 'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', json: { id: 'r-4', status: 'succeeded', output: 'https://cdn/out4.png' } },
    { url: 'https://cdn/out4.png', buf: Buffer.from([0x52, 0x49, 0x46]) },
  ]
  const out = await generateCover('tok', { model: FLUX_SCHNELL, prompt: 'timeout-fallback' }, {
    fetchImpl: async (url) => {
      const step = seq.shift()
      if (url.includes('/api/generate') || url.includes('/api/jobs/')) pollCount++
      return { ok: (step.status ?? 200) < 400, status: step.status ?? 200, json: async () => step.json, arrayBuffer: async () => step.buf }
    },
  })
  assert.ok(pollCount >= 2)
  process.env.REPLICATE_API_TOKEN = prevEnv
})
