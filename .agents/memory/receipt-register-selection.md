---
name: Izbor blagajne pri izdaji računa
description: Pravilo za fiskalno identiteto računa ob menjavi enote in dovoljeni obseg legacy fallbacka.
---

Če ima trenutna POS enota vsaj eno aktivno konfigurirano blagajno, mora vsaka nova izdaja računa ali darilnega bona poslati ekspliciten ID aktivne blagajne te enote. Nastavitveni oziroma `PP001/B001` fallback je dovoljen samo enotam brez aktivnih blagajn. Storno vedno ohrani identiteto izvornega računa.

**Why:** Prehodno stanje odjemalca takoj po menjavi enote lahko sicer izda račun z identiteto prejšnje ali legacy blagajne. Idempotentna ponovitev že izdanega računa mora kljub poznejši spremembi konfiguracije vrniti isti rezultat.

**How to apply:** Pravilo uporabi pred vsako novo fiskalno rezervacijo in FURS oddajo. Nove POS poti za izdajo morajo uporabljati isti strežniški resolver; obstoječega izdanega fiskalnega zapisa se ne popravlja neposredno.