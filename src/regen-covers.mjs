// src/regen-covers.mjs
import { composePrompt } from './cover-prompt.mjs'
import { genCover } from './finalize-gp.mjs'
import { loadSpend, recordSpend, saveSpend, shouldAlert, markAlerted, remainingUsd } from './spend-tracker.mjs'
import { COST_PER_MODEL, FLUX_SCHNELL, FLUX_PRO } from './replicate.mjs'

export const OFFICIAL_TITLE_EXCLUDE = /Test|Chrome|Loop|\bTrack\s?\d|Final Stability|Recovery|Noise Loop|^Track/i

export function isOfficialTrack(t) {
  return !!t && !OFFICIAL_TITLE_EXCLUDE.test(t.title || '')
}

export function budgetSafe(spend, nextCost) {
  return remainingUsd(spend) - nextCost > 1
}

export async function selectOfficialTracks(sb, { pilot = false, pilotSeed = undefined } = {}) {
  const { data: artists } = await sb.from('artists').select('id,name,image_prompt_template')
  const { data: tracks } = await sb.from('tracks').select('id,title,artist_id,image_prompt,mood,cover_url,published')
  const rows = (tracks ?? []).filter(isOfficialTrack).map((tr) => ({
    ...tr,
    artist: (artists ?? []).find((a) => a.id === tr.artist_id),
  })).filter((tr) => tr.artist && tr.artist.image_prompt_template)
  if (!pilot) return rows
  if (!pilotSeed || !Array.isArray(pilotSeed)) throw new Error('pilot mode requires pilotSeed: [{artist, title}]')
  return pilotSeed
    .map(({ artist, title }) => rows.find((r) => r.artist.name === artist && r.title === title))
    .filter(Boolean)
}

export async function regenAll(sb, { model, pilot = false, pilotSeed }) {
  const rows = await selectOfficialTracks(sb, { pilot, pilotSeed })
  let spend = loadSpend()
  let updated = []
  for (const track of rows) {
    const cost = COST_PER_MODEL[model]
    if (!budgetSafe(spend, cost)) { console.log('BUDGET STOP at', remainingUsd(spend)); break }
    const prompt = composePrompt(track.artist.image_prompt_template, { image_prompt: track.image_prompt, mood: track.mood, title: track.title })
    const buf = await genCover(prompt, { artist: track.artist.name, title: track.title, model })
    const url = await uploadBucket(sb, track.id, buf)   // helper below
    await sb.from('tracks').update({ cover_url: url }).eq('id', track.id)
    spend = recordSpend(spend, { model, cost, trackTitle: track.title })
    updated.push(track.title)
    if (shouldAlert(spend)) { console.log('ALERT $9 reached'); spend = markAlerted(spend) }
  }
  saveSpend(spend)
  return updated
}

async function uploadBucket(sb, trackId, buf) {
  const { error } = await sb.storage.from('tracks').upload(`covers/${trackId}.png`, buf, { contentType: 'image/png', upsert: true })
  if (error) throw new Error('upload: ' + error.message)
  return sb.storage.from('tracks').getPublicUrl(`covers/${trackId}.png`).data.publicUrl
}

export const PILOT_SEED = [
  { artist: 'ANDRAMON', title: 'Ember Spiral' },
  { artist: 'BUNDIX', title: 'NEON PULSE PROTOCOL' },
  { artist: 'ANDRAX', title: 'Bass Rift' },
  { artist: 'DYBUN', title: 'Winter Beacon' },
  { artist: 'AERYN', title: 'Cosmic Drift' },
  { artist: 'NALDIX', title: 'Basement Pulse Groove' },
]

if (import.meta.url === `file://${process.argv[1]}`) {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const args = process.argv.slice(2)
  const pilot = args.includes('--pilot')
  const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : FLUX_SCHNELL
  if (args.includes('--list')) {
    const rows = await selectOfficialTracks(sb, { pilot, pilotSeed: PILOT_SEED })
    for (const r of rows) console.log(r.artist.name, '|', r.title)
    console.log('count:', rows.length)
    process.exit(0)
  }
  const updated = await regenAll(sb, { model, pilot, pilotSeed: PILOT_SEED })
  console.log('regen done for', updated.length, 'tracks')
}
