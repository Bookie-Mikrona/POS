// tests/eracun-generator/01-generator.test.ts
//
// Krožni test: generirajEracunXml → razcleniXml → preveri ujemanje ključnih polj.
// Zaženi: node_modules/.pnpm/node_modules/.bin/tsx tests/eracun-generator/01-generator.test.ts

import { Decimal } from 'decimal.js';
import { generirajEracunXml, type EracunInput } from '../../artifacts/api-server/src/lib/eracun/generator';
import { razcleniXml } from '../../artifacts/api-server/src/lib/uvoz/parser-eslog';

let napake = 0;
const ok = (opis: string, dobljeno: unknown, pricakovano: unknown) => {
  const pass = String(dobljeno) === String(pricakovano);
  if (!pass) napake++;
  console.log(`  ${pass ? 'OK   ' : 'FAIL '} ${opis}: ${dobljeno}${pass ? '' : ` (pricakovano: ${pricakovano})`}`);
};

// ─────────────────────────────────────────────────────────────────────────────
// Primer 1: En artikel, 22 % DDV
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n═══ Primer 1: en artikel, 22 % DDV ═══');

const vhod1: EracunInput = {
  stevilkaRacuna: 'TEST-2026-001',
  datumCas: new Date('2026-08-02T12:00:00Z'),
  dniOdloga: 30,
  skupaj: new Decimal('12.20'),   // 10.00 + 22 %
  ddv: new Decimal('2.20'),
  osnova: new Decimal('10.00'),
  postavke: [
    { ime: 'Pivo 0,5 L', kolicina: '2', cenaBrutoKos: '6.10', davek: '22' },
  ],
  izdajatelj: {
    naziv: 'Gostiščar d.o.o.',
    ulica: 'Testna ulica 1',
    postnaStevika: '1000',
    kraj: 'Ljubljana',
    drzava: 'Slovenija',
    kodaDrzave: 'SI',
    podjetjeDavcna: '12345678',
    idZaDdv: 'SI12345678',
    maticnaStevilka: '1234567000',
    trr: [{ iban: 'SI56191000000123456', bic: 'UNKLFR22' }],
  },
  prejemnik: {
    naziv: 'Podjetje d.o.o.',
    ulica: 'Kupčeva 5',
    postnaStevilka: '2000',
    kraj: 'Maribor',
    kodaDrzave: 'SI',
    davcnaStevilka: '87654321',
    idZaDdv: 'SI87654321',
    maticnaStevilka: '7654321000',
    eRacunNaslov: '3830001234568',
    eRacunOmrezje: 'UJP',
  },
};

const xml1 = generirajEracunXml(vhod1);
const dto1 = razcleniXml(xml1);

ok('brez blokad', dto1.napake.filter(n => n.resnost === 'B').length, 0);
ok('stevilka racuna', dto1.stDokumenta, 'TEST-2026-001');
ok('datum', dto1.datumDokumenta, '2026-08-02');
ok('dobaviteljev ID za DDV', dto1.dobaviteljIdDdv, 'SI12345678');
ok('dobaviteljev naziv', dto1.dobaviteljNaziv?.trim(), 'Gostiščar d.o.o.');
ok('stevilost postavk', dto1.postavke.length, 1);
ok('ime postavke', dto1.postavke[0].izvNaziv, 'Pivo 0,5 L');
ok('kolicina', dto1.postavke[0].izvKolicina.toString(), '2');
ok('izvOsnova', dto1.izvOsnova?.toFixed(2), '10.00');
ok('izvDdv', dto1.izvDdv?.toFixed(2), '2.20');
ok('izvSkupaj', dto1.izvSkupaj?.toFixed(2), '12.20');
// Preveri, da parser ne vrne blokade DOK004 (vsota postavk ≠ osnova)
ok('brez DOK004', dto1.napake.some(n => n.koda === 'DOK004'), false);

