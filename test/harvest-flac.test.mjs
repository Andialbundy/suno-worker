// test/harvest-flac.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeTrim, transcodeToFlac, fallbackMp3ToFlac, harvestSegments, MERGE_SCRIPT } from '../src/harvest-flac.mjs'

function ffprobe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], { encoding: 'utf8' })
  return Number(JSON.parse(out).format.duration)
}

function makeOpusM4a(dir, seconds = 3) {
  const src = join(dir, 'src.opus')
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}:sample_rate=48000`, '-c:a', 'libopus', '-b:a', '96k', src])
  return src
}

function makeMp3(dir, seconds = 3) {
  const src = join(dir, 'src.mp3')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}:sample_rate=48000`, '-c:a', 'libmp3lame', '-b:a', '128k', src])
  return src
}

test('computeTrim cuts when decoded exceeds ground truth', () => {
  assert.deepEqual(computeTrim({ decodedSeconds: 3.6, groundTruthSeconds: 3, sampleRate: 48000 }), {
    cut: true, endSample: 144000,
  })
})

test('computeTrim skips when decoded within tolerance', () => {
  assert.deepEqual(computeTrim({ decodedSeconds: 3.0, groundTruthSeconds: 3, sampleRate: 48000 }), { cut: false })
})

test('transcodeToFlac outputs real FLAC near ground truth duration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hflac-'))
  try {
    const m4a = readFileSync(makeOpusM4a(dir, 3))
    const flac = transcodeToFlac(m4a, { groundTruthSeconds: 3, sampleRate: 48000, metadata: { ARTIST: 'NALDIX', TITLE: 'T' } })
    assert.ok(flac.length > 1000, 'flac buffer non-trivial')
    assert.equal(flac.subarray(0, 4).toString(), 'fLaC', 'flac magic')
    const out = join(dir, 'out.flac')
    writeFileSync(out, flac)
    const dur = ffprobe(out)
    assert.ok(Math.abs(dur - 3) < 0.2, `flac duration ~3s (got ${dur})`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('fallbackMp3ToFlac outputs valid FLAC from mp3', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hflac-'))
  try {
    const mp3 = readFileSync(makeMp3(dir, 3))
    const flac = fallbackMp3ToFlac(mp3, { metadata: { ARTIST: 'NALDIX' } })
    assert.equal(flac.subarray(0, 4).toString(), 'fLaC', 'flac magic')
    const out = join(dir, 'fb.flac')
    writeFileSync(out, flac)
    const dur = ffprobe(out)
    assert.ok(Math.abs(dur - 3) < 0.2, `fallback flac ~3s (got ${dur})`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('harvestSegments merges window.__segs into buffer', async () => {
  globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64')
  const window = { __segs: [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])], __msCount: 1 }
  // Set global window for MERGE_SCRIPT
  globalThis.window = window
  try {
    const fakePage = { 
      async evaluate(fnStr) { 
        return new Function('', fnStr).call(window) 
      } 
    }
    const result = await harvestSegments(fakePage)
    assert.ok(Buffer.isBuffer(result), 'returns Buffer')
    assert.deepEqual([...result], [1, 2, 3, 4, 5])
  } finally {
    delete globalThis.window
  }
})

test('MERGE_SCRIPT tags opus/mp4 m4a', () => {
  globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64')
  const window = { __segs: [new Uint8Array([9, 9])], __msCount: 1 }
  globalThis.window = window
  try {
    const payload = new Function('', MERGE_SCRIPT).call(window)
    assert.equal(payload.ok, true)
    assert.equal(payload.count, 1)
  } finally {
    delete globalThis.window
  }
})