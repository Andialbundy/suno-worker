const QUALITY_SUFFIX = 'high detail, 8k, cinematic lighting'

function stripMoodWart(s) {
  return s.replace(/,?\s*mood\s*:\s*[^,]+$/i, '').trim()
}

export function resolveVariant({ image_prompt, mood, title } = {}) {
  if (image_prompt && image_prompt.trim()) return stripMoodWart(image_prompt)
  if (mood && mood.trim()) return mood.trim()
  if (title && title.trim()) return title.trim()
  return ''
}

export function composePrompt(template, trackLike = {}) {
  const variant = resolveVariant(trackLike)
  const parts = []
  if (template && template.trim()) parts.push(template.trim())
  if (variant) parts.push(variant)
  parts.push(QUALITY_SUFFIX)
  return parts.filter(Boolean).join(', ')
}
