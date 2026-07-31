# Dnevnik napak in odločitev

Kaj se je med razvojem izkazalo za napačno in zakaj je koda zdaj taka,
kot je. Vsak vnos ima test, ki napako lovi.

Ta dokument obstaja zato, ker so spodnje napake take, ki se ob branju
kode ne vidijo — pokazale so se šele ob preizkusu.

---

## 1. Cena `5,476` se je prebrala kot `5476`

**Kje:** `parser-csv.ts`, funkcija `vDecimal`.
**Test:** `tests/01-csv.test.ts`

Prvotno pravilo: »tri števke za ločilom pomenijo tisočico«. Drži za
`1.500`, ne pa za vejico. Cene s tremi decimalkami so v tem sistemu
običajne — zaslon prejemnice kaže natanko `5,476` — zato bi pravilo
vsako tako ceno pomnožilo s tisoč.

**Zdaj:** pri vejici gre po slovenski konvenciji **vedno** za decimalno
ločilo. Dvoumnost ostane samo pri piki, kjer `1.500` ni ločljiv od
`1.500` v angleškem zapisu; tam odloči število števk in profil dobavitelja.

---

## 2. Zaznava ločila je bila napačna, test pa je uspel po naključju

**Kje:** `parser-csv.ts`, funkcija `zaznajLocilo`.
**Test:** `tests/02-locilo.test.ts`

Algoritem je ocenjeval povprečje pojavitev minus odklon. Na dobavnici z
uvodnimi vrsticami brez ločil je podpičje dobilo oceno −12, vejica −5,78
— izbrana bi bila vejica.

Napaka se je skrila, ker je bila začetna najboljša ocena `-1.0` in je
nobeden kandidat ni presegel; vrnila se je privzeta vrednost `';'`.
Pravilen rezultat iz napačnega razloga. Ob prevodu v TypeScript, kjer sem
začel z `-Infinity`, je algoritem izbral vejico in razčlenitev je vrnila
nič postavk.

**Zdaj:** ločilo določi **prevladujoče število polj**. Podatkovne vrstice
imajo enako število stolpcev, uvodne pa ne, zato prevlada pravo ločilo.

---

## 3. Brisanje praznih vrstic je tiho izpustilo prvo postavko

**Kje:** `parser-csv.ts`.
**Test:** `tests/01-csv.test.ts`, `tests/06-integracija-profil.test.ts`

Prazne vrstice so se odstranile **pred** indeksiranjem, kar je zamaknilo
vse fiksne odmike iz profila. Prva postavka je izginila brez sporočila.

Zanimivo je, da je napako ujela kontrola vsote `DOK004`: postavke so dale
91,61 namesto 97,09. Navzkrižna kontrola je odkrila napako, ki je
razčlenjevalnik sam ni prijavil.

**Zdaj:** vrstice se ne filtrirajo pred indeksiranjem, prazne se
preskočijo šele v zanki. Poleg tega se glava išče **po vsebini**
(`glavaVsebuje`), ne le po odmiku — dobavitelji radi dodajo uvodno
vrstico brez obvestila.

---

## 4. Kontrolna števka GTIN je razglašala veljavne kode za neveljavne

**Kje:** referenčna izvedba v Pythonu.
**Test:** `tests/01-csv.test.ts`

Utež je bila zamaknjena za eno mesto. Uteži se izmenjujeta 3, 1, 3, 1 …
od **prve** števke, ko je koda poravnana na 14 mest.

Različica v SQL je bila pravilna od začetka — napaka je bila samo v
referenčni kodi.

---

## 5. Pravilo `POS009` je bilo vsebinsko napačno

**Kje:** katalog validacij.
**Dokument:** `04-validacija-in-stanja.md`

Pravilo je preverjalo stopnjo DDV z dokumenta proti davčni kategoriji
artikla. To bi sprožalo lažna opozorila pri skoraj vsaki prejemnici.

Davčna kategorija določa **izstopni** DDV, in to glede na način strežbe.
Da je hladna pijača za s seboj obdavčena po nižji stopnji, pomeni, da
blago samo po sebi sodi v nižjo stopnjo; višja pri mizi izhaja iz
strežbe kot storitve. Kavna zrna se torej kupijo po nižji stopnji in
kava pri mizi proda po višji — oboje pravilno.

**Zdaj:** ločeno polje `artikli.nabavna_ddv_stopnja`, ki se napolni ob
prvem prevzemu iz dokumenta in od takrat služi kot kontrola. Pravili
`POS009a` in `POS009b`.

---

## 6. Generirani stolpec z `unaccent` se ne izvede

**Kje:** shema.
**Dokument:** `07-replit.md`, razdelek 1

`unaccent()` je `STABLE`, generirani stolpci in funkcionalni indeksi
zahtevajo `IMMUTABLE`. Migracija bi padla ob prvem zagonu.

Popravek ima dva dela: ovojnica označena `IMMUTABLE` in notranji klic
imenovan s shemo. Druga točka je zahrbtnejša — napaka se glasi
`function unaccent(text) does not exist`, kar je videti kot manjkajoča
razširitev, čeprav je nameščena.

---

## 7. `Cena/pak` je ustrezala ceni in pakiranju hkrati

**Kje:** `cenik.ts`, funkcija `ugibajStolpce`.
**Test:** `tests/05-cenik.test.ts`

