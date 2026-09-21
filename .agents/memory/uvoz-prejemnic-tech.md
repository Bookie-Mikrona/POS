---
name: Uvoz prejemnic — tech sklad
description: Arhitekturne odločitve in pasti pri integraciji Claudovega uvoz-prejemnic modula v BOOKIE ERP/POS
---

## Naučene lekcije (integracija bookie-uvoz-prejemnic.zip)

### 1. drizzle-orm/node-postgres vrača QueryResult, ne array

BOOKIE uporablja `drizzle-orm/node-postgres` (ne `postgres-js`).  
`db.execute<T>(sql`...`)` vrne `QueryResult<T>`, ne `T[]`.

**Pravilni vzorci:**
```ts
// Destructured array — TREBA dodati .rows
const [prvi] = (await db.execute<T>(sql`...`)).rows;

// Named rows — samo destructuriraj
const { rows: seznam } = await db.execute<T>(sql`...`);

// Brez rezultata (UPDATE/INSERT brez RETURNING) — nič posebnega
await db.execute(sql`...`);
```

**Napaka:** sed/Python skripta, ki avtomatsko dodaja `(await...).rows`, pogosto
pokvarila SQL template literale (multi-line) ali dodala `.rows` tam, kjer ni
treba (bare `await tx.execute`). Popravljati eno-po-eno.

### 2. Claudove predpostavke → BOOKIE zamenjave

| Claude predpostavka | BOOKIE dejanski |
|---|---|
| `partnerji` tabela | `shranjeni_kupci` |
| `podjetje_id` / `podjetjeId` | `enota_id` / `enotaId` |
| `a.naziv` | `a.ime` |
| `a.sifra` | `NULL::text` (ne obstaja) |
| `a.osnovna_enota` | `a.enota_mere` |
| `a.tip IN ('NABAVNI',...)` | `a.nabavni_artikel = TRUE` |
| `bigserial`/`bigint` PKs | `serial`/`integer` |
| `gln` stolpec na partnerjih | ne obstaja |
| `zahtevajPravico(...)` middleware | `requireEnota` (iz `../../middlewares/pos`) |
| `AvtoriziranRequest` | `PosRequest` (iz `../../middlewares/pos`) |
| `from '../../db'` | `from '@workspace/db'` |
| `req.uporabnik.id` | ne obstaja; `req.clerkUserId` je string |
| `req.uporabnik.podjetjeId` | `req.enotaId` |

### 3. Manjkajoči paketi — potrebno instalirati

```bash
pnpm --filter @workspace/api-server add papaparse fast-xml-parser imapflow mailparser zod
pnpm --filter @workspace/api-server add -D @types/papaparse @types/mailparser
```

### 4. Uvoz registracija rut

Route datoteki `uvoz-prejemnic.ts` in `uvoz-profili.ts` morata biti registrirani
v `artifacts/api-server/src/routes/pos/index.ts` z:
```ts
router.use(requireEnota, uvozPrejemniceRouter);
router.use(requireEnota, uvozProfiliRouter);
```

### 5. zajem.ts — IMAP urnik

Datoteka `zajem.ts` je skeduliran IMAP zajem. Ob integraciji:
- `podjetje_id` → `enota_id` povsod
- `db.execute<Predal>` constraint → cast z `as unknown as Predal[]`
- Nullable `enota_id` → `p.enota_id ?? 0` ko se posreduje kot `number`

### 6. Drizzle ORM — esbuild build preveri sintakso

esbuild (za razliko od tsc) se **ustavi ob sintaktičnih napakah** SQL template
literalov. TypeScript type napake ignorira. Vedno zaženemo `node ./build.mjs`
za kontrolo sintakse pred testiranjem.

### 7. Decimal vrednosti po JSON shrambi

OCR razčlenitev v bazi je JSON, zato se `Decimal` objekti ob branju vrnejo kot
nizi. Pred nadaljevanjem shranjene seje jo je treba vedno razčleniti skozi
kanonično DTO shemo; TypeScript `as PrejemDTO` ne pretvarja podatkov med izvajanjem.

**Why:** Brez ponovne razčlenitve metode, kot so `.gt()`, `.mul()` in `.div()`,
odpovejo šele pri potrditvi dobavitelja.

