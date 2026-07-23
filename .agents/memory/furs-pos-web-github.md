---
name: FURS POS Web GitHub
description: Izvorni POS projekt na GitHubu — referenca za kopiranje logike
---

## GitHub repozitorij

**URL:** https://github.com/Bookie-Mikrona/POS

Kadar koli se uporabnik sklicuje na "FURS POS Web", "originalni POS" ali podobno, beri kodo iz tega repozitorija prek raw URL-jev:

```
https://raw.githubusercontent.com/Bookie-Mikrona/POS/main/<pot/do/datoteke>
```

Struktura je enaka kot v trenutnem projektu (`artifacts/api-server/`, `artifacts/pos/`, `lib/db/`, itd.).

**Why:** Uporabnik je zahteval, da za referenco vedno berem iz tega GitHub repozitorija, ne ugibam ali improvizujem.

**How to apply:** Pred implementacijo kakršne koli logike, ki jo uporabnik opisuje kot "iz FURS POS Web", najprej prenesi ustrezno datoteko z `curl -s "https://raw.githubusercontent.com/Bookie-Mikrona/POS/main/..."`.
