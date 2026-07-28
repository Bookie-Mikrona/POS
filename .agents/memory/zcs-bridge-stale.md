---
name: ZCS bridge stale process
description: ZCS tiskalni most javlja "ni dosegljiv" čeprav teče — vzrok in rešitev
---

## Pravilo

Ko ZCS tiskalni most (APK na localhost:8090) poroča "ni dosegljiv" kljub temu da je aktiven, je vzrok pogosto star proces iz prejšnje seje ki drži port.

**Why:** Po restartu API strežnika ali Replit delovnega okolja ostane APK vezan na stari socket. Brskalnik/WebView ne more vzpostaviti nove povezave.

**How to apply:** Rešitev je restart terminala in ponovni zagon APK aplikacije na ZCS napravi. Ni potreben noben popravek v kodi.

**Ločen problem:** Chrome Private Network Access (PNA) — HTTPS stran kliče HTTP localhost — je teoretičen problem (Chrome 104+), a v praksi se do zdaj ni pojavil kot dejanski vzrok. Preventivni APK fix: dodati `Access-Control-Allow-Private-Network: true` v vse odgovore in obdelati OPTIONS preflight.