// ─────────────────────────────────────────────────────────────────────────────
// Primer 2: Dva artikla, 22 % in 9,5 % DDV
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n═══ Primer 2: dva artikla, 22 % in 9,5 % DDV ═══');

// 3 x kava @ 1.50 bruto (9.5 %):  neto = 1.50 / 1.095 ≈ 1.3699 → 1.37 * 3 = 4.11
// 2 x pivo @ 3.00 bruto (22 %):   neto = 3.00 / 1.22   ≈ 2.4590 → 2.46 * 2 = 4.92
// skupaj neto = 4.11 + 4.92 = 9.03
// ddv: 4.11 * 0.095 = 0.39, 4.92 * 0.22 = 1.08 → skupaj DDV = 1.47
// skupaj bruto = 3 * 1.50 + 2 * 3.00 = 4.50 + 6.00 = 10.50
const vhod2: EracunInput = {
  stevilkaRacuna: 'TEST-2026-002',
  datumCas: new Date('2026-08-02T14:00:00Z'),
  skupaj: new Decimal('10.50'),
  ddv: new Decimal('1.47'),
  osnova: new Decimal('9.03'),
  postavke: [
    { ime: 'Kava espresso', kolicina: '3', cenaBrutoKos: '1.50', davek: '9.5' },
    { ime: 'Pivo točeno', kolicina: '2', cenaBrutoKos: '3.00', davek: '22' },
  ],
  izdajatelj: vhod1.izdajatelj,
  prejemnik: vhod1.prejemnik,
};

const xml2 = generirajEracunXml(vhod2);
const dto2 = razcleniXml(xml2);

ok('brez blokad', dto2.napake.filter(n => n.resnost === 'B').length, 0);
ok('stevilost postavk', dto2.postavke.length, 2);
ok('izvOsnova', dto2.izvOsnova?.toFixed(2), '9.03');
ok('izvDdv', dto2.izvDdv?.toFixed(2), '1.47');
ok('izvSkupaj', dto2.izvSkupaj?.toFixed(2), '10.50');
ok('brez DOK004', dto2.napake.some(n => n.koda === 'DOK004'), false);
ok('kava ime', dto2.postavke[0].izvNaziv, 'Kava espresso');
ok('pivo kolicina', dto2.postavke[1].izvKolicina.toString(), '2');

// ─────────────────────────────────────────────────────────────────────────────
// Primer 3: Ničelna stopnja DDV (0 %)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n═══ Primer 3: ničelna stopnja DDV (0 %) ═══');

const vhod3: EracunInput = {
  stevilkaRacuna: 'TEST-2026-003',
  datumCas: new Date('2026-08-02T16:00:00Z'),
  skupaj: new Decimal('5.00'),
  ddv: new Decimal('0.00'),
  osnova: new Decimal('5.00'),
  postavke: [
    { ime: 'Brezalkoholna pijača (0 %)', kolicina: '1', cenaBrutoKos: '5.00', davek: '0' },
  ],
  izdajatelj: vhod1.izdajatelj,
  prejemnik: vhod1.prejemnik,
};

const xml3 = generirajEracunXml(vhod3);
const dto3 = razcleniXml(xml3);

ok('brez blokad', dto3.napake.filter(n => n.resnost === 'B').length, 0);
ok('izvOsnova', dto3.izvOsnova?.toFixed(2), '5.00');
ok('izvDdv', dto3.izvDdv?.toFixed(2), '0.00');
ok('izvSkupaj', dto3.izvSkupaj?.toFixed(2), '5.00');
ok('brez DOK004', dto3.napake.some(n => n.koda === 'DOK004'), false);

// ─────────────────────────────────────────────────────────────────────────────
// Rezultat
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
if (napake === 0) {
  console.log('✓ VSI TESTI USPEŠNI');
} else {
  console.log(`✗ ${napake} TEST(OV) NEUSPEŠNIH`);
  process.exit(1);
}
