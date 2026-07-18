/**
 * Standardni slovenski kontni plan (SRS — Slovenski računovodski standardi).
 * Razredi 0–9 po veljavnih SRS standardih za gospodarske družbe.
 */

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface AccountTemplate {
  code: string;
  name: string;
  type: AccountType;
  parentCode?: string;
}

export const SLOVENIAN_CHART_OF_ACCOUNTS: AccountTemplate[] = [
  // ─── Razred 0: Dolgoročna sredstva ──────────────────────────────────────────
  { code: "00", name: "Neopredmetena sredstva", type: "asset" },
  { code: "001", name: "Odhodki za razvoj", type: "asset", parentCode: "00" },
  { code: "002", name: "Patenti in licence", type: "asset", parentCode: "00" },
  { code: "003", name: "Dobro ime", type: "asset", parentCode: "00" },
  { code: "004", name: "Blagovne znamke", type: "asset", parentCode: "00" },
  { code: "009", name: "Dolgoročne aktivne časovne razmejitve", type: "asset", parentCode: "00" },
  { code: "01", name: "Nepremičnine", type: "asset" },
  { code: "010", name: "Zemljišča", type: "asset", parentCode: "01" },
  { code: "011", name: "Poslovne stavbe in prostori", type: "asset", parentCode: "01" },
  { code: "012", name: "Stanovanjske stavbe in prostori", type: "asset", parentCode: "01" },
  { code: "019", name: "Popravek vrednosti nepremičnin", type: "asset", parentCode: "01" },
  { code: "02", name: "Oprema in druga opredmetena osnovna sredstva", type: "asset" },
  { code: "020", name: "Oprema", type: "asset", parentCode: "02" },
  { code: "021", name: "Vozila", type: "asset", parentCode: "02" },
  { code: "022", name: "Drobni inventar", type: "asset", parentCode: "02" },
  { code: "029", name: "Popravek vrednosti opreme", type: "asset", parentCode: "02" },
  { code: "03", name: "Naložbene nepremičnine", type: "asset" },
  { code: "04", name: "Dolgoročne finančne naložbe", type: "asset" },
  { code: "040", name: "Dolgoročne finančne naložbe v skupini", type: "asset", parentCode: "04" },
  { code: "041", name: "Dolgoročne finančne naložbe v pridruženih", type: "asset", parentCode: "04" },
  { code: "042", name: "Dolgoročne finančne naložbe — drugi", type: "asset", parentCode: "04" },
  { code: "05", name: "Dolgoročne poslovne terjatve", type: "asset" },
  { code: "06", name: "Odložene terjatve za davek", type: "asset" },

  // ─── Razred 1: Zaloge in kratkoročne terjatve ───────────────────────────────
  { code: "10", name: "Zaloge materiala", type: "asset" },
  { code: "100", name: "Material na zalogi", type: "asset", parentCode: "10" },
  { code: "101", name: "Material v predelavi", type: "asset", parentCode: "10" },
  { code: "11", name: "Nedokončana proizvodnja in storitve", type: "asset" },
  { code: "12", name: "Zaloge gotovih proizvodov", type: "asset" },
  { code: "13", name: "Zaloge blaga", type: "asset" },
  { code: "130", name: "Blago na zalogi", type: "asset", parentCode: "13" },
  { code: "14", name: "Kratkoročne poslovne terjatve do kupcev", type: "asset" },
  { code: "140", name: "Terjatve do domačih kupcev", type: "asset", parentCode: "14" },
  { code: "141", name: "Terjatve do tujih kupcev", type: "asset", parentCode: "14" },
  { code: "149", name: "Popravek vrednosti terjatev do kupcev", type: "asset", parentCode: "14" },
  { code: "15", name: "Kratkoročne poslovne terjatve do drugih", type: "asset" },
  { code: "16", name: "Terjatve za DDV", type: "asset" },
  { code: "160", name: "Vstopni DDV — osnovna stopnja (22%)", type: "asset", parentCode: "16" },
  { code: "161", name: "Vstopni DDV — znižana stopnja (9,5%)", type: "asset", parentCode: "16" },
  { code: "162", name: "Vstopni DDV — nulta stopnja (0%)", type: "asset", parentCode: "16" },
  { code: "17", name: "Kratkoročne finančne terjatve", type: "asset" },
  { code: "19", name: "Kratkoročne aktivne časovne razmejitve", type: "asset" },
  { code: "190", name: "Vnaprej plačani stroški", type: "asset", parentCode: "19" },
  { code: "191", name: "Odhodki prihodnjih obdobij", type: "asset", parentCode: "19" },

  // ─── Razred 2: Kratkoročne naložbe in denarna sredstva ──────────────────────
  { code: "20", name: "Kratkoročne finančne naložbe", type: "asset" },
  { code: "22", name: "Denarna sredstva — blagajna", type: "asset" },
  { code: "220", name: "Gotovina v blagajni", type: "asset", parentCode: "22" },
  { code: "23", name: "Denarna sredstva na računih", type: "asset" },
  { code: "230", name: "Transakcijski račun", type: "asset", parentCode: "23" },
  { code: "231", name: "Devizni račun", type: "asset", parentCode: "23" },
  { code: "25", name: "Denarna sredstva z omejenim razpolaganjem", type: "asset" },

  // ─── Razred 3: Kapital ──────────────────────────────────────────────────────
  { code: "30", name: "Vpoklicani kapital", type: "equity" },
  { code: "300", name: "Osnovni kapital", type: "equity", parentCode: "30" },
  { code: "31", name: "Kapitalske rezerve", type: "equity" },
  { code: "32", name: "Rezerve iz dobička", type: "equity" },
  { code: "320", name: "Zakonske rezerve", type: "equity", parentCode: "32" },
  { code: "321", name: "Statutarne rezerve", type: "equity", parentCode: "32" },
  { code: "323", name: "Druge rezerve iz dobička", type: "equity", parentCode: "32" },
  { code: "33", name: "Preneseni čisti dobiček ali izguba", type: "equity" },
  { code: "34", name: "Čisti poslovni izid poslovnega leta", type: "equity" },

  // ─── Razred 4: Obveznosti ───────────────────────────────────────────────────
  { code: "40", name: "Dolgoročne finančne obveznosti", type: "liability" },
  { code: "400", name: "Dolgoročne obveznosti za kredite — domači", type: "liability", parentCode: "40" },
  { code: "401", name: "Dolgoročne obveznosti za kredite — tuji", type: "liability", parentCode: "40" },
  { code: "41", name: "Dolgoročne poslovne obveznosti", type: "liability" },
  { code: "42", name: "Kratkoročne finančne obveznosti", type: "liability" },
  { code: "420", name: "Kratkoročne obveznosti za kredite — domači", type: "liability", parentCode: "42" },
  { code: "421", name: "Kratkoročne obveznosti za kredite — tuji", type: "liability", parentCode: "42" },
  { code: "43", name: "Kratkoročne poslovne obveznosti do dobaviteljev", type: "liability" },
  { code: "430", name: "Obveznosti do domačih dobaviteljev", type: "liability", parentCode: "43" },
  { code: "431", name: "Obveznosti do tujih dobaviteljev", type: "liability", parentCode: "43" },
  { code: "44", name: "Kratkoročne poslovne obveznosti do zaposlenih", type: "liability" },
  { code: "440", name: "Obveznosti za bruto plače", type: "liability", parentCode: "44" },
  { code: "45", name: "Kratkoročne poslovne obveznosti do države", type: "liability" },
  { code: "450", name: "Obveznosti za DDV", type: "liability", parentCode: "45" },
  { code: "451", name: "Obveznosti za davek od dohodkov pravnih oseb", type: "liability", parentCode: "45" },
  { code: "452", name: "Obveznosti za prispevke in davke iz plač", type: "liability", parentCode: "45" },
  { code: "46", name: "Kratkoročne poslovne obveznosti do ustanoviteljev", type: "liability" },
  { code: "48", name: "Odložene obveznosti za davek", type: "liability" },
  { code: "49", name: "Kratkoročne pasivne časovne razmejitve", type: "liability" },
  { code: "490", name: "Kratkoročno odloženi prihodki", type: "liability", parentCode: "49" },
  { code: "491", name: "Vnaprej vračunani odhodki", type: "liability", parentCode: "49" },

  // ─── Razred 5: Stroški ──────────────────────────────────────────────────────
  { code: "50", name: "Stroški materiala", type: "expense" },
  { code: "500", name: "Stroški materiala", type: "expense", parentCode: "50" },
  { code: "501", name: "Stroški energije", type: "expense", parentCode: "50" },
  { code: "502", name: "Stroški pisarniškega materiala in inventarja", type: "expense", parentCode: "50" },
  { code: "51", name: "Stroški storitev", type: "expense" },
  { code: "510", name: "Prevozne storitve", type: "expense", parentCode: "51" },
  { code: "511", name: "Stroški najemnin", type: "expense", parentCode: "51" },
  { code: "512", name: "Stroški vzdrževanja", type: "expense", parentCode: "51" },
  { code: "513", name: "Računovodske, revizijske in pravne storitve", type: "expense", parentCode: "51" },
  { code: "514", name: "Stroški oglaševanja in trženja", type: "expense", parentCode: "51" },
  { code: "515", name: "Komunikacijske storitve", type: "expense", parentCode: "51" },
  { code: "519", name: "Drugi stroški storitev", type: "expense", parentCode: "51" },
  { code: "52", name: "Stroški dela", type: "expense" },
  { code: "520", name: "Stroški plač", type: "expense", parentCode: "52" },
  { code: "521", name: "Stroški nadomestil plač", type: "expense", parentCode: "52" },
  { code: "522", name: "Stroški prispevkov za socialno varnost", type: "expense", parentCode: "52" },
  { code: "523", name: "Stroški pokojninskega zavarovanja", type: "expense", parentCode: "52" },
  { code: "53", name: "Amortizacija", type: "expense" },
  { code: "530", name: "Amortizacija neopredmetenih sredstev", type: "expense", parentCode: "53" },
  { code: "531", name: "Amortizacija opredmetenih osnovnih sredstev", type: "expense", parentCode: "53" },
  { code: "54", name: "Rezervacije", type: "expense" },
  { code: "55", name: "Drugi poslovni odhodki", type: "expense" },
  { code: "550", name: "Dnevnice in potni stroški", type: "expense", parentCode: "55" },
  { code: "551", name: "Reprezentanca", type: "expense", parentCode: "55" },
  { code: "552", name: "Zavarovalniške premije", type: "expense", parentCode: "55" },
  { code: "559", name: "Drugi odhodki", type: "expense", parentCode: "55" },

  // ─── Razred 6: Prihodki ─────────────────────────────────────────────────────
  { code: "60", name: "Prihodki od prodaje", type: "revenue" },
  { code: "600", name: "Prihodki od prodaje proizvodov in storitev — domači", type: "revenue", parentCode: "60" },
  { code: "601", name: "Prihodki od prodaje proizvodov in storitev — tuji", type: "revenue", parentCode: "60" },
  { code: "602", name: "Prihodki od prodaje blaga — domači", type: "revenue", parentCode: "60" },
  { code: "603", name: "Prihodki od prodaje blaga — tuji", type: "revenue", parentCode: "60" },
  { code: "61", name: "Sprememba vrednosti zalog", type: "revenue" },
  { code: "62", name: "Usredstveni lastni proizvodi in storitve", type: "revenue" },
  { code: "63", name: "Subvencije, dotacije in premije", type: "revenue" },
  { code: "65", name: "Drugi poslovni prihodki", type: "revenue" },
  { code: "66", name: "Finančni prihodki iz deležev", type: "revenue" },
  { code: "67", name: "Finančni prihodki iz danih posojil", type: "revenue" },
  { code: "68", name: "Finančni prihodki iz poslovnih terjatev", type: "revenue" },

  // ─── Razred 7: Odhodki iz financiranja ─────────────────────────────────────
  { code: "72", name: "Prevrednotovalni poslovni odhodki", type: "expense" },
  { code: "720", name: "Prevrednotovalni odhodki pri neopredmetenih sredstvih", type: "expense", parentCode: "72" },
  { code: "721", name: "Prevrednotovalni odhodki pri opredmetenih sredstvih", type: "expense", parentCode: "72" },
  { code: "722", name: "Prevrednotovalni odhodki pri zalogah", type: "expense", parentCode: "72" },
  { code: "723", name: "Prevrednotovalni odhodki pri terjatvah", type: "expense", parentCode: "72" },
  { code: "75", name: "Finančni odhodki za obresti", type: "expense" },
  { code: "750", name: "Obresti od kreditov", type: "expense", parentCode: "75" },
  { code: "76", name: "Finančni odhodki iz poslovnih obveznosti", type: "expense" },

  // ─── Razred 8: Davki in poslovni izid ──────────────────────────────────────
  { code: "80", name: "Davek od dobička", type: "expense" },
  { code: "800", name: "Davek od dohodkov pravnih oseb", type: "expense", parentCode: "80" },
  { code: "81", name: "Odloženi davek", type: "expense" },
  { code: "88", name: "Čisti dobiček poslovnega leta", type: "equity" },
  { code: "89", name: "Čista izguba poslovnega leta", type: "equity" },
];

/**
 * Razreši hierarhijo računov: po prvem insertu (brez parentId) posodobi parentId.
 * Vrne mapo code → parentCode za kasnejšo resolucijo.
 */
export function getParentCodeMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of SLOVENIAN_CHART_OF_ACCOUNTS) {
    if (a.parentCode) {
      map.set(a.code, a.parentCode);
    }
  }
  return map;
}
