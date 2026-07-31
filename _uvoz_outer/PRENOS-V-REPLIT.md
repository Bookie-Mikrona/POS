# Prenos v Replit

Vsi ukazi so preizkušeni na simulaciji vašega projekta.

---

## Najprej: kaj NE storiti

**Ne razpakirajte arhiva v korenu obstoječega Repl-a.** V korenu arhiva
so `package.json`, `tsconfig.json` in `README.md`, ki bi povozili vaše.

Trije so; vse ostalo (`lib/`, `artifacts/`, `docs/`, `tests/`) je varno.

---

## Pot A — najprej preizkusite ločeno (priporočeno)

Naredite **nov, prazen Repl** vrste Node.js. Arhiv povlecite v drevo
datotek, nato v lupini:

```bash
unzip -q bookie-uvoz-prejemnic.zip
cd bookie-uvoz-prejemnic
npm install
npm test
```

Pričakovano: `found 0 vulnerabilities` in devet sklopov z izpisom
`VSI TESTI USPESNI`.

```bash
npx tsc --noEmit
```

Pričakovano: **osem** napak oblike `Cannot find module '../../db'`,
`'./artikli'`, `'./prejemnice'`, `'../partnerji'`. To so moduli, ki
obstajajo šele v BOOKIE. Drugih napak ne sme biti.

Ta korak stane pet minut in vam pove, ali paket sploh teče, preden se
dotaknete delujočega projekta.

---

## Pot B — vključitev v BOOKIE

Arhiv povlecite v drevo datotek Repl-a z BOOKIE, nato v lupini:

### 1. Razpakirajte v začasno mapo, ne v koren

```bash
rm -rf _uvoz && mkdir _uvoz
unzip -q bookie-uvoz-prejemnic.zip -d _uvoz
IZVOR=_uvoz/bookie-uvoz-prejemnic
```

### 2. Preverite trke, preden karkoli kopirate

```bash
cd $IZVOR
for f in $(find lib artifacts -type f); do
  [ -e "$OLDPWD/$f" ] && echo "TRK: $f"
done
cd -
```

Izpis mora biti prazen. Če ni, primerjajte datoteki, preden nadaljujete.

### 3. Kopirajte samo kodo

```bash
cp -r $IZVOR/lib/.       lib/
cp -r $IZVOR/artifacts/. artifacts/
```

Zapis `mapa/.` pomeni »vsebino mape«, kar mape združi namesto da bi jih
vgnezdil.

### 4. Dokumentacijo in teste ločeno

```bash
mkdir -p docs/uvoz-prejemnic tests/uvoz-prejemnic
cp -r $IZVOR/docs/.  docs/uvoz-prejemnic/
cp -r $IZVOR/tests/. tests/uvoz-prejemnic/

# testi so zdaj eno raven globlje -> ena '..' več v poteh
sed -i "s#'\.\./artifacts/#'../../artifacts/#g" tests/uvoz-prejemnic/*.test.ts
```

**Brez tega popravka testi ne najdejo kode.** Če jih postavite drugam,
prilagodite globino ustrezno.

### 5. Pospravite

```bash
rm -rf _uvoz bookie-uvoz-prejemnic.zip
```

### 6. Odvisnosti v korenu projekta

```bash
npm i decimal.js zod papaparse iconv-lite fast-xml-parser multer
npm i imapflow mailparser
npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
npm i -D @types/papaparse @types/multer @types/mailparser tsx
```

SheetJS se namesti s CDN, ne z npm — razlog je v `README.md`.

Preverite še `drizzle-orm`: različice pred 0.45.2 imajo vstavljanje SQL
prek neustrezno ubežanih identifikatorjev.

```bash
npm ls drizzle-orm
```

### 7. Preizkus

```bash
for f in tests/uvoz-prejemnic/*.test.ts; do npx tsx "$f"; done
```

---

## Dve opozorili, specifični za Replit

**Zavitih oklepajev ne uporabljajte.** Replitova lupina jih ne razširi;
`mkdir -p a/{b,c}` ustvari mapo z imenom `a/{b,c}`. Vsi ukazi zgoraj se
temu izogibajo.

**Če teče Replit Agent, ga med tem ustavite.** Agent lahko datoteke
preoblikuje ali »popravi« uvoze med tem, ko jih kopirate, in nastane
stanje, ki ga je težko razvozlati.

---

## Če uporabljate git

Bolje kot vlečenje arhiva:

```bash
git checkout -b uvoz-prejemnic
# koraki 1–6 zgoraj
git add lib artifacts docs tests
git commit -m "Modul uvoza prejemnic"
```

Tako je povrnitev en ukaz, ne ročno brisanje datotek.

---

## Šele nato migracija

**Ne poganjajte migracije, dokler koraki zgoraj niso zaključeni in testi
ne tečejo.** Migracija spreminja shemo in je v produkciji ni mogoče
enostavno razveljaviti.

Postopek je v `docs/uvoz-prejemnic/08-vkljucitev.md`, razdelek 3. Ključno:
razdelka 1 in 6 iz `0009_uvoz_prejemnic.sql` je treba prilepiti ročno,
ker jih `drizzle-kit generate` ne zna ustvariti, in migracijo je treba
uveljaviti v **obeh** zbirkah, razvojni in produkcijski.
