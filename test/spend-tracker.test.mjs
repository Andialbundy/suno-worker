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
