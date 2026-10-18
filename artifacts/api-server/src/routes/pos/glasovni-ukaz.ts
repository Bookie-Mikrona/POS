import { Router, type IRouter, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { artikliTable, db, mizeTable, multicourseMenuCoursesTable, multicourseMenusTable, napraveTable, narocilaTable, normativiTable, posAiAgentAuditTable, posAiAgentMemoryTable, rezervacijeMizTable } from "@workspace/db";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getNarociloById } from "./narocila";
import { DISPLAY_WINDOW_MS } from "../../lib/rezervacijeMiz";
import { answerOperationalQuestion, loadOperationalSnapshot } from "../../lib/operational-snapshot";
import {
  assignKdsCourse, assignKdsCourses, fingerprintKdsCourseAssignmentOrder, KdsCourseAssignmentConflict,
} from "./kds";
import { broadcastToUnit } from "../../lib/pos-sse";
import {
  APPROVED_RECIPE_DOMAINS, compareNormative, filterResearchSources, loadTenantNormative, NormativeComparisonRequestSchema,
  NormativeComparisonResponseSchema, PREPARED_BULK_COMPARISON_MESSAGE, ResearchResponseSchema, canonicalDecimal,
  getCachedNormativeComparison, isPreparedFoodBulkNormative, signNormativeProposal,
} from "../../lib/normative-comparison";

const router: IRouter = Router();

function extractResearchJson(content: unknown[]): unknown | null {
  for (const block of content) {
    if (!block || typeof block !== "object" || (block as { type?: string }).type !== "text") continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text !== "string") continue;
    const candidate = text.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
    try { return JSON.parse(candidate); } catch {
      const start = candidate.indexOf("{"); const end = candidate.lastIndexOf("}");
      if (start >= 0 && end > start) try { return JSON.parse(candidate.slice(start, end + 1)); } catch { /* next block */ }
    }
  }
  return null;
}

