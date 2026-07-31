import { readFileSync } from 'node:fs';
import { Decimal } from 'decimal.js';
import { CsvRazclenjevalnik, PROFIL_CASH_AND_CARRY, vDecimal, vDatum,
         zaznajKodiranje, zaznajLocilo } from '../../artifacts/api-server/src/lib/uvoz/parser-csv';
import { gtinVeljaven, gtinNorm, netoPoRabatih } from '../../artifacts/api-server/src/lib/uvoz/dto';

// Poti do vzorcev so vezane na datoteko, ne na delovno mapo, da testi
// tečejo enako iz korena projekta in iz mape tests/.
const vzorec = (ime: string) => new URL(`./fixtures/${ime}`, import.meta.url);


let napak = 0;
const trdi = (opis: string, dobljeno: unknown, pricakovano: unknown) => {
  const ok = String(dobljeno) === String(pricakovano);
  if (!ok) napak++;
  console.log(`  ${ok ? 'OK    ' : 'NAPAKA'} ${opis}: ${dobljeno}${ok ? '' : ` (pricakovano ${pricakovano})`}`);
};

console.log('=== Pretvorba stevil ===');
trdi("'5,476'    -> 5.476  (cena z zaslona)", vDecimal('5,476'), '5.476');
trdi("'0,25'     -> 0.25",                    vDecimal('0,25'), '0.25');
trdi("'1.234,56' -> 1234.56",                 vDecimal('1.234,56'), '1234.56');
trdi("'1,234.56' -> 1234.56",                 vDecimal('1,234.56'), '1234.56');
trdi("'1.500'    -> 1500 (SI tisocica)",      vDecimal('1.500'), '1500');
trdi("'8.45'     -> 8.45 (EN decimalka)",     vDecimal('8.45'), '8.45');
trdi("'8,45 EUR' -> 8.45",                    vDecimal('8,45 €'), '8.45');
trdi("'-19,90'   -> -19.9",                   vDecimal('-19,90'), '-19.9');

console.log('\n=== Kaskadni rabati ===');
trdi('100 z 10% in 5% = 85.5 (ne 85)', netoPoRabatih(100, 10, 5), '85.5');
trdi('21.60 z 8%      = 19.872',       netoPoRabatih('21.60', 8), '19.872');

console.log('\n=== GTIN ===');
trdi('3838800000121 veljaven',      gtinVeljaven('3838800000121'), 'true');
trdi('3838800000123 NEveljaven',    gtinVeljaven('3838800000123'), 'false');
trdi('norm na 14 mest',             gtinNorm('3838800000121'), '03838800000121');
trdi('Excelov 3.8388E+12 zavrnjen', gtinNorm('3.8388E+12'), 'null');

console.log('\n=== Kodiranje in locilo ===');
trdi('CP1250 zaznan', zaznajKodiranje(Buffer.from([0xC8,0x61,0x6A,0x9E])), 'cp1250');
trdi('UTF-8 zaznan',  zaznajKodiranje(Buffer.from('Čaj žajbelj','utf-8')), 'utf-8');
trdi('podpicje',      zaznajLocilo('a;b;c\n1;2;3'), ';');
trdi('vejica z decimalkami', zaznajLocilo('a,b,c\n1,50,2,50,3\n4,10,5,20,6'), ',');

console.log('\n=== Datumi ===');
trdi("'03.01.2026'", vDatum('03.01.2026'), '2026-01-03');
trdi("'3. 1. 2026'", vDatum('3. 1. 2026'), '2026-01-03');
trdi('Excel 46025',  vDatum(46025), '2026-01-03');

console.log('\n=== Razclenitev dobavnice (CP1250) ===');
const dto = new CsvRazclenjevalnik(PROFIL_CASH_AND_CARRY)
  .razcleni(readFileSync(vzorec('dobavnica-cashcarry.csv')), 'fixtures/dobavnica-cashcarry.csv');
trdi('st. dokumenta',  dto.stDokumenta, '333/2026');
trdi('datum',          dto.datumDokumenta, '2026-01-03');
trdi('cene bruto',     dto.ceneBruto, 'true');
trdi('stevilo postavk (prva se NE sme izgubiti)', dto.postavke.length, 4);
trdi('postavka 1 naziv', dto.postavke[0].izvNaziv, 'Caj vrecka - Kamilica');
trdi('postavka 1 cena',  dto.postavke[0].izvCena, '5.476');
trdi('postavka 1 pak',   dto.postavke[0].enotVPaketu, '20');
trdi('postavka 4 ima blokado POS007',
     dto.postavke[3].opozorila.some(o => o.koda === 'POS007'), 'true');
trdi('dokument brez napake DOK004', dto.napake.filter(n=>n.koda==='DOK004').length, 0);

console.log('\n' + (napak ? `NEUSPESNO: ${napak} napak` : 'VSI TESTI USPESNI'));
process.exit(napak ? 1 : 0);
