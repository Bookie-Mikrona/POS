# Zasnova, prilagojena platformi Replit

Replit spremeni štiri stvari. Tri so arhitekturne, ena je past v
PostgreSQL, ki bi ustavila prvo migracijo.

---

## 1. Past, ki bi ustavila migracijo

Prvotna shema je vsebovala stavek, ki se **ne izvede**:

```sql
naziv_norm TEXT GENERATED ALWAYS AS
           (lower(unaccent(coalesce(naziv_dobavitelja,'')))) STORED
```

```
ERROR: generation expression is not immutable
```

`unaccent()` je označena `STABLE`, generirani stolpci in funkcionalni
indeksi pa zahtevajo `IMMUTABLE`. Enako pade indeks:

```
ERROR: functions in index expression must be marked IMMUTABLE
```

**Zakaj se napaka ne pokaže pri drugih funkcijah.** SQL funkcije se v
načrtovalniku vgradijo v izraz, zato se preveri šele njihova vsebina;
marsikatera `STABLE` funkcija tak preizkus prestane. `unaccent` je
pisana v C in se ne vgradi, zato ostane `STABLE`.

### Popravek ima dva dela, oba nujna

```sql
CREATE OR REPLACE FUNCTION public.f_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;
```

**Oznaka `IMMUTABLE`.** Načrtovalnik takih funkcij namerno ne vgradi,
kadar bi vgradnja razkrila spremenljivo vsebino — ravno to omogoča obvoz.

**Notranji klic imenovan s shemo.** Izrazi v indeksih se vrednotijo z
omejenim `search_path`. Brez `public.` indeks pade z:

```
ERROR: function unaccent(text) does not exist
```

kar je videti kot manjkajoča razširitev, čeprav je nameščena. Ta napaka
me je pri preizkusu zavedla in je vredna posebne pozornosti.

Oboje preverjeno na PostgreSQL 18.

---

## 2. Zajem prek IMAP ne more biti trajna povezava

Autoscale objava se ob mirovanju skrči na nič strežnikov. Proces, ki bi
držal povezavo IMAP IDLE, ne obstaja.

**Rešitev: Scheduled Deployment s povpraševanjem vsakih 10 minut.**
Utemeljitev in posledice so v `05-zajem-eposta.md`, razdelek 2.

---

## 3. Razvojna in produkcijska zbirka sta ločeni

Od decembra 2025 Replit gosti razvojno zbirko na lastni infrastrukturi;
objava aplikacije zahteva ločeno produkcijsko zbirko. Na voljo je le
`DATABASE_URL` — posameznih spremenljivk `PGHOST`, `PGUSER` in podobnih
na trenutni infrastrukturi ni.

**Migracije morajo teči dvakrat.** Ročno vnašanje SQL v urejevalnik
zbirke je pot v razhajanje shem. Uporabite orodje z oštevilčenimi
datotekami, ki beleži, katere so uveljavljene.

**Povrnitev na kontrolno točko Agenta je po prvi produkciji nevarna.**
Med razvojem je koristna. Pri tem modulu je resneje kot pri večini:
prejemnica ni le zapis, ampak sproži knjižbe v zalogo. Povrnitev zbirke
brez povrnitve knjižb pusti zalogo v stanju, ki ga ni mogoče uskladiti
drugače kot z inventuro. Dogovorite se, da se povrnitev uporablja
izključno na razvojni zbirki.

**Preizkusni podatki ne smejo v produkcijo.** Preslikava
`artikel_dobavitelj`, ustvarjena med testiranjem, se v produkciji tiho
uporabi za uparjanje in nihče ne ve, od kod je prišla.

---

## 4. Razširitve je treba preveriti

Tretja stopnja kaskade sloni na `pg_trgm`, normalizacija naziva na
`unaccent`. Replitova trenutna infrastruktura ni Neon, zato podpore ne
gre predpostaviti.

```sql
SELECT name, default_version, installed_version
  FROM pg_available_extensions
 WHERE name IN ('pg_trgm','unaccent','fuzzystrmatch','pgcrypto');
```

Migracija `0009` na koncu izpiše preverbo sama.

| Manjka | Nadomestilo | Kaj se izgubi |
|---|---|---|
| `unaccent` | `translate()` s seznamom šumnikov | nič — slovenski nabor je zaključen |
| `pg_trgm` | Jaccardov količnik nad besedami | odpornost na tipkarske napake znotraj besede |

