import { createClient } from '@supabase/supabase-js'
import { homedir } from 'os'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — run with: node --env-file=.env src/generate-jobs.mjs')
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

const DRY_RUN = process.argv.includes('--dry')
const COUNT_PER_ARTIST = parseInt(process.argv[2]) || 2

const TITLE_BANKS = {
  ANDRAMON: {
    adjectives: ['Cosmic','Tribal','Dark','Desert','Void','Stardust','Ancient','Moonlit','Neon','Granular','Acid','Ritual','Ember','Phantom','Orbital','Black','Solar','Crystal','Astral','Deep'],
    nouns: ['Spiral','Drift','Pulse','Orbit','Nova','Rift','Rise','Wave','Flame','Signal','Echo','Ghost','Tempest','Witch','Vision','Vortex','Shade','Bloom','Frost','Storm'],
  },
  BUNDIX: {
    adjectives: ['Neon','Aurora','Euphoric','Twilight','Digital','Glacier','Arcade','Crystal','Phantom','Electric','Solar','Nova','Pulse','Hyper','Prism','Velocity','Zenith','Polar','Flux','Radiant'],
    nouns: ['Pulse','Circuit','Horizon','Engine','Surge','Wave','Echo','Drift','Rise','Flow','Spark','Blaze','Storm','Glacier','Apex','Drift','Shine','Arc','Force','Grid'],
  },
  ANDRAX: {
    adjectives: ['Iron','Steel','Brutal','Dark','Raw','Heavy','Thunder','Fierce','Blaze','Frost','Void','Obsidian','Titan','Razor','Savage','Bunker','Steel','Furnace','Hammer','Forge'],
    nouns: ['Furnace','Stampede','Rift','Drop','Reactor','Gate','Sunder','Break','Pulse','Storm','Hammer','Strike','Iron','Core','Blaze','Rise','Impact','Forge','Anvil','Rampart'],
  },
  DYBUN: {
    adjectives: ['Corrupt','Sub','Concrete','Rusted','Toxic','Void','Dark','Industrial','Phantom','Static','Acid','Heavy','Metal','Void','Black','Dead','Fog','Mist','Ghost','Noise'],
    nouns: ['Loop','Circuit','Drift','Station','Signal','Grid','Furnace','Pulse','Machine','Reactor','Static','Echo','Drift','Core','Void','Stack','Flux','Engine','Wave','Noise'],
  },
  AERYN: {
    adjectives: ['Nebula','Star','Moon','Cosmic','Starborne','Celestial','Drift','Hollow','Deep','Silent','Floating','Ethereal','Crystal','Prism','Haze','Aurora','Orbit','Void','Glacier','Mist'],
    nouns: ['Drift','Orbit','Tide','Glow','Signal','Echo','Drift','Haze','Bloom','Stream','Aura','Veil','Shimmer','Drift','Drift','Drift','Drift','Drift','Drift','Drift'],
  },
  NALDIX: {
    adjectives: ['Chrome','Basement','Cinder','Velvet','Midnight','Neon','Smoke','Haze','Fog','Dusk','Amber','Shadow','Urban','Alley','Brick','Pulse','Grid','Steam','Gutter','Night'],
    nouns: ['Pulse','Circuit','Groove','Grid','Rise','Echo','Drift','Wave','Flow','Bass','Room','Alley','Steam','Gutter','Line','Vibe','Loop','Beat','Funk','Track'],
  },
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

function generateTitle(artistName) {
  const bank = TITLE_BANKS[artistName]
  if (!bank) return `${artistName} Track`
  const combo = [pick(bank.adjectives), pick(bank.nouns)]
  if (Math.random() > 0.5) combo.push(pick(bank.nouns))
  return combo.join(' ')
}

async function main() {
  console.log(`[${new Date().toISOString()}] generate-jobs — ${COUNT_PER_ARTIST} jobs per artist — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`)

  const { data: artists } = await sb.from('artists').select('id,name,slug').order('name')
  if (!artists?.length) { console.error('No artists found'); process.exit(1) }

  console.log(`Found ${artists.length} artists`)

  let created = 0, skipped = 0
  for (const artist of artists) {
    for (let i = 0; i < COUNT_PER_ARTIST; i++) {
      const title = generateTitle(artist.name)
      const replicate_prediction_id = `suno_pending_${crypto.randomUUID()}`
      const jobId = crypto.randomUUID()

      console.log(`  ${artist.name}: "${title}" → ${replicate_prediction_id}`)

      if (DRY_RUN) {
        created++
        continue
      }

      const { data, error } = await sb.from('generation_jobs').insert({
        id: jobId,
        title,
        replicate_prediction_id,
        status: 'pending',
        artist_id: artist.id,
      }).select().single()

      if (error) {
        console.error(`  ❌ ${artist.name} "${title}": ${error.message}`)
      } else {
        created++
        console.log(`  ✅ Job ${jobId}`)
      }

      await new Promise(r => setTimeout(r, 200))
    }
  }

  console.log(`\nDone. ${created} jobs created.`)
}

main().catch(e => { console.error(e); process.exit(1) })