// artifacts/api-server/src/lib/uvoz/reklamacija.ts
//
// Priprava reklamacije iz odkritih odstopanj.
//
// To je edini del modula z neposredno merljivim donosom. Vse ostalo
// obstaja zato, da so številke tu verodostojne.
//
// Dokument je namenoma besedilo, ne PDF: v praksi se reklamacija pošlje
// po e-pošti komercialistu, ki pogosto odgovori kar v telesu sporočila.

import { Decimal } from 'decimal.js';

// =====================================================================
// Model
// =====================================================================

export type VrstaOdstopanja =
  | 'CENA'
  | 'PAKIRANJE'
  | 'KOLICINA'
  | 'RABAT'
  | 'PODVOJEN_STROSEK';

export interface OdstopanjeVrstica {
  prejemnicaStevilka: string;
  stDokumenta: string | null;
  datum: string;
  artikelNaziv: string;
  sifraDobavitelja: string | null;
  vrsta: VrstaOdstopanja;
  kolicinaEnot: Decimal;
  prejsnjaCena: Decimal | null;
  novaCena: Decimal;
  prejsnjePakiranje: Decimal | null;
  novoPakiranje: Decimal | null;
  cenaPaket: Decimal | null;
  financniUcinek: Decimal;
}

export interface ReklamacijaVhod {
  dobaviteljNaziv: string;
  dobaviteljDavcna: string | null;
  nasNaziv: string;
  nasNaslov: string | null;
  nasaDavcna: string | null;
  obdobjeOd: string;
  obdobjeDo: string;
  vrstice: OdstopanjeVrstica[];
  opomba?: string | null;
}

export interface Reklamacija {
  zadeva: string;
  besedilo: string;
  skupniUcinek: Decimal;
  steviloPostavk: number;
  /** postavke, razvrščene po učinku — za pregled pred pošiljanjem */
  povzetekPoVrstah: Array<{ vrsta: VrstaOdstopanja; postavk: number; ucinek: Decimal }>;
}

// =====================================================================
// Oblikovanje
// =====================================================================

const denar = (d: Decimal | null, decimalk = 2): string =>
  d === null
    ? '—'
    : new Intl.NumberFormat('sl-SI', {
        minimumFractionDigits: decimalk,
        maximumFractionDigits: decimalk,
      }).format(Number(d.toString()));

const datum = (iso: string): string => {
  const [l, m, d] = iso.split('-');
  return d && m && l ? `${Number(d)}. ${Number(m)}. ${l}` : iso;
};

const odstotek = (nova: Decimal, prejsnja: Decimal | null): string => {
  if (!prejsnja || prejsnja.lte(0)) return '';
  const r = nova.minus(prejsnja).div(prejsnja).mul(100);
  return `${r.gt(0) ? '+' : ''}${denar(r, 1)} %`;
};

const OPIS_VRSTE: Record<VrstaOdstopanja, string> = {
  CENA: 'Sprememba cene brez obvestila',
  PAKIRANJE: 'Sprememba pakiranja ob nespremenjeni ceni paketa',
  KOLICINA: 'Odstopanje zaračunane in prevzete količine',
  RABAT: 'Dogovorjeni rabat ni bil upoštevan',
  PODVOJEN_STROSEK: 'Podvojeno zaračunan strošek',
};

/**
 * Slovensko sklanjanje ob števniku.
 *
 * Slovenščina ima štiri oblike, ne dveh: ednino (1), dvojino (2),
 * imenovalnik množine (3, 4) in rodilnik množine (5 in več).
 *
 * ⚠ OMEJITEV, ki je nisem uspel zanesljivo razrešiti: pri sestavljenih
 * števnikih, ki se končajo na 1–4 (21, 22, 103 …), viri ne povedo
 * enoznačno, ali ujemanje sledi zadnjemu členu (kot v hrvaščini:
 * "21 postavka") ali ostane rodilnik množine ("21 postavk").
 * Tu je izbrana druga, konservativna možnost — za vrednosti nad 20
 * se vedno uporabi rodilnik množine.
 *
 * Zato ta funkcija NI uporabljena v besedilu reklamacije, kjer je
 * število poljubno veliko. Tam so stavki zgrajeni tako, da ujemanja
 * sploh ne potrebujejo ("Število postavk: 12"). Funkcija ostaja za
 * mesta v vmesniku, kjer je število majhno in znano.
 */
