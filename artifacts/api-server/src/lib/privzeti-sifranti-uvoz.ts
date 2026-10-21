import { eq, sql } from "drizzle-orm";
import { artikliTable, kategorijeTable, normativiTable, pizzaDoughSettingsTable } from "@workspace/db";
import {
  PRIVZETA_PIZZA, PRIVZETE_KATEGORIJE, PRIVZETE_SAMOSTOJNE_PRIPRAVLJENE, PRIVZETI_ARTIKLI, PRIVZETI_PO_KLJUCU,
  type PrivzetiArtikel,
} from "./privzeti-sifranti-katalog";
import { normalizeSlovenianArticleName } from "./slovenian-article-name";

export class PrivzetiSifrantiNapaka extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

const ime = (v: string) => normalizeSlovenianArticleName(v).toLocaleLowerCase("sl");
const KATEGORIJA_PRIPRAVLJENIH = { kljuc: "pripravljene-jedi", ime: "Pripravljene jedi (malice)" };

/** Katalog za prikaz: obstoječi artikli enote so označeni, da jih uvoz preskoči. */
export async function pregledPrivzetihSifrantov(db: any, enotaId: number) {
  const [artikli, kategorije] = await Promise.all([
    db.select({ ime: artikliTable.ime, prodajni: artikliTable.prodajniArtikel }).from(artikliTable).where(eq(artikliTable.enotaId, enotaId)),
    db.select({ ime: kategorijeTable.ime }).from(kategorijeTable).where(eq(kategorijeTable.enotaId, enotaId)),
  ]);
  const prodajni = new Set<string>(artikli.filter((a: { prodajni: boolean }) => a.prodajni).map((a: { ime: string }) => ime(a.ime)));
  const neprodajni = new Set<string>(artikli.filter((a: { prodajni: boolean }) => !a.prodajni).map((a: { ime: string }) => ime(a.ime)));
  const imenaKategorij = new Set<string>(kategorije.map((k: { ime: string }) => ime(k.ime)));
  const vrstica = (a: PrivzetiArtikel, obstaja: boolean) => ({
    kljuc: a.kljuc, ime: a.ime, cena: a.cena, davcna: a.tax, obstaja, izvor: a.izvor,
  });
  const razvrsti = (a: PrivzetiArtikel[]) => [...a].sort((x, y) => x.red - y.red || x.ime.localeCompare(y.ime, "sl"));
  const skupine = [...PRIVZETE_KATEGORIJE].sort((a, b) => a.red - b.red).map((k) => ({
    kljuc: k.kljuc, ime: k.ime, oddelek: k.oddelek, obstaja: imenaKategorij.has(ime(k.ime)),
    artikli: razvrsti(PRIVZETI_ARTIKLI.filter((a) => a.kat === k.kljuc)).map((a) => vrstica(a, prodajni.has(ime(a.ime)))),
  })).filter((k) => k.artikli.length > 0);
  if (PRIVZETE_SAMOSTOJNE_PRIPRAVLJENE.length > 0) {
    skupine.push({
      kljuc: KATEGORIJA_PRIPRAVLJENIH.kljuc, ime: KATEGORIJA_PRIPRAVLJENIH.ime, oddelek: "Hrana", obstaja: false,
      artikli: razvrsti(PRIVZETE_SAMOSTOJNE_PRIPRAVLJENE).map((a) => vrstica(a, neprodajni.has(ime(a.ime)))),
    });
  }
  return { kategorije: skupine };
}

export type IzborPrivzetihSifrantov = { kategorije: readonly string[]; artikli: readonly string[] };
export type RezultatUvoza = {
  kategorije: number; artikli: number; polizdelki: number; surovine: number; normativi: number;
  preskoceniArtikli: number; opozorila: string[];
};

const izbirniKljuci = () => new Set([...PRIVZETI_ARTIKLI, ...PRIVZETE_SAMOSTOJNE_PRIPRAVLJENE].map((a) => a.kljuc));

export function preveriIzbor(izbor: unknown): IzborPrivzetihSifrantov {
  const telo = izbor as { kategorije?: unknown; artikli?: unknown } | null;
  const kljuciKat = new Set([...PRIVZETE_KATEGORIJE.map((k) => k.kljuc), KATEGORIJA_PRIPRAVLJENIH.kljuc]);
  const kljuciArt = izbirniKljuci();
  const kategorije = telo?.kategorije ?? [];
  const artikli = telo?.artikli ?? [];
  if (!Array.isArray(kategorije) || !Array.isArray(artikli)
    || kategorije.some((k) => typeof k !== "string" || !kljuciKat.has(k))
    || artikli.some((a) => typeof a !== "string" || !kljuciArt.has(a))) {
    throw new PrivzetiSifrantiNapaka(400, "Izbor vsebuje neznano kategorijo ali artikel.");
  }
  if (kategorije.length + artikli.length === 0) {
    throw new PrivzetiSifrantiNapaka(400, "Izberite vsaj eno kategorijo ali artikel.");
  }
  return { kategorije: [...new Set(kategorije as string[])], artikli: [...new Set(artikli as string[])] };
}

