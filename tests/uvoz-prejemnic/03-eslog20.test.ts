import { readFileSync } from 'node:fs';
import { Decimal } from 'decimal.js';
import { razcleniXml } from '../../artifacts/api-server/src/lib/uvoz/parser-eslog';

// Poti do vzorcev so vezane na datoteko, ne na delovno mapo, da testi
// tečejo enako iz korena projekta in iz mape tests/.
const vzorec = (ime: string) => new URL(`./fixtures/${ime}`, import.meta.url);


let n = 0;
const t = (opis: string, dobljeno: unknown, pricakovano: unknown) => {
  const ok = String(dobljeno) === String(pricakovano);
  if (!ok) n++;
  console.log(`  ${ok ? 'OK    ' : 'NAPAKA'} ${opis}: ${dobljeno}${ok ? '' : ` (pricakovano ${pricakovano})`}`);
};

const dto = razcleniXml(readFileSync(vzorec('eslog20-racun.xml')));

console.log('=== Glava ===');
t('st. dokumenta',   dto.stDokumenta, '2026-004512');
t('datum',           dto.datumDokumenta, '2026-01-03');
t('davcna',          dto.dobaviteljDavcna, '12345678');
t('ID za DDV',       dto.dobaviteljIdDdv, 'SI12345678');
t('GLN',             dto.dobaviteljGln, '3830001234567');
t('vrsta',           dto.vrstaDokumenta, 'RACUN');
t('cene neto',       dto.ceneBruto, 'false');
t('postavk',         dto.postavke.length, 3);

console.log('\n=== Postavka 1: rabat iz AllowanceCharge ===');
t('rabat 1.728/21.60 = 8%', dto.postavke[0].rabat1Odst, '8');
t('cena po rabatu',         dto.postavke[0].izvCena, '19.872');
t('enota CT -> KAR',        dto.postavke[0].izvEnota, 'KAR');
t('brez opozoril',          dto.postavke[0].opozorila.length, 0);

console.log('\n=== Postavka 2: PAST BaseQuantity=100 ===');
const p2 = dto.postavke[1];
t('cena preracunana na kos', p2.izvCena, '0.274');
t('opozorilo POS017',        p2.opozorila.some(o=>o.koda==='POS017'), 'true');
t('BREZ blokade POS007',     p2.opozorila.some(o=>o.koda==='POS007'), 'false');
console.log(`         kontrola: 500 x ${p2.izvCena} = ${p2.izvKolicina.mul(p2.izvCena)}  (dokument: ${p2.izvVrednost})`);
console.log(`         brez preracuna bi slo v zalogo: ${new Decimal(500).mul('27.40')} EUR`);

console.log('\n=== Postavka 3: samoobdavcitev in sledljivost ===');
const p3 = dto.postavke[2];
t('kategorija AE',        p3.ddvKategorija, 'AE');
t('zastavica na dokumentu', dto.samoobdavcitev, 'true');
t('opozorilo POS018',     p3.opozorila.some(o=>o.koda==='POS018'), 'true');
t('lot',                  p3.lot, 'L2607');
t('rok uporabe',          p3.rokUporabe, '2027-01-15');

console.log('\n=== Odvisni stroski in vsote ===');
t('prevoz zajet',    dto.odvisniStroski.length, 1);
t('znesek prevoza',  dto.odvisniStroski[0].znesek, '15');
t('davcna osnova',   dto.izvOsnova, '663.22');
const vsota = dto.postavke.reduce((a,p)=>a.plus(p.izvVrednost!), new Decimal(0))
                .plus(dto.odvisniStroski[0].znesek);
t('postavke + prevoz = osnova', vsota, '663.22');
t('brez blokade DOK004', dto.napake.some(x=>x.koda==='DOK004'), 'false');
t('opozorilo DOK014',    dto.napake.some(x=>x.koda==='DOK014'), 'true');

console.log('\n' + (n ? `NEUSPESNO: ${n} napak` : 'VSI TESTI USPESNI'));
process.exit(n ? 1 : 0);
