# Suno Worker — Projektstruktur (Kern)

```
suno-worker/
├── .env                          # SUPABASE_URL, SERVICE_ROLE_KEY, REPLICATE_API_TOKEN
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
│   ├── finalize-gp.mjs           # Finalisierung (Cover, Track-Insert, Publish, Toolost)
│   ├── harvest-flac.mjs          # NEU: MSE-Harvest + FLAC-Transcode (Opus→FLAC 48kHz/s16)
│   ├── batch_flac_from_db.mjs    # Legacy: MP3→FLAC Batch
│   ├── analyse_flac_key_bpm.mjs  # Key/BPM Analyse (Placeholder)
│   ├── cover-prompt.mjs          # Cover Prompt Building
│   ├── generate-jobs.mjs         # Job-Generierung (Prompt, Title, Image)
│   ├── replicate.mjs             # Replicate API (Flux für Cover)
│   ├── spend-tracker.mjs         # Suno Credits Tracking
│   ├── render-cover-hud.mjs      # HUD Overlay Renderer (Playwright)
│   ├── regen-covers.mjs          # Cover Regeneration Batch
│   ├── bandcamp-*.mjs            # Bandcamp Upload (login, setup, publish)
│   ├── upload-bc-album13.mjs     # Bandcamp Album Upload
│   └── set-artist-templates.mjs  # Artist DNA Templates
│
├── test/
│   └── harvest-flac.test.mjs     # 6 Tests: transcode, harvest, fallback, MERGE_SCRIPT
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
| `node --env-file=.env --test test/harvest-flac.test.mjs` | FLAC-Tests |
| `node --env-file=.env src/finalize-gp.mjs` | Finalisierung (nach Worker-Job) |
| `docker build -t suno-worker:chrome .` | Docker Image für systemd |

## Legacy / Einweg (nicht produktiv)

- `toolost_*.mjs` — Toolost UI Debug/Exploration
- `wizard_neon_*.mjs` — Wizard Flow Debug
- `neon_harvest*.mjs` — MSE Harvest Prototypen
- `scratch/*.mjs` — Bandcamp Upload Probes
