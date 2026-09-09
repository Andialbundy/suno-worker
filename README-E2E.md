# E2E Test Guide (FLAC-Automatik)

## Worker auf neuralnode starten

```bash
# Auf neuralnode:
systemctl restart suno-worker
systemctl status suno-worker.timer   # ACTIVE?
```

## Job erstellen und polln

```js
// Supabase: Neuen generation_jobs-Eintrag erstellen
// status=pending, replicate_prediction_id='suno_pending_test_...'
// title, prompt, bpm, key_signature, genre, mood, duration_seconds

// Poll alle 30s:
SELECT status, replicate_prediction_id, audio_url FROM generation_jobs WHERE id='<jobId>'
```

## Erwarteter Ablauf (~5-10 Min pro Job)

```
pending → processing → pending (rid='suno_<clipId>') + audio_url gesetzt
                    → finalize-gp läuft → tracks.insert + cover
```

## Verifikation

```js
// 1. Job status=completed?
// 2. replicate_prediction_id hat 'suno_' Prefix?
// 3. audio_url !== null?
// 4. tracks.table: audio_url + storage_path gesetzt?
// 5. FLAC: storage_path = 'audio/<trackId>_master.flac' (publicUrl)
```

## Debug

```bash
# Docker Logs auf neuralnode:
docker logs suno-worker  # oder: journalctl -u suno-worker.service
# Worker Output zeigt: generateSong → clipId → downloadRealAudio → harvest → flacUrl
```

## Fehlerfälle

- `flacUrl is not defined` → FIXED (let flacUrl = null in generateSong outer scope)
- `process died mid-job` → Bash-Timeout. Auf neuralnode laufen lassen, nicht lokal.
- `audioUrl is null` → Chrome-Profil leer → AutoLogin testen (SUNO_EMAIL/SUNO_PASSWORD)
- `No queued Suno jobs` → Timer läuft, aber Vercel Cron hat noch keinen Job erstellt
