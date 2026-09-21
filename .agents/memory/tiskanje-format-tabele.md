---
name: Format tabele artiklov na računih
description: Enoten dvovrstični format tabele artiklov za vse tiskalne poti (ZCS, BT, NB80, USB)
---

# Format tabele artiklov — referenčni USB 58mm

**Pravilo:** vse tiskalne poti (ZCS Z92, BT most, NB80, USB) morajo imeti ENAK format tabele artiklov kot USB 58mm (`buildEscPosReceipt`):

- Glava: `Art. Kol. Cena Skupaj` — 4 kolone, desno poravnane, ločene z 1 presledkom, BREZ stolpca "D."
- Postavka je **dvovrstična**:
  1. vrstica = naziv artikla (prelom pri cols)
  2. vrstica = DDV oznaka (T1, T2 …) + količina + cena + skupaj
- Širine: kol(4), cena(10), skupaj(10); artW = cols − 27
- Zneski v tabeli: pika + presledek pred € ("4.90 €")
- T1 = najvišja DDV stopnja; ne-zavezanci brez T oznak

**Kolone:** vsi 58mm izpisi imajo 32 kolon, razen ZCS Z92, ki ima 30. 80mm = 40 kolon.

**Why:** uporabnik je fizično preveril vse štiri tiskalnike (avgust 2026) in izrecno zahteval poenotenje na USB videz. Prejšnji poskus (T1 v isti vrstici kot naziv + "D." glava) je bil napačen in razveljavljen.

**How to apply:** pri spremembah `buildTextReceipt` v pos-escpos.ts vedno primerjaj z `buildEscPosReceipt` (USB referenca). "H" format ostaja: `supportsDoubleHeight=false` (ZCS) pretvori "H"→"B"; BT/NB80 poti uporabljajo `true`.
