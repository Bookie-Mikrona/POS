import { readFileSync } from 'node:fs';
import { Decimal } from 'decimal.js';
import { razcleniEslog161, izpisiZgradbo } from '../artifacts/api-server/src/lib/uvoz/parser-eslog161';

// Poti do vzorcev so vezane na datoteko, ne na delovno mapo, da testi
// tečejo enako iz korena projekta in iz mape tests/.
const vzorec = (ime: string) => new URL(`./fixtures/${ime}`, import.meta.url);


let n = 0;
const t = (o: string, d: unknown, p: unknown) => {
  const ok = String(d) === String(p); if (!ok) n++;
  console.log(`  ${ok ? 'OK    ' : 'NAPAKA'} ${o}: ${d}${ok ? '' : ` (pricakovano ${p})`}`);
};

const dto = razcleniEslog161(readFileSync(vzorec('eslog161-racun.xml')));

console.log('=== Glava (kvalifikatorji, ne imena polj) ===');
t('st. dokumenta', dto.stDokumenta, '2026-000871');
t('datum 137 (dokumenta), NE 13 (zapadlosti)', dto.datumDokumenta, '2026-01-15');
t('dobavitelj po vlogi SE, ne prvi partner', dto.dobaviteljNaziv, 'STARI DOBAVITELJ d.o.o.');
t('davcna iz SI87654321', dto.dobaviteljDavcna, '87654321');
t('ID za DDV', dto.dobaviteljIdDdv, 'SI87654321');
t('valuta', dto.valuta, 'EUR');
t('postavk', dto.postavke.length, 3);

console.log('\n=== Postavka 1: vejica kot decimalno locilo ===');
t('cena 5,476 -> 5.476', dto.postavke[0].izvCena, '5.476');
t('enota H87 -> KOS', dto.postavke[0].izvEnota, 'KOS');
t('DDV iz odstotka vrste 3', dto.postavke[0].ddvStopnja, '9.5');
t('brez opozoril', dto.postavke[0].opozorila.length, 0);

console.log('\n=== Postavka 2: PAST OsnovnaKolicina=1000 ===');
const p2 = dto.postavke[1];
t('cena preracunana na kos', p2.izvCena, '0.0185');
t('opozorilo POS017', p2.opozorila.some(o => o.koda === 'POS017'), 'true');
t('BREZ blokade POS007', p2.opozorila.some(o => o.koda === 'POS007'), 'false');
console.log(`         2000 x ${p2.izvCena} = ${p2.izvKolicina.mul(p2.izvCena)} (dokument: ${p2.izvVrednost})`);
console.log(`         brez preracuna: ${new Decimal(2000).mul('18.50')} EUR`);

console.log('\n=== Postavka 3: rabat iz odstotka vrste 1 ===');
t('rabat 5 %', dto.postavke[2].rabat1Odst, '5');
t('DDV 9,5 % (vrsta 3, ne vrsta 1)', dto.postavke[2].ddvStopnja, '9.5');
console.log(`         12 x 2,40 = 28,80 ; -5 % = ${new Decimal('28.80').mul('0.95')} (dokument: 27,36)`);
t('brez blokade POS007', dto.postavke[2].opozorila.some(o => o.koda === 'POS007'), 'false');

console.log('\n=== Povzetek ===');
t('osnova (znesek 79)', dto.izvOsnova, '119.12');
t('DDV (znesek 124)',   dto.izvDdv, '15.95');
t('skupaj (znesek 77)', dto.izvSkupaj, '135.07');
const vsota = dto.postavke.reduce((a,p)=>a.plus(p.izvVrednost!), new Decimal(0));
console.log(`         54,76 + 37,00 + 27,36 = ${vsota}`);
t('brez blokade DOK004', dto.napake.some(x=>x.koda==='DOK004'), 'false');

console.log('\n=== Diagnostika ob neznani zgradbi ===');
const napacen = razcleniEslog161('<?xml version="1.0"?><eRacun><Glava/></eRacun>');
t('vrne blokado ZAJ002', napacen.napake[0]?.koda, 'ZAJ002');
console.log('         diagnostika:', JSON.stringify(napacen.napake[0]?.podatki));

console.log('\n=== Izpis zgradbe (za popravek tabele POTI) ===');
console.log(izpisiZgradbo(readFileSync(vzorec('eslog161-racun.xml')), 3)
  .split('\n').slice(0, 8).map(v => '         ' + v).join('\n'));

console.log('\n' + (n ? `NEUSPESNO: ${n}` : 'VSI TESTI USPESNI'));
process.exit(n ? 1 : 0);
