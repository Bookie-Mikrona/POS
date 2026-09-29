---
name: Križišče POS brez interne glavne knjige
description: Poslovna meja med POS Križišča in računovodstvom zunanjega izvajalca
---

Križišče uporablja Bookie POS Gostinstvo, poslovne knjige pa zanj vodi drugo podjetje v drugem programu. V Bookieju zanj ne odpiraj računovodskih obdobij ali samodejno ustvarjaj glavne knjige zgolj zato, ker ima POS promet. V razvojnem okolju uporabnik še testira modul Osnovna sredstva; njegovih podatkov ne briši kot del čiščenja glavne knjige.

**Why:** Uporabnik je izrecno potrdil, da Križišče v tej aplikaciji ne bo vodilo glavne knjige, osnovna sredstva pa še testira. Zgodovinske oznake modulov in ostanki računovodskih testov v razvojni bazi niso dokaz drugačne poslovne namere.

**How to apply:** Pri spremembah POS→GK naj odsotnost interne glavne knjige prepreči ustvarjanje računovodskih osnutkov; OS obravnavaj ločeno. Pri čiščenju podatkov naj bo vsaka destruktivna operacija izrecno omejena po podjetju, letu in vrsti podatkov.