# Preslikave vhodnih formatov v kanonični DTO

Vsak parser vrne isti `PrejemDTO`. Nič drugega v sistemu ne ve, iz katerega formata je dokument prišel.

---

## 0. Prepoznava formata (avtodetekcija)

Vrstni red preverjanja — prvi zadetek zmaga:

| Korak | Test | Rezultat |
|-------|------|----------|
| 1 | Prvi bajti `50 4B 03 04` (ZIP) | odpri; če vsebuje `[Content_Types].xml` → **XLSX**, sicer išči XML v ovojnici (e-SLOG ZIP, ASiC-E) |
| 2 | Prvi bajti `25 50 44 46` (`%PDF`) | preveri besedilno plast: `pdftotext` vrne > 100 znakov → **PDF_PREDLOGA**, sicer **PDF_OCR** |
| 3 | XML deklaracija | glej korenski element (tabela spodaj) |
| 4 | Začne se z `UNA` ali `UNB` | **EDIFACT** — vrsta iz `UNH` segmenta (`DESADV`, `INVOIC`, `PRICAT`) |
| 5 | JSON | preveri proti registriranim shemam dobaviteljev |
| 6 | Besedilo z ločili | **CSV** — ugotovi ločilo po frekvenci `;` `,` `\t` `\|` v prvih 10 vrsticah |
| 7 | Sicer | **PDF_OCR** / **SLIKA_OCR** po MIME |

### Korenski elementi XML

| Korenski element / namespace | Format |
|---|---|
| `eSLOG:DespatchAdvice` / `<Dobavnica>` z NS `http://www.gzs.si/eslog/2.00` | `ESLOG_2_0_DOBAVNICA` |
| `<Racun>` / `Invoice` z NS eSLOG 2.00 | `ESLOG_2_0_RACUN` |
| `<Racun>` z NS `http://www.gzs.si/e-poslovanje/sheme/eSLOG_1-6.xsd` | `ESLOG_1_6_1` |
| `<DespatchAdvice>` NS `urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2` | `UBL_2_1_DESPATCH` |
| `<Invoice>` NS `...:Invoice-2` | `UBL_2_1_INVOICE` |
| `<CrossIndustryInvoice>` NS `urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100` | `CII_D16B` |
| `<despatchAdvice>` NS `urn:gs1:ecom:despatch_advice:xsd:3` | `GS1_XML` |

**Opozorilo:** e-SLOG 2.0 je v jedru profil UBL 2.1 z dodanimi slovenskimi razširitvami. Če napišeš dober UBL parser, je e-SLOG 2.0 parser tanka plast nad njim. To izkoristi — ne piši dveh neodvisnih parserjev.

---

## 1. e-SLOG 2.0 — eDobavnica

Osnova: UBL 2.1 `DespatchAdvice`. Slovenske razširitve v `UBLExtensions`.

### Glava

| DTO polje | XPath |
|---|---|
| `dokument.stevilka` | `/DespatchAdvice/cbc:ID` |
| `dokument.datum_izdaje` | `/DespatchAdvice/cbc:IssueDate` |
| `dokument.datum_dobave` | `/DespatchAdvice/cac:Shipment/cac:Delivery/cac:RequestedDeliveryPeriod/cbc:StartDate` |
| `dokument.sklic_narocilnica` | `/DespatchAdvice/cac:OrderReference/cbc:ID` |
| `dobavitelj.gln` | `/DespatchAdvice/cac:DespatchSupplierParty/cac:Party/cbc:EndpointID[@schemeID='0088']` |
| `dobavitelj.davcna` | `.../cac:PartyTaxScheme/cbc:CompanyID` |
| `dobavitelj.maticna` | `.../cac:PartyLegalEntity/cbc:CompanyID` |
| `dobavitelj.naziv` | `.../cac:PartyName/cbc:Name` |
| `prejemnik.gln` | `/DespatchAdvice/cac:DeliveryCustomerParty/cac:Party/cbc:EndpointID` |
| `prevoz.sscc` | `/DespatchAdvice/cac:Shipment/cac:TransportHandlingUnit/cbc:ID` |