export function sklon(
  n: number,
  oblike: [ednina: string, dvojina: string, tri_stiri: string, mnozina: string],
): string {
  const o = Math.abs(Math.trunc(n));
  if (o > 20) return oblike[3];
  if (o === 1) return oblike[0];
  if (o === 2) return oblike[1];
  if (o === 3 || o === 4) return oblike[2];
  return oblike[3];
}

export const POSTAVKA: [string, string, string, string] = [
  'postavka', 'postavki', 'postavke', 'postavk',
];

// =====================================================================
// Sestavljanje
// =====================================================================

export function pripraviReklamacijo(v: ReklamacijaVhod): Reklamacija {
  const vrstice = [...v.vrstice].sort((a, b) =>
    Number(b.financniUcinek.abs().minus(a.financniUcinek.abs())),
  );

  const skupniUcinek = vrstice.reduce(
    (a, r) => a.plus(r.financniUcinek),
    new Decimal(0),
  );

  // Povzetek po vrstah, da prejemnik takoj vidi, za kaj gre.
  const poVrstah = new Map<VrstaOdstopanja, { postavk: number; ucinek: Decimal }>();
  for (const r of vrstice) {
    const t = poVrstah.get(r.vrsta) ?? { postavk: 0, ucinek: new Decimal(0) };
    t.postavk += 1;
    t.ucinek = t.ucinek.plus(r.financniUcinek);
    poVrstah.set(r.vrsta, t);
  }

  const povzetekPoVrstah = [...poVrstah.entries()]
    .map(([vrsta, t]) => ({ vrsta, ...t }))
    .sort((a, b) => Number(b.ucinek.abs().minus(a.ucinek.abs())));

  const zadeva =
    `Reklamacija obračuna — ${v.dobaviteljNaziv}, ` +
    `obdobje ${datum(v.obdobjeOd)}–${datum(v.obdobjeDo)}`;

  const del: string[] = [];

  del.push(`${v.nasNaziv}`);
  if (v.nasNaslov) del.push(v.nasNaslov);
  if (v.nasaDavcna) del.push(`Davčna številka: ${v.nasaDavcna}`);
  del.push('');
  del.push(v.dobaviteljNaziv);
  if (v.dobaviteljDavcna) del.push(`Davčna številka: ${v.dobaviteljDavcna}`);
  del.push('');
  del.push(`Zadeva: ${zadeva}`);
  del.push('');
  del.push('Spoštovani,');
  del.push('');
  del.push(
    `pri usklajevanju prevzemnih dokumentov za obdobje od ${datum(v.obdobjeOd)} ` +
    `do ${datum(v.obdobjeDo)} smo ugotovili spodaj navedena odstopanja. ` +
    `Prosimo za pojasnilo oziroma popravek obračuna.`,
  );
  del.push('');

  // ---- povzetek ----
  del.push('POVZETEK');
  del.push('');
  for (const p of povzetekPoVrstah) {
    // Stavek je zgrajen brez ujemanja s števnikom — glej opombo pri sklon().
    del.push(
      `  ${OPIS_VRSTE[p.vrsta]} — št. postavk: ${p.postavk}, ` +
      `učinek ${denar(p.ucinek)} EUR`,
    );
  }
  del.push('');
  del.push(
    `  Skupno število postavk: ${vrstice.length}. ` +
    `Skupni učinek: ${denar(skupniUcinek)} EUR.`,
  );
  del.push('');

  // ---- podrobnosti ----
  del.push('PODROBNOSTI');
  del.push('');

  vrstice.forEach((r, i) => {
    del.push(`${i + 1}. ${r.artikelNaziv}`);
    const sklic = [
      r.stDokumenta ? `dobavnica ${r.stDokumenta}` : null,
      `prevzem ${r.prejemnicaStevilka}`,
      datum(r.datum),
      r.sifraDobavitelja ? `vaša šifra ${r.sifraDobavitelja}` : null,
    ].filter(Boolean);
    del.push(`   ${sklic.join(' · ')}`);

    if (r.vrsta === 'PAKIRANJE') {
      // Ta primer je treba razložiti: cena paketa je nespremenjena,
      // zato podražitve na računu ni videti.
      del.push(
        `   Doslej ${denar(r.prejsnjePakiranje, 0)} enot v paketu, ` +
        `zdaj ${denar(r.novoPakiranje, 0)}.`,
      );
      if (r.cenaPaket) {
        del.push(`   Cena paketa nespremenjena: ${denar(r.cenaPaket)} EUR.`);
      }
      del.push(
        `   Cena enote: ${denar(r.prejsnjaCena, 4)} → ${denar(r.novaCena, 4)} EUR ` +
        `(${odstotek(r.novaCena, r.prejsnjaCena)}).`,
      );
    } else {
      del.push(
        `   Cena enote: ${denar(r.prejsnjaCena, 4)} → ${denar(r.novaCena, 4)} EUR ` +
        `(${odstotek(r.novaCena, r.prejsnjaCena)}).`,
      );
    }

    del.push(
      `   Prevzeto ${denar(r.kolicinaEnot, 3)} enot, ` +
      `učinek ${denar(r.financniUcinek)} EUR.`,
    );
    del.push('');
  });

  if (v.opomba) {
    del.push(v.opomba);
    del.push('');
  }

  del.push(
    'Prosimo za pisni odgovor. V primeru, da gre za spremembo cenika, ' +
    'prosimo za posredovanje veljavnega cenika z datumom uveljavitve.',
  );
  del.push('');
  del.push('Lep pozdrav,');
  del.push(v.nasNaziv);

  return {
    zadeva,
    besedilo: del.join('\n'),
    skupniUcinek,
    steviloPostavk: vrstice.length,
    povzetekPoVrstah,
  };
}

