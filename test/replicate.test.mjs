// test/replicate.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FLUX_SCHNELL, FLUX_PRO, COST_PER_MODEL, generateCover } from '../src/replicate.mjs'

function fakeFetch(sequence) {
  let i = 0
  return async (url, opts = {}) => {
    const step = i < sequence.length ? sequence[i++] : sequence[sequence.length - 1]
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
