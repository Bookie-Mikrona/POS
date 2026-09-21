---
name: POS dnevne temeljnice
description: Meja med samodejnimi POS osnutki in ročnim računovodskim prenosom prejemnic
---

## Kaj je implementirano

Samodejni POS tok pripravlja osnutke za prodajo in porabo:

| Ref | Vsebina | Debet | Kredit |
|-----|---------|-------|--------|
| `POS:PRODAJA:YYYY-MM-DD` | Dnevna prodaja (Z-poročilo) | blagajna po plač. načinu | prihodki + DDV |
| `POS:PORABA:YYYY-MM-DD` | Poraba blaga (COGS) | stroški blaga | zaloge |

## Ključne datoteke

- Schema: `lib/db/src/schema/pos/pos-booking-settings.ts` + export v `pos/index.ts`
- Sync logika: `artifacts/api-server/src/lib/posSyncBooking.ts`
- API route: `artifacts/api-server/src/routes/posBookingSettings.ts` (registriran v `routes/index.ts`)
- Auto-trigger velja za račune/prodajo, ne za prejemnice.
- ERP UI: tab "POS Knjiženje" v `artifacts/erp-web/src/pages/nastavitve.tsx`

## Arhitekturne odločitve

**Idempotentnost**: pred vsako kreacijo se obstoječi osnutek z istim ref pobriše. Potrjene (posted) temeljnice se nikoli ne brišejo.

**"Ostala plačila" konto**: gotovina + kartica morata skupaj = skupaj znesek računa. Razlika (boni, negotovinsko) gre na `otherPaymentAccountId`. Brez tega konta, ko je razlika > 0.005€, se temeljnica ne ustvari (vrne skipped z razlogom).

**datum v Ljubljana času**: za `racuni.datumCas` (timestamptz) se uporablja `AT TIME ZONE 'Europe/Ljubljana'` v SQL. Za hook trigger v TS: `new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Ljubljana" }).format(datumCas)`.

**COGS vrednost**: iz `zaloga_gibi` kjer `tip='poraba'`. Vrednost je negativna (kolicina < 0 × cenaKos), vzamemo `ABS(SUM(vrednost))`. Join prek `artikli.enota_id` za filtriranje po podjetju.

**companyId v POS routih**: `(req as any).companyId` — nastavi middleware `requireEnota`.

**Meja enota/podjetje:** interne POS temeljnice (prodaja, poraba in začetne zaloge) so ločene po enoti in stroškovnem mestu; KIR/KPR/DDV/RPO ostanejo zbirni po podjetju.
**Why:** enota je samostojna operativna lokacija, davčni zavezanec pa je podjetje.
**How to apply:** začetne zaloge imajo stabilno referenco z `E{enotaId}` in SM ter SM na vrsticah; ne razdružuj zakonskih DDV evidenc po bifejih.

**Why:** POS ne sme ustvariti niti računovodskega osnutka prejemnice. Računovodja mora prenos izrecno sprožiti v modulu Glavna knjiga.
**How to apply:** ustvarjanje in urejanje POS prejemnice ne odpirata knjižnega dialoga in ne kličeta GL endpointa; računovodski prenos je zaščiten z računovodsko vlogo.

## Prejemnice prek obračuna nabave

**Pravilo:** POS prejemnica je operativni dokument. Ko je fizično potrjena, lahko računovodja iz modula Glavna knjiga ročno pripravi osnutek temeljnice; POS tega ne sproža.

**Why:** uvozne prejemnice lahko začasno nimajo artikla ali dobavitelja. Delno knjiženje bi pustilo neuravnoteženo temeljnico oziroma saldakonto brez analitike, zastarel osnutek pa bi računovodja lahko pomotoma potrdil.

**How to apply:** računovodski prenos sme zajeti samo fizično potrjeno prejemnico. Pred nastankom GL osnutka validiraj vse postavke in uravnoteženost; knjižene temeljnice ostanejo nespremenljive.

## Nastavitve (8 polj)

`revenueAccountId`, `cashAccountId`, `cardAccountId`, `otherPaymentAccountId`, `vatLiabilityAccountId`, `inventoryAccountId`, `payablesAccountId`, `cogsAccountId`