### Postavke — `/DespatchAdvice/cac:DespatchLine`

| DTO polje | XPath (relativno na `DespatchLine`) |
|---|---|
| `zap` | `cbc:ID` |
| `kolicina` | `cbc:DeliveredQuantity` |
| `enota` | `cbc:DeliveredQuantity/@unitCode` (UN/ECE Rec 20) |
| `kolicina_narocena` | `cbc:OutstandingQuantity` |
| `gtin` | `cac:Item/cac:StandardItemIdentification/cbc:ID[@schemeID='0160']` |
| `sifra_dobavitelja` | `cac:Item/cac:SellersItemIdentification/cbc:ID` |
| `sifra_kupca` | `cac:Item/cac:BuyersItemIdentification/cbc:ID` |
| `naziv` | `cac:Item/cbc:Name` |
| `opis` | `cac:Item/cbc:Description` |
| `lot` | `cac:Item/cac:ItemInstance/cac:LotIdentification/cbc:LotNumberID` |
| `rok_uporabe` | `cac:Item/cac:ItemInstance/cbc:BestBeforeDate` |
| `sklic_narocilnica_post` | `cac:OrderLineReference/cbc:LineID` |

**Pomembno:** eDobavnica praviloma **nima cen**. Cene se prevzamejo iz naročilnice, iz cenika (`artikel_dobavitelj.zadnja_nab_cena`) ali kasneje iz prejetega računa. To je normalno stanje — prejemnica se lahko knjiži količinsko in vrednostno uskladi ob prejemu računa. Predvidi status `KNJIZENA_KOLICINSKO`, če se odločiš za to pot.

---

## 2. e-SLOG 2.0 — eRačun

V gostinstvu je najpogostejši scenarij: dobavitelj pošlje **samo račun**, ki hkrati služi kot dobavnica.

### Glava

| DTO polje | XPath |
|---|---|
| `dokument.stevilka` | `/Invoice/cbc:ID` |
| `dokument.datum_izdaje` | `/Invoice/cbc:IssueDate` |
| `dokument.vrsta_koda` | `/Invoice/cbc:InvoiceTypeCode` (UNCL1001: `380`=račun, `381`=dobropis, `383`=bremepis) |
| `dokument.valuta` | `/Invoice/cbc:DocumentCurrencyCode` |
| `dokument.rok_placila` | `/Invoice/cac:PaymentMeans/cbc:PaymentDueDate` |
| `dokument.sklic_placila` | `/Invoice/cac:PaymentMeans/cac:PaymentMandate/cbc:ID` (SI00 sklic) |
| `dokument.iban` | `/Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID` |
| `dobavitelj.davcna` | `/Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID` |
| `vsote.osnova` | `/Invoice/cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount` |
| `vsote.ddv` | `/Invoice/cac:TaxTotal/cbc:TaxAmount` |
| `vsote.skupaj` | `/Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount` |
| `vsote.za_placilo` | `/Invoice/cac:LegalMonetaryTotal/cbc:PayableAmount` |
| `odvisni_stroski[]` | `/Invoice/cac:AllowanceCharge[cbc:ChargeIndicator='true']` |
| `rabati_glave[]` | `/Invoice/cac:AllowanceCharge[cbc:ChargeIndicator='false']` |

### Postavke — `/Invoice/cac:InvoiceLine`

| DTO polje | XPath |
|---|---|
| `kolicina` | `cbc:InvoicedQuantity` |
| `enota` | `cbc:InvoicedQuantity/@unitCode` |
| `vrednost_neto` | `cbc:LineExtensionAmount` |
| `cena_neto` | `cac:Price/cbc:PriceAmount` |
| `cena_osnova_kol` | `cac:Price/cbc:BaseQuantity` ← **pogosta napaka**: cena je lahko za 100 kos |
| `cena_bruto` | `cac:Price/cac:AllowanceCharge/cbc:BaseAmount` |
| `rabat_znesek` | `cac:Price/cac:AllowanceCharge/cbc:Amount` |
| `ddv_stopnja` | `cac:Item/cac:ClassifiedTaxCategory/cbc:Percent` |
| `ddv_kategorija` | `cac:Item/cac:ClassifiedTaxCategory/cbc:ID` (UNCL5305: `S`, `Z`, `E`, `AE`, `K`, `G`, `O`) |
| `gtin` | `cac:Item/cac:StandardItemIdentification/cbc:ID` |

