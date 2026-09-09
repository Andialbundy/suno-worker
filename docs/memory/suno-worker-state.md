# SUNO WORKER DEBUG STATE (2026-09-07, FLAC-AUTOMATIK implementiert 09-08)

VERLUSTFREIER MASTER (09-07 ERFOLG): Suno-Song 0b678f65 (Neon Orbit Rite, SUNO-IMPORT, track 72317dcc). MSE-Harvest via neon_harvest2.mjs (Play + Loop-Erkennung ct-Zeitsprung retour+total>4MB) → /tmp/opencode/neon_mse2.m4a 144 segs 261.886667s. Decode+atrim=end_sample=12570560 → /tmp/opencode/neon_orbit_rite_hd.flac FLAC 48kHz s16 29.4MB 261.886667s = ECHTER Master. QNAP: flac_72317dcc.flac. Lektion: Suno-Import-Tracks haben generation_log[0]='Suno import: <uuid>'.

FLAC-AUTOMATIK (bounded, 2026-09-08 implementiert):
- NEUES MODUL src/harvest-flac.mjs: MSE_PATCH (addInitScript), harvestSegments(page), transcodeToFlac(m4aBuf,{groundTruthSeconds,metadata}), fallbackMp3ToFlac(mp3Buf,{metadata}), probeSeconds(file), MERGE_SCRIPT (String).
- worker.mjs: addInitScript(MSE_PATCH) VOR goto /song/<clipId> in downloadRealAudio; nach MP3-Download → harvestSegments + transcodeToFlac (groundTruth=ffprobe MP3) → upload audio/master/<jobId>.flac; fetchAudio → fallbackMp3ToFlac. Return {audioUrl, flacUrl}. FlacUrl NICHT persistiert (generation_jobs hat keine Spalte) — finalize leitet ab.
- finalize-gp.mjs: nach mp3 upload → versuche audio/master/<job.id>.flac → upload als audio/<trackId>.flac → setzt storage_path = publicUrl. Insert hat storage_path-Feld (null wenn kein FLAC).
- TESTS: test/harvest-flac.test.mjs (6 tests: computeTrim boundary, transcodeToFlac FLAC-magic+dur~3s, fallbackMp3ToFlac, harvestSegments Buffer, MERGE_SCRIPT). 28/28 alle tests bestanden. node --check bestanden.
- E2E-Hinweis: Suno liefert nicht alle Songs via MSE-Streaming (0b678f65 → segs:0, Direkt-URL). Modul via Unit-Tests + frühere Session bewiesen. Fallback MP3->FLAC funktioniert immer.

PRODUKTIV-DEPLOY (2026-09-08):
- Dockerfile neu: Ubuntu 22.04 + bun + Chrome + Xvfb + python3/build-essential (better-sqlite3)
- Image: suno-worker:chrome (1c7781b79207) gebaut aus /home/crd-remote/suno-worker
- systemd service: /etc/systemd/system/suno-worker.service → Env /home/crd-remote/suno-worker/.env, Chrome profile volume /home/crd-remote/suno-chrome-profile
- Timer: suno-worker.timer ENABLED + ACTIVE (alle 5 min, OnBootSec=2min)
- Verifikation: Test-Job claimed→processing, Generation läuft (5-min Poll). Nächster Vercel Cron 10:00 UTC erzeugt Jobs → Worker verarbeitet.
- ALTER Worker auf /home/andialbundy/suno-worker (820 Zeilen, KEIN Harvest/FLAC) ersetzt.

PLAYWRIGHT-PITFALLS: page.evaluate darf nur 1 Arg; addInitScript VOR goto; .v-input__slot für Vuetify-Checkboxen; native setter für Inputs.

TOOLAST: Release 1693993 (Neon Orbit Rite, NALDIX) eingereicht. Duplikat 1685728 Support-Ticket gesendet (help@toolost.com). 5 Releases in_review (1685735,1686470,1686471,1686473,1686475).
