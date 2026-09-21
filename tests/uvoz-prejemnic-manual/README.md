# Ročni preizkus uvoza prejemnic — POS modul

## Testne datoteke

| Datoteka | Namen |
|---|---|
| `engrotus-eslog20.xml` | e-SLOG 2.0 XML račun (9 postavk, rabat, 2 DDV skupini) |
| `engrotus-csv.csv` | CSV dobavnica (isti dobavitelj, ista vsebina) |

**Prenesite obe datoteki na vaš računalnik** (npr. z desnim klikom v Replitu → Download).

---

## Kaj je bilo pripravljeno

| Komponenta | Stanje |
|---|---|
| Dobavitelj | ENGROTUŠ PODJETJE ZA TRGOVINO, D.O.O. (davčna: 87927497, ID v šifrantu: 12) |
| Uvozni profil CSV | Ustvarjen za vse enote (1–5) v bazi; ime: "ENGROTUŠ — CSV dobavnica" |
| Bug fix API | Popravljena napaka v `uvoz-profili.ts` (INSERT je napačno pisal `podjetje_id` namesto `enota_id`) — sedaj ustvarjanje profilov prek UI deluje |

---

## Zneski (za kontrolo)

### e-SLOG XML (in CSV)

| # | Artikel | Kol. | C/kos (neto) | Rabat | Neto skupaj | DDV % |
|---|---|---|---|---|---|---|
| 1 | Govedina 1kg | 100 | 4,80 € | — | 480,00 € | 9,5 % |
| 2 | Goveji vampi 1kg | 50 | 3,20 € | — | 160,00 € | 9,5 % |
| 3 | Jajce 1kos | 300 | 0,18 € | — | 54,00 € | 9,5 % |
| 4 | Kumina mleta 1kg | 10 | 3,60 € | **5 %** | 34,20 € | 9,5 % |
| 5 | Coca-cola 0.25l stek. | 200 | 0,42 € | — | 84,00 € | 22 % |
| 6 | Cockta 0,275l stek. | 100 | 0,52 € | — | 52,00 € | 22 % |
| 7 | Fanta orange 0.25l | 150 | 0,40 € | — | 60,00 € | 22 % |
| 8 | Pivo Laško 3dl stek. | 200 | 0,55 € | — | 110,00 € | 22 % |
| 9 | **Sok Jabolko Natura 1L** ← IZMIŠLJENI | 50 | 0,75 € | — | 37,50 € | 22 % |

**Skupaj:** osnova 1.071,70 € | DDV 144,75 € | **BRUTO 1.216,45 €**
- DDV 9,5 %: osnova 728,20 € → DDV 69,18 €
- DDV 22 %: osnova 343,50 € → DDV 75,57 €

---

## Navigacija v POS

```
Stranska navigacija → "Zaloge"
  └── Zavihek "Prejemnice"
        ├── [Uvozi dobavnico]  ← gumb levo od "Nova prejemnica"
        └── [Nova prejemnica]
```

**Cenovna odstopanja** so dostopna ločeno: stranska navigacija → "Cen. odstopanja"

---

## Postopek preizkusa — e-SLOG 2.0 XML

### Korak 1: Odprite uvozni dialog
1. Prijavite se v POS
2. V stranski navigaciji kliknite **Zaloge**
3. Kliknite zavihek **Prejemnice**
4. Kliknite gumb **Uvozi dobavnico**

### Korak 2: Naložite XML datoteko
1. V dialogu izberite **Datoteka** (ne Kamera, ne Skeniraj)
2. Kliknite območje za nalaganje ali ga povlecite datoteko `engrotus-eslog20.xml`
3. Počakajte razčlenjevanje

**Pričakovano po nalaganju:**
- Sistem zazna format: `e-SLOG 2.0 / RACUN`
- Dobavitelj: samodejno prepoznan — **ENGROTUŠ PODJETJE ZA TRGOVINO, D.O.O.** (po davčni SI87927497)
- Prikaže se predogled z 9 postavkami

### Korak 3: Uparjanje artiklov

Na zaslonu uparjanja vidite 9 vrstic. Pričakovano stanje:

| Artikel v datoteki | Pričakovan rezultat |
|---|---|
| Govedina 1kg | ✅ Samodejno uparjen (ime ustreza šifrantu) |
| Goveji vampi 1kg | ✅ Samodejno uparjen |
| Jajce 1kos | ✅ Samodejno uparjen |
| Kumina mleta 1kg | ✅ Samodejno uparjen + rabat 5 % prikazan |
| Coca-cola 0.25l stek. | ✅ Samodejno uparjen |
| Cockta 0,275l stek. | ✅ Samodejno uparjen |
| Fanta orange 0.25l | ✅ Samodejno uparjen |
| Pivo Laško 3dl stek. | ✅ Samodejno uparjen |
| **Sok Jabolko Natura 1L** | ❌ **Ni uparjen** → zahteva vašo akcijo |

### Korak 4: Dodajte izmišljeni artikel

Za **Sok Jabolko Natura 1L** (vrstica 9, ki ni uparjena):

**Opcija A — Ustvari nov artikel:**
1. Kliknite vrstico ali gumb "Nov artikel"
2. V dialogu za nov artikel vnesite:
   - Ime: `Sok Jabolko Natura 1L`
   - Enota mere: `l` ali `kom`
   - DDV: `22 %`
   - Cena (opcijsko): 0,75 €
