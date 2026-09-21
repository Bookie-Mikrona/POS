import { and, eq, inArray } from "drizzle-orm";
import {
  artikliTable, db, kategorijeTable, kdsNalogiTable, kdsPostajeTable, zalogeTable,
} from "@workspace/db";
import { currentBusinessDate, loadPreparedFoodAvailability } from "./prepared-food-availability";

export type OperationalAudience = "staff" | "guest";

export type OperationalArticle = {
  name: string;
  price: number;
  pizzaPrices: Array<{ size: "mala" | "normalna" | "druzinska"; price: number }>;
  available: boolean;
  preparedAvailableQuantity: number | null;
  wine: boolean;
  cigarette: boolean;
  cigaretteStock: number | null;
};

export type OperationalSnapshot = {
  audience: OperationalAudience;
  articles: OperationalArticle[];
  activePizzaTasks: number;
  activeKitchenTasks: number;
  eta: { minutes: number | null; estimated: boolean; reason: string; confidence: "low" | "medium" | "high" };
  freshness: string;
};

const WINE_IDENTITY = /\b(vino|vin[oa]|wine)\b/iu;
const CIGARETTE_IDENTITY = /\b(cigaret\p{L}*|tobak\p{L}*)\b/iu;

/**
 * Minimal, read-only operational view. Public callers only receive articles
 * already visible and sellable through QR; costs, order/customer data and
 * internal identifiers never enter this projection.
 */
export async function loadOperationalSnapshot(enotaId: number, audience: OperationalAudience): Promise<OperationalSnapshot> {
  const businessDate = await currentBusinessDate(enotaId);
  const [rows, prepared, tasks] = await Promise.all([
    db.select({
      id: artikliTable.id,
      name: artikliTable.ime,
      price: artikliTable.cena,
      smallPrice: artikliTable.cenaMala,
      familyPrice: artikliTable.cenaDruzinska,
      active: artikliTable.aktiven,
      salesArticle: artikliTable.prodajniArtikel,
      qrVisible: artikliTable.qrNaVoljo,
      mealType: artikliTable.mealType,
      alcohol: artikliTable.jeAlkohol,
      categoryName: kategorijeTable.ime,
      stock: zalogeTable.kolicina,
      preparationMinutes: artikliTable.casPripraveMin,
    }).from(artikliTable)
      .leftJoin(kategorijeTable, and(eq(kategorijeTable.id, artikliTable.kategorijaId), eq(kategorijeTable.enotaId, enotaId)))
      .leftJoin(zalogeTable, eq(zalogeTable.artikelId, artikliTable.id))
      .where(eq(artikliTable.enotaId, enotaId)),
    loadPreparedFoodAvailability(db, enotaId, businessDate),
    db.select({ stationType: kdsPostajeTable.tip, status: kdsNalogiTable.stanje })
      .from(kdsNalogiTable).innerJoin(kdsPostajeTable, eq(kdsPostajeTable.id, kdsNalogiTable.postajaId))
      .where(and(eq(kdsNalogiTable.enotaId, enotaId), inArray(kdsNalogiTable.stanje, ["aktivno", "ack"]))),
  ]);
  const preparedByArticle = new Map(prepared.items.map(item => [item.articleId, item.availableQuantity]));
  const articles = rows
    .filter(row => row.active && row.salesArticle && (audience === "staff" || row.qrVisible))
    .map((row) => {
      const identity = `${row.name} ${row.categoryName ?? ""}`;
      const wine = row.alcohol && WINE_IDENTITY.test(identity);
      const cigarette = CIGARETTE_IDENTITY.test(identity);
      const quantity = preparedByArticle.get(row.id) ?? null;
      return {
        name: row.name,
        price: Number(row.price),
        pizzaPrices: [
          ...(row.smallPrice == null ? [] : [{ size: "mala" as const, price: Number(row.smallPrice) }]),
          { size: "normalna" as const, price: Number(row.price) },
          ...(row.familyPrice == null ? [] : [{ size: "druzinska" as const, price: Number(row.familyPrice) }]),
        ],
        available: audience === "staff" ? true : row.qrVisible && (quantity == null || quantity > 0),
        preparedAvailableQuantity: quantity,
        wine,
        cigarette,
        // A missing inventory row is unknown, never an assertion of unlimited stock.
        cigaretteStock: cigarette && row.stock != null ? Number(row.stock) : null,
      };
    });
  const activePizzaTasks = tasks.filter(task => task.stationType === "pizza").length;
  const activeKitchenTasks = tasks.filter(task => task.stationType === "pizza" || task.stationType === "kitchen").length;
  const configuredMinutes = rows.filter(row => row.active && row.salesArticle && row.preparationMinutes > 0)
    .map(row => row.preparationMinutes);
  const baseMinutes = configuredMinutes.length ? Math.max(...configuredMinutes) : null;
  return {
    audience, articles, activePizzaTasks, activeKitchenTasks,
    eta: baseMinutes == null
      ? { minutes: null, estimated: true, reason: "Čas priprave ni konfiguriran.", confidence: "low" }
      : { minutes: baseMinutes + activeKitchenTasks * baseMinutes, estimated: true, reason: "Ocena temelji na konfiguriranem času priprave in trenutni KDS čakalni vrsti.", confidence: "medium" },
    freshness: new Date().toISOString(),
  };
}

