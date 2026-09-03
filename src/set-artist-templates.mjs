// src/set-artist-templates.mjs
export const TEMPLATES = {
  ANDRAMON: 'biomorphic fractal goa mandala forming a dark cosmic flower, tribal ethno patterns, swirling kaleidoscopic neon colors, deep space void background, hypnotic radial symmetry',
  BUNDIX: 'sublime neon glacier ice cathedral rising from a frozen electronic wasteland, cold cyan and white light rays piercing storm clouds, soaring supersaw light beams, euphoric atmosphere, crystalline geometric structures, emotional uplift',
  ANDRAX: 'brutal industrial steel rave arena, giant subwoofer towers and distortion smoke, brutalist concrete architecture, scorching red-orange furnace light, high-contrast metallic surfaces, powerful heroic stance, dark triumphant energy',
  DYBUN: 'raw underground concrete bunker tunnel, rusted iron machinery and industrial pipes, harsh tungsten spotlight beams cutting through dust and fog, grimy metallic textures, ominous filtered noise haze, brutalist minimal',
  AERYN: 'soft glowing cosmic nebulae drifting in deep space, dreamy ethereal starfields, gentle pastel aurora gradients, serene meditative void, delicate bell-like light motes, introspective calm vastness',
  NALDIX: 'minimalist dark geometric cuboids and clean mechanical lines receding into a deep floor, matte black and subtle gold metallic accents, precise optical perspective, hypnotic grid, sophisticated restrained minimalism, warm deep shadows',
}

export async function main(sb) {
  const { data: artists, error } = await sb.from('artists').select('id,name').in('name', Object.keys(TEMPLATES))
  if (error) throw new Error(error.message)
  const updates = []
  for (const a of artists ?? []) {
    const t = TEMPLATES[a.name]
    const { error: ue } = await sb.from('artists').update({ image_prompt_template: t }).eq('id', a.id)
    if (ue) throw new Error(ue.message)
    updates.push(a.name)
  }
  return updates
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const done = await main(sb)
  console.log('updated image_prompt_template for', done.length, 'artists:', done.join(', '))
}
