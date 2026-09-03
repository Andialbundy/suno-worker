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
