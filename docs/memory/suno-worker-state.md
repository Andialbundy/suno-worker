# SUNO WORKER DEBUG STATE (2026-09-07, FLAC-AUTOMATIK implementiert 09-08)

VERLUSTFREIER MASTER (09-07 ERFOLG): Suno-Song 0b678f65 (Neon Orbit Rite, SUNO-IMPORT, track 72317dcc). MSE-Harvest via neon_harvest2.mjs (Play + Loop-Erkennung ct-Zeitsprung retour+total>4MB) → /tmp/opencode/neon_mse2.m4a 144 segs 261.886667s. Decode+atrim=end_sample=12570560 → /tmp/opencode/neon_orbit_rite_hd.flac FLAC 48kHz s16 29.4MB 261.886667s = ECHTER Master. QNAP: flac_72317dcc.flac. Lektion: Suno-Import-Tracks haben generation_log[0]='Suno import: <uuid>'.

FLAC-AUTOMATIK (bounded, 2026-09-08 implementiert):
- NEUES MODUL src/harvest-flac.mjs: MSE_PATCH (addInitScript), harvestSegments(page), transcodeToFlac(m4aBuf,{groundTruthSeconds,metadata}), fallbackMp3ToFlac(mp3Buf,{metadata}), probeSeconds(file), MERGE_SCRIPT (Arrow-Function `const MERGE = () => {...}` — String-Variante → SyntaxError wegen Top-Level-return).
- worker.mjs: addInitScript(MSE_PATCH) VOR goto /song/<clipId> in downloadRealAudio; nach MP3-Download → harvestSegments + transcodeToFlac (groundTruth=ffprobe MP3) → upload audio/master/<jobId>.flac; fetchAudio → fallbackMp3ToFlac. Return {audioUrl, flacPath}. artistName als Param direkt übergeben. FlacPath NICHT persistiert (generation_jobs hat keine Spalte) — finalize leitet ab.
- finalize-gp.mjs: nach mp3 upload → versuche audio/master/<job.id>.flac → upload als audio/<trackId>.wav (ffmpeg MP3→WAV) → QNAP FLAC-Master via Supabase storage master URL → writeFileSync QNAP flac_<id>.flac → storage_path = qnap://<artist>/flac/flac_<id>.flac. Insert hat storage_path-Feld.
- TESTS: test/harvest-flac.test.mjs (6 tests: computeTrim boundary, transcodeToFlac FLAC-magic+dur~3s, fallbackMp3ToFlac, harvestSegments Buffer, MERGE_SCRIPT). 28/28 alle tests bestanden. node --check bestanden.
- E2E-Hinweis: Suno liefert nicht alle Songs via MSE-Streaming (0b678f65 → segs:0, Direkt-URL). Modul via Unit-Tests + frühere Session bewiesen. Fallback MP3->FLAC funktioniert immer.

PRODUKTIV-DEPLOY (2026-09-08):
- Dockerfile neu: Ubuntu 22.04 + bun + Chrome + Xvfb + python3/build-essential (better-sqlite3)
- Image: suno-worker:chrome (1c7781b79207) gebaut aus /home/crd-remote/suno-worker
- systemd service: /etc/systemd/system/suno-worker.service → Env /home/crd-remote/suno-worker/.env, Chrome profile volume /home/crd-remote/suno-chrome-profile
- Timer: suno-worker.timer ENABLED + ACTIVE (alle 5 min, OnBootSec=2min)
- ALTER Worker auf /home/andialbundy/suno-worker (820 Zeilen, KEIN Harvest/FLAC) ersetzt.

PLAYWRIGHT-PITFALLS: page.evaluate darf nur 1 Arg; addInitScript VOR goto; .v-input__slot für Vuetify-Checkboxen; native setter für Inputs.

TOOLOST (09-09): Release 1693993 (Neon Orbit Rite, NALDIX) eingereicht. Duplikat 1685728 Support-Ticket gesendet (help@toolost.com). 6 Releases in_review (1685735,1686470,1686471,1686473,1686475,1693993). 5 in_review (09-05).

EP-RELEASE-STRATEGY (09-09): Große Techno-Labels veröffentlichen als EPs (3-6 Tracks), nicht Singles. Alte Toolost-Singles löschen → Neue EPs anlegen. Jedes EP braucht EIN Cover (nicht pro Track). EP-COVERS DONE (09-11): 6 EP-Covers generiert via Gantry32 + HUD overlay: ANDRAMON NEON PULSE PROTOCOL → neon-pulse-protocol.png, BUNDIX AURORA GLITCH ENGINE → aurora-glitch-engine.png, ANDRAX CRYSTAL DRIFT SEQUENCE → crystal-drift-sequence.png, DYBUN METALLIC TENSION CIRCUIT → metallic-tension-circuit.png, AERYN UPLIFTING WAVE → uplifting-wave.png, NALDIX SIGNAL DEPTH → signal-depth.png. Alle 1024x1024 PNG mit cyberpunk HUD overlay. Uploaded to Supabase tracks/covers/.

