---
name: Izvoz analitičnega poročila med osveževanjem
description: Ohranjanje skladnosti podatkov CSV in filtrov ob sprotnem osveževanju analitičnega poročila.
---

CSV mora med čakanjem na nov rezultat ostati izvoz zadnjega uspešno prikazanega poročila, z njegovim obdobjem, dimenzijo in kontom.

**Why:** Sprotno urejanje URL filtrov ni dokaz, da je rezultat za nove filtre že prispel. Stare številke z novimi oznakami bi bile zavajajoč računovodski izvoz.

**How to apply:** Podatke in metapodatke obravnavaj kot eno celoto; začasni podatki prejšnje poizvedbe niso nov rezultat. Ohraniti je treba sprotno URL navigacijo, ne vračati ločenega potrjevanja filtrov samo zaradi izvoza.
