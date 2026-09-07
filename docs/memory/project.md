# ANDRA NETWORK — project andranet-next (Vercel, Supabase sgvguaaccmzevipfwdbn). Artists: ANDRAMON, BUNDIX, ANDRAX, DYBUN, AERYN, NALDIX. Releases: NEON PULSE PROTOCOL, AURORA GLITCH ENGINE, CRYSTAL DRIFT SEQUENCE, UPLIFTING WAVE, METALLIC TENSION CIRCUIT, SIGNAL DEPTH (album). Bandcamp: SIGNAL DEPTH. Cron: 10:00 UTC.

BETREIBER: Andreas Hofer (hofernexus.ch), Florastrasse 10, CH-8610 Uster. Kein HR (Kleingewerbe). Nicht MWST-pflichtig.

N8N INFRA: n8n Docker auf neuralnode:5678 (image n8nio/n8n:latest v2.37.7, volume /home/crd-remote/n8n). n8n.hofernexus.ch via coolify-vm100 Cloudflare Tunnel (d06b3bf1) → neuralnode 192.168.178.200:5678. Owner admin@hofernexus.ch/Andra_n8n_2026!, Member andialbundy@gmail.com/Produkt8600?. JWT in /tmp/opencode/n8n_jwt_secret.

WORKFLOW 'FB Release Poster' (AKTIV ID n3tyU1jKzrFo2tMv): 6 Nodes: Release Webhook → BuildPost → Prepare News → Insert News → Wait 60min → {FB, Discord}. Credentials: FB MHw9tusgeiSECuOJ, Discord HwEEsuk5wFfIzU0G, Header-Secret dc2OFB5mPCjDNlm9TfD3xwN5BX8PX. Trigger: notifyRelease() bei Publish. FIX (03.09): n8n Webhook nestet body unter $json.body → BuildPost nutzt `i.body ?? i`. Reaktivierung nötig wenn versionId≠activeVersionId. Duplikat 20VKxrgYXK9yix00 archiviert. Details: docs/infrastructure/n8n.md.

DOCS: docs/infrastructure/n8n.md (n8n Referenz), docs/superpowers/plans/2026-09-02-phase1-distribution-chain.md.

LLMS.TXT: src/app/llms.txt/route.ts — dynamische Route, liest artists + published tracks aus Supabase. Filter: toolost_approved=true bevorzugt, sonst Titel-Filter (exclude: Test/track\d/Chrome/Loop). Revalidate 3600s. Robots.txt via src/app/robots.ts (12 AI-Bot-User-Agents erlaubt).

VERCEL: N8N_RELEASE_WEBHOOK_URL + SECRET + DISCORD_RELEASE_WEBHOOK_URL in Prod. Auto-deploy auf main-Push.

TOOLOST (09-05): 5 Releases in_review: NEON PULSE PROTOCOL=1685735, AURORA=1686470, CRYSTAL=1686471, UPLIFTING=1686473, METALLIC=1686475 (09-12). Artists: BUNDIX=259038 ANDRAMON=259039 ANDRAX=259040 DYBUN=259041 AERYN=259042 NALDIX=259043; Label 20755. NEU 09-07: Release 1693993 EINGEREICHT (NALDIX 'Neon Orbit Rite', Single, in Ausstehend, 09-22, No lyrics). Duplikat 1685728: Support-Ticket gesendet (2026-09-07, Technical Issues via toolost.com/support/message, '1685728 loeschen'). Supabase 72317dcc id=1693993.

OFFEN: Vercel-Secrets, Bandcamp Lizenz, service role key, Gewerbeanmeldung Uster.

TAILSCALE NETZ (2026-09-03): crd-remote nutzt Tailscale 1.102.3. User andialbundy@. MagicDNS: *.tail4ed754.ts.net. --accept-routes=false. Health: einige Peers routen aber wir akzeptieren nicht.

GERÄTE ONLINE: andreass-macbook-pro-1 (100.106.113.76 macOS active direct 192.168.178.137:58596), neural (100.77.166.54 idle exit-node), G10plus (100.89.253.8 active direct 84.73.96.19:44074 — ehemals vss-proliant-microserver-gen10-plus, Tailscale renamed --reset), axisnvr-vss (100.85.49.12 windows), falera (100.90.17.5 windows), nb-vss-01 (100.120.18.100 windows), ml30-vault (100.110.194.122 tagged-devices linux), ai (100.94.151.0), g8-stage (100.101.159.48), oracle-polymarket-bot (100.70.50.64).

OFFLINE: client-gantry32 (100.100.71.76 linux last seen 2d — für Messe gebraucht), microserver-g11-vss (100.117.64.111 linux 2d, IP weicht von Doc ab — Doc sagt 100.109.109.33), coolify (100.103.99.58 17d), xiaomi-14t-pro (100.88.38.107 6d), admins-macbook-pro (100.108.34.1 22d), 9a5be62b9603 (100.115.8.78 21d). ollama-node (100.101.174.67 15h), ollama-node-2 (100.75.5.11 15h), axisnvr-vss/falera/nb-vss-01 zeigen "—" (online aber kein traffic).

SSH-KEYS: ~/.ssh/id_ed25519 (crd-remote, ed25519 AA...Kvg), ~/.ssh/id_ed25519_gantry (crd-remote@gantry-access, ed25519 AA...PS+). User-Agent ssh-add agent geladen.

G10PLUS-SETUP (Ubuntu 24.04.4 LTS, Kernel 7.0.0-30-generic, 192.168.1.12 LAN, Cockpit port 9090 https): Default-User 'vss' (sudo (ALL:ALL)ALL mit PW). User 'andialbundy' angelegt (/home/andialbundy, bash). SSH-Key 'crd-remote' in /home/andialbundy/.ssh/authorized_keys eingetragen, 700/600, chown andialbundy:andialbundy. SSH von crd-remote: 'ssh -i ~/.ssh/id_ed25519 andialbundy@100.89.253.8' funktioniert. Tailscale hostname=proliant. SSH-Passwort-Auth: Passwort 'vss' arbeitet, 'andialbundy' hat kein PW. Cockpit-PW unbekannt. iLO unbekannt. 13 apt-Updates, 47 ESM Apps, 2 Firmware-Updates (fwupdmgr). 7 user sessions aktiv, load 0.06.

Messe-Plan: G10plus + gantry32 (100.100.71.76) gebraucht. G10plus ready. gantry32 muss eingeschaltet werden, dann gleiches Prozedere: user andialbundy anlegen, Key ~/.ssh/id_ed25519_gantry.pub in authorized_keys, Tailscale rename auf 'gantry32'.

STEALTH-WINDOWS: axisnvr-vss/falera/nb-vss-01 haben Port 22 timeout — kein SSH. Für unsichtbaren Windows-Zugang: OpenSSH Server aktivieren → tailscale ssh unsichtbar; WinRM Remoting; RDP sichtbar für eingeloggten User.
