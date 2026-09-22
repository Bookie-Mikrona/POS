import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import {
  artModSkupineTable,
  artikliTable,
  companiesTable,
  companyPosPlansTable,
  db,
  enoteTable,
  kategorijeTable,
  mizeTable,
  modSkupineTable,
  modifikatorjiTable,
  multicourseMenuCoursesTable,
  multicourseMenusTable,
  narocilaTable,
  narocnikiTable,
  nastavitveTable,
  postavkeTable,
  prostoriTable,
  qrWaiterRequestsTable,
  qrGostNarocilaTable,
  qrGostPovratneInformacijeTable,
  rezervacijeMizTable,
  getPosPlanCapabilities,
} from "@workspace/db";
import {
  CreateQrGostNarociloBody,
  CreateQrGostNarociloResponse,
  ActivatePublicMenuBody,
  ActivatePublicMenuResponse,
  GetPublicMenuQueryParams,
  GetPublicMenuResponse,
  AskPublicMenuAiBody,
  AskPublicMenuAiResponse,
  GetPublicMenuDeviceHistoryQueryParams,
  GetPublicMenuDeviceHistoryResponse,
  GetQrOrderCompletionParams,
  GetQrOrderCompletionQueryParams,
  GetQrOrderCompletionResponse,
  CreateQrOrderFeedbackParams,
  CreateQrOrderFeedbackBody,
  CreateQrOrderFeedbackResponse,
  UpdatePublicOrderTipBody,
  UpdatePublicOrderTipResponse,
} from "@workspace/api-zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getNastavitveMap, isMenuEligibleTaxCategory, loadVatRules, resolveRate, resolveSupplyKind, type TaxCategory } from "../lib/ddv-resolver";
import { round2 } from "../lib/pos-furs";
import { splitMulticourseGross } from "../lib/multicourse-pricing";
import { getSimDatumOrNow } from "../lib/sim-datum";
import { broadcast } from "../lib/pos-sse";
import { osveziPredvidenPrevzem } from "./pos/narocila";
import { readAll } from "./pos/nastavitve";
import { cenaPicePoVelikosti, izracunajVelikostiPic, privzetaVelikostPice, type PizzaVelikostId } from "../lib/pica-velikosti";
import {
  assertPreparedFoodAvailability,
  businessDateForTimestamp,
  buildModifierAvailabilityRequests,
  currentBusinessDate,
  InsufficientPreparedFoodAvailabilityError,
  loadPreparedFoodAvailability,
  loadModifierAvailabilitySnapshots,
} from "../lib/prepared-food-availability";
import { reservationBlockingClause, zakleniMizo } from "../lib/rezervacijeMiz";
import { ipMatchesAnyNetwork } from "../lib/ip-network";
import { isPosBusinessDayClosed, lockPosBusinessDay } from "../lib/pos-z-helpers";
import { calculateTipTreatment, resolveTipPolicy } from "../lib/tip-policy";
import { razresiAlergeneArtikla, razresiAlergeneModifikatorja } from "../lib/alergeni-resolver";
import { answerOperationalQuestion, loadOperationalSnapshot } from "../lib/operational-snapshot";
import { qrGuestHistoryCutoff } from "../lib/qrHistoryRetention";

const router: IRouter = Router();

const RATE_LIMIT = 60;
const ORDER_RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const TOKEN_LENGTH = 43; // 32 naključnih bajtov v base64url obliki.
const QR_NAPRAVA_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QR_GEOFENCE_RADIUS_METERS = 50;
const QR_MAX_LOCATION_ACCURACY_METERS = 50;
const QR_SESSION_DURATION_MS = 30 * 60_000;
const QR_SESSION_COOKIE = "bookie_qr_activation";
type GuestFact =
  | { id: string; kind: "article"; name: string; price: number; available: boolean }
  | { id: string; kind: "wine"; name: string; price: number; available: boolean }
  | { id: string; kind: "queue"; pizzaTasks: number }
  | { id: string; kind: "eta"; minutes: number | null };
type GuestRecommendationKind = "recommend_articles" | "recommend_wines" | "show_pizza_queue" | "show_eta";
type GuestRecommendationSelection = { recommendationKind: GuestRecommendationKind; factIds: string[] };

/** The model may select facts and a closed intent only; prose is rendered by us. */
export function validateGuestRecommendation(
  input: unknown,
  facts: GuestFact[],
): GuestRecommendationSelection | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => key !== "recommendationKind" && key !== "factIds")) return null;
  const kind = value.recommendationKind;
  const ids = value.factIds;
  if (!["recommend_articles", "recommend_wines", "show_pizza_queue", "show_eta"].includes(String(kind))
    || !Array.isArray(ids) || ids.length < 1 || ids.length > 8
    || !ids.every(id => typeof id === "string" && /^[a-z]+:[0-9]+$/.test(id))) return null;
  const selected = ids.map(id => facts.find(fact => fact.id === id)).filter((fact): fact is GuestFact => Boolean(fact));
  if (selected.length !== ids.length) return null;
  if ((kind === "recommend_articles" && !selected.every(fact => fact.kind === "article" && fact.available))
    || (kind === "recommend_wines" && !selected.every(fact => fact.kind === "wine" && fact.available))
    || (kind === "show_pizza_queue" && !selected.every(fact => fact.kind === "queue"))
    || (kind === "show_eta" && !selected.every(fact => fact.kind === "eta"))) return null;
  return { recommendationKind: kind as GuestRecommendationKind, factIds: ids };
}

export function renderGuestRecommendation(selection: GuestRecommendationSelection, facts: GuestFact[]): string | null {
  const selected = selection.factIds.map(id => facts.find(fact => fact.id === id)).filter((fact): fact is GuestFact => Boolean(fact));
  if (!selected.length) return null;
  if (selection.recommendationKind === "recommend_articles" || selection.recommendationKind === "recommend_wines") {
    const articles = selected.filter((fact): fact is Extract<GuestFact, { kind: "article" | "wine" }> => fact.kind === "article" || fact.kind === "wine");
    if (!articles.length) return null;
    return `Na voljo so: ${articles.map(article => `${article.name} (${article.price.toFixed(2)} €)`).join(", ")}.`;
  }
  if (selection.recommendationKind === "show_pizza_queue") {
    const queue = selected[0];
    return queue.kind === "queue" ? `V aktivni pizza KDS vrsti je ${queue.pizzaTasks} nalog${queue.pizzaTasks === 1 ? "" : "e"}.` : null;
  }
  const eta = selected[0];
  if (eta.kind !== "eta") return null;
  return eta.minutes == null ? "Čas priprave trenutno ni na voljo." : `Predviden čas je približno ${eta.minutes} min. To je ocena.`;
}

type RateWindow = { startedAt: number; count: number };
const rateWindows = new Map<string, RateWindow>();
const orderRateWindows = new Map<string, RateWindow>();

function clientAddress(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function rateLimitPublicMenu(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const key = clientAddress(req);
  const previous = rateWindows.get(key);
  const window = !previous || now - previous.startedAt >= RATE_WINDOW_MS
    ? { startedAt: now, count: 0 }
    : previous;

  window.count += 1;
  rateWindows.set(key, window);

  const remaining = Math.max(0, RATE_LIMIT - window.count);
  res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT));
  res.setHeader("X-RateLimit-Remaining", String(remaining));

  if (window.count > RATE_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((window.startedAt + RATE_WINDOW_MS - now) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Preveč zahtev za javni meni. Poskusite znova kasneje." });
    return;
  }

  // Omeji rast pomnilnika, če endpoint dlje časa prejema zahteve z različnih IP-jev.
  if (rateWindows.size > 10_000) {
    for (const [address, value] of rateWindows) {
      if (now - value.startedAt >= RATE_WINDOW_MS) rateWindows.delete(address);
    }
  }

  next();
}

/** Exportirano samo zato, da testi ne delijo časovnega okna med scenariji. */
export function resetJavniMeniRateLimit(): void {
  rateWindows.clear();
  orderRateWindows.clear();
}

function validToken(token: string): boolean {
  return token.length === TOKEN_LENGTH && /^[A-Za-z0-9_-]+$/.test(token);
}

type QrActivationSession = {
  v: 1;
  tokenHash: string;
  enotaId: number;
  mizaId: number;
  qrNapravaId: string;
  exp: number;
};

function qrSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "test") return "bookie-qr-menu-test-session-secret";
  throw new Error("SESSION_SECRET ni nastavljen.");
}

function qrTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function signQrActivationSession(payload: QrActivationSession): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", qrSessionSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function createQrActivationSession(input: {
  token: string;
  enotaId: number;
  mizaId: number;
  qrNapravaId: string;
}): string {
  return signQrActivationSession({
    v: 1,
    tokenHash: qrTokenHash(input.token),
    enotaId: input.enotaId,
    mizaId: input.mizaId,
    qrNapravaId: input.qrNapravaId.toLowerCase(),
    exp: Date.now() + QR_SESSION_DURATION_MS,
  });
}

export function setQrActivationCookie(res: Response, session: string): void {
  res.cookie(QR_SESSION_COOKIE, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/javno/meni",
    maxAge: QR_SESSION_DURATION_MS,
  });
}

/** Testni pripomoček; v ne-testnem procesu namerno odpove. */
export function createQrActivationSessionForTest(input: {
  token: string;
  enotaId: number;
  mizaId: number;
  qrNapravaId: string;
}): string {
  if (process.env.NODE_ENV !== "test") throw new Error("Testna QR seja ni dovoljena.");
  return createQrActivationSession(input);
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function verifyQrActivationSession(
  req: Request,
  token: string,
  context: PublicMenuContext,
  qrNapravaId: string,
  suppliedSession?: string,
): boolean {
  const signed = suppliedSession ?? readCookie(req, QR_SESSION_COOKIE);
  if (!signed) return false;
  const [encoded, suppliedSignature, ...extra] = signed.split(".");
  if (!encoded || !suppliedSignature || extra.length > 0) return false;

  const expectedSignature = createHmac("sha256", qrSessionSecret()).update(encoded).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedSignature, "base64url");
  } catch {
    return false;
  }
  if (supplied.length !== expectedSignature.length || !timingSafeEqual(supplied, expectedSignature)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<QrActivationSession>;
    return payload.v === 1
      && payload.tokenHash === qrTokenHash(token)
      && payload.enotaId === context.enotaId
      && payload.mizaId === context.mizaId
      && payload.qrNapravaId === qrNapravaId.toLowerCase()
      && typeof payload.exp === "number"
      && payload.exp > Date.now();
  } catch {
    return false;
  }
}