**Kritični izračun:**
```
efektivna_cena_na_enoto = cac:Price/cbc:PriceAmount / (cac:Price/cbc:BaseQuantity ?? 1)
```
Če to izpustiš, dobiš pri dobaviteljih, ki kotirajo ceno na 100 ali 1000 enot, stokratno napako v nabavni ceni. Vgradi kontrolo: `|kolicina × efektivna_cena − LineExtensionAmount| ≤ 0,02` na postavko.

### Kategorije DDV (UNCL5305) → interna davčna skupina

| Koda | Pomen | Ravnanje |
|---|---|---|
| `S` | standardna stopnja | vzemi `Percent` (22 / 9,5 / 5) |
| `Z` | ničelna stopnja | 0 %, odbitek da |
| `E` | oproščeno | 0 %, brez pravice do odbitka → preveri člen |
| `AE` | obrnjena davčna obveznost | samoobdavčitev, obračunaj DDV na obeh straneh |
| `K` | dobava znotraj EU | pridobitev blaga — samoobdavčitev |
| `G` | izvoz | 0 % |
| `O` | zunaj sistema DDV | 0 % |

Kode `AE` in `K` sprožita **ločeno knjiženje samoobdavčitve** in vpis v KIR ter KPR. Ne obravnavaj ju kot 0 % in pozabi — to je najpogostejša napaka pri uvozu tujih računov.

---

## 3. e-SLOG 1.6.1 (starejši dobavitelji)

Struktura je EDIFACT-podobna, drugačna od 2.0. Napiši **pretvornik 1.6.1 → 2.0** (XSLT), ne drugega parserja.

| DTO polje | XPath |
|---|---|
| `dokument.stevilka` | `//Racun/RacunGlava/RacunSt/StevilkaDokumenta` |
| `dokument.datum_izdaje` | `//DatumiRacuna[VrstaDatuma='137']/DatumRacuna` |
| `dobavitelj.davcna` | `//PartnerRacuna[VrstaPartnerja='SE']//NaslovPartnerja/../DavcnaStevilka` |
| postavke | `//RacunPostavka` |
| `kolicina` | `PostavkaKolicina[VrstaKolicine='47']/Kolicina` |
| `cena` | `PostavkaCena[VrstaCene='AAA']/Cena` |
| `vrednost` | `PostavkaZnesek[VrstaZneska='203']/Znesek` |

Kvalifikatorji (`137`, `47`, `AAA`, `203`) so kode UNCL in EDIFACT ter so
zanesljivi. Zbrani so v `parser-eslog161.ts` kot izvožene konstante
`DATUM`, `KOLICINA`, `CENA`, `ZNESEK`, `ODSTOTEK`, `PARTNER` in jih bo
mogoče ponovno uporabiti pri razčlenjevalniku EDIFACT.

**⚠ Imena XML elementov niso potrjena iz uradne specifikacije.** Zbrana
so v tabeli `POTI` na vrhu datoteke; ob prvem resničnem dokumentu se
popravijo tam in nikjer drugje. Funkcija `izpisiZgradbo()` izpiše dejansko
drevo elementov, da popravek ni ugibanje.

---

## 4. UBL 2.1 in Peppol BIS Billing 3.0

Identično kot e-SLOG 2.0, ker je e-SLOG 2.0 njegov profil. Razlike:

- `cbc:CustomizationID` = `urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0`
- `cbc:ProfileID` = `urn:fdc:peppol.eu:2017:poacc:billing:01:1.0`
- Naslovi po Peppol Participant ID (shemeID `0088` = GLN, `9944` = SI DDV ID)

