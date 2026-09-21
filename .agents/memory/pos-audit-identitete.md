---
name: POS audit identitete
description: Trajna pravila za ločevanje prijavljenega Clerk izvajalca in natakarja iz actor seje.
---

V POS revizijski sledi sta prijavljeni Clerk izvajalec in natakar iz actor seje dve ločeni identiteti. Obstoječega integer stolpca za izvajalca ne pretipkaj ali ponovno uporabi za Clerk string.

**Why:** Clerk ID je string, natakar ID pa integer in predstavlja drugo poslovno vlogo. Združevanje pomenov povzroči NULL zapise, napačno atribucijo in nevarne migracije zgodovine.

**How to apply:** Za nove audite vedno eksplicitno zapiši Clerk izvajalca in ločen nullable natakar ID. Identitete ne podvajaj v metadata.

Varnostno pomembna mutacija in njen audit zapis morata biti v isti podatkovni transakciji.

**Why:** Če audit odpove po mutaciji, sistem ostane spremenjen brez zahtevane revizijske sledi.

**How to apply:** Skupnemu audit helperju podaj executor iste transakcije, ki izvaja poslovno ali varnostno spremembo.