/** Optional creator makes this boundary mockable; production always uses the configured integration. */
export async function researchNormative(
  local: Awaited<ReturnType<typeof loadTenantNormative>>,
  createMessage: (params: Parameters<typeof anthropic.messages.create>[0], options?: { signal?: AbortSignal; timeout?: number }) => Promise<{ content: unknown[] }> = anthropic.messages.create.bind(anthropic.messages) as never,
  timeoutMs = 30_000,
) {
  if (!local) throw new Error("NOT_FOUND");
  if (isPreparedFoodBulkNormative(local)) throw new Error(PREPARED_BULK_COMPARISON_MESSAGE);
  const names = local.rows.map(row => row.ingredientName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: { content: unknown[] };
  try {
    response = await createMessage({
      model: "claude-sonnet-5", max_tokens: 8_192,
    system: "You research public recipes. Return JSON only; never invent URLs, quantities, units, servings, or yield.",
    messages: [{ role: "user", content: `Poišči 2–4 zanesljive javne uredniške recepte za "${local.targetName}" iz vsaj dveh različnih domen: ${APPROVED_RECIPE_DOMAINS.join(", ")}. Primerjaj SAMO sestavine z natančnega seznama: ${JSON.stringify(names)}. Za vsako ugotovitev obvezno navedi natančno ime sestavine s seznama, quantity, unit, servings in sourceUrl. Če podatek ali porcija manjka, ga izpusti. Odgovori izključno kot {"findings":[...]}.` }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
    }, { signal: controller.signal, timeout: timeoutMs });
  } finally { clearTimeout(timer); }
  const parsed = ResearchResponseSchema.safeParse(extractResearchJson(response.content as unknown[]));
  if (!parsed.success) throw new Error("RESEARCH_INVALID");
  const sources = filterResearchSources(response.content as unknown[], parsed.data.findings.map(item => item.sourceUrl));
  const sourceUrls = new Set(sources.map(source => source.url));
  const findings = parsed.data.findings.filter(finding => sourceUrls.has(finding.sourceUrl));
  const usedHosts = new Set(findings.map(finding => new URL(finding.sourceUrl).hostname));
  if (usedHosts.size < 2 || new Set(sources.map(source => new URL(source.url).hostname)).size < 2) throw new Error("RESEARCH_INSUFFICIENT_SOURCES");
  const generatedAt = new Date().toISOString();
  const sourceByUrl = new Map(sources.map(source => [source.url, source]));
  const rows = compareNormative(local, findings).map(row => {
    const source = row.sourceUrl ? sourceByUrl.get(row.sourceUrl) : undefined;
    const canPropose = row.status === "comparable" && Number.isInteger(row.normativRowId) && row.normativRowId > 0
      && Number.isFinite(row.externalNormalizedQuantity) && (row.externalNormalizedQuantity ?? 0) > 0
      && !!row.localUnit && !!row.comparisonUnit && !!source;
    const proposalToken = canPropose ? signNormativeProposal({
      v: 1, artikelId: local.artikelId, expectedRevision: local.revision, normativRowId: row.normativRowId, ingredientId: row.ingredientId,
      expectedQuantity: canonicalDecimal(row.localQuantity), localUnit: row.localUnit!,
      proposedQuantity: canonicalDecimal(row.externalNormalizedQuantity!), sourceUrl: source!.url,
      sourceTitle: source!.title, generatedAt,
    }) : null;
    return { ...row, sourceTitle: source?.title ?? null, proposalToken };
  });
  const warnings: string[] = [];
  if (sources.length < 2) warnings.push("Najdenih je manj kot dva preverljiva javna vira; primerjava je omejena.");
  if (rows.some(row => row.status !== "comparable")) warnings.push("Nekaterih sestavin ni mogoče primerjati brez ugibanja o enotah ali številu porcij.");
  if (!process.env.POS_NORMATIVE_PROPOSAL_SECRET && !process.env.SESSION_SECRET) warnings.push("Predlogov trenutno ni mogoče potrditi, ker podpisni ključ ni nastavljen.");
  return NormativeComparisonResponseSchema.parse({
    generatedAt, localNormative: local, rows, sources, warnings,
    disclaimer: "Primerjava je informativna. Spremembe normativa zahtevajo ročno potrditev.",
  });
}

const VelikostPiceSchema = z.enum(["mala", "normalna", "druzinska"]);

const ArtikelSchema = z.object({
  id: z.number().int().positive(),
  ime: z.string().trim().min(1).max(200),
  kategorija: z.string().trim().max(200).default(""),
  jePica: z.boolean().default(false),
  velikostiPice: z.array(VelikostPiceSchema).max(3).default([]),
  modifikatorji: z.array(z.object({
    id: z.number().int().positive(),
    ime: z.string().trim().min(1).max(200),
    skupinaIme: z.string().trim().max(200),
    obvezna: z.boolean(),
  })).max(300).default([]),
});

const GlasovniUkazBodySchema = z.object({
  transkript: z.string().trim().min(1).max(1_000),
  artikli: z.array(ArtikelSchema).min(1).max(2_000),
});

const SvetovalecBodySchema = z.object({
  faza: z.enum(["narocilo", "blagajna"]),
  vprasanje: z.string().trim().max(1_000).optional(),
  narocilo: z.object({
    id: z.number().int().positive(),
    nacin: z.string().trim().max(50).nullable().optional(),
    status: z.string().trim().max(50),
    miza: z.union([z.string().trim().max(120), z.number().int().positive()]).nullable().optional(),
    strankaIme: z.string().trim().max(200).nullable().optional(),
    telefon: z.string().trim().max(80).nullable().optional(),
    naslovDostave: z.string().trim().max(500).nullable().optional(),
    skupaj: z.number().finite().min(0),
    postavke: z.array(z.object({
      naziv: z.string().trim().min(1).max(200),
      kolicina: z.number().finite().positive().max(999),
      skupaj: z.number().finite(),
      opomba: z.string().trim().max(500).nullable().optional(),
    })).max(200),
  }),
});

const SvetovalecAiSchema = z.object({
  povzetek: z.string().trim().min(1).max(500),
  nasveti: z.array(z.string().trim().min(1).max(300)).max(5),
});

const SvetovalecPreveriBodySchema = z.object({
  narociloId: z.number().int().positive(),
});

export const PosAgentBodySchema = z.object({
  ukaz: z.string().trim().min(1).max(1_000),
  pot: z.string().trim().max(200).optional(),
  narociloId: z.number().int().positive().optional(),
  courseClarificationToken: z.string().trim().min(1).max(250_000).optional(),
});
const CourseClarificationOptionSchema = z.object({
  courseNumber: z.number().int().min(1).max(99),
  courseName: z.string().trim().min(1).max(200),
}).strict();
const CourseClarificationResponseSchema = z.object({
  token: z.string().trim().min(1).max(250_000),
  options: z.array(CourseClarificationOptionSchema).min(1).max(20),
}).strict();
const AgentBaseResponseSchema = z.object({ odgovor: z.string().trim().min(1).max(1_000) });
/** This is deliberately a closed, server-owned execution contract. */
export const PosAgentToolSchema = z.discriminatedUnion("action", [
  AgentBaseResponseSchema.extend({
    action: z.literal("explain"),
    clarifications: z.array(z.string()).max(20).optional(),
    courseClarification: CourseClarificationResponseSchema.optional(),
  }),
  AgentBaseResponseSchema.extend({ action: z.literal("navigate"), navigateTo: z.string().trim().max(200) }),
  AgentBaseResponseSchema.extend({ action: z.literal("open_own_shift") }),
  AgentBaseResponseSchema.extend({ action: z.literal("add_item"), narociloId: z.number().int().positive(), artikelId: z.number().int().positive(), kolicina: z.number().int().min(1).max(99) }),
  AgentBaseResponseSchema.extend({ action: z.literal("update_item"), narociloId: z.number().int().positive(), postavkaId: z.number().int().positive(), kolicina: z.number().int().min(1).max(999).optional(), opomba: z.string().max(500).nullable().optional(), gostStevilka: z.number().int().min(1).max(99).nullable().optional() }),
  AgentBaseResponseSchema.extend({ action: z.literal("assign_course"), narociloId: z.number().int().positive(), postavkaId: z.number().int().positive(), courseNumber: z.number().int().min(1).max(99) }),
  AgentBaseResponseSchema.extend({ action: z.literal("assign_courses"), narociloId: z.number().int().positive(), assignments: z.array(z.object({
    postavkaId: z.number().int().positive(), courseNumber: z.number().int().min(1).max(99), naziv: z.string().trim().min(1).max(200),
  }).strict()).min(1).max(30) }),
  AgentBaseResponseSchema.extend({ action: z.literal("remove_item"), narociloId: z.number().int().positive(), postavkaId: z.number().int().positive() }),
  AgentBaseResponseSchema.extend({ action: z.literal("move_order"), narociloId: z.number().int().positive(), mizaId: z.number().int().positive() }),
  AgentBaseResponseSchema.extend({ action: z.literal("merge_order"), narociloId: z.number().int().positive(), virNarociloId: z.number().int().positive() }),
  AgentBaseResponseSchema.extend({ action: z.literal("prepare_checkout"), narociloId: z.number().int().positive(), gostStevilka: z.number().int().min(1).max(99).optional(), navigateTo: z.string().trim().max(200), missingPrerequisites: z.array(z.string()).max(10) }),
  AgentBaseResponseSchema.extend({ action: z.literal("compare_normative"), artikelId: z.number().int().positive() }),
]);
export type AgentResponse = z.infer<typeof PosAgentToolSchema>;
/** The model's deliberately smaller contract: it can never request a write. */
export const PosAgentFallbackSchema = z.object({
  odgovor: z.string().trim().min(1).max(1_000),
  action: z.enum(["explain", "navigate"]),
  navigateTo: z.string().trim().max(200).optional(),
});

export const POS_AGENT_CATALOG = `DEJANSKI POS moduli: artikli in kategorije, normativi/sestavine,
naročila, mize/prostori, dostava, prejemnice in OCR prejemnic, zaloge/inventure,
kuhinjski zaslon, blagajne/izmene, poročila in nastavitve naprav.
Deterministični POS agent lahko prek kanoničnih storitev izvede le svoje tipizirane operativne akcije.
Ti, splošni svetovalec, smeš samo pojasniti ali odpreti znan modul; nikoli ne trdi, da si izvedel spremembo.
Nikoli ne izvajaj plačil, fiskalizacije, izdaje računa, vračil, Z poročila, zaključka naročila ali OCR uvoza.
Ne izmišljaj modulov ali podatkov.`;

const SLOVENIAN_TABLE_NUMBERS: Record<string, number> = {
  ena: 1,
  eno: 1,
  en: 1,
  enka: 1,
  prva: 1,
  prvo: 1,
  prvi: 1,
  dve: 2,
  dva: 2,
  druga: 2,
  drugi: 2,
  tri: 3,
  tretja: 3,
  tretji: 3,
  stiri: 4,
  štiri: 4,
  cetrta: 4,
  četrta: 4,
  cetrti: 4,
  četrti: 4,
  pet: 5,
  peta: 5,
  peti: 5,
  sest: 6,
  šest: 6,
  sesta: 6,
  šesta: 6,
  sesti: 6,
  šesti: 6,
  sedem: 7,
  sedma: 7,
  osem: 8,
  osma: 8,
  devet: 9,
  deveta: 9,
  deset: 10,
  deseta: 10,
  enajst: 11, dvanajst: 12, trinajst: 13, stirinajst: 14, petnajst: 15,
  sestnajst: 16, sedemnajst: 17, osemnajst: 18, devetnajst: 19,
  dvajset: 20, trideset: 30, stirideset: 40, petdeset: 50,
  sestdeset: 60, sedemdeset: 70, osemdeset: 80, devetdeset: 90,
};

export function parseSlovenianTableNumber(value: string): number | null {
  const raw = normalizeAgentCommand(value).replace(/[^a-z0-9]/g, "");
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 && n <= 99 ? n : null;
  }
  const direct = SLOVENIAN_TABLE_NUMBERS[raw];
  if (direct) return direct;
  const joined = raw.match(/^(ena|eno|en|dva|dve|tri|stiri|pet|sest|sedem|osem|devet)in(dvajset|trideset|stirideset|petdeset|sestdeset|sedemdeset|osemdeset|devetdeset)$/);
  if (!joined) return null;
  const ones = SLOVENIAN_TABLE_NUMBERS[joined[1]];
  const tens = SLOVENIAN_TABLE_NUMBERS[joined[2]];
  return ones && tens ? ones + tens : null;
}

function normalizeAgentCommand(command: string): string {
  return command
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("sl")
    .trim();
}

/** Structured-PII redaction for advisor prompts; this intentionally is not NER. */
export function redactAgentPromptText(value: string): string {
  const structured = value.slice(0, 1_000)
    .replace(/\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/giu, "[URL]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[E-POŠTA]")
    .replace(/(?:\+|00)?\d[\d\s()./-]{6,}\d/g, "[TELEFON]")
    .replace(/\b(?:ulica|cesta|trg)\s+[\p{L} .'-]+\s+\d+[a-z]?\b/giu, "[NASLOV]")
    .replace(/\b(?:ime|stranka|gost|naro[cč]nik|kontakt)\s*[:=-]?\s+\p{L}{2,}(?:\s+\p{L}{2,}){1,2}/giu, "[OSEBA]");
  const commandWords = new Set(["Ali", "Kdaj", "Kako", "Kje", "Kaj", "Odpri", "Pokaži", "Pokazi", "Prikaži", "Prikazi", "Pojdi", "Dodaj", "Nastavi"]);
  return structured
    .replace(/\b\p{Lu}\p{Ll}{1,}(?:\s+\p{Lu}\p{Ll}{1,})+\b/gu, match =>
      commandWords.has(match.split(/\s+/)[0]) ? match : "[OSEBA]")
    .replace(/\s+/g, " ").trim();
}

export function describeAgentCommandShape(command: string) {
  const normalized = normalizeAgentCommand(command);
  return {
    hasOpenVerb: /\bodpr(?:i|e|es|ite)\b/.test(normalized),
    hasOrderNoun: /\bnarocil(?:o|a|u|om)\b/.test(normalized),
    hasTableNoun: /\bmiz[aeiou]\b/.test(normalized),
    hasNumberToken: /\bmiz[aeiou]\s+(?:miza\s+)?(?:stevilka\s+)?[\p{L}\d]+\b/u.test(normalized),
  };
}

export function parseOpenTableOrderCommand(command: string): number | null {
  const normalized = normalizeAgentCommand(command);
  const shape = describeAgentCommandShape(normalized);
  if (!shape.hasOpenVerb || !shape.hasOrderNoun) return null;
  const match = normalized.match(
    /\bmiz[aeiou]\s+(?:miza\s+)?(?:stevilka\s+)?([\p{L}\d]+)\b/u,
  );
  if (!match) return null;
  return parseSlovenianTableNumber(match[1]);
}

export function parseTableStatusQuestion(command: string): number | null {
  const normalized = normalizeAgentCommand(command);
  if (!/\b(miza|mize|mizi)\b/.test(normalized)
    || !/\b(prosta|zasedena|stanje|status)\b/.test(normalized)) return null;
  const match = normalized.match(/\bmiz[aeiou]\s+(?:stevilka\s+)?([\p{L}\d]+)\b/u);
  if (!match) return null;
  return parseSlovenianTableNumber(match[1]);
}

export function resolveAgentTableDisplayState(input: {
  persistedStatus: string; openOrderCount: number; reservationStarts: Date[]; now: number;
}): "prosta" | "zasedena" | "rezervirana" {
  if (input.persistedStatus === "zasedena" || input.openOrderCount > 0) return "zasedena";
  const currentReservation = input.reservationStarts
    .filter(start => start.getTime() > input.now - 3 * 60 * 60 * 1000)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return currentReservation && currentReservation.getTime() <= input.now + DISPLAY_WINDOW_MS ? "rezervirana" : "prosta";
}

const SAFE_AGENT_STATIC_NAVIGATION_PATHS = new Set([
  "/", "/blagajna", "/meni", "/qr-meni", "/pripravljena-hrana",
  "/odpadki-s-kroznikov", "/racuni", "/statistike", "/operativna-porocila",
  "/izkaz", "/realizacija", "/temeljnice", "/blagajniski-premiki",
  "/rezervacije", "/dogodki", "/kuhinja", "/pice", "/izdaja", "/tocilnica",
  "/izmene", "/obracun-ur", "/zaloge", "/odstopanja", "/uvoz-cenik",
  "/partnerji", "/narocniki", "/stroskovana-mesta", "/kontni-plan",
  "/konti-za-temeljnice", "/nastavitve",
]);

type SettingsNavigationTarget =
  | { tab: "mize" | "natakari" | "dostava" | "kds" | "enote" | "knjizenje" | "varnostne-kopije" | "moj-profil" | "glasovni-ukazi" }
  | { tab: "nastavitve"; section?: SettingsSection; card?: SettingsCard };
type SettingsSection = "sek-podjetje" | "sek-eracun" | "sek-naprave" | "sek-terminali" | "sek-tiskalniki" | "sek-vedenje" | "sek-sistem";
type SettingsCard = "ns-furs" | "ns-certifikat" | "ns-prostori" | "ns-blagajne" | "ns-eracun-registracija" | "ns-bizbox" | "ns-naprave" | "ns-terminal" | "ns-sumup" | "ns-viva" | "ns-android-tiskalnik" | "ns-agent" | "ns-scanner-bridge" | "ns-happy-hour" | "ns-zaloge" | "ns-prikaz" | "ns-izredni-pin" | "ns-ddv-razresev" | "ns-smtp" | "ns-ddv-stopnje" | "ns-testi";
const SETTINGS_CARD_SECTION: Record<SettingsCard, SettingsSection> = {
  "ns-furs": "sek-podjetje", "ns-certifikat": "sek-podjetje", "ns-prostori": "sek-podjetje", "ns-blagajne": "sek-podjetje",
  "ns-eracun-registracija": "sek-eracun", "ns-bizbox": "sek-eracun", "ns-naprave": "sek-naprave",
  "ns-terminal": "sek-terminali", "ns-sumup": "sek-terminali", "ns-viva": "sek-terminali",
  "ns-android-tiskalnik": "sek-tiskalniki", "ns-agent": "sek-tiskalniki", "ns-scanner-bridge": "sek-tiskalniki",
  "ns-happy-hour": "sek-vedenje", "ns-zaloge": "sek-vedenje", "ns-prikaz": "sek-vedenje", "ns-izredni-pin": "sek-vedenje", "ns-ddv-razresev": "sek-vedenje",
  "ns-smtp": "sek-sistem", "ns-ddv-stopnje": "sek-sistem", "ns-testi": "sek-sistem",
};
const SETTINGS_TABS = new Set<string>(["mize", "natakari", "dostava", "kds", "enote", "knjizenje", "nastavitve", "varnostne-kopije", "moj-profil", "glasovni-ukazi"]);

export function resolveSettingsNavigationTarget(target: SettingsNavigationTarget): string {
  if (target.tab !== "nastavitve") return `/nastavitve?tab=${target.tab}`;
  const params = new URLSearchParams({ tab: "nastavitve" });
  if (target.card) {
    params.set("section", SETTINGS_CARD_SECTION[target.card]);
    params.set("card", target.card);
  } else if (target.section) params.set("section", target.section);
  return `/nastavitve?${params.toString()}`;
}

/** Strict counterpart of the POS resolver; query strings outside this contract are never navigation targets. */
export function isSafeAgentSettingsNavigation(path: string | undefined): path is string {
  if (typeof path !== "string" || !path.startsWith("/nastavitve?")) return false;
  const raw = path.slice("/nastavitve?".length);
  const params = new URLSearchParams(raw);
  if (params.toString() !== raw || [...params.keys()].some(key => !["tab", "section", "card"].includes(key))
    || ["tab", "section", "card"].some(key => params.getAll(key).length > 1)) return false;
  const tab = params.get("tab");
  const section = params.get("section");
  const card = params.get("card") as SettingsCard | null;
  if (!tab || !SETTINGS_TABS.has(tab)) return false;
  if (tab !== "nastavitve") return !section && !card;
  if (!section && !card) return true;
  if (section && !Object.values(SETTINGS_CARD_SECTION).includes(section as SettingsSection)) return false;
  return !card || (SETTINGS_CARD_SECTION[card] === section);
}

export function isSafeAgentStaticNavigation(path: string | undefined): path is string {
  return typeof path === "string" && (SAFE_AGENT_STATIC_NAVIGATION_PATHS.has(path) || isSafeAgentSettingsNavigation(path));
}

export function isRepeatLastAgentCommand(command: string): boolean {
  return /^\s*ponovi(?:\s+(?:zadnji|prejšnji|prejsnji))?\s+ukaz\s*[.!?]?\s*$/i.test(command);
}

export function isOpenOwnShiftCommand(command: string): boolean {
  return /^\s*odpri\s+(?:mi\s+)?(?:novo\s+)?izmeno(?:\s+(?:zame|na\s+moje\s+ime|na\s+ime))?\s*[.!?]?\s*$/i.test(command);
}

export function normalizeAgentEntityName(value: string): string {
  return normalizeAgentCommand(value)
    .replace(/[.,!?;:]+/g, " ")
    // Minimal, symmetric Slovenian case-ending normalization. This is applied
    // to both the spoken reference and the tenant catalog, never a substring
    // search, so "kavo" resolves "Kava" while similarly named items stay
    // ambiguous instead of being guessed.
    .replace(/\b(\p{L}{3,})[aeiou]\b/gu, "$1")
    .replace(/\s+/g, " ").trim();
}

export function resolveExactAgentEntity<T extends { ime: string }>(name: string, candidates: T[]): T | null | "ambiguous" {
  const normalized = normalizeAgentEntityName(name);
  const matches = candidates.filter((candidate) => normalizeAgentEntityName(candidate.ime) === normalized);
  return matches.length === 1 ? matches[0] : matches.length > 1 ? "ambiguous" : null;
}

function currentOrderRequired(id: number | undefined): AgentResponse | null {
  return id ? null : { action: "explain", odgovor: "Za ta ukaz najprej odprite naročilo. Naročila ne izbiram ugibajoče." };
}

function parseQuantity(raw: string | undefined): number {
  const value = Number(raw ?? 1);
  return Number.isInteger(value) && value > 0 && value <= 999 ? value : 1;
}

export function navigationForCommand(command: string): string | null {
  const normalized = normalizeAgentCommand(command);
  const isView = /\b(odpr\p{L}*|pojdi|pokaz\p{L}*|prikaz\p{L}*|ogled\p{L}*)\b/u.test(normalized);
  const isSettingsMutation = /\b(nastav\p{L}*|spremen\p{L}*|shran\p{L}*|izbris\p{L}*|omogoc\p{L}*|onemogoc\p{L}*)\b/u.test(normalized);
  // "Zaloge" remains the operational module unless settings are explicitly requested.
  if (isView && /\b(zalog\p{L}*|inventur\p{L}*|stock\p{L}*)\b/u.test(normalized) && !/\bnastavitv\p{L}*\b/u.test(normalized)) return "/zaloge";
  const settingTarget = settingsTargetForCommand(normalized);
  if (settingTarget && (isView || isSettingsMutation)) return resolveSettingsNavigationTarget(settingTarget);
  if (!isView) return null;
  if (/\b(racun\p{L}*|prejemk\p{L}*)\b/u.test(normalized)) return "/racuni";
  if (/\b(zalog\p{L}*|inventur\p{L}*|stock\p{L}*)\b/u.test(normalized)) return "/zaloge";
  if (/\b(rezervacij\p{L}*)\b/u.test(normalized)) return "/rezervacije";
  if (/\b(porocil\p{L}*|report\p{L}*)\b/u.test(normalized)) return "/operativna-porocila";
  return null;
}

function settingsTargetForCommand(normalized: string): SettingsNavigationTarget | null {
  const card = (value: SettingsCard): SettingsNavigationTarget => ({ tab: "nastavitve", card: value });
  if (/\b(happy\s*hour|vesel\p{L}*\s+ur)\b/u.test(normalized)) return card("ns-happy-hour");
  if (/\b(android|bluetooth|bt)\b.*\btiskal/u.test(normalized) || /\btiskal\p{L}*.*\b(android|bluetooth|bt)\b/u.test(normalized)) return card("ns-android-tiskalnik");
  if (/\b(windows|print\s*agent|tiskalnis\p{L}*\s+agent)\b/u.test(normalized)) return card("ns-agent");
  if (/\b(scanner|skener|cital\p{L}*|barcode)\b/u.test(normalized)) return card("ns-scanner-bridge");
  if (/\btiskal\p{L}*\b/u.test(normalized)) return { tab: "nastavitve", section: "sek-tiskalniki" };
  if (/\b(certifikat|p12|pfx|pem)\b/u.test(normalized)) return card("ns-certifikat");
  if (/\b(poslovn\p{L}*\s+prostor|premis\p{L}*)\b/u.test(normalized)) return card("ns-prostori");
  if (/\b(blagajn\p{L}*|cash\s*register)\b/u.test(normalized)) return card("ns-blagajne");
  if (/\b(furs|fiskalizacij\p{L}*)\b/u.test(normalized)) return card("ns-furs");
  if (/\b(e-?racun|peppol|zzi|ujp)\b/u.test(normalized)) return card("ns-eracun-registracija");
  if (/\bbizbox\b/u.test(normalized)) return card("ns-bizbox");
  if (/\bsumup\b/u.test(normalized)) return card("ns-sumup");
  if (/\b(viva|tap\s*to\s*pay)\b/u.test(normalized)) return card("ns-viva");
  if (/\b(payten|placiln\p{L}*\s+terminal|terminal)\b/u.test(normalized)) return card("ns-terminal");
  if (/\b(naprav\p{L}*|device)\b/u.test(normalized)) return card("ns-naprave");
  if (/\b(ddv|vat).*\b(stopnj\p{L}*|rate)\b|\b(stopnj\p{L}*|rate).*\b(ddv|vat)\b/u.test(normalized)) return card("ns-ddv-stopnje");
  if (/\b(ddv|vat|razresev\p{L}*)\b/u.test(normalized)) return card("ns-ddv-razresev");
  if (/\b(smtp|e-?post\p{L}*|mail)\b/u.test(normalized)) return card("ns-smtp");
  if (/\b(zalog\p{L}*|stock)\b/u.test(normalized)) return card("ns-zaloge");
  if (/\b(izredn\p{L}*\s+pin|emergency\s*pin)\b/u.test(normalized)) return card("ns-izredni-pin");
  if (/\b(prikaz\p{L}*\s+narocil|order\s*display)\b/u.test(normalized)) return card("ns-prikaz");
  if (/\b(kds|kuhinjsk\p{L}*\s+zaslon)\b/u.test(normalized)) return { tab: "kds" };
  if (/\b(miz\p{L}*|tabel\p{L}*)\b/u.test(normalized) || isMisSettingsCommand(normalized)) return { tab: "mize" };
  if (/\b(natakar\p{L}*|waiter)\b/u.test(normalized)) return { tab: "natakari" };
  if (/\b(dostav\p{L}*)\b/u.test(normalized)) return { tab: "dostava" };
  if (/\b(enot\p{L}*|unit)\b/u.test(normalized)) return { tab: "enote" };
  if (/\b(knjigovodstv\p{L}*|knjizenj\p{L}*)\b/u.test(normalized)) return { tab: "knjizenje" };
  if (/\b(varnostn\p{L}*\s+kopij|backup)\b/u.test(normalized)) return { tab: "varnostne-kopije" };
  if (/\b(profil\p{L}*)\b/u.test(normalized)) return { tab: "moj-profil" };
  if (/\b(glasovn\p{L}*\s+ukaz\p{L}*|voice\s*command)\b/u.test(normalized)) return { tab: "glasovni-ukazi" };
  if (/\b(nastavitv\p{L}*)\b/u.test(normalized)) return { tab: "nastavitve" };
  return null;
}

export function isMisSettingsCommand(command: string): boolean {
  const normalized = normalizeAgentCommand(command);
  return /\bmis\b/u.test(normalized)
    && /\bnastavitv\p{L}*\b/u.test(normalized);
}

export function resolvePosAgentCommand(command: string, candidates: Array<{ id: number; ime: string }>):
  { action: "compare_normative"; artikelId: number; forceRefresh: boolean; odgovor: string } | { action: "explain"; odgovor: string } | null {
  const normalized = normalizeAgentCommand(command);
  const refreshMatch = normalized.match(/\bosvez\p{L}*\s+(?:primerjavo\s+)?(?:normativa|recepta)\s+(?:za\s+)?(.+)$/u);
  const prefixedRefreshMatch = normalized.match(/\b(?:svez\p{L}*|ponovn\p{L}*|na novo)\s+(?:primerjaj|preveri)\s+(?:normativ|recept)\s+(?:za\s+)?(.+)$/u);
  const match = refreshMatch
    ?? prefixedRefreshMatch
    ?? normalized.match(/\b(?:primerjaj|preveri)\s+(?:normativ|recept)\s+(?:za\s+)?(.+)$/u);
  if (!match) return null;
  const forceRefresh = Boolean(refreshMatch || prefixedRefreshMatch);
  const query = match[1].replace(/[?!.,]+$/u, "").trim();
  if (!query) return { action: "explain", odgovor: "Navedite naziv normativa." };
  const unique = [...new Map(candidates.map(candidate => [candidate.id, candidate])).values()];
  const exact = unique.filter(candidate => normalizeAgentCommand(candidate.ime) === query);
  const matches = exact.length ? exact : unique.filter(candidate => normalizeAgentCommand(candidate.ime).includes(query));
  if (matches.length === 1) return { action: "compare_normative", artikelId: matches[0].id, forceRefresh, odgovor: `${forceRefresh ? "Pripravljam svežo primerjavo" : "Primerjam normativ"} za ${matches[0].ime}.` };
  return { action: "explain", odgovor: matches.length ? `Najdenih je več normativov: ${matches.slice(0, 5).map(item => item.ime).join(", ")}. Navedite točen naziv.` : "Normativ za navedeni artikel ni najden." };
}
export async function resolveNormativeComparisonCommand(command: string, enotaId: number): Promise<ReturnType<typeof resolvePosAgentCommand>> {
  const candidates = await db.select({ id: artikliTable.id, ime: artikliTable.ime })
    .from(artikliTable).innerJoin(normativiTable, eq(normativiTable.artikelId, artikliTable.id))
    .where(eq(artikliTable.enotaId, enotaId));
  return resolvePosAgentCommand(command, candidates);
}

export type ParsedCourseAssignment =
  | { itemName: string; courseNumber: number }
  | { itemName: string; courseName: string };

export type ParsedMultiCourseAssignment = Array<ParsedCourseAssignment>;

/**
 * Parses only explicit, comma/semicolon-separated multi-course instructions.
 * It deliberately requires two resulting item assignments so ordinary single
 * course and operational commands retain their existing interpretation.
 */
export function parseMultiCourseAssignmentCommand(command: string): ParsedMultiCourseAssignment | null {
  const normalized = normalizeAgentCommand(command)
    .replace(/^(?:nastavi|dodeli|daj)\s+/u, "");
  const segments = normalized.split(/\s*[,;]\s*/u).filter(Boolean);
  if (segments.length < 2) return null;
  const assignments: ParsedMultiCourseAssignment = [];
  for (const segment of segments) {
    const direct = segment.match(/^(.+?)\s+na\s+(?:(\d+)|([\p{L}]+))(?:\s+hod(?:u|a|om)?)?\s*$/u);
    const numberAfterHod = direct ? null : segment.match(/^(.+?)\s+(?:na\s+)?hod(?:u|a|om)?\s+(\d+)\s*$/u);
    const directNumber = direct?.[2] ? Number(direct[2]) : parseSlovenianTableNumber(direct?.[3] ?? "");
    const trailingNumber = numberAfterHod?.[2] ? Number(numberAfterHod[2]) : null;
    const numeric = directNumber ?? trailingNumber;
    const named = Number.isInteger(numeric)
      ? null
      : segment.match(/^(.+?)\s+(?:na|k)\s+(.+?)\s+hod(?:u|a|om)?\s*$/u);
    const itemPart = direct?.[1] ?? numberAfterHod?.[1] ?? named?.[1];
    if (!itemPart) return null;
    const itemNames = itemPart.split(/\s+(?:in|ter)\s+/u).map(name => name.trim()).filter(Boolean);
    if (!itemNames.length) return null;
    const course = Number.isInteger(numeric) && numeric! >= 1 && numeric! <= 99
      ? { courseNumber: numeric! } as const
      : named?.[2]?.trim() ? { courseName: named[2].trim() } as const : null;
    if (!course) return null;
    assignments.push(...itemNames.map(itemName => ({ itemName, ...course })));
  }
  return assignments.length >= 2 ? assignments : null;
}

export function parseCourseAssignmentCommand(command: string): ParsedCourseAssignment | null {
  const normalized = normalizeAgentCommand(command);
  const match = normalized.match(/^(?:(?:nastavi|dodeli|daj)\s+)?(.+?)\s+(?:na\s+)?(?:(\d+)|([a-z]+))\s+hod(?:u)?\s*$/u)
    // Keep the older, natural "na hod 2" word order as well.
    ?? normalized.match(/^(?:(?:nastavi|dodeli|daj)\s+)?(.+?)\s+(?:na\s+)?hod(?:u)?\s+(\d+)\s*$/u);
  if (match) {
    const courseNumber = match[2] ? Number(match[2]) : parseSlovenianTableNumber(match[3] ?? "");
    return Number.isInteger(courseNumber) && courseNumber! >= 1 && courseNumber! <= 99
      ? { itemName: match[1], courseNumber: courseNumber! }
      // It may be a named reference introduced by "k" which the numeric
      // grammar treated as part of the item phrase; let the named grammar
      // below inspect it before rejecting it.
      : (() => {
        const named = normalized.match(/^(?:(?:nastavi|dodeli|daj)\s+)?(.+?)\s+(?:na|k)\s+(.+?)\s+hod(?:u|a|om)?\s*$/u);
        return named && named[1].trim() && named[2].trim()
          ? { itemName: named[1].trim(), courseName: named[2].trim() }
          : null;
      })();
  }
  // A named course remains an internal reference only. It is resolved against
  // the active menu configuration before the closed numeric action is made.
  const named = normalized.match(/^(?:(?:nastavi|dodeli|daj)\s+)?(.+?)\s+(?:na|k)\s+(.+?)\s+hod(?:u|a|om)?\s*$/u);
  if (!named || !named[1].trim() || !named[2].trim()) return null;
  return { itemName: named[1].trim(), courseName: named[2].trim() };
}

export type AvailableCourseReference = { courseNumber: number; courseName: string };

function normalizeCourseReference(value: string): string {
  return normalizeAgentCommand(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/u)
    .filter(token => token && !["hod", "hodu", "hoda", "hodom", "hodi", "hode"].includes(token))
    .join(" ");
}

function acceptedCourseTokenVariants(configuredToken: string): Set<string> {
  const variants = new Set([configuredToken]);
  if (configuredToken.length > 1 && configuredToken.endsWith("i")) {
    const stem = configuredToken.slice(0, -1);
    for (const ending of ["ega", "emu", "em", "im"]) variants.add(`${stem}${ending}`);
  } else if (configuredToken.length > 1 && configuredToken.endsWith("a")) {
    variants.add(`${configuredToken.slice(0, -1)}o`);
  }
  return variants;
}

function candidateAcceptsCourseReference(configuredName: string, spokenName: string): boolean {
  const configured = normalizeCourseReference(configuredName).split(" ").filter(Boolean);
  const spoken = normalizeCourseReference(spokenName).split(" ").filter(Boolean);
  return configured.length > 0 && configured.length === spoken.length
    && configured.every((token, index) => acceptedCourseTokenVariants(token).has(spoken[index]!));
}

function candidateStartsWithCourseReference(configuredName: string, spokenName: string): boolean {
  const configured = normalizeCourseReference(configuredName).split(" ").filter(Boolean);
  const spoken = normalizeCourseReference(spokenName).split(" ").filter(Boolean);
  return spoken.length > 0 && spoken.length < configured.length
    && spoken.every((token, index) => acceptedCourseTokenVariants(configured[index]!).has(token));
}

export function findCourseClarificationOptions(
  reference: string,
  candidates: AvailableCourseReference[],
): AvailableCourseReference[] {
  const normalized = normalizeCourseReference(reference);
  const unique = [...new Map(candidates
    .filter(candidate => candidate.courseName.trim())
    .map(candidate => [`${candidate.courseNumber}:${candidate.courseName.trim()}`, {
      courseNumber: candidate.courseNumber,
      courseName: candidate.courseName.trim(),
    }])).values()].sort((a, b) => a.courseNumber - b.courseNumber);
  if (!normalized) return unique;
  const related = unique.filter(candidate =>
    candidateAcceptsCourseReference(candidate.courseName, normalized)
    || candidateStartsWithCourseReference(candidate.courseName, normalized)
  );
  return related.length ? related : unique;
}

export function resolveNamedCourseReference(
  reference: string,
  candidates: AvailableCourseReference[],
): number | null | "ambiguous" {
  const normalized = normalizeCourseReference(reference);
  if (!normalized) return null;
  const valid = candidates.filter(candidate => candidate.courseName.trim());
  // Exact equality is naturally included in each configured candidate's
  // accepted variants. No operation ever strips a suffix from spoken input.
  const matches = valid.filter(candidate => candidateAcceptsCourseReference(candidate.courseName, normalized));
  const prefixMatches = valid.filter(candidate => candidateStartsWithCourseReference(candidate.courseName, normalized));
  const numbers = new Set(matches.map(candidate => candidate.courseNumber));
  const relatedNumbers = new Set([...numbers, ...prefixMatches.map(candidate => candidate.courseNumber)]);
  return relatedNumbers.size > 1 ? "ambiguous" : numbers.size === 1 ? [...numbers][0] : null;
}

type CanonicalCourseClarificationOrder = NonNullable<Awaited<ReturnType<typeof getCanonicalAiNarocilo>>>;
type CourseClarificationDraft = {
  kind?: "single";
  narociloId: number;
  postavkaId: number;
  options: AvailableCourseReference[];
  orderFingerprint: string;
} | {
  kind: "batch";
  narociloId: number;
  targetPostavkaId: number;
  assignments: Array<{ postavkaId: number; courseNumber: number }>;
  options: AvailableCourseReference[];
  orderFingerprint: string;
  targets?: Array<{ postavkaId: number; options: AvailableCourseReference[] }>;
};
type ResolvedAgentResponse = AgentResponse | (Extract<AgentResponse, { action: "explain" }> & {
  courseClarificationDraft: CourseClarificationDraft;
});

const SingleCourseClarificationTokenPayloadSchema = z.object({
  v: z.literal(1),
  clarificationId: z.string().uuid(),
  enotaId: z.number().int().positive(),
  actorNatakarId: z.number().int().positive(),
  narociloId: z.number().int().positive(),
  postavkaId: z.number().int().positive(),
  options: z.array(CourseClarificationOptionSchema).min(1).max(20),
  orderFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  expiresAt: z.number().int().positive(),
}).strict();
const BatchCourseClarificationTokenPayloadSchema = z.object({
  v: z.literal(2),
  clarificationId: z.string().uuid(),
  enotaId: z.number().int().positive(),
  actorNatakarId: z.number().int().positive(),
  narociloId: z.number().int().positive(),
  targetPostavkaId: z.number().int().positive(),
  assignments: z.array(z.object({
    postavkaId: z.number().int().positive(),
    courseNumber: z.number().int().min(1).max(99),
  }).strict()).min(1).max(29),
  options: z.array(CourseClarificationOptionSchema).min(1).max(20),
  orderFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  expiresAt: z.number().int().positive(),
}).strict();
const CourseClarificationTokenPayloadSchema = z.discriminatedUnion("v", [
  SingleCourseClarificationTokenPayloadSchema,
  BatchCourseClarificationTokenPayloadSchema,
  BatchCourseClarificationTokenPayloadSchema.omit({ targetPostavkaId: true, options: true }).extend({
    v: z.literal(3),
    assignments: BatchCourseClarificationTokenPayloadSchema.shape.assignments.min(0),
    targets: z.array(z.object({
      postavkaId: z.number().int().positive(),
      options: z.array(CourseClarificationOptionSchema).min(1).max(20),
    }).strict()).min(1).max(30),
    selections: z.array(z.number().int().min(1).max(99)).max(29),
  }),
]);
export type CourseClarificationTokenPayload = z.infer<typeof CourseClarificationTokenPayloadSchema>;
export type MultiCourseClarificationTokenPayload = Extract<CourseClarificationTokenPayload, { v: 3 }>;
export type BatchCourseClarificationTokenPayload = z.infer<typeof BatchCourseClarificationTokenPayloadSchema>;
type SignableCourseClarificationPayload =
  | Omit<z.infer<typeof SingleCourseClarificationTokenPayloadSchema>, "v" | "clarificationId" | "expiresAt">
  | Omit<BatchCourseClarificationTokenPayload, "v" | "clarificationId" | "expiresAt">
  | Omit<MultiCourseClarificationTokenPayload, "v" | "clarificationId" | "expiresAt">;

export function fingerprintCourseClarificationOrder(order: CanonicalCourseClarificationOrder): string {
  return fingerprintKdsCourseAssignmentOrder(order);
}

export function signCourseClarificationToken(
  payload: SignableCourseClarificationPayload,
  secret = process.env.SESSION_SECRET,
  now = Date.now(),
): string | null {
  if (!secret) return null;
  return encodeCourseClarificationToken({
    v: "targets" in payload ? 3 : "assignments" in payload ? 2 : 1,
    clarificationId: randomUUID(),
    ...payload,
    expiresAt: now + 2 * 60_000,
  } as CourseClarificationTokenPayload, secret);
}

export function encodeCourseClarificationToken(payload: CourseClarificationTokenPayload, secret = process.env.SESSION_SECRET): string | null {
  if (!secret) return null;
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyCourseClarificationToken(
  token: string,
  secret = process.env.SESSION_SECRET,
  now = Date.now(),
): CourseClarificationTokenPayload | null {
  if (!secret) return null;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(encoded).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = CourseClarificationTokenPayloadSchema.safeParse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    return parsed.success && parsed.data.expiresAt >= now ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseCourseClarificationReply(command: string): number | null {
  const match = normalizeAgentCommand(command).match(/^(?:hod\s*)?(\d{1,2})$/u);
  const value = Number(match?.[1]);
  return Number.isInteger(value) && value >= 1 && value <= 99 ? value : null;
}

export function currentCourseClarificationTarget(payload: CourseClarificationTokenPayload) {
  return payload.v === 3
    ? payload.targets[payload.selections.length]!
    : { postavkaId: payload.v === 1 ? payload.postavkaId : payload.targetPostavkaId, options: payload.options };
}

function sameCourseClarificationOptions(
  expected: AvailableCourseReference[],
  actual: AvailableCourseReference[],
): boolean {
  const normalize = (items: AvailableCourseReference[]) => [...items]
    .map(item => ({ courseNumber: item.courseNumber, courseName: item.courseName.trim() }))
    .sort((a, b) => a.courseNumber - b.courseNumber || a.courseName.localeCompare(b.courseName));
  return JSON.stringify(normalize(expected)) === JSON.stringify(normalize(actual));
}

export function validateCourseClarificationContinuation(input: {
  payload: CourseClarificationTokenPayload;
  command: string;
  enotaId: number;
  actorNatakarId: number;
  requestedNarociloId?: number;
  order: CanonicalCourseClarificationOrder | null;
  currentReferences: AvailableCourseReference[];
}): { status: "ready"; result: Extract<AgentResponse, { action: "assign_course" | "assign_courses" }> }
  | { status: "pending"; payload: MultiCourseClarificationTokenPayload }
  | { status: "invalid_selection" }
  | { status: "stale" } {
  const { payload, order } = input;
  if (
    payload.enotaId !== input.enotaId
    || payload.actorNatakarId !== input.actorNatakarId
    || payload.narociloId !== input.requestedNarociloId
    || !order
    || order.id !== payload.narociloId
    || fingerprintCourseClarificationOrder(order) !== payload.orderFingerprint
  ) return { status: "stale" };
  if (payload.v === 3) {
    const ids = [...payload.assignments, ...payload.targets].map(item => item.postavkaId);
    if (ids.length > 30 || new Set(ids).size !== ids.length
      || payload.selections.length >= payload.targets.length) return { status: "stale" };
    // Recheck ALL options, including already selected and future targets.
    for (const [index, target] of payload.targets.entries()) {
      const currentOptions = input.currentReferences.filter(reference =>
        target.options.some(option => option.courseNumber === reference.courseNumber));
      if (!order.postavke.some(item => item.id === target.postavkaId && item.parentPostavkaId == null && item.racunId == null)
        || !sameCourseClarificationOptions(target.options, currentOptions)
        || (index < payload.selections.length && !target.options.some(option => option.courseNumber === payload.selections[index]))) {
        return { status: "stale" };
      }
    }
  }
  const target = currentCourseClarificationTarget(payload);
  const targetPostavkaId = target.postavkaId;
  const line = order.postavke.find(item =>
    item.id === targetPostavkaId && item.parentPostavkaId == null && item.racunId == null
  );
  const currentOptions = input.currentReferences.filter(reference =>
    target.options.some(option => option.courseNumber === reference.courseNumber)
  );
  if (!line || !sameCourseClarificationOptions(target.options, currentOptions)) {
    return { status: "stale" };
  }
  const courseNumber = parseCourseClarificationReply(input.command);
  if (!courseNumber || !target.options.some(option => option.courseNumber === courseNumber)) {
    return { status: "invalid_selection" };
  }
  if (payload.v !== 1) {
    const storedAssignments = payload.assignments.map(assignment => {
      const storedLine = order.postavke.find(item =>
        item.id === assignment.postavkaId && item.parentPostavkaId == null && item.racunId == null
      );
      return storedLine ? { ...assignment, naziv: storedLine.naziv } : null;
    });
    if (storedAssignments.some(assignment => assignment === null)) return { status: "stale" };
    if (payload.v === 3 && payload.selections.length + 1 < payload.targets.length) {
      return { status: "pending", payload: { ...payload, selections: [...payload.selections, courseNumber] } };
    }
    return {
      status: "ready",
      result: {
        action: "assign_courses",
        narociloId: payload.narociloId,
        assignments: [
          ...storedAssignments as Array<{ postavkaId: number; courseNumber: number; naziv: string }>,
          ...(payload.v === 3 ? payload.selections.map((selected, index) => ({
            postavkaId: payload.targets[index]!.postavkaId,
            courseNumber: selected,
            naziv: order.postavke.find(item => item.id === payload.targets[index]!.postavkaId)!.naziv,
          })) : []),
          { postavkaId: line.id, courseNumber, naziv: line.naziv },
        ],
        odgovor: `Dodeljujem paket postavk; ${line.naziv} hodu ${courseNumber}.`,
      },
    };
  }
  return {
    status: "ready",
    result: {
      action: "assign_course",
      narociloId: payload.narociloId,
      postavkaId: payload.postavkaId,
      courseNumber,
      odgovor: `Dodeljujem ${line.naziv} hodu ${courseNumber}.`,
    },
  };
}

export async function resolveAgentAction(
  command: string,
  narociloId: number | undefined,
  enotaId: number,
  testOverrides: {
    getOrder?: typeof getCanonicalAiNarocilo;
    loadCourseReferences?: (order: NonNullable<Awaited<ReturnType<typeof getCanonicalAiNarocilo>>>, enotaId: number) => Promise<AvailableCourseReference[]>;
    getTableStatus?: (tableNumber: number, enotaId: number) => Promise<AgentResponse>;
  } = {},
): Promise<ResolvedAgentResponse | null> {
  const normalized = normalizeAgentCommand(command);
  const multiCourseAssignment = parseMultiCourseAssignmentCommand(command);
  const courseAssignment = parseCourseAssignmentCommand(command);
  if (!multiCourseAssignment && !courseAssignment && /\b(cena|stane|vino|wine|cigaret|tobak|pic\p{L}*|pizza|eta|cakanje|caka|pripravljena|porcije)\b/u.test(normalized)) {
    const operationalAnswer = answerOperationalQuestion(command, await loadOperationalSnapshot(enotaId, "staff"));
    if (operationalAnswer) return { action: "explain", odgovor: operationalAnswer };
  }
  const missingCurrent = currentOrderRequired(narociloId);
  const checkout = /\b(blagajn\p{L}*|placil\p{L}*|checkout)\b/u.test(normalized)
    && /\b(odpri|pripravi|pojdi)\b/.test(normalized) && !/\bnastavit/.test(normalized);
  if (checkout) {
    if (missingCurrent) return missingCurrent;
    const order = await (testOverrides.getOrder ?? getCanonicalAiNarocilo)(narociloId!, enotaId);
    if (!order) return { action: "explain", odgovor: "Naročilo v izbrani enoti ne obstaja." };
    const missingPrerequisites = preveriKriticneNapakeSvetovalca("blagajna", order);
    return { action: "prepare_checkout", narociloId: narociloId!, navigateTo: `/blagajna?narocilo=${narociloId}`, missingPrerequisites,
      odgovor: missingPrerequisites.length ? `Blagajne ne morem pripraviti: ${missingPrerequisites.join(" ")}` : "Naročilo je preverjeno; odpiram blagajno. Plačila ne izvedem." };
  }
  const tableStatusNumber = parseTableStatusQuestion(command);
  if (tableStatusNumber != null && testOverrides.getTableStatus) {
    return testOverrides.getTableStatus(tableStatusNumber, enotaId);
  }
  if (tableStatusNumber != null) {
    const tables = await db.select({ id: mizeTable.id, ime: mizeTable.ime, stevilka: mizeTable.stevilka, status: mizeTable.status })
      .from(mizeTable).where(and(eq(mizeTable.enotaId, enotaId), eq(mizeTable.arhivirana, false), eq(mizeTable.stevilka, tableStatusNumber)));
    if (tables.length !== 1) return { action: "explain", odgovor: tables.length ? "Najdenih je več miz s to številko; preverite nastavitve miz." : "Miza s to številko ni najdena v tej enoti." };
    const table = tables[0];
    const openOrders = await db.select({ id: narocilaTable.id }).from(narocilaTable).where(and(
      eq(narocilaTable.enotaId, enotaId), eq(narocilaTable.mizaId, table.id), eq(narocilaTable.status, "odprto"),
    ));
    const reservations = await db.select({ zacetek: rezervacijeMizTable.zacetek }).from(rezervacijeMizTable).where(and(
      eq(rezervacijeMizTable.enotaId, enotaId), eq(rezervacijeMizTable.mizaId, table.id), eq(rezervacijeMizTable.status, "aktivna"),
    )).orderBy(rezervacijeMizTable.zacetek);
    const state = resolveAgentTableDisplayState({
      persistedStatus: table.status, openOrderCount: openOrders.length,
      reservationStarts: reservations.map(reservation => reservation.zacetek), now: Date.now(),
    });
    return { action: "explain", odgovor: `${table.ime?.trim() || `Miza ${table.stevilka}`} je ${state}${openOrders.length ? ` (${openOrders.length} odprtih naročil)` : ""}.` };
  }
  const staticPath = navigationForCommand(command);
  if (staticPath) {
    const settingsMutation = isSafeAgentSettingsNavigation(staticPath)
      && /\b(nastav\p{L}*|spremen\p{L}*|shran\p{L}*|izbris\p{L}*|omogoc\p{L}*|onemogoc\p{L}*)\b/u.test(normalized);
    return {
      action: "navigate",
      navigateTo: staticPath,
      odgovor: settingsMutation
        ? "Odpiram ustrezne nastavitve. Spremembe niso izvedene; preverite jih in jih ročno shranite."
        : "Odpiram zahtevani modul.",
    };
  }
  if (/\b(premakni|prestavi)\b/.test(normalized) && /\bmiz[aeiou]\b/.test(normalized)) {
    if (missingCurrent) return missingCurrent;
    const tableNo = parseOpenTableOrderCommand(`odpri narocilo ${normalized.replace(/.*?\bmiz[aeiou]\b/, "na mizi")}`);
    if (!tableNo) return { action: "explain", odgovor: "Navedite veljavno ciljno številko mize." };
    const tables = await db.select({ id: mizeTable.id, ime: mizeTable.ime, stevilka: mizeTable.stevilka }).from(mizeTable).where(eq(mizeTable.enotaId, enotaId));
    const table = tables.filter((item) => item.stevilka === tableNo);
    if (table.length !== 1) return { action: "explain", odgovor: "Ciljna miza ni enolično najdena v tej enoti." };
    return { action: "move_order", narociloId: narociloId!, mizaId: table[0].id, odgovor: `Premikam naročilo na mizo ${tableNo}.` };
  }
  if (/\b(zdruzi|združi|spoji)\b/.test(normalized) && /\bnarocil/.test(normalized)) {
    if (missingCurrent) return missingCurrent;
    const sourceId = Number(normalized.match(/\bnarocil\w*\s+(?:stevilka\s+)?(\d+)\b/u)?.[1]);
    if (!Number.isInteger(sourceId) || sourceId < 1 || sourceId === narociloId) {
      return { action: "explain", odgovor: "Za združitev navedite drugo, veljavno številko naročila." };
    }
    if (!await getCanonicalAiNarocilo(sourceId, enotaId)) {
      return { action: "explain", odgovor: "Izvorno naročilo ni najdeno v tej enoti." };
    }
    return { action: "merge_order", narociloId: narociloId!, virNarociloId: sourceId, odgovor: `Združujem naročilo ${sourceId} v trenutno naročilo.` };
  }
  const order = narociloId ? await (testOverrides.getOrder ?? getCanonicalAiNarocilo)(narociloId, enotaId) : null;
  if (narociloId && !order) return { action: "explain", odgovor: "Naročilo v izbrani enoti ne obstaja." };
  if (multiCourseAssignment) {
    if (missingCurrent) return missingCurrent;
    if (multiCourseAssignment.length > 30) {
      return { action: "explain", odgovor: "V enem ukazu je mogoče dodeliti največ 30 postavk." };
    }
    const lines = order!.postavke
      .filter((item) => item.parentPostavkaId == null && item.racunId == null);
    const resolved = [];
    for (const assignment of multiCourseAssignment) {
      const selected = resolveExactAgentEntity(assignment.itemName, lines.map(item => ({ ...item, ime: item.naziv })));
      if (selected === "ambiguous") {
        return { action: "explain", odgovor: `Postavka "${assignment.itemName}" je dvoumna v trenutnem naročilu.` };
      }
      if (!selected) {
        return { action: "explain", odgovor: `Postavka "${assignment.itemName}" ni najdena v trenutnem naročilu.` };
      }
      resolved.push({ assignment, selected });
    }
    const references = multiCourseAssignment.some(assignment => "courseName" in assignment)
      ? await (testOverrides.loadCourseReferences ?? loadActiveOrderCourseReferences)(order!, enotaId)
      : [];
    const assignments: Array<{ postavkaId: number; courseNumber: number; naziv: string }> = [];
    const clarifications: Array<{ targetPostavkaId: number; options: AvailableCourseReference[]; reference: string }> = [];
    for (const { assignment, selected } of resolved) {
      const namedCourseName = "courseName" in assignment ? assignment.courseName : null;
      const courseNumber = "courseNumber" in assignment
        ? assignment.courseNumber
        : resolveNamedCourseReference(namedCourseName!, references);
      if (courseNumber === "ambiguous") {
        clarifications.push({
          targetPostavkaId: selected.id,
          options: findCourseClarificationOptions(namedCourseName!, references),
          reference: namedCourseName!,
        });
        continue;
      }
      if (!courseNumber) {
        return { action: "explain", odgovor: `Imenovani hod "${namedCourseName}" ni najden v aktivnem večhodnem meniju tega naročila.` };
      }
      assignments.push({ postavkaId: selected.id, courseNumber, naziv: selected.naziv });
    }
    const byItem = new Map<number, number>();
    for (const assignment of assignments) {
      const prior = byItem.get(assignment.postavkaId);
      if (prior != null && prior !== assignment.courseNumber) {
        return { action: "explain", odgovor: `Postavke "${assignment.naziv}" ni mogoče dodeliti dvema različnima hodoma.` };
      }
      byItem.set(assignment.postavkaId, assignment.courseNumber);
    }
    const uniqueAssignments = [...new Map(assignments.map(assignment => [
      `${assignment.postavkaId}:${assignment.courseNumber}`, assignment,
    ])).values()];
    const clarification = clarifications[0];
    if (clarification) {
      const ids = [...uniqueAssignments.map(item => item.postavkaId), ...clarifications.map(item => item.targetPostavkaId)];
      if (new Set(ids).size !== ids.length) {
        return { action: "explain", odgovor: "Ista postavka je v paketu navedena z dvema različnima izbirama hoda." };
      }
      return {
        action: "explain",
        odgovor: `Za postavko "${lines.find(item => item.id === clarification.targetPostavkaId)!.naziv}" ime hoda "${clarification.reference}" ni enolično. Izberite: ${clarification.options.map(option => `${option.courseName} (${option.courseNumber})`).join(" ali ")}?`,
        courseClarificationDraft: {
          kind: "batch",
          narociloId: narociloId!,
          targetPostavkaId: clarification.targetPostavkaId,
          assignments: uniqueAssignments.map(({ postavkaId, courseNumber }) => ({ postavkaId, courseNumber })),
          options: clarification.options,
          ...(clarifications.length > 1 ? { targets: clarifications.map(item => ({
            postavkaId: item.targetPostavkaId, options: item.options,
          })) } : {}),
          orderFingerprint: fingerprintCourseClarificationOrder(order!),
        },
      };
    }
    // The parser's two-item threshold is intentionally retained even if the
    // caller repeated the same item/course; it never turns into a singular write.
    return {
      action: "assign_courses", narociloId: narociloId!, assignments: uniqueAssignments,
      odgovor: `Dodeljujem ${uniqueAssignments.map(item => `${item.naziv} hodu ${item.courseNumber}`).join(", ")}.`,
    };
  }
  if (courseAssignment) {
    if (missingCurrent) return missingCurrent;
    const selected = resolveExactAgentEntity(courseAssignment.itemName, order!.postavke
      .filter((item) => item.parentPostavkaId == null && item.racunId == null)
      .map((item) => ({ ...item, ime: item.naziv })));
    if (selected === "ambiguous") return { action: "explain", odgovor: "V naročilu je več enakih postavk. Izberite postavko v POS-u." };
    if (!selected) return { action: "explain", odgovor: "Navedite točno postavko v trenutnem naročilu." };
    const namedCourseName = "courseName" in courseAssignment ? courseAssignment.courseName : null;
    const references = namedCourseName
      ? await (testOverrides.loadCourseReferences ?? loadActiveOrderCourseReferences)(order!, enotaId)
      : [];
    const courseNumber = "courseNumber" in courseAssignment
      ? courseAssignment.courseNumber
      : resolveNamedCourseReference(namedCourseName!, references);
    if (courseNumber === "ambiguous") {
      const options = findCourseClarificationOptions(namedCourseName!, references);
      return {
        action: "explain",
        odgovor: `Ime hoda ni enolično. Izberite: ${options.map(option => `${option.courseName} (${option.courseNumber})`).join(" ali ")}?`,
        courseClarificationDraft: {
          narociloId: narociloId!,
          postavkaId: selected.id,
          options,
          orderFingerprint: fingerprintCourseClarificationOrder(order!),
        },
      };
    }
    if (!courseNumber) {
      const options = findCourseClarificationOptions(namedCourseName!, references);
      if (!options.length) {
        return { action: "explain", odgovor: "Imenovani hod ni najden in v trenutnem naročilu ni razpoložljivih hodov." };
      }
      return {
        action: "explain",
        odgovor: `Imenovani hod ni najden. Razpoložljivi so: ${options.map(option => `${option.courseName} (${option.courseNumber})`).join(", ")}. Izberite številko hoda.`,
        courseClarificationDraft: {
          narociloId: narociloId!,
          postavkaId: selected.id,
          options,
          orderFingerprint: fingerprintCourseClarificationOrder(order!),
        },
      };
    }
    if (courseNumber < 1 || courseNumber > 99) return { action: "explain", odgovor: "Navedite točno postavko in veljaven hod med 1 in 99." };
    return {
      action: "assign_course", narociloId: narociloId!, postavkaId: selected.id, courseNumber,
      odgovor: `Dodeljujem ${selected.naziv} hodu ${courseNumber}.`,
    };
  }
  if (/\b(hod|course|vec hod|več hod)\b/.test(normalized)) {
    return { action: "explain", odgovor: "Večhodni meni zahteva izbiro v POS dialogu; tega ne morem varno obiti." };
  }
  const itemMatch = normalized.match(/\b(?:dodaj|odstrani|izbrisi|izbriši|nastavi|spremeni)\b\s+(?:(\d+)\s*(?:x|krat)?\s+)?(.+?)(?:\s+(?:na|gostu|z opombo)\s+(.+))?$/u);
  if (!itemMatch) {
    return /\b(dodaj|odstrani|izbrisi|izbriši|nastavi|spremeni|dodeli)\b/.test(normalized)
      ? { action: "explain", odgovor: "Za spremembo postavke navedite točen naziv artikla in po potrebi količino." }
      : null;
  }
  if (missingCurrent) return missingCurrent;
  const [, quantityRaw, itemName, trailing] = itemMatch;
  const items = order!.postavke.filter((item) => item.parentPostavkaId == null && item.racunId == null);
  const selected = resolveExactAgentEntity(itemName, items.map((item) => ({ ...item, ime: item.naziv })));
  const isAdd = /\bdodaj\b/.test(normalized);
  if (isAdd) {
    const articles = await db.select({ id: artikliTable.id, ime: artikliTable.ime, jePica: artikliTable.jePica })
      .from(artikliTable).where(and(eq(artikliTable.enotaId, enotaId), eq(artikliTable.aktiven, true)));
    const article = resolveExactAgentEntity(itemName, articles);
    if (article === "ambiguous") return { action: "explain", odgovor: "Najdenih je več artiklov s tem imenom. Navedite natančnejši naziv.", clarifications: articles.filter(a => normalizeAgentEntityName(a.ime) === normalizeAgentEntityName(itemName)).map(a => a.ime) };
    if (!article) return { action: "explain", odgovor: "Artikel s točnim imenom ni najden v tej enoti." };
    if (article.jePica) return { action: "explain", odgovor: "Pico dodajte prek POS dialoga, kjer izberete velikost in modifikatorje." };
    return { action: "add_item", narociloId: narociloId!, artikelId: article.id, kolicina: parseQuantity(quantityRaw), odgovor: `Dodajam ${article.ime}.` };
  }
  if (selected === "ambiguous") return { action: "explain", odgovor: "V naročilu je več enakih postavk. Izberite postavko v POS-u." };
  if (!selected) return { action: "explain", odgovor: "Postavka s točnim imenom ni najdena v trenutnem naročilu." };
  if (/\b(odstrani|izbrisi|izbriši)\b/.test(normalized)) return { action: "remove_item", narociloId: narociloId!, postavkaId: selected.id, odgovor: `Odstranjujem ${selected.naziv}.` };
  if (/\b(gostu)\b/.test(normalized)) return { action: "update_item", narociloId: narociloId!, postavkaId: selected.id, gostStevilka: parseQuantity(trailing), odgovor: `Dodeljujem ${selected.naziv} gostu ${parseQuantity(trailing)}.` };
  if (/\b(opombo)\b/.test(normalized)) return { action: "update_item", narociloId: narociloId!, postavkaId: selected.id, opomba: trailing?.trim() || null, odgovor: `Posodabljam opombo za ${selected.naziv}.` };
  return { action: "update_item", narociloId: narociloId!, postavkaId: selected.id, kolicina: parseQuantity(trailing ?? quantityRaw), odgovor: `Nastavljam količino za ${selected.naziv}.` };
}

type AgentAuditSummary = {
  action: string;
  outcome: string;
  metadata: unknown;
};

export function findRepeatableOpenTableNumber(history: AgentAuditSummary[]): number | null {
  for (const item of history) {
    if (item.action === "reset_memory") return null;
    if (item.outcome !== "success" || item.action !== "navigate") continue;
    const metadata = item.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue;
    const record = metadata as Record<string, unknown>;
    if (record.intent !== "open_table_order") continue;
    const tableNumber = record.tableNumber;
    return typeof tableNumber === "number" && Number.isSafeInteger(tableNumber) && tableNumber > 0
      ? tableNumber
      : null;
  }
  return null;
}

export function parseExplicitAgentPreference(command: string): { key: string; value: string; label: string } | null {
  if (!/\bzapomni\s+si\b/i.test(command)) return null;
  const unit = command.match(/\b(kg|g|ml|l|kos)\b/i)?.[1]?.toLowerCase();
  if (unit) return { key: "default_unit", value: unit, label: `privzeta merska enota ${unit}` };
  if (/\b(kratko|jedrnato)\b/i.test(command)) {
    return { key: "response_style", value: "concise", label: "jedrnat način odgovorov" };
  }
  if (/\b(podrobno|natančno|natancno)\b/i.test(command)) {
    return { key: "response_style", value: "detailed", label: "podroben način odgovorov" };
  }
  return null;
}

function parseNastavitve(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

export async function withAiTimeout<T>(promise: Promise<T>, timeoutMs = 8_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("AI_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function verifyAiAccessToken(token: string, naprava: typeof napraveTable.$inferSelect): boolean {
  const secret = process.env.SESSION_SECRET;
  const [payload, signature] = token.split(".");
  if (!secret || !payload || !signature) return false;
  const expectedPayload = Buffer.from(`${naprava.id}:${naprava.enotaId}:${naprava.napravaKljuc}`).toString("base64url");
  const expectedSignature = createHmac("sha256", secret).update(expectedPayload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  return payload === expectedPayload
    && actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

async function getEnabledAiDevice(req: Request, enotaId: number) {
  const napravaKljuc = req.headers["x-naprava-id"];
  const aiAccessToken = req.headers["x-ai-device-token"];
  if (typeof napravaKljuc !== "string" || typeof aiAccessToken !== "string") return null;
  const [naprava] = await db.select().from(napraveTable).where(and(
    eq(napraveTable.enotaId, enotaId),
    eq(napraveTable.napravaKljuc, napravaKljuc),
  )).limit(1);
  if (!naprava || !verifyAiAccessToken(aiAccessToken, naprava)) return null;
  return parseNastavitve(naprava.nastavitveJson).aiSvetovalecAktiven === true ? naprava : null;
}

type CanonicalAiOrder = {
  id: number; nacin: string; status: string;
  miza: string | number | null; strankaIme: string | null; telefon: string | null;
  naslovDostave: string | null; skupaj: number;
  postavke: Array<{
    id: number; artikelId: number | null; naziv: string; kolicina: number; skupaj: number;
    opomba: string | null; parentPostavkaId: number | null; racunId: number | null;
    courseNumber?: number | null; courseSequence?: number | null; courseNameSnapshot?: string | null; pairingGroupId?: string | null;
  }>;
};

async function getCanonicalAiNarocilo(id: number, enotaId: number): Promise<CanonicalAiOrder | null> {
  const narocilo = await getNarociloById(id, "", enotaId);
  if (!narocilo) return null;
  const postavke = narocilo.postavke
    .filter((postavka) => postavka.parentPostavkaId == null && postavka.racunId == null)
    .map((postavka) => ({
      id: postavka.id,
      artikelId: postavka.artikelId,
      naziv: postavka.ime,
      kolicina: Number(postavka.kolicina),
      skupaj: Number(postavka.skupaj),
      opomba: postavka.opomba,
      parentPostavkaId: postavka.parentPostavkaId,
      racunId: postavka.racunId,
      // These are a read-only canonical snapshot. assignKdsCourse still locks
      // and derives the live sequence when it performs the mutation.
      courseNumber: postavka.courseNumber,
      courseSequence: postavka.courseSequence,
      courseNameSnapshot: postavka.courseNameSnapshot,
      pairingGroupId: postavka.pairingGroupId,
    }));
  const jeDostava = narocilo.nacinIzpolnitve === "dostava";
  return {
    id: narocilo.id,
    nacin: jeDostava ? "dostava" : narocilo.nacin,
    status: narocilo.status,
    miza: narocilo.mizaIme ?? narocilo.mizaStevilka ?? narocilo.mizaId,
    strankaIme: narocilo.strankaIme,
    telefon: narocilo.strankaTelefon,
    naslovDostave: narocilo.dostavaUlica
      ? [`${narocilo.dostavaUlica} ${narocilo.dostavaHisnaStevilka ?? ""}`.trim(), narocilo.dostavaNaseljeNaziv]
        .filter(Boolean).join(", ")
      : null,
    skupaj: postavke.reduce((sum, postavka) => sum + postavka.skupaj, 0),
    postavke,
  };
}

/** Loads only course names that are usable by this order in this tenant. */
export async function loadActiveOrderCourseReferences(
  order: NonNullable<Awaited<ReturnType<typeof getCanonicalAiNarocilo>>>,
  enotaId: number,
): Promise<AvailableCourseReference[]> {
  const presentCourseNumbers = new Set<number>();
  const snapshots = new Map<number, string>();
  const ambiguousSnapshots = new Set<number>();
  for (const line of order.postavke) {
    const number = line.courseNumber;
    if (number != null) presentCourseNumbers.add(number);
    const name = line.courseNameSnapshot?.trim();
    if (number == null || !name || ambiguousSnapshots.has(number)) continue;
    const existing = snapshots.get(number);
    if (existing && existing !== name) {
      // Conflicting persisted evidence is not safe to resolve by name.
      snapshots.delete(number);
      ambiguousSnapshots.add(number);
      continue;
    }
    snapshots.set(number, name);
  }
  // Only the commercial envelope (grouped but without course metadata) is a
  // durable menu identity. Operational food/wine lines must not admit another
  // menu merely because their article is also configured as a menu elsewhere.
  const menuArtikelIds = [...new Set(order.postavke
    .filter(line =>
      line.parentPostavkaId == null
      && line.racunId == null
      && line.pairingGroupId != null
      && line.courseNumber == null
    )
    .map(line => line.artikelId)
    .filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0))];
  const legacyCourseNumbers = [...presentCourseNumbers].filter(
    number => !snapshots.has(number) && !ambiguousSnapshots.has(number),
  );
  const configured = !menuArtikelIds.length || !legacyCourseNumbers.length ? [] : await db.select({
    courseNumber: multicourseMenuCoursesTable.courseNumber,
    courseName: multicourseMenuCoursesTable.courseName,
  }).from(multicourseMenusTable)
    .innerJoin(multicourseMenuCoursesTable, eq(multicourseMenuCoursesTable.menuId, multicourseMenusTable.id))
    .where(and(
      eq(multicourseMenusTable.enotaId, enotaId),
      eq(multicourseMenusTable.aktivno, true),
      inArray(multicourseMenusTable.menuArtikelId, menuArtikelIds),
      inArray(multicourseMenuCoursesTable.courseNumber, legacyCourseNumbers),
    ));
  const configuredNames = new Map<number, Set<string>>();
  for (const course of configured) {
    const name = course.courseName.trim();
    if (!name) continue;
    const names = configuredNames.get(course.courseNumber) ?? new Set<string>();
    names.add(name);
    configuredNames.set(course.courseNumber, names);
  }
  return [...presentCourseNumbers].sort((a, b) => a - b).map(courseNumber => {
    const snapshot = ambiguousSnapshots.has(courseNumber) ? null : snapshots.get(courseNumber);
    const configuredForNumber = configuredNames.get(courseNumber);
    return {
      courseNumber,
      courseName: snapshot
        ?? (configuredForNumber?.size === 1 ? [...configuredForNumber][0]! : `${courseNumber}. hod`),
    };
  });
}

async function loadOrderCourseNameForAudit(
  narociloId: number,
  enotaId: number,
  courseNumber: number,
): Promise<string | null> {
  const order = await getCanonicalAiNarocilo(narociloId, enotaId);
  if (!order) return null;
  return (await loadActiveOrderCourseReferences(order, enotaId))
    .find(reference => reference.courseNumber === courseNumber)?.courseName ?? null;
}

export function preveriKriticneNapakeSvetovalca(
  faza: "narocilo" | "blagajna",
  narocilo: z.infer<typeof SvetovalecBodySchema>["narocilo"],
): string[] {
  const napake: string[] = [];
  if (faza === "blagajna" && narocilo.postavke.length === 0) {
    napake.push("Praznega naročila ni dovoljeno zaključiti.");
  }
  if (narocilo.nacin === "dostava" && !narocilo.naslovDostave) {
    napake.push("Pred zaključkom dostave je obvezen naslov dostave.");
  }
  if ((narocilo.nacin === "dostava" || narocilo.nacin === "telefon") && !narocilo.telefon) {
    napake.push("Pred zaključkom telefonskega naročila ali dostave je obvezna telefonska številka.");
  }
  return napake;
}

const AiPostavkeSchema = z.object({
  postavke: z.array(z.object({
    artikelId: z.number().int().positive(),
    kolicina: z.number().int().min(1).max(99),
    opomba: z.string().trim().max(500).optional(),
    modifikatorji: z.array(z.number().int().positive()).max(100).optional(),
    velikostPice: VelikostPiceSchema.optional(),
  })).max(100),
});

type GlasovniArtikel = z.infer<typeof ArtikelSchema>;
type AiPostavke = z.infer<typeof AiPostavkeSchema>;

export function preveriAiGlasovnePostavke(
  vrednost: unknown,
  artikli: GlasovniArtikel[],
): AiPostavke {
  const parsed = AiPostavkeSchema.parse(vrednost);
  const artikliPoId = new Map(artikli.map((artikel) => [artikel.id, artikel]));

  return {
    postavke: parsed.postavke.flatMap((postavka) => {
      const artikel = artikliPoId.get(postavka.artikelId);
      if (!artikel) return [];

      const dovoljeniModifikatorji = new Set(artikel.modifikatorji.map((modifikator) => modifikator.id));
      const modifikatorji = [...new Set(postavka.modifikatorji ?? [])]
        .filter((id) => dovoljeniModifikatorji.has(id));
      const velikostPice = artikel.jePica
        && postavka.velikostPice
        && artikel.velikostiPice.includes(postavka.velikostPice)
        ? postavka.velikostPice
        : undefined;

      return [{
        artikelId: postavka.artikelId,
        kolicina: postavka.kolicina,
        ...(postavka.opomba ? { opomba: postavka.opomba } : {}),
        ...(modifikatorji.length > 0 ? { modifikatorji } : {}),
        ...(velikostPice ? { velikostPice } : {}),
      }];
    }),
  };
}

router.post("/ai/glasovni-ukaz", async (req: Request, res: Response): Promise<void> => {
  const parsed = GlasovniUkazBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ napaka: "Glasovni ukaz ali katalog artiklov ni veljaven." });
    return;
  }

  const { transkript, artikli } = parsed.data;
  const katalog = artikli.map((artikel) => ({
    id: artikel.id,
    ime: artikel.ime,
    kategorija: artikel.kategorija,
    jePica: artikel.jePica,
    velikostiPice: artikel.velikostiPice,
    modifikatorji: artikel.modifikatorji,
  }));

  try {
    const odgovor = await withAiTimeout(anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      system: `Si natančen POS pomočnik za slovensko restavracijo. Glasovni prepis pretvori v postavke iz podanega kataloga.

Pravila:
- Vedno uporabi izključno ID-je iz kataloga. Ne izmišljaj artiklov ali modifikatorjev.
- "Pica" in "pizza" sta ista beseda. Upoštevaj tipične napake slovenskega prepoznavanja govora.
- Pri pici je mala/majhna, normalna/srednja ali družinska/velika VELIKOST istega artikla, ne del njegovega naziva.
- Velikost vrni v velikostPice kot mala, normalna ali druzinska samo, če je dovoljena pri izbranem artiklu.
- Razrez (npr. trikotni razrez, štirikotni razrez, razrez na polovico) je modifikator. Izberi njegov ID iz artikla.
- Besedilo "brez ...", "dodaj ..." in druge možnosti izberi med modifikatorji, kadar obstaja dovolj jasno ujemanje.
- Če količina ni navedena, uporabi 1. Besedne količine pretvori v številke.
- Če artikel ni dovolj jasno določen, ga ne dodaj.
- V opombo daj samo navodilo, ki ni že predstavljeno z velikostjo ali modifikatorjem.`,
      messages: [{
        role: "user",
        content: `TRANSKRIPT:\n${transkript}\n\nKATALOG:\n${JSON.stringify(katalog)}`,
      }],
      tools: [{
        name: "oddaj_narocilo",
        description: "Vrne prepoznane postavke glasovnega POS naročila.",
        input_schema: {
          type: "object",
          properties: {
            postavke: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  artikelId: { type: "integer" },
                  kolicina: { type: "integer", minimum: 1, maximum: 99 },
                  opomba: { type: "string" },
                  modifikatorji: {
                    type: "array",
                    items: { type: "integer" },
                  },
                  velikostPice: {
                    type: "string",
                    enum: ["mala", "normalna", "druzinska"],
                  },
                },
                required: ["artikelId", "kolicina"],
                additionalProperties: false,
              },
            },
          },
          required: ["postavke"],
          additionalProperties: false,
        },
      }],
      tool_choice: { type: "tool", name: "oddaj_narocilo" },
    }));

    const toolUse = odgovor.content.find((blok) => blok.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      res.status(502).json({ napaka: "AI ni vrnil strukturiranega naročila." });
      return;
    }

    res.json(preveriAiGlasovnePostavke(toolUse.input, artikli));
  } catch (error) {
    req.log.error({ err: error }, "AI glasovni ukaz ni uspel");
    res.status(502).json({ napaka: "AI glasovnega ukaza trenutno ni mogoče obdelati." });
  }
});

