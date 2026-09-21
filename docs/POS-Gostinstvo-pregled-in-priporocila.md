# POS Gostinstvo — pregled modula in priporočila

**Datum pregleda:** 6. september 2026  
**Obseg:** spletni POS, povezane POS API-poti, operativni tokovi, naprave, integracije in uporabniška dokumentacija

## Povzetek

POS Gostinstvo je že obsežen produkcijski sistem. Pokriva prijavo in poslovni kontekst, mize in rezervacije, naročanje, KDS, QR ter telefonska naročila, plačila in fiskalizacijo, zaloge, pripravljeno hrano, dogodke, izmene, poročila in povezavo z ERP.

Največje tveganje ni odsotnost osnovnih funkcij, temveč razdrobljeno okrevanje po nejasnem izidu plačila, fiskalizacije ali sinhronizacije, zaključevanje izmene brez enotnega kontrolnega toka ter zahtevna začetna nastavitev naprav in integracij. Pred novimi večjimi funkcijami je zato smiselno izboljšati zanesljivost, vidnost stanj in operativno obnovo.

## Kaj je že dobro narejeno

- Poslovni kontekst podjetja, enote in blagajne je ločen ter varovan z vlogami in zmožnostmi.
- Mize, rezervacije, neposredna prodaja in več naročil na isti mizi podpirajo realno gostinsko delo.
- Naročila se usmerjajo na kuhinjo, pico, točilnico in izdajo; podprti so modifikatorji in večhodni meniji.
- Plačilni tokovi vključujejo gotovino, kartice, mešana plačila, bone, napitnine, storno in vračila.
- FURS, EOR/ZOI, ponatis ter čakalna vrsta za offline fiskalizacijo imajo namensko logiko.
- Zaloge vključujejo WAC, začetna stanja, prejemnice, prenose, dogodke, pripravljeno hrano in ločeno evidenco ostankov s krožnikov.
- POS→ERP temeljnice, poročila, uporabniki, naprave in več integracij so že del istega sistema.
- Za finančno občutljive in več-enotne tokove obstajajo ciljni integracijski testi.

## Pregled po področjih

| Področje | Implementirano | Delno ali omejitev | Predlagana izboljšava |
|---|---|---|---|
| Prijava, podjetje, enota, blagajna in naprava | POS prijava, enote, poslovni prostori, blagajne, naprave ter hitra menjava enote in blagajne | Nastavitev je razpršena po administraciji; več vrst lokalnih mostov oteži uvedbo | Čarovnik prve nastavitve in pregled zdravja naprav z zadnjo uspešno povezavo |
| Izmene, osebje in gotovina | Izmene, obračun ur, uporabniki in blagajniški premiki | Predaja izmene in kontrola odprtih naročil nista združeni v en zaključni tok | Zaključek izmene s pričakovano/dejansko gotovino, odstopanjem in odobritvijo vodje |
| Tloris, mize in rezervacije | Prostori, mize, QR kode, rezervacije ter več naročil na isti mizi | Blokada zaradi rezervacije ni vedno dovolj razložena; ni polnega toka čakalne vrste/no-show | Jasno odštevanje, razlog blokade, dovoljena naslednja akcija ter čakalna vrsta |
| Telefonska naročila in dostava | Naročniki, CTI, prevzem, dostava in statusi dostave | Integracijski izpad ali nejasna identiteta zahtevata ročno presojo | Enoten pregled nepopolnih telefonskih naročil in dostav, ki zahtevajo ukrep |
| Meni, artikli, normativi in alergeni | Kategorije, artikli, normativi, dedovani alergeni, modifikatorji, pice, večhodni meniji, Happy Hour in slike | Spremembe normativa in alergenov potrebujejo še močnejšo vidnost različice in enote | Verzije in odobritve normativa ter jasna objava aktivne različice |
| Naročanje in KDS | Naročila, lokalni outbox, real-time sinhronizacija, kuhinja, pica, točilnica in izdaja | Izpad postaje ali nejasno sinhronizirano naročilo nimata enega operativnega centra | Recovery pogled za čaka/poslano/podvojeno/ročno rešeno in varna preusmeritev postaje |
| Plačila, računi, FURS in offline | Računi, terminali, gotovina, boni, storno, vračila, e-račun, FURS ter offline čakalna vrsta | Neznan izid terminala ali fiskalizacije je razpršen med več opozoril in pogledov | Enoten center za obnovo plačil, FURS in offline računov z varnim ponovnim poskusom |
| QR meni | Javni meni, QR administracija, QR mize in klic natakarja | Objava in povrnitev prejšnje različice menija nista uporabniku dovolj vidni | Predogled, eksplicitna objava, zgodovina in atomski rollback |
| Zaloge in dokumenti | Zaloge, kartice, začetna stanja, prejemnice, izdajnice, prenosi, dogodki in OCR | Delni neuspehi uvoza/prenosa in inventurne razlike potrebujejo jasnejši status | Revizijska inventura, prenos »v tranzitu« in ponovljiv uvoz brez dvojne knjižbe |
| Pripravljena hrana in odpad | Priprava porabi surovine; operativna zaloga je ločena; ostanki s krožnikov so ločena okoljska evidenca | Uporabnik mora dobro razumeti razliko med porabo, kalom in ostanki | Enoten vizualni povzetek učinka posamezne vrste evidence |
| Poročila, POS→ERP in administracija | Statistike, dnevni izkaz, realizacija, Z-poročilo, temeljnice, uporabniki, backup in izvozi | Poročila in zdravje integracij so razpršeni; revizijska sled ni povsod enako vidna | Konsolidiran pregled po enotah, integracijski health-check in pregled sprememb |

