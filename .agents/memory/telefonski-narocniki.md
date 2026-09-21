---
name: Telefonski naročniki
description: Pravilo za shranjevanje in ponovno uporabo kontaktov pri telefonskih naročilih POS.
---

Vsako telefonsko naročilo ali telefonska rezervacija mize mora na strežniku
razrešiti fizičnega naročnika po normalizirani telefonski številki znotraj
poslovne enote. Če ga še ni, ga ustvari. Ob prihodu gosta se naročilo pri mizi
veže na istega naročnika, zato skupna zgodovina vključuje prevzem, dostavo in
naročila pri mizi.

**Why:** Podatki iz prevzema, dostave in rezervacije so isti kontaktni podatki
iste osebe. Ločeni zapisi bi onemogočili predizpolnitev ob naslednjem klicu in
skrili del zgodovine naročil.

**How to apply:** Šifrant in povezavo z naročilom vedno določi strežnik; ključ
je normalizirana številka znotraj trenutne enote. Prenos povezave na naročilo,
čiščenje rezervacije in posodobitev statistike morajo biti ena transakcija.
Opomba k rezervaciji ostane ločena od trajnih opomb k stranki.