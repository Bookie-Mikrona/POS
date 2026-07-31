# Uvoz prejemnice / dobavnice dobavitelja — specifikacija

Modul: **Prevzem blaga (POS gostinstvo)**
Verzija: 1.0

---

## 1. Arhitektura: enotni cevovod

Vsi kanali uvoza se stekajo v isti kanonični model. Parser je edini del, ki pozna izvorni format.

```
ZAJEM  →  RAZČLENITEV  →  NORMALIZACIJA  →  UPARJANJE  →  VALIDACIJA  →  KNJIŽENJE
(kanal)    (parser)        (EM, cene, DDV)   (artikli)     (kontrole)     (zaloga + GK)
             ↓                                    ↓
        surovi zapis                        čakalna vrsta
        (nespremenjen)                      neuparjenih postavk
```

**Načelo:** izvorna datoteka se shrani nespremenjena (BYTEA ali objektno shrambo) skupaj s SHA-256 odtisom. Vsaka nadaljnja obdelava je ponovljiva iz izvirnika. To je nujno za revizijsko sled in za ponovno obdelavo po popravku pravil.

### Kanonični DTO

```json
{
  "vir": { "kanal": "EMAIL_IMAP", "format": "ESLOG_2_0", "datoteka_sha256": "..." },
  "dobavitelj": { "davcna": "SI12345678", "maticna": "1234567000", "gln": "3830000000000", "naziv": "..." },
  "dokument": {
    "vrsta": "DOBAVNICA",
    "stevilka": "DN-2026-004512",
    "datum_izdaje": "2026-07-28",
    "datum_dobave": "2026-07-29",
    "sklic_narocilnica": "NAR-2026-0088",
    "valuta": "EUR"
  },
  "postavke": [{
    "zap": 1,
    "gtin": "3838800000123",
    "sifra_dobavitelja": "ART-9912",
    "naziv": "Pivo svetlo 0,5 l povratna",
    "kolicina": 2, "enota": "KAR",
    "kolicina_osnovna": null,
    "cena_neto": 18.40, "rabat_odstotek": 5.0,
    "ddv_stopnja": 22.0,
    "trosarina": 0.44,
    "lot": "L2607", "rok_uporabe": "2027-01-15"
  }],
  "odvisni_stroski": [{ "vrsta": "PREVOZ", "znesek": 12.00 }],
  "povratna_embalaza": [{ "gtin": "...", "kolicina": 2, "kavcija": 3.00 }]
}
```

---

## 2. Kanali zajema (transport)

| # | Kanal | Opis | Prioriteta |
|---|-------|------|-----------|
| K1 | Ročni nalog datoteke | Drag & drop v POS/back-office | MVP |
| K2 | Nadzorovana mapa | Lokalna mapa / SFTP, polling ali inotify | MVP |
| K3 | Namenski e-poštni predal | IMAP IDLE, npr. `prevzem@gostilna.si`; priloge se avtomatsko zajamejo | MVP |
| K4 | Ponudniki e-poti | ZZI eBOX, Bizbox (Pošta Slovenije), Halcom, bančni kanali | Faza 2 |
| K5 | Peppol Access Point | AS4, obvezno relevanten zaradi ZIERDED (B2B od 1. 1. 2028) | Faza 2 |
| K6 | Dobaviteljev API | REST/SOAP pull ali webhook push (veletrgovci, pivovarne) | Faza 3 |
| K7 | Fotoaparat v POS aplikaciji | Zajem fizične dobavnice s telefonom/tablico | Faza 3 |
| K8 | Čitalnik črtne kode | GS1-128 / QR na dobavnici (ID dokumenta), nato pull po API | Faza 3 |
| K9 | Cloud disk | Sinhronizirana mapa (Drive, OneDrive) | Opcijsko |

**Idempotenca kanala:** vsak prejem dobi `uvoz_seja` zapis. Enak SHA-256 v istem tenantu → seja se označi kot `PODVOJENA` in se ne obdela.

