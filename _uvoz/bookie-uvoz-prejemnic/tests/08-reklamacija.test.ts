import { Decimal } from 'decimal.js';
import { pripraviReklamacijo, razvrstiOdstopanje, sklon,
         jePodrazitevSkritaVPakiranju, type OdstopanjeVrstica } from '../artifacts/api-server/src/lib/uvoz/reklamacija';
const D = (s: string | number) => new Decimal(s);
let n = 0;
const t = (o: string, d: unknown, p: unknown) => {
  const ok = String(d) === String(p); if (!ok) n++;
  console.log(`  ${ok ? 'OK    ' : 'NAPAKA'} ${o}: ${d}${ok ? '' : ` (pricakovano ${p})`}`);
};

console.log('=== Slovensko sklanjanje ob stevniku ===');
const P: [string,string,string,string] = ['postavka','postavki','postavke','postavk'];
for (const [k, pric] of [[1,'postavka'],[2,'postavki'],[3,'postavke'],[4,'postavke'],
                         [5,'postavk'],[11,'postavk'],[21,'postavk'],[102,'postavk'],
                         [103,'postavk'],[105,'postavk'],[0,'postavk']] as [number,string][])
  t(String(k), sklon(k, P), pric);

console.log('\n=== Razvrstitev odstopanja ===');
t('spremenjeno pakiranje -> PAKIRANJE',
  razvrstiOdstopanje({ prejsnjePakiranje: D(24), novoPakiranje: D(20),
                       prejsnjaCena: D('0.70'), novaCena: D('0.84') }), 'PAKIRANJE');
t('enako pakiranje -> CENA',
  razvrstiOdstopanje({ prejsnjePakiranje: D(24), novoPakiranje: D(24),
                       prejsnjaCena: D('0.70'), novaCena: D('0.78') }), 'CENA');
t('pakiranje neznano -> CENA',
  razvrstiOdstopanje({ prejsnjePakiranje: null, novoPakiranje: D(24),
                       prejsnjaCena: D('0.70'), novaCena: D('0.78') }), 'CENA');

console.log('\n=== Skrita podrazitev: cena kartona enaka, kosov manj ===');
// 16,80 EUR za karton. Prej 24 kosov (0,70/kos), zdaj 20 (0,84/kos).
t('16,80/24 -> 16,80/20 je SKRITA v pakiranju',
  jePodrazitevSkritaVPakiranju(D('0.70'), D('0.84'), D(24), D(20)), 'true');
// Ista sprememba pakiranja, a cena kartona je tudi zrasla -> ni le pakiranje
t('pakiranje + prava podrazitev -> NI zgolj pakiranje',
  jePodrazitevSkritaVPakiranju(D('0.70'), D('0.95'), D(24), D(20)), 'false');
t('pakiranje enako -> ni skrite podrazitve',
  jePodrazitevSkritaVPakiranju(D('0.70'), D('0.78'), D(24), D(24)), 'false');
console.log('         16,80/24 =', D('16.80').div(24).toFixed(4), 'EUR/kos');
console.log('         16,80/20 =', D('16.80').div(20).toFixed(4), 'EUR/kos  -> +20,0 %');

console.log('\n=== Priprava reklamacije ===');
const vrstice: OdstopanjeVrstica[] = [
  { prejemnicaStevilka: 'PR-2026-0041', stDokumenta: '333/2026', datum: '2026-01-03',
    artikelNaziv: 'Radenska 0,5 l', sifraDobavitelja: 'ART-2201', vrsta: 'PAKIRANJE',
    kolicinaEnot: D(40), prejsnjaCena: D('0.70'), novaCena: D('0.84'),
    prejsnjePakiranje: D(24), novoPakiranje: D(20), cenaPaket: D('16.80'),
    financniUcinek: D('5.60') },
  { prejemnicaStevilka: 'PR-2026-0044', stDokumenta: '341/2026', datum: '2026-01-10',
    artikelNaziv: 'Kava zrna Espresso', sifraDobavitelja: 'ART-1044', vrsta: 'CENA',
    kolicinaEnot: D(25), prejsnjaCena: D('12.25'), novaCena: D('13.60'),
    prejsnjePakiranje: null, novoPakiranje: null, cenaPaket: null,
    financniUcinek: D('33.75') },
  { prejemnicaStevilka: 'PR-2026-0044', stDokumenta: '341/2026', datum: '2026-01-10',
    artikelNaziv: 'Olje oljcno 1 l', sifraDobavitelja: null, vrsta: 'RABAT',
    kolicinaEnot: D(6), prejsnjaCena: D('8.03'), novaCena: D('8.45'),
    prejsnjePakiranje: null, novoPakiranje: null, cenaPaket: null,
    financniUcinek: D('2.52') },
];

const r = pripraviReklamacijo({
  dobaviteljNaziv: 'PRIMER TRGOVINA d.o.o.', dobaviteljDavcna: '12345678',
  nasNaziv: 'Gostilna Primer d.o.o.', nasNaslov: 'Slovenska cesta 1, 1000 Ljubljana',
  nasaDavcna: '87654321', obdobjeOd: '2026-01-01', obdobjeDo: '2026-01-31',
  vrstice,
});

t('postavk', r.steviloPostavk, 3);
t('skupni ucinek 5.60+33.75+2.52', r.skupniUcinek, '41.87');
t('vrst odstopanj', r.povzetekPoVrstah.length, 3);
t('najvecji ucinek prvi', r.povzetekPoVrstah[0].vrsta, 'CENA');
t('brez ujemanja s stevnikom v povzetku', r.besedilo.includes('Skupno število postavk: 3'), 'true');
 t('zadeva vsebuje obdobje', r.zadeva.includes('1. 1. 2026–31. 1. 2026'), 'true');
t('podrobnosti urejene po ucinku: kava prva',
  r.besedilo.indexOf('Kava zrna Espresso') < r.besedilo.indexOf('Radenska'), 'true');
t('pakiranje ima pojasnilo o nespremenjeni ceni paketa',
  r.besedilo.includes('Cena paketa nespremenjena: 16,80 EUR'), 'true');

console.log('\n--- izpis dokumenta ---\n');
console.log(r.besedilo);

console.log('\n' + (n ? `NEUSPESNO: ${n}` : 'VSI TESTI USPESNI'));
process.exit(n ? 1 : 0);
