---
name: Arhiv miz in zgodovina rezervacij
description: Trajna pravila za odstranjevanje miz, rezervacijske posnetke in revizijsko zgodovino.
---

Mize z zgodovino se umaknejo iz operativne uporabe z arhiviranjem, ne s fizičnim izbrisom. Rezervacija hrani nespremenljiv posnetek številke in imena mize ter prostora.

**Why:** Fizični izbris bi pokvaril zgodovinske koledarje in dokazljivost rezervacij, preimenovanje prostora ali mize pa ne sme spremeniti preteklih zapisov.

**How to apply:** Arhivirane mize izloči iz operativnih seznamov, razpoložljivosti, QR dostopa in novih naročil. Arhiviranje zakleni v vrstnem redu miza → odprto naročilo in ga zavrni, če odprto naročilo obstaja.

Vsaka ustvaritev, sprememba, preklic in arhiviranje mize zapiše append-only rezervacijski dogodek. Zgodovinskih dogodkov ni dovoljeno posodabljati ali brisati.

**Why:** Trenutno stanje ne pove, kdo in kdaj je spremenil termin, stranko, mizo ali status.

**How to apply:** Globalni pregled je podjetniško omejen; dostop do druge enote je dovoljen samo skrbniku istega podjetja in ob manjkajoči identiteti podjetja vedno odpove zaprto.