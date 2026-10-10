import { and, eq } from "drizzle-orm";
import { artModSkupineTable, db, modSkupineTable, modifikatorjiTable } from "@workspace/db";

/**
 * Samodejne obvezne izbire pri jedeh, kjer natakar mora gosta vedno vprašati.
 * Namenoma ni neobveznih skupin (mleko, led ...): vsaka skupina odpre okno
 * pri vsakem dodajanju artikla in bi upočasnila hiter vnos.
 */
export type SamodejnaSkupina = { ime: string; izbire: string[] };

function normaliziraj(ime: string): string {
  return ime.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const PECENOST: SamodejnaSkupina = {
  ime: "Pečenost",
  izbire: ["Rare (krvavo)", "Medium rare", "Medium", "Medium well", "Well done (prepečeno)"],
};
const JAJCA: SamodejnaSkupina = {
  ime: "Priprava jajc",
  izbire: ["Na oko", "Umešana", "Trdo kuhana", "Mehko kuhana"],
};

export function samodejneSkupineZaArtikel(ime: string): SamodejnaSkupina[] {
  const n = normaliziraj(ime);
  const rezultat: SamodejnaSkupina[] = [];
  // Dunajski, naravni in podobni zrezki iz mletega ali ocvrtega mesa nimajo pečenosti.
  const ocvrto = /dunajsk|ocvrt|panir|cordon|kordon|nesnitzel|zemlj|ptic|piscan|puran/.test(n);
  if (!ocvrto && /biftek|steak|ribeye|rump|burger|hrbet|medaljon|(govej|goved).*(file|zrezek)|file.*(govej|goved)/.test(n)) {
    rezultat.push(PECENOST);
  }
  if (/jajc|jajce/.test(n) && !/na oko|umesan|kuhan|omlet|nadev/.test(n)) rezultat.push(JAJCA);
  return rezultat;
}

/** Fill-only: skupino ustvari ali ponovno uporabi po imenu in jo poveže z artiklom. */
export async function uporabiSamodejneSkupine(
  enotaId: number,
  artikelId: number,
  ime: string,
  dbOrTx: typeof db = db,
): Promise<string[]> {
  const dodane: string[] = [];
  for (const def of samodejneSkupineZaArtikel(ime)) {
    let [skupina] = await dbOrTx.select({ id: modSkupineTable.id }).from(modSkupineTable)
      .where(and(eq(modSkupineTable.enotaId, enotaId), eq(modSkupineTable.ime, def.ime)));
    if (!skupina) {
      [skupina] = await dbOrTx.insert(modSkupineTable).values({
        enotaId, ime: def.ime, obvezna: true, minIzbir: 1, maxIzbir: 1, vrstniRed: 0,
      }).returning({ id: modSkupineTable.id });
      await dbOrTx.insert(modifikatorjiTable).values(
        def.izbire.map((izbira, i) => ({ skupinaId: skupina.id, ime: izbira, cenaDodatek: "0", vrstniRed: i })),
      );
    }
    const [povezava] = await dbOrTx.select({ s: artModSkupineTable.skupinaId }).from(artModSkupineTable)
      .where(and(eq(artModSkupineTable.artikelId, artikelId), eq(artModSkupineTable.skupinaId, skupina.id)));
    if (!povezava) {
      await dbOrTx.insert(artModSkupineTable).values({ artikelId, skupinaId: skupina.id, vrstniRed: 0 });
      dodane.push(def.ime);
    }
  }
  return dodane;
}
