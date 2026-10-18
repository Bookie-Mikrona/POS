# Hramba zgodovine PDF izvozov

Zgodovina izvozov poročil je **začasna zbirka kopij**, ne trajni računovodski
arhiv. Privzeti rok je **365 dni od izvoza** (ne od datuma poročila).
Po preteku roka se trajno izbrišeta celoten vnos zgodovine in njegov PDF.
Knjižbe, računi, podjetja in izvorni podatki se ne spreminjajo.
Pomembne izvoze takoj shranite v svoj trajni arhiv: prostorska kvota lahko kopije
odstrani tudi pred iztekom časovne hrambe.

## Nastavitev za skrbnika

Strežniška okoljska spremenljivka `REPORT_EXPORT_RETENTION_DAYS` sprejme celo
število od 1 do 36500; če ni nastavljena, velja 365. Sprememba zahteva ponovni
zagon API-ja in velja za vsa podjetja ter tudi že obstoječe izvoze. Neveljavna
vrednost prepreči zagon, namesto da bi tiho izklopila čiščenje. Krajši rok lahko
ob naslednjem zagonu nepovratno odstrani starejše kopije; podaljšanje jih ne obnovi.
Dejanska nastavitev je prikazana v **Poročila → Zgodovina izvozov**.

### Prostorska kvota po podjetju

- `REPORT_EXPORT_QUOTA_MB`: celo število od 1 do 1000000; privzeto **500 MB
  za vsako podjetje posebej**, ne skupna omejitev vseh podjetij.
- `REPORT_EXPORT_QUOTA_MB_BY_COMPANY`: neobvezen JSON objekt UUID-jev podjetij
  in njihovih kvot v celih MB z enakim razponom, npr.
  `{"00000000-0000-4000-8000-000000000001":250}`.
  Za podjetja brez izrecne nastavitve velja `REPORT_EXPORT_QUOTA_MB`.

MB pomeni 1.000.000 bajtov. Štejejo dejanski bajti shranjenih PDF-jev, tudi
starejših kopij; ne metapodatki, varnostne kopije ali fizična velikost baze.
Neveljavna nastavitev prepreči zagon. Po spremembi ponovno zaženite API;
vse replike morajo uporabljati enako konfiguracijo.

Pri shranjevanju se pod transakcijskim zaklepom podjetja najprej odstranijo
časovno potekle kopije. Nato se odstrani najstarejši del zgodovine, dokler
nova kopija skupaj s preostalimi ne ustreza kvoti. Odstranjujejo se cele
kopije po času izvoza in pri enakem času po ID-ju. Nova kopija in brisanje se
potrdita skupaj; napaka zapisa povrne tudi brisanje. Zaklep serializira
preverjanje in shranjevanje tudi med različnimi procesi.

Posamezen PDF, **večji od celotne kvote**, se zavrne s HTTP 413, še preden se
pošlje po e-pošti ali spremeni zgodovina. Obstoječe kopije ostanejo
nedotaknjene. PDF, velik natanko toliko kot kvota, je dovoljen.

Znižana kvota in morebitni že obstoječi presežki se uveljavijo ob naslednjem
shranjevanju PDF-ja tega podjetja. Zavrnjen prevelik PDF ne sproži brisanja.
Kvota je prikazana poleg časovne politike tudi pri prazni zgodovini.
Zahtevek za izvoz ne more spreminjati kvote. Računovodski izvorni podatki
ostanejo nespremenjeni.

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
- Med zaustavljenim API-jem čiščenje ne teče. Časovno čiščenje in preverjanje
  prostorske kvote ob shranjevanju sta ločena mehanizma.
- PostgreSQL po brisanju prostor ponovno uporablja z običajnim autovacuumom;
  velikost datoteke na disku se ne zmanjša nujno takoj. Rutinski `VACUUM FULL`
  ni del opravila, ker bi zaklepal tabelo.
