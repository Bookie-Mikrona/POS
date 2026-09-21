---
name: BT tiskalniki — kodna stran in šumniki
description: Q10 Back Clip BT tiskalnik zahteva ascii-translit; postopek za nove BT tiskalnike; per-naprava arhitektura; DB opomba o podvojenih Android napravah
---

## Q10 Back Clip 2-in-1 (58mm, Web Bluetooth) — POTRJENA REŠITEV

**Simptom**: tiskalnik tiska kitajske znake namesto čšž in €, na VSEH kodnih straneh.

**Vzrok**: firmware Q10 je trajno v GBK/kitajskem načinu. `FS .` (1C 2E) in `ESC t n` nimata učinka — bajt 1C se v GBK modu požre kot lead byte. Bajti > 0x80 (vse kodne strani razen ascii-translit) se tolmačijo kot 2-bajtne kitajske sekvence.

**Rešitev**: `tiskalnikCodePage = ascii-translit` — čisti ASCII (< 0x80), GBK-odporen.
- čšž → csz, đ → dj, €→ EUR, ostali razširjeni → najbližji ASCII
- Potrjeno deluje (10.8.2026, uporabnik: *"kodna stran Brez šumnikov (transliteracija + EUR). To deluje."*)

## Postopek za nove BT tiskalnike (lestvica)

Ko nov BT tiskalnik ne prikaže šumnikov pravilno, preizkusi po vrsti:

1. **cp1250** — privzetek; deluje na večini ESC/POS tiskalnikov z evropskim firmwarejem
2. **wpc1250** (Windows-1250 n=12) — alternativa za nekatere Xprinter/GOOJPRT čipe
3. **cp852** (Latin-2, OEM) — za starejše čipe z DOS kodnimi stranmi
4. **ascii-translit** — zadnja možnost; deluje na vsakem tiskalniku ker brez visokih bajtov; čšž izgubijo diakritiko, € postane EUR

## Kje nastaviti (POS UI)

- Nastavitve → Terminali → ✏️ Uredi napravo → sekcija "Vezani tiskalnik" → scroll navzdol → **Kodna stran**
- Za BT naprave: "Vezani tiskalnik" nastaviti na **Samodejno zaznaj** (ne Windows agent)
- Kodna stran je **per naprava** (ne per enota) — vsaka fizična naprava ima svojo vrednost

## Arhitektura: per-naprava resolve (od 10.8.2026)

`GET /print/racun/:id?napravaId=N` → `resolveEncodingFromSettings(enotaId, napravaId)`:
- **Z napravaId**: direkten `SELECT WHERE id=N AND enotaId=E LIMIT 1` → config te naprave
- **Brez napravaId**: stara logika (agent prioriteta → fallback) — za agent pot, nespremenjena

Frontend (`PrintReceiptButton`) pošilja `naprava?.id` iz `useNaprava()` konteksta.
`naprava.id` pride iz `POST /api/naprave/registracija` → localStorage `naprava_cache_v1`.

**Why:** prej je `resolveEncodingFromSettings(enotaId)` iterirala VSE naprave in takoj vrnila
prvo z `agentTiskalnikIme` (Windows POS agent id=14, cp852) — BT naprava (id=16) ni bila
nikoli prebrana, ne glede na njene nastavitve.

## Bitmap — čitljivost in hitrost (od 10.8.2026, revidiran isti dan)

**Pisava:** DejaVu Sans Mono Bold (`assets/fonts/DejaVuSansMono-Bold.ttf`) — debelejša od Overpass Mono; boljša čitljivost pri 8-dot termičnem tisku.
**Vse vrstice bold** — le velikost razlikuje normalne (normalSize) od poudarjenih (headingSize ≥ normalSize).
**Kalibracija:** `calibrateFont()` izmeri `bold Nx "ReceiptMono"` z `measureText("M".repeat(32))`; pri 384px → normalSize=19px, charWidth≈11.4px, 32 znakov v 366px (≤380px usable). ✓
**Prag:** 160 (namesto 128) — antialiased robovi postanejo črni, brez sivila.
**ESC J kompresija:** bele vrstice v rastru → `ESC J n` (3B) namesto 48 ničelnih bajtov; trim leading/trailing.
**BT:** CHUNK 512B, brez delay za writeValueWithoutResponse (prej 200B + 20ms = ~4760ms samo pavz).
**Meritve (35-vrstični račun):** pred=46.5KB/239 kosov/4760ms pavz; po=~12KB slike (268px canvas pri 11 test vrsticah), ~80 BT kosov, 0ms pavz.

## Adaptivni BLE chunk writer — `btWriter.ts` (od 10.8.2026)

**Problem:** "GATT operation failed for unknown reason" — poceni BT tiskalniki sprejmejo le ~20–180 B kljub MTU pogajanju.
**Rešitev:** `src/lib/btWriter.ts` — adaptivna lestvica:
- Chunk lestvica: 180 → 100 → 64 → 20 B
- Delay lestvica: 10 → 30 → 50 ms (med WNR kosi)
- Ob GATT napaki: umik na naslednji korak, **ponovi od bajta 0** (ne od napačnega kosa — ESC @ reset je vedno na začetku, varno za ponovitev)
- Ob uspehu: shrani params v `localStorage["bt_params_v1_<ime_naprave>"]`
- Timeout: 30 s → user-friendly napaka
- `printer.ts` kliče `btSendAll(char, data, deviceName)` — stara statična 512B implementacija zamenjana
- Testi: 29 zelenih v `src/__tests__/btWriter.test.ts` (jsdom environment)

**Why full-restart on error (ne partial retry):** ESC/POS je statefl; delni podatki pokvarijo stanje tiskalnika; ESC @ na začetku resetira — varnejše kot delni nadaljevanje.

## Bitmap (slikovni) način — `tiskalnikCodePage: "bitmap"` (od 10.8.2026)

Za tiskalnike z zaklenjenim GBK firmwareom kjer ascii-translit ni dovolj (pravi čšž/€ potrebni):

- `pos-escpos-bitmap.ts`: canvas Overpass Mono (384 px/58mm, 512 px/80mm) → 1-bit raster → `rasterToGsV0Blocks` (max 200 vrstic/blok) → QR FURS kot ločen GS v 0 blok za besedilom
- Pisave stabilizirane v `artifacts/api-server/assets/fonts/` (ne Nix-store — stabilna pot)
- `buildEscPosBytes` je sedaj **async** — vsi 3 endpointi (`print/racun/:id`, `/network`, `/agent`) ga `await`-ajo
- UI: Settings → Terminali → ✏️ Uredi → "Slikovni izpis (pravi čšž in €, počasnejši)"
- Testirano: 16 testov zeleni v `bitmapEscPos.test.ts`

## DB opomba — enota 1, Android naprave

Enota 1 ima 3 "Android naprava" vnose (podvojene registracije):
- id=5 `naprava_kljuc=324cd26a-...` `{"tiskalnikSirina":58}` — brez CP
- id=13 `naprava_kljuc=b692b435-...` `{"tiskalnikSirina":30}` — brez CP
- id=16 `naprava_kljuc=8974b50e-...` `{"tiskalnikCodePage":"ascii-translit"}` — Q10

Kandidati za preimenovanje/čiščenje kdaj pozneje. **Ne brisati zdaj** — napravaKljuc je vezan
na localStorage naprave; izbris bi prisilil novo registracijo in izgubo nastavitev.