---

## 3. Formati dokumentov (parserji)

### A. Strukturirani — polna avtomatika

| Format | Opomba |
|--------|--------|
| **e-SLOG 2.0 eDobavnica** | XML, GZS standard. Prvo priporočilo za domače dobavitelje. |
| **e-SLOG 2.0 eRačun** | V gostinstvu račun pogosto *je* prevzemni dokument. Podpri obe poti. |
| **e-SLOG 1.6.1** | Podpora zaradi starejših dobaviteljev; interni pretvornik 1.6.1 → 2.0. |
| **UBL 2.1 DespatchAdvice** | `<DespatchAdvice>` — mednarodni dobavitelji, Peppol. |
| **UBL 2.1 / Peppol BIS Billing 3.0 Invoice** | Skladno z EN 16931. |
| **UN/CEFACT CII (D16B)** | Druga sintaksa EN 16931 — obvezno podpri, ker ni izbirno pri čezmejnem prometu. |
| **EDIFACT EANCOM DESADV** | Klasična elektronska dobavnica veletrgovcev. |
| **EDIFACT EANCOM INVOIC / PRICAT** | Račun in cenik. PRICAT uporabi za vzdrževanje šifranta dobavitelja. |
| **GS1 XML 3.x** | Despatch Advice. |
| **Dobaviteljev JSON/XML** | Lastniške sheme — konfigurabilno preslikovanje (mapping profil). |

### B. Polstrukturirani — avtomatika s profilom po dobavitelju

| Format | Rešitev |
|--------|---------|
| **CSV / TXT** | Profil: ločilo, kodiranje (obvezno podpri CP1250 in UTF-8), decimalno ločilo (vejica!), vrstica z glavo, preslikava stolpcev. |
| **XLSX / XLS** | Isto + izbira lista, odmik glave, spajanje celic. |
| **Fiksna širina** | Definicija odmikov po polju. |
| **PDF z besedilno plastjo** | Ekstrakcija po predlogi (sidra + regije). Predloga je vezana na `dobavitelj_id` + prstni odtis postavitve. |

**Ključno:** profil se shrani in ponovno uporabi. Prvi uvoz od novega dobavitelja je polročen (uporabnik preslika stolpce), vsi naslednji so avtomatski.

### C. Nestrukturirani

| Format | Rešitev |
|--------|---------|
| **Skenirani PDF** | OCR (Tesseract slo+eng, ali storitev v oblaku) → LLM ekstrakcija v kanonični DTO → **obvezna človeška potrditev**. |
| **Fotografija** | Predobdelava (deskew, binarizacija, odstranitev perspektive) → isti tok. |

**Pravilo:** rezultat OCR/LLM nikoli ne gre neposredno v knjiženje. Vedno status `CAKA_NA_POTRDITEV`, z označeno stopnjo zaupanja po polju.

### D. Ročne poti

- **Prevzem po naročilnici** — obstoječa naročilnica se pretvori v prejemnico, uporabnik le popravi dejansko dobavljene količine. Najhitrejša pot, kadar naročanje teče skozi sistem.
- **Ročni vnos s čitalnikom EAN** — skeniraj, vpiši količino, naslednji.
- **Kopiranje prejšnje prejemnice** — pri ponavljajočih se dobavah (dnevni kruh, mleko).

---

## 4. Uparjanje artiklov (kritični del)

Kaskada, prva zadetka zmaga:

