# Suno Worker — Projektstruktur (Kern)

```
suno-worker/
├── .env                          # SUPABASE_URL, SERVICE_ROLE_KEY, AI_ENGINE_TOKEN (REPLICATE_API_TOKEN optional for fallback)
├── .git/
├── ARCHITECTURE.md               # Pipeline-Architektur (Worker + Vercel + systemd + Docker)
├── CLAUDE.md                     # User-Instructions
├── package.json                  # @supabase/supabase-js, better-sqlite3, playwright
├── package-lock.json
├── README.md                     # Quick Start (dieses Repo)
├── TREE.md                       # Diese Datei
│
├── src/                          # PRODUKTIONSCODE
│   ├── worker.mjs                # Haupt-Worker (Suno-Generierung, MP3/FLAC-Harvest)
│   ├── finalize-gp.mjs           # Finalization (Cover, Track-Insert, Publish, Toolost)
│   ├── cover-prompt.mjs          # Cover Prompt Building
│   ├── harvest-flac.mjs          # MSE-Harvest + FLAC-Transcode (test pre-existing failure)
│   ├── analyse_flac_key_bpm.mjs  # Key/BPM Analyse (Placeholder)
│   ├── generate-jobs.mjs         # Job-Generierung (Prompt, Title, Image)
│   ├── comfy.mjs             # ComfyUI/ai-engine API (Bildgenerierung, ganty32)
│   ├── spend-tracker.mjs         # Suno Credits Tracking
│   ├── render-cover-hud.mjs      # HUD Overlay Renderer (Playwright)
│   ├── regen-covers.mjs          # Cover Regeneration Batch
│   ├── bandcamp-*.mjs            # Bandcamp Upload (login, setup, publish)
│   ├── upload-bc-album13.mjs     # Bandcamp Album Upload
│   └── set-artist-templates.mjs  # Artist DNA Templates
│
├── test/
│   ├── comfy.test.mjs          # 11 Tests: ganty32 API, Replicate fallback, model mapping
│   ├── gencover.test.mjs       # pre-existing: SVG brand assets missing
│   ├── regen-covers.test.mjs   # pre-existing: SVG brand assets missing
│   ├── harvest-flac.test.mjs   # pre-existing: MERGE_SCRIPT export missing
│   ├── cover-prompt.test.mjs
│   ├── spend-tracker.test.mjs
│   └── set-artist-templates.test.mjs
│
├── docs/
│   ├── flow-tree.md              # Flow Tree Visualisierung
│   ├── suno-production-spec.md   # Production Spec
│   ├── flac-dj-setup.md          # FLAC DJ Setup Rezept
│   ├── umsetzungsplan.md         # Implementierungsplan
│   ├── release-post-plan.md      # Release Post Plan (n8n)
│   ├── tiktok-*.md               # TikTok Docs
│   ├── superpowers/plans/        # Superpowers Implementation Plans
│   └── memory/                   # Exportierte Memory-Blöcke (Git-committed)
│       ├── project.md
│       ├── bandcamp-rls-recipe.md
│       ├── cover-hud-recipe.md
│       └── suno-worker-state.md
│
├── legal-fix/                    # Legal Pages (AGB, Impressum, Datenschutz)
│   ├── ANALYSIS.md
│   ├── bandcamp-content.md
│   ├── gewerbeanmeldung.md
│   └── pages/
│
├── scratch/                      # Einweg-Skripte (Bandcamp Upload Probes, etc.)
│   ├── upload-bc-album*.mjs
│   ├── allcov.mjs
│   └── bandcamp-diag.mjs
│
├── neon_harvest*.mjs             # MSE-Harvest Prototypen (Neon Orbit Rite)
├── neon_clipid.mjs
├── neon_track.mjs
├── toolost_*.mjs                 # Toolost UI-Automation (Debug/Einweg)
├── wizard_neon_*.mjs             # Wizard Debug Skripte
├── live_*.mjs                    # Live Test Skripte
├── *_song.mjs                    # Artist-spezifisch
├── *naldix*.mjs                  # NALDIX Track/Artist
├── upload_flac_release.sh        # FLAC Release Upload Script
└── .replicate-spend.json         # Replicate Spend Tracking
```

## Wichtige Entry Points

| Befehl | Zweck |
|---|---|
| `node --env-file=.env src/worker.mjs` | Worker manuell starten |
| `node --env-file=.env --test test/comfy.test.mjs` | Comfy/cover gen tests (11) |
| `node --env-file=.env src/finalize-gp.mjs` | Finalisierung (nach Worker-Job) |
| `docker build -t suno-worker:chrome .` | Docker Image für systemd |

## Legacy / Einweg (nicht produktiv)

- `toolost_*.mjs` — Toolost UI Debug/Exploration
- `wizard_neon_*.mjs` — Wizard Flow Debug
- `neon_harvest*.mjs` — MSE Harvest Prototypen
- `scratch/*.mjs` — Bandcamp Upload Probes
