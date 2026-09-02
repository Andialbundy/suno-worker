import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
const sb = createClient('https://sgvguaaccmzevipfwdbn.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY)
const { data } = await sb.storage.from('digital-products').createSignedUrl('nexus-signal-depth.zip', 600)
const r = await fetch(data.signedUrl)
const buf = Buffer.from(await r.arrayBuffer())
writeFileSync('/tmp/opencode/bc-release/nexus-signal-depth.zip', buf)
console.log('zip bytes:', buf.length)