router.post("/ai/svetovalec", async (req: Request, res: Response): Promise<void> => {
  const parsed = SvetovalecBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ napaka: "Podatki za AI svetovalca niso veljavni." });
    return;
  }

  const enotaId = (req as Request & { enotaId?: number }).enotaId;
  if (!enotaId) {
    res.status(403).json({ napaka: "Naprava ni registrirana." });
    return;
  }

  const naprava = await getEnabledAiDevice(req, enotaId);
  if (!naprava) {
    res.status(403).json({ napaka: "AI svetovalec je na tej napravi izklopljen." });
    return;
  }

  const { faza, vprasanje } = parsed.data;
  const narocilo = await getCanonicalAiNarocilo(parsed.data.narocilo.id, enotaId);
  if (!narocilo) {
    res.status(404).json({ napaka: "Naročilo v izbrani enoti ne obstaja." });
    return;
  }
  const kriticneNapake = preveriKriticneNapakeSvetovalca(faza, narocilo);

  try {
    const odgovor = await withAiTimeout(anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: `Si virtualni svetovalec slovenskemu natakarju v gostinskem POS-u.
Preveri podani posnetek naročila ter odgovori kratko, konkretno in prijazno v slovenščini.
Išči praktične nelogičnosti, pozabljene podatke, nenavadne količine, nejasne opombe in koristne predloge za boljšo postrežbo.
Ne izmišljaj zakonskih pravil, cen, artiklov ali podatkov, ki jih ni v posnetku.
Ne trdi, da si karkoli spremenil. Nikoli ne naročaj izvedbe plačila, fiskalizacije ali spremembe cene.
Tvoji nasveti niso blokade; kritične blokade določi izključno strežnik.
JEZIK: piši izključno v knjižni slovenščini, kot jo govori slovenski natakar. Nikoli ne uporabljaj hrvaških ali srbskih besed in oblik (npr. "treba", "mora se", "vrijeme", "račun" v pomenu "izračun", "točno" namesto "natančno", "molim", "hvala lijepa"). Uporabljaj kratke, jasne stavke in običajne gostinske izraze (miza, naročilo, račun, hod, artikel, natakar). Če ukaza ali podatka ne razumeš popolnoma, ne ugibaj: v enem stavku postavi kratko pojasnjevalno vprašanje. Odgovori samo na to, kar je bilo vprašano ali ukazano.`,
      messages: [{
        role: "user",
        content: `${vprasanje ? `VPRAŠANJE NATAKARJA:\n${vprasanje}\n\n` : ""}FAZA: ${faza}\nPOSNETEK:\n${JSON.stringify(narocilo)}`,
      }],
      tools: [{
        name: "vrni_svetovanje",
        description: "Vrne kratek povzetek in neblokirajoče nasvete natakarju.",
        input_schema: {
          type: "object",
          properties: {
            povzetek: { type: "string" },
            nasveti: { type: "array", items: { type: "string" }, maxItems: 5 },
          },
          required: ["povzetek", "nasveti"],
          additionalProperties: false,
        },
      }],
      tool_choice: { type: "tool", name: "vrni_svetovanje" },
    }));
    const toolUse = odgovor.content.find((blok) => blok.type === "tool_use");
    const ai = toolUse?.type === "tool_use" ? SvetovalecAiSchema.parse(toolUse.input) : null;
    if (!ai) {
      res.status(502).json({ napaka: "AI svetovalec ni vrnil veljavnega odgovora." });
      return;
    }
    res.json({ ...ai, kriticneNapake, blokirano: kriticneNapake.length > 0 });
  } catch (error) {
    req.log.error({ err: error }, "AI svetovalec ni uspel");
    res.json({
      povzetek: "AI nasveti trenutno niso dosegljivi. Kritične kontrole so bile vseeno izvedene.",
      nasveti: [],
      kriticneNapake,
      blokirano: kriticneNapake.length > 0,
    });
  }
});

