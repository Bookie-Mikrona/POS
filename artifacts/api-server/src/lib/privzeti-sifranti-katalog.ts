/**
 * Privzeti šifranti za novo gostinsko enoto (kategorije, prodajni artikli s cenami in normativi,
 * polizdelki in nabavni artikli). Cene so okvirne (z DDV) in jih enota po uvozu uredi sama.
 *
 * Davčna klasifikacija je samo taxCategory: stopnjo DDV razreši obstoječi pravilnik (vat_rule)
 * glede na vrsto dobave in dodan sladkor. Polje `davek` je enako kot pri obstoječih artiklih
 * (hrana in pijača-jed 9,5 %, ostalo 22 %).
 */

export type PrivzetaDavcnaKategorija = "food" | "food_drink" | "hot_beverage" | "cold_beverage" | "alcoholic" | "other";
export type VrstaSurovine = "F" | "A" | "S" | "P";
export type EnotaSurovine = "KGM" | "LTR" | "H87";
export type NormativVrstica = readonly [kljuc: string, kolicina: number];

export type PrivzetaKategorija = {
  kljuc: string;
  ime: string;
  tip: "hrana" | "pijaca" | null;
  oddelek: "Hrana" | "Pica" | "Sladice" | "Kava" | "Pijača" | "Drugo";
  barva: string;
  davcna: PrivzetaDavcnaKategorija;
  priprava: "hrana" | "pijaca" | "pica" | null;
};

export type PrivzetiArtikel = {
  kljuc: string;
  kategorija: string;
  ime: string;
  cena: number;
  davcna: PrivzetaDavcnaKategorija;
  dodanSladkor: boolean;
  alkohol: boolean;
  /** Pakirana pijača ali embalaža: nabavni in prodajni artikel z normativom 1 : 1. */
  pakirano: boolean;
  normativ: NormativVrstica[];
};

export type PrivzetaSurovina = { ime: string; enota: EnotaSurovine; vrsta: VrstaSurovine };
export type PrivzetPolizdelek = { ime: string; enota: "KGM" | "LTR"; normativ: NormativVrstica[] };

export const PRIVZETE_KATEGORIJE: PrivzetaKategorija[] = [
  { kljuc: "juhe", ime: "Juhe", tip: "hrana", oddelek: "Hrana", barva: "#EAB308", davcna: "food", priprava: "hrana" },
  { kljuc: "zajtrki", ime: "Zajtrki", tip: "hrana", oddelek: "Hrana", barva: "#F59E0B", davcna: "food", priprava: "hrana" },
  { kljuc: "glavne", ime: "Glavne jedi", tip: "hrana", oddelek: "Hrana", barva: "#DC2626", davcna: "food", priprava: "hrana" },
  { kljuc: "otroski", ime: "Otroški meni", tip: "hrana", oddelek: "Hrana", barva: "#F97316", davcna: "food", priprava: "hrana" },
  { kljuc: "sezonske", ime: "Sezonske jedi", tip: "hrana", oddelek: "Hrana", barva: "#B45309", davcna: "food", priprava: "hrana" },
  { kljuc: "priloge", ime: "Priloge", tip: "hrana", oddelek: "Hrana", barva: "#84CC16", davcna: "food", priprava: "hrana" },
  { kljuc: "solate", ime: "Solate", tip: "hrana", oddelek: "Hrana", barva: "#22C55E", davcna: "food", priprava: "hrana" },
  { kljuc: "sladice", ime: "Sladice", tip: "hrana", oddelek: "Sladice", barva: "#EC4899", davcna: "food", priprava: "hrana" },
  { kljuc: "pice", ime: "Pice", tip: null, oddelek: "Pica", barva: "#EF4444", davcna: "food", priprava: "pica" },
  { kljuc: "embalaza", ime: "Embalaža", tip: null, oddelek: "Drugo", barva: "#78716C", davcna: "other", priprava: null },
  { kljuc: "topli", ime: "Topli napitki", tip: "pijaca", oddelek: "Kava", barva: "#92400E", davcna: "hot_beverage", priprava: "pijaca" },
  { kljuc: "brezalk", ime: "Brezalkoholne pijače", tip: "pijaca", oddelek: "Pijača", barva: "#0EA5E9", davcna: "cold_beverage", priprava: "pijaca" },
  { kljuc: "pivo", ime: "Pivo", tip: "pijaca", oddelek: "Pijača", barva: "#FBBF24", davcna: "alcoholic", priprava: "pijaca" },
  { kljuc: "vino", ime: "Vino", tip: "pijaca", oddelek: "Pijača", barva: "#7E22CE", davcna: "alcoholic", priprava: "pijaca" },
  { kljuc: "zgane", ime: "Žgane pijače", tip: "pijaca", oddelek: "Pijača", barva: "#475569", davcna: "alcoholic", priprava: "pijaca" },
  { kljuc: "penine", ime: "Penine", tip: "pijaca", oddelek: "Pijača", barva: "#9F1239", davcna: "alcoholic", priprava: "pijaca" },
];

const S = (ime: string, enota: EnotaSurovine, vrsta: VrstaSurovine = "F"): PrivzetaSurovina => ({ ime, enota, vrsta });

