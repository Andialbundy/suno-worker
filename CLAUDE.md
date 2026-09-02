# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A worker that polls a Supabase table for queued music-generation jobs and fulfills them by
driving a real, logged-in Suno.com session through Playwright (there is no official Suno API
for this). It also contains a separate set of scripts for publishing finished releases to
Bandcamp (`andra-network.bandcamp.com`) via a cookie-based Playwright session.

There is no package manager script section, no test suite, and no build step — every `.mjs`
file is a standalone entry point run directly with a JS runtime.

## Layout

Reorganized 2026-08-31 (was previously ~70 files flat in the repo root):

```
src/       Active pipeline — worker.mjs, cover art (render-cover-hud.mjs/cover-hud.json,
           finalize-gp.mjs), Bandcamp publishing (bandcamp-login.mjs, bandcamp-setup.mjs,
           publish-bc.mjs, render-bandcamp-assets.mjs, upload-bc-album13.mjs — the last/
           working iteration of that script).
legacy/    Superseded but harmless — extract-session.py + suno-session.json (an abandoned
           cookie-extraction approach to auth, predates worker.mjs's own --login flow).
scratch/   One-off exploration: all probe-*.mjs, debug-dom*.mjs, debug-inst.mjs, and
           upload-bc-album.mjs/2-12.mjs (superseded iterations before 13), plus assorted
           diagnostic one-shots (allcov.mjs, radio-probe.mjs, setup1.mjs, dl-bc.mjs,
           check-imgs.mjs, diag-dom.mjs, bandcamp-diag.mjs). Not a maintained pipeline —
           check content/mtime before assuming any of these still reflect the current approach.
debug/     Runtime screenshots worker.mjs writes on every run (pre-create/post-create/fail
           *.png) — gitignored, not meaningful to keep around.
legal-fix/ Separate concern (Bandcamp store-listing / label-page content, a legal analysis
           doc) — unrelated to the generation/publishing pipeline.
```

Three dead prototypes (`worker-api.mjs` "v2 direct API", `worker-simple.mjs` "v3",
`worker-manual.mjs` "v4") were deleted outright on 2026-08-31 rather than archived — fully
superseded by `worker.mjs`, and each hardcoded the same Supabase service_role key in
plaintext; no reason to carry a leaked secret into git history for zero remaining value.

## Commands

Main worker (polls Supabase for `generation_jobs` where `status = pending`):

```
node --env-file=.env src/worker.mjs                 # normal run — processes up to 2 jobs, exits
node --env-file=.env src/worker.mjs --login          # opens a visible browser to log into Suno
                                                      # manually, saves session to ~/.suno-profile
                                                      # (do this first on a new host)
node --env-file=.env src/worker.mjs --dry            # logs what it would generate, no browser/DB writes
node --env-file=.env src/worker.mjs --chrome         # use the real Chrome profile instead of the
                                                      # isolated Playwright profile
```

`--env-file` is required — `worker.mjs` reads `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from
the environment (set in `.env`, gitignored) and exits loudly if either is missing. **If this
worker is still invoked elsewhere (e.g. a macOS LaunchAgent) without `--env-file=.env`, that
invocation needs updating too** — before 2026-08-31 the key was hardcoded and no env was needed.

The header comment says `bun run worker.mjs` — this host has no `bun` installed; `node` works
fine since the code is plain ESM with no Bun-specific APIs.

Bandcamp scripts (`src/bandcamp-*.mjs`, `src/upload-bc-album13.mjs`, `src/publish-bc.mjs`) are
run individually, e.g. `node src/upload-bc-album13.mjs`. They read a saved cookie session from
`/tmp/opencode/bandcamp/storage.json` (produced by `bandcamp-login.mjs`) rather than a
persistent browser profile.

`legacy/extract-session.py` pulls the Suno `__session` JWT out of Chrome's cookie store —
macOS-only (reads Keychain + `~/Library/Application Support/Google/Chrome/.../Cookies`), not
usable as-is on this Linux host, and superseded by `worker.mjs`'s own `--login` flow anyway.

## Architecture

**Main worker (`src/worker.mjs`)** — single-shot loop, meant to be run on a timer (originally a
macOS LaunchAgent every 5 min), not a long-lived daemon:

1. Queries Supabase `generation_jobs` (joined with `artists`) for `status = pending` rows whose
   `replicate_prediction_id` still has the `suno_pending_%` placeholder, limit 2.
2. Atomically claims a job via a conditional `update(...).eq('status','pending')` so two worker
   instances (e.g. two hosts running during a migration) can't double-process the same row.
3. Launches a **persistent** Playwright context (`launchPersistentContext`, not
   `launch()`+`newContext()`) against `~/.suno-profile` so the logged-in session survives
   across runs. `--chrome` swaps this for the real Chrome profile dir instead.
4. Drives Suno's `/create` UI: forces Advanced mode, forces model v5.5, fills the Lyrics
   textarea and Style textarea **by DOM position** (topmost/bottommost visible `<textarea>`),
   not by placeholder text — Suno's own placeholders don't reliably map to the right field.
5. Identifies the resulting clip: Suno never fires an observable mp3 network response or DOM
   `<audio>` tag *during* generation (both dead ends, kept as comments/fallbacks) — the
   reliable signal is diffing the sidebar's `/song/<uuid>` links against a pre-Create snapshot.
   Any candidate id is checked against `generation_jobs.replicate_prediction_id` before being
   accepted, since a stale/pre-existing id can otherwise be mistaken for the new one.
6. Downloads the actual decrypted audio via Suno's own "Download > MP3 Audio" menu — the CDN
   URL itself is server-side-encrypted (AES256) and unreadable via a plain fetch. Waits for the
   real (non-`sil-100.mp3` placeholder) `<audio>` src as the readiness gate first.
7. Uploads the file to Supabase Storage bucket `tracks`, writes the public URL and clip id back
   onto the job row, and best-effort scrapes remaining Suno credits into
   `system_status` (key `suno_credits`).

Extensive inline comments throughout `worker.mjs` record dated (`2026-08-2x`) UI-behavior
findings from live reconnaissance against Suno's frontend (which selectors are decoys, which
timing races are real, why a given approach was abandoned) — read them before changing
selectors or timing, they encode failures that aren't obvious from the DOM alone.

**Bandcamp publishing scripts** — see Layout above for what's active (`src/`) vs. exploratory
(`scratch/`). `finalize-gp.mjs` and `render-cover-hud.mjs` (+ `cover-hud.json`, per-artist cover
styling) are the current, reusable cover-art pieces.

## Notes

- `KUMA_PUSH_URL` is intentionally blanked in this checkout ("neutralized on neuralnode") to
  avoid this host pinging the uptime monitor — don't repopulate it here.

## STATUS 2026-09-01

- Vercel Deployment: ✅ LIVE on andranet.network
- Supabase Migration: ✅ Complete (4 migrations, 182 tracks)
- Legal pages: ✅ Impressum/Datenschutz/AGB live
- Bandcamp: ✅ Album description updated
- Copyright status: ✅ All 182 tracks have `copyright_status = 'ai_generated_no_copyright'`
- Build fix: bun → npm/next, Committer-Email fixed
- Repos synced to GitHub

### Key Files
- `/home/crd-remote/suno-worker/legal-fix/ANALYSIS.md` — legal analysis
- `/home/crd-remote/suno-worker/legal-fix/umsetzungsplan.md` — implementation plan
- `/home/crd-remote/suno-worker/legal-fix/todo.md` — action list
- `/tmp/opencode/andranet-next/` — website repo
- `/tmp/opencode/nexus-close/` — migration repo
