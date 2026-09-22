import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { writeFileSync, readFileSync, rmSync, writeFileSync as writeFileFs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { renderHudCover } from './render-cover-hud.mjs'
import { generateCover, FLUX_SCHNELL, COST_PER_MODEL, REPLICATE_COST } from './comfy.mjs'
import { composePrompt } from './cover-prompt.mjs'
import { loadSpend, saveSpend, recordSpend, shouldAlert, markAlerted, remainingUsd } from './spend-tracker.mjs'

const QNAP_FLAC_BASE = '/mnt/qnap-multimedia/Musik/andra.network'

function makeLazySb() {
  let client
  return new Proxy({}, {
    get(_, prop) {
      if (!client) client = createClient('https://sgvguaaccmzevipfwdbn.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY)
      return client[prop]
    },
  })
}
const sb = makeLazySb()
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

async function writeBaseAndOverlay({ base, artist, title }) {
  const dir = tmpdir()
  const basePath = join(dir, `cov-${randomUUID()}.png`)
  const outPath = join(dir, `cov-out-${randomUUID()}.png`)
  writeFileSync(basePath, base)
  try {
    await renderHudCover({ baseImg: basePath, artist, title, out: outPath })
    return { base: basePath, cover: outPath }
  } catch (e) {
    rmSync(basePath, { force: true })
    rmSync(outPath, { force: true })
    throw e
  }
}

export async function genCover(prompt, { artist, title, model = FLUX_SCHNELL } = {}, deps = {}) {
  const gen = deps.generate ?? generateCover
  const base = await gen(process.env.AI_ENGINE_TOKEN, { model, prompt })
  if (!artist || !title) return base
  const { base: basePath, cover: outPath } = await writeBaseAndOverlay({ base, artist, title })
  try {
    return readFileSync(outPath)
  } finally {
    rmSync(basePath, { force: true })
    rmSync(outPath, { force: true })
  }
}

export async function genBaseAndCover(prompt, { artist, title, model = FLUX_SCHNELL } = {}, deps = {}) {
  const gen = deps.generate ?? generateCover
  const base = await gen(process.env.AI_ENGINE_TOKEN, { model, prompt })
  if (!artist || !title) return { base, cover: base }
  const { base: basePath, cover: outPath } = await writeBaseAndOverlay({ base, artist, title })
  try {
    return { base, cover: readFileSync(outPath) }
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const { data: jobs } = await sb.from('generation_jobs').select('*').in('id', JOB_IDS)
  const { data: artistRows } = await sb.from('artists').select('*').in('id', [jobs.map((j) => j.artist_id)])
  const artist = artistRows[0]
  const dna = artist?.style_dna ?? {}
  const AUTO_PUBLISH_AFTER = 1
  let spend = loadSpend()

  for (const job of jobs ?? []) {
    if (job.track_id) { console.log('SKIP', job.title, '(already has track_id)'); continue }
    try {
      const trackId = randomUUID()
      const copyright = `© ${new Date().getFullYear()} Andra Network / ${artist.name}`
      const template = artist?.image_prompt_template
      const finalPrompt = composePrompt(template, { image_prompt: job.image_prompt, mood: job.mood, title: job.title })
      const { base: baseCover, cover: coverBuf } = await genBaseAndCover(finalPrompt, { artist: artist?.name, title: job.title })
      const cover_url = await uploadBucket('tracks', `covers/${trackId}.png`, coverBuf, 'image/png')
      const cover_base_url = await uploadBucket('tracks', `covers/${trackId}_base.png`, baseCover, 'image/png')
      spend = recordSpend(spend, { model: FLUX_SCHNELL, cost: COST_PER_MODEL[FLUX_SCHNELL], trackTitle: job.title, predictionId: job.id })
      // Note: if Replicate fallback is used, actual cost is REPLICATE_COST[FLUX_SCHNELL] ($0.003)
      saveSpend(spend)
      if (shouldAlert(spend)) {
        console.log('COVER GEN BUDGET ALERT:', remainingUsd(spend), 'USD left -', spend.total_usd, 'USD spent')
        spend = markAlerted(spend)
        saveSpend(spend)
      }

      const mp3Res = await fetch(job.audio_url)
      const mp3Buf = mp3Res.ok ? await mp3Res.arrayBuffer() : null
      if (!mp3Buf || !isValidMedia(mp3Buf)) throw new Error('invalid audio')

      // End-user format: WAV only (convert MP3→WAV via ffmpeg)
      const mp3Path = join(tmpdir(), `finalize_${trackId}.mp3`)
      const wavPath = join(tmpdir(), `finalize_${trackId}.wav`)
      writeFileSync(mp3Path, Buffer.from(mp3Buf))
      try {
        execSync(`ffmpeg -y -v error -i "${mp3Path}" -ac 2 -ar 44100 -f wav "${wavPath}"`, { timeout: 30000 })
        const wavBuf = readFileSync(wavPath)
        const audio_url = await uploadBucket('tracks', `audio/${trackId}.wav`, wavBuf, 'audio/wav')
      } catch (e) {
        console.error('WAV conversion failed, falling back to MP3:', e.message)
        const audio_url = await uploadBucket('tracks', `audio/${trackId}.mp3`, mp3Buf, 'audio/mpeg')
      }

      // FLAC-Master goes ONLY to QNAP (never Supabase)
      let storage_path = null
      try {
        const artistName = (await sb.from('artists').select('name').eq('id', job.artist_id).single()).data?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'UNKNOWN_ARTIST'
        const qnapFlacDir = join(QNAP_FLAC_BASE, artistName, 'flac')
        const qnapFlacPath = join(qnapFlacDir, `flac_${trackId}.flac`)
        const { data: master } = await sb.storage.from('tracks').getPublicUrl(`audio/master/${job.id}.flac`)
        if (master?.publicUrl) {
          const mres = await fetch(master.publicUrl)
          if (mres.ok) {
            const flacBuf = Buffer.from(await mres.arrayBuffer())
            // Write FLAC master to QNAP path
            execSync(`mkdir -p "${qnapFlacDir}"`, { timeout: 5000 })
            writeFileSync(qnapFlacPath, flacBuf)
            storage_path = `qnap://${artistName}/flac/flac_${trackId}.flac`
            console.log(`FLAC master written to QNAP: ${qnapFlacPath}`)
          }
        }
      } catch (e) { console.error('FLAC master not available for QNAP:', e.message) }

      const { count: trackCount } = await sb.from('tracks').select('*', { count: 'exact', head: true }).eq('artist_id', job.artist_id)
      const version = (trackCount ?? 0) + 1
      const shouldPublish = version >= AUTO_PUBLISH_AFTER
      const { data: track, error: dbErr } = await sb.from('tracks').insert({
        id: trackId,
        artist_id: job.artist_id,
        title: job.title,
        audio_url,
        cover_url,
        cover_base_url,
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
        generation_cost_usd: 0,
        storage_path,
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
}