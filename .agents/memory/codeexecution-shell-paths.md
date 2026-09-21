---
name: CodeExecution shell poti
description: Skriti zaključki vrstic v izhodu shellExec callbacka lahko pokvarijo nadaljnje datotečne klice.
---

Ko v CodeExecution razdeliš izhod callbacka `shellExec` na vrstice in jih nato uporabiš kot poti za `readFile` ali `writeFile`, vsako vrstico najprej obvezno očisti z `trim()`.

**Why:** Izhod lahko vsebuje skriti znak `\r`; navidezno pravilna pot zato pri naslednjem callbacku vrne `notFound`.

**How to apply:** Po `split("\n")` uporabi `map((line) => line.trim())` in šele nato filtriranje ter datotečne klice.