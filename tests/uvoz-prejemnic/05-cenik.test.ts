import { readFileSync, writeFileSync } from 'node:fs';
import iconv from 'iconv-lite';
import { razcleniCenik, ugibajStolpce, type CenikProfil } from '../../artifacts/api-server/src/lib/uvoz/cenik';

// Poti do vzorcev so vezane na datoteko, ne na delovno mapo, da testi
// tečejo enako iz korena projekta in iz mape tests/.
const vzorec = (ime: string) => new URL(`./fixtures/${ime}`, import.meta.url);


let n = 0;
const t = (o: string, d: unknown, p: unknown) => {
  const ok = String(d) === String(p); if (!ok) n++;
  console.log(`  ${ok ? 'OK    ' : 'NAPAKA'} ${o}: ${d}${ok ? '' : ` (pricakovano ${p})`}`);
};

console.log('=== Ugibanje stolpcev iz glave ===');
const glava = ['Šifra artikla','EAN koda','Naziv izdelka','EM','Kos v pakiranju','Cena/pak','DDV %'];
const u = ugibajStolpce(glava);
t('sifra',        u.sifra, 0);
t('gtin',         u.gtin, 1);
t('naziv',        u.naziv, 2);
t('enota',        u.enota, 3);
t('enot v paketu',u.enotVPaketu, 4);
t('cena',         u.cena, 5);
t('ddv',          u.ddv, 6);

console.log('\n=== Trk: "Cena/pak" ustreza ceni IN pakiranju ===');
const g3 = ['Sifra','Naziv','Cena/pak','Kos v pakiranju'];
const u3 = ugibajStolpce(g3);
t('cena -> stolpec 2',        u3.cena, 2);
t('pakiranje -> stolpec 3',   u3.enotVPaketu, 3);
t('stolpca se ne prekrivata', u3.cena === u3.enotVPaketu, 'false');

const g4 = ['Sifra','Naziv','Cena/pak'];   // pakiranja sploh ni
const u4 = ugibajStolpce(g4);
t('brez locenega pakiranja: cena dobi stolpec', u4.cena, 2);

console.log('\n=== Ugibanje pri drugacnem poimenovanju ===');
const g2 = ['Koda','Barcode','Opis','ME','Pakiranje','Price','VAT'];
const u2 = ugibajStolpce(g2);
t('koda -> sifra', u2.sifra, 0);
t('barcode -> gtin', u2.gtin, 1);
t('opis -> naziv', u2.naziv, 2);
t('price -> cena', u2.cena, 5);

console.log('\n=== Razclenitev cenika (CP1250, vejica) ===');
const cenik = `Cenik dobavitelja, veljavnost od 01.01.2026

Šifra artikla;EAN koda;Naziv izdelka;EM;Kos v pakiranju;Cena/pak;DDV %
ART-9912;3838800000121;Čaj vrečka - Kamilica;KOM;20;5,476;9,5
ART-1044;3830012345670;Kava zrna Espresso 1 kg;KG;1;12,90;9,5
ART-2201;3838900007778;Radenska 0,5 L;KOM;24;16,80;9,5
ART-0000;3838800000123;Artikel z NAPACNO kodo;KOM;1;3,00;22
ART-BREZ;;Artikel brez cene;KOM;1;0;9,5
`;
writeFileSync(vzorec('cenik-generiran.csv'), iconv.encode(cenik, 'cp1250'));

const profil: CenikProfil = {
  decimalnoLocilo: ',',
  glavaVsebuje: ['naziv', 'cena'],
  stolpci: { sifra: 0, gtin: 1, naziv: 2, enota: 3, enotVPaketu: 4, cena: 5, ddv: 6 },
};
const { vrstice, napake } = razcleniCenik(readFileSync(vzorec('cenik-generiran.csv')), profil);

t('vrstic (brez tiste s ceno 0)', vrstice.length, 4);
t('vrstica 1 sifra',   vrstice[0].sifra, 'ART-9912');
t('vrstica 1 naziv',   vrstice[0].naziv, 'Čaj vrečka - Kamilica');
t('vrstica 1 pak',     vrstice[0].enotVPaketu, 20);
t('vrstica 1 cena/pak',vrstice[0].cenaPaket, '5.476');
t('vrstica 1 cena/kos',vrstice[0].cenaEnota, '0.2738');
t('vrstica 3 cena/kos',vrstice[2].cenaEnota, '0.7');
t('napacna kontrolna stevka -> gtin null', vrstice[3].gtin, 'null');
t('napaka zabelezena', napake.length, 1);
console.log('         ' + napake[0]);

console.log('\n=== Cena na enoto je kljucna ===');
console.log('  Cenik navaja ceno KARTONA (16,80 za 24 kosov).');
console.log('  V preslikavo gre cena KOSA:', vrstice[2].cenaEnota?.toString());
console.log('  Ce bi shranili 16,80, bi kontrola odstopanj primerjala kartone s kosi.');

console.log('\n' + (n ? `NEUSPESNO: ${n}` : 'VSI TESTI USPESNI'));
process.exit(n ? 1 : 0);
