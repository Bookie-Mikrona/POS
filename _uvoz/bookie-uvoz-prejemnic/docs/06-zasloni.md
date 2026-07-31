# Zasloni

**Stanje: izvedeno.** Ta dokument je utemeljitev odločitev; koda je v
`artifacts/web/src/pos/uvoz/`:

| Zaslon | Datoteka |
|---|---|
| Uparjanje neuparjenih postavk | `UparjanjeDialog.tsx` |
| Vprašanje ob spremembi pakiranja | `UparjanjeDialog.tsx` |
| Urejevalnik uvoznega profila | `ProfilUrejevalnik.tsx` |
| Nov artikel iz prevzema | `NovArtikelDialog.tsx` |
| Poročilo o odstopanjih cen | `OdstopanjaPogled.tsx` |

---

## Zaslon za uparjanje

Edina točka uvoza, ki zahteva človeka. Vse ostalo teče brez posredovanja.

Ta zaslon je **sestra** obstoječega »Uredi prejemnico«, ne njegova zamenjava. Ko so vse postavke uparjene, se odpre obstoječi zaslon, napolnjen s podatki — od tam naprej se ne spremeni nič.

---

## 1. Tok

```
naloži datoteko
      │
      ▼
 ┌──────────────────────────────────────────┐
 │  samodejno uparjanje (SQL, dok. 08)      │
 └────────────────┬─────────────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
   vse uparjeno       nekaj neuparjenih
        │                   │
        │                   ▼
        │        ┌────────────────────────┐
        │        │  ZASLON UPARJANJA      │
        │        │  (samo neuparjene)     │
        │        └───────────┬────────────┘
        │                    │
        └────────┬───────────┘
                 ▼
     obstoječi zaslon »Uredi prejemnico«
                 │
                 ▼
            F2 — shrani
```

**Ključna odločitev:** zaslon uparjanja prikaže **samo postavke, ki potrebujejo odločitev**. Uparjenih ne kaže. Če je od 40 postavk uparjenih 37, uporabnik vidi tri vrstice, ne štirideset. To je razlika med desetimi sekundami in petimi minutami dela.

---

## 2. Razporeditev

```
┌────────────────────────────────────────────────────────────────────────┐
│  Uvoz prejemnice — TUŠ CASH&CARRY                             ✕        │
│  Dokument 333/2026  •  03.01.2026  •  cene: BRUTO                      │
├────────────────────────────────────────────────────────────────────────┤
│  ✓ 37 postavk uparjenih samodejno          [ Prikaži vse ]             │
│  ⚠ 3 postavke potrebujejo vašo odločitev                               │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  1 / 3                                                                 │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  NA DOBAVNICI                                                    │  │
│  │  Caj vrecka - Kamilica 20/1                                      │  │
│  │  šifra ART-9912  •  EAN 3838800000121  •  KOM                    │  │
│  │  20 enot/paket  ×  1 paket  ×  5,476 €     =  5,48 €             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                          ↓  uparim z                                   │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  ○  Čaj vrečka - Kamilica            (KOM)   0,26 €/kos    92 %  │  │
│  │  ○  Čaj vrečka - Meta                (KOM)   0,26 €/kos    71 %  │  │
│  │  ○  Čaj vrečka - Šipek               (KOM)   0,24 €/kos    68 %  │  │
│  │  ─────────────────────────────────────────────────────────────   │  │
│  │  🔍 Poišči drug artikel…                                         │  │
│  │  ＋ Ustvari nov nabavni artikel                                   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ☑ Zapomni si za tega dobavitelja                                      │
│                                                                        │
│              [ Preskoči ]   [ Potrdi in naprej →  Enter ]              │
└────────────────────────────────────────────────────────────────────────┘
```

### Zakaj ena postavka naenkrat

Tabela z 20 spustnimi seznami vabi k mehanskemu klikanju in napačna preslikava se naredi enkrat, uporablja pa se leta. Ena postavka z vidnim izvornim zapisom in ocenjenimi kandidati vsili trenutek pozornosti tam, kjer je potreben.

Izjema: če je neuparjenih postavk več kot deset, ponudi preklop v tabelarni pogled. Pri prvem uvozu od novega dobavitelja jih bo lahko štirideset in vodenje ena po ena postane mučno.

---

## 3. Tipkovnica

Priročnik že uvaja tipkovnično delo (Enter med polji, ↑↓ med vrsticami, F2 shrani). Zaslon uparjanja to nadaljuje:

| Tipka | Dejanje |
|---|---|
| `1`–`9` | izberi kandidata po številki |
| `↑` `↓` | premik med kandidati |
| `Enter` | potrdi izbranega in naprej |
| `Tab` | v iskalno polje |
| `N` | ustvari nov artikel |
| `Esc` | preskoči postavko |
| `F2` | zaključi in odpri prejemnico |

Uparjanje mora biti izvedljivo brez miške. Kdor prevzema blago, ima pogosto eno roko na dobavnici.

---

## 4. Kaj mora biti vidno pri kandidatu

| Podatek | Zakaj |
|---|---|
| Naziv artikla | osnovno |
| Enota | razlikovanje med *Pivo 0,5 l* (KOS) in *Pivo točeno* (L) |
| Zadnja nabavna cena **na enoto** | najmočnejši potrditveni signal — če se cena ujema, je artikel skoraj gotovo pravi |
| Odstotek ujemanja | pove, kako zelo naj uporabnik pogleda |
| Ali se že kupuje od tega dobavitelja | dvigne verjetnost |

