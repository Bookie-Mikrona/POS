---
name: POS prihodki po kategorijah
description: Računovodsko pravilo za razdelitev POS prihodkov po zgodovinski kategoriji artikla.
---

POS prodajne, mesečne, T4 in KIR vrstice uporabljajo kategorijo, ki je bila shranjena na postavki ob njenem nastanku. Poznejša sprememba kategorije artikla ne sme spremeniti zgodovinskega knjiženja. Kategorijska preslikava lahko kaže samo na prihodkovni konto; brez nje se uporabi splošni prihodkovni konto, če tudi tega ni, pa zaradi združljivosti stara matrika vrsta artikla × DDV. DDV se še naprej agregira izključno po davčni stopnji.

**Why:** Naknadno preurejanje POS šifranta ne sme retroaktivno premakniti prihodkov med konti, napačna vrsta konta pa bi ustvarila sicer uravnoteženo, vendar vsebinsko napačno temeljnico.

**How to apply:** Vsak tok, ki kopira postavke (zlasti storno), mora prenesti tudi kategorijski posnetek. Nova prodajna agregacija naj kategorijo uporablja le za neto prihodke, nikoli za razbitje DDV vrstic.