---
name: Samodejno iskanje dobavitelja po imenu in IBAN
description: Implementacija AI-first pipeline za samodejno določitev slovenskega dobavitelja ko OCR ne najde davčne številke
---

# Samodejno iskanje dobavitelja (poisci-dobavitelja.ts)

## Pravilo
Ko `resolveOrCreateDobavitelja` vrne null (ni davčne v OCR-ju), sistem NAJPREJ poskusi AI iskanje, šele nato vrne 422 za ročni picker.

**Why:** Dobavitelji brez davčne v dokumentu (npr. "DAVIDOV HRAM" brez SI-prefiksa) so sicer nedosegljivi — z DDG + bizi.si jih samodejno najdemo.

## Implementacija

### `artifacts/api-server/src/lib/uvoz/poisci-dobavitelja.ts`
- `iskajBiziSlug(naziv)` — DuckDuckGo Lite search (`lite.duckduckgo.com/lite/`) za bizi.si URL slug, brez API ključa
- `scraperBiziPodjetje(slug)` — direct Node.js fetch na `www.bizi.si/SLUG/`, regex za `b-attr-value` div z 8-cifersko davčno
- `validiraiIban(slug, iban)` — cross-check IBAN z bizi.si TRR stranjo; vrne true če ni IBAN-a (ne zavračamo)
- `poisciDobaviteljaAI(naziv, iban)` — glavi entry point; vrne `PodjetjePredlog | null`

### Ključna ugotovitev (potrjena 2026-07-31)
- **bizi.si** direktno dostopen brez prijave, davčna je v `<div class="col-6 b-attr-value pl-1">58843302</div>`
- **DDG Lite** (`lite.duckduckgo.com/lite/`) deluje brez API ključa, vrne bizi.si URLje v besedilu
- **DDG HTML** (`duckduckgo.com/html`) — ne deluje (blokiran)
- **Google** — URLji so v JS, ne v navadnem HTML
- **AJPES PRS** — zahteva prijavo, ni direktno dostopen
- **bizi.si internal search** — vrne "Ni rezultatov" za delna imena
- **OpenCorporates** — zahteva API token

## Integracija v uvoz-prejemnic.ts
Enaka logika aplicirana na VSE 3 MANJKA_DOBAVITELJ bloke:
1. OCR ruta (`POST /ocr`)
2. Datoteka ruta (PDF OCR v `POST /datoteka`)
3. Seja ruta (obdelaj sejo)

## How to apply
Ko dodajaš nov uvozni tok s `dolociDobavitelja` → `resolveOrCreateDobavitelja`, vedno preveri ali je MANJKA_DOBAVITELJ pokriti z `poisciDobaviteljaAI` before returning 422.
