---
name: Zgodovinska glavna knjiga Bookie Old
description: Kazalo pravil preslikave, dokazil in primerjave starih izpisov.
---

Pri delu z zgodovinskimi podatki Bookie Old loči preslikavo kontov, izvirne računovske listine in primerjavo že oddanih izpisov.

**Why:** Ista številka konta lahko pomeni nekaj drugega, promet ni popolna izvirna listina, sodobna bilanca stanja pa ni nadomestek starega bruto izpisa.

**How to apply:** Uporabi ustrezno povezano podtemo na koncu tega dokumenta.

Gradiva starega programa so tudi referenca za razvoj funkcionalnosti, ne samo za prenos zgodovinskih podatkov.

**Why:** Uporabnik je izrecno ločil razvoj od migracije ter vprašal po implementaciji poslanih dokumentov, zaslonskih slik, vnosov in plačil. Uspešen prenos podatkov ne dokazuje pokritosti postopkov.

**How to apply:** Pri oceni pokritosti loči obstoj funkcije, njeno dejansko preverjeno delovanje in skladnost s predloženo referenco. Brez primerjave posameznih zahtev ne trdi, da je vse implementirano.

Razvojni osnutek ali komentar »placeholder« ni avtoritativni dokaz trenutnega stanja funkcionalnosti.

**Why:** Pri primerjavi referenc so nekateri starejši načrti še opisovali prihodnjo izvedbo, čeprav so pripadajoči vmesniki in strežniški tokovi že obstajali. Obratno sam prikazan gumb ni dokaz povezanega postopka.

**How to apply:** Status zahteve določi iz aktualnega klica vmesnika, strežniške izvedbe in navedenega preizkusa. Loči lokalni test datoteke od dejanskega sprejema pri banki, AJPES ali eDavkih.

Predloženi podatki in izpisi starega programa, ki jih je uporabnik potrdil 2026-10-02, so preverjeno pravilna referenca za primerjavo z novim programom.

**Why:** Uporabnik je izrecno navedel: »vsi poslani podatki so popolnoma preverjeno pravilni.« Njihove pravilnosti pri nadaljnji primerjavi ne postavljaj znova pod vprašaj.

**How to apply:** Ob odstopanju preverjaj preneseni obseg, datum posnetka, preslikavo, statuse knjižb in izračune novega programa. Ne spreminjaj potrjenih izvornih podatkov ali ustvarjaj izravnalnih knjižb zgolj za ujemanje z novim prikazom.

- [Preslikava GK](bookie-old-gk-mapping.md) — pomen K2, kolizije kontov, otvoritve, partnerji in časovni presek zapiranj.
- [Zgodovinski računi](bookie-old-zgodovinski-racuni.md) — dovoljeni obseg zgodovinskega knjiženja in omejitve davčnih dokazil.
- [Zgodovinska plačila](bookie-old-payments.md) — samo evidenčni prikaz; brez novih knjižb, ponovnih zapiranj ali bančnih nalogov.
- [Oddana bilanca](bookie-old-oddana-bilanca.md) — avtoriteta oddanih bruto izpisov in primerjava otvoritve, prometa ter skupaj.