/** Klicano šele po uspešnem preverjanju podpisa QR seje. */
function qrActivationSessionExpiresAt(req: Request): number | null {
  const signed = readCookie(req, QR_SESSION_COOKIE);
  const encoded = signed?.split(".")[0];
  if (!encoded) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<QrActivationSession>;
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

/** Razdalja med koordinatama po veliki krožnici, izražena v metrih. */
export function qrGeoDistanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLatitude = radians(latitudeB - latitudeA);
  const deltaLongitude = radians(longitudeB - longitudeA);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB))
    * Math.sin(deltaLongitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toMenuArticle(
  row: {
    id: number;
    naziv: string;
    opis: string | null;
    slikaUrl: string | null;
    cena: string;
    barva: string | null;
    jeAlkohol: boolean;
    qrNaVoljo: boolean;
    jePica: boolean;
    toGo: boolean;
    kategorijaId: number | null;
    kategorijaNaziv: string | null;
    mealType: "ala_carte" | "prepared" | "composite";
    availableQuantity: number | null;
    alergeni?: Array<{ koda: string; naziv: string }>;
    alergeniSledi?: Array<{ koda: string; naziv: string }>;
    alergeniPotrjeni?: boolean;
    alergeniOpozorila?: string[];
  },
  modifikatorji: MenuModifierGroup[],
  toGoEmbalaza: MenuToGoEmbalaža[],
): MenuArticle {
  return {
    id: row.id,
    naziv: row.naziv,
    opis: row.opis,
    slikaUrl: row.slikaUrl,
    cena: Number(row.cena),
    barva: row.barva,
    jeAlkohol: row.jeAlkohol,
    naVoljo: row.qrNaVoljo && (row.availableQuantity == null || row.availableQuantity > 0),
    mealType: row.mealType,
    availableQuantity: row.availableQuantity,
    jePica: row.jePica,
    toGo: row.toGo,
    toGoEmbalaza,
    velikostiPic: [],
    kategorija: row.kategorijaId === null
      ? null
      : { naziv: row.kategorijaNaziv ?? "" },
    modifikatorji,
    alergeni: row.alergeni ?? [],
    alergeniSledi: row.alergeniSledi ?? [],
    alergeniPotrjeni: row.alergeniPotrjeni ?? false,
    alergeniOpozorila: row.alergeniOpozorila ?? [],
  };
}

type MenuModifierOption = {
  id: number;
  naziv: string;
  cena: number;
  alergeni: Array<{ koda: string; naziv: string }>;
  alergeniSledi: Array<{ koda: string; naziv: string }>;
  alergeniPotrjeni: boolean;
  alergeniOpozorila: string[];
};

type MenuModifierGroup = {
  id: number;
  naziv: string;
  obvezna: boolean;
  minIzbir: number;
  maxIzbir: number;
  opcije: MenuModifierOption[];
};

type MenuToGoEmbalaža = {
  id: number;
  naziv: string;
  cena: number;
};

type MenuArticle = {
  id: number;
  naziv: string;
  opis: string | null;
  slikaUrl: string | null;
  cena: number;
  barva: string | null;
  jeAlkohol: boolean;
  /** Artikel ostane v javnem meniju, vendar ga ni mogoče naročiti. */
  naVoljo: boolean;
  jePica: boolean;
  toGo: boolean;
  toGoEmbalaza: MenuToGoEmbalaža[];
  velikostiPic: Array<{ id: PizzaVelikostId; naziv: string; premerCm: number; normativFaktor: number; cena: number }>;
  kategorija: { naziv: string } | null;
  modifikatorji: MenuModifierGroup[];
  mealType: "ala_carte" | "prepared" | "composite";
  availableQuantity: number | null;
  alergeni: Array<{ koda: string; naziv: string }>;
  alergeniSledi: Array<{ koda: string; naziv: string }>;
  alergeniPotrjeni: boolean;
  alergeniOpozorila: string[];
};

type PublicMenuContext = {
  enotaId: number;
  companyId: string;
  jeDdvZavezanec: boolean;
  enotaNaziv: string;
  podjetjeNaziv: string;
  mizaId: number;
  mizaStevilka: number;
  mizaNaziv: string | null;
  prostorNaziv: string | null;
  qrLatitude: number | null;
  qrLongitude: number | null;
  qrWifiNetworks: string[];
};

/**
 * Enoten, namenoma majhen pogled razpoložljivosti za QR meni. Uporabljata ga
 * odgovor menija in SSE zaznavanje sprememb; tako POS sprememba ne more
 * drugače vplivati na prikaz kot na signal za osvežitev.
 */
export type PublicAvailabilityCandidate = {
  id: number;
  active: boolean;
  salesArticle: boolean;
  qrVisible: boolean;
  mealType: "ala_carte" | "prepared" | "composite";
  availableQuantity: number | null;
};

export type PublicAvailabilityProjection = {
  id: number;
  naVoljo: boolean;
  availableQuantity: number | null;
};

export function projectPublicAvailability(
  candidates: PublicAvailabilityCandidate[],
): PublicAvailabilityProjection[] {
  return candidates
    .filter((article) => article.active && article.salesArticle)
    .map((article) => ({
      id: article.id,
      // Količina je omejitev samo za pripravljene in sestavljene jedi.
      // `null` pomeni, da za artikel ni količinske omejitve.
      naVoljo: article.qrVisible
        && (article.mealType === "ala_carte" || article.availableQuantity == null || article.availableQuantity > 0),
      availableQuantity: article.availableQuantity,
    }))
    .sort((left, right) => left.id - right.id);
}

async function resolvePublicMenuContext(token: string): Promise<PublicMenuContext | null> {
  if (!validToken(token)) return null;

  const [context] = await db
    .select({
      enotaId: enoteTable.id,
      companyId: companiesTable.id,
      idZaDdv: companiesTable.idZaDdv,
      enotaNaziv: enoteTable.ime,
      podjetjeNaziv: companiesTable.naziv,
      mizaId: mizeTable.id,
      mizaStevilka: mizeTable.stevilka,
      mizaNaziv: mizeTable.ime,
      prostorNaziv: prostoriTable.ime,
      qrLatitude: enoteTable.qrLatitude,
      qrLongitude: enoteTable.qrLongitude,
      qrWifiNetworks: enoteTable.qrWifiNetworks,
      enotaCapabilities: enoteTable.capabilities,
      posPlan: companyPosPlansTable.plan,
    })
    .from(mizeTable)
    .innerJoin(enoteTable, eq(enoteTable.id, mizeTable.enotaId))
    .innerJoin(companiesTable, eq(companiesTable.id, enoteTable.companyId))
    .leftJoin(companyPosPlansTable, eq(companyPosPlansTable.companyId, enoteTable.companyId))
    .leftJoin(
      prostoriTable,
      and(
        eq(prostoriTable.id, mizeTable.prostorId),
        eq(prostoriTable.enotaId, mizeTable.enotaId),
      ),
    )
    .where(and(eq(mizeTable.qrToken, token), eq(enoteTable.aktiven, true)))
    .limit(1);

  if (
    !context
    || !context.enotaCapabilities.includes("qr_menu")
    || !getPosPlanCapabilities(context.posPlan).includes("qr_menu")
  ) return null;
  const {
    enotaCapabilities: _enotaCapabilities,
    posPlan: _posPlan,
    ...publicContext
  } = context;
  return {
    ...publicContext,
    jeDdvZavezanec: Boolean(context.idZaDdv?.trim()),
    qrLatitude: context.qrLatitude === null ? null : Number(context.qrLatitude),
    qrLongitude: context.qrLongitude === null ? null : Number(context.qrLongitude),
    qrWifiNetworks: context.qrWifiNetworks,
  };
}

async function loadPublicAvailabilityProjection(
  context: PublicMenuContext,
): Promise<PublicAvailabilityProjection[]> {
  const businessDate = await currentBusinessDate(context.enotaId);
  const [articles, availability] = await Promise.all([
    db.select({
      id: artikliTable.id,
      active: artikliTable.aktiven,
      salesArticle: artikliTable.prodajniArtikel,
      qrVisible: artikliTable.qrNaVoljo,
      mealType: artikliTable.mealType,
    }).from(artikliTable).where(eq(artikliTable.enotaId, context.enotaId)),
    loadPreparedFoodAvailability(db, context.enotaId, businessDate),
  ]);
  const quantities = new Map(availability.items.map((item) => [item.articleId, item.availableQuantity]));
  return projectPublicAvailability(articles.map((article) => ({
    ...article,
    mealType: article.mealType ?? "ala_carte",
    availableQuantity: quantities.get(article.id) ?? null,
  })));
}

function rateLimitPublicOrder(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const key = clientAddress(req);
  const previous = orderRateWindows.get(key);
  const window = !previous || now - previous.startedAt >= RATE_WINDOW_MS
    ? { startedAt: now, count: 0 }
    : previous;
  window.count += 1;
  orderRateWindows.set(key, window);

  res.setHeader("X-RateLimit-Limit", String(ORDER_RATE_LIMIT));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, ORDER_RATE_LIMIT - window.count)));
  if (window.count > ORDER_RATE_LIMIT) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((window.startedAt + RATE_WINDOW_MS - now) / 1000))));
    res.status(429).json({ error: "Preveč zahtev za javno naročilo. Poskusite znova kasneje." });
    return;
  }
  next();
}

type QrOrderLine = {
  artikelId: number;
  kolicina: number;
  modifikatorji: number[];
  opomba: string | null;
  velikostPice: PizzaVelikostId | null;
  toGo: boolean;
  courseNumber?: number;
  courseSequence?: number;
  courseNameSnapshot?: string;
  pairingGroupId?: string;
  /** Internal markers assigned only while materializing a configured menu. */
  menuCharge?: boolean;
  /** Ephemeral server-only marker; persisted identity is pairingGroupId + courseNumber. */
  menuComponent?: boolean;
  /** Only configured food components may reference a non-sales article. */
  menuFoodComponent?: boolean;
  /** Server-owned fiscal split metadata for a configured menu charge. */
  menuFoodPercent?: number;
  menuWineVatArticleId?: number;
};

type QrOrderRequest = {
  idempotencyKey: string;
  qrNapravaId: string;
  postavke: QrOrderLine[];
  opomba: string | null;
  znesekNapitnina: number;
  multicourseSelections: Array<{ menuArtikelId: number; courses: Array<{ courseNumber: number; foodArtikelId: number; wineArtikelId: number | null }> }>;
};

export type QrPostavkaCena = {
  artikelCena: number;
  modifikatorjiCena: number;
  skupajCena: number;
  cenaKos: number;
};

/**
 * Izvorni QR izračun cen postavke.
 *
 * `modifikatorjiCena` je skupna cena vseh izbranih dodatkov za vse kose
 * postavke, `skupajCena` pa je artikel + dodatki. V bazi se ta izračun
 * ohrani prek parent postavke in child postavk modifikatorjev, ker brez
 * migracije ni mogoče dodati novih stolpcev v tabelo postavke.
 */
export function izracunajQrPostavkaCeno(
  artikelCenaVhod: number,
  kolicina: number,
  modifikatorji: Array<{ cenaDodatek: number }>,
): QrPostavkaCena {
  const artikelCena = round2(artikelCenaVhod);
  const modifikatorjiCena = round2(
    modifikatorji.reduce(
      (vsota, modifikator) => vsota + round2(modifikator.cenaDodatek * kolicina),
      0,
    ),
  );
  const skupajCena = round2(round2(artikelCena * kolicina) + modifikatorjiCena);

  return {
    artikelCena,
    modifikatorjiCena,
    skupajCena,
    cenaKos: round2(skupajCena / kolicina),
  };
}

function parseQrOrderBody(body: unknown): QrOrderRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const source = body as Record<string, unknown>;
  const qrNapravaId = source.qrNapravaId;
  const idempotencyKey = source.idempotencyKey;
  if (typeof qrNapravaId !== "string" || !QR_NAPRAVA_ID_RE.test(qrNapravaId)) return null;
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) return null;
  if (!Array.isArray(source.postavke) || source.postavke.length < 1 || source.postavke.length > 20) return null;
  const opomba = source.opomba;
  if (opomba !== undefined && (typeof opomba !== "string" || opomba.trim().length > 500)) return null;
  const rawZnesekNapitnina = source.znesekNapitnina;
  const znesekNapitnina = rawZnesekNapitnina === undefined ? 0 : rawZnesekNapitnina;
  if (
    typeof znesekNapitnina !== "number"
    || !Number.isFinite(znesekNapitnina)
    || znesekNapitnina < 0
    || znesekNapitnina > 99_999_999.99
    || Math.abs(znesekNapitnina - round2(znesekNapitnina)) > 1e-9
  ) return null;

  const postavke: QrOrderLine[] = [];
  for (const raw of source.postavke) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const line = raw as Record<string, unknown>;
    const artikelId = line.artikelId;
    const kolicina = line.kolicina;
    const modifikatorji = line.modifikatorji ?? [];
    const lineOpomba = line.opomba;
    const velikostPice = line.velikostPice;
    const toGo = line.toGo;
    if (!Number.isInteger(artikelId) || (artikelId as number) <= 0) return null;
    if (!Number.isInteger(kolicina) || (kolicina as number) < 1 || (kolicina as number) > 20) return null;
    if (!Array.isArray(modifikatorji) || modifikatorji.length > 20) return null;
    if (!modifikatorji.every((id) => Number.isInteger(id) && (id as number) > 0)) return null;
    if (new Set(modifikatorji).size !== modifikatorji.length) return null;
    if (lineOpomba !== undefined && (typeof lineOpomba !== "string" || lineOpomba.trim().length > 300)) return null;
    if (velikostPice !== undefined && !["mala", "normalna", "druzinska"].includes(String(velikostPice))) return null;
    if (toGo !== undefined && typeof toGo !== "boolean") return null;
    postavke.push({
      artikelId: artikelId as number,
      kolicina: kolicina as number,
      modifikatorji: modifikatorji as number[],
      opomba: typeof lineOpomba === "string" ? lineOpomba.trim() || null : null,
      velikostPice: typeof velikostPice === "string" ? velikostPice as PizzaVelikostId : null,
      toGo: toGo === true,
    });
  }
  const multicourseSelections: QrOrderRequest["multicourseSelections"] = [];
  if (source.multicourseSelections !== undefined) {
    if (!Array.isArray(source.multicourseSelections) || source.multicourseSelections.length > 10) return null;
    for (const raw of source.multicourseSelections) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const selection = raw as Record<string, unknown>;
      if (!Number.isInteger(selection.menuArtikelId) || !Array.isArray(selection.courses)) return null;
      const courses: Array<{ courseNumber: number; foodArtikelId: number; wineArtikelId: number | null }> = [];
      for (const rawCourse of selection.courses) {
        if (!rawCourse || typeof rawCourse !== "object" || Array.isArray(rawCourse)) return null;
        const course = rawCourse as Record<string, unknown>;
        if (!Number.isInteger(course.courseNumber) || !Number.isInteger(course.foodArtikelId)
          || (course.foodArtikelId as number) < 1
          || (course.wineArtikelId !== undefined && course.wineArtikelId !== null && !Number.isInteger(course.wineArtikelId))) return null;
        courses.push({ courseNumber: course.courseNumber as number, foodArtikelId: course.foodArtikelId as number, wineArtikelId: course.wineArtikelId as number | null ?? null });
      }
      if (new Set(courses.map(course => course.courseNumber)).size !== courses.length) return null;
      multicourseSelections.push({ menuArtikelId: selection.menuArtikelId as number, courses });
    }
  }
  return {
    idempotencyKey,
    qrNapravaId: qrNapravaId.toLowerCase(),
    postavke,
    opomba: typeof opomba === "string" ? opomba.trim() || null : null,
    znesekNapitnina: round2(znesekNapitnina),
    multicourseSelections,
  };
}