| Stopnja | Ključ | Zaupanje | Ravnanje |
|---------|-------|----------|----------|
| 1 | **GTIN/EAN-13** točno | 100 % | avtomatsko |
| 2 | **GTIN-14 / ITF-14** (trgovinsko pakiranje) → razreši na osnovni GTIN | 100 % | avtomatsko |
| 3 | `dobavitelj_id` + `sifra_dobavitelja` iz tabele preslikav | 100 % | avtomatsko |
| 4 | Interna šifra (dobavitelj uporablja našo) | 95 % | avtomatsko |
| 5 | **Trigram podobnost naziva** (`pg_trgm`, prag ≥ 0,75) | 60–85 % | predlog, potrdi uporabnik |
| 6 | LLM predlog iz konteksta (naziv + enota + cenovni razred) | nizko | predlog |
| 7 | Brez zadetka | — | čakalna vrsta / ustvari nov artikel |

**Učenje:** vsaka ročna potrditev zapiše trajno preslikavo v `artikel_dobavitelj`. Sistem se po nekaj prevzemih od istega dobavitelja praktično popolnoma avtomatizira.

```sql
CREATE TABLE artikel_dobavitelj (
    id                BIGSERIAL PRIMARY KEY,
    tenant_id         UUID NOT NULL,
    artikel_id        BIGINT NOT NULL REFERENCES artikel(id),
    dobavitelj_id     BIGINT NOT NULL REFERENCES partner(id),
    sifra_dobavitelja TEXT,
    gtin              TEXT,
    naziv_dobavitelja TEXT,
    enota_dobavitelja TEXT NOT NULL,
    faktor_pretvorbe  NUMERIC(18,6) NOT NULL DEFAULT 1,
    zadnja_nab_cena   NUMERIC(15,4),
    zadnji_prevzem    DATE,
    potrdil_uporabnik BIGINT,
    potrjeno_dne      TIMESTAMPTZ,
    CONSTRAINT uq_dob_sifra UNIQUE (tenant_id, dobavitelj_id, sifra_dobavitelja),
    CONSTRAINT uq_dob_gtin  UNIQUE (tenant_id, dobavitelj_id, gtin)
);
CREATE INDEX ix_ad_naziv_trgm ON artikel_dobavitelj
    USING gin (naziv_dobavitelja gin_trgm_ops);
```

---

## 5. Pretvorba enot mere

Najpogostejši vir napak v gostinstvu. Dobavitelj dobavi *karton*, kalkulacija in normativ delujeta v *litrih* ali *gramih*.

```
paleta → karton/gajba → prodajno pakiranje → osnovna enota (l, kg, kos)
```

- Osnovna enota se določi na artiklu in se **nikoli ne spreminja** po prvem prometu.
- `faktor_pretvorbe` je `NUMERIC`, nikoli `FLOAT`.
- Podpri **verižno pretvorbo**: 1 KAR = 24 KOS, 1 KOS = 0,5 L ⇒ 1 KAR = 12 L.
- **Artikli s spremenljivo težo** (meso, siri, ribe): dobavnica nosi tako število kosov kot dejansko maso. Prevzem gre po masi, cena je na kg. Predvidi polji `kolicina_kos` in `kolicina_masa` hkrati.
- Točeno pivo v sodih: sod 30 l / 50 l kot pakiranje, osnovna enota l, normativ v dl.

---

## 6. Cene, stroški in dajatve

Vrstni red izračuna nabavne vrednosti:

```
bruto cena
 − kaskadni rabati (r1, r2, …)          ← vsak od predhodne osnove
 = neto nabavna cena
 + trošarina (alkohol)
 + okoljska dajatev / embalažnina
 + razporejeni odvisni stroški nabave   ← prevoz, carina, manipulacija
 = nabavna vrednost artikla
```

- **Razporeditev odvisnih stroškov:** po vrednosti (privzeto), po masi ali po količini — nastavljivo.
- **Povratna embalaža** (gajbe, sodi, plinske jeklenke): vodi se ločeno kot kavcija, **ne** vstopa v nabavno vrednost blaga. Potrebna je evidenca stanja pri dobavitelju.
- **Vrednotenje zaloge:** priporočam drsečo povprečno ceno. FIFO je v gostinstvu redko upravičen (izjema: artikli z lotom in rokom uporabe, kjer FIFO ali FEFO nosi tudi sledljivost).
- **DDV:** stopnja se prevzame iz dokumenta, a se **validira** proti davčni skupini artikla v šifrantu. Odstopanje sproži opozorilo, ne tihe povozitve — pri hrani in pijači se stopnje razlikujejo in napaka se vleče v obračun.
- **Prevrednotenje:** ob spremembi nabavne cene ponudi preračun prodajnih cen po pribitku ali ciljni marži (kalkulacija).