## Prednostni načrt

### P0 — preprečitev finančne ali operativne izgube

#### 1. Enoten center za obnovo plačil, FURS in offline računov

**Vpliv:** manj dvojnih plačil, izgubljenih računov in ročnega preverjanja.

**Dokazi v kodi:** `artifacts/api-server/src/routes/pos/racuni.ts`, `artifacts/api-server/src/routes/pos/terminal.ts`, `artifacts/api-server/src/lib/pos-payment-validation.ts`, `artifacts/api-server/src/services/pos/offline-fiscal-*`, `artifacts/pos/src/components/PaymentReliabilityPanels.tsx`.

**Kriteriji sprejema:**

- vsak nedoločen poskus ima jasno stanje in zapis;
- ponovni poskus je idempotenten in med izvajanjem onemogočen;
- FURS/offline napaka pokaže razlog, naslednji korak in končni rezultat;
- uspeh in neuspeh ostaneta v revizijski sledi.

#### 2. Zaključek izmene in uskladitev gotovine

**Vpliv:** prepreči tihi manjko ali presežek ter odprta naročila ob predaji.

**Dokazi v kodi:** `artifacts/api-server/src/routes/pos/izmene.ts`, `artifacts/api-server/src/routes/pos/blagajniski-premiki.ts`, `artifacts/pos/src/pages/Izmene.tsx`, `artifacts/pos/src/pages/BlagajniskiPremiki.tsx`.

**Kriteriji sprejema:**

- zaključek pokaže pričakovano in dejansko gotovino ter odstopanje;
- pred zaključkom opozori na odprta naročila in nejasna plačila;
- vodja lahko odstopanje potrdi z razlogom;
- predaja je sledljiva.

#### 3. Enotna kontrola podjetja, enote in zmožnosti na vseh mutacijah

**Vpliv:** prepreči dostop ali knjiženje v napačni enoti.

**Dokazi v kodi:** `artifacts/api-server/src/routes/pos/index.ts`, `artifacts/api-server/src/lib/unitCapabilityPolicy.ts`, `artifacts/api-server/src/lib/assertSameCompany.ts`.

**Kriteriji sprejema:**

- vsaka POS mutacija preveri podjetje, enoto in zahtevano zmožnost;
- negativni testi pokrijejo manjkajočo enoto, drugo podjetje in napačno zmožnost;
- zavrnjena zahteva ne spremeni podatkov.

### P1 — zanesljivost dela na lokaciji

#### 1. Vodena začetna nastavitev in zdravje naprav

Čarovnik naj vodi skozi podjetje → enoto → prostor → blagajno → napravo → FURS → meni. Test tiskanja ali terminala naj pokaže berljiv rezultat in čas zadnje uspešne povezave.

#### 2. KDS in outbox recovery

Ponovni prenos mora ostati idempotenten. Uporabnik mora jasno razlikovati med stanji čaka, poslano, podvojeno in zahteva ročno rešitev ter po potrebi varno preusmeriti naročilo na drugo postajo.

#### 3. Inventura in prenosi z revizijo

Inventura naj shrani začetno štetje, razliko, uporabnika in odobritev. Prenos naj ima razločna stanja pripravljeno, v tranzitu, prejeto in preklicano; delni neuspeh ne sme povzročiti dvojne knjižbe.

### P2 — preglednost in nadaljnja rast

1. **QR meni: predogled, objava, zgodovina in rollback.**
2. **Revizijska sled sprememb cen, normativov, dovoljenj in fiskalnih nastavitev.**
3. **Konsolidirana poročila ter pregled zdravja integracij po enotah.**
4. **Verzioniranje normativov in alergenskega profila.**
5. **Prilagodljiva mobilna navigacija glede na vlogo ali delovno postajo.**

## Priporočeno zaporedje izvedbe

1. Najprej združiti obnovo plačil, FURS in offline računov.
2. Nato urediti varen zaključek izmene in gotovinsko uskladitev.
3. Vzporedno preveriti enotni obseg podjetja/enote na vseh zapisovalnih poteh.
4. Dodati health-check naprav ter vodeno začetno nastavitev.
5. Izboljšati KDS/outbox in zalogovne prenose.
6. Šele nato širiti QR objave, revizijske preglede in konsolidirana poročila.

## Dokumentacija

Uporabniški priročnik je preurejen v neprekinjen tok od dostopa do zaključka dneva. Tehnična priporočila iz tega dokumenta niso vključena med uporabniške korake, da priročnik ne opisuje funkcij, ki še niso implementirane.