3. Potrdite — artikel se ustvari v šifrantu in vrstica dobi status "uparjen"

**Opcija B — Preskoči artikel:**
- Kliknite "Preskoči" — vrstica ne bo uvožena v prejemnico

**Opcija C — Poveži z obstoječim:**
- Izberite drug obstoječ artikel iz šifranta (če smatrate, da ustreza)

### Korak 5: Potrdite osnutek

Ko so vse vrstice rešene (uparjene ali preskočene):
1. Kliknite **Potrdi / Ustvari prejemnico**
2. Sistem ustvari osnutek prejemnice s statusom "osnutek"

### Korak 6: Preverite zaloge

1. Ostanite na zavihku **Zaloge** (se samodejno osveži)
2. Poiščite vsak uvožen artikel in preverite, da se je stanje povečalo:
   - Govedina 1kg: +100 kom
   - Goveji vampi 1kg: +50 kom
   - Jajce 1kos: +300 kom
   - Kumina mleta 1kg: +10 kom
   - Coca-cola 0.25l stek.: +200 kom
   - Cockta 0,275l stek.: +100 kom
   - Fanta orange 0.25l: +150 kom
   - Pivo Laško 3dl stek.: +200 kom
   - Sok Jabolko Natura 1L: +50 kom (če ste ga uparili)
3. V kartico artikla (klik nanj) preverite, da so gibi (transakcije) vidni z datumom prejema

---

## Postopek preizkusa — CSV

### Korak 1: Profil je že nastavljen

Profil **"ENGROTUŠ — CSV dobavnica"** je v bazi za vse enote. Preverite:
1. V uvoznem dialogu kliknite ikono ⚙️ (profili) zraven dobavitelja
2. Profil mora biti viden v seznamu za ENGROTUŠ

### Korak 2: Naložite CSV datoteko

1. Odprite uvozni dialog (Zaloge → Prejemnice → Uvozi dobavnico)
2. Naložite `engrotus-csv.csv`
3. Sistem zazna format CSV in poišče profil za dobavitelja

**Opomba:** Za CSV mora sistem prepoznati dobavitelja. Ker CSV nima vgrajenega davčnega podatka, sistem bodisi:
- Prikaže seznam dobaviteljev → izberite ENGROTUŠ
- Ali samodejno prevzame profil

### Korak 3–6: Enako kot pri XML

Uparjanje, potrjevanje in kontrola zalog so enaki koraki kot pri XML poti.

---

## Na kaj bodite pozorni

### Zneski in DDV
- Kumina mleta 1kg: vrstica mora pokazati **ceno 3,60 €/kom** in **rabat 5 %** (= 1,80 €) → **neto 34,20 €**
- V povzetku DDV morajo biti **dve skupini**: 9,5 % in 22 %
- Skupni znesek brez DDV: **1.071,70 €**, z DDV: **1.216,45 €**

### Uparjanje
- Zelena oznaka = samodejno uparjen (ne potrebuje akcije)
- Rumena/rdeča oznaka = ni bil uparjen → vi odločite
- Po uparjanju mora biti vsaka vrstica bodisi "uparjena" bodisi "preskočena" — sive vrstice blokirajo potrditev

### Opozorila (ne napake)
- Morebitno opozorilo POS007 (novi artikel): normalno za Sok Jabolko
- Morebitno opozorilo POS017 (osnovna količina): ni pričakovano za te datoteke

### Znaki, da gre kaj narobe

| Simptom | Možen vzrok |
|---|---|
| "Format ni prepoznan" | Datoteka je poškodovana ali narobe kodirana |
| "Dobavitelj ni najden" | SI87927497 ni v šifrantu partnerjev (preverite tabelo shranjeni_kupci) |
| "Profil ni najden" za CSV | Preverite, da je profil aktiven v bazi (SELECT * FROM uvoz_profil WHERE dobavitelj_id=12) |
| Vsi artikli neuparjeni | Algoritem ne najde ujemanja — preverite ime artikla v šifrantu |
| Zaloge se niso spremenile | Prejemnica je ostala v statusu "osnutek" — potrditi jo morate ročno |
| Napaka pri ustvarjanju profila prek UI | Bug je bil odpravljen — poskusite znova po osvežitvi strani |

---

## Preverjanje profila neposredno v bazi

```sql
SELECT id, enota_id, naziv, format, cene_bruto, konfiguracija
FROM uvoz_profil
WHERE dobavitelj_id = 12 AND aktivno = true;
```

## Preverjanje stanja zalog po uvozu

```sql
SELECT a.ime, z.kolicina, z.zadnja_posodobitev
FROM zaloge z JOIN artikli a ON a.id = z.artikel_id
WHERE a.ime IN (
  'Govedina 1kg', 'Goveji vampi 1kg', 'Jajce 1kos', 'Kumina mleta 1kg',
  'Coca-cola 0.25l stek.', 'Cockta 0,275l stek.', 'Fanta orange 0.25l',
  'Pivo Laško 3dl stek.', 'Sok Jabolko Natura 1L'
)
ORDER BY a.ime;
```