router.post("/ai/svetovalec/preveri", async (req: Request, res: Response): Promise<void> => {
  const parsed = SvetovalecPreveriBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ napaka: "ID naročila ni veljaven." });
    return;
  }
  const enotaId = (req as Request & { enotaId?: number }).enotaId;
  if (!enotaId || !(await getEnabledAiDevice(req, enotaId))) {
    res.status(403).json({ napaka: "AI svetovalec je na tej napravi izklopljen." });
    return;
  }
  const narocilo = await getCanonicalAiNarocilo(parsed.data.narociloId, enotaId);
  if (!narocilo) {
    res.status(404).json({ napaka: "Naročilo v izbrani enoti ne obstaja." });
    return;
  }
  const kriticneNapake = preveriKriticneNapakeSvetovalca("blagajna", narocilo);
  res.json({ kriticneNapake, blokirano: kriticneNapake.length > 0 });
});

async function auditAgent(
  enotaId: number, napravaId: number, actorNatakarId: number, action: string, outcome: string, metadata: Record<string, unknown>,
): Promise<void> {
  // Metadata intentionally contains identifiers and validated action shape only, never prompt/response/order PII.
  await db.insert(posAiAgentAuditTable).values({ enotaId, napravaId, actorNatakarId, action, outcome, metadata });
}

