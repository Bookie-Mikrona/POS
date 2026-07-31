// artifacts/web/src/pos/uvoz/naziv.ts
//
// Čiščenje naziva z dobavnice pred vpisom v šifrant.
//
// Dobavitelji v naziv vpisujejo pakiranje, enoto in včasih ceno:
//   "Čaj vrečka - Kamilica 20/1"
//   "PIVO SVETLO 0,5L POVRATNA 24/1 KARTON"
//   "Kava zrna Espresso 1 kg (vrečka)"
//
// V šifrantu je pakiranje ločeno polje, zato ga iz naziva odstranimo.
// Prostornino in maso izdelka pa OBDRŽIMO — "Pivo 0,5 l" in "Pivo 0,33 l"
// sta različna artikla in naziv je edino, kar ju loči.

export interface RazclenjenNaziv {
  /** naziv brez pripon pakiranja, primeren za šifrant */
  ocisceno: string;
  /** izluščeno število enot v paketu, če je bilo v nazivu */
  enotVPaketu: number | null;
  /** izluščena prostornina ali masa enote, npr. "0.5 l" */
  vsebina: string | null;
  /** kar je bilo odstranjeno — prikaže se uporabniku, da lahko preveri */
  odstranjeno: string[];
}

// ---------------------------------------------------------------------
// Vzorci
// ---------------------------------------------------------------------

/** "20/1", "24/1", "6/1" — število kosov v transportnem pakiranju. */
const PAKIRANJE_POSEVNICA = /(?:^|\s)(\d{1,4})\s*\/\s*1(?=\s|$)/;

/** "6x1L", "24 x 0,33 l", "12X500ML" */
const PAKIRANJE_KRAT =
  /(?:^|\s)(\d{1,4})\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(l|dl|cl|ml|kg|g|dag|kos|kom)\b/i;

/** samostojna beseda za vrsto pakiranja */
const BESEDA_PAKIRANJA =
  /(?:^|\s)(karton|kart\.?|kar\.?|gajba|gaj\.?|paket|pak\.?|zaboj|sod|paleta|pal\.?|display|disp\.?)(?=\s|$)/gi;

/** prostornina ali masa ENOTE — to obdržimo */
const VSEBINA = /(\d+(?:[.,]\d+)?)\s*(l|dl|cl|ml|kg|g|dag)\b/i;

/** ostanki, ki v šifrantu nimajo kaj iskati */
const SMETI = [
  /\s*\(\s*\)\s*/g,          // prazni oklepaji po odstranjevanju
  /\s*[-–—]\s*$/,            // vezaj na koncu
  /^\s*[-–—]\s*/,            // vezaj na začetku
  /\s{2,}/g,                 // večkratni presledki
];

// ---------------------------------------------------------------------
// Glavna funkcija
// ---------------------------------------------------------------------

export function razcleniNaziv(surov: string): RazclenjenNaziv {
  const odstranjeno: string[] = [];
  let s = String(surov ?? '').trim();

  if (!s) return { ocisceno: '', enotVPaketu: null, vsebina: null, odstranjeno };

  // 1. Vsebina enote — najprej samo PREBEREMO, ne odstranimo.
  const mVsebina = s.match(VSEBINA);
  const vsebina = mVsebina
    ? `${mVsebina[1].replace(',', '.')} ${mVsebina[2].toLowerCase()}`
    : null;

  // 2. "24 x 0,33 l" — število pred krat je pakiranje, za njim je vsebina.
  let enotVPaketu: number | null = null;
  const mKrat = s.match(PAKIRANJE_KRAT);
  if (mKrat) {
    enotVPaketu = Number(mKrat[1]);
    // Odstranimo samo množitelj, vsebino pustimo: "24 x 0,33 l" -> "0,33 l"
    const zamenjava = ` ${mKrat[2]} ${mKrat[3]}`;
    odstranjeno.push(`${mKrat[1]}×`);
    s = s.replace(mKrat[0], zamenjava);
  }

  // 3. "20/1" — pakiranje brez enote.
  const mPosevnica = s.match(PAKIRANJE_POSEVNICA);
  if (mPosevnica) {
    enotVPaketu ??= Number(mPosevnica[1]);
    odstranjeno.push(mPosevnica[1] + '/1');
    s = s.replace(mPosevnica[0], ' ');
  }

  // 4. Besede za vrsto pakiranja.
  s = s.replace(BESEDA_PAKIRANJA, (ujem) => {
    odstranjeno.push(ujem.trim());
    return ' ';
  });

  // 5. Pospravi.
  for (const vzorec of SMETI) s = s.replace(vzorec, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[\s,;-]+$/, '').trim();

  return {
    ocisceno: s || surov.trim(),   // nikoli ne vrni praznega niza
    enotVPaketu,
    vsebina,
    odstranjeno,
  };
}

