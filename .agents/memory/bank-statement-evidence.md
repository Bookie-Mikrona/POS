---
name: Evidenca bančnih izpiskov
description: Revizijska identiteta uvoženega izpiska in povezava bančnih transakcij s plačili.
---

Bančni izpisek je samostojen dokument z izbranim kontom 110x, izvornim IBAN-om, številko, datumom oziroma obdobjem, začetnim in končnim stanjem ter kontrolnim odtisom datoteke. Vse razčlenjene transakcije se shranijo kot njegove vrstice, tudi če niso uparjene z računom.

**Why:** Samostojna plačila brez glave izpiska ne omogočajo dokazovanja popolnosti obdobja, zanesljivega preprečevanja ponovnega uvoza ali rekonstrukcije izvora knjižbe. Konto 110x lahko zaradi manjkajoče otvoritve naslednjega leta kaže nepopoln saldo, zato ne predstavlja trenutnega bančnega kritja.

**How to apply:** Posamezno plačilo je lahko povezano z največ eno vrstico izpiska. SHA-256 odtis je enoličen znotraj podjetja. CAMT/MT940 podatke preberi iz glave; pri CSV manjkajoča polja pusti prazna in uporabi datumski razpon transakcij. Dejanska razpoložljivost se vodi po posameznem TRR iz stanj in neprekinjenega dnevnika izpiskov, ne iz salda konta 110x.