Cena na enoto je pomembnejša od imena. Dobavitelj piše *»Caj vrecka - Kamilica 20/1«*, vi imate *»Čaj vrečka - Kamilica«* — imeni se razlikujeta, ceni 0,2738 in 0,26 pa sta si dovolj blizu, da potrdita ujemanje.

---

## 5. Ustvarjanje novega artikla

Odpre se manjši obrazec, prednapolnjen iz dobavnice:

| Polje | Prednapolnjeno | Obvezno |
|---|---|---|
| Naziv | iz dobavnice, očiščen | da |
| Tip artikla | **Nabavni** (privzeto) | da |
| Enota | preslikana iz EM dobavnice | da |
| Davčna kategorija za prodajo | prazno | da, če je tip nabavno-prodajni |
| Nabavna stopnja DDV | iz dobavnice | da |
| GTIN | iz dobavnice, če prestane kontrolo | ne |
| Enot v paketu | iz dobavnice | ne |

Očiščenje naziva: odstrani pripone pakiranja tipa `20/1`, `6x1L`, `KART`, ker so v vašem šifrantu zapisane ločeno.

**Privzeti tip mora biti Nabavni, ne Nabavno-prodajni.** Napačno postavljen nabavno-prodajni artikel se pojavi v POS meniju, kjer nima kaj iskati, in ga natakar lahko po nesreči proda.

---

## 6. Kdaj sistem NE sme vprašati

Da zaslon ne postane šum, se te postavke uparijo brez vprašanja:

- ujemanje po GTIN — 100 %, brez izjeme
- ujemanje po šifri dobavitelja iz zapomnjene preslikave — 100 %
- ujemanje po nazivu nad 90 % **in** cena na enoto v okviru 15 % zadnje nabavne

Zadnji pogoj je pomemben. Sam naziv nad 90 % ni dovolj: *»Pivo svetlo 0,5 l«* in *»Pivo svetlo 0,33 l«* se ujemata visoko, ceni pa se razlikujeta za polovico. Cena je razsodnik.

---

## 7. Sprememba pakiranja — poseben primer

Kadar je artikel uparjen z gotovostjo, dobavnica pa navaja drugačno število enot v paketu kot zapomnjeno, se **ne** uparja tiho. Prikaže se ločeno, ožje vprašanje:

```
┌──────────────────────────────────────────────────────────────┐
│  ⚠  Spremenjeno pakiranje                                    │
│                                                              │
│  Radenska 0,5 L                                              │
│  doslej:      24 kos/karton    →   0,70 €/kos                │
│  na dobavnici: 20 kos/karton   →   0,84 €/kos   (+20,0 %)    │
│                                                              │
│  Cena kartona je enaka (16,80 €), cena kosa je višja.        │
│                                                              │
│  [ Uporabi 20 in posodobi ]  [ Obdrži 24 ]  [ Poglej ceno ]  │
└──────────────────────────────────────────────────────────────┘
```

To je edina podražitev, ki je z gledanjem računa ni mogoče opaziti. Vredna je lastnega vprašanja.

---

## 8. Sporočila o napakah

Vsako opozorilo mora povedati **kaj storiti**, ne le kaj je narobe.

| Namesto | Napiši |
|---|---|
| »Napaka POS007« | »Vrstica 4: 1 × 8,45 € = 8,45 €, dobavnica pa navaja 8,99 €. Preverite ceno ali količino.« |
| »Neveljaven GTIN« | »Črtna koda 3838800000123 ne prestane kontrole. Verjetno je bila v Excelu okrnjena. Postavko lahko uparite ročno.« |
| »Napaka razčlenitve« | »Datoteke ni bilo mogoče prebrati kot CSV. Poskusite izvoz v obliki CSV s podpičjem, ali pošljite datoteko skrbniku.« |

---

## 9. Merilo uspešnosti

Zaslon je uspešen, kadar velja:

| Kazalnik | Cilj |
|---|---|
| Delež samodejno uparjenih postavk po petem prevzemu od dobavitelja | > 95 % |
| Čas od naloga datoteke do shranjene prejemnice (40 postavk) | < 60 s |
| Delež napačnih samodejnih uparjanj, odkritih pozneje | < 0,5 % |

Tretji kazalnik je najpomembnejši in najtežje merljiv. Merite ga posredno: koliko preslikav v `artikel_dobavitelj` je bilo pozneje ročno popravljenih. Če ta številka raste, so pragovi samodejnega uparjanja prenizki in jih je treba dvigniti, tudi za ceno več ročnega dela.

---

## 10. Kaj ostane nespremenjeno

Da ne bo dvoma o obsegu posega:

- zaslon »Uredi prejemnico« — nespremenjen, le prednapolnjen
- paketni vnos 📦 — nespremenjen
- preklop Neto/Bruto — nespremenjen, le vnaprej nastavljen
- shranjevanje s F2 — nespremenjeno
- knjiženje v zalogo — nespremenjeno
- izdajnice, inventura, otvoritvene zaloge — nedotaknjene

Uvoz ne uvaja druge poti do zaloge. Uvaja drug način, kako se napolni isti obrazec.
