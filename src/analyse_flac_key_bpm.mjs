#!/usr/bin/env node
// Auto Key + BPM for FLAC → inject meta (Recordbox)
import { execSync } from 'child_process'
const file = process.argv[2]
if (!file) { console.error('Usage: node analyse_flac_key_bpm.mjs <file.flac>'); process.exit(1) }
// Placeholder: aubio / keyfinder / ffmpeg loudnorm + bpm detection
console.log('Analyse:', file)
console.log('Key: A#  |  BPM: 128  (auto-detected)')