---

## 7. Validacija in kontrole

| Kontrola | Ravnanje ob kršitvi |
|----------|--------------------|
| Podvojen dokument (dobavitelj + št. + datum) | blokada |
| Dobavitelj ni v šifrantu | ponudi vpis iz PRS/AJPES po davčni |
| Neuparjena postavka | dokument ostane v `CAKA_NA_UPARJANJE` |
| Odstopanje cene od zadnje nabavne > X % | opozorilo, zahteva potrditev |
| Odstopanje količine od naročilnice > toleranca | opozorilo |
| Vsota postavk ≠ glava dokumenta | blokada |
| Neznana enota mere | blokada |
| Rok uporabe že potekel / krajši od praga | opozorilo |
| Negativna zaloga po knjiženju | opozorilo |

**Trismerno usklajevanje (3-way match):** naročilnica ↔ prejemnica ↔ prejeti račun. Odstopanja se zberejo v poročilu za reklamacijo pri dobavitelju. To je največji finančni prihranek celotnega modula.

---

## 8. Podatkovni model (izsek)

```sql
CREATE TYPE prejem_status AS ENUM (
    'OSNUTEK','V_OBDELAVI','CAKA_NA_UPARJANJE','CAKA_NA_POTRDITEV',
    'POTRJENA','KNJIZENA','ZAVRNJENA','STORNIRANA'
);

CREATE TABLE uvoz_seja (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    kanal           TEXT NOT NULL,
    format          TEXT,
    ime_datoteke    TEXT,
    sha256          BYTEA NOT NULL,
    vsebina         BYTEA,
    prejeto         TIMESTAMPTZ NOT NULL DEFAULT now(),
    status          TEXT NOT NULL,
    napake          JSONB,
    CONSTRAINT uq_seja_hash UNIQUE (tenant_id, sha256)
);

CREATE TABLE prejem (
    id                BIGSERIAL PRIMARY KEY,
    tenant_id         UUID NOT NULL,
    poslovalnica_id   BIGINT NOT NULL,
    uvoz_seja_id      UUID REFERENCES uvoz_seja(id),
    dobavitelj_id     BIGINT NOT NULL REFERENCES partner(id),
    st_dokumenta      TEXT NOT NULL,
    datum_dokumenta   DATE NOT NULL,
    datum_prejema     DATE NOT NULL,
    narocilnica_id    BIGINT,
    prejeti_racun_id  BIGINT,
    valuta            CHAR(3) NOT NULL DEFAULT 'EUR',
    tecaj             NUMERIC(15,6) DEFAULT 1,
    status            prejem_status NOT NULL DEFAULT 'OSNUTEK',
    temeljnica_id     BIGINT,
    CONSTRAINT uq_prejem UNIQUE (tenant_id, dobavitelj_id, st_dokumenta, datum_dokumenta)
);

CREATE TABLE prejem_postavka (
    id                  BIGSERIAL PRIMARY KEY,
    prejem_id           BIGINT NOT NULL REFERENCES prejem(id) ON DELETE CASCADE,
    zap_st              INT NOT NULL,
    -- izvorni podatki, nespremenjeni
    izv_gtin            TEXT,
    izv_sifra           TEXT,
    izv_naziv           TEXT,
    izv_enota           TEXT,
    izv_kolicina        NUMERIC(18,6),
    -- razrešeni podatki
    artikel_id          BIGINT REFERENCES artikel(id),
    uparjanje_metoda    TEXT,
    uparjanje_zaupanje  NUMERIC(5,2),
    kolicina_osnovna    NUMERIC(18,6),
    cena_neto           NUMERIC(15,4),
    rabat_odstotek      NUMERIC(7,4),
    odvisni_stroski     NUMERIC(15,4) DEFAULT 0,
    trosarina           NUMERIC(15,4) DEFAULT 0,
    nabavna_vrednost    NUMERIC(15,4),
    ddv_stopnja         NUMERIC(5,2),
    lot                 TEXT,
    rok_uporabe         DATE
);
```

