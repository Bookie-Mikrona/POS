import { and, eq } from "drizzle-orm";
import { artModSkupineTable, db, modSkupineTable, modifikatorjiTable } from "@workspace/db";

/**
 * Samodejne skupine izbir. Obvezne (pečenost, jajca) in neobvezne (mleko, led ...).
 * Vsaka skupina odpre okno ob vsakem dodajanju artikla, zato neobvezne skupine
 * dobijo le artikli brez drugih skupin. Vse izbire so brez doplačila.
 */
export type SamodejnaSkupina = { ime: string; izbire: string[]; obvezna?: boolean; maxIzbir?: number };

function normaliziraj(ime: string): string {
  return ime.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const PECENOST: SamodejnaSkupina = {
  ime: "Pečenost",
  obvezna: true,
  izbire: ["Rare (krvavo)", "Medium rare", "Medium", "Medium well", "Well done (prepečeno)"],
};
const JAJCA: SamodejnaSkupina = {
  ime: "Priprava jajc",
  obvezna: true,
  izbire: ["Na oko", "Umešana", "Trdo kuhana", "Mehko kuhana"],
};

const MLEKO: SamodejnaSkupina = { ime: "Mleko", izbire: ["Brez mleka", "Hladno mleko", "Toplo mleko", "Sojino mleko", "Ovseno mleko", "Brez laktoze"] };
const CAJ: SamodejnaSkupina = { ime: "Dodatki k čaju", izbire: ["Z limono", "Z medom"], maxIzbir: 2 };
const LED: SamodejnaSkupina = { ime: "Led", izbire: ["Z ledom", "Brez ledu"] };
const LIMONA: SamodejnaSkupina = { ime: "Limona", izbire: ["Z limono"] };
const PRELIV: SamodejnaSkupina = { ime: "Preliv", izbire: ["Oljčno olje in kis", "Jogurtov preliv", "Brez preliva"] };

/** Neobvezne skupine glede na kategorijo in ime; kličejo se le za artikle brez drugih skupin. */
export function neobveznoSkupineZaArtikel(ime: string, kategorija: string | null | undefined): SamodejnaSkupina[] {
  const n = normaliziraj(ime);
  const k = normaliziraj(kategorija ?? "");
  if (/topl/.test(k)) {
    if (/caj/.test(n)) return [CAJ];
    // Mleko le pri pijačah, ki ga v osnovi vsebujejo (espresso, lungo, turška, ledena ipd. ne).
    if (/macchiato|cappuccino|kapucin|latte|bela|mlek|kakav/.test(n)) return [MLEKO];
    return [];
  }
  if (/brezalk|sok|voda/.test(k)) return [LED, LIMONA];
  if (/zgan/.test(k)) return [LED];
  if (/solat/.test(k)) return [PRELIV];
  return [];
}

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
  kategorija?: string | null,
  dbOrTx: typeof db = db,
): Promise<string[]> {
  const dodane: string[] = [];
  const obstojece = await dbOrTx.select({ s: artModSkupineTable.skupinaId }).from(artModSkupineTable)
    .where(eq(artModSkupineTable.artikelId, artikelId));
  const skupine = [
    ...samodejneSkupineZaArtikel(ime),
    ...(obstojece.length === 0 ? neobveznoSkupineZaArtikel(ime, kategorija) : []),
  ];
  for (const def of skupine) {
    let [skupina] = await dbOrTx.select({ id: modSkupineTable.id }).from(modSkupineTable)
      .where(and(eq(modSkupineTable.enotaId, enotaId), eq(modSkupineTable.ime, def.ime)));
    if (!skupina) {
      [skupina] = await dbOrTx.insert(modSkupineTable).values({
        enotaId, ime: def.ime, obvezna: def.obvezna ?? false,
        minIzbir: def.obvezna ? 1 : 0, maxIzbir: def.obvezna ? 1 : def.maxIzbir ?? 1, vrstniRed: 0,
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