Nadomestilo za `pg_trgm` je preizkušeno. Rezultati na resničnih parih:

```
1,0000   "Caj vrecka - Kamilica"       ~  "Čaj vrečka Kamilica"
0,6000   "Caj vrecka - Kamilica 20/1"  ~  "Čaj vrečka - Kamilica"
0,6000   "Pivo svetlo 0,5 l"           ~  "Pivo svetlo 0,33 l"
0,3333   "Kava zrna Espresso 1 kg"     ~  "Kavna zrna espresso"
```

Dvoje je pomembno. **Drugi in tretji par imata enako oceno** — pravilno
ujemanje s pripono pakiranja in napačno ujemanje z drugačno prostornino
sta po nazivu neločljiva. To ni pomanjkljivost nadomestila; trigrami
dajo enako sliko. Potrjuje pravilo, da samodejno uparjanje po nazivu
zahteva **tudi** ujemanje cene.

**Četrti par je zgrešen** — »Kava« proti »Kavna« je tipkarska napaka
znotraj besede, ki jo trigrami ujamejo, Jaccard pa ne. Brez `pg_trgm` bo
ta postavka šla v ročno uparjanje. Enkrat.

---

## 5. Hramba datotek

Datotečni sistem pri Autoscale objavi ni trajen. Naložena datoteka,
zapisana na disk, po ponovnem zagonu ni več tam.

Zato gre izvirnik v `uvoz_seja.vsebina` (BYTEA). To ni po naključju
pravilna odločitev — zbirka je edina trajna hramba, ki je zagotovo na
voljo.

| Vrsta | Velikost | Kam |
|---|---|---|
| XML, CSV, XLSX | 10 kB – 500 kB | BYTEA |
| PDF z besedilom | 100 kB – 2 MB | BYTEA |
| Skenirani PDF, fotografije | 2–20 MB | App Storage, ključ v zbirki |

Prag je pri 2 MB. Vsaka aplikacija ima 20 GB brezplačne hrambe — za XML
in CSV zadošča za leta, za skenirane dokumente ne.

---

## 6. Skrivnosti

| Kaj | Kje | Zakaj |
|---|---|---|
| `IMAP_ENC_KEY` | Replit Secrets | ključ za šifriranje gesel predalov |
| gesla predalov | zbirka, AES-256-GCM | odvisna od najemnika, ne morejo biti spremenljivke okolja |
| `DATABASE_URL` | že v okolju | ne podvajajte |

Izvedba je v `artifacts/api-server/src/lib/kripto.ts`. Sol pri izpeljavi
ključa je namerno fiksna: ključ mora biti izpeljan enako ob vsakem
zagonu, sicer obstoječih zapisov ni mogoče dešifrirati.

---

## 7. Dolga opravila

Dve opravili presegata trajanje zahtevka HTTP:

| Opravilo | Trajanje | Rešitev |
|---|---|---|
| Uvoz cenika (5.000+ vrstic) | minute | svežnji po 200, ali Scheduled |
| OCR skeniranega PDF | 10–60 s | ločeno opravilo, vrni ID seje takoj |
| Razčlenitev XML ali CSV | pod 1 s | znotraj zahtevka |

Vzorec brez čakalne vrste:

```
POST /uvoz/datoteka  → uvoz_seja (PREJETO), vrne 202 + id
Scheduled job        → pobere seje PREJETO, obdela, posodobi status
GET  /uvoz/seje/:id  → odjemalec povprašuje po napredku
```

Isti Scheduled Deployment opravi oboje: preveri predal in obdela
čakajoče seje.

---

## 8. Razporeditev objav

| Objava | Vrsta | Naloga |
|---|---|---|
| `pos-gostinstvo` | Autoscale | spletna aplikacija in API |
| `pos-opravila` | Scheduled, 10 min | zajem IMAP + čakajoče seje |
| `pos-nocno` | Scheduled, 1× dnevno | poročilo o odstopanjih, opomniki, čiščenje |

Tri objave namesto ene, ker Autoscale ne sme nositi opravil, ki tečejo
brez prometa.

Nočno opravilo naj preveri, kdaj je bil nazadnje uspešen zajem. Če je
minilo več kot dve uri, obvesti skrbnika.