/** Deterministic live POS answers. Null means that ordinary agent handling may continue. */
export function answerOperationalQuestion(question: string, snapshot: OperationalSnapshot): string | null {
  const normalized = question.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const operational = /\b(cen\p{L}*|stan\p{L}*|cost|price|zalog\p{L}*|stock|na voljo|razpolozljiv\p{L}*|availab\p{L}*|vino|wine|cigaret\p{L}*|tobak\p{L}*|pripravljen\p{L}*|porcij\p{L}*|pic\p{L}*|pizza|kds|cakal\p{L}*|cas\p{L}*|eta|wait\p{L}*)\b/iu.test(normalized);
  if (!operational) return null;
  if (/\b(vino|vina|wine)\b/.test(normalized)) {
    const wines = snapshot.articles.filter(article => article.wine && article.available).map(article => article.name);
    return wines.length ? `Na voljo so vina: ${wines.join(", ")}.` : "Trenutno ni javno razpoložljivih vin.";
  }
  if (/\b(cigaret|tobak)/.test(normalized)) {
    const cigarettes = snapshot.articles.filter(article => article.cigarette);
    if (!cigarettes.length) return "V katalogu ni zanesljivo prepoznanih cigaretnih artiklov.";
    return cigarettes.map(article => `${article.name}: ${article.cigaretteStock == null ? "zaloga ni znana" : `${article.cigaretteStock} na zalogi`}`).join("; ") + ".";
  }
  if (/\b(pic\p{L}*|pizza)\b/u.test(normalized) && /\b(koliko|stevilo|stanje|caka|cakaj)/.test(normalized)) {
    return `V aktivni pizza KDS vrsti je ${snapshot.activePizzaTasks} nalog${snapshot.activePizzaTasks === 1 ? "" : "e"}.`;
  }
  if (/\b(pic\p{L}*|pizza)\b/u.test(normalized) && /\b(kater\p{L}*|which|kaj)\b/u.test(normalized)
    && /\b(priprav\p{L}*|kds|caka|wait)/u.test(normalized)) {
    return `V aktivni pizza KDS vrsti je ${snapshot.activePizzaTasks} nalog${snapshot.activePizzaTasks === 1 ? "" : "e"}; imena posameznih pic v tem javnem posnetku niso na voljo.`;
  }
  if (/\b(cas|eta|koliko.*caka|cakanje|priprava)\b/.test(normalized)) {
    return snapshot.eta.minutes == null
      ? `Časa priprave ni mogoče zanesljivo določiti; ${snapshot.eta.reason}`
      : `Predviden čas je približno ${snapshot.eta.minutes} min. To je ocena: ${snapshot.eta.reason}`;
  }
  const wantsPrice = /\b(cena|stane|koliko stane)\b/.test(normalized);
  if (wantsPrice) {
    const article = snapshot.articles.find(candidate => normalized.includes(candidate.name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()));
    if (article) return `${article.name} stane ${article.price.toFixed(2)} €${article.pizzaPrices.length > 1 ? ` (velikosti: ${article.pizzaPrices.map(size => `${size.size} ${size.price.toFixed(2)} €`).join(", ")})` : ""}.`;
    return "Cena zahtevanega artikla v trenutnem javnem meniju ni na voljo.";
  }
  if (/\b(pripravljena|pripravljene|porcije)\b/.test(normalized)) {
    const available = snapshot.articles.filter(article => article.preparedAvailableQuantity != null)
      .map(article => `${article.name}: ${article.preparedAvailableQuantity} porcij`);
    return available.length ? `Razpoložljivost pripravljene hrane: ${available.join(", ")}.` : "Ni količinsko vodene pripravljene hrane.";
  }
  return "Zahtevani operativni podatek v trenutnem javnem posnetku ni na voljo.";
}