async function lockUnconsumedCourseClarification(client: any, clarificationId: string): Promise<void> {
  await client.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`pos-ai-course-clarification:${clarificationId}`}))`);
  const [consumed] = await client.select({ id: posAiAgentAuditTable.id })
    .from(posAiAgentAuditTable)
    .where(and(
      eq(posAiAgentAuditTable.action, "clarify_course_consumed"),
      sql`${posAiAgentAuditTable.metadata}->>'clarificationId' = ${clarificationId}`,
    ))
    .limit(1);
  if (consumed) {
    throw new KdsCourseAssignmentConflict("To pojasnilo je bilo že uporabljeno. Ponovite celoten ukaz.");
  }
}

export async function consumeCourseClarificationAssignment(input: {
  payload: CourseClarificationTokenPayload;
  result: Extract<AgentResponse, { action: "assign_course" }>;
  enotaId: number;
  actorNatakarId: number;
  napravaId: number | null;
}, client: any = db): Promise<{ pairingGroupId: string; changed: boolean }> {
  if (input.payload.v !== 1) {
    throw new KdsCourseAssignmentConflict("Pojasnilo ne ustreza enojni dodelitvi hoda.");
  }
  if (client === db) return db.transaction(tx => consumeCourseClarificationAssignment(input, tx));
  await lockUnconsumedCourseClarification(client, input.payload.clarificationId);
  const mutation = await assignKdsCourse({
    narociloId: input.result.narociloId,
    enotaId: input.enotaId,
    postavkaId: input.result.postavkaId,
    courseNumber: input.result.courseNumber,
    expectedOrderFingerprint: input.payload.orderFingerprint,
  }, client);
  await client.insert(posAiAgentAuditTable).values({
    enotaId: input.enotaId,
    napravaId: input.napravaId,
    actorNatakarId: input.actorNatakarId,
    action: "clarify_course_consumed",
    outcome: "success",
    metadata: {
      clarificationId: input.payload.clarificationId,
      narociloId: input.result.narociloId,
      postavkaId: input.result.postavkaId,
      courseNumber: input.result.courseNumber,
    },
  });
  return mutation;
}

export async function consumeBatchCourseClarificationAssignments(input: {
  payload: BatchCourseClarificationTokenPayload | MultiCourseClarificationTokenPayload;
  result: Extract<AgentResponse, { action: "assign_courses" }>;
  enotaId: number;
  actorNatakarId: number;
  napravaId: number | null;
}, client: any = db): Promise<Awaited<ReturnType<typeof assignKdsCourses>>> {
  if (client === db) return db.transaction(tx => consumeBatchCourseClarificationAssignments(input, tx));
  await lockUnconsumedCourseClarification(client, input.payload.clarificationId);
  const mutation = await assignKdsCourses({
    narociloId: input.result.narociloId,
    enotaId: input.enotaId,
    assignments: input.result.assignments.map(({ postavkaId, courseNumber }) => ({ postavkaId, courseNumber })),
    expectedOrderFingerprint: input.payload.orderFingerprint,
  }, client);
  await client.insert(posAiAgentAuditTable).values({
    enotaId: input.enotaId,
    napravaId: input.napravaId,
    actorNatakarId: input.actorNatakarId,
    action: "clarify_course_consumed",
    outcome: "success",
    metadata: {
      clarificationId: input.payload.clarificationId,
      narociloId: input.result.narociloId,
      assignments: input.result.assignments.map(({ postavkaId, courseNumber }) => ({ postavkaId, courseNumber })),
    },
  });
  return mutation;
}

export function redactAgentOrder(order: Awaited<ReturnType<typeof getCanonicalAiNarocilo>>) {
  return order && {
    id: order.id, nacin: order.nacin, status: order.status, skupaj: order.skupaj,
    postavke: order.postavke.map(({ naziv, kolicina, skupaj }) => ({ naziv, kolicina, skupaj })),
  };
}

router.post("/ai/normativ-primerjava", async (req: Request, res: Response): Promise<void> => {
  const body = NormativeComparisonRequestSchema.safeParse(req.body);
  const enotaId = (req as Request & { enotaId?: number }).enotaId;
  if (!body.success) { res.status(400).json({ napaka: "Zahteva za primerjavo normativa ni veljavna." }); return; }
  if (!enotaId) { res.status(403).json({ napaka: "Naprava ni registrirana." }); return; }
  const device = await getEnabledAiDevice(req, enotaId);
  if (!device) { res.status(403).json({ napaka: "AI agent na tej napravi ni omogočen." }); return; }
  const actorNatakarId = (req as Request & { posActorNatakarId?: number }).posActorNatakarId;
  if (!actorNatakarId) { res.status(401).json({ napaka: "Za AI agenta je potrebna veljavna POS actor seja." }); return; }
  const local = await loadTenantNormative(body.data.artikelId, enotaId);
  if (!local) { res.status(404).json({ napaka: "Artikel ali normativ v izbrani enoti ne obstaja." }); return; }
  if (isPreparedFoodBulkNormative(local)) {
    res.status(422).json({ napaka: PREPARED_BULK_COMPARISON_MESSAGE });
    return;
  }
  try {
    const { comparison, cacheHit, coalesced } = await getCachedNormativeComparison(
      local,
      enotaId,
      () => researchNormative(local),
      { forceRefresh: body.data.forceRefresh },
    );
    await auditAgent(enotaId, device.id, actorNatakarId, "compare_normative", "success", {
      artikelId: local.artikelId,
      comparableRows: comparison.rows.filter(row => row.status === "comparable").length,
      cacheHit,
      coalesced,
      forceRefresh: body.data.forceRefresh,
      trigger: "editor",
    });
    res.json(comparison);
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") { res.status(404).json({ napaka: "Artikel ali normativ v izbrani enoti ne obstaja." }); return; }
    const busy = error instanceof Error && error.message === "RESEARCH_BUSY";
    await auditAgent(enotaId, device.id, actorNatakarId, "compare_normative", busy ? "busy" : "unavailable", {
      artikelId: local.artikelId,
      forceRefresh: body.data.forceRefresh,
      trigger: "editor",
    });
    if (busy) { res.status(503).json({ napaka: "Trenutno poteka preveč spletnih primerjav. Poskusite znova čez nekaj trenutkov." }); return; }
    req.log.warn({ reason: error instanceof Error ? error.message : "unknown" }, "Raziskava normativa ni na voljo");
    res.status(502).json({ napaka: "Spletna raziskava normativa trenutno ni na voljo. Poskusite znova pozneje." });
  }
});

router.post("/ai/agent", async (req: Request, res: Response): Promise<void> => {
  const body = PosAgentBodySchema.safeParse(req.body);
  const enotaId = (req as Request & { enotaId?: number }).enotaId;
  if (!body.success) { res.status(400).json({ napaka: "Ukaz AI agenta ni veljaven." }); return; }
  if (!enotaId) { res.status(403).json({ napaka: "Naprava ni registrirana." }); return; }
  const device = await getEnabledAiDevice(req, enotaId);
  if (!device) { res.status(403).json({ napaka: "AI agent na tej napravi ni omogočen." }); return; }
  const actorNatakarId = (req as Request & { posActorNatakarId?: number }).posActorNatakarId;
  if (!actorNatakarId) { res.status(401).json({ napaka: "Za AI agenta je potrebna veljavna POS actor seja." }); return; }
  let continuationResult: Extract<AgentResponse, { action: "assign_course" | "assign_courses" }> | null = null;
  let continuationPayload: CourseClarificationTokenPayload | null = null;
  if (body.data.courseClarificationToken) {
    const payload = verifyCourseClarificationToken(body.data.courseClarificationToken);
    if (!payload) {
      res.json({ action: "explain", odgovor: "Pojasnilo je poteklo ali ni več veljavno. Ponovite celoten ukaz." });
      return;
    }
    const order = await getCanonicalAiNarocilo(payload.narociloId, enotaId);
    const currentReferences = order ? await loadActiveOrderCourseReferences(order, enotaId) : [];
    const continuation = validateCourseClarificationContinuation({
      payload,
      command: body.data.ukaz,
      enotaId,
      actorNatakarId,
      requestedNarociloId: body.data.narociloId,
      order,
      currentReferences,
    });
    if (continuation.status === "stale") {
      await auditAgent(enotaId, device.id, actorNatakarId, "clarify_course", "stale", {
        narociloId: payload.narociloId,
        postavkaId: currentCourseClarificationTarget(payload)?.postavkaId,
        batch: payload.v !== 1,
      });
      res.json({ action: "explain", odgovor: "Naročilo ali razpoložljivi hodi so se med pojasnilom spremenili. Ponovite celoten ukaz." });
      return;
    }
    if (continuation.status === "invalid_selection") {
      const { options } = currentCourseClarificationTarget(payload);
      res.json({
        action: "explain",
        odgovor: `Izberite eno od ponujenih številk: ${options.map(option => `${option.courseName} (${option.courseNumber})`).join(" ali ")}.`,
        clarifications: options.map(option => `${option.courseName} (${option.courseNumber})`),
        courseClarification: {
          token: body.data.courseClarificationToken,
          options,
        },
      });
      return;
    }
    if (continuation.status === "pending") {
      const next = continuation.payload;
      const target = currentCourseClarificationTarget(next);
      const name = order!.postavke.find(item => item.id === target.postavkaId)!.naziv;
      const token = encodeCourseClarificationToken(next);
      res.json({
        action: "explain",
        odgovor: `Izbira je shranjena. Za postavko "${name}" izberite naslednji hod. Paket še ni izveden.`,
        ...(token ? { courseClarification: { token, options: target.options } } : {}),
      });
      return;
    }
    continuationPayload = payload;
    continuationResult = continuation.result;
  }
  const recentHistory = await db.select({
    action: posAiAgentAuditTable.action,
    outcome: posAiAgentAuditTable.outcome,
    metadata: posAiAgentAuditTable.metadata,
  }).from(posAiAgentAuditTable).where(and(
    eq(posAiAgentAuditTable.enotaId, enotaId),
    eq(posAiAgentAuditTable.actorNatakarId, actorNatakarId),
  )).orderBy(desc(posAiAgentAuditTable.createdAt)).limit(20);
  if (isRepeatLastAgentCommand(body.data.ukaz)) {
    const repeatedTableNumber = findRepeatableOpenTableNumber(recentHistory);
    if (repeatedTableNumber === null) {
      res.json({
        odgovor: "Ni prejšnjega ponovljivega ukaza.",
        action: "explain",
        entity: {},
      });
      return;
    }
    await auditAgent(enotaId, device.id, actorNatakarId, "navigate", "success", {
      intent: "open_table_order",
      tableNumber: repeatedTableNumber,
      repeated: true,
    });
    res.json({
      odgovor: `Ponavljam zadnji ukaz: odpiram naročilo za mizo ${repeatedTableNumber}.`,
      action: "navigate",
      navigateTo: `/?odpriMizo=${repeatedTableNumber}`,
      entity: {},
    });
    return;
  }
  if (isOpenOwnShiftCommand(body.data.ukaz)) {
    await auditAgent(enotaId, device.id, actorNatakarId, "open_own_shift", "success", {
      intent: "open_own_shift",
    });
    res.json({
      odgovor: "Odpiram vašo izmeno.",
      action: "open_own_shift",
      entity: {},
    });
    return;
  }
  const explicitPreference = parseExplicitAgentPreference(body.data.ukaz);
  if (explicitPreference) {
    await db.transaction(async (tx) => {
      await tx.insert(posAiAgentMemoryTable).values({
        enotaId,
        actorNatakarId,
        preferenceKey: explicitPreference.key,
        preferenceValue: explicitPreference.value,
      }).onConflictDoUpdate({
        target: [
          posAiAgentMemoryTable.enotaId,
          posAiAgentMemoryTable.actorNatakarId,
          posAiAgentMemoryTable.preferenceKey,
        ],
        set: { preferenceValue: explicitPreference.value, updatedAt: new Date() },
      });
      await tx.insert(posAiAgentAuditTable).values({
        enotaId,
        napravaId: device.id,
        actorNatakarId,
        action: "remember_preference",
        outcome: "success",
        metadata: { preferenceKey: explicitPreference.key },
      });
    });
    res.json({ odgovor: `Zapomnil sem si: ${explicitPreference.label}.`, action: "explain", entity: {} });
    return;
  }
  const openTableNumber = parseOpenTableOrderCommand(body.data.ukaz);
  if (openTableNumber != null) {
    await auditAgent(enotaId, device.id, actorNatakarId, "navigate", "success", {
      intent: "open_table_order",
      tableNumber: openTableNumber,
    });
    res.json({
      odgovor: `Odpiram naročilo za mizo ${openTableNumber}.`,
      action: "navigate",
      navigateTo: `/?odpriMizo=${openTableNumber}`,
      entity: {},
    });
    return;
  }
  const normativeCommand = await resolveNormativeComparisonCommand(body.data.ukaz, enotaId);
  if (normativeCommand?.action === "explain") {
    res.json({ odgovor: normativeCommand.odgovor, action: "explain", entity: {} }); return;
  }
  if (normativeCommand?.action === "compare_normative") {
    const local = await loadTenantNormative(normativeCommand.artikelId, enotaId);
    if (!local) { res.status(404).json({ napaka: "Normativ v izbrani enoti ne obstaja." }); return; }
    if (isPreparedFoodBulkNormative(local)) {
      res.json({ odgovor: PREPARED_BULK_COMPARISON_MESSAGE, action: "explain", entity: {} });
      return;
    }
    try {
      const { comparison, cacheHit, coalesced } = await getCachedNormativeComparison(
        local,
        enotaId,
        () => researchNormative(local),
        { forceRefresh: normativeCommand.forceRefresh },
      );
      await auditAgent(enotaId, device.id, actorNatakarId, "compare_normative", "success", { artikelId: local.artikelId, comparableRows: comparison.rows.filter(row => row.status === "comparable").length, cacheHit, coalesced });
      res.json({ action: "compare_normative", artikelId: local.artikelId, odgovor: `Primerjava normativa za ${local.targetName} je pripravljena.`, comparison, entity: {} });
    } catch (error) {
      const busy = error instanceof Error && error.message === "RESEARCH_BUSY";
      await auditAgent(enotaId, device.id, actorNatakarId, "compare_normative", busy ? "busy" : "unavailable", { artikelId: local.artikelId });
      res.status(busy ? 503 : 502).json({ napaka: busy
        ? "Trenutno poteka preveč spletnih primerjav. Poskusite znova čez nekaj trenutkov."
        : "Spletna raziskava normativa trenutno ni na voljo. Poskusite znova pozneje." });
    }
    return;
  }
  try {
    let result: ResolvedAgentResponse | null = continuationResult
      ?? await resolveAgentAction(body.data.ukaz, body.data.narociloId, enotaId);
    if (result === null) {
      const [learnedPreferences, order] = await Promise.all([
        db.select({ key: posAiAgentMemoryTable.preferenceKey, value: posAiAgentMemoryTable.preferenceValue })
          .from(posAiAgentMemoryTable).where(and(eq(posAiAgentMemoryTable.enotaId, enotaId), eq(posAiAgentMemoryTable.actorNatakarId, actorNatakarId))),
        body.data.narociloId ? getCanonicalAiNarocilo(body.data.narociloId, enotaId) : Promise.resolve(null),
      ]);
      if (body.data.narociloId && !order) { res.status(404).json({ napaka: "Naročilo v izbrani enoti ne obstaja." }); return; }
      const response = await withAiTimeout(anthropic.messages.create({
        model: "claude-sonnet-4-6", max_tokens: 8192,
        system: `Si splošni POS svetovalec. ${POS_AGENT_CATALOG}
