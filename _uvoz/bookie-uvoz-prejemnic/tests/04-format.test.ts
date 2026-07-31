// Preizkusimo samo zaznavo formata — ne potrebuje baze.
import { zaznajFormat, zaznajProfilUbl } from '../artifacts/api-server/src/lib/uvoz/uvoz-service';
import { readFileSync } from 'node:fs';

// Poti do vzorcev so vezane na datoteko, ne na delovno mapo, da testi
// tečejo enako iz korena projekta in iz mape tests/.
const vzorec = (ime: string) => new URL(`./fixtures/${ime}`, import.meta.url);

let n = 0;
const t = (o: string, d: unknown, p: unknown) => {
  const ok = String(d) === String(p); if (!ok) n++;
  console.log(`  ${ok ? 'OK    ' : 'NAPAKA'} ${o}: ${d}${ok ? '' : ` (pricakovano ${p})`}`);
};
const b = (s: string) => Buffer.from(s, 'utf-8');

console.log('=== Zaznava formata ===');
t('testna datoteka je Peppol, ne e-SLOG -> UBL',
  zaznajFormat(readFileSync(vzorec('eslog20-racun.xml')), 'r.xml'), 'UBL_2_1_INVOICE');
t('profil iz CustomizationID: Peppol',
  zaznajProfilUbl(readFileSync(vzorec('eslog20-racun.xml'),'utf-8')), 'PEPPOL');
t('profil iz CustomizationID: e-SLOG',
  zaznajProfilUbl('<Invoice><cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:eslog:2.00</cbc:CustomizationID></Invoice>'), 'ESLOG');
t('e-SLOG racun po CustomizationID',
  zaznajFormat(b('<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><cbc:CustomizationID>urn:eslog:2.00</cbc:CustomizationID><ID>1</ID></Invoice>')), 'ESLOG_2_0_RACUN');
t('brez CustomizationID -> navaden UBL',
  zaznajProfilUbl('<Invoice><ID>1</ID></Invoice>'), 'UBL');
t('CSV v CP1250 (datoteka)',
  zaznajFormat(readFileSync(vzorec('dobavnica-cashcarry.csv')), 'd.csv'), 'CSV');
t('UBL Invoice brez e-SLOG oznake',
  zaznajFormat(b('<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>1</ID></Invoice>')), 'UBL_2_1_INVOICE');
t('UBL DespatchAdvice',
  zaznajFormat(b('<DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2"><ID>1</ID></DespatchAdvice>')), 'UBL_2_1_DESPATCH');
t('CII D16B',
  zaznajFormat(b('<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"><a/></rsm:CrossIndustryInvoice>')), 'CII_D16B');
t('e-SLOG 1.6.1',
  zaznajFormat(b('<?xml version="1.0"?><Racun xmlns="http://www.gzs.si/e-poslovanje"><a/></Racun>')), 'ESLOG_1_6_1');
t('EDIFACT DESADV',
  zaznajFormat(b("UNA:+.? 'UNB+UNOC:3+123:14+456:14+260728:1030+1'UNH+1+DESADV:D:96A:UN:EAN005'")), 'EDIFACT_DESADV');
t('EDIFACT INVOIC',
  zaznajFormat(b("UNB+UNOC:3+123:14+456:14+260728:1030+1'UNH+1+INVOIC:D:96A:UN'")), 'EDIFACT_INVOIC');
t('EDIFACT PRICAT',
  zaznajFormat(b("UNB+UNOC:3+1:14+2:14+260728:1030+1'UNH+1+PRICAT:D:96A:UN'")), 'EDIFACT_PRICAT');
t('PDF', zaznajFormat(Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(50)])), 'PDF_PREDLOGA');
t('XLSX (ZIP)', zaznajFormat(Buffer.concat([
    Buffer.from([0x50,0x4b,0x03,0x04]), Buffer.from('...[Content_Types].xml...xl/workbook.xml')
  ])), 'XLSX');
t('JSON', zaznajFormat(b('{"postavke":[]}')), 'JSON_LASTNI');
t('lastni XML', zaznajFormat(b('<Dobavnica><Postavka/></Dobavnica>')), 'XML_LASTNI');
t('prazno', zaznajFormat(Buffer.alloc(0), 'x.dat'), 'BREZ');
t('CSV s priponko .txt (vsebina odloca)',
  zaznajFormat(b('A;B;C\n1;2;3\n4;5;6'), 'dobavnica.txt'), 'CSV');
t('XML s priponko .txt (vsebina odloca)',
  zaznajFormat(b('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>'), 'x.txt'),
  'UBL_2_1_INVOICE');

console.log('\n' + (n ? `NEUSPESNO: ${n}` : 'VSI TESTI USPESNI'));
process.exit(n ? 1 : 0);
