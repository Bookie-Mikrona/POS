---
name: e-SLOG e-mail kanal
description: Implementacija e-poštnega kanala za izdajo e-računa (e-SLOG ZIP = PDF + XML po e-pošti)
---

# e-SLOG e-mail kanal

## Kar je implementirano

**Migracija 048** (`lib/db/src/migrations/048-eracun-email-kanal.sql`):
- `racuni.e_racun_pdf` (text) — base64-encoded PDF, generiran enkrat ob XML generiranju
- `racuni.e_racun_email_odgovor` (text) — sled pošiljanja ("OK: jan@firma.si" ali "NAPAKA: …")

**Drizzle shema** (`lib/db/src/schema/pos/racuni.ts`):
- Dodana `eRacunPdf`, `eRacunEmailOdgovor`
- `eRacunStatus` enum razširjen s `"poslano_email"`

**pos-email.ts** (`artifacts/api-server/src/lib/pos-email.ts`):
- Funkcija `posljiEslogEmail(smtp, email, racun, xml, pdf, naziv)` — pošlje ZIP (PDF + XML) prek nodemailer

**racuni.ts** (`artifacts/api-server/src/routes/pos/racuni.ts`):
- `setImmediate` blok (ob izdaji A-računa): zdaj generira PDF + shrani v `e_racun_pdf` (base64) skupaj z XML
- `GET /eracun-paket.zip`: zdaj uporabi shranjeni `e_racun_pdf` če obstaja (fallback na-the-fly za stare račune)
- `POST /racuni/:id/eracun/poslji-email`: nov endpoint — pošlje e-SLOG XML + PDF na `counterparties.e_racun_email`

**Receipts.tsx** (`artifacts/pos/src/pages/Receipts.tsx`):
- Komponenta `EslogEmailButton` (zelena, s `<Mail>` ikono)
- Prikaže se ko `eRacunStatus === "pripravljen" || "poslano_email"` in `kupecCpId` je nastavljen
- Po uspešnem pošiljanju se status prikaže kot "poslano (e-pošta) DD.MM.YYYY HH:MM"

## Ključne odločitve

**Why PDF v base64 TEXT:** Konzistentno z `e_racun_xml` (TEXT). Brez Object Storage kompleksnosti.

**Why "poslano_email" kot ločen status:** `"poslano"` ostane za bizBox; `"poslano_email"` za e-poštni kanal — jasen ločen status za vsak kanal.

**Why UI brez vnaprejšnjega preverjanja e-naslova:** Endpoint vrne 422 z jasnim sporočilom "Dodajte e-naslov v Partnerji". Izogibanje JOIN v list query.

**How to apply:** Ob novem e-računu — `setImmediate` blok generira PDF takoj. Za stare račune (brez `e_racun_pdf`) oba endpointa generirajo PDF na-the-fly.

## Status pošiljanja — logika

| eRacunStatus | Pomen |
|---|---|
| `null` | XML ni generiran |
| `pripravljen` | XML + PDF generirani, čaka na pošiljanje |
| `poslano` | Uspešno oddano prek bizBox |
| `poslano_email` | Uspešno poslano na kupčev `e_racun_email` |
| `napaka` | Generiranje ali pošiljanje spodletelo |
