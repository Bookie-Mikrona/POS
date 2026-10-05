---
name: Križišče POS brez interne glavne knjige
description: Poslovna meja med POS Križišča in računovodstvom zunanjega izvajalca
---

Križišče uporablja Bookie POS Gostinstvo, poslovne knjige pa zanj vodi drugo podjetje v drugem programu. POS temeljnice se morajo kljub temu ustvarjati samodejno, brez kontrole računovodskega obdobja. Ne odpiraj internih računovodskih obdobij zgolj zato, da bi omogočil te POS osnutke. V razvojnem okolju uporabnik še testira modul Osnovna sredstva; njegovih podatkov ne briši kot del čiščenja glavne knjige.

**Why:** Uporabnik je izrecno potrdil zunanje računovodstvo, nato pojasnil, da to ne izključuje samodejne priprave POS temeljnic. Dovolil je poznejši vklop GK v istem letu, vendar prenos prejšnjega POS prometa samo na posebno zahtevo, nikoli privzeto. Zgodovinske oznake modulov in ostanki računovodskih testov niso dokaz drugačne poslovne namere.

**How to apply:** Loči pripravo POS temeljnic za zunanje računovodstvo od dejanskega knjiženja v interno GK. Če podjetje pozneje istega leta vključi GK, mora ta privzeto ostati prazna glede prejšnjega POS prometa. Prenos prejšnjih POS temeljnic je dovoljen samo na posebno, izrecno uporabnikovo zahtevo, ne samodejno. POS osnutki ostanejo dostopni v POS; notranje knjiženje mora še vedno spoštovati obdobja in zaklepe. OS obravnavaj ločeno. Pri čiščenju podatkov naj bo vsaka destruktivna operacija izrecno omejena po podjetju, letu in vrsti podatkov.