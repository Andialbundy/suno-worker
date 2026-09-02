# ANDRAS.NETWORK — Vollanalyse & Handlungsplan

Datum: 31. August 2026
Projekt: andra.network (Vercel, Supabase sgvguaaccmzevipfwdbn)
Ersteller: Andreas Hofer (hofernexus.ch)
Quelle: https://andranet.ch

---

## HERSTELLER / BETREIBER

**HoferNexus** — Swiss Digital Agency
- Inhaber: Andreas Hofer
- Florastrasse 10, CH-8610 Uster, Schweiz
- E-Mail: info@hofernexus.ch
- Tel: +41 76 575 40 70
- Website: hofernexus.ch
- UID: "Nicht MWST-pflichtig" (unter CHF 100'000.–)
- **Kein Handelsregister-Eintrag** (Einzelperson, Kleingewerbe)

→ Andra Network wird als Projekt von HoferNexus betrieben.

---

## 1. IMPRESSUM → AKTUALISIERT (siehe impressum.md)

### Neu:
- **Inhaber: Andreas Hofer** (Florastrasse 10, CH-8610 Uster)
- **Nicht MWST-pflichtig** (unter CHF 100'000.–)
- Kein Handelsregister (Einzelperson / Kleingewerbe)
- Gerichtsstand: Uster, Kanton Zürich

### Offen:
- Soll ein Gewerbe angemeldet werden? (Gewerbeanmeldung bei der Gemeinde Uster)
- Handelsregister-Eintrag als Einzelunternehmen empfohlen für rechtliche Absicherung
- Ohne Handelsregister: persönliches Haftungsrisiko für den Betreiber

---

## 2. DATENSCHUTZ → TEILWEISE KONFORM

### Fehler:
1. KI-Modelle falsch aufgelistet:
   - Aktuell: "Suno AI, Minimax Music 2.6, FLUX.1-schnell"
   - Tatsächlich: `chirp-fenix`-Modell (Suno AI Plattform)
2. US-Datenübermittlung OHNE Rechtsgrundlage
3. Vercel Analytics genutzt, aber nur Session-Cookies erwähnt
4. Keine Aufbewahrungsfristen
5. Kein Datenschutzbeauftragter
6. Plausible Analytics wird genutzt (selbstgehostet), aber Cookie-Consent fehlt

### Korrekturvorschlag Datenschutz:
- KI-Modelle korrigieren auf `chirp-fenix`
- Rechtsgrundlage für US-Übermittlung ergänzen (SCC)
- Vercel Analytics und Plausible Analytics korrekt beschreiben
- Aufbewahrungsfristen angeben
- Cookie-Consent für Plausible Analytics einbauen

---

## 3. AGB → VERALTET, LÜCKEN

### Fehler:
1. "Stand: Juni 2026" — Inhalte seit August 2026
2. §2 erwähnt "Stem-Pakete" und "Academy" — existieren NICHT
3. §4 (Lizenz) widerspricht Bandcamp: "all rights reserved"
4. §5: Keine MwSt-Nummer
5. §5: Widerrufsrecht-Ausschluss zu simpel
6. Keine Preisänderungsklausel, keine Kündigungsfrist
7. Kein Force Majeure

### Korrekturvorschlag AGB:
- AGB aktualisieren auf August 2026
- §2: Nur aktuelle Produkte (Digitale Downloads, Merch, Vinyl)
- §4: Lizenz an Bandcamp-Konditionen anpassen
- §5: MwSt-Nummer ergänzen, Widerruf korrekt formulieren
- Preisänderungsklausel hinzufügen
- Gerichtsstand Uster (ZH) eintragen

---

## 4. LIZENZ → KRITISCHE WIDERSPRÜCHE

| Quelle | Lizenz |
|--------|--------|
| AGB §4 | "nicht-exklusiv, nicht-übertragbar, privat, nicht-kommerziell" |
| Bandcamp | "all rights reserved" (kein Nutzungsrecht) |
| Supabase tracks | Kein `license`-Feld, nur `copyright` |
| Bandcamp schema.org | `"license_name": "all_rights_reserved"` |

### Problem:
"all rights reserved" = KEIN Nutzungsrecht für Käufer.
AGB gewähren ein nicht-exklusives Nutzungsrecht → Widerspruch.

### Korrekturvorschlag:
- Einheitliche Lizenzwahl (CC BY-NC-ND 4.0 empfohlen)
- AGB-Lizenz an Bandcamp anpassen, ODER
- Bandcamp-Lizenz an AGB anpassen
- Lizenz in jedem Track auf der Website deklarieren

---

## 5. MUSIC RIGHTS → RECHTLICH GEFÄHRDAHT

### Datenbank (182 Tracks):
- Alle KI-generiert (`chirp-fenix` / Suno Import)
- Copyright: `© 2026 Andra Network / ARTIST`
- Kein `license`-Feld
- `generation_log`: "Suno import" + "Model: chirp-fenix"

### Urheberrechtsprobleme:
1. **Schweizer Urheberrecht erfordert menschliche Schöpfung** (UrgG Art. 2 Abs. 1, BGE 140 II 300). Reine KI-Werke sind NICHT schutzfähig.
2. **"© 2026 Andra Network / ARTIST"** ist rechtlich fragwürdig. Wer ist der Urheber?
3. **Keine Urheberrechtskette dokumentiert**:
   - Wer besitzt die Rechte an den KI-Eingaben (Prompts)?
   - Wer besitzt die Rechte an den KI-Ausgaben?
   - Welche Bedingungen gelten von Suno AI?
4. **Widerspruch**: Impressum sagt "vollständig durch KI erzeugt", Bandcamp sagt "AI-assisted"
5. **Keine Verwertungsgesellschaften** erwähnt
6. **Keine Synchronisations- oder mechanischen Rechte** dokumentiert
7. **Suno AI ToS** nicht geprüft/erwähnt

### Korrekturvorschlag Music Rights:
- Suno AI / Replicate Nutzungsbedingungen prüfen
- Urheberrechtsklarheit schaffen
- Lizenzmodell definieren
- Rechtliche Grundlage für alle 182 Tracks dokumentieren
- Bandcamp-Beschreibung konsistent mit Impressum

---

## 6. ALLGEMEINE PROBLEME

1. **Kein Handelsregister** — möglich als Kleingewerbe, aber Haftungsrisiko
2. **Keine MwSt-Nummer** — korrekt (unter CHF 100'000.)
3. **Plausible Analytics** (tracking) aber kein Cookie-Consent
4. **Schema.org JSON-LD**: `"address":{"@type":"PostalAddress","addressCountry":"CH"}` — nur Land
5. **Kein Altersschutz** erwähnt
6. **US-Datenübermittlung** ohne Rechtsgrundlage
7. **Supabase service role key** — via .env (gitignored) + Vercel Env Vars, NICHT mehr hardcoded ✅

---

## 7. HANDLUNGSPLAN PRIORISIERT

### Sofort (Rechtliche Basis):
- [ ] **Impressum** finalisieren (Adresse: Florastrasse 10, 8610 Uster)
- [ ] **Gewerbeanmeldung** bei Gemeinde Uster prüfen (gewerbliche Tätigkeit)
- [ ] **Handelsregister** als Einzelunternehmen eintragen (empfohlen)
- [ ] **KI-Modelle** in Datenschutz korrigieren (`chirp-fenix`)
- [ ] **Suno AI ToS** prüfen (Urheberrechte an KI-Generaten)
- [ ] **Replicate FLUX.1 ToS** prüfen
- [ ] **MwSt-Nummer** besorgen (optional unter CHF 100k)

### AGB & Lizenz:
- [ ] **AGB aktualisieren** (aktuelle Produkte, MwSt, Widerruf, Gerichtsstand Uster)
- [ ] **Lizenz-Konsistenz** zwischen AGB, Bandcamp, Impressum
- [ ] **Urheberrechtsklarheit** für KI-generierte Werke
- [ ] **Cookie-Consent** für Plausible Analytics einbauen

### Bandcamp:
- [ ] **Lizenz** von "all rights reserved" auf korrekte Lizenz ändern
- [ ] **Beschreibung** konsistent mit Impressum
- [ ] **Impressum** auf Bandcamp-Profil ergänzen

### Website-Quellcode (Next.js, privates Repo andialbundy/andranet-next):
- [ ] **Impressum-Seite** aktualisieren
- [ ] **Datenschutz** überarbeiten
- [ ] **AGB-Seite** aktualisieren
- [ ] **Schema.org JSON-LD** Adresse erweitern (Strasse, PLZ, Ort)
- [ ] **Cookie-Consent-Banner** für Plausible Analytics
- [ ] **AGB-Stand** auf August 2026 setzen

### Datenbank (Supabase sgvguaaccmzevipfwdbn):
- [ ] `tracks`-Tabelle: `license`-Feld hinzufügen
- [ ] `tracks`-Tabelle: `generation_model`-Feld hinzufügen
- [ ] **Rechte-Kette** pro Track dokumentieren
- [ ] `products`-Tabelle: Lizenzinformation pro Produkt

### Sicherheit:
- [x] **Supabase service role key** — via .env (gitignored) + Vercel Env Vars, NICHT mehr hardcoded
- [ ] Service role key über Umgebungsvariablen steuern
- [ ] GitHub-Repo Zugriff einschränken

---

## 8. TECHNISCHER ZUGRIFF

### Vercel-Projekt:
- URL: https://andra.network
- Repo: andialbundy/andranet-next (GitHub)
- Framework: Next.js
- Vercel-Org: hofernexus-projects
- Projekt-ID: prj_MILLIpWXmqK68IaRuk7BDEvNendJ
- Team-ID: team_dPI8oQliHRvWvZJtuIyeZImN
- Status: ✅ LIVE — Deployment erfolgreich (2026-09-01)
- Build-Fix: bun → npm/next, Committer-Email korrigiert

### Supabase:
- URL: https://sgvguaaccmzevipfwdbn.supabase.co
- [x] Service Role Key via .env (gitignored) + Vercel Env Vars
- Tabellen: tracks, artists, products, rows (11 total)
- Service Role Key: via Vercel Env Vars (nicht mehr hardcoded)
- Keine legal_pages Tabelle vorhanden

### Bandcamp:
- URL: https://andra-network.bandcamp.com
- Album: SIGNAL DEPTH (ID `958479753`)
- Beschreibung: ✅ Aktualisiert (KI-Generierung, Urheberrechts-Disclaimer)
- Lizenz: "all rights reserved" (→ "No Rights Reserved" offen)
- Kein API-Zugang für Profil-Änderungen

### HoferNexus (Ersteller):
- Website: hofernexus.ch
- Inhaber: Andreas Hofer
- Florastrasse 10, CH-8610 Uster
- Kein Handelsregister (Kleingewerbe / Einzelperson)
- E-Commerce, Webentwicklung, SaaS

---

## 9. DATEIEN

- `/home/crd-remote/suno-worker/legal-fix/ANALYSIS.md` — dieser Bericht
- `/home/crd-remote/suno-worker/legal-fix/pages/impressum.md` — korrigiert
- `/home/crd-remote/suno-worker/legal-fix/pages/datenschutz.md` — korrigiert
- `/home/crd-remote/suno-worker/legal-fix/pages/agb.md` — korrigiert
- `/home/crd-remote/suno-worker/legal-fix/bandcamp-content.md` — Bandcamp-Texte


## DATEIEN

- /home/crd-remote/suno-worker/legal-fix/gewerbeanmeldung.md — Gewerbeanmeldung Schritt-für-Schritt
- /home/crd-remote/suno-worker/legal-fix/pages/impressum.md
- /home/crd-remote/suno-worker/legal-fix/pages/datenschutz.md
- /home/crd-remote/suno-worker/legal-fix/pages/agb.md
- /home/crd-remote/suno-worker/legal-fix/bandcamp-content.md

---

## 10. STAND 1. SEPTEMBER 2026

### Vercel Deployment FIX
- **Problem:** Deployments waren BLOCKED wegen "GitHub could not associate the committer with a GitHub user"
- **Root-Cause:** Git-Config Email `andralbundy@users.noreply.github.com` (mit 'r') passte nicht zum GitHub-User `Andialbundy` (ohne 'r')
- **Fix:** `git config user.email "andialbundy@users.noreply.github.com"` + `git commit --amend --reset-author` + Force Push
- **Zusätzlich:** `vercel.json` `buildCommand: "bun run build"` entfernt (bun nicht verfügbar → Vercel nutzt npm/next automatisch)
- **Ergebnis:** Deployment `andranet-next-n458r1rzc` → `READY`, live auf andranet.network

### Erledigt (2026-09-01)
- Supabase Migration deployed (4 Dateien)
- Alle 182 Tracks: `copyright_status = 'ai_generated_no_copyright'`
- Impressum/Datenschutz/AGB live auf andranet.network
- Bandcamp Album-Beschreibung aktualisiert
- Cover HUD Overlay Pipeline integriert

### Offen
- Gewerbeanmeldung Bürgeramt Uster
- Cookie-Consent für Plausible Analytics
- Supabase URL ins Frontend (.env)
- Bandcamp Lizenz-Änderung (album settings)
