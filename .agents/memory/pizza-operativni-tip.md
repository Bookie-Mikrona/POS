---
name: Operativna vrsta pice
description: Razlika med postajo priprave in klasifikacijo normativa pri picah.
---

Pica lahko istočasno uporablja postajo priprave »pica« in operativni tip »composite«. Ti polji nista alternativi: tip »composite« je potreben za izračun razpoložljivosti po velikostih, kadar uporablja pripravljene sestavine ali hlebčke.

**Why:** Shranjevanje dodatne možnosti za To Go je nekoč prepisalo operativni tip obstoječe sestavljene pice v »ala_carte«. Normativ in povezave modifikatorjev so ostali, vendar je izračun razpoložljivosti pico izpustil. Popravek samo v odjemalčevem obrazcu ni zadoščal: napačen ali zastarel odjemalec lahko še vedno pošlje »ala_carte«, zato mora strežnik pri običajnem urejanju obstoječe pice zaščititi njen shranjeni tip.

**How to apply:** Pri vsakem urejanju pice ohrani njen operativni tip na strežniku neodvisno od postaje priprave, embalaže in vrednosti, ki jo pošlje odjemalec; ne izpeljuj ga samodejno iz tega, ali je postaja »hrana«. Manjkajoč prikaz razpoložljivosti preveri tudi skozi to klasifikacijo, ne samo skozi normativ.