/** Nabavni artikli (surovine). F = hrana 9,5 %, A = alkohol 22 %, S = pijača 22 %, P = ostalo 22 %. */
export const PRIVZETE_SUROVINE: Record<string, PrivzetaSurovina> = {
  svkare: S("Svinjski kare/stegno", "KGM"), puran: S("Puranji file", "KGM"), pisc: S("Piščančji file", "KGM"),
  biftek: S("Goveji biftek", "KGM"), ramstek: S("Goveji ramstek", "KGM"), mleto: S("Mleto mešano meso", "KGM"),
  cevap: S("Čevapčiči (surovi)", "KGM"), plesk: S("Pleskavica (surova)", "KGM"), rebra: S("Svinjska rebra", "KGM"),
  gov: S("Goveje meso za golaž", "KGM"), zar: S("Mešano meso za žar", "KGM"), postrv: S("Postrv", "KGM"),
  orada: S("Orada/brancin", "KGM"), lignji: S("Lignji", "KGM"), morski: S("Morski sadeži (mešano)", "KGM"),
  kosti: S("Goveje kosti", "KGM"), jelen: S("Jelenovo meso", "KGM"), divjacina: S("Divjačinsko meso za golaž", "KGM"),
  panceta: S("Panceta", "KGM"), slanina: S("Slanina", "KGM"), sunka: S("Kuhana šunka", "KGM"), prsut: S("Pršut", "KGM"),
  salama: S("Suha salama", "KGM"), pikantna: S("Pikantna salama", "KGM"), hrenovka: S("Hrenovka", "H87"),
  klobasa: S("Domača klobasa", "KGM"), pecenica: S("Pečenica", "KGM"), krvavica: S("Krvavica", "KGM"),
  zaseka: S("Zaseka", "KGM"), ocvirki: S("Ocvirki", "KGM"), tuna: S("Tuna v konzervi", "KGM"),
  incuni: S("Inčuni", "KGM"), pisc_nug: S("Piščančji medaljoni (nuggets)", "KGM"),
  jajca: S("Jajca (sveža, kokošja)", "H87"), mleko: S("Mleko 3,5% 1l", "LTR"), smetana: S("Smetana za kuhanje", "LTR"),
  smetana_sl: S("Smetana za stepanje", "LTR"), kislasm: S("Kisla smetana", "KGM"), maslo: S("Maslo", "KGM"),
  sirmozz: S("Sir mozzarella/edamec", "KGM"), sircvrt: S("Sir za cvrtje (trapist)", "KGM"), feta: S("Feta sir", "KGM"),
  gorgonzola: S("Gorgonzola", "KGM"), parmezan: S("Parmezan", "KGM"), skuta: S("Skuta polnomastna", "KGM"),
  jogurt: S("Grški jogurt", "KGM"), jogurt_sad: S("Sadni jogurt", "KGM"), sladoled: S("Vanilijev sladoled", "KGM"),
  sir4: S("Mešanica sirov za pico (4 vrste)", "KGM"), vegsir: S("Veganski sir", "KGM"),
  cebula: S("Čebula", "KGM"), cesen: S("Česen", "KGM"), paradiznik: S("Paradižnik svež", "KGM"), kumare: S("Kumare", "KGM"),
  paprika: S("Paprika", "KGM"), zelena: S("Zelena solata", "KGM"), radic: S("Radič", "KGM"), motovilec: S("Motovilec", "KGM"),
  zelje: S("Belo zelje", "KGM"), kislozelje: S("Kislo zelje", "KGM"), krompir: S("Krompir", "KGM"),
  krompir_pom: S("Krompir za pomfrit (zamrznjen)", "KGM"), kroketi: S("Kroketi (zamrznjeni)", "KGM"),
  fizol: S("Fižol kuhan", "KGM"), jurcki: S("Jurčki", "KGM"), sampinjoni: S("Šampinjoni sveži", "KGM"),
  bucke: S("Bučke", "KGM"), jajcevci: S("Jajčevci", "KGM"), korenje: S("Korenje", "KGM"), grah: S("Grah", "KGM"),
  cvetaca: S("Cvetača", "KGM"), brokoli: S("Brokoli", "KGM"), buca: S("Buča", "KGM"), blitva: S("Blitva", "KGM"),
  spargelj: S("Šparglji", "KGM"), kostanj: S("Kostanj", "KGM"), lubenica: S("Lubenica", "KGM"),
  sadje: S("Sezonsko sadje", "KGM"), gozdni: S("Gozdni sadeži", "KGM"), jagode: S("Jagode", "KGM"),
  borovnice: S("Borovnice", "KGM"), maline: S("Maline", "KGM"), jabolka: S("Jabolka", "KGM"), banana: S("Banane", "KGM"),
  limona: S("Limona", "KGM"), pomarance: S("Pomaranče", "KGM"), olive: S("Olive", "KGM"), kapre: S("Kapre", "KGM"),
  rukola: S("Rukola", "KGM"), pesa: S("Rdeča pesa vložena (kozarec)", "KGM"), kumarice: S("Kisle kumarice", "KGM"),
  korenje_pel: S("Pelati konzervirani", "KGM"), koruza: S("Koruza v konzervi", "KGM"), cili: S("Feferoni", "KGM"),
  jurcki_suhi: S("Jurčki suhi", "KGM"), tartuf: S("Tartufi (omaka)", "KGM"), mesnamasa: S("Mleto meso za polnitev", "KGM"),
  moka: S("Moka pšenična gladka", "KGM"), moka_ostra: S("Moka pšenična ostra", "KGM"), moka_00: S("Moka tip 00", "KGM"),
  ajda: S("Ajdova moka", "KGM"), drobtine: S("Drobtine (krušne)", "KGM"), riz: S("Riž", "KGM"),
  spageti: S("Špageti", "KGM"), fuzi: S("Fuži (suhi)", "KGM"), rezanci: S("Domači rezanci (suhi)", "KGM"),
  zvezdice: S("Zvezdice za juho (suhe)", "KGM"), polenta: S("Polentna moka", "KGM"), kosmici: S("Ovseni kosmiči", "KGM"),
  kruh: S("Kruh", "KGM"), lepinja: S("Lepinja", "H87"), toast: S("Toast kruh (rezina)", "H87"),
  roglic: S("Maslen rogljič", "H87"), kruhcmoki: S("Kruhov cmok (surov)", "KGM"), kvas: S("Kvas", "KGM"),
  sladkor: S("Sladkor kristalni", "KGM"), sladkor_por: S("Sladkor porcijski", "H87"), sol: S("Sol", "KGM"),
  poper: S("Poper", "KGM"), origano: S("Origano", "KGM"), persilj: S("Peteršilj", "KGM"), rozmarin: S("Rožmarin", "KGM"),
  zacimbe: S("Začimbe (mešanica)", "KGM"), gorcica: S("Gorčica", "KGM"), majoneza: S("Majoneza", "KGM"),
  ketchup: S("Kečap", "KGM"), bbq: S("BBQ omaka", "KGM"), olje: S("Olje sončnično", "LTR"), olivno: S("Olivno olje", "LTR"),
  bucno: S("Bučno olje", "LTR"), ocet: S("Kis", "LTR"), med: S("Med", "KGM"), marmelada: S("Marelična marmelada", "KGM"),
  nutella: S("Čokoladni namaz", "KGM"), orehi: S("Orehi mleti", "KGM"), cokolada: S("Temna čokolada", "KGM"),
  cokoladni_prelev: S("Čokoladni preliv", "KGM"), kakav: S("Kakav v prahu", "KGM"), vanilija: S("Vaniljev puding/krema", "KGM"),
  piskoti: S("Piškoti za tiramisu", "KGM"), mascarpone: S("Mascarpone", "KGM"), zelatina: S("Želatina", "KGM"),
  listnato: S("Listnato testo", "KGM"), tortakosi: S("Torta (zamrznjena, porcija)", "H87"), borovnicevo_nad: S("Borovničev nadev", "KGM"),
  dunajska_om: S("Holandska omaka (priprava)", "KGM"), gobova_om: S("Gobova omaka (priprava)", "KGM"),
  poprova_om: S("Poprova omaka (priprava)", "KGM"), brusnice: S("Brusnična omaka", "KGM"), kokos: S("Kokos", "KGM"),
  kava: S("Kava v zrnju", "KGM"), kava_bk: S("Brezkofeinska kava v zrnju", "KGM"), caj_crni: S("Črni čaj (vrečka)", "H87"),
  caj_zel: S("Zeliščni čaj (vrečka)", "H87"), caj_sad: S("Sadni čaj (vrečka)", "H87"), cokolada_vr: S("Vroča čokolada (prašek)", "KGM"),
  cokolada_bela: S("Vroča čokolada z okusom (prašek)", "KGM"), cedevita: S("Cedevita vrečka", "H87", "S"),
  led: S("Led", "KGM", "P"),
  // Embalaža in ostalo
  rum: S("Rum 1 liter", "LTR", "A"), vino_rdece: S("Vino rdeče (za kuhanje)", "LTR", "A"),
  // odprta vina in žgane pijače (za točenje)
  v_rizling: S("Laški rizling 1 liter", "LTR", "A"), v_chard: S("Chardonnay 1 liter", "LTR", "A"),
  v_cviček: S("Cviček PTP 1 liter", "LTR", "A"), v_refosk: S("Refošk/Merlot 1 liter", "LTR", "A"),
  v_desert: S("Sladko desertno vino 1 liter", "LTR", "A"), v_penina: S("Hišna penina 0,75 l (odprta)", "LTR", "A"),
  z_borovnicevec: S("Borovničevec/liker 1 liter", "LTR", "A"), z_borovnicke: S("Borovničke 1 liter", "LTR", "A"),
  z_pelinkovec: S("Pelinkovec 1 liter", "LTR", "A"), z_viljamovka: S("Viljamovka 1 liter", "LTR", "A"),
  z_sadjevec: S("Sadjevec 1 liter", "LTR", "A"), z_travarica: S("Travarica 1 liter", "LTR", "A"),
  z_medica: S("Medeni liker 1 liter", "LTR", "A"), z_brinjevec: S("Brinjevec 1 liter", "LTR", "A"),
  z_gin: S("Gin Beefeater 1 liter", "LTR", "A"), z_gin_p: S("Premium gin 1 liter", "LTR", "A"),
  z_viski: S("Viski Jameson 1 liter", "LTR", "A"), z_viski_p: S("Viski Chivas Regal 1 liter", "LTR", "A"),
  z_rum: S("Rum Bacardi Superior 1 liter", "LTR", "A"), z_rum_d: S("Domači rum 1 liter", "LTR", "A"),
  z_vodka: S("Vodka 1 liter", "LTR", "A"), z_tekila: S("Tekila 1 liter", "LTR", "A"),
  z_brandy: S("Brandy/Konjak 1 liter", "LTR", "A"), z_jager: S("Jägermeister 1 liter", "LTR", "A"),
  z_campari: S("Campari 1 liter", "LTR", "A"), z_martini: S("Martini Bianco 1 liter", "LTR", "A"),
};

