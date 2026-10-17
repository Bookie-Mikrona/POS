# Hramba zgodovine PDF izvozov

Zgodovina izvozov poročil je **začasna zbirka kopij**, ne trajni računovodski
arhiv. Privzeti rok je **365 dni od izvoza** (ne od datuma poročila).
Po preteku roka se trajno izbrišeta celoten vnos zgodovine in njegov PDF.
Knjižbe, računi, podjetja in izvorni podatki se ne spreminjajo.
Pomembne izvoze pred iztekom shranite v svoj trajni arhiv.

## Nastavitev za skrbnika

Strežniška okoljska spremenljivka `REPORT_EXPORT_RETENTION_DAYS` sprejme celo
število od 1 do 36500; če ni nastavljena, velja 365. Sprememba zahteva ponovni
zagon API-ja in velja za vsa podjetja ter tudi že obstoječe izvoze. Neveljavna
vrednost prepreči zagon, namesto da bi tiho izklopila čiščenje. Krajši rok lahko
ob naslednjem zagonu nepovratno odstrani starejše kopije; podaljšanje jih ne obnovi.
Dejanska nastavitev je prikazana v **Poročila → Zgodovina izvozov**.

## Izvedba in nadzor

- API izvede čiščenje ob zagonu in nato vsako uro, tudi brez novih izvozov.
  Ne potrebuje javnega cron endpointa ali zunanjega urnika.
- Vsak prehod briše največ 100 paketov po 100 zapisov, najstarejše najprej,
  iz vseh podjetij. Večji zaostanek se odstranjuje v naslednjih urah.
- Namenski PostgreSQL advisory lock prepreči hkratno čiščenje iz več replik;
  isti proces ne začne novega čiščenja, dokler prejšnje še teče.
- Izvozi na meji roka ostanejo; brišejo se samo strogo starejši.
  Zgodovina in ponovni prenos potečene izvoze takoj izključita, tudi če je API
  prej miroval ali fizično čiščenje še dohiteva zaostanek.
- Strukturirani API dnevniki izpišejo rok, mejo in število izbrisov.
  Napaka se zabeleži in se znova poskusi ob naslednjem urnem prehodu.
- Med zaustavljenim API-jem čiščenje ne teče. To ni omejitev v MB:
  podatki znotraj veljavnega roka se ne brišejo glede na velikost.
- PostgreSQL po brisanju prostor ponovno uporablja z običajnim autovacuumom;
  velikost datoteke na disku se ne zmanjša nujno takoj. Rutinski `VACUUM FULL`
  ni del opravila, ker bi zaklepal tabelo.
