import { razcleniNaziv, popraviVelikeCrke, predlagajArtikel } from '../../artifacts/web/src/pos/uvoz/naziv';
let n = 0;
const t = (o: string, d: unknown, p: unknown) => {
  const ok = String(d) === String(p); if (!ok) n++;
  console.log(`  ${ok ? 'OK    ' : 'NAPAKA'} ${o}\n           dobljeno: ${JSON.stringify(d)}${ok ? '' : `\n           pricakovano: ${JSON.stringify(p)}`}`);
};

console.log('=== Ciscenje naziva ===');
let r = razcleniNaziv('Čaj vrečka - Kamilica 20/1');
t('"Caj vrecka - Kamilica 20/1"', r.ocisceno, 'Čaj vrečka - Kamilica');
t('  -> enot v paketu', r.enotVPaketu, 20);

r = razcleniNaziv('PIVO SVETLO 0,5L POVRATNA 24/1 KARTON');
t('"PIVO SVETLO 0,5L POVRATNA 24/1 KARTON"', r.ocisceno, 'PIVO SVETLO 0,5L POVRATNA');
t('  -> enot v paketu', r.enotVPaketu, 24);
t('  -> vsebina OBDRZANA', r.vsebina, '0.5 l');
t('  -> odstranjeno', r.odstranjeno.join(', '), '24/1, KARTON');

r = razcleniNaziv('Radenska 24 x 0,33 l gajba');
t('"Radenska 24 x 0,33 l gajba"', r.ocisceno, 'Radenska 0,33 l');
t('  -> enot v paketu', r.enotVPaketu, 24);
t('  -> vsebina', r.vsebina, '0.33 l');

r = razcleniNaziv('Kava zrna Espresso 1 kg');
t('"Kava zrna Espresso 1 kg" (brez pakiranja)', r.ocisceno, 'Kava zrna Espresso 1 kg');
t('  -> enot v paketu null', r.enotVPaketu, null);
t('  -> vsebina', r.vsebina, '1 kg');

r = razcleniNaziv('Olje oljcno 1 L pak.');
t('"Olje oljcno 1 L pak."', r.ocisceno, 'Olje oljcno 1 L');

r = razcleniNaziv('');
t('prazen niz', r.ocisceno, '');

console.log('\n=== KLJUCNO: prostornina se NE sme izgubiti ===');
const a = razcleniNaziv('Pivo svetlo 0,5 l 24/1');
const b = razcleniNaziv('Pivo svetlo 0,33 l 24/1');
t('0,5 l ohranjen',  a.ocisceno, 'Pivo svetlo 0,5 l');
t('0,33 l ohranjen', b.ocisceno, 'Pivo svetlo 0,33 l');
t('naziva se razlikujeta', a.ocisceno !== b.ocisceno, 'true');

console.log('\n=== Velike zacetnice ===');
t('"PIVO SVETLO POVRATNA"', popraviVelikeCrke('PIVO SVETLO POVRATNA'), 'Pivo svetlo povratna');
t('"ČAJ VREČKA KAMILICA"',  popraviVelikeCrke('ČAJ VREČKA KAMILICA'), 'Čaj vrečka kamilica');
t('"Kava zrna Espresso" (ze pravilen, ne dira)', popraviVelikeCrke('Kava zrna Espresso'), 'Kava zrna Espresso');
t('"Radenska 0,5 L" (ze pravilen)', popraviVelikeCrke('Radenska 0,5 L'), 'Radenska 0,5 L');
// ZNANA OMEJITEV: blagovna znamka sredi naziva se zapise z malo.
t('OMEJITEV: "PIVO UNION" -> blagovna znamka z malo',
  popraviVelikeCrke('PIVO UNION'), 'Pivo union');
t('OMEJITEV: "MLEKO UHT 3,5%" -> kratica z malo',
  popraviVelikeCrke('MLEKO UHT 3,5%'), 'Mleko uht 3,5%');
t('enote po SI: "SIR GAVDA 500G"', popraviVelikeCrke('SIR GAVDA 500G'), 'Sir gavda 500g');
t('"SOK POMARANČA 1 L"', popraviVelikeCrke('SOK POMARANČA 1 L'), 'Sok pomaranča 1 l');

console.log('\n=== Predlog za obrazec ===');
let p = predlagajArtikel('PIVO SVETLO 0,5L POVRATNA 24/1', 'KOS', null);
t('naziv',        p.naziv, 'Pivo svetlo 0,5l povratna');
t('enot v paketu',p.enotVPaketu, 24);
t('osnovna enota izpeljana iz vsebine, NE iz KOS', p.osnovnaEnota, 'L');

p = predlagajArtikel('Kava zrna Espresso 1 kg', 'KG', 1);
t('masa -> KG', p.osnovnaEnota, 'KG');

p = predlagajArtikel('Serviete papirnate bele', 'KOM', 100);
t('brez vsebine -> enota z dobavnice', p.osnovnaEnota, 'KOM');
t('pakiranje z dokumenta', p.enotVPaketu, 100);

console.log('\n' + (n ? `NEUSPESNO: ${n}` : 'VSI TESTI USPESNI'));
process.exit(n ? 1 : 0);