// ---------------------------------------------------------------------
// Velike začetnice
// ---------------------------------------------------------------------

/**
 * "PIVO SVETLO POVRATNA" -> "Pivo svetlo povratna"
 *
 * Dobavitelji pogosto pošiljajo nazive z velikimi tiskanimi črkami.
 * V šifrantu so med ročno vpisanimi artikli vpadljivi in otežijo
 * iskanje po podobnosti.
 *
 * Uporabljen je STAVČNI zapis (velika samo prva črka), ne naslovni,
 * ker je to slovenska navada pri nazivih izdelkov.
 *
 * DVE OMEJITVI, obe posledici tega, da je izvirnik pisan z velikimi
 * tiskanimi črkami in razlikovanja ni mogoče obnoviti:
 *   - blagovne znamke se zapišejo z malo: "PIVO UNION" -> "Pivo union"
 *   - kratice prav tako: "MLEKO UHT 3,5%" -> "Mleko uht 3,5%"
 * Zanesljivega načina za prepoznavo lastnih imen in kratic ni, zato
 * tega ne ugibamo. Polje v obrazcu je urejljivo in predlog je le
 * predlog, ki ga uporabnik potrdi.
 */
export function popraviVelikeCrke(naziv: string): string {
  const s = String(naziv ?? '').trim();
  if (!s) return s;

  // Popravljamo samo, kadar je večina črk velikih. Naziv, ki je že
  // pravilno zapisan, pustimo pri miru.
  const crke = s.replace(/[^a-zčšžA-ZČŠŽ]/g, '');
  if (!crke) return s;
  const velikih = (crke.match(/[A-ZČŠŽ]/g) ?? []).length;
  if (velikih / crke.length < 0.7) return s;

  // Vse z malo, nato velika samo prva črka. Enote se s tem zapišejo
  // pravilno po SI ("KG" -> "kg", "ML" -> "ml").
  return s
    .toLocaleLowerCase('sl-SI')
    .replace(/^(\p{L})/u, (c) => c.toLocaleUpperCase('sl-SI'));
}

// ---------------------------------------------------------------------
// Predlog za obrazec novega artikla
// ---------------------------------------------------------------------

export interface PredlogArtikla {
  naziv: string;
  enotVPaketu: number | null;
  vsebina: string | null;
  odstranjeno: string[];
  /** privzeta enota, izpeljana iz vsebine ali enote na dobavnici */
  osnovnaEnota: string | null;
}

/**
 * Osnovna enota se izpelje iz vsebine, ne iz enote na dobavnici.
 *
 * Dobavnica navaja "KOM" za steklenico piva 0,5 l. Če v šifrant vpišemo
 * KOS, normativ v decilitrih ne bo mogel razknjižiti. Zato: kadar naziv
 * vsebuje prostornino ali maso, je osnovna enota L oziroma KG.
 */
export function predlagajArtikel(
  izvNaziv: string,
  izvEnota: string | null,
  enotVPaketuZDokumenta: number | null,
): PredlogArtikla {
  const r = razcleniNaziv(izvNaziv);
  const naziv = popraviVelikeCrke(r.ocisceno);

  let osnovnaEnota: string | null = izvEnota;
  if (r.vsebina) {
    const enota = r.vsebina.split(' ')[1]?.toLowerCase();
    if (['l', 'dl', 'cl', 'ml'].includes(enota)) osnovnaEnota = 'L';
    else if (['kg', 'g', 'dag'].includes(enota)) osnovnaEnota = 'KG';
  }

  return {
    naziv,
    enotVPaketu: r.enotVPaketu ?? enotVPaketuZDokumenta,
    vsebina: r.vsebina,
    odstranjeno: r.odstranjeno,
    osnovnaEnota,
  };
}