type ExistingQrOrder = {
  narociloId: number;
  skupaj: number;
  znesekNapitnina: number;
  postavke: Array<{
    ime: string;
    kolicina: number;
    cenaKos: number;
    skupaj: number;
    opomba: string | null;
    toGo: boolean;
    velikostPice: PizzaVelikostId | null;
    dodatki: Array<{
      ime: string;
      kolicina: number;
      cenaKos: number;
      skupaj: number;
      tip: "modifikator" | "embalaza";
    }>;
  }>;
};

/** A materialized menu component is identified by persisted course metadata,
 * never by its price: legitimate complimentary lines must remain visible. */
export function isInternalMulticourseMenuComponent(line: {
  pairingGroupId: string | null;
  courseNumber: number | null;
}): boolean {
  return line.pairingGroupId !== null && line.courseNumber !== null;
}

async function najdiObstojeceQrNarocilo(
  context: PublicMenuContext,
  qrNapravaId: string | undefined,
): Promise<ExistingQrOrder | null> {
  if (!qrNapravaId) return null;

  const [narocilo] = await db.select({
    id: narocilaTable.id,
    skupaj: narocilaTable.skupaj,
    znesekNapitnina: narocilaTable.znesekNapitnina,
  }).from(narocilaTable).where(and(
    eq(narocilaTable.enotaId, context.enotaId),
    eq(narocilaTable.mizaId, context.mizaId),
    eq(narocilaTable.vir, "qr_gost"),
    eq(narocilaTable.status, "odprto"),
    eq(narocilaTable.qrNapravaId, qrNapravaId),
  )).limit(1);
  if (!narocilo) return null;

  const rows = await db.select({
    id: postavkeTable.id,
    modifikatorId: postavkeTable.modifikatorId,
    ime: postavkeTable.ime,
    kolicina: postavkeTable.kolicina,
    cenaKos: postavkeTable.cenaKos,
    skupaj: postavkeTable.skupaj,
    opomba: postavkeTable.opomba,
    toGo: postavkeTable.toGo,
    velikostPice: postavkeTable.velikostPice,
    parentPostavkaId: postavkeTable.parentPostavkaId,
    pairingGroupId: postavkeTable.pairingGroupId,
    courseNumber: postavkeTable.courseNumber,
    courseNameSnapshot: postavkeTable.courseNameSnapshot,
  }).from(postavkeTable)
    .where(eq(postavkeTable.narociloId, narocilo.id))
    .orderBy(asc(postavkeTable.id));

  return {
    narociloId: narocilo.id,
    skupaj: Number(narocilo.skupaj),
    znesekNapitnina: Number(narocilo.znesekNapitnina),
    postavke: rows
      .filter((row) => row.parentPostavkaId === null && !isInternalMulticourseMenuComponent(row))
      .map((row) => ({
        ime: row.ime,
        kolicina: row.kolicina,
        cenaKos: Number(row.cenaKos),
        skupaj: Number(row.skupaj),
        opomba: row.opomba,
        toGo: row.toGo,
        velikostPice: row.velikostPice,
        dodatki: rows
          .filter((child) => child.parentPostavkaId === row.id)
          .map((child) => ({
            ime: child.ime,
            kolicina: child.kolicina,
            cenaKos: Number(child.cenaKos),
            skupaj: Number(child.skupaj),
            tip: child.modifikatorId === null ? "embalaza" as const : "modifikator" as const,
          })),
      })),
  };
}

router.post(
  "/javno/meni/:token/natakar",
  rateLimitPublicOrder,
  async (req, res): Promise<void> => {
    const context = await resolvePublicMenuContext(String(req.params.token ?? ""));
    const qrNapravaId = req.body?.qrNapravaId;
    if (!context) { res.status(404).json({ error: "Javni meni ni najden" }); return; }
    if (typeof qrNapravaId !== "string" || !QR_NAPRAVA_ID_RE.test(qrNapravaId)
      || !verifyQrActivationSession(req, String(req.params.token ?? ""), context, qrNapravaId)) {
      res.status(401).json({ error: "Potrditev lokacije je potekla. Ponovno odprite QR meni." }); return;
    }
    // The table lock serializes simultaneous browser taps, while the lookup
    // makes an outstanding caka/potrjeno request idempotent for this device.
    const request = await db.transaction(async tx => {
      if (!await zakleniMizo(tx, context.mizaId, context.enotaId)) throw new Error("MIZA_NI_NAJDENA");
      const [open] = await tx.select().from(qrWaiterRequestsTable).where(and(
        eq(qrWaiterRequestsTable.enotaId, context.enotaId), eq(qrWaiterRequestsTable.mizaId, context.mizaId),
        eq(qrWaiterRequestsTable.qrNapravaId, qrNapravaId),
        inArray(qrWaiterRequestsTable.stanje, ["caka", "potrjeno"]),
      )).limit(1);
      if (open) return open;
      const [created] = await tx.insert(qrWaiterRequestsTable).values({
        enotaId: context.enotaId, mizaId: context.mizaId, qrNapravaId,
      }).returning();
      return created!;
    });
    res.status(201).json({ id: request.id, stanje: request.stanje, ustvarjeno: request.ustvarjeno });
  },
);

router.get(
  "/javno/meni/:token/natakar/trenutni",
  rateLimitPublicMenu,
  async (req, res): Promise<void> => {
    const context = await resolvePublicMenuContext(String(req.params.token ?? ""));
    const qrNapravaId = req.query.qrNapravaId;
    if (!context) { res.status(404).json({ error: "Javni meni ni najden" }); return; }
    if (typeof qrNapravaId !== "string" || !QR_NAPRAVA_ID_RE.test(qrNapravaId)
      || !verifyQrActivationSession(req, String(req.params.token ?? ""), context, qrNapravaId)) {
      res.status(401).json({ error: "Potrditev lokacije je potekla. Ponovno odprite QR meni." }); return;
    }
    const [current] = await db.select().from(qrWaiterRequestsTable).where(and(
      eq(qrWaiterRequestsTable.enotaId, context.enotaId), eq(qrWaiterRequestsTable.mizaId, context.mizaId),
      eq(qrWaiterRequestsTable.qrNapravaId, qrNapravaId),
      inArray(qrWaiterRequestsTable.stanje, ["caka", "potrjeno"]),
    )).orderBy(asc(qrWaiterRequestsTable.ustvarjeno)).limit(1);
    res.json(current ? { id: current.id, stanje: current.stanje, ustvarjeno: current.ustvarjeno } : null);
  },
);

router.post(
  "/javno/meni/:token/napitnina",
  rateLimitPublicOrder,
  async (req, res): Promise<void> => {
    const token = String(req.params.token ?? "");
    const context = await resolvePublicMenuContext(token);
    if (!context) { res.status(404).json({ error: "Javni meni ni najden" }); return; }
    const parsed = UpdatePublicOrderTipBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Podatki napitnine niso veljavni." });
      return;
    }
    const { qrNapravaId, znesekNapitnina } = parsed.data;
    if (typeof qrNapravaId !== "string" || !QR_NAPRAVA_ID_RE.test(qrNapravaId)
      || !verifyQrActivationSession(req, token, context, qrNapravaId)) {
      res.status(401).json({ error: "Potrditev lokacije je potekla. Ponovno odprite QR meni." }); return;
    }

    try {
      const updated = await db.transaction(async (tx) => {
        if (!await zakleniMizo(tx, context.mizaId, context.enotaId)) return null;
        if (znesekNapitnina > 0) {
          const now = await getSimDatumOrNow(context.enotaId);
          const policy = await resolveTipPolicy(context.companyId, context.enotaId, now);
          if (!policy || !policy.agreementConfirmed) throw new Error("QR_TIP_POLICY_REQUIRED");
          calculateTipTreatment(znesekNapitnina, policy, 22);
        }
        const [order] = await tx.update(narocilaTable)
          .set({ znesekNapitnina: String(round2(znesekNapitnina).toFixed(2)) })
          .where(and(
            eq(narocilaTable.enotaId, context.enotaId),
            eq(narocilaTable.mizaId, context.mizaId),
            eq(narocilaTable.vir, "qr_gost"),
            eq(narocilaTable.status, "odprto"),
            eq(narocilaTable.qrNapravaId, qrNapravaId.toLowerCase()),
          ))
          .returning({ id: narocilaTable.id });
        return order ?? null;
      });
      if (!updated) {
        res.status(404).json({ error: "Odprto QR naročilo ni najdeno." });
        return;
      }
      broadcast("update", { type: "narocilo", id: updated.id });
      res.json(UpdatePublicOrderTipResponse.parse({ znesekNapitnina: round2(znesekNapitnina) }));
    } catch (error) {
      if (error instanceof Error && (
        error.message === "QR_TIP_POLICY_REQUIRED"
        || error.message === "TIP_POLICY_EVIDENCE_REQUIRED"
        || error.message === "TIP_POLICY_REQUIRED"
      )) {
        res.status(409).json({
          error: "Napitnine prek QR ni mogoče sprejeti, dokler za poslovni datum ni potrjena veljavna politika napitnin.",
          code: error.message,
        });
        return;
      }
      throw error;
    }
  },
);

async function publicDeviceOrders(context: PublicMenuContext, qrNapravaId: string) {
  const orders = await db.select({
    orderId: narocilaTable.id, status: narocilaTable.status, createdAt: narocilaTable.ustvarjeno,
  }).from(narocilaTable).where(and(
    eq(narocilaTable.enotaId, context.enotaId), eq(narocilaTable.mizaId, context.mizaId),
    eq(narocilaTable.vir, "qr_gost"), eq(narocilaTable.qrNapravaId, qrNapravaId.toLowerCase()),
    gt(narocilaTable.posodobljeno, qrGuestHistoryCutoff()),
  )).orderBy(sql`${narocilaTable.ustvarjeno} DESC`).limit(20);
  const ids = orders.map(order => order.orderId);
  const lines = ids.length ? await db.select({
    orderId: postavkeTable.narociloId, name: postavkeTable.ime, quantity: postavkeTable.kolicina,
    parentId: postavkeTable.parentPostavkaId,
  }).from(postavkeTable).where(inArray(postavkeTable.narociloId, ids)) : [];
  return orders.map(order => ({
    ...order,
    items: lines.filter(line => line.orderId === order.orderId && line.parentId == null)
      .map(line => ({ name: line.name, quantity: line.quantity })),
  }));
}

async function jeQrAiAsistentAktiven(enotaId: number): Promise<boolean> {
  const [nastavitev] = await db.select({ vrednost: nastavitveTable.vrednost })
    .from(nastavitveTable)
    .where(and(
      eq(nastavitveTable.enotaId, enotaId),
      eq(nastavitveTable.kljuc, "qrAiAsistentAktiven"),
    ))
    .limit(1);
  return nastavitev?.vrednost === "true";
}