JEZIK: piši izključno v knjižni slovenščini, kot jo govori slovenski natakar. Nikoli ne uporabljaj hrvaških ali srbskih besed in oblik (npr. "treba", "mora se", "vrijeme", "račun" v pomenu "izračun", "točno" namesto "natančno", "molim", "hvala lijepa"). Uporabljaj kratke, jasne stavke in običajne gostinske izraze (miza, naročilo, račun, hod, artikel, natakar). Če ukaza ali podatka ne razumeš popolnoma, ne ugibaj: v enem stavku postavi kratko pojasnjevalno vprašanje. Odgovori samo na to, kar je bilo vprašano ali ukazano.`,
        messages: [{ role: "user", content: JSON.stringify({
          ukaz: redactAgentPromptText(body.data.ukaz), narocilo: redactAgentOrder(order),
          delovnePreference: Object.fromEntries(learnedPreferences.map(item => [item.key, item.value])),
          nedavnaDejanja: recentHistory.map(({ action, outcome, metadata }) => ({ action, outcome, metadata })),
        }) }],
        tools: [{ name: "pos_agent_fallback", description: "Varni pojasnjevalni odgovor POS svetovalca.", input_schema: {
          type: "object", properties: {
            odgovor: { type: "string" }, action: { type: "string", enum: ["explain", "navigate"] }, navigateTo: { type: "string" },
          }, required: ["odgovor", "action"], additionalProperties: false,
        } }], tool_choice: { type: "tool", name: "pos_agent_fallback" },
      }));
      const tool = response.content.find(block => block.type === "tool_use");
      const parsedFallback = tool?.type === "tool_use" ? PosAgentFallbackSchema.safeParse(tool.input) : { success: false as const };
      if (!parsedFallback.success) { res.status(502).json({ napaka: "AI agent ni vrnil veljavnega strukturiranega odgovora." }); return; }
      result = parsedFallback.data.action === "navigate" && !isSafeAgentStaticNavigation(parsedFallback.data.navigateTo)
        ? { action: "explain", odgovor: "Tega navigacijskega ukaza ne morem varno izvesti." }
        : parsedFallback.data.action === "navigate"
          ? { action: "navigate", odgovor: parsedFallback.data.odgovor, navigateTo: parsedFallback.data.navigateTo! }
          : { action: "explain", odgovor: parsedFallback.data.odgovor };
    }
    if (result.action === "navigate" && !isSafeAgentStaticNavigation(result.navigateTo)) {
      await auditAgent(enotaId, device.id, actorNatakarId, "navigate", "rejected", {
        reason: "unsafe_or_unknown_path",
      });
      res.json({
        odgovor: "Tega navigacijskega ukaza ne morem varno izvesti.",
        action: "explain",
        entity: {},
      });
      return;
    }
    if (result.action === "explain" && "courseClarificationDraft" in result) {
      const draft = (result as { courseClarificationDraft: CourseClarificationDraft }).courseClarificationDraft;
      const token = draft.kind === "batch"
        ? signCourseClarificationToken(draft.targets ? {
          enotaId, actorNatakarId, narociloId: draft.narociloId,
          assignments: draft.assignments, targets: draft.targets, selections: [],
          orderFingerprint: draft.orderFingerprint,
        } : {
          enotaId,
          actorNatakarId,
          narociloId: draft.narociloId,
          targetPostavkaId: draft.targetPostavkaId,
          assignments: draft.assignments,
          options: draft.options,
          orderFingerprint: draft.orderFingerprint,
        })
        : signCourseClarificationToken({
          enotaId,
          actorNatakarId,
          narociloId: draft.narociloId,
          postavkaId: draft.postavkaId,
          options: draft.options,
          orderFingerprint: draft.orderFingerprint,
        });
      await auditAgent(enotaId, device.id, actorNatakarId, "clarify_course", "pending", {
        narociloId: draft.narociloId,
        postavkaId: draft.kind === "batch" ? draft.targetPostavkaId : draft.postavkaId,
        batch: draft.kind === "batch",
        courseNumbers: draft.options.map(option => option.courseNumber),
      });
      res.json({
        action: "explain",
        odgovor: result.odgovor,
        clarifications: draft.options.map(option => `${option.courseName} (${option.courseNumber})`),
        ...(token ? { courseClarification: { token, options: draft.options } } : {}),
      });
      return;
    }
    if (result.action === "assign_course") {
      try {
        const assigned = continuationPayload?.v === 1
          ? await consumeCourseClarificationAssignment({
            payload: continuationPayload,
            result,
            enotaId,
            actorNatakarId,
            napravaId: device.id,
          })
          : await assignKdsCourse({
            narociloId: result.narociloId,
            enotaId,
            postavkaId: result.postavkaId,
            courseNumber: result.courseNumber,
          });
        const courseNameSnapshot = await loadOrderCourseNameForAudit(
          result.narociloId, enotaId, result.courseNumber,
        );
        await auditAgent(enotaId, device.id, actorNatakarId, result.action, "success", {
          postavkaId: result.postavkaId, courseNumber: result.courseNumber,
          courseNameSnapshot, pairingGroupId: assigned.pairingGroupId,
        });
        if (assigned.changed) {
          broadcastToUnit(enotaId, "update", { type: "kds" });
          broadcastToUnit(enotaId, "update", { type: "narocilo", id: result.narociloId });
        }
        res.json({
          ...result,
          pairingGroupId: assigned.pairingGroupId,
          changed: assigned.changed,
          odgovor: assigned.changed
            ? `Postavka je dodeljena hodu ${result.courseNumber}.`
            : `Postavka je že dodeljena hodu ${result.courseNumber}.`,
        });
      } catch (error) {
        if (error instanceof KdsCourseAssignmentConflict) {
          const courseNameSnapshot = await loadOrderCourseNameForAudit(
            result.narociloId, enotaId, result.courseNumber,
          );
          await auditAgent(enotaId, device.id, actorNatakarId, result.action, "conflict", {
            postavkaId: result.postavkaId, courseNumber: result.courseNumber, courseNameSnapshot,
          });
          res.status(409).json({ napaka: error.message, code: "KDS_COURSE_REASSIGNMENT_CONFLICT" });
          return;
        }
        throw error;
      }
      return;
    }
    if (result.action === "assign_courses") {
      try {
        // Only numeric IDs, courses, and generated pairing groups are retained
        // in audit metadata; spoken/course-reference text never reaches KDS.
        const assigned = continuationPayload && continuationPayload.v !== 1
          ? await consumeBatchCourseClarificationAssignments({
            payload: continuationPayload,
            result,
            enotaId,
            actorNatakarId,
            napravaId: device.id,
          })
          : await assignKdsCourses({
            narociloId: result.narociloId,
            enotaId,
            assignments: result.assignments.map(({ postavkaId, courseNumber }) => ({ postavkaId, courseNumber })),
          });
        const courseNames = await Promise.all([...new Set(
          result.assignments.map(assignment => assignment.courseNumber),
        )].map(async courseNumber => [
          courseNumber,
          await loadOrderCourseNameForAudit(result.narociloId, enotaId, courseNumber),
        ] as const));
        const courseNameByNumber = new Map(courseNames);
        await auditAgent(enotaId, device.id, actorNatakarId, result.action, "success", {
          assignments: assigned.assignments.map(assignment => ({
            postavkaId: assignment.postavkaId,
            courseNumber: assignment.courseNumber,
            courseNameSnapshot: courseNameByNumber.get(assignment.courseNumber) ?? null,
            pairingGroupId: assignment.pairingGroupId,
          })),
        });
        if (assigned.changed) {
          broadcastToUnit(enotaId, "update", { type: "kds" });
          broadcastToUnit(enotaId, "update", { type: "narocilo", id: result.narociloId });
        }
        const names = new Map(result.assignments.map(assignment => [
          `${assignment.postavkaId}:${assignment.courseNumber}`, assignment.naziv,
        ]));
        const assignmentOutcomes = assigned.assignments.map(assignment => ({
          ...assignment,
          naziv: names.get(`${assignment.postavkaId}:${assignment.courseNumber}`),
        }));
        res.json({
          ...result,
          changed: assigned.changed,
          assignmentOutcomes,
          odgovor: `Dodelitve hodov: ${assignmentOutcomes.map(assignment =>
            `${assignment.naziv ?? `postavka ${assignment.postavkaId}`} → hod ${assignment.courseNumber}`,
          ).join(", ")}.`,
        });
      } catch (error) {
        if (error instanceof KdsCourseAssignmentConflict) {
          await auditAgent(enotaId, device.id, actorNatakarId, result.action, "conflict", {
            assignments: result.assignments.map(({ postavkaId, courseNumber }) => ({ postavkaId, courseNumber })),
          });
          res.status(409).json({ napaka: error.message, code: "KDS_COURSE_REASSIGNMENT_CONFLICT" });
          return;
        }
        throw error;
      }
      return;
    }
    await auditAgent(enotaId, device.id, actorNatakarId, result.action, "success", {
      commandShape: describeAgentCommandShape(body.data.ukaz),
    });
    res.json(result);
  } catch (error) {
    req.log.error({ err: error }, "POS AI agent ni uspel");
    await auditAgent(enotaId, device.id, actorNatakarId, "agent", "rejected", { reason: error instanceof Error ? error.message.slice(0, 80) : "unknown" });
    res.status(422).json({ napaka: "Ukaza ni bilo mogoče varno izvesti." });
  }
});

router.get("/ai/agent/history", async (req: Request, res: Response): Promise<void> => {
  const enotaId = (req as Request & { enotaId?: number }).enotaId;
  if (!enotaId || !(await getEnabledAiDevice(req, enotaId))) { res.status(403).json({ napaka: "AI agent na tej napravi ni omogočen." }); return; }
  const actorNatakarId = (req as Request & { posActorNatakarId?: number }).posActorNatakarId;
  if (!actorNatakarId) { res.status(401).json({ napaka: "Za AI agenta je potrebna veljavna POS actor seja." }); return; }
  const history = await db.select().from(posAiAgentAuditTable).where(and(eq(posAiAgentAuditTable.enotaId, enotaId), eq(posAiAgentAuditTable.actorNatakarId, actorNatakarId)))
    .orderBy(desc(posAiAgentAuditTable.createdAt)).limit(100);
  const memory = await db.select().from(posAiAgentMemoryTable).where(and(eq(posAiAgentMemoryTable.enotaId, enotaId), eq(posAiAgentMemoryTable.actorNatakarId, actorNatakarId)));
  res.json({ history, memory });
});

router.delete("/ai/agent/memory", async (req: Request, res: Response): Promise<void> => {
  const enotaId = (req as Request & { enotaId?: number }).enotaId;
  const device = enotaId ? await getEnabledAiDevice(req, enotaId) : null;
  if (!enotaId || !device) { res.status(403).json({ napaka: "AI agent na tej napravi ni omogočen." }); return; }
  const actorNatakarId = (req as Request & { posActorNatakarId?: number }).posActorNatakarId;
  if (!actorNatakarId) { res.status(401).json({ napaka: "Za AI agenta je potrebna veljavna POS actor seja." }); return; }
  await db.delete(posAiAgentMemoryTable).where(and(eq(posAiAgentMemoryTable.enotaId, enotaId), eq(posAiAgentMemoryTable.actorNatakarId, actorNatakarId)));
  await auditAgent(enotaId, device.id, actorNatakarId, "reset_memory", "success", {});
  res.status(204).send();
});

export default router;