// =====================================================================
// Razvrstitev odstopanja
// =====================================================================

/**
 * Določi vrsto odstopanja iz podatkov postavke.
 *
 * Vrstni red preverjanja ni poljuben: sprememba pakiranja se mora
 * prepoznati PRED spremembo cene, sicer se prikaže kot navadna
 * podražitev in izgubi pojasnilo, ki je bistvo primera.
 */
export function razvrstiOdstopanje(r: {
  prejsnjePakiranje: Decimal | null;
  novoPakiranje: Decimal | null;
  prejsnjaCena: Decimal | null;
  novaCena: Decimal;
}): VrstaOdstopanja {
  if (
    r.prejsnjePakiranje &&
    r.novoPakiranje &&
    !r.prejsnjePakiranje.eq(r.novoPakiranje)
  ) {
    return 'PAKIRANJE';
  }
  return 'CENA';
}

/**
 * Ali je sprememba cene posledica zgolj spremembe pakiranja?
 *
 * Če je cena paketa nespremenjena in se je spremenilo le število enot,
 * je podražitev na enoto natanko obratno sorazmerna spremembi pakiranja.
 * To je najbolj prikrit primer, ker na računu ni videti ničesar.
 */
export function jePodrazitevSkritaVPakiranju(
  prejsnjaCenaEnote: Decimal,
  novaCenaEnote: Decimal,
  prejsnjePakiranje: Decimal,
  novoPakiranje: Decimal,
  toleranca = new Decimal('0.005'),
): boolean {
  if (prejsnjePakiranje.lte(0) || novoPakiranje.lte(0)) return false;
  if (prejsnjaCenaEnote.lte(0)) return false;

  const razmerjeCen = novaCenaEnote.div(prejsnjaCenaEnote);
  const razmerjePakiranj = prejsnjePakiranje.div(novoPakiranje);

  return razmerjeCen.minus(razmerjePakiranj).abs().lte(toleranca);
}
