import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import { razcleniCenik } from '../../artifacts/api-server/src/lib/uvoz/cenik';
import {
  CsvRazclenjevalnik,
  vDecimal,
  vDatum,
  type UvozProfilKonfig,
} from '../../artifacts/api-server/src/lib/uvoz/parser-csv';
import {
  preberiXlsxMatriko,
  preberiXlsxObjekte,
} from '../../artifacts/api-server/src/lib/uvoz/xlsx-branje';
import {
  parseSloCurrency,
  parseSloDate,
  processUvoz,
} from '../../artifacts/api-server/src/routes/osUvoz';
import { preberiXlsxVzorec } from '../../artifacts/api-server/src/routes/pos/uvoz-profili';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

async function main(): Promise<void> {
  console.log('=== XLSX karakterizacija: cenik ===');
  const cenikVrstice = await preberiXlsxMatriko(
    fixture('cenik-karakterizacija.xlsx'),
    'Cenik',
  );
  // Adapter nikoli ne računa formul, temveč ohrani Excelov cached rezultat.
  assert.equal(cenikVrstice[3]?.[5], '5.476');
  assert.equal(
    cenikVrstice[4]?.every((cell) => cell === ''),
    true,
  );

  const cenik = await razcleniCenik(
    fixture('cenik-karakterizacija.xlsx'),
    {
      list: 'Cenik',
      glavaVsebuje: ['Naziv', 'Cena'],
      decimalnoLocilo: ',',
      stolpci: {
        sifra: 0,
        gtin: 1,
        naziv: 2,
        enota: 3,
        enotVPaketu: 4,
        cena: 5,
        ddv: 6,
      },
    },
    true,
  );

  assert.equal(cenik.vrstice.length, 2);
  assert.equal(cenik.vrstice[0]?.gtin, '00000000000000');
  // Cached številčni rezultat formule gre neposredno v Decimal parser, zato
  // slovenska razlaga prikazanega besedila "5.476" ne more pomeniti 5.476 tisoč.
  assert.equal(cenik.vrstice[0]?.cenaPaket?.toString(), '5.476');
  assert.equal(cenik.vrstice[0]?.enotVPaketu.toString(), '20');
  assert.equal(cenik.vrstice[0]?.cenaEnota?.toString(), '0.2738');
  assert.equal(cenik.vrstice[0]?.ddvStopnja?.toString(), '9.5');
  assert.equal(cenik.vrstice[1]?.gtin, null);
  assert.equal(cenik.napake.length, 1);
  assert.match(cenik.napake[0] ?? '', /3\.8388E\+12/);
  console.log('OK cenik: izbran list, prazna vrstica, GTIN ničle, decimalke, formula cached in scientific zapis');

  console.log('=== XLSX karakterizacija: prejemnica ===');
  const profil: UvozProfilKonfig = {
    list: 'Prejemnica',
    glavaVsebuje: ['Naziv', 'Količina'],
    decimalnoLocilo: ',',
    glavaDokumenta: {
      stDokumenta: { vir: 'CELICA', naslov: 'A1' },
      datum: { vir: 'CELICA', naslov: 'B1' },
      datumZapadlosti: { vir: 'CELICA', naslov: 'B2' },
    },
    stolpci: {
      naziv: { indeks: 0 },
      kolicina: { indeks: 1 },
      cena: { indeks: 2 },
      gtin: { indeks: 3 },
      ddv: { indeks: 4 },
    },
  };
  const prejemnica = await new CsvRazclenjevalnik(profil).razcleniXlsx(
    fixture('prejemnica-karakterizacija.xlsx'),
    'prejemnica-karakterizacija.xlsx',
  );

  assert.equal(prejemnica.stDokumenta, 'Racun 2026-001');
  assert.equal(prejemnica.datumDokumenta, '2026-01-15');
  assert.equal(prejemnica.datumZapadlosti, '2026-01-03');
  assert.equal(prejemnica.postavke.length, 2);
  assert.equal(prejemnica.postavke[0]?.izvNaziv, 'Kava zrna');
  assert.equal(prejemnica.postavke[0]?.izvKolicina.toString(), '2.5');
  assert.equal(prejemnica.postavke[0]?.izvCena.toString(), '5.476');
  assert.equal(prejemnica.postavke[0]?.izvGtin, '03838800000121');
  assert.equal(prejemnica.postavke[1]?.izvNaziv, 'Čaj');
  assert.equal(prejemnica.napake.some((n) => n.koda === 'DOK010'), false);
  const prejemnicaVrstice = await preberiXlsxMatriko(
    fixture('prejemnica-karakterizacija.xlsx'),
    'Prejemnica',
  );
  assert.equal(prejemnicaVrstice[7]?.every((cell) => cell === ''), true);
  assert.equal(vDecimal('21.907,86', ',').toString(), '21907.86');
  assert.equal(vDecimal('5,476', ',').toString(), '5.476');
  assert.equal(vDecimal(5.476, ',').toString(), '5.476');
  assert.equal(vDecimal(20, ',').toString(), '20');
  assert.equal(vDecimal(-19.9, ',').toString(), '-19.9');
  assert.equal(vDecimal('', ',').toString(), '0');
  assert.equal(vDatum(new Date('2023-06-15T00:00:00Z')), '2023-06-15');
  assert.equal(vDatum(46025), '2026-01-03');
  assert.equal(vDatum('31.12.2026'), '2026-12-31');

  const manjkajociList = await new CsvRazclenjevalnik({
    ...profil,
    list: 'Manjkajoci',
  }).razcleniXlsx(fixture('prejemnica-karakterizacija.xlsx'));
  assert.equal(manjkajociList.napake[0]?.koda, 'ZAJ010');
  console.log('OK prejemnica: datumi, prazna vrstica, izbran list in ZAJ010');

  console.log('=== XLSX karakterizacija: osnovna sredstva ===');
  assert.equal(parseSloCurrency('21.907,86'), 21907.86);
  assert.equal(parseSloDate('15.2.2024'), '2024-02-15');
  assert.equal(parseSloDate(46025), '2026-01-03');

  const os = await processUvoz(fixture('os-karakterizacija.xlsx'), 'characterization-company', true);
  assert.equal(os.dryRun, true);
  if (!os.dryRun) throw new Error('OS karakterizacija mora biti dry-run');
  assert.equal(os.skupineCount, 1);
  assert.equal(os.stmCount, 1);
  assert.equal(os.sredstvaCount, 2);
  assert.equal(os.dograditveCount, 1);
  assert.deepEqual(os.napake, []);
  const osVrstice = await preberiXlsxObjekte(
    fixture('os-karakterizacija.xlsx'),
    'Sredstva',
    2,
  );
  assert.ok(parseSloDate(osVrstice[0]?.datum_nabave));
  assert.equal(parseSloDate(osVrstice[1]?.datum_nabave), '2026-01-03');
  assert.equal(osVrstice[1]?.datum_aktivacije, '2026-01-03');
  assert.equal(osVrstice[2]?.datum_nabave, '01.03.2025');

  const osFallback = await processUvoz(
    fixture('os-fallback-karakterizacija.xlsx'),
    'characterization-company',
    true,
  );
  assert.equal(osFallback.dryRun, true);
  if (!osFallback.dryRun) throw new Error('OS fallback karakterizacija mora biti dry-run');
  assert.deepEqual(
    [osFallback.skupineCount, osFallback.stmCount, osFallback.sredstvaCount, osFallback.dograditveCount],
    [1, 1, 2, 1],
  );
  assert.deepEqual(osFallback.napake, []);
  console.log('OK OS: trije listi, datumski tipi, 2 glavi, 1 doknjižba, dry-run in fallback po indeksu');

  console.log('=== XLSX karakterizacija: OS obogatitev ===');
  const obogatitevRows = await preberiXlsxObjekte(
    fixture('os-obogatitev-karakterizacija.xlsx'),
    'Sredstva',
    0,
  );
  assert.deepEqual(obogatitevRows, [
    {
      inventarna: 'OS-001',
      stm: 'STM-1',
      konto_popravka: '0400',
      konto_stroska: '4300',
      partner_davcna: '12345678',
      partner_naziv: 'Dobavitelj d.o.o.',
    },
    {
      inventarna: 'OS-002',
      stm: '',
      konto_popravka: '',
      konto_stroska: '',
      partner_davcna: '',
      partner_naziv: '',
    },
  ]);
  console.log('OK OS obogatitev: list Sredstva, prazne celice in polja za dopolnitev');

  console.log('=== XLSX karakterizacija: predogled profila ===');
  const vzorec = await preberiXlsxVzorec(fixture('profil-vzorec-karakterizacija.xlsx'));
  assert.equal(vzorec.vrstice.length, 25);
  assert.equal(vzorec.glavaIdx, 2);
  assert.deepEqual(vzorec.vrstice[2], ['Naziv', 'Pakiranje', 'Cena']);
  assert.equal(vzorec.predlogStolpcev.naziv, 0);
  assert.equal(vzorec.predlogStolpcev.enotVPaketu, 1);
  assert.equal(vzorec.predlogStolpcev.cena, 2);
  console.log('OK profil: 25 vrstic in zaznava glave');

  console.log('VSI XLSX KARAKTERIZACIJSKI TESTI USPESNI');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});