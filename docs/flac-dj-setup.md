# FLAC DJ Setup — Recordbox Recipe (2026-09-07)

Ziel: 1 Song / Artist (BUNDIX, ANDRAMON, ANDRAX, DYBUN, AERYN, NALDIX), FLAC only.

Struktur:
- `/mnt/qnap-multimedia/musik/{Artist}/flac/` — FLAC + Cover
- `cover-hud.json` → PNG Cover (Orbitron, cyan/magenta/red/green/lavender/gold per Artist)
- Meta: ARTIST, TITLE, VERSION (DB `version`), KEY, BPM, COVER embedded

Key/BPM: auto via `analyse_flac_key_bpm.mjs` (aubio/ffmpeg).
Playlist: `playlists/key/<key>-set.m3u` (optimal DJ-Order nach BPM + Key).

DB: Supabase `tracks` (toolost_approved, version, artist, cover_url).
Upload: `upload_flac_release.sh` (curl PUT zu Supabase storage bucket `tracks`).
