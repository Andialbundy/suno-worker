import { createClient } from '@supabase/supabase-js'
const sb = createClient('https://sgvguaaccmzevipfwdbn.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY)
const { data: tracks } = await sb.from('tracks').select('id,title,cover_url,published').eq('published', true)
const bad = []
for (const t of tracks ?? []) {
  if (!t.cover_url) { bad.push([t.id.slice(0,8), t.title.slice(0,28), 'NULL']); continue }
  try {
    const r = await fetch(t.cover_url, { method: 'HEAD' })
    if (!r.ok || !r.headers.get('content-type')?.startsWith('image')) bad.push([t.id.slice(0,8), t.title.slice(0,28), `${r.status} ${r.headers.get('content-type')}`])
  } catch (e) { bad.push([t.id.slice(0,8), t.title.slice(0,28), 'FETCH-ERR']) }
}
console.log('published total:', tracks?.length, '| broken covers:', bad.length)
for (const b of bad) console.log(b.join(' | '))
