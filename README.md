# Suno Worker — Andra Network Musik-Generierungs-Pipeline

## Quick Start

```bash
# Environment (3 Variablen)
cp .env.example .env
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AI_ENGINE_TOKEN

# Install
npm install

# Worker manuell starten (Entwicklung)
node --env-file=.env src/worker.mjs

# Tests
node --env-file=.env --test test/comfy.test.mjs   # 11 Tests, alle grün
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
| `src/harvest-flac.mjs` | MSE-Harvest + FLAC-Transcode (Opus→FLAC 48kHz/s16) |
| `src/comfy.mjs` | Bildgenerierung via ganty32 ComfyUI (Primary) + Replicate (Fallback) |
| `src/cover-prompt.mjs` | Cover Prompt Building |

## Tests

| Test | Status |
|---|---|
| `test/comfy.test.mjs` | ✅ 11/11 passing |
| `test/cover-prompt.test.mjs` | ✅ passing |
| `test/spend-tracker.test.mjs` | ✅ passing |
| `test/set-artist-templates.test.mjs` | ✅ passing |
| `test/gencover.test.mjs` | ❌ pre-existing: needs SVG brand assets + render-cover-hud |
| `test/regen-covers.test.mjs` | ❌ pre-existing: needs SVG brand assets + render-cover-hud |
| `test/harvest-flac.test.mjs` | ❌ pre-existing: harvest-flac.mjs missing MERGE_SCRIPT export |

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
