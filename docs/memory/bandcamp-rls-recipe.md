# BANDCAMP RELEASE RECIPE (andra-network.bandcamp.com)

Creds/session: info@andra.network; Cookies /tmp/opencode/bandcamp/storage.json (ctx.addCookies, headless chromium).

Lossless PFLICHT: nur .wav/.aif/.flac (291MB max/Track); MP3 -> "extension Type Error". FLAC-Master 48kHz.

Upload: `ol.tracks li.add-audio input[type=file]` mit DATEI-PFAD (Buffer>50MB kaputt). Row = `li.track`; fertig = class 'has-audio' + kein .progress-count/.spinner/.progress (248MB ~75s).

Titel: KO-Observable via `window.ko.dataFor(el).title(val)` (KO global) ODER Klick+Tastatur; DOM-fill() aktualisiert KO NICHT. Album-Titel: Klick auf `input.title.required` + keyboard.type + Tab -> Observable-Sync.

Preis: `input[name="album.price"]` (/`track.price_N`, Default je 1.50). Klick+Ctrl+A+Tastatur.

Save: NUR `[data-test="save-draft-button"]` = `a.save-draft.show-when-dirty.save_link` (aktive Draft-Speicherung navigiert zu edit_album?id=<id>).

Publish: `a.publish[data-test="publish-tralbum"]` -> URL bleibt gleich; Erfolg = Reload zeigt is-published-Panel + post-publish-buttons; verifizieren public /music + /album/<slug>.

Sel-Fallstrick: Attribut mit Punkt quoten: input[name="album.price"]. Artwork: div.art-upload, min 1400x1400.

Erste Release: /album/signal-depth-4 (SIGNAL DEPTH, 4 Tracks, price 27, PayPal info@andra.network).
