import { eq, sql } from "drizzle-orm";
import { artikliTable, kategorijeTable, normativiTable } from "@workspace/db";
import {
  PRIVZETE_KATEGORIJE, PRIVZETE_SUROVINE, PRIVZETI_ARTIKLI, PRIVZETI_POLIZDELKI,
  type PrivzetaDavcnaKategorija, type PrivzetiArtikel,
} from "./privzeti-sifranti-katalog";
import { normalizeSlovenianArticleName } from "./slovenian-article-name";

export class PrivzetiSifrantiNapaka extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

const ime = (v: string) => normalizeSlovenianArticleName(v).toLocaleLowerCase("sl");
const DAVEK: Record<PrivzetaDavcnaKategorija, string> = {
  food: "9.5", food_drink: "9.5", hot_beverage: "22", cold_beverage: "22", alcoholic: "22", other: "22",
};

/** Katalog za prikaz: obstoječe kategorije in artikli enote so označeni, da jih uvoz preskoči. */
export async function pregledPrivzetihSifrantov(db: any, enotaId: number) {
  const [artikli, kategorije] = await Promise.all([
    db.select({ ime: artikliTable.ime }).from(artikliTable).where(eq(artikliTable.enotaId, enotaId)),
    db.select({ ime: kategorijeTable.ime }).from(kategorijeTable).where(eq(kategorijeTable.enotaId, enotaId)),
  ]);
  const imenaArtiklov = new Set<string>(artikli.map((a: { ime: string }) => ime(a.ime)));
  const imenaKategorij = new Set<string>(kategorije.map((k: { ime: string }) => ime(k.ime)));
  return {
    kategorije: PRIVZETE_KATEGORIJE.map((k) => ({
      kljuc: k.kljuc, ime: k.ime, oddelek: k.oddelek, obstaja: imenaKategorij.has(ime(k.ime)),
      artikli: PRIVZETI_ARTIKLI.filter((a) => a.kategorija === k.kljuc).map((a) => ({
        kljuc: a.kljuc, ime: a.ime, cena: a.cena, davcna: a.davcna, obstaja: imenaArtiklov.has(ime(a.ime)),
      })),
    })),
  };
}

export type IzborPrivzetihSifrantov = { kategorije: readonly string[]; artikli: readonly string[] };
export type RezultatUvoza = {
  kategorije: number; artikli: number; polizdelki: number; surovine: number; normativi: number;
  preskoceniArtikli: number; opozorila: string[];
};

