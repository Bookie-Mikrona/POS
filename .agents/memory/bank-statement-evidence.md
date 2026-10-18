---
name: Evidenca bančnih izpiskov
description: Revizijska identiteta izpiska, skenirani bančni osnutki in ločitev od računov ter poravnav.
---

Skenirani bančni izpisek ni prejeti ali izdani račun. Po uporabnikovem pregledu se prenese v neknjižen bančni osnutek; navadni prilivi in odlivi so zunaj DDV. Prenos ne knjiži in ne zapira računov samodejno.

**Why:** Uporabnik je potrdil ločitev bančnega prenosa, potem ko se je priliv napačno pretvoril v prejeti račun. Splošna referenca, kot je SI99, ni dokaz, katere terjatve so poravnane.

**How to apply:** Bančne izpiske prepoznaj pred predlogi kontiranja računov. Nepopoln bančni dokument ustavi za pregled, ne preusmeri ga v račun. Napačen neknjižen račun nadomesti samo z izrecnim dovoljenjem in ohranjeno revizijsko sledjo; že knjiženega ali plačanega ne razveljavljaj samodejno. Izbira kontov in partnerjev ter morebitno poznejše zapiranje ostanejo računovodjeva ločena odločitev.

Bančni izpisek je samostojen dokument z izbranim kontom 110x, izvornim IBAN-om, številko, datumom oziroma obdobjem, začetnim in končnim stanjem ter kontrolnim odtisom datoteke. Vse razčlenjene transakcije se shranijo kot njegove vrstice, tudi če niso uparjene z računom.

**Why:** Samostojna plačila brez glave izpiska ne omogočajo dokazovanja popolnosti obdobja, zanesljivega preprečevanja ponovnega uvoza ali rekonstrukcije izvora knjižbe. Konto 110x lahko zaradi manjkajoče otvoritve naslednjega leta kaže nepopoln saldo, zato ne predstavlja trenutnega bančnega kritja.

**How to apply:** Posamezno plačilo je lahko povezano z največ eno vrstico izpiska. SHA-256 odtis je enoličen znotraj podjetja. CAMT/MT940 podatke preberi iz glave; pri CSV manjkajoča polja pusti prazna in uporabi datumski razpon transakcij. Dejanska razpoložljivost se vodi po posameznem TRR iz stanj in neprekinjenega dnevnika izpiskov, ne iz salda konta 110x.

Ročna primerjava knjiženega salda s stanjem, ki ga računovodja prepiše z izpiska, je samo diagnostična kontrola. Ne predstavlja novega dokazila o bančnem stanju in ne sme spreminjati kritja za plačila.

**Why:** Knjiženi saldo in dokazljivo stanje banke imata različna namena; nepotrjen ročni vnos ne sme prepisati dokumentarne sledi izpiskov. Primerjava je smiselna le za isti TRR in isti presečni datum.

**How to apply:** Vnos za primerjavo jasno loči od uvoza izpiska in od razpoložljivega kritja. Ob primerjavi zgodovinskega izpiska uporabi knjiženi saldo na njegov datum, ne današnjega.

Bančni izpisek lahko vsebuje izplačila dobaviteljem, plač, DDV in druge vrste prometa. En skupni konto obveznosti ni ustrezna računovodska predpostavka za celoten izpisek; protikonto mora slediti posamezni transakciji oziroma njeni izvorni obveznosti.

**Why:** Uporabnik je izrecno opozoril, da izplačila niso vedno na 2200000 ali enem drugem skupnem kontu.

**How to apply:** Pri razširitvi uvoza podpri različne protikonte po vrsticah ter transakcije brez dobaviteljskega računa. Skupna nastavitev je lahko le predlog, ne brezpogojno kontiranje vseh izplačil.

Obnovitev delnega uvoza ne sme ponovno ustvariti ali samodejno knjižiti plačila, katerega ustvarjanje je strežnik že potrdil. Nepotrjeno knjiženje zahteva preverjanje dejanskega stanja plačila.

**Why:** Potek seje med knjiženjem ne pomeni, da ustvarjanje plačila ni uspelo; ponovna izdelava ne sme služiti kot ponovni poskus knjiženja.

**How to apply:** Napredek ustvarjanja ohrani pred začetkom knjiženja. V obnovljenem pregledu jasno loči že ustvarjeno plačilo od potrjenega knjiženja ter nadaljuj samo z neustvarjenimi vrsticami.

Obnovitev mora ohraniti tudi uspešno evidentiranje izpiska, ne le ustvarjenih plačil.

**Why:** Evidentiranje istega datotečnega odtisa je namenoma zavrnjeno. Če nadaljevanje ponovno evidentira datoteko, se ustavi še pred neobdelanimi plačili.

**How to apply:** Identiteto izpiska in njegovih vrstic shrani pred prvim ustvarjanjem plačila ter ju ob nadaljevanju ponovno uporabi. Časovni iztek neoddanega pregleda ne sme izbrisati že potrjenega evidentiranja ali plačil: sicer nadaljevanje izgubi dokaz, katere zapise mora preskočiti.