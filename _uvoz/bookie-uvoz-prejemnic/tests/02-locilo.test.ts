import { zaznajLocilo } from '../artifacts/api-server/src/lib/uvoz/parser-csv';
let n = 0;
const t = (opis: string, vhod: string, pricakovano: string) => {
  const d = zaznajLocilo(vhod);
  const ok = d === pricakovano;
  if (!ok) n++;
  console.log(`  ${ok ? 'OK    ' : 'NAPAKA'} ${opis} -> ${JSON.stringify(d)}`);
};
console.log('=== Zaznava locila, robni primeri ===');
t('podpicje z uvodnimi vrsticami brez locil (prejsnja napaka)',
  'Racun st. 333/2026\nDatum: 03.01.2026\n\nA;B;C;D\n1;2,50;3;4\n5;6,10;7;8', ';');
t('vejica kot pravo locilo, decimalke s piko',
  'A,B,C\n1,2.50,3\n4,5.10,6', ',');
t('tabulator',           'A\tB\tC\n1\t2\t3\n4\t5\t6', '\t');
t('navpicnica',          'A|B|C\n1|2|3\n4|5|6', '|');
t('samo en stolpec',     'A\n1\n2', ';');
t('vejice le v decimalkah, podpicje pravo',
  'Naziv;Cena\nPivo;1,50\nSok;2,30\nVoda;0,90', ';');
console.log('\n' + (n ? `NEUSPESNO: ${n}` : 'VSI TESTI USPESNI'));
process.exit(n ? 1 : 0);