Isti parser, drugačna validacija (Schematron: PEPPOL-EN16931-UBL + EN16931-UBL-model).

---

## 5. UN/CEFACT CII (D16B) — druga sintaksa EN 16931

Nujna, ker je pri čezmejnem prometu enakovredna UBL in je nekateri tuji dobavitelji uporabljajo izključno.

| DTO polje | XPath |
|---|---|
| `dokument.stevilka` | `//rsm:ExchangedDocument/ram:ID` |
| `dokument.datum_izdaje` | `//rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString` (format `102` = YYYYMMDD) |
| `dobavitelj.davcna` | `//ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID='VA']` |
| postavke | `//ram:IncludedSupplyChainTradeLineItem` |
| `gtin` | `ram:SpecifiedTradeProduct/ram:GlobalID[@schemeID='0160']` |
| `sifra_dobavitelja` | `ram:SpecifiedTradeProduct/ram:SellerAssignedID` |
| `naziv` | `ram:SpecifiedTradeProduct/ram:Name` |
| `cena_neto` | `ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount` |
| `cena_osnova_kol` | `.../ram:NetPriceProductTradePrice/ram:BasisQuantity` |
| `kolicina` | `ram:SpecifiedLineTradeDelivery/ram:BilledQuantity` |
| `enota` | `ram:BilledQuantity/@unitCode` |
| `ddv_stopnja` | `ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:RateApplicablePercent` |
| `vrednost_neto` | `.../ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount` |

**Past:** datumi so v obliki `20260728` s kvalifikatorjem `format="102"`. Obstajata še `610` (YYYYMM) in `616` (YYYYWW). Preveri atribut, ne predpostavljaj.

---

## 6. EDIFACT EANCOM

### DESADV (dobavnica) — struktura

```
UNB+UNOC:3+3830001234567:14+3830009876543:14+260728:1030+00001'
UNH+1+DESADV:D:96A:UN:EAN005'
BGM+351+DN-2026-004512+9'          ← 351 = dobavnica, 9 = original
DTM+137:20260728:102'              ← datum dokumenta
DTM+11:20260729:102'               ← datum odpreme
RFF+ON:NAR-2026-0088'              ← sklic na naročilnico
NAD+SU+3830001234567::9'           ← dobavitelj (GLN)
NAD+BY+3830009876543::9'           ← kupec
CPS+1'
PAC+2++CT'                         ← 2 kartona
PCI+33E'
GIN+BJ+300123456789012345'         ← SSCC
LIN+1++3838800000123:SRV'          ← GTIN postavke
PIA+1+ART-9912:SA'                 ← šifra dobavitelja
IMD+F++:::Pivo svetlo 0,5 l'
QTY+12:48:PCE'                     ← 12 = dobavljena količina, 48 kos
DTM+361:20270115:102'              ← rok uporabe
UNT+18+1'
UNZ+1+00001'
```

### Ključni kvalifikatorji

| Segment | Kvalifikator | Pomen |
|---|---|---|
| `BGM` | `351` | dobavnica |
| `BGM` | `380` / `381` / `383` | račun / dobropis / bremepis |
| `DTM` | `137` | datum dokumenta |
| `DTM` | `11` | datum odpreme |
| `DTM` | `35` | datum dobave |
| `DTM` | `361` | rok uporabe |
| `RFF` | `ON` | sklic na naročilnico |
| `RFF` | `DQ` | sklic na dobavnico (v INVOIC) |
| `NAD` | `SU` / `BY` / `DP` | dobavitelj / kupec / mesto dostave |
| `LIN` | `SRV` (comp. 3) | GTIN |
| `PIA` | `SA` / `IN` | šifra dobavitelja / šifra kupca |
| `QTY` | `12` | dobavljena količina |
| `QTY` | `21` | naročena količina |
| `QTY` | `47` | zaračunana količina (INVOIC) |
| `PRI` | `AAA` | neto cena |
| `PRI` | `AAB` | bruto cena |
| `MOA` | `203` | vrednost postavke |
| `MOA` | `79` | skupaj brez DDV |
| `MOA` | `124` | znesek DDV |
| `ALC` | `A` / `C` | rabat / dodatni strošek |
| `TAX` | `7` + `VAT` | DDV, stopnja v `PCD` |

