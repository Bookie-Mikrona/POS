---
name: Brisanje osnutkov temeljnic
description: Pravilo varnega brisanja osnutkov glavne knjige in zaščite revizijske sledi.
---

Temeljnico je dovoljeno izbrisati samo v statusu osnutka. Knjižene, stornirane in storno temeljnice se ne brišejo.

**Why:** Osnutek še ni dokončen računovodski zapis, zato ga mora računovodja lahko odstraniti. Dokončne knjižbe morajo zaradi revizijske sledi ostati nespremenljive in se popravljajo s stornom.

**How to apply:** Brisanje izvede računovodja ali lastnik po izrecni potrditvi. V isti transakciji odstrani neprijavljeno DDV evidenco, knjižne vrstice in izvorne povezave, nato pa ohrani revizijski zapis z identiteto izbrisanega osnutka. Zaščitene povezave ali prijavljena DDV evidenca brisanje blokirajo.

Brisanje osnutka temeljnice ni brisanje izvornega računa. Povezan račun, ki je tudi osnutek in nima poravnav, ostane ohranjen z izvorno identiteto in zneski; odstrani se samo povezava na izbrisano temeljnico. Računi izven statusa osnutka, poravnave in drugi zaščiteni zapisi preprečujejo brisanje.

**Why:** Zgodovinski uvoz lahko poveže dva osnutka. Takšna povezava sama ne sme preprečiti izrecno zahtevanega brisanja temeljnice, vendar uporabnik s tem ni zahteval izgube računa ali njegove finančne zgodovine.

**How to apply:** Odklop in izbris sta ena transakcija z revizijsko sledjo; vsaka poznejša blokada mora razveljaviti tudi odklop. V potrditvi jasno povej, da povezani osnutek računa ostane shranjen.