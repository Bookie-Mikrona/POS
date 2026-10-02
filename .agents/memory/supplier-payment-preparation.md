---
name: Priprava plačil dobaviteljem
description: Pravila za izbor odprtih računov, delna plačila in kontrolo bančnega stanja.
---

Pri pripravi izplačil prikaži dejanske odprte preostanke računov vseh dobaviteljev hkrati, kronološko po datumu zapadlosti. Ne zahtevaj predhodne izbire posameznega dobavitelja. Nezapadle postavke označi zeleno, zapadle rdeče. Uporabnik lahko izbere več računov in za vsakega zmanjša znesek zaradi delnega plačila; skupni znesek je vsota izbranih zneskov.

**Why:** Uporabnik mora pred oddajo plačil pregledno videti prioriteto obveznosti in preprečiti pripravo naloga, za katerega na izbranem TRR ni zadostnega dejanskega kritja. Knjigovodski saldo konta 110x med odprtima poslovnima letoma lahko nima otvoritvenega stanja in zato ni merilo trenutne razpoložljivosti denarja.

**How to apply:** Razpoložljivo stanje vodi po konkretnem TRR iz zadnjega zanesljivega stanja bančnega izpiska in vseh poznejših evidentiranih transakcij oziroma iz neprekinjenega dnevnika izpiskov. Saldo konta 110x ne sme omejevati ali določati razpoložljivih sredstev. Kontrolo izvedi v UI in ponovno na strežniku. Izbor čez več dobaviteljev ob shranjevanju razdeli v ločene osnutke plačil po dobavitelju in kontu obveznosti.

Končni uporabniški postopek je izbor odprtih obveznosti vseh dobaviteljev, določitev polnih ali delnih zneskov in konkretnega izvornega TRR ter priprava enega XML plačilnega paketa za ročni uvoz na spletni strani banke.

**Why:** Uporabnik je 2026-10-02 s posnetkom stare forme pojasnil, da banki odda izbrane naloge z enim prenosom; ne zahteva neposrednega bančnega API-ja. Izbira TRR mora veljati tudi v izvoženi datoteki, ne zgolj v zaslonski kontroli sredstev.

**How to apply:** Notranji ločeni osnutki po dobaviteljih ne smejo uporabnika prisiliti v ločene prenose za vsak nalog. Izvoz in uvoz nalogov še ne dokazujeta izvršenega plačila in ne smeta sama zapreti obveznosti; poravnavo potrdi ločen postopek na podlagi dejanske izvedbe oziroma bančnega izpiska.

Priprava plačil mora vključevati še odprte postavke iz prejšnjih poslovnih let, ne samo postavk aktivnega leta. Ločeno prikaži celotni odprti znesek postavke in predlagani znesek plačila ter seštevke vseh prikazanih obveznosti, obveznosti do izbranega datuma zapadlosti in nalogov, izbranih za prenos.

**Why:** Uporabnikov dodatni referenčni posnetek stare forme kaže postavke iz prejšnjih let ob aktivnem tekočem letu ter ločene stolpce »Znesek«, »Plačilo« in oznako prenosa. Skupni znesek obveznosti je lahko nenulsk, znesek izbranega prenosa pa nič.

**How to apply:** Filtra aktivnega poslovnega leta ne uporabi kot privzeto omejitev odprtih obveznosti. Vsoto za XML računaj iz uporabnikovih izbranih plačilnih zneskov, ne iz celotnih odprtih zneskov prikazanih postavk.