type ZnanArtikel = { id: number; nabavni: boolean; prodajni: boolean; meal: string; enota: string | null };

/**
 * Uvoz je samo dopolnilen: obstoječih kategorij, artiklov, cen in normativov nikoli ne prepiše.
 * Odvisnosti (nabavni artikli, polizdelki, pripravljene jedi, embalaža, testo za pico) se ustvarijo samo, če jih ni.
 * Vse poteka v eni transakciji in pod zaklepom enote.
 */
export async function uvoziPrivzeteSifrante(tx: any, enotaId: number, izbor: IzborPrivzetihSifrantov): Promise<RezultatUvoza> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(1315924559::integer, ${enotaId}::integer)`);
  const rezultat: RezultatUvoza = {
    kategorije: 0, artikli: 0, polizdelki: 0, surovine: 0, normativi: 0, preskoceniArtikli: 0, opozorila: [],
  };
  const obstojeci = await tx.select({
    id: artikliTable.id, ime: artikliTable.ime, nabavni: artikliTable.nabavniArtikel,
    prodajni: artikliTable.prodajniArtikel, enota: artikliTable.enotaMere, meal: artikliTable.mealType,
  }).from(artikliTable).where(eq(artikliTable.enotaId, enotaId));
  // Ime je enoličen ključ le znotraj iste skupine: prodajni artikel in pripravljena osnova smeta imeti isto ime.
  const prodajniPoImenu = new Map<string, ZnanArtikel>();
  const neprodajniPoImenu = new Map<string, ZnanArtikel>();
  for (const a of obstojeci) (a.prodajni ? prodajniPoImenu : neprodajniPoImenu).set(ime(a.ime), a);

  const izbrani = [...izbor.artikli].map((k) => PRIVZETI_PO_KLJUCU.get(k)!);
  const kljuciKategorij = new Set([...izbor.kategorije, ...izbrani.map((a) => a.kat).filter((k): k is string => !!k)]);

  const obstojeceKat = await tx.select({ id: kategorijeTable.id, ime: kategorijeTable.ime, vrstniRed: kategorijeTable.vrstniRed })
    .from(kategorijeTable).where(eq(kategorijeTable.enotaId, enotaId));
  const katId = new Map<string, number>();
  let naslednjiRed = obstojeceKat.reduce((m: number, k: { vrstniRed: number }) => Math.max(m, k.vrstniRed), -1) + 1;
  for (const k of [...PRIVZETE_KATEGORIJE].sort((a, b) => a.red - b.red)) {
    if (!kljuciKategorij.has(k.kljuc)) continue;
    const najdena = obstojeceKat.find((o: { ime: string }) => ime(o.ime) === ime(k.ime));
    if (najdena) { katId.set(k.kljuc, najdena.id); continue; }
    const [vstavljena] = await tx.insert(kategorijeTable).values({
      enotaId, ime: k.ime, barva: k.barva, vrstniRed: naslednjiRed++, tip: k.tip, oddelek: k.oddelek,
    }).returning({ id: kategorijeTable.id });
    katId.set(k.kljuc, vstavljena.id);
    rezultat.kategorije++;
  }

  const idPoKljucu = new Map<string, number>();
  const vObdelavi = new Set<string>();
  const vrstniRedPoKat = new Map<string, number>();

  const vstaviNormative = async (artikelId: number, vrstice: ReadonlyArray<readonly [string, number]>) => {
    let red = 0;
    for (const [vhod, kolicina] of vrstice) {
      const vhodId = vhod === undefined ? artikelId : await razresi(vhod, artikelId);
      await tx.insert(normativiTable).values({
        artikelId, vhodniArtikelId: vhodId, kolicina: kolicina.toFixed(4), vrstniRed: red++,
      });
      rezultat.normativi++;
    }
  };

  /** Vrne obstoječi ali na novo ustvarjeni artikel; prodajne vloge ustvari le, če jih katalog izrecno potrebuje (npr. škatla za pico). */
  async function razresi(kljuc: string, _sebi?: number): Promise<number> {
    const a = PRIVZETI_PO_KLJUCU.get(kljuc);
    if (!a) throw new PrivzetiSifrantiNapaka(500, `Katalog vsebuje neznan vhod ${kljuc}.`);
    const znan = idPoKljucu.get(kljuc);
    if (znan) return znan;
    if (vObdelavi.has(kljuc)) throw new PrivzetiSifrantiNapaka(500, `Katalog vsebuje krožno odvisnost pri ${a.ime}.`);
    const naziv = normalizeSlovenianArticleName(a.ime);
    const zemljevid = a.vloga === "A" ? prodajniPoImenu : neprodajniPoImenu;
    const obstaja = zemljevid.get(ime(naziv));
    if (obstaja) {
      if (a.vloga === "S" && !obstaja.nabavni) throw new PrivzetiSifrantiNapaka(409, `Artikel »${naziv}« že obstaja z drugačno vlogo; uvoz ni bil izveden.`);
      if ((a.vloga === "R" || a.vloga === "P") && obstaja.nabavni) throw new PrivzetiSifrantiNapaka(409, `Artikel »${naziv}« že obstaja z drugačno vlogo; uvoz ni bil izveden.`);
      if (a.enota && obstaja.enota && obstaja.enota.toUpperCase() !== a.enota.toUpperCase()) {
        rezultat.opozorila.push(`»${naziv}« že obstaja z enoto ${obstaja.enota}; katalog uporablja ${a.enota}.`);
      }
      idPoKljucu.set(kljuc, obstaja.id);
      return obstaja.id;
    }
    vObdelavi.add(kljuc);
    const id = await vstavi(a, naziv);
    vObdelavi.delete(kljuc);
    return id;
  }

  async function vstavi(a: PrivzetiArtikel, naziv: string): Promise<number> {
    const prodajni = a.vloga === "A";
    let red = 0;
    if (prodajni) {
      red = vrstniRedPoKat.get(a.kat ?? "") ?? 0;
      vrstniRedPoKat.set(a.kat ?? "", red + 1);
    }
    const davek = a.tax === "food" || a.tax === "food_drink" ? "9.5" : "22";
    const [v] = await tx.insert(artikliTable).values({
      enotaId, ime: naziv, opis: a.opis ?? (a.vloga === "P" ? "Polizdelek iz privzetega šifranta." : null),
      cena: a.cena.toFixed(2), davek, aktiven: true,
      kategorijaId: a.kat ? katId.get(a.kat) : undefined, vrstniRed: prodajni ? red : a.red,
      nabavniArtikel: a.nab, prodajniArtikel: prodajni, mealType: a.meal, vrstaArtikla: a.vrsta,
      taxCategory: a.tax, addedSugar: a.tax === "food_drink" ? false : a.sladkor, jeAlkohol: a.alkohol,
      pripravaVrsta: a.priprava as "pica" | "hrana" | "pijaca" | null, enotaMere: a.enota,
      nabavnaDdvStopnja: a.nabDdv === null ? null : a.nabDdv.toFixed(2), imeZaNabavo: a.imeZaNabavo,
      jePica: a.pica, cenaMala: a.cenaMala === null ? null : a.cenaMala.toFixed(2), toGo: a.toGo,
      qrNaVoljo: a.qr, spremljajPorcije: a.sp, malicaVloga: a.malica as "none" | "main" | "soup" | "dessert",
      recipeBatchPieces: a.batch,
    }).returning({ id: artikliTable.id });
    const znan: ZnanArtikel = { id: v.id, nabavni: a.nab, prodajni, meal: a.meal, enota: a.enota };
    (prodajni ? prodajniPoImenu : neprodajniPoImenu).set(ime(naziv), znan);
    idPoKljucu.set(a.kljuc, v.id);
    if (a.vloga === "S") rezultat.surovine++;
    else if (a.vloga === "P" || a.vloga === "R") rezultat.polizdelki++;
    else rezultat.artikli++;
    if (a.toGoArtikli.length > 0) {
      const ids: number[] = [];
      for (const k of a.toGoArtikli) ids.push(await razresi(k));
      await tx.update(artikliTable).set({ toGoArtikli: ids }).where(eq(artikliTable.id, v.id));
    }
    await vstaviNormative(v.id, a.normativ.map(([k, q]) => [k === a.kljuc ? undefined as unknown as string : k, q] as const));
    return v.id;
  }

  for (const a of [...izbrani].sort((x, y) => x.red - y.red)) {
    const obstaja = (a.vloga === "A" ? prodajniPoImenu : neprodajniPoImenu).get(ime(normalizeSlovenianArticleName(a.ime)));
    if (obstaja) { rezultat.preskoceniArtikli++; continue; }
    await razresi(a.kljuc);
  }

  // Pica potrebuje nastavitev testa; obstoječe nastavitve ne spremenimo.
  if (izbrani.some((a) => a.pica)) {
    const [nastavitve] = await tx.select({ enotaId: pizzaDoughSettingsTable.enotaId }).from(pizzaDoughSettingsTable)
      .where(eq(pizzaDoughSettingsTable.enotaId, enotaId));
    if (!nastavitve) {
      await tx.insert(pizzaDoughSettingsTable).values({
        enotaId,
        normalDoughArticleId: await razresi(PRIVZETA_PIZZA.normal),
        smallDoughArticleId: await razresi(PRIVZETA_PIZZA.small),
        familyDoughArticleId: await razresi(PRIVZETA_PIZZA.family),
      }).onConflictDoNothing();
    }
  }
  return rezultat;
}

export async function importirajPrivzeteSifrante(db: any, enotaId: number, izbor: IzborPrivzetihSifrantov) {
  return db.transaction((tx: any) => uvoziPrivzeteSifrante(tx, enotaId, izbor));
}
