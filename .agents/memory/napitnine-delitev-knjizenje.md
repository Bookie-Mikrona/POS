---
name: Napitnine: delitev in knjiženje
description: Domenska pravila za profile delitve, obvezni dodatek, izvoz za plače in računovodsko zapiranje napitnin.
---

Prostovoljna napitnina zaposlenim in obvezni dodatek za storitev sta ločena poslovna pojma. Obvezni dodatek je izrecen opt-in podjetja; interna vrednost režima zaradi zgodovine ostane nespremenjena.

**Why:** Prostovoljna napitnina je obveznost do zaposlenih brez DDV, obvezni dodatek pa prihodek podjetja z DDV. En sam nejasen režim lahko povzroči napačen račun in knjižbo.

**How to apply:** Politiko in izbirni profil delitve določa administrator za vsako POS enoto posebej. Uporabljeni profil se snapshotira ob izdaji računa; poznejše spremembe ne smejo spremeniti zgodovine. Brez profila neposredna politika še vedno pripada natakarju računa.

Poravnava prostovoljne napitnine zapira obveznost z ločeno, idempotentno temeljnično knjižbo. Storno mora ustvariti append-only nasprotno knjižbo.

**Why:** Brisanje ali ponavljanje poravnave bi lahko podvojilo denarni tok oziroma pustilo odprto ali napačno zaprto obveznost.

**How to apply:** Plačni izvoz uporablja poslovni datum računa in vsebuje le dodelitve zaposlenim ali neodvisnemu skladu; POS ne računa davkov in prispevkov.