router.get("/javno/meni/:token/zgodovina", rateLimitPublicMenu, async (req, res): Promise<void> => {
  const query = GetPublicMenuDeviceHistoryQueryParams.safeParse(req.query);
  const context = await resolvePublicMenuContext(String(req.params.token ?? ""));
  if (!context) { res.status(404).json({ error: "Javni meni ni najden" }); return; }
  if (!query.success || !QR_NAPRAVA_ID_RE.test(query.data.qrNapravaId)
    || !verifyQrActivationSession(req, String(req.params.token ?? ""), context, query.data.qrNapravaId)) {
    res.status(401).json({ error: "Potrditev lokacije je potekla. Ponovno odprite QR meni." }); return;
  }
  // z.coerce.boolean("false") is truthy; preserve an explicit opt-in boundary.
  const rawOptIn = req.query.historyOptIn;
  const optedIn = rawOptIn === "true";
  if (!(optedIn || rawOptIn === "false")) { res.status(400).json({ error: "historyOptIn mora biti true ali false." }); return; }
  const orders = optedIn ? await publicDeviceOrders(context, query.data.qrNapravaId) : [];
  res.json(GetPublicMenuDeviceHistoryResponse.parse({ optedIn, orders }));
});

router.post("/javno/meni/:token/ai", rateLimitPublicOrder, async (req, res): Promise<void> => {
  const body = AskPublicMenuAiBody.safeParse(req.body);
  const context = await resolvePublicMenuContext(String(req.params.token ?? ""));
  if (!context) { res.status(404).json({ error: "Javni meni ni najden" }); return; }
  if (!await jeQrAiAsistentAktiven(context.enotaId)) {
    res.status(404).json({ error: "AI asistent ni omogočen." }); return;
  }
  if (!body.success || !QR_NAPRAVA_ID_RE.test(body.data.qrNapravaId)
    || !verifyQrActivationSession(req, String(req.params.token ?? ""), context, body.data.qrNapravaId)) {
    res.status(401).json({ error: "Potrditev lokacije je potekla. Ponovno odprite QR meni." }); return;
  }
  const snapshot = await loadOperationalSnapshot(context.enotaId, "guest");
  const deterministic = answerOperationalQuestion(body.data.question, snapshot);
  if (deterministic) {
    res.json(AskPublicMenuAiResponse.parse({ answer: deterministic, sources: ["operational_snapshot"], freshness: new Date(snapshot.freshness) }));
    return;
  }
  const history = body.data.historyOptIn ? await publicDeviceOrders(context, body.data.qrNapravaId) : [];
  const facts = [
    ...snapshot.articles.slice(0, 100).map((article, index) => ({
      id: `article:${index}`,
      kind: article.wine ? "wine" as const : "article" as const,
      name: article.name, price: article.price, available: article.available,
    })),
    { id: "queue:0", kind: "queue" as const, pizzaTasks: snapshot.activePizzaTasks },
    { id: "eta:0", kind: "eta" as const, minutes: snapshot.eta.minutes },
  ];
  const safeFallback = "Lahko odgovorim na vprašanje o meniju, cenah, razpoložljivosti ali čakalnem času. Za pomoč pri mizi pokličite natakarja.";
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5", max_tokens: 8192,
      system: "Izberi samo recommendationKind in factIds. Nikoli ne piši odgovora ali drugega besedila. Izberi le podane factIds.",
      messages: [{ role: "user", content: JSON.stringify({
        question: body.data.question,
        facts,
        history: history.map(order => ({ status: order.status, createdAt: order.createdAt, itemCount: order.items.length })),
      }) }],
      tools: [{
        name: "guest_recommendation",
        description: "Varni priporočilni odgovor gosta, utemeljen izključno na dejstvih.",
        input_schema: {
          type: "object", properties: {
            recommendationKind: { type: "string", enum: ["recommend_articles", "recommend_wines", "show_pizza_queue", "show_eta"] },
            factIds: { type: "array", items: { type: "string" }, maxItems: 8 },
          }, required: ["recommendationKind", "factIds"], additionalProperties: false,
        },
      }],
      tool_choice: { type: "tool", name: "guest_recommendation" },
    });
    const tool = response.content.find(block => block.type === "tool_use");
    const recommendation = tool?.type === "tool_use" ? validateGuestRecommendation(tool.input, facts) : null;
    const answer = recommendation ? renderGuestRecommendation(recommendation, facts) ?? safeFallback : safeFallback;
    res.json(AskPublicMenuAiResponse.parse({ answer, sources: ["operational_snapshot"], freshness: new Date(snapshot.freshness) }));
  } catch {
    // Deliberately no raw question/device identifier in logs.
    res.json(AskPublicMenuAiResponse.parse({ answer: safeFallback, sources: ["operational_snapshot"], freshness: new Date(snapshot.freshness) }));
  }
});

async function ownedQrOrder(context: PublicMenuContext, orderId: number, qrNapravaId: string) {
  const [order] = await db.select({ id: narocilaTable.id, status: narocilaTable.status })
    .from(narocilaTable).where(and(eq(narocilaTable.id, orderId), eq(narocilaTable.enotaId, context.enotaId),
      eq(narocilaTable.mizaId, context.mizaId), eq(narocilaTable.vir, "qr_gost"),
      eq(narocilaTable.qrNapravaId, qrNapravaId.toLowerCase()))).limit(1);
  return order ?? null;
}

router.get("/javno/meni/:token/narocila/:narociloId/zakljucek", rateLimitPublicMenu, async (req, res): Promise<void> => {
  const params = GetQrOrderCompletionParams.safeParse(req.params);
  const query = GetQrOrderCompletionQueryParams.safeParse(req.query);
  const context = await resolvePublicMenuContext(String(req.params.token ?? ""));
  if (!context || !params.success) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  if (!query.success || !QR_NAPRAVA_ID_RE.test(query.data.qrNapravaId)
    || !verifyQrActivationSession(req, String(req.params.token ?? ""), context, query.data.qrNapravaId)) {
    res.status(401).json({ error: "Potrditev lokacije je potekla. Ponovno odprite QR meni." }); return;
  }
  const order = await ownedQrOrder(context, params.data.narociloId, query.data.qrNapravaId);
  if (!order) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  const [feedback] = await db.select({ id: qrGostPovratneInformacijeTable.id }).from(qrGostPovratneInformacijeTable)
    .where(eq(qrGostPovratneInformacijeTable.narociloId, order.id)).limit(1);
  res.json(GetQrOrderCompletionResponse.parse({ completed: order.status === "zakljuceno", feedbackEligible: order.status === "zakljuceno" && !feedback }));
});

router.post("/javno/meni/:token/narocila/:narociloId/povratna-informacija", rateLimitPublicOrder, async (req, res): Promise<void> => {
  const params = CreateQrOrderFeedbackParams.safeParse(req.params);
  const body = CreateQrOrderFeedbackBody.safeParse(req.body);
  const context = await resolvePublicMenuContext(String(req.params.token ?? ""));
  if (!context || !params.success) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  if (!body.success || !QR_NAPRAVA_ID_RE.test(body.data.qrNapravaId)
    || !verifyQrActivationSession(req, String(req.params.token ?? ""), context, body.data.qrNapravaId)) {
    res.status(401).json({ error: "Potrditev lokacije je potekla. Ponovno odprite QR meni." }); return;
  }
  const order = await ownedQrOrder(context, params.data.narociloId, body.data.qrNapravaId);
  if (!order) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  if (order.status !== "zakljuceno") { res.status(409).json({ error: "Povratna informacija je mogoča po zaključku naročila." }); return; }
  const itemIds = Object.keys(body.data.itemScores ?? {}).map(Number);
  if (itemIds.some(id => !Number.isInteger(id) || id < 1)) { res.status(400).json({ error: "Ocene postavk niso veljavne." }); return; }
  if (itemIds.length) {
    const lines = await db.select({ id: postavkeTable.id }).from(postavkeTable)
      .where(and(eq(postavkeTable.narociloId, order.id), inArray(postavkeTable.id, itemIds)));
    if (lines.length !== itemIds.length) { res.status(400).json({ error: "Ocena se nanaša na postavko drugega naročila." }); return; }
  }
  try {
    const [feedback] = await db.insert(qrGostPovratneInformacijeTable).values({
      enotaId: context.enotaId, narociloId: order.id,
      hranaOcena: body.data.foodScore, ambientOcena: body.data.ambienceScore, storitevOcena: body.data.serviceScore,
      ocenePostavk: body.data.itemScores, komentar: body.data.comment?.trim() || null,
      consentVersion: body.data.consentVersion, consentedAt: new Date(),
    }).returning({ createdAt: qrGostPovratneInformacijeTable.createdAt });
    res.status(201).json(CreateQrOrderFeedbackResponse.parse({ submittedAt: feedback.createdAt }));
  } catch (error) {
    const databaseError = error as { code?: string; cause?: { code?: string } };
    if (databaseError.code === "23505" || databaseError.cause?.code === "23505") {
      res.status(409).json({ error: "Povratna informacija za to naročilo že obstaja." });
      return;
    }
    throw error;
  }
});

router.post(
  "/javno/meni/:token/aktivacija",
  rateLimitPublicMenu,
  async (req, res): Promise<void> => {
    const token = String(req.params.token ?? "");
    const context = await resolvePublicMenuContext(token);
    if (!context) {
      res.status(404).json({ error: "Javni meni ni najden" });
      return;
    }

    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ error: "Podatki aktivacije niso veljavni." });
      return;
    }
    const activationKeys = Object.keys(req.body);
    const allowedKeys = new Set(["qrNapravaId", "latitude", "longitude", "accuracy", "previewSession"]);
    if (activationKeys.some((key) => !allowedKeys.has(key))) {
      res.status(400).json({ error: "Podatki aktivacije vsebujejo neznana polja." });
      return;
    }
    const suppliedGpsKeys = ["latitude", "longitude", "accuracy"]
      .filter((key) => Object.prototype.hasOwnProperty.call(req.body, key));
    if (suppliedGpsKeys.length !== 0 && suppliedGpsKeys.length !== 3) {
      res.status(400).json({ error: "Za GPS preverjanje so potrebni širina, dolžina in natančnost." });
      return;
    }

    const previewSession = typeof req.body.previewSession === "string" ? req.body.previewSession : undefined;
    const { previewSession: _previewSession, ...activationBody } = req.body;
    const parsed = ActivatePublicMenuBody.safeParse(activationBody);
    if (!parsed.success) {
      res.status(400).json({ error: "Podatki lokacije niso veljavni." });
      return;
    }
    const gpsData = "latitude" in parsed.data ? parsed.data : null;

    if (verifyQrActivationSession(req, token, context, parsed.data.qrNapravaId, previewSession)) {
      const expiresAt = qrActivationSessionExpiresAt(req) ?? (Date.now() + QR_SESSION_DURATION_MS);
      res.json(ActivatePublicMenuResponse.parse({
        aktivirano: true,
        veljaDo: new Date(expiresAt).toISOString(),
        radijMetri: QR_GEOFENCE_RADIUS_METERS,
        nacin: "wifi",
      }));
      return;
    }

    const wifiConfigured = context.qrWifiNetworks.length > 0;
    const wifiMatches = wifiConfigured
      && ipMatchesAnyNetwork(clientAddress(req), context.qrWifiNetworks);
    let activationMethod: "gps" | "wifi" | null = null;
    let gpsFailure: { status: number; error: string } | null = null;

    if (gpsData) {
      if (context.qrLatitude === null || context.qrLongitude === null) {
        gpsFailure = { status: 409, error: "Lokacija QR menija za ta lokal še ni nastavljena." };
      } else if (gpsData.accuracy > QR_MAX_LOCATION_ACCURACY_METERS) {
        gpsFailure = {
          status: 403,
          error: "Lokacije ni mogoče dovolj natančno določiti. Povežite se na lokalni Wi-Fi in poskusite znova.",
        };
      } else {
        const distance = qrGeoDistanceMeters(
          context.qrLatitude,
          context.qrLongitude,
          gpsData.latitude,
          gpsData.longitude,
        );
        // Navedena GPS natančnost je polmer negotovosti. Sprejmemo le napravo,
        // katere celotno možno območje lokacije ostane znotraj 50-metrske meje.
        if (distance + gpsData.accuracy <= QR_GEOFENCE_RADIUS_METERS) {
          activationMethod = "gps";
        } else {
          gpsFailure = {
            status: 403,
            error: "QR meni je mogoče uporabljati samo v lokalu ali največ 50 m od njega oziroma prek lokalnega Wi-Fi-ja.",
          };
        }
      }
    }

    if (!activationMethod && wifiMatches) activationMethod = "wifi";
    if (!activationMethod) {
      if (gpsFailure) {
        res.status(gpsFailure.status).json({ error: gpsFailure.error });
      } else if (wifiConfigured) {
        res.status(403).json({
          error: "GPS lokacije ni bilo mogoče preveriti. Povežite se na lokalni Wi-Fi in poskusite znova.",
        });
      } else {
        res.status(409).json({
          error: "Za ta lokal ni nastavljena niti GPS lokacija niti dovoljeni javni IP lokalnega Wi-Fi-ja.",
        });
      }
      return;
    }

    const expiresAt = Date.now() + QR_SESSION_DURATION_MS;
    const session = signQrActivationSession({
      v: 1,
      tokenHash: qrTokenHash(token),
      enotaId: context.enotaId,
      mizaId: context.mizaId,
      qrNapravaId: parsed.data.qrNapravaId.toLowerCase(),
      exp: expiresAt,
    });
    setQrActivationCookie(res, session);
    res.json(ActivatePublicMenuResponse.parse({
      aktivirano: true,
      veljaDo: new Date(expiresAt).toISOString(),
      radijMetri: QR_GEOFENCE_RADIUS_METERS,
      nacin: activationMethod,
    }));
  },
);