Pri »prvi zadetek zmaga« je bila dodelitev odvisna od vrstnega reda
stolpcev v datoteki — pri enem dobavitelju pravilna, pri drugem tiho
napačna.

**Zdaj:** ocenjevalna dodelitev. Najprej se oceni vsak par stolpec–polje
z utežmi, nato se dodeli od najvišje ocene navzdol, pri čemer se stolpec
in polje porabita.

---

## 8. Naslovni zapis namesto stavčnega

**Kje:** `naziv.ts`, funkcija `popraviVelikeCrke`.
**Test:** `tests/07-naziv.test.ts`

Prva različica je delala »Pivo Svetlo Povratna«. Slovenska navada pri
nazivih izdelkov je stavčni zapis. Nato je ostala nedoslednost, kjer se
je `0,5L` zapisalo z malo, samostojni `L` pa ne.

**Zdaj:** vse z malo, velika samo prva črka. Enote se s tem zapišejo
pravilno po SI (`KG` → `kg`, `ML` → `ml`).

**Znani omejitvi**, obe dokumentirani s testom: blagovne znamke sredi
naziva se zapišejo z malo (»PIVO UNION« → »Pivo union«) in enako velja
za kratice (»MLEKO UHT« → »Mleko uht«). Izvirnik je pisan z velikimi
tiskanimi črkami, zato razlikovanja ni mogoče obnoviti. Polje v obrazcu
je urejljivo in predlog je le predlog.

---

## 9. »Skupaj 3 postavk«

**Kje:** `reklamacija.ts`.
**Test:** `tests/08-reklamacija.test.ts`

Slovenščina ima štiri oblike ob števniku, ne dveh. Prva različica je
poznala samo ednino in množino.

Pri sestavljenih števnikih, ki se končajo na 1–4 (21, 22, 103 …), nisem
uspel zanesljivo ugotoviti, ali ujemanje sledi zadnjemu členu ali ostane
rodilnik množine. Ker dokument prejme dobavitelj, sem se konstrukciji
**izognil** namesto da bi ugibal: povzetek zdaj piše »Skupno število
postavk: 12« in »št. postavk: 3« — stavka, ki ujemanja ne potrebujeta.

Funkcija `sklon` ostaja za vmesnik, kjer je število majhno in znano, z
izrecno opombo o omejitvi.

---

## 10. Cirilična črka v imenu spremenljivke

**Kje:** `uvoz-service.ts`.

V imenu `brezPrazninе` se je znašla cirilična `е` namesto latinične.
Koda bi se prevedla — vseh sedem pojavitev je bilo enakih — a bi
vsakogar, ki bi datoteko kasneje urejal, pripeljala do `is not defined`.

Preverjeno je celotno besedilo; drugih homoglifov v identifikatorjih ni.

---

## 11. Testna datoteka e-SLOG pravzaprav ni bila e-SLOG

**Kje:** `uvoz-service.ts`, funkcija `zaznajFormat`.
**Test:** `tests/04-format.test.ts`

Test je pokazal, da vzorčna datoteka nosi Peppolov `CustomizationID`.
Zaznava je delovala pravilno, napačno je bilo moje pričakovanje.

Razlikovanje sem vseeno predelal: prej je iskalo niz `eslog` kjerkoli v
dokumentu, zdaj bere `CustomizationID`. **Točnega niza za e-SLOG 2.0
nisem potrdil iz uradne specifikacije** in ga nisem izmislil — v kodi je
označeno z `⚠ PREVERI`. Napačna razvrstitev ne pokvari razčlenitve, ker
gredo e-SLOG, Peppol in UBL skozi isti razčlenjevalnik.

---

## 12. Zaznava kodiranja pri čistem ASCII

**Kje:** `parser-csv.ts`.
**Test:** `tests/06-integracija-profil.test.ts`

Vzorčna datoteka, zapisana v CP1250, se je zaznala kot UTF-8. To ni
napaka: datoteka nima šumnikov, zato je bajtno identična. Dekodiranje je
v obeh primerih enako.

Vredno je vedeti: **zaznava kodiranja deluje samo, kadar so prisotni
znaki zunaj ASCII.** Ločen test to potrjuje s šumniki.

---

## 13. Odločitve, ki niso posledica napake

**Vse poizvedbe v `uparjanje.ts` gredo prek `db.execute(sql\`…\`)`,** ne
prek gradnika poizvedb. Tretja stopnja potrebuje `similarity()` in
operator `%` iz `pg_trgm`, ki ju Drizzle ne pozna; mešanje pristopov bi
otežilo branje, uvoz sheme pa bi datoteko vezal na paket `lib/db` in
onemogočil samostojno preizkušanje.

**`naziv.ts` živi v `artifacts/web/`,** ker je njegov edini uporabnik
obrazec za nov artikel. Če ga kdaj potrebuje tudi zaledje, sodi v skupni
paket, ne v podvojitev.

**Privzeti tip novega artikla je `NABAVNI`,** ne `NABAVNO_PRODAJNI`.
Napačno nastavljen bi se artikel pojavil v meniju blagajne, kjer nima kaj
iskati, in bi ga natakar lahko po nesreči prodal.

**Osnovna enota se izpelje iz vsebine, ne iz enote na dobavnici.**
Dobavnica navaja `KOM` za steklenico piva 0,5 l; če v šifrant vpišete
`KOS`, normativ v decilitrih ne bo mogel razknjižiti.
