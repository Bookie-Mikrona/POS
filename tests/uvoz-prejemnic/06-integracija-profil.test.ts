// Integracijski test: konfiguracija, kot jo sestavi ProfilUrejevalnik,
// mora delovati v CsvRazclenjevalnik brez rocnega popravljanja.
import { readFileSync } from 'node:fs';
import iconv from 'iconv-lite';
import { CsvRazclenjevalnik, dekodiraj, zaznajLocilo } from '../../artifacts/api-server/src/lib/uvoz/parser-csv';
import { ugibajStolpce } from '../../artifacts/api-server/src/lib/uvoz/cenik';

// Poti do vzorcev so vezane na datoteko, ne na delovno mapo, da testi
// tečejo enako iz korena projekta in iz mape tests/.
const vzorec = (ime: string) => new URL(`./fixtures/${ime}`, import.meta.url);


let n = 0;
const t = (o: string, d: unknown, p: unknown) => {
  const ok = String(d) === String(p); if (!ok) n++;
  console.log(`  ${ok ? 'OK    ' : 'NAPAKA'} ${o}: ${d}${ok ? '' : ` (pricakovano ${p})`}`);
};

const raw = readFileSync(vzorec('dobavnica-cashcarry.csv'));

// --- 1. Kar naredi ruta /profili/vzorec ---
const { besedilo, kodiranje } = dekodiraj(raw);
const locilo = zaznajLocilo(besedilo);
const vrstice = besedilo.split(/\r?\n/).slice(0, 25).map(v => v.split(locilo));

let glavaIdx = 0, najbolje = -1;
vrstice.slice(0, 10).forEach((v, i) => {
  const neprazne = v.filter(c => String(c).trim()).length;
  const besedilne = v.filter(c => /[a-zčšž]/i.test(String(c))).length;
  const ocena = neprazne + besedilne;
  if (ocena > najbolje) { najbolje = ocena; glavaIdx = i; }
});

console.log('=== Zaznava vzorca (ruta /profili/vzorec) ===');
// Datoteka je zapisana v CP1250, a vsebuje samo znake ASCII, zato je
// bajtno identicna UTF-8. Zaznava vrne utf-8 in to je pravilno —
// dekodiranje je v obeh primerih enako.
t('kodiranje pri cistem ASCII', kodiranje, 'utf-8');
t('locilo', locilo, ';');
t('vrstica glave (0-osnovna)', glavaIdx, 4);
console.log('         glava:', JSON.stringify(vrstice[glavaIdx]));

// --- 2. Kar naredi urejevalnik: predlog + rocni popravki ---
const predlog = ugibajStolpce(vrstice[glavaIdx]);
// Ista datoteka s sumniki -> zaznava mora vrniti cp1250
const zSumniki = besedilo.replace('Caj vrecka - Kamilica', 'Čaj vrečka - Kamilica')
                         .replace('Olje oljcno 1 L', 'Olje oljčno 1 L');
const rawCp = iconv.encode(zSumniki, 'cp1250');
t('kodiranje pri sumnikih v CP1250', dekodiraj(rawCp).kodiranje, 'cp1250');
t('kodiranje pri sumnikih v UTF-8',
  dekodiraj(Buffer.from(zSumniki, 'utf-8')).kodiranje, 'utf-8');
t('sumniki pravilno dekodirani iz CP1250',
  dekodiraj(rawCp).besedilo.includes('Čaj vrečka'), 'true');

console.log('\n=== Predlog stolpcev iz glave ===');
console.log('        ', JSON.stringify(predlog));
t('naziv',        predlog.naziv, 2);
t('cena',         predlog.cena, 6);
t('sifra',        predlog.sifra, 0);
t('gtin',         predlog.gtin, 1);
t('enot v paketu',predlog.enotVPaketu, 4);

// ugibajStolpce ne pozna "kolicina" in "vrednost" — te doda uporabnik
const stolpci: Record<string, { indeks: number }> = {};
for (const [k, v] of Object.entries(predlog)) if (v !== undefined) stolpci[k] = { indeks: v };
stolpci.kolicina = { indeks: 5 };
stolpci.vrednost = { indeks: 9 };
stolpci.rabatOdst = { indeks: 7 };

// --- 3. Konfiguracija, kot jo sestavi useMemo v ProfilUrejevalniku ---
const konfiguracija = {
  kodiranje,
  locilo,
  decimalnoLocilo: ',' as const,
  ceneBruto: true,
  glavaVsebuje: vrstice[glavaIdx]
    .filter(c => String(c).trim().length > 2).slice(0, 3)
    .map(c => String(c).trim().toLowerCase()),
  prvaVrsticaPodatkov: glavaIdx + 2,
  stolpci,
};
console.log('\n=== Sestavljena konfiguracija ===');
console.log('         glavaVsebuje:', JSON.stringify(konfiguracija.glavaVsebuje));
console.log('         prvaVrsticaPodatkov:', konfiguracija.prvaVrsticaPodatkov);

// --- 4. Ali razclenjevalnik z njo dela? ---
const dto = new CsvRazclenjevalnik(konfiguracija as never).razcleni(raw, 'fixtures/dobavnica-cashcarry.csv');
console.log('\n=== Razclenitev s samodejno sestavljeno konfiguracijo ===');
t('postavk', dto.postavke.length, 4);
t('postavka 1 naziv', dto.postavke[0].izvNaziv, 'Caj vrecka - Kamilica');
t('postavka 1 cena',  dto.postavke[0].izvCena, '5.476');
t('postavka 1 pak',   dto.postavke[0].enotVPaketu, '20');
t('postavka 2 rabat', dto.postavke[1].rabat1Odst, '5');
t('postavka 4 blokada POS007',
  dto.postavke[3].opozorila.some(o => o.koda === 'POS007'), 'true');

// --- 5. Odpornost: dobavitelj doda uvodno vrstico ---
const spremenjeno = 'OPOMBA: nova dostavna sluzba\n' + besedilo;
const dto2 = new CsvRazclenjevalnik(konfiguracija as never)
  .razcleni(Buffer.from(spremenjeno, 'utf-8'), 'fixtures/dobavnica-cashcarry.csv');
console.log('\n=== Dobavitelj doda uvodno vrstico brez obvestila ===');
t('postavke se NE izgubijo (glavaVsebuje resi zamik)', dto2.postavke.length, 4);
t('prva postavka pravilna', dto2.postavke[0].izvNaziv, 'Caj vrecka - Kamilica');

console.log('\n' + (n ? `NEUSPESNO: ${n}` : 'VSI TESTI USPESNI'));
process.exit(n ? 1 : 0);