/**
 * Javni SSE tok ne uporablja skupnega POS toka: preverjanje podpisane QR seje
 * ga veže na točno mizo in enoto, signal pa ne vsebuje imen, artiklov ali
 * podatkov druge enote. Strežnik primerja kanonični pogled na nekaj sekund,
 * zato zajame tudi POS spremembe zaloge, ki niso nastale prek QR poti.
 */
router.get(
  "/javno/meni/:token/dogodki",
  async (req, res): Promise<void> => {
    const token = String(req.params.token ?? "");
    const qrNapravaId = typeof req.query.qrNapravaId === "string" ? req.query.qrNapravaId : "";
    const context = await resolvePublicMenuContext(token);
    if (!context) {
      res.status(404).json({ error: "Javni meni ni najden" });
      return;
    }
    if (!QR_NAPRAVA_ID_RE.test(qrNapravaId) || !verifyQrActivationSession(req, token, context, qrNapravaId)) {
      res.status(401).json({ error: "Za spremljanje QR menija morate najprej potrditi lokacijo." });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let closed = false;
    let previousRevision: string | null = null;
    const write = (event: string, data: unknown): void => {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const publishIfChanged = async (): Promise<void> => {
      try {
        const projection = await loadPublicAvailabilityProjection(context);
        const revision = createHash("sha256").update(JSON.stringify(projection)).digest("base64url");
        if (previousRevision === null) {
          previousRevision = revision;
          write("ready", { revision });
        } else if (revision !== previousRevision) {
          previousRevision = revision;
          write("availability", { revision });
        }
      } catch {
        // Tok ostane odprt; naslednji interval lahko uspe, odjemalec pa ima
        // še vedno svoj običajni interval osveževanja kot varovalko.
      }
    };

    await publishIfChanged();
    const keepalive = setInterval(() => write("ping", {}), 25_000);
    const watcher = setInterval(() => { void publishIfChanged(); }, 3_000);
    const expiresAt = qrActivationSessionExpiresAt(req);
    const expiryTimer = setTimeout(() => {
      closed = true;
      clearInterval(keepalive);
      clearInterval(watcher);
      res.end();
    }, Math.max(0, (expiresAt ?? Date.now()) - Date.now()));
    req.on("close", () => {
      closed = true;
      clearInterval(keepalive);
      clearInterval(watcher);
      clearTimeout(expiryTimer);
    });
  },
);

router.get(
  "/javno/meni/:token",
  rateLimitPublicMenu,
  async (req, res): Promise<void> => {
    const query = GetPublicMenuQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Identifikator QR naprave ni veljaven." });
      return;
    }
    const context = await resolvePublicMenuContext(String(req.params.token ?? ""));
    if (!context) {
      res.status(404).json({ error: "Javni meni ni najden" });
      return;
    }
    if (!query.data.qrNapravaId || !verifyQrActivationSession(
      req,
      String(req.params.token ?? ""),
      context,
      query.data.qrNapravaId,
    )) {
      res.status(401).json({ error: "Za uporabo QR menija morate najprej potrditi lokacijo." });
      return;
    }

    const businessDate = await currentBusinessDate(context.enotaId);
    // Course food may deliberately be non-sales: it is an operational
    // component, not an independently orderable QR article. Load it for the
    // dialog's article lookup, while keeping it out of public categories.
    const configuredMenus = await db.select().from(multicourseMenusTable).where(and(
      eq(multicourseMenusTable.enotaId, context.enotaId),
      eq(multicourseMenusTable.aktivno, true),
    ));
    const configuredCourses = configuredMenus.length
      ? await db.select().from(multicourseMenuCoursesTable)
        .where(inArray(multicourseMenuCoursesTable.menuId, configuredMenus.map(menu => menu.id)))
      : [];
    const configuredCourseFoodArticleIds = new Set(configuredCourses.flatMap(course =>
      course.allowedFoodArtikelIds.length ? course.allowedFoodArtikelIds : [course.foodArtikelId],
    ));
    const [pizzaNastavitve, rawArticleRows, obstojeceNarocilo, availabilityState] = await Promise.all([
      readAll("", context.enotaId),
      db
      .select({
        id: artikliTable.id,
        naziv: artikliTable.ime,
        opis: artikliTable.opis,
        slikaUrl: artikliTable.slikaUrl,
        cena: artikliTable.cena,
        cenaMala: artikliTable.cenaMala,
        cenaDruzinska: artikliTable.cenaDruzinska,
        barva: artikliTable.barva,
        jeAlkohol: artikliTable.jeAlkohol,
        qrNaVoljo: artikliTable.qrNaVoljo,
        jePica: artikliTable.jePica,
        toGo: artikliTable.toGo,
        toGoArtikli: artikliTable.toGoArtikli,
        vrstniRed: artikliTable.vrstniRed,
        kategorijaId: kategorijeTable.id,
        kategorijaNaziv: kategorijeTable.ime,
        kategorijaVrstniRed: kategorijeTable.vrstniRed,
        mealType: artikliTable.mealType,
        salesArticle: artikliTable.prodajniArtikel,
      })
      .from(artikliTable)
      .leftJoin(
        kategorijeTable,
        and(
          eq(kategorijeTable.id, artikliTable.kategorijaId),
          eq(kategorijeTable.enotaId, context.enotaId),
        ),
      )
      .where(and(
        eq(artikliTable.enotaId, context.enotaId),
        eq(artikliTable.aktiven, true),
        configuredCourseFoodArticleIds.size
          ? or(eq(artikliTable.prodajniArtikel, true), inArray(artikliTable.id, [...configuredCourseFoodArticleIds]))
          : eq(artikliTable.prodajniArtikel, true),
      ))
      .orderBy(
        asc(kategorijeTable.vrstniRed),
        asc(artikliTable.vrstniRed),
        asc(artikliTable.id),
      ),
      najdiObstojeceQrNarocilo(context, query.data.qrNapravaId),
      loadPreparedFoodAvailability(db, context.enotaId, businessDate),
    ]);
    const availabilityByArticle = new Map(
      availabilityState.items.map((item) => [item.articleId, item.availableQuantity]),
    );
    // A configured multicourse menu is a commercial wrapper, not a prepared
    // portion. Its own availability must not hide it from the public menu.
    const configuredMenuArticleIds = new Set(configuredMenus.map((menu) => menu.menuArtikelId));
    const availabilityProjectionByArticle = new Map(projectPublicAvailability(rawArticleRows.map((article) => ({
      id: article.id,
      // Poizvedba že omeji aktivne prodajne artikle; vrednosti so vseeno
      // zapisane tukaj, da GET uporablja povsem isti projektor kot SSE.
      active: true,
      salesArticle: article.salesArticle,
      qrVisible: article.qrNaVoljo,
      mealType: article.mealType ?? "ala_carte",
      availableQuantity: availabilityByArticle.get(article.id) ?? null,
    }))).map((item) => [item.id, item]));
    const articleRows = rawArticleRows
      .map((article) => ({
        ...article,
        qrNaVoljo: configuredMenuArticleIds.has(article.id)
          ? article.qrNaVoljo
          : availabilityProjectionByArticle.get(article.id)?.naVoljo ?? false,
        mealType: article.mealType ?? "ala_carte" as const,
        availableQuantity: availabilityByArticle.get(article.id) ?? null,
      }))
      .filter((article) => (
        configuredCourseFoodArticleIds.has(article.id)
        || configuredMenuArticleIds.has(article.id)
        || article.mealType === "ala_carte"
        || article.availableQuantity == null
        || article.availableQuantity > 0
      ));
    const velikostiPic = izracunajVelikostiPic(pizzaNastavitve);
    const toGoEmbalazaIds = Array.from(new Set(
      articleRows
        .filter((article) => article.toGo)
        .flatMap((article) => Array.isArray(article.toGoArtikli) ? article.toGoArtikli : [])
        .filter((artikelId): artikelId is number => Number.isInteger(artikelId) && artikelId > 0),
    ));
    const toGoEmbalazaRows = toGoEmbalazaIds.length > 0
      ? await db.select({
          id: artikliTable.id,
          naziv: artikliTable.ime,
          cena: artikliTable.cena,
        }).from(artikliTable).where(and(
          inArray(artikliTable.id, toGoEmbalazaIds),
          eq(artikliTable.enotaId, context.enotaId),
          eq(artikliTable.aktiven, true),
        ))
      : [];
    const toGoEmbalazaById = new Map(toGoEmbalazaRows.map((artikel) => [artikel.id, {
      id: artikel.id,
      naziv: artikel.naziv,
      cena: Number(artikel.cena),
    }]));

    const articleIds = articleRows.map((article) => article.id);
    const modifierRows = articleIds.length === 0
      ? []
      : await db
        .select({
          artikelId: artModSkupineTable.artikelId,
          skupinaId: modSkupineTable.id,
          skupinaNaziv: modSkupineTable.ime,
          obvezna: modSkupineTable.obvezna,
          minIzbir: modSkupineTable.minIzbir,
          maxIzbir: modSkupineTable.maxIzbir,
          skupinaVrstniRed: modSkupineTable.vrstniRed,
          opcijaId: modifikatorjiTable.id,
          opcijaNaziv: modifikatorjiTable.ime,
          opcijaCena: modifikatorjiTable.cenaDodatek,
          opcijaVrstniRed: modifikatorjiTable.vrstniRed,
        })
        .from(artModSkupineTable)
        .innerJoin(modSkupineTable, eq(modSkupineTable.id, artModSkupineTable.skupinaId))
        .leftJoin(
          modifikatorjiTable,
          and(
            eq(modifikatorjiTable.skupinaId, modSkupineTable.id),
            eq(modifikatorjiTable.aktiven, true),
          ),
        )
        .where(and(
          inArray(artModSkupineTable.artikelId, articleIds),
          eq(modSkupineTable.enotaId, context.enotaId),
        ))
        .orderBy(
          asc(artModSkupineTable.vrstniRed),
          asc(modSkupineTable.vrstniRed),
          asc(modSkupineTable.id),
          asc(modifikatorjiTable.vrstniRed),
          asc(modifikatorjiTable.id),
        );

    const modifierGroupsByArticle = new Map<number, MenuModifierGroup[]>();
    for (const row of modifierRows) {
      let groups = modifierGroupsByArticle.get(row.artikelId);
      if (!groups) {
        groups = [];
        modifierGroupsByArticle.set(row.artikelId, groups);
      }

      let group = groups.find((candidate) => candidate.id === row.skupinaId);
      if (!group) {
        group = {
          id: row.skupinaId,
          naziv: row.skupinaNaziv,
          obvezna: row.obvezna,
          minIzbir: row.minIzbir,
          maxIzbir: row.maxIzbir,
          opcije: [],
        };
        groups.push(group);
      }

      if (row.opcijaId !== null) {
        group.opcije.push({
          id: row.opcijaId,
          naziv: row.opcijaNaziv ?? "",
          cena: Number(row.opcijaCena),
          alergeni: [],
          alergeniSledi: [],
          alergeniPotrjeni: false,
          alergeniOpozorila: ["Alergenski podatki niso preverjeni."],
        });
      }
    }

    const modifierOptions = Array.from(modifierGroupsByArticle.values()).flatMap((groups) => groups.flatMap((group) => group.opcije));
    const modifierAllergens = await Promise.all(modifierOptions.map((option) => razresiAlergeneModifikatorja(option.id, context.enotaId)));
    modifierOptions.forEach((option, index) => {
      const summary = modifierAllergens[index]!;
      option.alergeni = summary.alergeni; option.alergeniSledi = summary.alergeniSledi;
      option.alergeniPotrjeni = summary.potrjen; option.alergeniOpozorila = summary.opozorila;
    });
    const izracuniAlergenov = await Promise.all(articleRows.map((article) => razresiAlergeneArtikla(article.id, context.enotaId)));
    const artikli = articleRows.map((row, index) => ({
      ...toMenuArticle(
        { ...row,
          alergeni: izracuniAlergenov[index]?.alergeni ?? [],
          alergeniSledi: izracuniAlergenov[index]?.alergeniSledi ?? [],
          alergeniPotrjeni: izracuniAlergenov[index]?.potrjen ?? false,
          alergeniOpozorila: izracuniAlergenov[index]?.opozorila ?? ["Alergenski podatki niso preverjeni."],
        },
        modifierGroupsByArticle.get(row.id) ?? [],
        row.toGo
          ? Array.from(new Set(
              (Array.isArray(row.toGoArtikli) ? row.toGoArtikli : [])
                .filter((artikelId): artikelId is number => Number.isInteger(artikelId) && artikelId > 0 && artikelId !== row.id),
            ))
              .map((artikelId) => toGoEmbalazaById.get(artikelId))
              .filter((artikel): artikel is MenuToGoEmbalaža => artikel !== undefined)
          : [],
      ),
      velikostiPic: row.jePica
        ? velikostiPic.map((velikost) => ({
          ...velikost,
          cena: cenaPicePoVelikosti(row, velikost.id) ?? Number(row.cena),
        }))
        : [],
    }));

    const kategorije = new Map<string, { naziv: string; artikli: MenuArticle[] }>();
    for (const artikel of artikli) {
      if (!articleRows.find((row) => row.id === artikel.id)?.salesArticle) continue;
      if (!artikel.kategorija) continue;
      let kategorija = kategorije.get(artikel.kategorija.naziv);
      if (!kategorija) {
        kategorija = { naziv: artikel.kategorija.naziv, artikli: [] };
        kategorije.set(artikel.kategorija.naziv, kategorija);
      }
      kategorija.artikli.push(artikel);
    }
    const visibleMenuArticleIds = new Set(artikli.map(artikel => artikel.id));
    const publicMenus = configuredMenus.filter(menu => visibleMenuArticleIds.has(menu.menuArtikelId));
    const publicCourses = configuredCourses.filter(course => publicMenus.some(menu => menu.id === course.menuId));

    res.json(GetPublicMenuResponse.parse({
      qrAiAsistentAktiven: await jeQrAiAsistentAktiven(context.enotaId),
      lokal: {
        podjetjeNaziv: context.podjetjeNaziv,
        enotaNaziv: context.enotaNaziv,
      },
      miza: {
        stevilka: context.mizaStevilka,
        naziv: context.mizaNaziv,
        prostorNaziv: context.prostorNaziv,
      },
      kategorije: Array.from(kategorije.values()),
      artikli,
      multicourseMenus: publicMenus.map(menu => ({
        menuArtikelId: menu.menuArtikelId,
        izbor: menu.izbor,
        selectionMode: menu.selectionMode,
        selectionCount: menu.selectionCount,
        courses: publicCourses.filter(course => course.menuId === menu.id).sort((a, b) => a.courseNumber - b.courseNumber).map(course => ({
          courseNumber: course.courseNumber,
          courseName: course.courseName,
          foodArtikelId: course.foodArtikelId,
          allowedFoodArtikelIds: course.allowedFoodArtikelIds.length
            ? course.allowedFoodArtikelIds : [course.foodArtikelId],
          allowedWineArtikelIds: course.allowedWineArtikelIds,
          wineRequired: course.wineRequired,
          informational: course.informational,
        })),
      })),
      obstojeceNarocilo,
    }));
  },
);

router.post(
  "/javno/meni/:token/narocilo",
  rateLimitPublicOrder,
  async (req, res): Promise<void> => {
    const context = await resolvePublicMenuContext(String(req.params.token ?? ""));
    if (!context) {
      res.status(404).json({ error: "Javni meni ni najden" });
      return;
    }
    const contractInput = CreateQrGostNarociloBody.safeParse(req.body);
    const input = contractInput.success ? parseQrOrderBody(contractInput.data) : null;
    if (!input) {
      res.status(400).json({ error: "Naročilo ni veljavno." });
      return;
    }
    if (!verifyQrActivationSession(
      req,
      String(req.params.token ?? ""),
      context,
      input.qrNapravaId,
    )) {
      res.status(401).json({ error: "Potrditev lokacije je potekla. Ponovno odprite QR meni." });
      return;
    }
    // Course choices are server materialized.  A configured menu article is
    // never an ordinary line: every parent menu line and selection must form a
    // one-to-one pair before any generated component is appended.
    const requestedMenuArticleIds = [...new Set([
      ...input.postavke.map((line) => line.artikelId),
      ...input.multicourseSelections.map((selection) => selection.menuArtikelId),
    ])];
    const configuredMenus = requestedMenuArticleIds.length
      ? await db.select().from(multicourseMenusTable).where(and(
        eq(multicourseMenusTable.enotaId, context.enotaId),
        eq(multicourseMenusTable.aktivno, true),
        inArray(multicourseMenusTable.menuArtikelId, requestedMenuArticleIds),
      ))
      : [];
    const configuredMenuArticleIds = new Set(configuredMenus.map((menu) => menu.menuArtikelId));
    const configuredParentLines = input.postavke.filter((line) => configuredMenuArticleIds.has(line.artikelId));
    const selectedMenuArticleIds = input.multicourseSelections.map((selection) => selection.menuArtikelId);
    if (
      new Set(selectedMenuArticleIds).size !== selectedMenuArticleIds.length
      || configuredParentLines.length !== input.multicourseSelections.length
      || configuredParentLines.some((line) => selectedMenuArticleIds.filter((id) => id === line.artikelId).length !== 1)
      || input.multicourseSelections.some((selection) => !configuredMenuArticleIds.has(selection.menuArtikelId))
    ) {
      res.status(400).json({ error: "Vsaka večhodna menijska postavka mora imeti natanko eno izbiro hodov." });
      return;
    }
    if (input.multicourseSelections.length) {
      const menuIds = selectedMenuArticleIds;
      if (new Set(menuIds).size !== menuIds.length) {
        res.status(400).json({ error: "Meni je lahko izbran samo enkrat." }); return;
      }
      const menus = configuredMenus;
      if (menus.length !== menuIds.length) { res.status(400).json({ error: "Izbrani večhodni meni ni na voljo." }); return; }
      const courses = await db.select().from(multicourseMenuCoursesTable)
        .where(inArray(multicourseMenuCoursesTable.menuId, menus.map(menu => menu.id)));
      for (const selection of input.multicourseSelections) {
        const menu = menus.find(candidate => candidate.menuArtikelId === selection.menuArtikelId)!;
        const configured = courses.filter(course => course.menuId === menu.id);
        const normalCourses = configured.filter(course => !course.informational);
        // Direct legacy inserts may retain the new column default instead of
        // migration-backfilled values; preserve the legacy alias in that shape.
        const selectionMode = menu.izbor === "choose_three" && menu.selectionMode === "fixed" && menu.selectionCount == null
          ? "choose"
          : menu.selectionMode ?? (menu.izbor === "choose_three" ? "choose" : "fixed");
        const required = selectionMode === "fixed" ? normalCourses.length : (menu.selectionCount ?? 3);
        if (configured.length < 2 || configured.length > 20 || configured.some((course, index) => course.courseNumber !== index + 1)
          || required < 1 || required > normalCourses.length || selection.courses.length !== required
          || selection.courses.some(choice => !configured.some(course => course.courseNumber === choice.courseNumber))) {
          res.status(400).json({ error: "Izbira hodov večhodnega menija ni veljavna." }); return;
        }
        const group = `${menu.id}:${input.qrNapravaId}:${input.idempotencyKey}`;
        const menuLines = input.postavke.filter((line) => line.artikelId === menu.menuArtikelId);
        if (menuLines.length !== 1 || menuLines[0]!.kolicina !== 1
          || menuLines[0]!.modifikatorji.length !== 0 || menuLines[0]!.toGo) {
          res.status(400).json({ error: "Večhodni meni mora vsebovati eno nespremenjeno menijsko postavko." }); return;
        }
        // The menu article is the commercial line. It is deliberately not a
        // prepared-food component, and its pairing group lets KDS skip it.
        menuLines[0]!.menuCharge = true;
        menuLines[0]!.pairingGroupId = group;
        if (selection.courses.some(choice => {
          const configuredCourse = configured.find(course => course.courseNumber === choice.courseNumber)!;
          const foods = configuredCourse.allowedFoodArtikelIds.length
            ? configuredCourse.allowedFoodArtikelIds : [configuredCourse.foodArtikelId];
          return configuredCourse.informational || !foods.includes(choice.foodArtikelId)
            || (configuredCourse.wineRequired !== false && (choice.wineArtikelId === null || !configuredCourse.allowedWineArtikelIds.includes(choice.wineArtikelId)))
            || (configuredCourse.wineRequired === false && choice.wineArtikelId !== null && !configuredCourse.allowedWineArtikelIds.includes(choice.wineArtikelId));
        })) {
          res.status(400).json({ error: "Izbira hrane ali vina za hod ni veljavna." }); return;
        }
        const selectedWineId = selection.courses.find(choice => choice.wineArtikelId !== null)?.wineArtikelId ?? null;
        const configuredFoodPercent = Number(menu.foodPricePercent);
        if (selectedWineId !== null && configuredFoodPercent >= 100) {
          res.status(400).json({ error: "Vinska spremljava je izbrana, vendar delež cene vina ni nastavljen." }); return;
        }
        if (configuredFoodPercent < 100 && selectedWineId === null) {
          res.status(400).json({ error: "Meni ima določen delež vina, vendar vinska spremljava ni izbrana." }); return;
        }
        menuLines[0]!.menuFoodPercent = configuredFoodPercent;
        menuLines[0]!.menuWineVatArticleId = selectedWineId ?? undefined;
        const materialized = [...selection.courses, ...configured.filter(course => course.informational).map(course => ({
          courseNumber: course.courseNumber, foodArtikelId: course.foodArtikelId, wineArtikelId: null,
        }))].sort((a, b) => a.courseNumber - b.courseNumber);
        materialized.forEach((choice, index) => {
          const configuredCourse = configured.find(course => course.courseNumber === choice.courseNumber)!;
          input.postavke.push({
            artikelId: choice.foodArtikelId, kolicina: 1, modifikatorji: [], opomba: null,
            velikostPice: null, toGo: false, courseNumber: choice.courseNumber, courseSequence: index + 1, pairingGroupId: group,
             courseNameSnapshot: configuredCourse.courseName,
            menuComponent: true, menuFoodComponent: true,
          });
          if (choice.wineArtikelId !== null) {
            input.postavke.push({
              artikelId: choice.wineArtikelId, kolicina: 1, modifikatorji: [], opomba: null,
              velikostPice: null, toGo: false, courseNumber: choice.courseNumber, courseSequence: index + 1, pairingGroupId: group,
               courseNameSnapshot: configuredCourse.courseName,
              menuComponent: true,
            });
          }
        });
      }
      if (input.postavke.length > 20) { res.status(400).json({ error: "Naročilo vsebuje preveč postavk." }); return; }
    }
    const requestFingerprint = createHash("sha256").update(JSON.stringify({
      qrNapravaId: input.qrNapravaId,
      postavke: input.postavke,
      opomba: input.opomba,
      znesekNapitnina: input.znesekNapitnina,
      multicourseSelections: input.multicourseSelections,
    })).digest("hex");

    const articleIds = [...new Set(input.postavke.map((postavka) => postavka.artikelId))];
    const materializedCourseArticleIds = new Set(
      input.postavke.filter(line => line.courseNumber !== undefined).map(line => line.artikelId),
    );
    const materializedFoodComponentArticleIds = new Set(
      input.postavke.filter(line => line.menuFoodComponent).map(line => line.artikelId),
    );
    const articleRows = await db.select({
      id: artikliTable.id,
      ime: artikliTable.ime,
      cena: artikliTable.cena,
      cenaMala: artikliTable.cenaMala,
      cenaDruzinska: artikliTable.cenaDruzinska,
      davek: artikliTable.davek,
      jePica: artikliTable.jePica,
      toGo: artikliTable.toGo,
      toGoArtikli: artikliTable.toGoArtikli,
      vrstaArtikla: artikliTable.vrstaArtikla,
      mealType: artikliTable.mealType,
      salesArticle: artikliTable.prodajniArtikel,
      taxCategory: artikliTable.taxCategory,
      addedSugar: artikliTable.addedSugar,
      jeDelMenija: artikliTable.jeDelMenija,
    }).from(artikliTable).where(and(
      eq(artikliTable.enotaId, context.enotaId),
      eq(artikliTable.aktiven, true),
       materializedFoodComponentArticleIds.size
         ? or(eq(artikliTable.prodajniArtikel, true), inArray(artikliTable.id, [...materializedFoodComponentArticleIds]))
         : eq(artikliTable.prodajniArtikel, true),
       or(eq(artikliTable.qrNaVoljo, true), inArray(artikliTable.id, [...materializedCourseArticleIds])),
      inArray(artikliTable.id, articleIds),
    ));
    if (articleRows.length !== articleIds.length) {
      res.status(400).json({ error: "Eden od izbranih artiklov ni več na voljo." });
      return;
    }

    const toGoArtikelIds = Array.from(new Set(
      articleRows
        .filter((article) => article.toGo)
        .flatMap((article) => Array.isArray(article.toGoArtikli) ? article.toGoArtikli : [])
        .filter((artikelId): artikelId is number => Number.isInteger(artikelId) && artikelId > 0),
    ));
    const toGoArtikli = toGoArtikelIds.length > 0
      ? await db.select({
          id: artikliTable.id,
          ime: artikliTable.ime,
          cena: artikliTable.cena,
        }).from(artikliTable).where(and(
          inArray(artikliTable.id, toGoArtikelIds),
          eq(artikliTable.enotaId, context.enotaId),
          eq(artikliTable.aktiven, true),
        ))
      : [];
    const toGoArtikliById = new Map(toGoArtikli.map((artikel) => [artikel.id, artikel]));

    const [vatRules, nastavitve] = await Promise.all([
      loadVatRules(),
      getNastavitveMap(context.enotaId),
    ]);
    const velikostiPic = izracunajVelikostiPic(await readAll("", context.enotaId));
    const articles = new Map(articleRows.map((article) => [article.id, article]));
    const resolvedLines: Array<{
      input: QrOrderLine;
      artikel: (typeof articleRows)[number];
      davek: number;
      appliedRuleId: number | null;
      jeDelMenija: boolean;
      modifikatorji: Array<{ id: number; ime: string; cenaDodatek: number }>;
      modifikatorjiCena: number;
      skupajCena: number;
      cenaKos: number;
      velikostPice: { id: PizzaVelikostId; naziv: string; premerCm: number; normativFaktor: number } | undefined;
      samodejniToGoArtikli: Array<{ id: number; ime: string; cena: string }>;
    }> = [];

    for (const line of input.postavke) {
      const artikel = articles.get(line.artikelId);
      if (!artikel) {
        res.status(400).json({ error: "Eden od izbranih artiklov ni več na voljo." });
        return;
      }
      if (!artikel.salesArticle && !line.menuFoodComponent) {
        res.status(400).json({ error: "Eden od izbranih artiklov ni več na voljo." });
        return;
      }
      if (line.toGo && !artikel.toGo) {
        res.status(400).json({ error: "To Go pri tem artiklu ni omogočen." });
        return;
      }
      const velikostPice = artikel.jePica
        ? velikostiPic.find((velikost) => velikost.id === (line.velikostPice ?? privzetaVelikostPice(velikostiPic)?.id))
        : undefined;
      if (artikel.jePica && !velikostPice) {
        res.status(400).json({ error: "Izbrana velikost pice ni na voljo." });
        return;
      }
      if (!artikel.jePica && line.velikostPice !== null) {
        res.status(400).json({ error: "Velikost pice je dovoljena samo pri picah." });
        return;
      }
      const vezave = await db.select({
        skupinaId: modSkupineTable.id,
        obvezna: modSkupineTable.obvezna,
        minIzbir: modSkupineTable.minIzbir,
        maxIzbir: modSkupineTable.maxIzbir,
      }).from(artModSkupineTable)
        .innerJoin(modSkupineTable, eq(modSkupineTable.id, artModSkupineTable.skupinaId))
        .where(and(
          eq(artModSkupineTable.artikelId, artikel.id),
          eq(modSkupineTable.enotaId, context.enotaId),
        ));
      const groupIds = vezave.map((group) => group.skupinaId);
      const allowedModifiers = groupIds.length === 0 ? [] : await db.select({
        id: modifikatorjiTable.id,
        ime: modifikatorjiTable.ime,
        skupinaId: modifikatorjiTable.skupinaId,
        cenaDodatek: modifikatorjiTable.cenaDodatek,
      }).from(modifikatorjiTable).where(and(
        inArray(modifikatorjiTable.skupinaId, groupIds),
        eq(modifikatorjiTable.aktiven, true),
      ));
      const allowedById = new Map(allowedModifiers.map((modifier) => [modifier.id, modifier]));
      const modifiers = line.modifikatorji.map((modifierId) => allowedById.get(modifierId));
      if (modifiers.some((modifier) => !modifier)) {
        res.status(400).json({ error: "Izbran modifikator ni več na voljo." });
        return;
      }
      const countsByGroup = new Map<number, number>();
      for (const modifier of modifiers) {
        countsByGroup.set(modifier!.skupinaId, (countsByGroup.get(modifier!.skupinaId) ?? 0) + 1);
      }
      for (const group of vezave) {
        const selected = countsByGroup.get(group.skupinaId) ?? 0;
        const minimum = group.obvezna ? Math.max(1, group.minIzbir) : group.minIzbir;
        if (selected < minimum || (group.maxIzbir > 0 && selected > group.maxIzbir)) {
          res.status(400).json({ error: "Izbrane možnosti niso veljavne." });
          return;
        }
      }
      const resolvedVat = resolveRate({
        supplyKind: resolveSupplyKind(false, false),
        taxCategory: (artikel.taxCategory ?? "food") as TaxCategory,
        addedSugar: Boolean(artikel.addedSugar),
        jeDelMenija: Boolean(artikel.jeDelMenija) && isMenuEligibleTaxCategory(artikel.taxCategory ?? ""),
        nastavitve,
        fallbackRate: Number(artikel.davek),
        jeDdvZavezanec: context.jeDdvZavezanec,
      }, vatRules);
      const modifikatorji = modifiers.map((modifier) => ({
        id: modifier!.id,
        ime: modifier!.ime,
        cenaDodatek: Number(modifier!.cenaDodatek),
      }));
      const cenaArtikla = velikostPice
        ? cenaPicePoVelikosti(artikel, velikostPice.id)
        : Number(artikel.cena);
      if (cenaArtikla === null) {
        res.status(400).json({ error: "Za izbrano velikost pice cena ni nastavljena." });
        return;
      }
      // Course food and its paired 1 dl wine are operational menu components,
      // included in the commercial menu envelope rather than separate sales.
      const prodajnaCenaArtikla = line.menuComponent
        ? 0
        : line.menuCharge
          ? splitMulticourseGross(cenaArtikla, line.menuFoodPercent ?? 100).foodGross
          : cenaArtikla;
      const cena = izracunajQrPostavkaCeno(prodajnaCenaArtikla, line.kolicina, modifikatorji);
      resolvedLines.push({
        input: line,
        artikel,
        davek: resolvedVat.rate,
        appliedRuleId: resolvedVat.ruleId ?? null,
        jeDelMenija: Boolean(artikel.jeDelMenija) && isMenuEligibleTaxCategory(artikel.taxCategory ?? ""),
        modifikatorji,
        modifikatorjiCena: cena.modifikatorjiCena,
        skupajCena: cena.skupajCena,
        cenaKos: cena.cenaKos,
        velikostPice,
        samodejniToGoArtikli: line.toGo
          ? Array.from(new Set(
              (Array.isArray(artikel.toGoArtikli) ? artikel.toGoArtikli : [])
                .filter((artikelId): artikelId is number => Number.isInteger(artikelId) && artikelId > 0 && artikelId !== artikel.id),
            ))
              .map((artikelId) => toGoArtikliById.get(artikelId))
              .filter((artikel): artikel is { id: number; ime: string; cena: string } => artikel !== undefined)
          : [],
      });
    }

    let simDatum!: Date;
    try {
      const [created] = await db.transaction(async (tx) => {
       await lockPosBusinessDay(tx, context.enotaId);
       simDatum = await getSimDatumOrNow(context.enotaId);
       const businessDate = await businessDateForTimestamp(simDatum, context.enotaId, tx);
        // QR vnos je le predlog za obračun v POS-u, vendar ga ne smemo
        // sprejeti brez časovno veljavne, potrjene poslovne politike. Ničelna
        // napitnina ostane vedno dovoljena.
        if (input.znesekNapitnina > 0) {
          const policy = await resolveTipPolicy(context.companyId, context.enotaId, simDatum);
          if (!policy || !policy.agreementConfirmed) {
            throw new Error("QR_TIP_POLICY_REQUIRED");
          }
          calculateTipTreatment(input.znesekNapitnina, policy, 22);
        }
       if (await isPosBusinessDayClosed(tx, context.enotaId, businessDate)) {
         throw new Error("TRENUTNI_POSLOVNI_DAN_JE_ZAKLJUCEN");
       }
       if (!await zakleniMizo(tx, context.mizaId, context.enotaId)) throw new Error("Miza ni najdena.");
       // The claim is consulted before finding an open order. Therefore a
       // network retry still returns its original (possibly finalized) order
       // and cannot create an empty replacement order.
       const [previousClaim] = await tx.select({
         narociloId: qrGostNarocilaTable.narociloId,
         requestFingerprint: qrGostNarocilaTable.requestFingerprint,
       }).from(qrGostNarocilaTable).where(and(
         eq(qrGostNarocilaTable.enotaId, context.enotaId),
         eq(qrGostNarocilaTable.mizaId, context.mizaId),
         eq(qrGostNarocilaTable.qrNapravaId, input.qrNapravaId),
         eq(qrGostNarocilaTable.idempotencyKey, input.idempotencyKey),
       )).limit(1);
       if (previousClaim) {
         if (previousClaim.requestFingerprint !== requestFingerprint) throw new Error("QR_IDEMPOTENCY_PAYLOAD_MISMATCH");
         const [originalOrder] = await tx.select({
           id: narocilaTable.id, opomba: narocilaTable.opomba, narocnikId: narocilaTable.narocnikId,
         }).from(narocilaTable).where(and(eq(narocilaTable.id, previousClaim.narociloId),
           eq(narocilaTable.enotaId, context.enotaId))).limit(1).for("update");
         if (!originalOrder) throw new Error("QR_IDEMPOTENCY_NAROCILO_MANJKA");
         return [originalOrder] as const;
       }
       // QR guests cannot identify a booking and must never consume one.
       const [blokadaRezervacije] = await tx.select({ id: rezervacijeMizTable.id })
         .from(rezervacijeMizTable).where(reservationBlockingClause(context.mizaId)).limit(1);
       if (blokadaRezervacije) throw new Error("REZERVACIJA_BLOKIRA_QR_NAROCILO");
      let noviPovezaniNarocnikId: number | null = null;
      const allModifierIds = resolvedLines.flatMap((line) => line.modifikatorji.map((modifier) => modifier.id));
      const modifierSnapshots = await loadModifierAvailabilitySnapshots(tx, allModifierIds);
      const modifierRequests: Array<{ articleId: number; quantity: number }> = [];
      for (const line of resolvedLines) {
        modifierRequests.push(...buildModifierAvailabilityRequests(
          modifierSnapshots,
          line.modifikatorji.map((modifier) => modifier.id),
          line.input.kolicina * (line.velikostPice?.normativFaktor ?? 1),
        ));
      }
      const odprtoQrNarocilo = and(
        eq(narocilaTable.enotaId, context.enotaId),
        eq(narocilaTable.mizaId, context.mizaId),
        eq(narocilaTable.vir, "qr_gost"),
        eq(narocilaTable.status, "odprto"),
        eq(narocilaTable.qrNapravaId, input.qrNapravaId),
      );
      let [narocilo] = await tx.select({
        id: narocilaTable.id,
        opomba: narocilaTable.opomba,
        narocnikId: narocilaTable.narocnikId,
      }).from(narocilaTable).where(odprtoQrNarocilo).limit(1).for("update");

      if (!narocilo) {
        const [ustvarjeno] = await tx.insert(narocilaTable).values({
          enotaId: context.enotaId,
          mizaId: context.mizaId,
          vir: "qr_gost",
          qrNapravaId: input.qrNapravaId,
          nacin: "miza",
          status: "odprto",
           narocnikId: null,
          opomba: input.opomba,
          skupaj: "0.00",
          znesekNapitnina: "0.00",
          toGo: false,
          ustvarjeno: simDatum,
        }).onConflictDoNothing().returning({
          id: narocilaTable.id,
          opomba: narocilaTable.opomba,
          narocnikId: narocilaTable.narocnikId,
        });

        if (ustvarjeno) {
          narocilo = ustvarjeno;
           noviPovezaniNarocnikId = null;
          await tx.execute(sql`
            UPDATE narocila
            SET stevilka_narocila = (
              SELECT COALESCE(MAX(n2.stevilka_narocila), 0) + 1
              FROM narocila n2
              JOIN enote e ON e.id = n2.enota_id
              WHERE e.company_id = ${context.companyId}
                AND n2.id != ${narocilo.id}
            )
            WHERE id = ${narocilo.id}
          `);
        } else {
          [narocilo] = await tx.select({
            id: narocilaTable.id,
            opomba: narocilaTable.opomba,
            narocnikId: narocilaTable.narocnikId,
          }).from(narocilaTable).where(odprtoQrNarocilo).limit(1).for("update");
        }
      }
      if (!narocilo) throw new Error("Odprtega QR naročila ni bilo mogoče ustvariti.");
      // Claim the submission while holding the table and then the open-order
      // row. A retry (or a simultaneous duplicate request) returns before
      // touching any already sent postavke.
      const [accepted] = await tx.insert(qrGostNarocilaTable).values({
        enotaId: context.enotaId,
        mizaId: context.mizaId,
        qrNapravaId: input.qrNapravaId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        narociloId: narocilo.id,
      }).onConflictDoNothing().returning({ id: qrGostNarocilaTable.id });
      if (!accepted) return [narocilo] as const;
      await assertPreparedFoodAvailability(
        tx,
        context.enotaId,
        businessDate,
        [
           ...resolvedLines.filter((line) => !line.input.menuCharge).map((line) => ({
            articleId: line.artikel.id,
            quantity: line.input.kolicina * (line.velikostPice?.normativFaktor ?? 1),
          })),
          ...modifierRequests,
        ],
      );

      let skupaj = 0;
      for (const line of resolvedLines) {
        const menuSplit = line.input.menuCharge
          ? splitMulticourseGross(Number(line.artikel.cena), line.input.menuFoodPercent ?? 100)
          : null;
        const cenaKosArtikla = menuSplit
          ? menuSplit.foodGross
          : line.input.menuComponent
            ? 0
            : round2(
             line.velikostPice
               ? cenaPicePoVelikosti(line.artikel, line.velikostPice.id) ?? Number(line.artikel.cena)
               : Number(line.artikel.cena),
           );
        const artikelSkupaj = round2(cenaKosArtikla * line.input.kolicina);
        if (
          round2(artikelSkupaj + line.modifikatorjiCena) !== line.skupajCena
          || round2(line.skupajCena / line.input.kolicina) !== line.cenaKos
        ) {
          throw new Error("QR izračun cene postavke ni konsistenten.");
        }
        skupaj += line.skupajCena;
        const [postavka] = await tx.insert(postavkeTable).values({
          narociloId: narocilo.id,
          artikelId: line.artikel.id,
          ime: menuSplit?.wineGross ? `${line.artikel.ime} – hrana` : line.artikel.ime,
          kolicina: line.input.kolicina,
          // FURS uporablja izvorno ceno artikla na parent vrstici.
          cenaKos: String(cenaKosArtikla.toFixed(2)),
          cenaKosOriginalna: String(cenaKosArtikla.toFixed(2)),
          skupaj: String(artikelSkupaj.toFixed(2)),
          davek: String(line.davek),
          opomba: line.input.opomba,
          toGo: line.input.toGo,
          vrstaArtikla: line.artikel.vrstaArtikla,
          mealType: line.artikel.mealType ?? "ala_carte",
          appliedRuleId: line.appliedRuleId ?? undefined,
          jeDelMenija: line.jeDelMenija,
          velikostPice: line.velikostPice?.id,
          normativFaktor: String(line.velikostPice?.normativFaktor ?? 1),
          courseNumber: line.input.courseNumber,
          courseSequence: line.input.courseSequence,
           courseNameSnapshot: line.input.courseNameSnapshot,
          pairingGroupId: line.input.pairingGroupId,
          ustvarjeno: simDatum,
        }).returning({ id: postavkeTable.id });

        if (menuSplit && menuSplit.wineGross > 0 && line.input.menuWineVatArticleId) {
          const wineArticle = articles.get(line.input.menuWineVatArticleId);
          if (!wineArticle) throw new Error("Vinska postavka menija ni več na voljo.");
          const wineVat = resolveRate({
            supplyKind: resolveSupplyKind(false, false),
            taxCategory: (wineArticle.taxCategory ?? "alcoholic") as TaxCategory,
            addedSugar: Boolean(wineArticle.addedSugar),
            jeDelMenija: false,
            nastavitve,
            fallbackRate: Number(wineArticle.davek),
            jeDdvZavezanec: context.jeDdvZavezanec,
          }, vatRules);
          const wineTotal = round2(menuSplit.wineGross * line.input.kolicina);
          skupaj += wineTotal;
          await tx.insert(postavkeTable).values({
            narociloId: narocilo.id,
            artikelId: line.artikel.id,
            ime: `${line.artikel.ime} – vinska spremljava`,
            kolicina: line.input.kolicina,
            cenaKos: menuSplit.wineGross.toFixed(2),
            cenaKosOriginalna: menuSplit.wineGross.toFixed(2),
            skupaj: wineTotal.toFixed(2),
            davek: String(wineVat.rate),
            opomba: null,
            toGo: false,
            vrstaArtikla: line.artikel.vrstaArtikla,
            mealType: line.artikel.mealType ?? "ala_carte",
            appliedRuleId: wineVat.ruleId ?? undefined,
            jeDelMenija: true,
            pairingGroupId: line.input.pairingGroupId,
            ustvarjeno: simDatum,
          });
        }

        for (const modifier of line.modifikatorji) {
          const cenaKosModifikatorja = round2(modifier.cenaDodatek);
          const skupajModifikatorja = round2(cenaKosModifikatorja * line.input.kolicina);
          await tx.insert(postavkeTable).values({
            narociloId: narocilo.id,
            artikelId: null,
            modifikatorId: modifier.id,
            ime: modifier.ime,
            // Modifier je child vrstica, zato multiplier shranimo v količini.
            kolicina: line.input.kolicina,
            cenaKos: String(cenaKosModifikatorja.toFixed(2)),
            cenaKosOriginalna: String(cenaKosModifikatorja.toFixed(2)),
            skupaj: String(skupajModifikatorja.toFixed(2)),
            davek: String(line.davek),
            jeDelMenija: line.jeDelMenija,
            toGo: false,
            vrstaArtikla: line.artikel.vrstaArtikla,
            parentPostavkaId: postavka.id,
            velikostPice: line.velikostPice?.id,
            normativFaktor: String(line.velikostPice?.normativFaktor ?? 1),
            availabilityRequirements: modifierSnapshots.get(modifier.id) ?? [],
            ustvarjeno: simDatum,
          });
        }

        for (const toGoArtikel of line.samodejniToGoArtikli) {
          const cenaToGo = Number(toGoArtikel.cena);
          if (!Number.isFinite(cenaToGo) || cenaToGo < 0) continue;
          const kolicinaToGo = line.input.kolicina;
          const skupajToGo = round2(cenaToGo * kolicinaToGo);
          skupaj += skupajToGo;
          await tx.insert(postavkeTable).values({
            narociloId: narocilo.id,
            artikelId: toGoArtikel.id,
            ime: toGoArtikel.ime,
            kolicina: kolicinaToGo,
            cenaKos: String(cenaToGo.toFixed(2)),
            cenaKosOriginalna: String(cenaToGo.toFixed(2)),
            skupaj: String(skupajToGo.toFixed(2)),
            davek: String(line.davek),
            jeDelMenija: line.jeDelMenija,
            opomba: null,
            toGo: true,
            vrstaArtikla: line.artikel.vrstaArtikla,
            parentPostavkaId: postavka.id,
            ustvarjeno: simDatum,
          });
        }
      }
      const opomba = input.opomba && input.opomba !== narocilo.opomba
        ? [narocilo.opomba, input.opomba].filter((value): value is string => Boolean(value)).join("\n")
        : undefined;
      await tx.update(narocilaTable).set({
        skupaj: sql`${narocilaTable.skupaj} + ${String(round2(skupaj).toFixed(2))}::numeric`,
        znesekNapitnina: String(input.znesekNapitnina.toFixed(2)),
        ...(opomba === undefined ? {} : { opomba }),
      })
        .where(eq(narocilaTable.id, narocilo.id));
      await tx.update(mizeTable).set({
        status: "zasedena",
        rezervacijaNarocnikId: null,
        rezervacijaStrankaIme: null,
        rezervacijaTelefon: null,
        rezervacijaOpomba: null,
        rezervacijaVeljaDo: null,
      }).where(and(
        eq(mizeTable.id, context.mizaId),
        eq(mizeTable.enotaId, context.enotaId),
      ));
      if (noviPovezaniNarocnikId != null) {
        await tx.update(narocnikiTable).set({
          steviloNarocil: sql`${narocnikiTable.steviloNarocil} + 1`,
          zadnjeNarocilo: simDatum,
        }).where(and(
          eq(narocnikiTable.id, noviPovezaniNarocnikId),
          eq(narocnikiTable.enotaId, context.enotaId),
        ));
      }
      return [narocilo] as const;
      });

      await osveziPredvidenPrevzem(created!.id, context.enotaId, simDatum);
    const [narocilo] = await db.select({
      predvidenPrevzem: narocilaTable.predvidenPrevzem,
    }).from(narocilaTable).where(and(
      eq(narocilaTable.id, created!.id),
      eq(narocilaTable.enotaId, context.enotaId),
    ));
      broadcast("update", { type: "narocilo", id: created!.id });
      res.status(201).json(CreateQrGostNarociloResponse.parse({
        narociloId: created!.id,
        stanje: "sprejeto",
        predvidenPrevzem: narocilo?.predvidenPrevzem?.toISOString() ?? null,
      }));
    } catch (error) {
      if (error instanceof Error && error.message === "TRENUTNI_POSLOVNI_DAN_JE_ZAKLJUCEN") {
        res.status(409).json({
          error: "Naročanje za današnji poslovni dan je že zaključeno.",
          code: error.message,
        });
        return;
      }
      if (error instanceof Error && error.message === "REZERVACIJA_BLOKIRA_QR_NAROCILO") {
        res.status(409).json({ error: "Naročanje za mizo je blokirano zaradi bližajoče se rezervacije.", code: error.message });
        return;
      }
      if (error instanceof Error && error.message === "QR_IDEMPOTENCY_PAYLOAD_MISMATCH") {
        res.status(409).json({ error: "Idempotency ključ je že uporabljen z drugačno vsebino naročila.", code: error.message });
        return;
      }
      if (error instanceof Error && (
        error.message === "QR_TIP_POLICY_REQUIRED"
        || error.message === "TIP_POLICY_EVIDENCE_REQUIRED"
        || error.message === "TIP_POLICY_REQUIRED"
      )) {
        res.status(409).json({
          error: "Napitnine prek QR ni mogoče sprejeti, dokler za poslovni datum ni potrjena veljavna politika napitnin.",
          code: error.message,
        });
        return;
      }
      if (error instanceof InsufficientPreparedFoodAvailabilityError) {
        res.status(409).json({ error: error.message, code: error.code, ...error.details });
        return;
      }
      throw error;
    }
  },
);

export default router;