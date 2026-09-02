import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderHudCover } from './render-cover-hud.mjs'

const sb = createClient('https://sgvguaaccmzevipfwdbn.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY)
const AI = { base: 'http://100.100.71.76:8190', token: process.env.AI_ENGINE_TOKEN }
const JOB_IDS = [
  'ac900c54-36df-4d91-ab29-ef12ab52e3a5',
  '2c3adb14-8d8d-4bd5-9814-90a2e9fa6e90',
  'd1c6f364-37f1-4200-b60d-1a1e21c434ad',
]

function isValidMedia(buf) {
  if (buf.byteLength < 12) return false
  const b = new Uint8Array(buf)
  const ascii = (s, l) => String.fromCharCode(...b.subarray(s, s + l))
  if (ascii(0, 3) === 'ID3') return true
  if (b[0] !== 0xff) return false
  const byte1 = b[1]
  return (byte1 & 0xe0) === 0xe0 && (byte1 & 0x06) !== 0
}

async function genCover(prompt, { artist, title } = {}) {
  const r = await fetch(`${AI.base}/api/generate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AI.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: `${prompt}, glitch distortion, digital artwork`, model: 'RealVisXL_V5.0_fp16.safetensors', steps: 28, cfg: 5, width: 1024, height: 1024 }),
  })
  if (!r.ok) throw new Error('generate 4xx: ' + r.status)
  const { job_id } = await r.json()
  let png
  for (let i = 0; i < 30; i++) {
    await new Promise((res) => setTimeout(res, 4000))
    const j = await (await fetch(`${AI.base}/api/jobs/${job_id}`, { headers: { Authorization: `Bearer ${AI.token}` } })).json()
    if (j.status === 'done') {
      const img = await (await fetch(`${AI.base}/outputs/${j.output_filename}`, { headers: { Authorization: `Bearer ${AI.token}` } })).arrayBuffer()
      png = Buffer.from(img)
      break
    }
    if (j.status === 'failed' || j.status === 'error') throw new Error('gen failed: ' + JSON.stringify(j))
  }
  if (!png) throw new Error('cover timeout')
  if (!artist || !title) return png
  const dir = tmpdir()
  const basePath = join(dir, `cov-${randomUUID()}.png`)
  const outPath = join(dir, `cov-out-${randomUUID()}.png`)
  writeFileSync(basePath, png)
  try {
    await renderHudCover({ baseImg: basePath, artist, title, out: outPath })
    return readFileSync(outPath)
  } finally {
    rmSync(basePath, { force: true })
    rmSync(outPath, { force: true })
  }
}

async function uploadBucket(bucket, path, buf, contentType) {
  const { error } = await sb.storage.from(bucket).upload(path, buf, { contentType, upsert: true })
  if (error) throw new Error('upload: ' + error.message)
  return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl
}

const { data: jobs } = await sb.from('generation_jobs').select('*').in('id', JOB_IDS)
const { data: artistRows } = await sb.from('artists').select('*').in('id', [jobs.map((j) => j.artist_id)])
const artist = artistRows[0]
const dna = artist?.style_dna ?? {}
const AUTO_PUBLISH_AFTER = 1

for (const job of jobs ?? []) {
  if (job.track_id) { console.log('SKIP', job.title, '(already has track_id)'); continue }
  try {
    const trackId = randomUUID()
    const copyright = `© ${new Date().getFullYear()} Andra Network / ${artist.name}`
    const coverBuf = await genCover(job.image_prompt || 'dark electronic album cover, neon grid', { artist: artist?.name, title: job.title })
    const cover_url = await uploadBucket('tracks', `covers/${trackId}.png`, coverBuf, 'image/png')
    const mp3Res = await fetch(job.audio_url)
    const mp3Buf = mp3Res.ok ? await mp3Res.arrayBuffer() : null
    if (!mp3Buf || !isValidMedia(mp3Buf)) throw new Error('invalid audio')
    const audio_url = await uploadBucket('tracks', `audio/${trackId}.mp3`, mp3Buf, 'audio/mpeg')
    const { count: trackCount } = await sb.from('tracks').select('*', { count: 'exact', head: true }).eq('artist_id', job.artist_id)
    const version = (trackCount ?? 0) + 1
    const shouldPublish = version >= AUTO_PUBLISH_AFTER
    const { data: track, error: dbErr } = await sb.from('tracks').insert({
      id: trackId,
      artist_id: job.artist_id,
      title: job.title,
      audio_url,
      cover_url,
      video_url: null,
      version,
      generation_prompt: job.prompt,
      duration_seconds: job.duration_seconds ?? 240,
      published: shouldPublish,
      copyright,
      bpm: job.bpm,
      key_signature: job.key_signature,
      genre: job.genre,
      mood: job.mood,
      image_prompt: job.image_prompt,
      generation_cost_usd: 0.003,
      generation_log: [`Job: ${job.id}`, `Suno id: ${job.replicate_prediction_id}`, `Artist: ${artist.name}`, `Audio: ${audio_url}`, `Cover: ${cover_url}`, `Version: ${version} | Published: ${shouldPublish}`],
    }).select().single()
    if (dbErr) throw new Error(dbErr.message)
    await sb.from('generation_jobs').update({ status: 'completed', track_id: trackId, completed_at: new Date().toISOString() }).eq('id', job.id)
    console.log('OK', job.title, '→', trackId, version, shouldPublish ? 'published' : 'unpublished')
  } catch (e) {
    await sb.from('generation_jobs').update({ status: 'failed', error: 'manual finalize: ' + (e instanceof Error ? e.message : String(e)) }).eq('id', job.id)
    console.log('FAIL', job.title, e instanceof Error ? e.message : e)
  }
}
console.log('done')