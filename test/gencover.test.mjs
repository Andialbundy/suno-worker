import { test } from 'node:test'
import assert from 'node:assert/strict'
import { genCover, genBaseAndCover } from '../src/finalize-gp.mjs'

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
  assert.ok('token' in sent[0]) // token is the REPLICATE_API_TOKEN (undefined in tests <= no env; confirm the arg is passed through)
})

test('genCover throws propagate from generate', async () => {
  await assert.rejects(
    genCover('x', {}, { generate: async () => { throw new Error('REPLICATE_API_TOKEN missing') } }),
    /missing/
  )
})

test('genBaseAndCover returns {base, cover} where base is raw (no artist/title => both are raw)', async () => {
  const fake = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const gen = async () => fake
  const { base, cover } = await genBaseAndCover('prompt', {}, { generate: gen })
  assert.deepEqual(base, fake)
  assert.deepEqual(cover, fake)
})