const P = (ime: string, enota: "KGM" | "LTR", normativ: NormativVrstica[]): PrivzetPolizdelek => ({ ime, enota, normativ });

/** Polizdelki; normativ je za 1 kg oziroma 1 l izdelka. Voda iz pipe ni artikel. */
export const PRIVZETI_POLIZDELKI: Record<string, PrivzetPolizdelek> = {
  "POL-01": P("Goveja juha (osnova)", "LTR", [["kosti", 0.3], ["korenje", 0.15], ["sol", 0.01]]),
  "POL-02": P("Testo za pico", "KGM", [["moka_00", 0.62], ["kvas", 0.005], ["sol", 0.015], ["olivno", 0.01]]),
  "POL-03": P("Paradižnikova omaka za pico", "KGM", [["korenje_pel", 0.9], ["sol", 0.01], ["origano", 0.002], ["olivno", 0.01]]),
  "POL-04": P("Bolonjska mesna omaka", "KGM", [["mleto", 0.55], ["cebula", 0.15], ["korenje_pel", 0.3], ["vino_rdece", 0.05], ["zacimbe", 0.01]]),
  "POL-05": P("Palačinkino testo", "LTR", [["moka", 0.35], ["mleko", 0.5], ["jajca", 3], ["sladkor", 0.01]]),
  "POL-06": P("Domači njoki (surovi)", "KGM", [["krompir", 0.7], ["moka", 0.25], ["jajca", 1], ["sol", 0.01]]),
  "POL-07": P("Tatarska omaka", "KGM", [["majoneza", 0.75], ["kumarice", 0.15], ["kapre", 0.05], ["kislasm", 0.05]]),
};

type TC = PrivzetaDavcnaKategorija;
type Opcije = { davcna?: TC; sladkor?: boolean; alkohol?: boolean };
const art: PrivzetiArtikel[] = [];
const kategorijaDavcna = new Map(PRIVZETE_KATEGORIJE.map((k) => [k.kljuc, k.davcna]));

