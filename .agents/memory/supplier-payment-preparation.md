---
name: Priprava plačil dobaviteljem
description: Pravila za izbor odprtih računov, delna plačila in kontrolo bančnega stanja.
---

Pri pripravi izplačil prikaži dejanske odprte preostanke računov vseh dobaviteljev hkrati, kronološko po datumu zapadlosti. Ne zahtevaj predhodne izbire posameznega dobavitelja. Nezapadle postavke označi zeleno, zapadle rdeče. Uporabnik lahko izbere več računov in za vsakega zmanjša znesek zaradi delnega plačila; skupni znesek je vsota izbranih zneskov.

**Why:** Uporabnik mora pred oddajo plačil pregledno videti prioriteto obveznosti in preprečiti pripravo naloga, za katerega na izbranem TRR ni zadostnega dejanskega kritja. Knjigovodski saldo konta 110x med odprtima poslovnima letoma lahko nima otvoritvenega stanja in zato ni merilo trenutne razpoložljivosti denarja.

**How to apply:** Razpoložljivo stanje vodi po konkretnem TRR iz zadnjega zanesljivega stanja bančnega izpiska in vseh poznejših evidentiranih transakcij oziroma iz neprekinjenega dnevnika izpiskov. Saldo konta 110x ne sme omejevati ali določati razpoložljivih sredstev. Kontrolo izvedi v UI in ponovno na strežniku. Izbor čez več dobaviteljev ob shranjevanju razdeli v ločene osnutke plačil po dobavitelju in kontu obveznosti.