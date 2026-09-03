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
