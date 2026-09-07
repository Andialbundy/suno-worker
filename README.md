# Suno Worker — Andra Network Musik-Generierungs-Pipeline

## Quick Start

```bash
# Environment (3 Variablen)
cp .env.example .env
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REPLICATE_API_TOKEN

# Install
npm install

# Worker manuell starten (Entwicklung)
node --env-file=.env src/worker.mjs

# Tests
node --env-file=.env --test test/harvest-flac.test.mjs
# oder alle Tests
node --env-file=.env --test
```

## Architektur

Siehe [`ARCHITECTURE.md`](ARCHITECTURE.md) — vollständige Pipeline (Vercel Cron → Worker → Supabase → Toolost).

## Wichtige Module

| Modul | Zweck |
|---|---|
| `src/worker.mjs` | Haupt-Worker (Browser-Automation, Suno-Generierung, MP3/FLAC-Harvest) |
| `src/finalize-gp.mjs` | Finalisierung (Cover, Track-Insert, Publish, Toolost) |
| `src/harvest-flac.mjs` | **NEU** MSE-Harvest + FLAC-Transcode (Opus→FLAC 48kHz/s16) |
| `src/batch_flac_from_db.mjs` | Legacy: MP3→FLAC Batch |

## Tests

```
test/harvest-flac.test.mjs   # 6 Tests: transcode, harvest, fallback, MERGE_SCRIPT
```

## Deployment (Produktiv)

```bash
# Docker Image bauen
docker build -t suno-worker:chrome .

# systemd auf neuralnode
systemctl start suno-worker.timer   # alle 5 Min
```

## Memory / Docs

```
docs/memory/
  project.md              # Projektstatus (n8n, Toolost, Supabase, Vercel)
  bandcamp-rls-recipe.md  # Bandcamp Release Workflow
  cover-hud-recipe.md     # Cover HUD Overlay Pipeline
  suno-worker-state.md    # Debug State + FLAC-Automatik Status
```
