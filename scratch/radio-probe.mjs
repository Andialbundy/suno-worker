import { createClient } from '@supabase/supabase-js'
const sb = createClient('https://sgvguaaccmzevipfwdbn.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY)
const { data: tracks } = await sb.from('tracks').select('id,title,cover_url,published').eq('published', true).order('created_at', { ascending: false }).limit(30)
let noCover = 0, bad = []
for (const t of tracks ?? []) {
  if (!t.cover_url) { noCover++; bad.push([t.title, 'NO-COVER']); continue }
  try {
    const r = await fetch(t.cover_url, { method: 'HEAD' })
    if (!r.ok || !r.headers.get('content-type')?.startsWith('image')) bad.push([t.title, `${r.status} ${r.headers.get('content-type')}`])
  } catch (e) { bad.push([t.title, 'FETCH-ERR']) }
}
console.log('published sample:', tracks?.length, '| no cover_url:', noCover)
console.log('BAD:', JSON.stringify(bad, null, 0))
const { data: noCov } = await sb.from('tracks').select('id,title,cover_url').eq('published', true).is('cover_url', null)
console.log('ALL published with NULL cover_url:', noCov?.length, noCov?.map(t=>t.title.slice(0,25)))