**How to apply:** Vsak tok, ki DTO prebere iz JSON/JSONB, naj na meji uporabi
kanonični Zod `parse`, preden DTO posreduje uvozni storitvi.

### 8. `db.execute` lahko JSONB vrne kot niz

Pri surovih poizvedbah rezultat JSON/JSONB ni nujno že razčlenjeno polje ali
objekt. Pred preverjanjem z `Array.isArray` ali branjem lastnosti je treba
sprejeti tudi JSON niz in ga varno razčleniti.

**Why:** Paketno OCR-uparjanje je opozorilo `EMB001` dobilo kot niz, zato ga je
obravnavalo kot običajno vrstico in povratni embalaži predlagalo navadne artikle.

**How to apply:** Na meji rezultata `db.execute` normaliziraj JSON vrednost iz
obeh oblik (niz ali že razčlenjena vrednost); poškodovan JSON naj varno odpove.

### 9. Aktivnost ne omejuje nabavnega uparjanja

Zastavica `aktiven` je prodajna lastnost in pri nabavnih artiklih ne sme omejevati
iskanja kandidatov ali samodejnega uparjanja v nobeni vrsti uvoza.

**Why:** Nabavni artikli so lahko sistemsko neaktivni, vendar morajo ostati
veljavni za prejemnice, cenike ter CSV, XLSX, XML, PDF, OCR in skenerske uvoze.

**How to apply:** Nabavno uparjanje omeji z `nabavni_artikel`, enoto in vrsto
embalaže; `aktiven` ne uporabljaj kot filter, prednost ali pogoj za samodejno povezavo.

### 10. Dvomljivo uparjanje ne sme blokirati uvoza z AI-klici

Modelski predlog, ki se nikoli ne uporabi za samodejno povezavo, ne sodi v
sinhroni tok ustvarjanja prejemnice.

**Why:** Zaporedni AI-klici za dvomljive vrstice podaljšajo stanje »Prepoznavam«,
ne da bi povečali število varno samodejno povezanih artiklov.

**How to apply:** Sinhroni uvoz uporabi deterministične kandidate; dvomljive
vrstice takoj prikaži uporabniku za potrditev. Morebitno AI-rangiranje izvedi
pozneje oziroma neblokirajoče.

### 11. Veljavnost DDV kode sledi datumu prejema

Pri uvozu prejemnice in poznejšem ročnem uparjanju izberi vhodno DDV kodo po
datumu prejema v sistem, ne po zgodovinskem datumu dobaviteljevega dokumenta.

**Why:** FURS šifrant v aplikaciji velja od 1. 7. 2025. Starejši dokument,
prejet pozneje, je sicer ostal brez kode P95/P22/P5 in dobil lažno opozorilo.

**How to apply:** Za veljavnost `vat_code` uporabi `prejemnice.datum`; datum
dokumenta ostane poslovni podatek in ne določa različice trenutnega šifranta.

### 12. Decimalne vrednosti iz OCR obrazcev

Uporabniški decimalni vnosi v OCR obrazcih sprejemajo slovensko vejico, zato jih
je treba pred API-klicem normalizirati in eksplicitno validirati.

**Why:** JavaScript `Number("3,50")` vrne `NaN`; fallback `|| 0` je prodajno
ceno nato brez opozorila shranil kot nič.

**How to apply:** Odstrani presledke, zamenjaj vejico s piko in zavrni
neveljavno vrednost. Za poslovne zneske nikoli ne uporabljaj tihega `|| 0`.

### 13. OCR-identifikator ne sme preskočiti drugih ujemanj partnerja

Če OCR-davčna nima obstoječega natančnega zadetka, mora določanje partnerja še
vedno preveriti matično, IBAN in naziv. Nov partner zahteva natančno zunanjo
potrditev davčne; Inetis približni rezultat ni dovolj.

**Why:** OCR je prvih osem mest matične Tobačne prebral kot davčno. Zgodnja
vrnitev iz davčne veje je preskočila popolno ujemanje kratkega naziva in
ustvarila dvojnika.

**How to apply:** Ne vračaj predloga novega partnerja pred zaključkom vseh
determinističnih preverjanj. Davčno in ID za DDV dodatno varuj z unikatnostjo
znotraj podjetja ter konflikt vstavljanja razreši z branjem obstoječega zapisa.
