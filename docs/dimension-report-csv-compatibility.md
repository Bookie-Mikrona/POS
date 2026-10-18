# Varnost in združljivost CSV analitičnega poročila

## Pogodba izvoza

- Datoteka uporablja UTF-8 z BOM, podpičje, decimalno vejico in CRLF med vrsticami.
- Besedilo je obdano z narekovaji; notranji narekovaji so podvojeni. Podpičja
  in prelomi vrstic v nazivu ostanejo znotraj iste celice.
- Pred besedilo, ki se začne z `=`, `+`, `-` ali `@` (tudi za začetnimi
  presledki ali kontrolnimi znaki), se doda apostrof **znotraj** narekovajev.
  Samo narekovaji ne preprečijo izvajanja formul.
- Zneski niso del besedilnega kodiranja: npr. saldo `-20.25` ostane
  `-20,25`, brez apostrofa in brez narekovajev. Tudi seštevki ostanejo številke.
- Nekateri uvozniki apostrof prikažejo kot del naziva. To je namerna
  varnostna sprememba izvoza, ne sprememba shranjenih podatkov.

## Avtomatizirana preverjanja

```sh
pnpm --filter @workspace/erp-web exec vitest run src/pages/porocila-dimenzije.csv.test.ts
LIBREOFFICE_BIN=/pot/do/soffice pnpm --filter @workspace/erp-web exec vitest run src/pages/porocila-dimenzije.csv.test.ts
```

Drugi ukaz izvede tudi dejanski uvoz v LibreOffice in shrani rezultat v XLSX.
Test ne izklopi formul in ne vsili besedilnega tipa citiranim celicam, zato
preverja zaščito izvoza, ne zaščitnih nastavitev uvoznika. V nastalem XLSX
preveri odsotnost formul, tipe besedil, šumnike, večvrstična besedila,
podpičja/narekovaje in numerične negativne salde dimenzij, kontov ter seštevka.
Uporablja začasno mapo in jo po izvedbi odstrani.

Preverjeno z LibreOffice 25.2.3.2. Calc normalizira CRLF znotraj celice v LF.
Branje nastalega XLSX z ExcelJS preveri datotečno združljivost in tipe celic,
**ni pa preizkus izvajanja v namiznem Microsoft Excelu**.

## Microsoft Excel

Oblika sledi priporočeni kombinaciji apostrofa, narekovajev in podvojenih
narekovajev za prvo odpiranje v preglednici. Za slovenske nastavitve mora
uvoz uporabljati UTF-8, ločilo `;` in decimalno vejico. Pri drugih sistemskih
nastavitvah uporabite uvoz iz besedila/CSV in nastavite ta ločila.

Namizni Excel v razvojnem okolju ni na voljo; dejanski preizkus v njem ni bil
izveden. Za ročno potrditev odprite svež izvoz z nazivi `=1+1`, `+1+1`,
`-1+1`, `@SUM(1,2)`, nazivom s podpičjem/narekovaji ter negativnim saldom:

1. Nevarni nazivi morajo ostati besedilo, ne izračun oziroma formula.
2. Negativni saldo mora biti številka, vključena v `SUM`.
3. Šumniki, stolpci in prelomi znotraj naziva morajo ostati pravilni.

Zaščita velja za prvotno izvoženo datoteko. Excel lahko ob ponovnem
shranjevanju CSV odstrani zaščitne znake; ponovno shranjena datoteka ni več
izvoz aplikacije in njene varnosti ne zagotavljamo. Za nadaljnje urejanje
uporabite ločen izvoz Excel (XLSX) s tipiziranimi celicami.

Viri:
- https://owasp.org/www-community/attacks/CSV_Injection
- https://help.libreoffice.org/latest/en-US/text/shared/guide/csv_params.html
