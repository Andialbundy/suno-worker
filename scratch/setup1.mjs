import { createClient } from '@supabase/supabase-js'
const URL = 'https://sgvguaaccmzevipfwdbn.supabase.co'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const sb = createClient(URL, KEY)

// 1. Schema: description + preview_url via pg-meta
const res = await fetch(`${URL}/pg/query`, {
  method: 'POST', headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: "ALTER TABLE products ADD COLUMN IF NOT EXISTS description text; ALTER TABLE products ADD COLUMN IF NOT EXISTS preview_url text;" })
})
console.log('pg-meta:', res.status, (await res.text()).slice(0,80))

// 2. generation_jobs ref für 7c654622 nullen, dann Duplikate löschen
const { data: refs, error: re } = await sb.from('generation_jobs').update({ track_id: null }).eq('track_id', '7c654622-4c3a-4b73-a948-d18d10e2dd4f').select('id')
console.log('job-null:', re ? 'ERR '+re.message : refs.length+' rows')
const del1 = await sb.from('tracks').delete().eq('id', '3393a899-cd4b-4b3d-9806-06286126aed0')
const del2 = await sb.from('tracks').delete().eq('id', '7c654622-4c3a-4b73-a948-d18d10e2dd4f')
console.log('del GlacierPulse v11:', del1.error ? 'ERR '+del1.error.message : 'ok')
console.log('del UPLIFTING v24:', del2.error ? 'ERR '+del2.error.message : 'ok')

// 3. Produkte + repräsentative Track-URLs für preview_url
const { data: prods } = await sb.from('products').select('id,name')
const reps = {}
for (const [name, query] of [['Glass Halo Drift','eq.track_title_placeholder_skip'], []]) {}
const { data: gh } = await sb.from('tracks').select('id,audio_url').eq('title','Glass Halo Drift').limit(1)
const { data: np } = await sb.from('tracks').select('id,audio_url').eq('title','NEON PULSE PROTOCOL').limit(1)
const { data: rd } = await sb.from('tracks').select('id,audio_url').eq('title','Riser in D Minor').limit(1)
const { data: ca } = await sb.from('tracks').select('id,audio_url').eq('title','Concrete After Rain').limit(1)
console.log('products:', prods?.map(p=>`${p.name} | ${p.id}`).join('\n'))
console.log('\nREP:\nglassHalo:', gh?.[0]?.audio_url, '\nneon:', np?.[0]?.audio_url, '\nriser:', rd?.[0]?.audio_url, '\nconcrete:', ca?.[0]?.audio_url)