export function preveriIzbor(izbor: unknown): IzborPrivzetihSifrantov {
  const telo = izbor as { kategorije?: unknown; artikli?: unknown } | null;
  const kljuciKat = new Set(PRIVZETE_KATEGORIJE.map((k) => k.kljuc));
  const kljuciArt = new Set(PRIVZETI_ARTIKLI.map((a) => a.kljuc));
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

/**
 * Uvoz je samo dopolnilen: obstoječih kategorij, artiklov, cen in normativov nikoli ne prepiše.
 * Vse poteka v eni transakciji in pod zaklepom enote.
 */
export async function uvoziPrivzeteSifrante(tx: any, enotaId: number, izbor: IzborPrivzetihSifrantov): Promise<RezultatUvoza> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(1315924559::integer, ${enotaId}::integer)`);
  const rezultat: RezultatUvoza = {
    kategorije: 0, artikli: 0, polizdelki: 0, surovine: 0, normativi: 0, preskoceniArtikli: 0, opozorila: [],
  };
  const obstojeci = await tx.select({
    id: artikliTable.id, ime: artikliTable.ime, nabavni: artikliTable.nabavniArtikel,
    prodajni: artikliTable.prodajniArtikel, enota: artikliTable.enotaMere,
  }).from(artikliTable).where(eq(artikliTable.enotaId, enotaId));
  const poImenu = new Map<string, { id: number; nabavni: boolean; prodajni: boolean; enota: string | null }>();
  for (const a of obstojeci) poImenu.set(ime(a.ime), a);

  const izbraniArtikli = PRIVZETI_ARTIKLI.filter((a) => izbor.artikli.includes(a.kljuc));
  const kljuciKategorij = new Set([...izbor.kategorije, ...izbraniArtikli.map((a) => a.kategorija)]);

  // Kategorije
  const obstojeceKat = await tx.select({ id: kategorijeTable.id, ime: kategorijeTable.ime, vrstniRed: kategorijeTable.vrstniRed })
    .from(kategorijeTable).where(eq(kategorijeTable.enotaId, enotaId));
  const katId = new Map<string, number>();
  let naslednjiRed = obstojeceKat.reduce((m: number, k: { vrstniRed: number }) => Math.max(m, k.vrstniRed), -1) + 1;
  for (const k of PRIVZETE_KATEGORIJE) {
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
  const razresi = async (kljuc: string): Promise<number> => {
    const znan = idPoKljucu.get(kljuc);
    if (znan) return znan;
    const pol = PRIVZETI_POLIZDELKI[kljuc];
    const surovina = PRIVZETE_SUROVINE[kljuc];
    if (!pol && !surovina) throw new PrivzetiSifrantiNapaka(500, `Katalog vsebuje neznan vhod ${kljuc}.`);
    const naziv = normalizeSlovenianArticleName((pol ?? surovina!).ime);
    const enota = (pol ?? surovina!).enota;
    const obstaja = poImenu.get(ime(naziv));
    if (obstaja) {
      const primeren = pol ? !obstaja.prodajni : obstaja.nabavni && !obstaja.prodajni;
      if (!primeren) throw new PrivzetiSifrantiNapaka(409, `Artikel »${naziv}« že obstaja z drugačno vlogo; uvoz ni bil izveden.`);
      if (obstaja.enota && obstaja.enota.toUpperCase() !== enota) {
        rezultat.opozorila.push(`»${naziv}« že obstaja z enoto ${obstaja.enota}; katalog uporablja ${enota}.`);
      }
      idPoKljucu.set(kljuc, obstaja.id);
      return obstaja.id;
    }
    let vstavljen: { id: number };
    if (pol) {
      [vstavljen] = await tx.insert(artikliTable).values({
        enotaId, ime: naziv, opis: "Polizdelek iz privzetega šifranta.", cena: "0", davek: "9.5",
        nabavniArtikel: false, prodajniArtikel: false, mealType: "ala_carte", taxCategory: "food",
        enotaMere: pol.enota, qrNaVoljo: false,
      }).returning({ id: artikliTable.id });
      rezultat.polizdelki++;
    } else {
      const s = surovina!;
      const davcna: PrivzetaDavcnaKategorija = s.vrsta === "A" ? "alcoholic" : s.vrsta === "S" ? "cold_beverage" : s.vrsta === "P" ? "other" : "food";
      [vstavljen] = await tx.insert(artikliTable).values({
        enotaId, ime: naziv, cena: "0", davek: DAVEK[davcna], nabavniArtikel: true, prodajniArtikel: false,
        mealType: "ala_carte", vrstaArtikla: "material", taxCategory: davcna, enotaMere: s.enota,
        jeAlkohol: s.vrsta === "A", nabavnaDdvStopnja: s.vrsta === "F" ? "9.5" : "22", qrNaVoljo: false,
      }).returning({ id: artikliTable.id });
      rezultat.surovine++;
    }
    poImenu.set(ime(naziv), { id: vstavljen.id, nabavni: !pol, prodajni: false, enota });
    idPoKljucu.set(kljuc, vstavljen.id);
    if (pol) {
      let red = 0;
      for (const [vhod, kolicina] of pol.normativ) {
        await tx.insert(normativiTable).values({
          artikelId: vstavljen.id, vhodniArtikelId: await razresi(vhod), kolicina: kolicina.toFixed(4), vrstniRed: red++,
        });
        rezultat.normativi++;
      }
    }
    return vstavljen.id;
  };

  const vrstniRedPoKat = new Map<string, number>();
  for (const a of izbraniArtikli) {
    const naziv = normalizeSlovenianArticleName(a.ime);
    if (poImenu.has(ime(naziv))) { rezultat.preskoceniArtikli++; continue; }
    await vstaviArtikel(a, naziv);
  }

  async function vstaviArtikel(a: PrivzetiArtikel, naziv: string) {
    const kat = PRIVZETE_KATEGORIJE.find((k) => k.kljuc === a.kategorija)!;
    const pijaca = a.davcna === "cold_beverage" || a.davcna === "hot_beverage" || a.davcna === "alcoholic";
    const red = vrstniRedPoKat.get(a.kategorija) ?? 0;
    vrstniRedPoKat.set(a.kategorija, red + 1);
    const vhodi: Array<[number, number]> = [];
    for (const [kljuc, kolicina] of a.normativ) vhodi.push([await razresi(kljuc), kolicina]);
    const [vstavljen] = await tx.insert(artikliTable).values({
      enotaId, ime: naziv, cena: a.cena.toFixed(2), davek: DAVEK[a.davcna], aktiven: true,
      kategorijaId: katId.get(a.kategorija), vrstniRed: red,
      nabavniArtikel: a.pakirano, prodajniArtikel: true, mealType: "ala_carte",
      vrstaArtikla: a.pakirano ? "blago" : "storitev", taxCategory: a.davcna, addedSugar: a.dodanSladkor,
      jeAlkohol: a.alkohol, pripravaVrsta: pijaca ? "pijaca" : kat.priprava,
      enotaMere: a.pakirano ? "H87" : null, nabavnaDdvStopnja: a.pakirano ? "22" : null,
    }).returning({ id: artikliTable.id });
    poImenu.set(ime(naziv), { id: vstavljen.id, nabavni: a.pakirano, prodajni: true, enota: a.pakirano ? "H87" : null });
    if (a.pakirano) vhodi.push([vstavljen.id, 1]);
    let vr = 0;
    for (const [vhod, kolicina] of vhodi) {
      await tx.insert(normativiTable).values({
        artikelId: vstavljen.id, vhodniArtikelId: vhod, kolicina: kolicina.toFixed(4), vrstniRed: vr++,
      });
      rezultat.normativi++;
    }
    rezultat.artikli++;
  }
  return rezultat;
}

export async function importirajPrivzeteSifrante(db: any, enotaId: number, izbor: IzborPrivzetihSifrantov) {
  return db.transaction((tx: any) => uvoziPrivzeteSifrante(tx, enotaId, izbor));
}
