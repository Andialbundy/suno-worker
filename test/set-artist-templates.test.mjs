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