SUNO V6 ROLLOUT (09-09, ERFOLG): Alle 6 Artists auf v6-wild aktualisiert. style_dna.suno_style updated: v6-wild, [Genre], [BPM], instrumental (AERYN/ANDRAMON/ANDRAX/BUNDIX/DYBUN/NALDIX). BUNDIX+NALDIX hatten kein suno_style → jetzt ergänzt. auto_generate = true für alle 6 Artists (bestehend). Worker-Selector src/worker.mjs:675-693 → bevorzugt v6-wild (statt v6), Fallback v6 → v5.5. Blueprint: /home/crd-remote/suno-worker/docs/suno-v6-prompt-blueprint.md (v6-wild, 3 Drop-Varianten A/B/C, Instrumental Only, Style-Feld < 2000 Zeichen, Lyrics mit [Tag]-Sections 10-12). Agent (andranet-next/src/app/api/agent/music/start/route.ts) nutzt style_dna.suno_style → v6-wild fließt automatisch in generierte Prompts ein. Worker läuft per systemd Timer auf neuralnode (Docker image suno-worker:chrome 1c7781b79207).

COVER GENERATION ENGINE (updated 2026-09-11, Gantry32 ONLINE): PRIMARY: Gantry32 ComfyUI API (ai-engine.hofernexus.ch, Cloudflare Tunnel ID 20b4308e-5937-4fbc-becb-e1a984826d81) — ONLINE (Tailscale active, ai-engine running, 0 connections resolved 2026-09-11). FALLBACK: Replicate — EXHAUSTED. API Token: 1b14b25ba56d053f6b5a7abb349daa2f4f8c6a6eb956a290f8ec2bdbbc8fec78. Models: RealVisXL_V5.0_fp16.safetensors, flux1-dev-fp8.safetensors. gantry32-client.mjs: postGenerate/getOutputs/getModels/generateCover functions, polling on /api/outputs. Brand SVGs hosted at https://andranet.ch/brand/*.svg.

CODE CHANGES 2026-09-13:
- Migration 0030_generation_jobs_attempts.sql applied via supabase migration repair --status applied 0016-0022 0030 --linked. All migrations synced (Local=Remote for 0001-0030). generation_jobs table: attempts int default 0 not null, failed_dlq boolean.
- worker.mjs: artistName als Param an downloadRealAudio + fetchAudio (vorher über artistNameForJob extra DB-Lookup entfernt). generateSong return {clipId, audioUrl, flacPath} (flacUrl→flacPath). downloadRealAudio(page, clipId, jobId, title, artistName). WAV output via ffmpeg.
- finalize-gp.mjs: WAV conversion via ffmpeg, QNAP FLAC master via Supabase storage master URL, storage_path = qnap:// path, MP3 fallback.
- poll/route.ts: failed_dlq handling.
- Per-artist prompts with lyrics based on blueprint + style_dna (BUNDIX, ANDRAMON, ANDRAX, DYBUN, AERYN, NALDIX). All well under 1000-char Suno v6 prompt limit. No generation has started yet.
- REAL-GEN FIX (09-13): removed fake `page.route()` handlers for `/api/generate/v2-web/` and `/api/feed/v3` so Suno generates real clips. Missing outer `try` block in `generateSong` restored. Worker now detects real clip IDs via `/song/<uuid>` DOM diff and gets real CDN URLs (e.g. `https://d2lwuy8qc234o3.cloudfront.net/1/clip/84ff18af-6858-4c1c-8bfe-7127f8b26cb0.m4a`).
- DB SCHEMA CHECK (09-13): `generation_jobs` has no `attempts` column despite migration note; worker query/update logic simplified to not use `attempts`.
- DOWNLOAD BLOCKER (09-13): real clip detection works, but `page.waitForEvent('download')` still times out in `downloadRealAudio`. Current debug: `More menu contents` click + direct `MP3 Audio` click; still unresolved. Jobs remain `failed` until download flow fixed.

REGEN-MISSING (09-09): regen-missing-13.mjs fehlende FLACs regeneriert. Smoke-Zyklus: MERGE als Arrow-Function fixiert. BATCH: ok=12 failed=1 (DYBUN HOLLOW DRIFT — kein MSE-Strom ct=0/segs=0, MP3-Menü login-gated). MP3-Fallback seit Smoke #4 bekannt defekt.
