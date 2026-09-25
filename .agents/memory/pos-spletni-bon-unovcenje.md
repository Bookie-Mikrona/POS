---
name: POS unovčenje spletnega bona
description: Poslovna meja med individualnim spletnim bonom, računom, FURS in kartičnim terminalom.
---

Individualni spletni bon ni del stare skupne evidence bonov. Njegovo razpoložljivo stanje je saldo gibanj minus odprte rezervacije; predogled stanja ne pomeni zagotovljenega unovčenja. Rezervacija mora nastati v isti transakciji kot račun in nespremenljivi FURS podatki, pred zunanjim klicem. Potrjena izdaja jo pretvori v gibanje, potrjen storno jo enkrat obrne. Neznan izid FURS rezervacijo zadrži do preverjene uskladitve; ne sprosti je samodejno po času ali zgolj zaradi omrežne napake.

**Why:** Samostojna rezervacija lahko po padcu procesa ostane brez računa, samostojna unovčitev po FURS pa lahko pusti izdan račun brez porabljenega bona. Pri neznanem davčnem izidu je ponovitev še mogoča. Kartični terminal lahko trenutno bremeni pred rezervacijo bona, zato njuna kombinacija ni varna.

**How to apply:** Ob spremembah izdaje, retryja, storna ali terminalskega plačila ohrani isti transakcijski in idempotentni obseg; mešano kartično plačilo omogoči šele, ko bo bon trajno rezerviran pred bremenitvijo in bo obstajal varen postopek obnove.

Javno preverjanje stanja je ločeno od unovčitve: koda je skrivni ključ samo za vpogled v razpoložljivo vrednost in status pri podjetju **in enoti** javnega profila. Odgovor ne sme razkriti kupca, prejemnika, plačila ali ID-ja bona; omejitev zahtev in prepoved predpomnjenja veljata tudi za neuspešne poskuse.

**Why:** Javni obrazec nima prijave, zato bi splošen vpogled po podjetju lahko razkril stanje bona na napačni restavracijski strani ali osebne podatke imetnika. Delna poraba in odprte rezervacije spremenijo uporabni znesek tudi brez novega nakupa.

**How to apply:** Pri spremembah javnih strani, QR preverjanja ali API predogleda ohrani isti obseg profila in računaj gibanja minus odprte rezervacije; rezultat je le trenutni informativni posnetek, ne jamstvo unovčitve.