export function privzetKljuc(ime: string): string {
  return ime.toLocaleLowerCase("sl")
    .replace(/[čć]/g, "c").replace(/š/g, "s").replace(/ž/g, "z")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function dodaj(kategorija: string, ime: string, cena: number, normativ: NormativVrstica[], pakirano: boolean, o: Opcije = {}): void {
  const davcna = o.davcna ?? kategorijaDavcna.get(kategorija)!;
  art.push({
    kljuc: `${kategorija}-${privzetKljuc(ime)}`, kategorija, ime, cena, davcna,
    dodanSladkor: o.sladkor ?? false, alkohol: o.alkohol ?? davcna === "alcoholic", pakirano, normativ,
  });
}
const jed = (k: string, ime: string, cena: number, n: NormativVrstica[], o?: Opcije) => dodaj(k, ime, cena, n, false, o);
const pak = (k: string, ime: string, cena: number, o?: Opcije) => dodaj(k, ime, cena, [], true, o);

// 0 Juhe
const J = "juhe";
jed(J, "Goveja juha z domačimi rezanci", 3.8, [["POL-01", 0.25], ["rezanci", 0.02], ["persilj", 0.002]]);
jed(J, "Goveja juha z zvezdicami", 3.8, [["POL-01", 0.25], ["zvezdice", 0.02], ["persilj", 0.002]]);
jed(J, "Goveja juha z vlivanci", 4.0, [["POL-01", 0.25], ["moka", 0.02], ["jajca", 0.5], ["persilj", 0.002]]);
jed(J, "Goveja juha s fritati", 4.2, [["POL-01", 0.25], ["moka", 0.03], ["mleko", 0.04], ["jajca", 0.5], ["olje", 0.02]]);
jed(J, "Goveja juha z jetrnimi žličniki", 4.5, [["POL-01", 0.25], ["mleto", 0.05], ["moka", 0.02], ["jajca", 0.5], ["persilj", 0.002]]);
jed(J, "Gobova juha z jurčki", 5.0, [["jurcki", 0.06], ["cebula", 0.02], ["smetana", 0.04], ["moka", 0.01], ["olje", 0.01]]);
jed(J, "Gobova juha s šampinjoni", 4.5, [["sampinjoni", 0.08], ["cebula", 0.02], ["smetana", 0.04], ["moka", 0.01], ["olje", 0.01]]);
jed(J, "Paradižnikova juha z rižem", 4.0, [["korenje_pel", 0.15], ["riz", 0.03], ["cebula", 0.02], ["olje", 0.01]]);
jed(J, "Dnevna kremna juha (bučna)", 4.2, [["buca", 0.2], ["krompir", 0.05], ["cebula", 0.03], ["smetana", 0.04], ["olje", 0.01]]);
jed(J, "Dnevna kremna juha (brokoli/cvetača)", 4.2, [["brokoli", 0.2], ["krompir", 0.05], ["cebula", 0.02], ["smetana", 0.04]]);

// 1 Zajtrki
const Z = "zajtrki";
jed(Z, "Klasična umešana jajca (3 jajca)", 5.5, [["jajca", 3], ["maslo", 0.01], ["kruh", 0.06]]);
jed(Z, "Umešana jajca s slanino", 6.8, [["jajca", 3], ["slanina", 0.05], ["maslo", 0.01], ["kruh", 0.06]]);
jed(Z, "Umešana jajca s šunko", 6.8, [["jajca", 3], ["sunka", 0.05], ["maslo", 0.01], ["kruh", 0.06]]);
jed(Z, "Jajca na oko (3 jajca)", 5.8, [["jajca", 3], ["olje", 0.01], ["kruh", 0.06]]);
jed(Z, "Kuhana jajca (2 kom)", 3.5, [["jajca", 2], ["kruh", 0.04]]);
jed(Z, "Dunajski zajtrk (hrenovke, gorčica, kruh)", 6.5, [["hrenovka", 2], ["gorcica", 0.02], ["kruh", 0.08]]);
jed(Z, "Sirova omleta / omleta z zelišči", 6.2, [["jajca", 3], ["sirmozz", 0.05], ["maslo", 0.01], ["persilj", 0.003]]);
jed(Z, "Toast s šunko in sirom", 4.8, [["toast", 2], ["sunka", 0.05], ["sirmozz", 0.04], ["maslo", 0.01]]);
jed(Z, "Topli sendvič s toastom", 5.2, [["toast", 2], ["sunka", 0.05], ["sirmozz", 0.04], ["paradiznik", 0.03]]);
jed(Z, "Masleni rogljič (croissant) z marmelado", 3.2, [["roglic", 1], ["marmelada", 0.03], ["maslo", 0.01]]);
jed(Z, "Grški jogurt z medom in orehi", 4.5, [["jogurt", 0.2], ["med", 0.02], ["orehi", 0.02]]);
jed(Z, "Ovseni kosmiči z mlekom ali jogurtom", 3.9, [["kosmici", 0.06], ["mleko", 0.2], ["med", 0.01]]);

// 2 Glavne jedi
const G = "glavne";
const dunajski = (meso: string): NormativVrstica[] => [[meso, 0.18], ["moka", 0.02], ["jajca", 1], ["drobtine", 0.03], ["olje", 0.03], ["limona", 0.02]];
jed(G, "Dunajski zrezek (svinjski)", 9.8, dunajski("svkare"));
jed(G, "Dunajski zrezek (piščančji)", 9.8, dunajski("pisc"));
jed(G, "Dunajski zrezek (puranji)", 10.5, dunajski("puran"));
jed(G, "Zlata puranja prsa v pariški preobleki", 11.5, [["puran", 0.18], ["moka", 0.03], ["jajca", 1], ["olje", 0.03], ["limona", 0.02]]);
jed(G, "Naravni svinjski zrezek v omaki", 10.2, [["svkare", 0.18], ["moka", 0.02], ["cebula", 0.03], ["olje", 0.02], ["smetana", 0.04]]);
jed(G, "Naravni puranji zrezek v gobovi omaki", 11.5, [["puran", 0.18], ["sampinjoni", 0.08], ["smetana", 0.05], ["cebula", 0.02], ["olje", 0.02]]);
jed(G, "Zrezek v poprovi omaki", 12.5, [["svkare", 0.18], ["poper", 0.003], ["smetana", 0.06], ["olje", 0.02]]);
jed(G, "Goveji biftek z žara", 22.0, [["biftek", 0.22], ["olje", 0.01], ["maslo", 0.01], ["rozmarin", 0.002]]);
jed(G, "Ramstek z zeliščnim maslom", 19.5, [["ramstek", 0.25], ["maslo", 0.02], ["persilj", 0.003], ["cesen", 0.003]]);
jed(G, "Čevapčiči (10 kom) v lepinji s čebulo", 9.5, [["cevap", 0.2], ["lepinja", 1], ["cebula", 0.05]]);
jed(G, "Pleskavica v lepinji", 9.0, [["plesk", 0.2], ["lepinja", 1], ["cebula", 0.05], ["ketchup", 0.02]]);
jed(G, "Polnjena pleskavica s sirom (gourmet)", 11.5, [["plesk", 0.22], ["sirmozz", 0.04], ["lepinja", 1], ["cebula", 0.05]]);
jed(G, "Mešano meso z žara (za 1 osebo)", 14.5, [["zar", 0.35], ["olje", 0.02], ["cebula", 0.05]]);
jed(G, "Pečena svinjska rebrca z BBQ omako", 13.5, [["rebra", 0.4], ["bbq", 0.05]]);
jed(G, "Ocvrti sir s tatarsko omako", 8.5, [["sircvrt", 0.15], ["moka", 0.02], ["jajca", 1], ["drobtine", 0.03], ["olje", 0.05], ["POL-07", 0.05]]);
jed(G, "Zlata postrv na žaru (kos)", 13.5, [["postrv", 0.35], ["olivno", 0.02], ["limona", 0.03]]);
jed(G, "Postrv v moki / po tržaško", 13.5, [["postrv", 0.35], ["moka", 0.03], ["olje", 0.04], ["cesen", 0.005], ["persilj", 0.003]]);
jed(G, "Orada ali brancin na žaru (porcija)", 17.5, [["orada", 0.35], ["olivno", 0.02], ["limona", 0.03]]);
jed(G, "Lignji na žaru z blitvo in krompirjem", 15.5, [["lignji", 0.25], ["blitva", 0.15], ["krompir", 0.2], ["olivno", 0.03], ["cesen", 0.005]]);
jed(G, "Ocvrti lignji s tatarsko omako", 14.5, [["lignji", 0.25], ["moka", 0.03], ["jajca", 1], ["drobtine", 0.04], ["olje", 0.06], ["POL-07", 0.05]]);
jed(G, "Špageti po bolonjsko", 8.5, [["spageti", 0.12], ["POL-04", 0.15], ["parmezan", 0.01]]);
jed(G, "Špageti carbonara", 9.0, [["spageti", 0.12], ["panceta", 0.06], ["jajca", 1], ["parmezan", 0.02], ["smetana", 0.03]]);
jed(G, "Domači fuži s tartufi", 13.5, [["fuzi", 0.12], ["tartuf", 0.03], ["smetana", 0.05], ["parmezan", 0.02], ["maslo", 0.02]]);
jed(G, "Skutni ali ajdovi štruklji z orehi", 7.5, [["skuta", 0.15], ["moka", 0.06], ["jajca", 0.5], ["orehi", 0.03], ["maslo", 0.02], ["drobtine", 0.02]]);
jed(G, "Goveji golaž z njoki / polento", 10.5, [["gov", 0.2], ["cebula", 0.1], ["paprika", 0.03], ["olje", 0.02], ["POL-06", 0.15]]);

// 3 Otroški meni
const O = "otroski";
jed(O, "Mali dunajski zrezek s pomfritom (Miki miška)", 7.5, [["svkare", 0.1], ["moka", 0.01], ["jajca", 0.5], ["drobtine", 0.02], ["olje", 0.03], ["krompir_pom", 0.15]]);
jed(O, "Ocvrti piščančji medaljoni (nuggetsi) s pomfritom", 7.5, [["pisc_nug", 0.12], ["olje", 0.03], ["krompir_pom", 0.15], ["ketchup", 0.02]]);
jed(O, "Špageti z mesno omako (otroška porcija)", 5.9, [["spageti", 0.08], ["POL-04", 0.1], ["parmezan", 0.005]]);
jed(O, "Mini hrenovke s krompirčkom", 5.9, [["hrenovka", 2], ["krompir_pom", 0.15], ["ketchup", 0.02]]);
jed(O, "Mini burger s pomfritom", 7.0, [["plesk", 0.1], ["lepinja", 0.5], ["sirmozz", 0.02], ["krompir_pom", 0.15]]);
jed(O, "Rižota z grahom in piščancem", 6.5, [["riz", 0.08], ["pisc", 0.08], ["grah", 0.04], ["olje", 0.01]]);
jed(O, "Palačinka z nutelo (otrok)", 4.0, [["POL-05", 0.1], ["nutella", 0.03], ["olje", 0.005]]);
jed(O, "Sadna kupa z vanilijevim sladoledom", 4.5, [["sladoled", 0.1], ["sadje", 0.1], ["smetana_sl", 0.03]]);
jed(O, "Sadni jogurt / smoothie za otroke", 3.5, [["jogurt_sad", 0.15], ["banana", 0.05], ["jagode", 0.05]], { davcna: "food_drink" });
pak(O, "Sokec z slamico (jabolko/banana) 0,2 l", 1.9, { davcna: "cold_beverage", sladkor: true });

// 4 Sezonske jedi
const SE = "sezonske";
jed(SE, "Domači kmečki krožnik (klobasa, pečenica, krvavica, zelje, restan krompir)", 14.5, [["klobasa", 0.1], ["pecenica", 0.1], ["krvavica", 0.08], ["kislozelje", 0.12], ["krompir", 0.2], ["cebula", 0.03], ["olje", 0.02]]);
jed(SE, "Domača koline (zaseka, klobasa, kislo zelje)", 12.5, [["zaseka", 0.05], ["klobasa", 0.1], ["kislozelje", 0.12], ["kruh", 0.06]]);
jed(SE, "Špargljeva juha (spomladi)", 5.0, [["spargelj", 0.15], ["krompir", 0.05], ["smetana", 0.04], ["cebula", 0.02]]);
jed(SE, "Šparglji z jajcem in holandsko omako", 10.5, [["spargelj", 0.3], ["jajca", 1], ["dunajska_om", 0.06]]);
jed(SE, "Divjačinski golaž v kruhovi skodelici", 12.5, [["divjacina", 0.2], ["cebula", 0.1], ["paprika", 0.03], ["olje", 0.02], ["kruh", 0.1]]);
jed(SE, "Jelenovi zrezki v brusnični omaki", 18.5, [["jelen", 0.2], ["brusnice", 0.05], ["maslo", 0.02]]);
jed(SE, "Svinjska pečenka z mlinci (praznični meni)", 12.5, [["svkare", 0.2], ["moka", 0.08], ["cebula", 0.03], ["olje", 0.02]]);
jed(SE, "Bučna juha z bučnim oljem in semeni (jeseni)", 4.8, [["buca", 0.25], ["krompir", 0.05], ["smetana", 0.04], ["bucno", 0.01]]);
jed(SE, "Pečeni kostanj (po sezoni)", 4.5, [["kostanj", 0.15]]);
jed(SE, "Sveži jurčki na žaru ali v omaki", 14.5, [["jurcki", 0.2], ["olivno", 0.02], ["cesen", 0.005], ["persilj", 0.003], ["smetana", 0.03]]);
jed(SE, "Solatni krožnik s tuno in popečenimi kruhki (poletje)", 10.5, [["zelena", 0.1], ["paradiznik", 0.08], ["tuna", 0.08], ["kruh", 0.04], ["olivno", 0.01]]);
jed(SE, "Hladna lubenica / osvežilni sadni krožnik", 4.5, [["lubenica", 0.3]]);
jed(SE, "Kislo zelje z ocvirki in pečenico", 9.5, [["kislozelje", 0.2], ["ocvirki", 0.04], ["pecenica", 0.12]]);
jed(SE, "Kuhan fižol z zabelo", 6.5, [["fizol", 0.25], ["cebula", 0.03], ["olje", 0.02], ["slanina", 0.03]]);
jed(SE, "Jabolčni zavitek (topel, sezonski)", 4.5, [["jabolka", 0.12], ["listnato", 0.06], ["sladkor", 0.02], ["drobtine", 0.01]]);

// 5 Priloge
const PR = "priloge";
jed(PR, "Pražen (restan) krompir s čebulo", 3.2, [["krompir", 0.25], ["cebula", 0.04], ["olje", 0.03]]);
jed(PR, "Pomfrit (ocvrti krompirček)", 3.2, [["krompir_pom", 0.2], ["olje", 0.03]]);
jed(PR, "Kuhan slan krompir z maslom in peteršiljem", 3.0, [["krompir", 0.25], ["maslo", 0.015], ["persilj", 0.003]]);
jed(PR, "Kuhan krompir v kosih z blitvo", 3.5, [["krompir", 0.2], ["blitva", 0.1], ["cesen", 0.003], ["olivno", 0.01]]);
jed(PR, "Kroketi", 3.5, [["kroketi", 0.18], ["olje", 0.03]]);
jed(PR, "Pečeni krompir iz pečice z rožmarinom", 3.5, [["krompir", 0.25], ["rozmarin", 0.002], ["olivno", 0.02]]);
jed(PR, "Riž na belo / dušen riž", 2.8, [["riz", 0.08], ["olje", 0.01], ["cebula", 0.02]]);
jed(PR, "Rižota z zelenjavo", 4.2, [["riz", 0.08], ["korenje", 0.04], ["grah", 0.03], ["bucke", 0.04], ["olje", 0.01], ["parmezan", 0.01]]);
jed(PR, "Zelenjava na žaru (bučke, paprika, šampinjoni, jajčevci)", 4.5, [["bucke", 0.07], ["paprika", 0.05], ["sampinjoni", 0.05], ["jajcevci", 0.05], ["olivno", 0.02]]);
jed(PR, "Dušena zelenjava (korenje, grah, cvetača)", 3.5, [["korenje", 0.06], ["grah", 0.06], ["cvetaca", 0.06], ["maslo", 0.01]]);
jed(PR, "Domači njoki", 4.5, [["POL-06", 0.2], ["maslo", 0.015]]);
jed(PR, "Domači žličniki", 3.8, [["moka", 0.07], ["jajca", 1], ["mleko", 0.03], ["maslo", 0.01]]);
jed(PR, "Kruhovi cmoki", 3.5, [["kruhcmoki", 0.15], ["maslo", 0.01]]);
jed(PR, "Polenta (koruzna zabeljena)", 3.2, [["polenta", 0.08], ["maslo", 0.015], ["slanina", 0.02]]);
jed(PR, "Lepinja / svež domači kruh (košarica)", 1.5, [["kruh", 0.08]]);

// 6 Solate
const SO = "solate";
jed(SO, "Mešana sezonska solata (zelena, paradižnik, kumare)", 3.5, [["zelena", 0.06], ["paradiznik", 0.06], ["kumare", 0.05], ["olivno", 0.01], ["ocet", 0.01]]);
jed(SO, "Zeljna solata (klasična bela)", 3.0, [["zelje", 0.15], ["olje", 0.01], ["ocet", 0.01]]);
jed(SO, "Paradižnikova solata s čebulo", 3.5, [["paradiznik", 0.15], ["cebula", 0.03], ["olivno", 0.01]]);
jed(SO, "Kumarična solata s kislo smetano in česnom", 3.5, [["kumare", 0.15], ["kislasm", 0.04], ["cesen", 0.003]]);
jed(SO, "Zelena solata (kristalka ali berivka)", 3.0, [["zelena", 0.12], ["olje", 0.01], ["ocet", 0.01]]);
jed(SO, "Radič s fižolom in čebulo", 4.0, [["radic", 0.1], ["fizol", 0.08], ["cebula", 0.02], ["bucno", 0.01]]);
jed(SO, "Ljubljanska solata (solata, radič, fižol, kuhan krompir, ocvirki)", 6.5, [["zelena", 0.06], ["radic", 0.05], ["fizol", 0.06], ["krompir", 0.08], ["ocvirki", 0.03], ["bucno", 0.01]]);
jed(SO, "Šopska solata (paradižnik, kumare, paprika, feta sir)", 5.5, [["paradiznik", 0.08], ["kumare", 0.06], ["paprika", 0.04], ["feta", 0.06], ["olivno", 0.01]]);
jed(SO, "Grška solata (olivno olje, olive, feta, zelenjava)", 6.5, [["paradiznik", 0.08], ["kumare", 0.06], ["olive", 0.03], ["feta", 0.07], ["olivno", 0.015], ["cebula", 0.02]]);
jed(SO, "Sestavljena piščančja solata (zelena solata, pohan piščanec, dresing)", 9.5, [["zelena", 0.12], ["pisc", 0.12], ["moka", 0.02], ["jajca", 0.5], ["drobtine", 0.03], ["olje", 0.04], ["majoneza", 0.03]]);
jed(SO, "Solata s tuno, koruzo in čebulo", 8.5, [["tuna", 0.08], ["koruza", 0.04], ["cebula", 0.02], ["zelena", 0.08], ["olivno", 0.01]]);
jed(SO, "Motovilec s krompirjem in jajcem", 6.0, [["motovilec", 0.08], ["krompir", 0.08], ["jajca", 1], ["bucno", 0.01]]);
jed(SO, "Rdeča pesa (vložena)", 2.8, [["pesa", 0.1]]);
jed(SO, "Kisle kumarice (vložene)", 2.8, [["kumarice", 0.1]]);
jed(SO, "Stročji fižol v solati s česnom", 4.0, [["fizol", 0.12], ["cesen", 0.003], ["olivno", 0.01], ["ocet", 0.01]]);

// 7 Sladice
const SL = "sladice";
jed(SL, "Palačinke z marmelado (marelica/sliva)", 4.5, [["POL-05", 0.15], ["marmelada", 0.05], ["olje", 0.005], ["sladkor", 0.01]]);
jed(SL, "Palačinke z čokoladnim namazom (Nutella)", 5.0, [["POL-05", 0.15], ["nutella", 0.05], ["olje", 0.005]]);
jed(SL, "Palačinke z orehi in čokoladnim prelivom", 5.2, [["POL-05", 0.15], ["orehi", 0.03], ["cokoladni_prelev", 0.03], ["olje", 0.005]]);
jed(SL, "Jabolčni zavitek (štrudelj) z drobtinami", 4.5, [["jabolka", 0.12], ["listnato", 0.06], ["sladkor", 0.02], ["drobtine", 0.01], ["maslo", 0.01]]);
jed(SL, "Jabolčni zavitek z vanilijevo omako", 5.0, [["jabolka", 0.12], ["listnato", 0.06], ["sladkor", 0.02], ["vanilija", 0.04], ["mleko", 0.05]]);
jed(SL, "Borovničev zavitek", 4.8, [["borovnice", 0.1], ["listnato", 0.06], ["sladkor", 0.02]]);
jed(SL, "Blejska kremšnita", 4.8, [["tortakosi", 1]]);
jed(SL, "Čokoladna torta / torta hiše", 4.5, [["tortakosi", 1]]);
jed(SL, "Sadna torta (jagoda/gozdni sadeži)", 4.5, [["tortakosi", 1]]);
jed(SL, "Tiramisu", 5.0, [["mascarpone", 0.08], ["piskoti", 0.04], ["jajca", 0.5], ["sladkor", 0.02], ["kava", 0.005], ["kakav", 0.003]]);
jed(SL, "Sladoledna kupa (3 kroglice s smetano in prelivom)", 5.2, [["sladoled", 0.15], ["smetana_sl", 0.04], ["cokoladni_prelev", 0.02]]);
jed(SL, "Vanilijev sladoled z vročimi malinami", 5.5, [["sladoled", 0.12], ["maline", 0.08], ["sladkor", 0.01]]);
jed(SL, "Panna cotta z gozdnimi sadeži", 5.0, [["smetana_sl", 0.12], ["sladkor", 0.02], ["zelatina", 0.003], ["gozdni", 0.05]]);
jed(SL, "Domači skutni štruklji z drobtinami", 5.5, [["skuta", 0.15], ["moka", 0.06], ["jajca", 0.5], ["maslo", 0.02], ["drobtine", 0.03]]);
jed(SL, "Skutna pita / cheesecake", 4.8, [["tortakosi", 1]]);

// 8 Pice
const PI = "pice";
const pica = (ime: string, cena: number, obloga: NormativVrstica[]) => jed(PI, ime, cena, [["POL-02", 0.25], ["POL-03", 0.08], ...obloga]);
pica("Pica Margherita (paradižnik, sir, origano)", 7.5, [["sirmozz", 0.14], ["origano", 0.001]]);
pica("Pica Capricciosa / Veseljak (sir, šunka, gobe)", 8.9, [["sirmozz", 0.14], ["sunka", 0.08], ["sampinjoni", 0.05], ["origano", 0.001], ["olive", 0.01]]);
pica("Pica Funghi (sir, gobe, šampinjoni)", 8.5, [["sirmozz", 0.14], ["sampinjoni", 0.1], ["origano", 0.001]]);
pica("Pica Šunkorica (sir, šunka)", 8.5, [["sirmozz", 0.14], ["sunka", 0.1], ["origano", 0.001]]);
pica("Pica Salami / Kmečka (sir, suha salama, čebula, feferoni)", 9.0, [["sirmozz", 0.14], ["salama", 0.08], ["cebula", 0.03], ["cili", 0.01]]);
pica("Pica Quattro Formaggi (štiri vrste sira)", 9.5, [["sir4", 0.18]]);
pica("Pica Vegetarijana (sir, sveža zelenjava)", 8.9, [["sirmozz", 0.14], ["paprika", 0.04], ["bucke", 0.04], ["sampinjoni", 0.04], ["paradiznik", 0.04]]);
pica("Pica Diavola / Pikantna (sir, pikantna salama, feferoni, čili)", 9.2, [["sirmozz", 0.14], ["pikantna", 0.08], ["cili", 0.015]]);
pica("Pica Siciljana (sir, inčuni, kapre, olive)", 9.2, [["sirmozz", 0.14], ["incuni", 0.03], ["kapre", 0.01], ["olive", 0.02]]);
pica("Pica Tuna (sir, tuna, čebula, olive)", 9.2, [["sirmozz", 0.14], ["tuna", 0.08], ["cebula", 0.03], ["olive", 0.02]]);
pica("Pica Kraška (sir, pršut, olive, rukola)", 10.5, [["sirmozz", 0.14], ["prsut", 0.06], ["olive", 0.02], ["rukola", 0.02]]);
pica("Pica Hiša / Specialiteta (bogata obloga, šunka, panceta, jajce, gobe)", 10.9, [["sirmozz", 0.14], ["sunka", 0.06], ["panceta", 0.04], ["jajca", 1], ["sampinjoni", 0.05]]);
jed(PI, "Bela pica (brez paradižnika, s kislo smetano, sirom in slanino)", 9.2, [["POL-02", 0.25], ["kislasm", 0.08], ["sirmozz", 0.14], ["slanina", 0.06]]);
pica("Pica Calzone (prepognjena pica / žepka)", 9.5, [["sirmozz", 0.14], ["sunka", 0.08], ["sampinjoni", 0.05]]);
pica("Pica z morskimi sadeži (frutti di mare)", 11.5, [["sirmozz", 0.12], ["morski", 0.12], ["cesen", 0.003]]);
pica("Pica s šparglji in pršutom (sezonska)", 11.0, [["sirmozz", 0.14], ["spargelj", 0.08], ["prsut", 0.05]]);
jed(PI, "Pica z jurčki in panceto", 11.5, [["POL-02", 0.25], ["smetana", 0.05], ["sirmozz", 0.14], ["jurcki", 0.08], ["panceta", 0.05]]);
jed(PI, "Pica z gorgonzolo in orehi", 10.5, [["POL-02", 0.25], ["sirmozz", 0.1], ["gorgonzola", 0.07], ["orehi", 0.02]]);
jed(PI, "Kids pica (manjša otroška pica)", 6.0, [["POL-02", 0.15], ["POL-03", 0.05], ["sirmozz", 0.08], ["sunka", 0.04]]);
jed(PI, "Veganska pica (veganski sir, zelenjava)", 9.5, [["POL-02", 0.25], ["POL-03", 0.08], ["vegsir", 0.12], ["paprika", 0.04], ["bucke", 0.04], ["sampinjoni", 0.04]]);

// 9 Embalaža (nabavni in prodajni artikel, 22 %)
const E = "embalaza";
pak(E, "Posodica za juho (s pokrovom)", 0.3);
pak(E, "Posodica za glavno jed (deljena)", 0.4);
pak(E, "Posodica za solato (prozorna s pokrovom)", 0.3);
pak(E, "Kartonska škatla za pico (mala)", 0.3);
pak(E, "Kartonska škatla za pico (velika/družinska)", 0.5);
pak(E, "Papirnata vrečka z ročaji", 0.2);
pak(E, "Plastična vrečka za hrano", 0.1);
pak(E, "Plastični pribor v vrečki (vilica, nož, prtiček)", 0.2);
pak(E, "Alufolija / papir za zavitke", 0.1);
pak(E, "Posodica za omake (majhna s pokrovčkom)", 0.2);

// 10 Topli napitki
const T = "topli";
const kava = (ime: string, cena: number, n: NormativVrstica[], o?: Opcije) => jed(T, ime, cena, [["kava", 0.007], ...n], o);
jed(T, "Espresso (kratka kava)", 1.6, [["kava", 0.007], ["sladkor_por", 1]]);
kava("Espresso z mlekom", 1.8, [["mleko", 0.03], ["sladkor_por", 1]]);
kava("Macchiato (mali)", 1.9, [["mleko", 0.04], ["sladkor_por", 1]]);
jed(T, "Macchiato (veliki)", 2.3, [["kava", 0.007], ["mleko", 0.1], ["sladkor_por", 1]]);
kava("Kava z mlekom", 2.2, [["mleko", 0.1], ["sladkor_por", 1]]);
kava("Cappuccino", 2.4, [["mleko", 0.12], ["sladkor_por", 1]]);
kava("Bela kava", 2.2, [["mleko", 0.12], ["sladkor_por", 1]]);
jed(T, "Caffè Latte", 2.8, [["kava", 0.007], ["mleko", 0.2], ["sladkor_por", 1]]);
jed(T, "Ledena kava (s sladoledom in smetano)", 4.2, [["kava", 0.014], ["sladoled", 0.08], ["smetana_sl", 0.03], ["mleko", 0.1], ["led", 0.05]], { davcna: "food_drink" });
jed(T, "Brezkofeinska kava (espresso/z mlekom)", 1.9, [["kava_bk", 0.007], ["sladkor_por", 1]]);
jed(T, "Vroča čokolada (klasična)", 3.2, [["cokolada_vr", 0.03], ["mleko", 0.2]], { davcna: "food_drink" });
jed(T, "Vroča čokolada z okusom (bela, lešnik)", 3.5, [["cokolada_bela", 0.03], ["mleko", 0.2]], { davcna: "food_drink" });
jed(T, "Črni čaj z limono", 2.2, [["caj_crni", 1], ["limona", 0.01], ["sladkor_por", 1]]);
jed(T, "Zeliščni čaj (kamomila, meta) z medom", 2.4, [["caj_zel", 1], ["med", 0.015]], { sladkor: true });
jed(T, "Sadni čaj z gozdnimi sadeži", 2.4, [["caj_sad", 1], ["sladkor_por", 1]]);

// 11 Brezalkoholne pijače (steklenice in pločevinke: nabavni in prodajni artikel)
const B = "brezalk";
const sok = { sladkor: true };
pak(B, "Radenska naravna mineralna voda 0,25 l", 2.6);
pak(B, "Radenska naravna mineralna voda 0,5 l", 3.8);
pak(B, "Donat Mg negazirana voda 0,25 l", 3.2);
pak(B, "Voda z okusom (jabolko/limona) 0,5 l", 3.2, sok);
pak(B, "Coca-Cola 0,25 l", 3.2, sok);
pak(B, "Coca-Cola Zero 0,25 l", 3.2, sok);
pak(B, "Fanta 0,25 l", 3.2, sok);
pak(B, "Sprite 0,25 l", 3.2, sok);
pak(B, "Schweppes Tonic Water 0,25 l", 3.2, sok);
pak(B, "Schweppes Bitter Lemon 0,25 l", 3.2, sok);
pak(B, "Cockta 0,275 l", 3.2, sok);
pak(B, "Ledeni čaj breskev 0,25 l", 3.2, sok);
pak(B, "Jabolčni sok 0,2 l", 2.9);
pak(B, "Pomarančni sok 0,2 l", 2.9);
pak(B, "Jagodni nektar 0,2 l", 2.9, sok);
pak(B, "Breskov nektar 0,2 l", 2.9, sok);
jed(B, "Cedevita", 2.4, [["cedevita", 1]], { sladkor: true });
pak(B, "Red Bull energijska pijača 0,25 l", 4.2, sok);
jed(B, "Naravni pomarančni sok (sveže stisnjen, 0,2 l)", 4.5, [["pomarance", 0.45]]);
jed(B, "Domača limonada z medom 0,3 l", 3.8, [["limona", 0.08], ["med", 0.03]], { sladkor: true });

// 12 Pivo
const PV = "pivo";
const brezalk = { davcna: "cold_beverage" as TC };
pak(PV, "Laško Zlatorog svetlo pivo 0,5 l", 4.2);
pak(PV, "Laško Zlatorog svetlo pivo 0,33 l", 3.4);
pak(PV, "Union svetlo pivo 0,5 l", 4.2);
pak(PV, "Union svetlo pivo 0,33 l", 3.4);
pak(PV, "Union nefiltrirano pivo 0,5 l", 4.5);
pak(PV, "Laško Malt (brezalkoholno, limona) 0,33 l", 3.4, { ...brezalk, sladkor: true });
pak(PV, "Union Radler grenivka 0,5 l", 4.2);
pak(PV, "Union Radler limona 0,5 l", 4.2);
pak(PV, "Heineken svetlo pivo 0,33 l", 3.8);
pak(PV, "Zlatorog brezalkoholno pivo 0,33 l", 3.4, brezalk);
pak(PV, "Loo-Blah-Nah craft pivo (Pale Ale) 0,33 l", 4.8);
pak(PV, "Reservoir Dogs craft pivo (IPA) 0,33 l", 4.8);
pak(PV, "Pelicon craft pivo (Third Tail) 0,33 l", 4.8);
pak(PV, "Guinness temno pivo 0,33 l", 4.8);
pak(PV, "Paulaner pšenično pivo 0,5 l", 4.8);

// 13 Vino
const V = "vino";
jed(V, "Odprto belo vino – Laški rizling 0,2 l", 3.6, [["v_rizling", 0.2]]);
jed(V, "Odprto belo vino – Chardonnay 0,2 l", 3.8, [["v_chard", 0.2]]);
jed(V, "Odprto rdeče vino – Cviček PTP 0,2 l", 3.4, [["v_cviček", 0.2]]);
jed(V, "Odprto rdeče vino – Refošk / Merlot 0,2 l", 3.8, [["v_refosk", 0.2]]);
pak(V, "Belo vino – Rebula 0,75 l", 22.0);
pak(V, "Belo vino – Malvazija 0,75 l", 22.0);
pak(V, "Belo vino – Sauvignon 0,75 l", 22.0);
pak(V, "Belo vino – Traminec 0,75 l", 22.0);
pak(V, "Rdeče vino – Merlot 0,75 l", 22.0);
pak(V, "Rdeče vino – Teran 0,75 l", 22.0);
pak(V, "Rdeče vino – Modra frankinja 0,75 l", 22.0);
pak(V, "Rose vino 0,75 l", 21.0);
jed(V, "Sladko desertno vino (kozarec 0,1 l)", 4.2, [["v_desert", 0.1]]);
pak(V, "Hišno rdeče vino (vrhunsko) 0,75 l", 26.0);
pak(V, "Hišno belo vino (vrhunsko) 0,75 l", 26.0);

// 14 Žgane pijače
const ZG = "zgane";
const zg = (ime: string, cena: number, key: string, kol = 0.03) => jed(ZG, ime, cena, [[key, kol]]);
zg("Domači borovničevec / liker 0,03 l", 2.6, "z_borovnicevec");
zg("Borovničke z gozdnimi borovnicami 0,03 l", 2.6, "z_borovnicke");
zg("Pelinkovec Gorki List / Badel 0,03 l", 2.4, "z_pelinkovec");
zg("Viljamovka – hruškovo žganje 0,03 l", 2.8, "z_viljamovka");
zg("Sadjevec / domače žganje 0,03 l", 2.4, "z_sadjevec");
zg("Travarica 0,03 l", 2.4, "z_travarica");
zg("Medeni liker / medica 0,03 l", 2.4, "z_medica");
zg("Brinjevec 0,03 l", 2.8, "z_brinjevec");
zg("Gin Beefeater / Gordon's 0,03 l", 2.9, "z_gin");
zg("Premium gin (Hendrick's) 0,03 l", 4.2, "z_gin_p");
zg("Viski Jameson / Jack Daniel's 0,03 l", 3.4, "z_viski");
zg("Viski Chivas Regal 0,03 l", 4.5, "z_viski_p");
zg("Rum Bacardi Superior 0,03 l", 2.9, "z_rum");
zg("Domači rum (tuzemc) 0,03 l", 2.4, "z_rum_d");
zg("Vodka Smirnoff / Absolut 0,03 l", 2.9, "z_vodka");
zg("Tekila Silver / Gold 0,03 l", 3.2, "z_tekila");
zg("Brandy / Konjak (Metaxa 5*) 0,03 l", 3.2, "z_brandy");
zg("Jägermeister 0,03 l", 3.2, "z_jager");
zg("Campari 0,03 l", 3.2, "z_campari");
zg("Martini Bianco 0,05 l", 3.2, "z_martini", 0.05);

// 15 Penine
const PE = "penine";
pak(PE, "Srebrna radgonska penina suha 0,75 l", 24.0);
pak(PE, "Srebrna radgonska penina polsuha 0,75 l", 24.0);
pak(PE, "Zlata radgonska penina 0,75 l", 28.0);
pak(PE, "Penina Istenič (Gourmet) 0,75 l", 32.0);
pak(PE, "Prosecco DOC 0,75 l", 26.0);
pak(PE, "Prosecco Superiore Valdobbiadene 0,75 l", 34.0);
pak(PE, "Šampanjec Moët & Chandon Brut 0,75 l", 85.0);
pak(PE, "Lokalna penina hiše 0,75 l", 26.0);
pak(PE, "Rose penina 0,75 l", 26.0);
jed(PE, "Kozarec hišne penine 0,1 l", 3.6, [["v_penina", 0.1]]);

export const PRIVZETI_ARTIKLI: readonly PrivzetiArtikel[] = art;
