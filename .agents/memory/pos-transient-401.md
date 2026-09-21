---
name: POS prehodni 401
description: Varna obravnava kratkotrajnih 401 odzivov brez izgube odprtih obrazcev.
---

En sam `401` iz običajne POS poizvedbe ne sme izbrisati uporabnika, počistiti celotnega predpomnilnika ali odmontirati aplikacije. Najprej je treba s prisilno svežim Clerk žetonom preveriti `/api/pos/auth/me`.

**Why:** Periodični POS klici lahko v istem kratkem časovnem oknu dobijo `401`, medtem ko takojšnje preverjanje uporabnika vrne `200`. Takojšnja globalna odjava je zato zapirala odprte obrazce in izgubljala neshranjene vnose.

**How to apply:** Med dedupliciranim potrditvenim preverjanjem ohrani obstoječega uporabnika in drevo aplikacije. Stanje odjave nastavi samo ob potrjenem `401` ali `403`; omrežne napake in `5xx` niso dokaz odjave.

Zagonsko nalaganje POS vloge sme biti vezano na stabilno identiteto Clerk uporabnika, ne na referenco celotnega `user` objekta ali funkcije za žeton.

**Why:** Clerk lahko med osveževanjem iste seje vrne nove objektne reference. Če to ponovno sproži stanje `loading`, se zaščiteni router odmontira, čeprav je uporabnik isti in `/api/pos/auth/me` uspe.

**How to apply:** Kot odvisnost uporabi stabilni Clerk user ID in druge nujne primitive. Aktualni token getter hrani v referenci; za isto identiteto ne ponavljaj zagonskega prehoda, ki odstrani obstoječi UI.

Tudi neposredni `posFetch` klici morajo ob prvem 401 enkrat prisilno pridobiti Clerk žeton brez predpomnilnika in ponoviti isto zahtevo. To posebej velja za QuickSwitch, kjer prehodni 401 ne pomeni napačnega PIN-a.

Retry po 401 mora iz izvornih caller glav na novo sestaviti vse upravljane identitetne glave: Clerk žeton, aktivno enoto in actor sejo. Stare vrednosti je treba najprej odstraniti tudi takrat, ko je nova vrednost prazna.

**Why:** Med prvim odgovorom in ponovitvijo se lahko natakar ali aktivna enota zamenja; mutiranje samo `Authorization` bi občutljiv zahtevek ponovilo s staro actor identiteto.

**How to apply:** Pravilo velja za neposredni `posFetch` in generirani `customFetch`, ki izdaja končni račun. Na retryju ponovno preberi enoto in actor sejo ter ohrani samo neupravljane caller glave, metodo, telo, URL in `credentials`. Nikoli ne mutiraj in ponovno uporabi prvega objekta `Headers`.

Zaščitenega neuspešnega odgovora nikoli ne razlagaj kot veljaven prazen seznam.

**Why:** Pri uvozu prejemnice je prehodni 401 na branju nepovezanih vrstic postal `[]`, zato se ročno povezovanje ni odprlo, čeprav so vrstice ostale nepovezane v bazi.

**How to apply:** Pred branjem telesa preveri `response.ok`; za POS uporabi `posFetch`. Ob napaki ohrani varen trenutni korak in prikaži napako, namesto nadaljevanja toka, ki velja samo za resnično prazen rezultat.