### Ločila
Privzeta: segment `'`, podatek `+`, komponenta `:`, ubežni znak `?`. **Vedno preberi iz `UNA` segmenta, če je prisoten** — nekateri dobavitelji uporabljajo drugačna.

### PRICAT — cenik
Ne ustvarja prejemnice. Uporabi za polnjenje `artikel_dobavitelj` in za predhodno uparjanje: cenik uvoziš enkrat, nato so vse naslednje dobavnice uparjene 100 % avtomatsko. **To je najhitrejša pot do avtomatizacije pri veletrgovcih.**

---

## 7. CSV / XLSX — profil po dobavitelju

### Shema konfiguracije (`uvoz_profil.konfiguracija`)

```json
{
  "kodiranje": "cp1250",
  "locilo": ";",
  "decimalno_locilo": ",",
  "tisocice": ".",
  "format_datuma": "dd.MM.yyyy",
  "vrstica_glave": 1,
  "prva_vrstica_podatkov": 2,
  "list": "Dobavnica",
  "preskoci_vrstice_kjer": { "stolpec": "A", "prazno": true },
  "glava_dokumenta": {
    "st_dokumenta": { "vir": "CELICA", "naslov": "B2" },
    "datum": { "vir": "CELICA", "naslov": "B3" },
    "st_dokumenta_alt": { "vir": "IME_DATOTEKE", "regex": "DN-(\\d+)" }
  },
  "stolpci": {
    "gtin":        { "indeks": 0 },
    "sifra":       { "indeks": 1 },
    "naziv":       { "indeks": 2 },
    "kolicina":    { "indeks": 3 },
    "enota":       { "indeks": 4, "preslikava": { "kom": "KOS", "kart": "KAR" } },
    "cena":        { "indeks": 5 },
    "rabat_odst":  { "indeks": 6, "privzeto": 0 },
    "ddv":         { "indeks": 7, "privzeto": null },
    "rok_uporabe": { "indeks": 8, "opcijsko": true }
  },
  "vrstica_vsote": { "prepoznaj_po": { "stolpec": 2, "vsebuje": "SKUPAJ" }, "preskoci": true }
}
```

### Prepoznava profila (`uvoz_profil.prepoznava`)

```json
{
  "ime_datoteke_regex": "^DOB_\\d{6}\\.csv$",
  "glava_vsebuje": ["Šifra artikla", "Količina", "Cena"],
  "sha_prve_vrstice": "a3f9...",
  "eposta_posiljatelj": "racuni@dobavitelj.si"
}
```

### Praktične pasti
- **Kodiranje:** slovenski dobavitelji še vedno pošiljajo CP1250. Zaznaj po prisotnosti bajtov `0x9A 0x9E 0x8A 0x8E` (š ž Š Ž) → CP1250; sicer poskusi UTF-8 z BOM, nato brez.
- **Decimalna vejica:** `1.234,56` proti `1,234.56`. Odloči po zadnjem ločilu v številu.
- **Excel datumi:** serijska številka od 30. 12. 1899, ne 1. 1. 1900 (Lotus 1-2-3 napaka s prestopnim letom 1900).
- **Vodilne ničle v GTIN:** Excel jih poje. Beri celico kot besedilo, ne kot število. Če dobiš `3838800000123` kot `3.8388E+12`, je profil napačen.
- **Vrstice z vsotami** sredi datoteke pri poddobavnicah.

---

## 8. PDF s predlogo

Predloga je vezana na `dobavitelj_id` + prstni odtis postavitve (razmerje strani + pozicije fiksnih besedil).

