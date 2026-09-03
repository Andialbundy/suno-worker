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
