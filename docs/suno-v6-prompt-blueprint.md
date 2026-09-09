# Suno v6-wild — Prompt-Blueprint (Template für alle Releases)

## Übergeordnete Vorgaben

- **Modell**: `v6-wild` (via Worker-UI: Advanced → v6 setzen, Style-Feld enthält `v6-wild`)
- **BPM**: je nach Release (Standard: 140)
- **Tonart**: je nach Release (Standard: F minor für dunklere Tracks, D minor für hellere)
- **Format**: `instrumental only` — IMMER
- **Felder**: Style-Feld (Produktion) + Lyrics-Feld (Struktur-Tags)
- **Title**: Artist + Release-Name + Track-Nummer

---

## Felder-Schema

### Style-Feld (Produktionsbeschreibung)
```
v6-wild, [Genre], [Subgenre], [BPM] BPM, [Tonart], instrumental only, [kurze Hauptbeschreibung des Drops]
```
- Maximal ~200 Zeichen für die kreative Beschreibung
- Keine Negativ-Listen (`no vocals` etc.) → `instrumental only` deckt alles ab
- Der Drop-Hook kommt als 2-3 Satz Beschreibung

### Lyrics-Feld (Struktur-Tags)
```
[Instrumental]
[Abschnitt 1]
[Abschnitt 2]
...
[Extended DJ Outro]
```
- Nur `[Tag]`-Zeilen, KEINE gesungenen Texte
- Abschnittsnamen beschreiben die Section
- 10-12 Sections sind Standard für einen 4-6 Min Track

### Title-Feld
```
[ARTIST] - [Release-Name] - Track [Nr] "[Track-Titel]"
```

---

## Drei Drop-Varianten (Blueprint pro Release)

Jedes Release produziert 3 Tracks mit gleicher Basis, unterschiedlichem Drop.

### Variante A: Percussive / Staccato Drop

**Style-Feld:**
```
v6-wild, [Genre], instrumental only, [BPM] BPM, [Tonart]. [1-2 Sätze Hauptcharakter]. Drop: sudden dry percussion cut, syncopated staccato synth riff with irregular accents, chopped rhythmic gates, brief silence gaps, aggressive stereo movement. [Zusätzliche Drop-Details]. Clean club mix, controlled sub-bass, precise transients.
```

**Lyrics-Feld:**
```
[Instrumental]
[Long DJ Intro]
[Kick Entry]
[Rolling Bass Entry]
[Minimal Groove Development]
[Filtered Staccato Motif]
[Tension Build]
[Unexpected Percussive Drop]
[Syncopated Riff Variation]
[Short Atmospheric Reset]
[Second Groove Drop]
[Extended DJ Outro]
```

**Erwarteter Drop:** trocken, kantig, rhythmisch — Hook aus Rhythmus und Pausen, nicht aus Melodie.

---

### Variante B: Broken Bass / Pressure Drop

**Style-Feld:**
```
v6-wild, [Genre] with [Subgenre] elements, instrumental only, [BPM] BPM, [Tonart]. [1-2 Sätze Hauptcharakter]. Drop: remove the kick for a brief moment, introduce a heavy elastic bass pulse, return with a half-time-feeling bass accent layered against the four-on-the-floor groove. [Zusätzliche Drop-Details]. Powerful but not euphoric, experimental but still danceable.
```

**Lyrics-Feld:**
```
[Instrumental]
[Long DJ Intro]
[Deep Kick and Sub Entry]
[Hypnotic Bass Development]
[Two-Note Motif]
[Pressure Build]
[Drums Cut Out]
[Unexpected Broken Bass Drop]
[FM Stab Variation]
[Rolling Bass Rebuild]
[Final Pressure Climax]
[Extended DJ Outro]
```

**Erwarteter Drop:** basszentrierter Überraschungsmoment mit kurzer rhythmischer Unterbrechung, elastischer Sub-Bass, dunkle FM-Stabs.

---

### Variante C: Atmospheric / Rave Surge Drop

**Style-Feld:**
```
v6-wild, [Genre], [Subgenre], instrumental only, [BPM] BPM, [Tonart]. Start with [Atmosphäre]. For the main drop: wide pulsing chord sequence, bright staccato rave lead, layered octave arpeggios, strong sidechain swell expanding from mono to wide stereo field. Add one unexpected melodic counterline. Emotional and uplifting but sophisticated. No cheesy pop melody, no constant wall of sound.
```

**Lyrics-Feld:**
```
[Instrumental]
[Cinematic / Ambient Intro]
[Gradual Kick Entry]
[Rolling Bass Development]
[Shimmering Arpeggio]
[Long Progressive Build]
[Atmospheric Breakdown]
[Wide Rave Surge Drop]
[Unexpected Counterline]
[Lead Rhythm Variation]
[Final Climax]
[Element Strip-Down]
[Extended DJ Outro]
```

**Erwarteter Drop:** breit, emotional, rave-orientiert — ohne Gesang, ohne vorhersehbare Supersaw-Formel.

---

## Vorlagen-Füllwerte (Beispiel)

| Feld | Wert |
|---|---|
| Genre | Progressive Trance |
| Subgenre | dark progressive techno / atmospheric rave / acid techno |
| BPM | 140 |
| Tonart | F minor (dunkel) / D minor (hell) |
| Artist | ANDRAMON / BUNDIX / ANDRAX / DYBUN / AERYN / NALDIX |
| Release | NEON PULSE PROTOCOL / AURORA GLITCH ENGINE / etc. |

---

## Worker-Integration

Der Worker (`src/worker.mjs`) verwendet:
1. **Title** → `generateSong(title, style, job.id, job.title)` → Title-Feld in Suno UI
2. **Style** → `generateSong(title, style, ...)` → Style of Music Feld
3. **Lyrics** → `generateSong(title, style, ...)` → Lyrics Feld (Struktur-Tags)
4. **Model** → Worker setzt via UI-Button `Advanced → v6` (unabhängig vom Style-Text)

**Prompt-Länge**: Style-Feld sollte < 2000 Zeichen bleiben (Suno-Limit unbekannt, aber kurz = besser).

## Regeln für alle Prompts

1. ✅ `instrumental only` IMMER schreiben
2. ✅ `v6-wild` IMALS im Style-Feld
3. ✅ BPM + Tonart IMMER angeben
4. ✅ Drop-Beschreibung als 2-3 Sätze im Style-Feld
5. ✅ Nur `[Tag]`-Zeilen im Lyrics-Feld (keine Texte)
6. ✅ 10-12 Sections im Lyrics-Feld
7. ❌ Keine Negativ-Listen (`no vocals, no spoken word...`)
8. ❌ Keine vorgefertigten Suno-Modell-Flags im Lyrics-Feld
9. ❌ Keine Länge > 2000 Zeichen pro Feld
10. ❌ Keine generischen Floskeln ohne kreative Spezifik