```json
{
  "sidra": [
    { "ime": "st_dokumenta", "iskalni_niz": "Dobavnica št.",
      "regija": { "dx": 80, "dy": -2, "sirina": 120, "visina": 14 },
      "regex": "([A-Z0-9\\-/]+)" },
    { "ime": "datum", "iskalni_niz": "Datum:", "regija": { "dx": 50, "dy": -2, "sirina": 90, "visina": 14 } }
  ],
  "tabela": {
    "zacetek_po": "Naziv artikla",
    "konec_pred": "SKUPAJ",
    "meje_stolpcev": [40, 100, 320, 380, 440, 500, 560],
    "stolpci": ["sifra", "gtin", "naziv", "kolicina", "enota", "cena", "vrednost"],
    "vec_strani": true,
    "ponovi_glavo": true
  }
}
```

Uporabi ekstrakcijo z besednimi koordinatami (`pdfplumber`, `PDFBox`), ne surovega `pdftotext` — zaporedje besedila v PDF ne ustreza vizualnemu zaporedju.

---

## 9. OCR + LLM ekstrakcija

Zadnja pot, kadar ni ničesar boljšega.

```
slika/skeniran PDF
  → predobdelava (deskew, odstranitev perspektive, binarizacija, 300 dpi)
  → OCR (Tesseract slo+eng, ali storitev v oblaku)
  → LLM: besedilo + shema kanoničnega DTO → strukturiran JSON
  → validacija sheme + preverjanje vsot
  → status CAKA_NA_POTRDITEV (vedno)
```

### Poziv za LJM (skica)

```
Iz spodnjega besedila dobavnice izlušči podatke v JSON po podani shemi.
Pravila:
- Če podatka ni, uporabi null. Nikoli ne ugibaj.
- Količine in cene vrni kot števila z decimalno piko.
- Datumi v ISO 8601.
- Za vsako polje vrni tudi zaupanje 0..1 v polju _zaupanje.
- Vsota postavk se mora ujemati z navedeno skupno vrednostjo; če se ne,
  postavi napaka_vsote: true in ne popravljaj števil.
Vrni izključno JSON, brez pojasnil in brez oznak za blok kode.
```

### Obvezne kontrole nad rezultatom
1. `Σ(kolicina × cena) − izv_skupaj| ≤ 0,05` → sicer označi celoten dokument kot nezanesljiv.
2. Davčna številka mora obstajati v šifrantu partnerjev ali ustrezati kontroli MOD 11.
3. GTIN mora prestati izračun kontrolne števke.
4. Vsako polje z zaupanjem < 0,85 se v vmesniku vizualno označi in zahteva pogled uporabnika.

**Nikoli ne knjiži brez potrditve.** OCR napake tipa `0,58` → `0,53` ali `12` → `72` se v zalogi pokažejo šele ob inventuri, več mesecev kasneje.

---

## 10. Validacija GTIN (uporabi povsod)

```sql
CREATE OR REPLACE FUNCTION prevzem.gtin_veljaven(p_gtin TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_gtin TEXT;
    v_vsota INT := 0;
    v_utez INT;
    i INT;
BEGIN
    IF p_gtin IS NULL OR p_gtin !~ '^\d+$' THEN RETURN FALSE; END IF;
    IF length(p_gtin) NOT IN (8, 12, 13, 14) THEN RETURN FALSE; END IF;

    v_gtin := lpad(p_gtin, 14, '0');
    FOR i IN 1..13 LOOP
        v_utez := CASE WHEN (14 - i) % 2 = 0 THEN 1 ELSE 3 END;
        v_vsota := v_vsota + substr(v_gtin, i, 1)::INT * v_utez;
    END LOOP;

    RETURN ((10 - (v_vsota % 10)) % 10) = substr(v_gtin, 14, 1)::INT;
END $$;
```

Normalizacija za primerjavo: vse GTIN hrani kot **14-mestne z vodilnimi ničlami**. Tako se EAN-13 `3838800000123` in ITF-14 `03838800000123` ujemata brez posebne logike.

```sql
CREATE OR REPLACE FUNCTION prevzem.gtin_norm(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE WHEN p ~ '^\d{8,14}$' THEN lpad(p, 14, '0') END $$;
```