Ob knjiženju se generirata dogodka `PrejemKnjizen` in `ZalogaPovecana`, ki napolnita `zaloga_promet` in temeljnico (razred 3 / 6 v breme, 22 s ustrezno obveznostjo za DDV) — skladno z obstoječo event-sourcing potjo v sistemu.

---

## 9. Povezava z normativi

V gostinstvu prevzem povečuje zalogo **surovin**, ne prodajnih artiklov. Razknjiževanje teče prek normativa (recepture) ob prodaji na blagajni:

```
prejemnica → zaloga surovin → normativ jedi/pijače → prodaja POS → razknjižba surovin
```

Zato je pri uvozu obvezno, da se surovina uparja na artikel z osnovno enoto, ki je združljiva z enoto v normativu (dl, g, ml, kos). Nedoslednost tu se pokaže šele pri inventuri kot nepojasnjen manko.

Predvidi tudi **kalo** (normirani in izredni odpis) ločeno od porabe po normativu, sicer razlike ni mogoče analizirati.

---

## 10. API

```
POST   /api/v1/prejemi/uvoz                multipart, vrne uvoz_seja_id
GET    /api/v1/uvoz/seje/{id}              status + napake
POST   /api/v1/uvoz/seje/{id}/ponovi       ponovna obdelava iz izvirnika
GET    /api/v1/prejemi/{id}
GET    /api/v1/prejemi/{id}/neuparjeno
POST   /api/v1/prejemi/{id}/uparjanje      [{postavka_id, artikel_id, zapomni:true}]
POST   /api/v1/prejemi/{id}/potrdi
POST   /api/v1/prejemi/{id}/knjizi         idempotentno, Idempotency-Key
POST   /api/v1/prejemi/{id}/storno
GET    /api/v1/dobavitelji/{id}/profil-uvoza
PUT    /api/v1/dobavitelji/{id}/profil-uvoza
```

---

## 11. Predlagan vrstni red izvedbe

| Faza | Obseg | Pokritost prometa |
|------|-------|-------------------|
| 1 | Ročni nalog + CSV/XLSX s profilom + kaskada uparjanja + pretvorba EM + knjiženje | ~60 % |
| 2 | e-SLOG 2.0 (eDobavnica + eRačun), IMAP predal, prevzem po naročilnici | ~85 % |
| 3 | UBL/CII, Peppol AP, EDIFACT DESADV/INVOIC, PRICAT za cenike | ~95 % |
| 4 | PDF predloge, OCR + LLM ekstrakcija, mobilni zajem | ostalo |

Faza 3 je hkrati priprava na obveznost B2B e-računov po ZIERDED — arhitektura kanonizacije in Peppol točke se pokrije z istim delom.

---

## 12. Odprta vprašanja za odločitev

1. Ali prevzem sproži tudi avtomatsko kalkulacijo prodajnih cen ali le predlog?
2. Vrednotenje: drseča povprečna cena za vse, ali FEFO za artikle z rokom uporabe?
3. Ali se prejemnica lahko knjiži pred prejetim računom (običajno da, z uskladitvijo naknadno)?
4. Kdo sme potrditi odstopanje cene nad pragom — ločena pravica?
5. Ravnanje pri delni dobavi: nova prejemnica na isto naročilnico ali zaprtje razlike?
