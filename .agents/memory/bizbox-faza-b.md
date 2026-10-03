---
name: bizBox Faza B — oddaja e-računov
description: Implementacija ročnega pošiljanja e-SLOG XML prek bizBox (ZZI) API na testno okolje demo.zzi.si
---

# bizBox Faza B

## Modul
`artifacts/api-server/src/lib/eracun/bizbox.ts`
- `loginBizbox(host, user, pass)` → JWT token
- `buildEnvelope(from, to, docFileName, extId)` → XML string (točna potrdjena oblika)
- `buildZip(files)` → Buffer; JSZip, kompresija STORE
- `posljiBizbox(host, token, envelopeXml, docFileName, docBytes)` → {status, body}
- `sestaviEddress(davcna, eRacunNaslov?)` → "SI" + čista davčna, ali direktni eDDress

## eDDress sestava
FROM = `sestaviEddress(podjetje.podjetjeDavcna)` → "SI" + 8-mestna  
TO = `sestaviEddress(kupec.davcnaStevilka, kupec.eRacunNaslov)` — prednostno eRacunNaslov

## API kontrakt
- TEST: `demo.zzi.si`, PROD: `ws.zzi.si`, port 443, HTTPS
- Bazna pot: `/eStoritveRest/EStoritveRest`
- Login: `POST /login?userName=<urlenc>&password=<urlenc>`, form body
- Oddaja: `POST /documents?guid=<token>&isArchived=false`, Content-Type: octet-stream, ZIP telo

## Poverilnice
STROGO iz env: `BIZBOX_USER`, `BIZBOX_PASS`. Nikoli v kodi/bazi/logih.

## Nastavitev okolja
Ključ `bizBoxOkolje` v `nastavitve` tabeli (FURS_KLJUCI_PO_PODJETJU, enota_id=0).  
Vrednosti: `'test'` (privzeto, demo.zzi.si) ali `'prod'` (ws.zzi.si).  
`getBizboxHost(okolje)` → PROD samo ob eksplicitnem `'prod'`.

## Status model
`eRacunStatus` enum razširjen: `pripravljen | poslan | poslano | napaka`  
Nova polja: `e_racun_poslano_dne` (timestamptz), `e_racun_bizbox_odgovor` (text)  
Migracija: `lib/db/src/migrations/0012_bizbox_polja.sql`

## Ruta
`POST /api/pos/racuni/:id/eracun/poslji`  
- Zahteva `eRacunStatus='pripravljen'` in shranjen `eRacunXml`
- Ob uspehu: status→`poslano`, shrani datum in sled odgovora
- Ob neuspehu: pusti `pripravljen` (možen ponovni poskus), shrani napako

## UI
- `BizBoxPosljiButton` v Receipts.tsx — vidno ko status=`pripravljen` ali `poslano`
- `BizBoxOkoljeIndikator` — prikaže "TESTNO (demo.zzi.si)" ali "PRODUKCIJA (ws.zzi.si)" (prod = rdeče + opozorilo)
- `bizBoxKonfiguriran` iz nastavitev (preveri env, ne razkrije vrednosti)
- Gumb neaktiven z opisom, če poverilnice niso nastavljene

## Opozorilo o formatu (NE POPRAVLJAJ brez potrditve)
Faza A generira UBL 2.1 sintakso. Referenčni bizBox primeri so EDIFACT.
Usmerjanje (envelope) deluje v obeh primerih, A sprejem UBL s strani prejemnika
NI potrjen. Preveriti s testnim pošiljanjem na demo.zzi.si.

**Why:** eDDress envelope je sintaksi-neodvisen, generator Faze A pa je UBL — 
sprememba v EDIFACT bi zahtevala poln pregled generatorja, kar je večje delo.

## Novi izvozi in dokaz dostave

Pri novih e-SLOG izvozih uporabljaj izvorno sintakso e-SLOG 2.0, ne UBL,
označenega z ovojnico ESLOG. Uradna dokumentacija, shema in vzorci so na
https://epos.si/eslog v paketu e-SLOG-2.0-08-2020-SL.zip.

**Why:** bizBox sprejem transportnega paketa ni dokaz skladnosti vsebine
ali dostave prejemniku. Izvorni e-SLOG ima drugačno sintakso kot UBL;
preverjanje mora vključevati dejanski izvoženi XML in uradno shemo.

**How to apply:** loči uspešno oddajo od potrjene dostave. Splošen odgovor
`ok` ali besedilo, ki zgolj vsebuje `delivered`, ni dokaz dostave.
Po nejasnem POST izidu ne pošiljaj znova brez uskladitve pri ponudniku.

Za nove večnajemniške oddaje ne uporabljaj skupnih platformskih poverilnic
kot nadomestila za manjkajočo povezavo podjetja.

**Why:** povezava določa dejanskega pošiljatelja in njegovo zunanje okolje;
platformski nadomestni račun lahko dokument pošlje za napačno podjetje.

**How to apply:** uporabljaj izrecno povezavo aktivnega podjetja. Za preverjanje
že oddanega dokumenta ohrani tudi prvotno okolje in identiteto zunanjega računa.
