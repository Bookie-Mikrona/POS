import { Router, type IRouter } from "express";
import { preberiVivaPoverilnicePodjetja } from "../../lib/viva-company-credentials";
import multer from "multer";
import { ObjectStorageService } from "../../lib/objectStorage";
import { REFUND_EVIDENCE_MAX_BYTES, REFUND_EVIDENCE_MIMES, validateRefundEvidence, refundEvidenceHash } from "../../lib/refundEvidence";
import { vivaVraciloDokazilaTable } from "@workspace/db";
import { createHash, randomBytes, randomUUID } from "crypto";
import { eq, and, count, desc, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { posljiNaTerminal, testTerminalPovezave } from "../../lib/pos-payten";
import { ustvariCheckout, posredujNaTerminal, preveriCheckout } from "../../lib/pos-sumup";
import { ustvariNarocilo, preveriStatus as preveriVivaStatus, smartCheckoutUrl, posljiNaTerminal as posljiNaVivaTerminal, preveriVivaTerminalSessionStatus, preveriVivaTransakcijo, pripraviVivaPovezavo, stornirajVivaTerminal } from "../../lib/pos-viva";
import { db, darilniBonIzdajeTable, vivaVracilaTable, vivaVraciloStatusPrehodiTable, racuniTable, napraveTable, enoteTable, narocilaTable, posKarticnaPlacilaAttemptTable, racunIzdajaZahteveTable } from "@workspace/db";
import { requireSpecificUnitCapability } from "../../middlewares/pos";
import type { PosRequest } from "../../middlewares/pos";
import { writePosActorAudit } from "../../lib/posActorAudit";
import { readAll, toResponse } from "./nastavitve";
import {
  createCardPaymentAmountEvidence,
  parseCardPaymentAmountEvidence,
  verifyCardProviderAmounts,
  type CardPaymentAmountEvidence,
} from "../../lib/pos-payment-validation";
import { exactDecimalCents, parsePaytenBridgePublicKey, verifyPaytenBridgeEnvelope } from "../../lib/payten-bridge";
import { readRefundAlertSettings, refundAgeState } from "../../lib/vivaRefundAlerts";
import { GetVivaRefundAlertOverviewResponse, UpdateVivaRefundAlertSettingsBody } from "@workspace/api-zod";
import { pool } from "@workspace/db";

interface DeviceTerminalConfig {
  terminalAktiven: boolean;
  terminalIp: string;
  terminalPort: number;
  terminalTimeoutMs: number;
  paytenAndroidAktiven: boolean;
  paytenAndroidPackageName: string;
  paytenBridgeKeyId?: string;
  paytenBridgePublicKey?: string;
  sumupAktiven: boolean;
  sumupTerminalSerial: string;
  sumupApiKey: string;
  vivaAktiven: boolean;
  vivaClientId: string;
  vivaClientSecret: string;
  vivaSourceCode: string;
  vivaDemoNacin: boolean;
  vivaTerminalAktiven: boolean;
  vivaTerminalId: string;
  vivaAndroidTerminalAktiven: boolean;
  vivaAndroidSourceCode: string;
  vivaTapToPayAktiven: boolean;
  vivaTapToPaySourceCode: string;
}

const TC_EMPTY: DeviceTerminalConfig = {
  terminalAktiven: false,
  terminalIp: "192.168.1.100",
  terminalPort: 9000,
  terminalTimeoutMs: 30000,
  paytenAndroidAktiven: false,
  paytenAndroidPackageName: "com.payten.mpos",
  sumupAktiven: false,
  sumupTerminalSerial: "",
  sumupApiKey: "",
  vivaAktiven: false,
  vivaClientId: "",
  vivaClientSecret: "",
  vivaSourceCode: "",
  vivaDemoNacin: false,
  vivaTerminalAktiven: false,
  vivaTerminalId: "",
  vivaAndroidTerminalAktiven: false,
  vivaAndroidSourceCode: "",
  vivaTapToPayAktiven: false,
  vivaTapToPaySourceCode: "",
};

const DEVICE_KEY_REQUIRED_MESSAGE = "Manjka identifikator naprave (X-Naprava-Id). Osvežite stran in poskusite znova.";
type CardPaymentProvider = "payten" | "sumup" | "viva_smart" | "viva_terminal" | "simulacija";
type CardPaymentPurpose = "receipt" | "gift_voucher";
export type CanonicalCardAttemptStatus = "reserved" | "pending" | "completed" | "failed" | "unknown";

/** Native Bridge cannot safely relaunch any durable non-created attempt. */
export function paytenBridgeReservationDecision(created: boolean, status: CanonicalCardAttemptStatus) {
  if (created) return "launch" as const;
  if (status === "completed") return "completed" as const;
  return "reconcile" as const;
}

export function mayEnrollPaytenBridge(role: string | undefined): boolean {
  return role === "admin" || role === "admin_enote";
}

/** Maps provider protocol state to the only lifecycle values receipts may consume. */
export function canonicalCardAttemptStatus(
  provider: CardPaymentProvider,
  providerStatus: string | null | undefined,
): CanonicalCardAttemptStatus {
  const status = providerStatus?.trim().toUpperCase() ?? "";
  if (provider === "simulacija") return status === "COMPLETED" ? "completed" : "failed";
  if (provider === "payten") return status === "ODOBREN" ? "completed"
    : status === "NAPAKA" ? "unknown" : status ? "failed" : "unknown";
  if (["PAID", "COMPLETED", "SUCCESS", "F"].includes(status)) return "completed";
  if (["FAILED", "CANCELLED", "CANCELED", "DECLINED"].includes(status)) return "failed";
  if (["PENDING", "PROCESSING", "RESERVED"].includes(status)) return "pending";
  return "unknown";
}

export async function persistUnavailableCardStatusCheck(
  persist: (values: { status: "unknown"; providerRawStatus: "STATUS_CHECK_UNAVAILABLE"; napaka: string }) => Promise<void>,
): Promise<void> {
  await persist({
    status: "unknown",
    providerRawStatus: "STATUS_CHECK_UNAVAILABLE",
    napaka: "Preverjanje statusa ponudnika ni dosegljivo; izid plačila ni znan.",
  });
}

function exactEuroCents(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const cents = Math.round(value * 100);
  return Math.abs(value * 100 - cents) < 1e-8 ? cents : null;
}

export function unconsumedCompletedAttemptPredicate() {
  return sql`NOT EXISTS (
      SELECT 1
      FROM pos_racun_izdaja_zahteve AS izdaja_zahteva
      WHERE izdaja_zahteva.card_payment_attempt_id = ${posKarticnaPlacilaAttemptTable.id}
    )
    AND NOT EXISTS (
      SELECT 1
      FROM racuni AS izdani_racun
      WHERE izdani_racun.card_payment_attempt_id = ${posKarticnaPlacilaAttemptTable.id}
    )
    AND NOT EXISTS (
      SELECT 1
      FROM darilni_bon_izdaje AS izdaja_bona
      WHERE izdaja_bona.card_payment_attempt_id = ${posKarticnaPlacilaAttemptTable.id}
    )`;
}

function publicCardAttemptConflictMessage(err: unknown): string {
  if (err instanceof Error && (
    err.message.startsWith("Idempotency ključ je že uporabljen")
    || err.message.startsWith("Za to naročilo že obstaja")
  )) {
    return err.message;
  }
  return "Plačilnega poskusa trenutno ni bilo mogoče varno rezervirati. Plačilo ni bilo začeto.";
}

function getPaymentAttemptKey(req: { body: unknown; headers: Record<string, string | string[] | undefined> }): string | null {
  const body = req.body as { paymentAttemptId?: unknown; idempotencyKey?: unknown };
  const header = req.headers["idempotency-key"];
  const key = typeof body.paymentAttemptId === "string" ? body.paymentAttemptId
    : typeof body.idempotencyKey === "string" ? body.idempotencyKey
      : typeof header === "string" ? header : null;
  const normalized = key?.trim() ?? "";
  return /^[A-Za-z0-9_-]{16,128}$/.test(normalized) ? normalized : null;
}

async function reserveCardPaymentAttempt(
  companyId: string,
  enotaId: number,
  idempotencyKey: string,
  provider: CardPaymentProvider,
  narociloId: number | undefined,
  znesek: number,
  purpose: CardPaymentPurpose = "receipt",
  actor?: string,
  deviceKey?: string,
) {
  return db.transaction(async tx => {
    // One advisory lock covers every provider for the immutable receipt
    // binding. This prevents parallel provider starts from both observing no
    // equivalent attempt and charging the customer twice.
    const binding = `${companyId}:${enotaId}:${purpose}:${narociloId ?? "none"}:${znesek.toFixed(2)}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${binding}, 0))`);
  // The client key is the primary identity. Never let an equivalent payment
  // override immutable data attached to that key.
  const exact = await tx.query.posKarticnaPlacilaAttemptTable.findFirst({
    where: and(
      eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
      eq(posKarticnaPlacilaAttemptTable.enotaId, enotaId),
      eq(posKarticnaPlacilaAttemptTable.idempotencyKey, idempotencyKey),
    ),
  });
  if (exact) {
    if (
      exact.provider !== provider
      || exact.purpose !== purpose
      || exact.narociloId !== (narociloId ?? null)
      || Number(exact.znesek) !== Number(znesek.toFixed(2))
    ) {
      throw new Error("Idempotency ključ je že uporabljen za drugo kartično plačilo.");
    }
    return { attempt: exact, created: false };
  }

  // A different POS device may have a different configured provider. Never
  // allow that to turn a delayed recovery lookup into a second charge.
  const otherProviderAttempt = purpose === "receipt"
    ? await tx.query.posKarticnaPlacilaAttemptTable.findFirst({
      where: and(
        eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
        eq(posKarticnaPlacilaAttemptTable.enotaId, enotaId),
        ne(posKarticnaPlacilaAttemptTable.provider, provider),
        eq(posKarticnaPlacilaAttemptTable.purpose, "receipt"),
        narociloId == null
          ? isNull(posKarticnaPlacilaAttemptTable.narociloId)
          : eq(posKarticnaPlacilaAttemptTable.narociloId, narociloId),
        eq(posKarticnaPlacilaAttemptTable.znesek, znesek.toFixed(2)),
        or(
          inArray(posKarticnaPlacilaAttemptTable.status, ["reserved", "pending", "unknown"]),
          and(
            eq(posKarticnaPlacilaAttemptTable.status, "completed"),
            unconsumedCompletedAttemptPredicate(),
          ),
        ),
      ),
      orderBy: [desc(posKarticnaPlacilaAttemptTable.posodobljeno)],
    })
    : undefined;
  if (otherProviderAttempt) {
    throw new Error(
      otherProviderAttempt.status === "completed"
        ? "Za to naročilo že obstaja potrjeno neporabljeno kartično plačilo. Izberite obnovitev in ne bremenite kartice znova."
        : "Za to naročilo že obstaja nerešen kartični poskus pri drugem ponudniku. Pred novim plačilom ga ročno uskladite.",
    );
  }

  // Receipt recovery deliberately supports an equivalent charge after a
  // browser reload. Gift sales never inherit a different issuance key.
  const completed = purpose === "receipt" ? await tx.query.posKarticnaPlacilaAttemptTable.findFirst({
    where: and(
      eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
      eq(posKarticnaPlacilaAttemptTable.enotaId, enotaId),
      eq(posKarticnaPlacilaAttemptTable.provider, provider),
      eq(posKarticnaPlacilaAttemptTable.purpose, "receipt"),
      narociloId == null
        ? isNull(posKarticnaPlacilaAttemptTable.narociloId)
        : eq(posKarticnaPlacilaAttemptTable.narociloId, narociloId),
      eq(posKarticnaPlacilaAttemptTable.znesek, znesek.toFixed(2)),
      eq(posKarticnaPlacilaAttemptTable.status, "completed"),
      unconsumedCompletedAttemptPredicate(),
    ),
    orderBy: [desc(posKarticnaPlacilaAttemptTable.posodobljeno)],
  }) : undefined;
  if (completed) return { attempt: completed, created: false };

  const [created] = await tx.insert(posKarticnaPlacilaAttemptTable).values({
    companyId, enotaId, idempotencyKey, provider, purpose, narociloId, znesek: znesek.toFixed(2),
    actor: actor ?? null, deviceKey: deviceKey ?? null,
  }).onConflictDoNothing().returning();
  if (created) return { attempt: created, created: true };

  const attempt = await tx.query.posKarticnaPlacilaAttemptTable.findFirst({
    where: and(
      eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
      eq(posKarticnaPlacilaAttemptTable.enotaId, enotaId),
      eq(posKarticnaPlacilaAttemptTable.idempotencyKey, idempotencyKey),
    ),
  });
  if (attempt) {
    if (attempt.provider !== provider || attempt.purpose !== purpose || attempt.narociloId !== (narociloId ?? null) || Number(attempt.znesek) !== Number(znesek.toFixed(2))) {
      throw new Error("Idempotency ključ je že uporabljen za drugo kartično plačilo.");
    }
    return { attempt, created: false };
  }
  if (purpose === "gift_voucher") return null;

  // A reload can have a new client key.  Never send a second request while a
  // charge for the same provider/order/amount is unresolved; a completed
  // payment is likewise replayed for issuing its receipt.
  const equivalent = await tx.query.posKarticnaPlacilaAttemptTable.findFirst({
    where: and(
      eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
      eq(posKarticnaPlacilaAttemptTable.enotaId, enotaId),
      eq(posKarticnaPlacilaAttemptTable.provider, provider),
      eq(posKarticnaPlacilaAttemptTable.purpose, "receipt"),
      narociloId == null
        ? isNull(posKarticnaPlacilaAttemptTable.narociloId)
        : eq(posKarticnaPlacilaAttemptTable.narociloId, narociloId),
      eq(posKarticnaPlacilaAttemptTable.znesek, znesek.toFixed(2)),
      inArray(posKarticnaPlacilaAttemptTable.status, ["reserved", "pending", "unknown", "completed"]),
      or(
        ne(posKarticnaPlacilaAttemptTable.status, "completed"),
        unconsumedCompletedAttemptPredicate(),
      ),
    ),
    orderBy: [desc(posKarticnaPlacilaAttemptTable.posodobljeno)],
  });
  if (!equivalent) return null; // a concurrent transaction has not committed yet
  return { attempt: equivalent, created: false };
  });
}

async function setCardPaymentAttempt(
  id: string,
  values: { providerReferenca?: string; providerRawStatus?: string | null; status?: CanonicalCardAttemptStatus; napaka?: string | null; rezultatJson?: string | null },
): Promise<void> {
  await db.update(posKarticnaPlacilaAttemptTable)
    .set({ ...values, posodobljeno: new Date() })
    .where(and(
      eq(posKarticnaPlacilaAttemptTable.id, id),
      ne(posKarticnaPlacilaAttemptTable.status, "completed"),
    ));
}

async function setCardPaymentAttemptStatus(
  companyId: string, enotaId: number, provider: CardPaymentProvider, providerReferenca: string,
  providerRawStatus: string,
): Promise<void> {
  await db.update(posKarticnaPlacilaAttemptTable).set({
    status: canonicalCardAttemptStatus(provider, providerRawStatus),
    providerRawStatus,
    posodobljeno: new Date(),
  }).where(and(
    eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
    eq(posKarticnaPlacilaAttemptTable.enotaId, enotaId),
    eq(posKarticnaPlacilaAttemptTable.provider, provider),
    eq(posKarticnaPlacilaAttemptTable.providerReferenca, providerReferenca),
    ne(posKarticnaPlacilaAttemptTable.status, "completed"),
  ));
}

async function markCardStatusCheckUnavailable(
  companyId: string,
  enotaId: number,
  provider: CardPaymentProvider,
  providerReference: string,
): Promise<void> {
  await persistUnavailableCardStatusCheck(async values => {
    await db.update(posKarticnaPlacilaAttemptTable).set({
      ...values, posodobljeno: new Date(),
    }).where(and(
      eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
      eq(posKarticnaPlacilaAttemptTable.enotaId, enotaId),
      eq(posKarticnaPlacilaAttemptTable.provider, provider),
      eq(posKarticnaPlacilaAttemptTable.providerReferenca, providerReference),
      ne(posKarticnaPlacilaAttemptTable.status, "completed"),
    ));
  });
}

function requestedCardAmountEvidence(
  body: { znesekNapitninaKartica?: unknown },
  requestedCardTotalEur: number,
): ReturnType<typeof createCardPaymentAmountEvidence> {
  const rawTip = body.znesekNapitninaKartica;
  const expectedCardTipEur = rawTip == null ? 0 : Number(rawTip);
  return createCardPaymentAmountEvidence(requestedCardTotalEur, expectedCardTipEur);
}

function amountEvidenceJson(
  evidence: CardPaymentAmountEvidence,
  providerResult?: Record<string, unknown>,
): string {
  return JSON.stringify({ ...(providerResult ?? {}), amountEvidence: evidence });
}

function canonicalPaytenProviderReference(
  companyId: string,
  enotaId: number,
  deviceKey: string | undefined,
  rawReference: string | undefined,
  paymentAttemptId: string,
): string {
  const terminalScopedReference = rawReference?.trim()
    ? `${companyId}:${enotaId}:${deviceKey ?? "unknown-device"}:${rawReference.trim()}`
    : `${companyId}:${enotaId}:${deviceKey ?? "unknown-device"}:attempt:${paymentAttemptId}`;
  return `payten:${createHash("sha256").update(terminalScopedReference).digest("hex")}`;
}

function paytenBridgeEcr(attemptId: string): string {
  // Native bridge contract: deterministic, non-secret eight-digit ECR identity.
  return String(parseInt(createHash("sha256").update(attemptId).digest("hex").slice(0, 8), 16) % 100_000_000).padStart(8, "0");
}

function existingAmountEvidence(
  attempt: { rezultatJson: string | null; znesek: string },
): CardPaymentAmountEvidence | null {
  const persisted = parseCardPaymentAmountEvidence(attempt.rezultatJson);
  if (persisted) return persisted;
  const legacy = createCardPaymentAmountEvidence(Number(attempt.znesek), 0);
  return legacy.ok ? legacy.evidence : null;
}

async function getDeviceTerminalConfig(
  tenotaId: number,
  napravaKljuc: string | undefined
): Promise<DeviceTerminalConfig> {
  if (!napravaKljuc) return { ...TC_EMPTY };
  const [naprava] = await db.select({ nastavitveJson: napraveTable.nastavitveJson })
    .from(napraveTable)
    .where(and(
      eq(napraveTable.enotaId, tenotaId),
      eq(napraveTable.napravaKljuc, napravaKljuc)
    ));
  if (!naprava) return { ...TC_EMPTY };

  let raw: Record<string, unknown> = {};
  try {
    raw = naprava.nastavitveJson
      ? JSON.parse(naprava.nastavitveJson) as Record<string, unknown>
      : {};
  } catch {
    raw = {};
  }

  // Viva API poverilnice so lastnost trgovskega računa podjetja, ne posamezne
  // blagajne. Zaradi združljivosti jih še vedno lahko vnese skrbnik na eni
  // napravi; vse ostale naprave istega podjetja jih nato podedujejo. Poizvedba
  // je strogo omejena na companyId, zato se najemniki nikoli ne premešajo.
  {
    const [enota] = await db.select({ companyId: enoteTable.companyId })
      .from(enoteTable)
      .where(eq(enoteTable.id, tenotaId));
    if (!enota) return { ...TC_EMPTY };
    // Poverilnice na ravni podjetja imajo prednost pred starimi kopijami na napravah.
    const podjetje = await preberiVivaPoverilnicePodjetja(enota.companyId);
    if (podjetje) {
      raw.vivaClientId = podjetje.clientId;
      raw.vivaClientSecret = podjetje.clientSecret;
      raw.vivaDemoNacin = podjetje.demoNacin;
    }
  }
  if (!String(raw.vivaClientId ?? "").trim() || !String(raw.vivaClientSecret ?? "").trim()) {
    const [enota] = await db.select({ companyId: enoteTable.companyId })
      .from(enoteTable)
      .where(eq(enoteTable.id, tenotaId));
    if (!enota) return { ...TC_EMPTY };
    const companyDevices = await db.select({ nastavitveJson: napraveTable.nastavitveJson })
      .from(napraveTable)
      .innerJoin(enoteTable, eq(enoteTable.id, napraveTable.enotaId))
      .where(eq(enoteTable.companyId, enota.companyId));
    for (const candidate of companyDevices) {
      if (!candidate.nastavitveJson) continue;
      try {
        const shared = JSON.parse(candidate.nastavitveJson) as Record<string, unknown>;
        if (String(shared.vivaClientId ?? "").trim() && String(shared.vivaClientSecret ?? "").trim()) {
          raw.vivaClientId = shared.vivaClientId;
          raw.vivaClientSecret = shared.vivaClientSecret;
          raw.vivaDemoNacin = shared.vivaDemoNacin;
          break;
        }
      } catch {
        // Neveljavna konfiguracija ene naprave ne sme blokirati drugih.
      }
    }
  }

  try {
    return {
      terminalAktiven:            Boolean(raw.terminalAktiven ?? false),
      terminalIp:                 String(raw.terminalIp ?? "192.168.1.100"),
      terminalPort:               Number(raw.terminalPort ?? 9000),
      terminalTimeoutMs:          Number(raw.terminalTimeoutMs ?? 30000),
      paytenAndroidAktiven:       Boolean(raw.paytenAndroidAktiven ?? false),
      paytenAndroidPackageName:   String(raw.paytenAndroidPackageName ?? "com.payten.mpos"),
      paytenBridgeKeyId:          typeof raw.paytenBridgeKeyId === "string" ? raw.paytenBridgeKeyId : undefined,
      paytenBridgePublicKey:      typeof raw.paytenBridgePublicKey === "string" ? raw.paytenBridgePublicKey : undefined,
      sumupAktiven:               Boolean(raw.sumupAktiven ?? false),
      sumupTerminalSerial:        String(raw.sumupTerminalSerial ?? ""),
      sumupApiKey:                String(raw.sumupApiKey ?? ""),
      vivaAktiven:                Boolean(raw.vivaAktiven ?? false),
      vivaClientId:               String(raw.vivaClientId ?? ""),
      vivaClientSecret:           String(raw.vivaClientSecret ?? ""),
      vivaSourceCode:             String(raw.vivaSourceCode ?? ""),
      vivaDemoNacin:              Boolean(raw.vivaDemoNacin ?? false),
      vivaTerminalAktiven:        Boolean(raw.vivaTerminalAktiven ?? false),
      vivaTerminalId:             String(raw.vivaTerminalId ?? ""),
      vivaAndroidTerminalAktiven: Boolean(raw.vivaAndroidTerminalAktiven ?? false),
      vivaAndroidSourceCode:      String(raw.vivaAndroidSourceCode ?? ""),
      vivaTapToPayAktiven:        Boolean(raw.vivaTapToPayAktiven ?? false),
      vivaTapToPaySourceCode:     String(raw.vivaTapToPaySourceCode ?? ""),
    };
  } catch {
    return { ...TC_EMPTY };
  }
}

/**
 * Terminalska konfiguracija je vezana na konkretno POS napravo. V produkciji
 * jo frontend pošlje v X-Naprava-Id; testi in obstoječi middleware jo lahko
 * že nastavijo neposredno na request.
 */
function getRequestDeviceKey(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const contextualKey = (req as any).napravaKljuc;
  if (typeof contextualKey === "string" && contextualKey) return contextualKey;

  const headerKey = req.headers["x-naprava-id"];
  return typeof headerKey === "string" && headerKey ? headerKey : undefined;
}

const router: IRouter = Router();

function recoveryAttemptConditions(companyId: string, enotaId: number, narociloId: number, amountCents: number) {
  return and(
    eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
    eq(posKarticnaPlacilaAttemptTable.enotaId, enotaId),
    eq(posKarticnaPlacilaAttemptTable.purpose, "receipt"),
    eq(posKarticnaPlacilaAttemptTable.narociloId, narociloId),
    eq(posKarticnaPlacilaAttemptTable.znesek, (amountCents / 100).toFixed(2)),
    eq(posKarticnaPlacilaAttemptTable.status, "completed"),
    unconsumedCompletedAttemptPredicate(),
  );
}

function recoveryRequestBinding(req: { query: Record<string, unknown> }) {
  const narociloId = Number(req.query.narociloId);
  const amountCents = exactEuroCents(Number(req.query.znesek));
  return Number.isInteger(narociloId) && narociloId > 0 && amountCents !== null
    ? { narociloId, amountCents }
    : null;
}

// This deliberately returns only attempts that could be consumed right now.
// Provider references and raw responses are never exposed to the browser.
router.get("/terminal/card-payment-attempts/recovery", async (req, res): Promise<void> => {
  const companyId = (req as any).companyId as string;
  const enotaId = Number((req as any).enotaId);
  const binding = recoveryRequestBinding(req);
  if (!companyId || !Number.isInteger(enotaId) || !binding) {
    res.status(400).json({ error: "Manjkajo veljavni podatki za obnovitev kartičnega plačila." });
    return;
  }
  const attempts = await db.select({
    attemptId: posKarticnaPlacilaAttemptTable.id,
    paymentAttemptId: posKarticnaPlacilaAttemptTable.idempotencyKey,
    provider: posKarticnaPlacilaAttemptTable.provider,
    znesek: posKarticnaPlacilaAttemptTable.znesek,
    ustvarjeno: posKarticnaPlacilaAttemptTable.ustvarjeno,
  }).from(posKarticnaPlacilaAttemptTable)
    .where(recoveryAttemptConditions(companyId, enotaId, binding.narociloId, binding.amountCents))
    .orderBy(desc(posKarticnaPlacilaAttemptTable.posodobljeno));
  res.json({ attempts: attempts.map(attempt => ({ ...attempt, znesek: Number(attempt.znesek) })) });
});

// Selection is explicit so an operator cannot accidentally consume an old
// completed charge just by arriving at Checkout. The receipt route independently
// revalidates and binds the selected durable attempt before it issues anything.
router.post("/terminal/card-payment-attempts/:paymentAttemptId/recovery/select", async (req, res): Promise<void> => {
  const posReq = req as unknown as PosRequest;
  const companyId = posReq.companyId;
  const enotaId = posReq.enotaId;
  const paymentAttemptId = String(req.params.paymentAttemptId ?? "").trim();
  const narociloId = Number(req.body?.narociloId);
  const amountCents = exactEuroCents(Number(req.body?.znesek));
  if (!companyId || !/^[A-Za-z0-9_-]{16,128}$/.test(paymentAttemptId)
    || !Number.isInteger(enotaId) || !Number.isInteger(narociloId) || narociloId < 1 || amountCents === null) {
    res.status(400).json({ error: "Manjkajo veljavni podatki za izbiro obnovitve." });
    return;
  }
  const [attempt] = await db.select({
    id: posKarticnaPlacilaAttemptTable.id,
    idempotencyKey: posKarticnaPlacilaAttemptTable.idempotencyKey,
    provider: posKarticnaPlacilaAttemptTable.provider,
  }).from(posKarticnaPlacilaAttemptTable).where(and(
    recoveryAttemptConditions(companyId, enotaId, narociloId, amountCents),
    or(eq(posKarticnaPlacilaAttemptTable.id, paymentAttemptId), eq(posKarticnaPlacilaAttemptTable.idempotencyKey, paymentAttemptId)),
  )).limit(1);
  if (!attempt) {
    res.status(409).json({ error: "Izbrano kartično plačilo ni več na voljo za varno obnovitev." });
    return;
  }
  const selectionToken = randomBytes(32).toString("base64url");
  const selectionTokenHash = createHash("sha256").update(selectionToken).digest("hex");
  const selectionExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  await writePosActorAudit(query => db.execute(query), {
    enotaId,
    natakarId: posReq.posActorNatakarId ?? null,
    actorClerkUserId: posReq.clerkUserId,
    action: "card_payment_recovery_selected",
    metadata: {
      attemptId: attempt.id, orderId: narociloId, amountCents, provider: attempt.provider,
      deviceKey: getRequestDeviceKey(req) ?? null, selectionTokenHash, selectionExpiresAt,
    },
  });
  res.json({ paymentAttemptId: attempt.idempotencyKey, attemptId: attempt.id, provider: attempt.provider, selectionToken });
});

router.get("/terminal/card-payment-attempts/:paymentAttemptId/recovery", async (req, res): Promise<void> => {
  const companyId = (req as any).companyId as string;
  const enotaId = Number((req as any).enotaId);
  const paymentAttemptId = String(req.params.paymentAttemptId ?? "").trim();
  const narociloId = Number(req.query.narociloId);
  const amountCents = exactEuroCents(Number(req.query.znesek));
  if (
    !/^[A-Za-z0-9_-]{16,128}$/.test(paymentAttemptId)
    || !Number.isInteger(narociloId)
    || narociloId <= 0
    || amountCents === null
  ) {
    res.status(400).json({ error: "Manjkajo veljavni podatki za preverjanje kartičnega plačila." });
    return;
  }

  const attempt = await db.query.posKarticnaPlacilaAttemptTable.findFirst({
    where: and(
      eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
      eq(posKarticnaPlacilaAttemptTable.enotaId, enotaId),
      or(
        eq(posKarticnaPlacilaAttemptTable.id, paymentAttemptId),
        eq(posKarticnaPlacilaAttemptTable.idempotencyKey, paymentAttemptId),
      ),
    ),
  });
  if (
    !attempt
    || attempt.purpose !== "receipt"
    || attempt.narociloId !== narociloId
    || Math.round(Number(attempt.znesek) * 100) !== amountCents
  ) {
    res.status(404).json({ error: "Ustreznega kartičnega plačila ni mogoče varno obnoviti." });
    return;
  }

  const [unconsumed] = attempt.status === "completed"
    ? await db.select({ id: posKarticnaPlacilaAttemptTable.id })
      .from(posKarticnaPlacilaAttemptTable)
      .where(and(
        eq(posKarticnaPlacilaAttemptTable.id, attempt.id),
        unconsumedCompletedAttemptPredicate(),
      ))
      .limit(1)
    : [];

  res.json({
    paymentAttemptId: attempt.idempotencyKey,
    attemptId: attempt.id,
    provider: attempt.provider,
    status: attempt.status,
    recoverable: attempt.status === "completed" && Boolean(unconsumed),
  });
});

/**
 * Development-only card provider.  It deliberately creates the same completed
 * durable attempt as a real provider; receipt issuing still goes through the
 * ordinary /racuni validation and fiscalisation path.
 */
router.post("/terminal/simulation/pay", requireSpecificUnitCapability("simulation"), async (req, res): Promise<void> => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Simulirano kartično plačilo v produkciji ni na voljo." });
    return;
  }
  const tenotaId = (req as any).enotaId as number;
  const companyId = (req as any).companyId as string | undefined;
  const body = req.body as { narociloId?: unknown; znesek?: unknown };
  const paymentAttemptId = getPaymentAttemptKey(req);
  const narociloId = Number(body.narociloId);
  const requestedAmount = Number(body.znesek);
  if (!companyId || !paymentAttemptId || !Number.isInteger(narociloId) || narociloId < 1 || exactEuroCents(requestedAmount) == null) {
    res.status(400).json({ error: "Potreben je veljaven paymentAttemptId, odprto naročilo in znesek v centih." });
    return;
  }

  // Do not inherit the middleware's superadmin bypass for this destructive
  // development facility: the selected unit itself must opt into simulation.
  const [unit] = await db.select({ capabilities: enoteTable.capabilities }).from(enoteTable)
    .where(and(eq(enoteTable.id, tenotaId), eq(enoteTable.companyId, companyId))).limit(1);
  if (!unit?.capabilities.includes("simulation")) {
    res.status(403).json({ error: "Simulacija plačil za aktivno poslovno enoto ni omogočena." });
    return;
  }
  const settings = toResponse(await readAll("", tenotaId));
  if (settings.fursNacin !== "simulacija") {
    res.status(403).json({ error: "Simulirano plačilo je dovoljeno samo v FURS simulacijskem načinu." });
    return;
  }
  const [order] = await db.select({
    id: narocilaTable.id, skupaj: narocilaTable.skupaj, znesekNapitnina: narocilaTable.znesekNapitnina,
  }).from(narocilaTable)
    .innerJoin(enoteTable, eq(enoteTable.id, narocilaTable.enotaId))
    .where(and(
      eq(narocilaTable.id, narociloId),
      eq(narocilaTable.enotaId, tenotaId),
      eq(narocilaTable.status, "odprto"),
      eq(enoteTable.companyId, companyId),
    )).limit(1);
  const amountCents = order
    ? Math.round((Number(order.skupaj) + Number(order.znesekNapitnina ?? 0)) * 100)
    : NaN;
  if (!order || !Number.isInteger(amountCents) || Math.round(requestedAmount * 100) !== amountCents) {
    res.status(409).json({ error: "Znesek ne ustreza odprtemu naročilu skupaj z QR napitnino." });
    return;
  }
  const znesek = amountCents / 100;
  try {
    const reservation = await db.transaction(async tx => {
      const existing = await tx.query.posKarticnaPlacilaAttemptTable.findFirst({
        where: and(
          eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
          eq(posKarticnaPlacilaAttemptTable.enotaId, tenotaId),
          eq(posKarticnaPlacilaAttemptTable.idempotencyKey, paymentAttemptId),
        ),
      });
      if (existing) {
        if (existing.provider !== "simulacija" || existing.narociloId !== narociloId || Number(existing.znesek) !== znesek) {
          throw new Error("Idempotency ključ je že uporabljen za drugo kartično plačilo.");
        }
        return existing;
      }
      const reference = `simulation:${companyId}:${tenotaId}:${paymentAttemptId}`;
      const [attempt] = await tx.insert(posKarticnaPlacilaAttemptTable).values({
        companyId, enotaId: tenotaId, narociloId, idempotencyKey: paymentAttemptId,
        provider: "simulacija", purpose: "receipt", znesek: znesek.toFixed(2),
        providerReferenca: reference, providerRawStatus: "COMPLETED", status: "completed",
        actor: (req as any).clerkUserId ?? null, deviceKey: getRequestDeviceKey(req) ?? null,
        rezultatJson: JSON.stringify({ status: "completed", paymentAttemptId, reference }),
      }).onConflictDoNothing().returning();
      if (attempt) return attempt;
      // A concurrent request may have won the idempotency index. Read back the
      // immutable record so retrying the same key is a true replay, not a
      // second simulated charge.
      const concurrent = await tx.query.posKarticnaPlacilaAttemptTable.findFirst({
        where: and(
          eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
          eq(posKarticnaPlacilaAttemptTable.enotaId, tenotaId),
          eq(posKarticnaPlacilaAttemptTable.idempotencyKey, paymentAttemptId),
        ),
      });
      if (!concurrent) throw new Error("Plačilnega poskusa trenutno ni bilo mogoče varno rezervirati.");
      if (concurrent.provider !== "simulacija" || concurrent.narociloId !== narociloId || Number(concurrent.znesek) !== znesek) {
        throw new Error("Idempotency ključ je že uporabljen za drugo kartično plačilo.");
      }
      return concurrent;
    });
    res.json({ status: "completed", paymentAttemptId, attemptId: reservation.id, reference: reservation.providerReferenca });
  } catch (err) {
    res.status(409).json({ error: publicCardAttemptConflictMessage(err) });
  }
});

// ── POST /terminal/pay — Payten TCP terminal ──────────────────────────────────
router.post("/terminal/pay", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const body = req.body as { znesek?: number; narociloId?: number; znesekNapitninaKartica?: number };

  const tc = await getDeviceTerminalConfig(tenotaId, (req as any).napravaKljuc);

  if (!tc.terminalAktiven) {
    res.status(400).json({ error: "Payten terminal ni aktiviran. Vklopite ga v nastavitvah naprave." });
    return;
  }

  const znesekCenti = Math.round((body.znesek ?? 0) * 100);
  const znesek = Number(body.znesek);
  const paymentAttemptId = getPaymentAttemptKey(req);
  const companyId = (req as any).companyId as string | undefined;
  const narociloId = Number.isInteger(body.narociloId) && body.narociloId! > 0 ? body.narociloId : undefined;
  if (!paymentAttemptId || !companyId || !narociloId || !Number.isFinite(znesek) || znesek <= 0) {
    res.status(400).json({ error: "Manjka veljaven paymentAttemptId, naročilo, podjetje ali znesek." });
    return;
  }
  const amountEvidence = requestedCardAmountEvidence(body, znesek);
  if (!amountEvidence.ok) {
    res.status(400).json({ error: amountEvidence.error });
    return;
  }

  let reservation;
  try {
    reservation = await reserveCardPaymentAttempt(
      companyId, tenotaId, paymentAttemptId, "payten", narociloId, znesek,
      "receipt", (req as any).clerkUserId, getRequestDeviceKey(req),
    );
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Idempotency konflikt." });
    return;
  }
  if (!reservation) {
    res.status(503).json({ error: "Kartično plačilo se že rezervira; ponovite isti paymentAttemptId." });
    return;
  }
  if (!reservation.created) {
    if (reservation.attempt.rezultatJson) {
      res.json(JSON.parse(reservation.attempt.rezultatJson));
    } else {
      res.status(202).json({
        status: "napaka",
        paymentAttemptId,
        recoveryRequired: true,
        napaka: "Izid Payten plačila ni znan. Ne sprožite novega plačila; preverite terminal.",
      });
    }
    return;
  }

  try {
    await setCardPaymentAttempt(reservation.attempt.id, {
      rezultatJson: amountEvidenceJson(amountEvidence.evidence),
    });
    const odgovor = await posljiNaTerminal(
      { ip: tc.terminalIp, port: tc.terminalPort, timeoutMs: tc.terminalTimeoutMs },
      { znesek: znesekCenti, valuta: "978", referencnaStev: paymentAttemptId }
    );
    const providerAmounts = verifyCardProviderAmounts({
      evidence: amountEvidence.evidence,
      providerTotalCents: Number.isInteger(odgovor.znesek) ? odgovor.znesek! : null,
    });
    const responseBody = {
      status: odgovor.status,
      avtorizacijskaKoda: odgovor.avtorizacijskaKoda ?? null,
      referenca: odgovor.referenca ?? null,
      kartica: odgovor.kartica ?? null,
      maskiranPan: odgovor.maskiranPan ?? null,
      znesek: odgovor.znesek ?? null,
      surovOdgovor: odgovor.surovOdgovor,
      napaka: odgovor.napaka ?? null,
      paymentAttemptId,
      cardTotalCents: providerAmounts.ok ? providerAmounts.evidence.providerTotalCents : null,
      tipCents: providerAmounts.ok ? providerAmounts.evidence.expectedCardTipCents : null,
    };
    const providerReference = canonicalPaytenProviderReference(
      companyId,
      tenotaId,
      getRequestDeviceKey(req),
      odgovor.referenca,
      paymentAttemptId,
    );
    await setCardPaymentAttempt(reservation.attempt.id, {
      providerReferenca: providerReference,
      status: odgovor.status === "odobren" && providerAmounts.ok
        ? "completed"
        : odgovor.status === "odobren"
          ? "unknown"
          : canonicalCardAttemptStatus("payten", odgovor.status),
      providerRawStatus: odgovor.status,
      napaka: odgovor.napaka ?? (providerAmounts.ok ? null : providerAmounts.error),
      rezultatJson: amountEvidenceJson(
        providerAmounts.ok ? providerAmounts.evidence : amountEvidence.evidence,
        responseBody,
      ),
    });
    res.status(odgovor.status === "odobren" && !providerAmounts.ok ? 409 : 200).json({
      ...responseBody,
      status: odgovor.status === "odobren" && !providerAmounts.ok ? "napaka" : odgovor.status,
      napaka: odgovor.napaka ?? (providerAmounts.ok ? null : providerAmounts.error),
    });
  } catch (err) {
    await setCardPaymentAttempt(reservation.attempt.id, {
      status: "unknown",
      napaka: err instanceof Error ? err.message : "Payten napaka",
    }).catch(() => {});
    throw err;
  }
});

// Android Payten is launched by the POS device, but the charge intent must be
// reserved on the server first. The currently supported bridge has no merchant
// status-verification API, therefore an app callback can never complete it.
router.post("/terminal/payten/android/bridge", async (req, res): Promise<void> => {
  const posReq = req as unknown as PosRequest;
  const enotaId = Number(posReq.enotaId);
  if (!mayEnrollPaytenBridge(posReq.vloga)) {
    res.status(403).json({ error: "Samo skrbnik poslovne enote lahko spari Payten Bridge." }); return;
  }
  const deviceKey = getRequestDeviceKey(req);
  const enrolled = parsePaytenBridgePublicKey(req.body?.keyId, req.body?.publicKeyBase64Url);
  if (!Number.isInteger(enotaId) || !deviceKey || !enrolled) {
    res.status(400).json({ error: "Payten Bridge identiteta mora vsebovati veljaven P-256 SPKI ključ in keyId." }); return;
  }
  const enrollment = await db.transaction(async tx => {
    const result = await tx.execute<{ id: number; nastavitve_json: string | null }>(sql`
      SELECT id, nastavitve_json FROM naprave WHERE enota_id = ${enotaId} AND naprava_kljuc = ${deviceKey} FOR UPDATE`);
    const device = result.rows[0];
    if (!device) return "missing" as const;
    let config: Record<string, unknown> = {};
    try { config = device.nastavitve_json ? JSON.parse(device.nastavitve_json) as Record<string, unknown> : {}; } catch { /* replace corrupt optional config */ }
    const existingKeyId = typeof config.paytenBridgeKeyId === "string" ? config.paytenBridgeKeyId : "";
    const existingKey = typeof config.paytenBridgePublicKey === "string" ? config.paytenBridgePublicKey : "";
    if (existingKeyId && (existingKeyId !== enrolled.keyId || existingKey !== enrolled.spkiBase64Url)) return "conflict" as const;
    if (!existingKeyId) await tx.update(napraveTable).set({ nastavitveJson: JSON.stringify({
      ...config, paytenBridgeKeyId: enrolled.keyId, paytenBridgePublicKey: enrolled.spkiBase64Url,
    }) }).where(eq(napraveTable.id, device.id));
    return "ok" as const;
  });
  if (enrollment === "missing") { res.status(404).json({ error: "POS naprava ni registrirana." }); return; }
  if (enrollment === "conflict") { res.status(409).json({ error: "Naprava je že sparjena z drugim Payten Bridge ključem. Pred ponovnim parjenjem je potrebna izrecna odstranitev para." }); return; }
  res.json({ paired: true, keyId: enrolled.keyId, fingerprint: enrolled.fingerprint });
});

router.post("/terminal/payten/android/start", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const companyId = (req as any).companyId as string | undefined;
  const deviceKey = getRequestDeviceKey(req);
  const body = req.body as { znesek?: number; narociloId?: number; znesekNapitninaKartica?: number };
  const paymentAttemptId = getPaymentAttemptKey(req);
  const tc = await getDeviceTerminalConfig(tenotaId, deviceKey);
  const amount = Number(body.znesek);
  if (!tc.paytenAndroidAktiven || !tc.paytenBridgeKeyId || !tc.paytenBridgePublicKey || !paymentAttemptId || !companyId || !deviceKey
    || !Number.isInteger(body.narociloId) || body.narociloId! < 1 || exactEuroCents(amount) == null) {
    res.status(400).json({ error: "Manjka veljavna Payten Android nastavitev, naprava, paymentAttemptId, naročilo ali znesek." }); return;
  }
  const amountEvidence = requestedCardAmountEvidence(body, amount);
  if (!amountEvidence.ok) { res.status(400).json({ error: amountEvidence.error }); return; }
  let reservation;
  try {
    reservation = await reserveCardPaymentAttempt(companyId, tenotaId, paymentAttemptId, "payten", body.narociloId, amount, "receipt", (req as any).clerkUserId, deviceKey);
  } catch (err) {
    res.status(409).json({ error: publicCardAttemptConflictMessage(err) }); return;
  }
  if (!reservation) { res.status(503).json({ error: "Kartično plačilo se že rezervira; ponovite isti paymentAttemptId." }); return; }
  let bridge: { pollToken: string; launchedAt: string; expiresAt: string };
  if (reservation.created) {
    const pollToken = randomBytes(32).toString("base64url");
    const launchedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    bridge = { pollToken, launchedAt, expiresAt };
    await setCardPaymentAttempt(reservation.attempt.id, {
      providerRawStatus: "PENDING", status: "pending",
      rezultatJson: JSON.stringify({ amountEvidence: amountEvidence.evidence, paytenBridge: {
        pollTokenHash: createHash("sha256").update(pollToken).digest("hex"), keyId: tc.paytenBridgeKeyId, launchedAt, expiresAt,
      } }),
    });
  } else {
    const decision = paytenBridgeReservationDecision(false, reservation.attempt.status);
    if (decision === "completed") {
      res.json({ paymentAttemptId, attemptId: reservation.attempt.id, status: "completed" }); return;
    }
    // A token cannot be recovered or regenerated safely. Any prior outcome
    // requires reconciliation rather than a second native charge.
    res.status(409).json({ error: "Prejšnjega Payten poskusa ni mogoče varno ponovno zagnati; potrebna je uskladitev." }); return;
  }
  const state = Buffer.from(JSON.stringify({ v: 1, attemptId: reservation.attempt.id, amountCents: Math.round(amount * 100), currency: "EUR", pollToken: bridge!.pollToken, bridgeKeyId: tc.paytenBridgeKeyId })).toString("base64url");
  res.json({ paymentAttemptId, attemptId: reservation.attempt.id, status: "pending", bridgeKeyId: tc.paytenBridgeKeyId, pollToken: bridge!.pollToken, launchState: state, launchUrl: `bookie-viva-bridge://payten/${state}`, expiresAt: bridge!.expiresAt });
});

router.post("/terminal/payten/android/confirm", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const companyId = (req as any).companyId as string | undefined;
  const body = req.body as { paymentAttemptId?: string; envelope?: unknown };
  const paymentAttemptId = getPaymentAttemptKey(req);
  const deviceKey = getRequestDeviceKey(req);
  if (!companyId || !paymentAttemptId || !deviceKey || !body.envelope) {
    res.status(400).json({ status: "UNKNOWN", error: "Payten Android callback ne ustreza začetemu poskusu." }); return;
  }
  const attempt = await db.query.posKarticnaPlacilaAttemptTable.findFirst({ where: and(
    eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
    eq(posKarticnaPlacilaAttemptTable.enotaId, tenotaId),
    eq(posKarticnaPlacilaAttemptTable.idempotencyKey, paymentAttemptId),
    eq(posKarticnaPlacilaAttemptTable.provider, "payten"),
    eq(posKarticnaPlacilaAttemptTable.purpose, "receipt"),
  ) });
  if (!attempt) { res.status(404).json({ status: "FAILED", error: "Payment attempt ne obstaja." }); return; }
  if (attempt.deviceKey !== deviceKey) {
    res.status(409).json({ status: "UNKNOWN", paymentAttemptId, error: "Payten rezultat ne pripada trenutni POS napravi." }); return;
  }
  const tc = await getDeviceTerminalConfig(tenotaId, deviceKey);
  const verified = tc.paytenBridgePublicKey ? verifyPaytenBridgeEnvelope(body.envelope, tc.paytenBridgePublicKey) : { ok: false as const, error: "Payten Bridge ni sparjen." };
  const evidence = existingAmountEvidence(attempt);
  const unknown = async (message: string) => {
    await setCardPaymentAttempt(attempt.id, { status: "unknown", providerRawStatus: "SIGNED_RESULT_REJECTED", napaka: message });
    res.status(409).json({ status: "UNKNOWN", paymentAttemptId, error: message });
  };
  if (!verified.ok || !evidence || !tc.paytenBridgeKeyId || verified.payload.keyId !== tc.paytenBridgeKeyId
    || verified.payload.attemptId !== attempt.id
    || (typeof verified.payload.ecr !== "string" && typeof verified.payload.ecr !== "number")
    || String(verified.payload.ecr) !== paytenBridgeEcr(attempt.id)
    || verified.payload.resultCode !== "Approved" || verified.payload.currency !== "EUR"
    || exactDecimalCents(verified.payload.amount) !== Math.round(Number(attempt.znesek) * 100)) {
    await unknown(!verified.ok ? verified.error : "Podpisan Payten rezultat se ne ujema z rezerviranim plačilom."); return;
  }
  let stored: any; try { stored = attempt.rezultatJson ? JSON.parse(attempt.rezultatJson) : null; } catch { stored = null; }
  const bridge = stored?.paytenBridge;
  const receivedAt = verified.ok && typeof verified.payload.receivedAt === "number" ? verified.payload.receivedAt : 0;
  // Completion is allowed to replay after expiry only once the canonical
  // provider reference was already durably bound below.
  if (!bridge || bridge.keyId !== verified.payload.keyId || receivedAt < Date.parse(bridge.launchedAt) - 30_000
    || (attempt.status !== "completed" && (Date.parse(bridge.expiresAt) < Date.now() || receivedAt > Date.parse(bridge.expiresAt)))) {
    await unknown("Podpisan Payten rezultat je potekel ali ne pripada zagonu."); return;
  }
  const reference = `payten:${createHash("sha256").update(verified.payload.providerReference.trim()).digest("hex")}`;
  if (attempt.status === "completed" && attempt.providerReferenca === reference) {
    res.json({ status: "COMPLETED", paymentAttemptId, attemptId: attempt.id }); return;
  }
  const amounts = verifyCardProviderAmounts({ evidence, providerTotalCents: exactDecimalCents(verified.payload.amount) });
  if (!amounts.ok) { await unknown(amounts.error); return; }
  try {
    const winner = await db.transaction(async tx => {
      await tx.update(posKarticnaPlacilaAttemptTable).set({
        providerReferenca: reference, providerRawStatus: "Approved", status: "completed", napaka: null,
        rezultatJson: JSON.stringify({ amountEvidence: amounts.evidence, paytenBridge: { ...bridge, keyId: verified.payload.keyId, receivedAt }, providerReferenceHash: createHash("sha256").update(verified.payload.providerReference).digest("hex") }),
        posodobljeno: new Date(),
      }).where(and(eq(posKarticnaPlacilaAttemptTable.id, attempt.id), ne(posKarticnaPlacilaAttemptTable.status, "completed")));
      return tx.query.posKarticnaPlacilaAttemptTable.findFirst({ where: eq(posKarticnaPlacilaAttemptTable.id, attempt.id) });
    });
    if (!winner || winner.status !== "completed" || winner.providerReferenca !== reference) {
      await unknown("Payten referenca je že vezana na drugo plačilo."); return;
    }
  } catch {
    await unknown("Payten referenca je že vezana na drugo plačilo."); return;
  }
  res.json({ status: "COMPLETED", paymentAttemptId, attemptId: attempt.id });
});

router.post("/terminal/payten/android/timeout", async (req, res): Promise<void> => {
  const companyId = (req as any).companyId as string | undefined;
  const enotaId = Number((req as any).enotaId);
  const paymentAttemptId = getPaymentAttemptKey(req);
  const deviceKey = getRequestDeviceKey(req);
  if (!companyId || !Number.isInteger(enotaId) || !paymentAttemptId || !deviceKey) {
    res.status(400).json({ status: "UNKNOWN", error: "Manjka Payten paymentAttemptId." }); return;
  }
  const attempt = await db.query.posKarticnaPlacilaAttemptTable.findFirst({ where: and(
    eq(posKarticnaPlacilaAttemptTable.companyId, companyId), eq(posKarticnaPlacilaAttemptTable.enotaId, enotaId),
    eq(posKarticnaPlacilaAttemptTable.idempotencyKey, paymentAttemptId), eq(posKarticnaPlacilaAttemptTable.provider, "payten"),
  ) });
  if (!attempt) { res.status(404).json({ status: "UNKNOWN", error: "Payten poskus ne obstaja." }); return; }
  if (attempt.deviceKey !== deviceKey) {
    res.status(409).json({ status: "UNKNOWN", paymentAttemptId, error: "Payten poskus ne pripada trenutni POS napravi." }); return;
  }
  await setCardPaymentAttempt(attempt.id, { status: "unknown", providerRawStatus: "BRIDGE_TIMEOUT", napaka: "Čas čakanja na podpisani Payten Bridge rezultat je potekel; potrebna je uskladitev." });
  res.status(409).json({ status: "UNKNOWN", paymentAttemptId, attemptId: attempt.id, error: "Čas čakanja je potekel; plačilo je v neznanem stanju." });
});

// ── GET /terminal/test — preveri Payten TCP povezavo ─────────────────────────
router.get("/terminal/test", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const tc = await getDeviceTerminalConfig(tenotaId, (req as any).napravaKljuc);

  if (!tc.terminalAktiven) {
    res.json({ uspeh: false, napaka: "Terminal ni aktiviran v nastavitvah naprave." });
    return;
  }

  const result = await testTerminalPovezave({
    ip: tc.terminalIp,
    port: tc.terminalPort,
    timeoutMs: 5000,
  });

  res.json({ uspeh: result.uspeh, napaka: result.napaka ?? null });
});

// ── POST /terminal/sumup/pay — SumUp checkout ─────────────────────────────────
router.post("/terminal/sumup/pay", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const body = req.body as { znesek?: number; narociloId?: number | null; purpose?: CardPaymentPurpose; znesekNapitninaKartica?: number };

  const napravaKljuc = (req as any).napravaKljuc ?? req.headers["x-naprava-id"] as string | undefined;
  const tc = await getDeviceTerminalConfig(tenotaId, napravaKljuc);

  if (!tc.sumupAktiven) {
    res.status(400).json({ error: "SumUp terminal ni aktiviran. Vklopite ga v nastavitvah naprave." });
    return;
  }

  if (!tc.sumupApiKey) {
    res.status(400).json({ error: "SumUp API ključ ni nastavljen. Dodajte ga v nastavitvah naprave." });
    return;
  }

  const paymentAttemptId = getPaymentAttemptKey(req);
  const companyId = (req as any).companyId as string | undefined;
  const requestedAmount = Number(body.znesek);
  if (body.purpose != null && body.purpose !== "receipt" && body.purpose !== "gift_voucher") {
    res.status(400).json({ error: "Neveljaven namen kartičnega plačila." });
    return;
  }
  const purpose: CardPaymentPurpose = body.purpose === "gift_voucher" ? "gift_voucher" : "receipt";
  const giftAmountCents = purpose === "gift_voucher" ? exactEuroCents(requestedAmount) : null;
  const znesek = giftAmountCents == null ? requestedAmount : giftAmountCents / 100;
  const narociloId = Number.isInteger(body.narociloId) && Number(body.narociloId) > 0
    ? Number(body.narociloId) : undefined;
  const headerKey = typeof req.headers["idempotency-key"] === "string"
    ? req.headers["idempotency-key"].trim() : "";
  const bodyKey = typeof (req.body as { paymentAttemptId?: unknown }).paymentAttemptId === "string"
    ? (req.body as { paymentAttemptId: string }).paymentAttemptId.trim() : "";
  if (!paymentAttemptId) {
    res.status(400).json({ error: "Manjka veljaven paymentAttemptId oziroma Idempotency-Key." });
    return;
  }
  if (purpose === "gift_voucher" && headerKey && bodyKey && headerKey !== bodyKey) {
    res.status(409).json({ error: "PaymentAttemptId in Idempotency-Key morata biti enaka za darilni bon." });
    return;
  }
  if (!companyId || (purpose === "receipt" && !narociloId) || (purpose === "gift_voucher" && narociloId != null) || !Number.isFinite(znesek) || znesek <= 0) {
    res.status(400).json({ error: "Manjka podjetje, naročilo ali veljaven znesek kartičnega plačila." });
    return;
  }
  if (purpose === "gift_voucher" && giftAmountCents == null) {
    res.status(400).json({ error: "Znesek darilnega bona mora imeti največ dve decimalni mesti." });
    return;
  }
  if (purpose === "gift_voucher" && (giftAmountCents! < 1 || giftAmountCents! > 1_000_000)) {
    res.status(400).json({ error: "Znesek darilnega bona mora biti med 0,01 € in 10.000,00 €." });
    return;
  }
  const amountEvidence = requestedCardAmountEvidence(body, znesek);
  if (!amountEvidence.ok) {
    res.status(400).json({ error: amountEvidence.error });
    return;
  }

  let reservation;
  try {
    reservation = await reserveCardPaymentAttempt(
      companyId, tenotaId, paymentAttemptId, "sumup",
      narociloId, znesek, purpose, (req as any).clerkUserId, napravaKljuc,
    );
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Idempotency konflikt." });
    return;
  }
  if (!reservation) {
    res.status(503).json({ error: "Kartično plačilo se že rezervira; ponovite isti paymentAttemptId." });
    return;
  }
  if (!reservation.created) {
    if (reservation.attempt.providerReferenca) {
      res.json({ checkoutId: reservation.attempt.providerReferenca, paymentAttemptId, attemptId: reservation.attempt.id, status: reservation.attempt.status });
    } else {
      res.status(202).json({ paymentAttemptId, attemptId: reservation.attempt.id, status: reservation.attempt.status, recoveryRequired: true });
    }
    return;
  }

  try {
    // Merchant reference is also stable for provider-side diagnostics.
    const checkoutId = await ustvariCheckout(znesek, `pos-attempt-${paymentAttemptId}`, tc.sumupApiKey);
      await setCardPaymentAttempt(reservation.attempt.id, {
        providerReferenca: checkoutId,
        providerRawStatus: "PENDING",
        status: "pending",
        rezultatJson: amountEvidenceJson(amountEvidence.evidence),
      });
    if (tc.sumupTerminalSerial) {
      await posredujNaTerminal(checkoutId, tc.sumupTerminalSerial, tc.sumupApiKey);
    }
    res.json({ checkoutId, paymentAttemptId, attemptId: reservation.attempt.id, status: "pending" });
  } catch (err) {
    await setCardPaymentAttempt(reservation.attempt.id, {
      status: "unknown", napaka: err instanceof Error ? err.message : "SumUp napaka",
    }).catch(() => {});
    req.log.error({ err }, "SumUp pay napaka");
    res.status(502).json({ error: err instanceof Error ? err.message : "SumUp napaka", paymentAttemptId, attemptId: reservation.attempt.id, status: "unknown" });
  }
});

// ── GET /terminal/sumup/status/:checkoutId ────────────────────────────────────
router.get("/terminal/sumup/status/:checkoutId", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const { checkoutId } = req.params;

  const napravaKljuc = (req as any).napravaKljuc ?? req.headers["x-naprava-id"] as string | undefined;
  const tc = await getDeviceTerminalConfig(tenotaId, napravaKljuc);

  if (!tc.sumupApiKey) {
    res.status(400).json({ status: "FAILED", napaka: "SumUp API ključ ni nastavljen" });
    return;
  }

  try {
    const checkout = await preveriCheckout(checkoutId, tc.sumupApiKey);
    const companyId = (req as any).companyId as string | undefined;
    const attempt = companyId
      ? await db.query.posKarticnaPlacilaAttemptTable.findFirst({ where: and(
        eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
        eq(posKarticnaPlacilaAttemptTable.enotaId, tenotaId),
        eq(posKarticnaPlacilaAttemptTable.provider, "sumup"),
        eq(posKarticnaPlacilaAttemptTable.providerReferenca, checkoutId),
      ) })
      : null;
    let status: "PAID" | "PENDING" | "FAILED" | "UNKNOWN" = checkout.status;
    let napaka: string | null = null;
    if (checkout.status === "PAID") {
      const evidence = attempt ? existingAmountEvidence(attempt) : null;
      const providerTotalCents = checkout.currency === "EUR" && checkout.amount != null
        ? exactEuroCents(checkout.amount)
        : null;
      const verified = evidence
        ? verifyCardProviderAmounts({ evidence, providerTotalCents })
        : { ok: false as const, error: "SumUp attempt nima veljavnega centnega dokaza." };
      if (!attempt || !verified.ok) {
        status = "UNKNOWN";
        napaka = verified.ok ? "SumUp attempt ne obstaja." : verified.error;
      } else {
        await setCardPaymentAttempt(attempt.id, {
          status: "completed",
          providerRawStatus: checkout.status,
          napaka: null,
          rezultatJson: amountEvidenceJson(verified.evidence, {
            status: checkout.status,
            amount: checkout.amount,
            currency: checkout.currency,
            checkoutId,
          }),
        });
      }
    } else if (attempt && checkout.status === "FAILED") {
      await setCardPaymentAttempt(attempt.id, {
        status: "failed",
        providerRawStatus: checkout.status,
        rezultatJson: amountEvidenceJson(existingAmountEvidence(attempt)!, {
          status: checkout.status,
          amount: checkout.amount,
          currency: checkout.currency,
          checkoutId,
        }),
      });
    }
    if (attempt && status === "UNKNOWN") {
      await setCardPaymentAttempt(attempt.id, {
        status: "unknown",
        providerRawStatus: checkout.status,
        napaka,
      });
    }
    res.json({ status, napaka });
  } catch (err) {
    const companyId = (req as any).companyId as string | undefined;
    if (companyId) await markCardStatusCheckUnavailable(companyId, tenotaId, "sumup", checkoutId);
    req.log.warn({ err }, "SumUp status trenutno ni dosegljiv");
    res.json({ status: "UNKNOWN", napaka: "Preverjanje statusa SumUp ni dosegljivo." });
  }
});

// ── POST /terminal/viva/pay — Viva Wallet smart checkout ─────────────────────
router.post("/terminal/viva/pay", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const body = req.body as { znesek?: number; narociloId?: number; znesekNapitninaKartica?: number };
  const napravaKljuc = getRequestDeviceKey(req);
  if (!napravaKljuc) {
    res.status(400).json({ error: DEVICE_KEY_REQUIRED_MESSAGE });
    return;
  }

  const tc = await getDeviceTerminalConfig(tenotaId, napravaKljuc);

  if (!tc.vivaAktiven) {
    res.status(400).json({ error: "Viva Wallet ni aktiviran. Vklopite ga v nastavitvah naprave." });
    return;
  }

  if (!tc.vivaClientId || !tc.vivaClientSecret) {
    res.status(400).json({ error: "Viva Wallet Client ID ali Client Secret ni nastavljen." });
    return;
  }

  const paymentAttemptId = getPaymentAttemptKey(req);
  const companyId = (req as any).companyId as string | undefined;
  const znesek = Number(body.znesek);
  if (!paymentAttemptId) {
    res.status(400).json({ error: "Manjka veljaven paymentAttemptId oziroma Idempotency-Key." });
    return;
  }
  if (!companyId || !Number.isInteger(body.narociloId) || body.narociloId! <= 0 || !Number.isFinite(znesek) || znesek <= 0) {
    res.status(400).json({ error: "Manjka podjetje, naročilo ali veljaven znesek kartičnega plačila." });
    return;
  }
  const amountEvidence = requestedCardAmountEvidence(body, znesek);
  if (!amountEvidence.ok) { res.status(400).json({ error: amountEvidence.error }); return; }
  let reservation;
  try {
    reservation = await reserveCardPaymentAttempt(
      companyId, tenotaId, paymentAttemptId, "viva_smart",
      body.narociloId, znesek, "receipt", (req as any).clerkUserId, napravaKljuc,
    );
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Idempotency konflikt." });
    return;
  }
  if (!reservation) {
    res.status(503).json({ error: "Kartično plačilo se že rezervira; ponovite isti paymentAttemptId." });
    return;
  }
  if (!reservation.created) {
    if (reservation.attempt.providerReferenca) {
      const orderCode = reservation.attempt.providerReferenca;
      res.json({ orderCode, checkoutUrl: smartCheckoutUrl(orderCode, tc.vivaDemoNacin), paymentAttemptId, status: reservation.attempt.status });
    } else {
      res.status(202).json({ paymentAttemptId, status: reservation.attempt.status, recoveryRequired: true });
    }
    return;
  }

  try {
    const orderCode = await ustvariNarocilo(
      znesek, `pos-attempt-${paymentAttemptId}`, tc.vivaSourceCode,
      tc.vivaClientId, tc.vivaClientSecret, tc.vivaDemoNacin
    );
    const checkoutUrl = smartCheckoutUrl(orderCode, tc.vivaDemoNacin);
    await setCardPaymentAttempt(reservation.attempt.id, {
      providerReferenca: orderCode,
      providerRawStatus: "PENDING",
      status: "pending",
      rezultatJson: amountEvidenceJson(amountEvidence.evidence),
    });
    res.json({ orderCode, checkoutUrl, paymentAttemptId, status: "pending" });
  } catch (err) {
    await setCardPaymentAttempt(reservation.attempt.id, {
      status: "unknown", napaka: err instanceof Error ? err.message : "Viva Wallet napaka",
    }).catch(() => {});
    req.log.error({ err }, "Viva Wallet pay napaka");
    res.status(502).json({ error: err instanceof Error ? err.message : "Viva Wallet napaka", paymentAttemptId, status: "unknown" });
  }
});

// ── GET /terminal/viva/status/:orderCode ──────────────────────────────────────
router.get("/terminal/viva/status/:orderCode", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const { orderCode } = req.params;
  const napravaKljuc = getRequestDeviceKey(req);
  if (!napravaKljuc) {
    res.status(400).json({ status: "FAILED", napaka: DEVICE_KEY_REQUIRED_MESSAGE });
    return;
  }

  const tc = await getDeviceTerminalConfig(tenotaId, napravaKljuc);

  if (!tc.vivaClientId || !tc.vivaClientSecret) {
    res.status(400).json({ status: "FAILED", napaka: "Viva Wallet Client ID ali Secret ni nastavljen" });
    return;
  }

  try {
    const odgovor = await preveriVivaStatus(orderCode, tc.vivaClientId, tc.vivaClientSecret, tc.vivaDemoNacin);
    const companyId = (req as any).companyId as string | undefined;
    const attempt = companyId
      ? await db.query.posKarticnaPlacilaAttemptTable.findFirst({ where: and(
        eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
        eq(posKarticnaPlacilaAttemptTable.enotaId, tenotaId),
        eq(posKarticnaPlacilaAttemptTable.provider, "viva_smart"),
        eq(posKarticnaPlacilaAttemptTable.providerReferenca, orderCode),
      ) })
      : null;
    let status = odgovor.status;
    let napaka = odgovor.napaka ?? null;
    if (odgovor.status === "PAID" && attempt && odgovor.transactionId) {
      const verifiedTransaction = await preveriVivaTransakcijo(
        odgovor.transactionId,
        Math.round(Number(attempt.znesek) * 100),
        `pos-attempt-${attempt.idempotencyKey}`,
        tc.vivaClientId,
        tc.vivaClientSecret,
        tc.vivaDemoNacin,
      );
      const evidence = existingAmountEvidence(attempt);
      const verifiedAmounts = evidence
        ? verifyCardProviderAmounts({
          evidence,
          providerTotalCents: verifiedTransaction.amountCents,
        })
        : { ok: false as const, error: "Viva Smart attempt nima veljavnega centnega dokaza." };
      if (verifiedTransaction.status === "PAID" && verifiedAmounts.ok) {
        await setCardPaymentAttempt(attempt.id, {
          status: "completed",
          providerRawStatus: odgovor.status,
          napaka: null,
          rezultatJson: amountEvidenceJson(verifiedAmounts.evidence, {
            ...verifiedTransaction,
            orderCode,
          }),
        });
      } else {
        status = "UNKNOWN";
        napaka = verifiedTransaction.napaka
          ?? (verifiedAmounts.ok ? "Viva Smart zneska ni mogoče potrditi." : verifiedAmounts.error);
        await setCardPaymentAttempt(attempt.id, {
          status: "unknown",
          providerRawStatus: odgovor.status,
          napaka,
        });
      }
    } else if (companyId) {
      if (odgovor.status === "UNKNOWN" || odgovor.status === "PAID") {
        await markCardStatusCheckUnavailable(companyId, tenotaId, "viva_smart", orderCode);
        if (odgovor.status === "PAID") {
          status = "UNKNOWN";
          napaka = "Viva Smart ni vrnila preverljive reference transakcije.";
        }
      } else if (odgovor.status === "FAILED") {
        await setCardPaymentAttemptStatus(companyId, tenotaId, "viva_smart", orderCode, odgovor.status);
      }
    }
    res.json({
      status,
      napaka,
      transactionId: odgovor.transactionId ?? null,
      orderCode: odgovor.orderCode ?? orderCode,
      vivaStateId: odgovor.vivaStateId ?? null,
      vivaHttpStatus: odgovor.vivaHttpStatus ?? null,
    });
  } catch (err) {
    const companyId = (req as any).companyId as string | undefined;
    if (companyId) await markCardStatusCheckUnavailable(companyId, tenotaId, "viva_smart", orderCode);
    req.log.warn({ err }, "Viva Wallet status trenutno ni dosegljiv");
    res.json({ status: "UNKNOWN", napaka: "Preverjanje statusa Viva ni dosegljivo." });
  }
});

router.post("/terminal/viva/tap-to-pay/start", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const companyId = (req as any).companyId as string | undefined;
  const napravaKljuc = getRequestDeviceKey(req);
  const body = req.body as { znesek?: number; narociloId?: number; znesekNapitninaKartica?: number };
  if (!napravaKljuc) { res.status(400).json({ error: DEVICE_KEY_REQUIRED_MESSAGE }); return; }
  const tc = await getDeviceTerminalConfig(tenotaId, napravaKljuc);
  if (!tc.vivaTapToPayAktiven && !tc.vivaAndroidTerminalAktiven) {
    res.status(400).json({ error: "Viva Android Terminal ali Tap to Pay ni aktiviran na tej napravi." });
    return;
  }
  if (!tc.vivaClientId || !tc.vivaClientSecret) {
    res.status(400).json({ error: "Manjkajo Viva API poverilnice za preverjanje plačila." });
    return;
  }
  const paymentAttemptId = getPaymentAttemptKey(req);
  const znesek = Number(body.znesek);
  if (!paymentAttemptId || !companyId || !Number.isInteger(body.narociloId) || body.narociloId! <= 0 || exactEuroCents(znesek) == null) {
    res.status(400).json({ error: "Manjka veljaven paymentAttemptId, naročilo, podjetje ali znesek." }); return;
  }
  const amountEvidence = requestedCardAmountEvidence(body, znesek);
  if (!amountEvidence.ok) { res.status(400).json({ error: amountEvidence.error }); return; }
  let reservation;
  try {
    reservation = await reserveCardPaymentAttempt(companyId, tenotaId, paymentAttemptId, "viva_terminal", body.narociloId, znesek, "receipt", (req as any).clerkUserId, napravaKljuc);
  } catch (err) {
    req.log.warn({ err, narociloId: body.narociloId, znesek }, "Viva Android start: idempotency conflict");
    res.status(409).json({ error: publicCardAttemptConflictMessage(err) }); return;
  }
  if (!reservation) { res.status(503).json({ error: "Kartično plačilo se že rezervira; ponovite isti paymentAttemptId." }); return; }
  if (!reservation.created) {
    res.json({
      paymentAttemptId,
      clientTransactionId: reservation.attempt.idempotencyKey,
      status: reservation.attempt.status,
      recoveryRequired: true,
    });
    return;
  }
  try {
    // The durable reservation exists before any Viva network call, including
    // OAuth preparation. A timeout therefore remains recoverable as unknown.
    await pripraviVivaPovezavo(tc.vivaClientId, tc.vivaClientSecret, tc.vivaDemoNacin);
  } catch (err) {
    await setCardPaymentAttempt(reservation.attempt.id, {
      status: "unknown", providerRawStatus: "OAUTH_UNAVAILABLE",
      napaka: "Povezave z Vivo ni mogoče pripraviti.",
    });
    req.log.warn({ err }, "Viva Android start: OAuth priprava ni uspela");
    res.status(502).json({ error: "Povezave z Vivo ni mogoče pripraviti. Plačilo ni bilo začeto." });
    return;
  }
  await setCardPaymentAttempt(reservation.attempt.id, {
    providerReferenca: paymentAttemptId,
    providerRawStatus: "PENDING",
    status: "pending",
    rezultatJson: amountEvidenceJson(amountEvidence.evidence),
  });
  res.json({ paymentAttemptId, clientTransactionId: paymentAttemptId, status: "pending" });
});

router.post("/terminal/viva/tap-to-pay/confirm", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const companyId = (req as any).companyId as string | undefined;
  const napravaKljuc = getRequestDeviceKey(req);
  const body = req.body as {
    paymentAttemptId?: string;
    clientTransactionId?: string;
    transactionId?: string;
    orderCode?: string;
  };
  if (!napravaKljuc || !companyId) { res.status(400).json({ status: "UNKNOWN", error: DEVICE_KEY_REQUIRED_MESSAGE }); return; }
  const paymentAttemptId = getPaymentAttemptKey(req);
  if (
    !paymentAttemptId
    || body.clientTransactionId !== paymentAttemptId
    || (!body.transactionId?.trim() && !body.orderCode?.trim())
  ) {
    res.status(400).json({ status: "FAILED", error: "Viva callback ne ustreza začetemu payment attemptu." }); return;
  }
  const attempt = await db.query.posKarticnaPlacilaAttemptTable.findFirst({
    where: and(
      eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
      eq(posKarticnaPlacilaAttemptTable.enotaId, tenotaId),
      eq(posKarticnaPlacilaAttemptTable.idempotencyKey, paymentAttemptId),
      eq(posKarticnaPlacilaAttemptTable.provider, "viva_terminal"),
    ),
  });
  if (!attempt) { res.status(404).json({ status: "FAILED", error: "Payment attempt ne obstaja." }); return; }
  if (attempt.status === "completed") {
    res.json({ status: "PAID", paymentAttemptId, transactionId: attempt.providerReferenca }); return;
  }
  if (attempt.status === "failed") {
    res.json({ status: "FAILED", paymentAttemptId, transactionId: body.transactionId }); return;
  }
  const tc = await getDeviceTerminalConfig(tenotaId, napravaKljuc);
  if (!tc.vivaClientId || !tc.vivaClientSecret) {
    await setCardPaymentAttempt(attempt.id, { status: "unknown", napaka: "Manjkajo Viva API poverilnice za preverjanje." });
    res.status(409).json({ status: "UNKNOWN", error: "Viva transakcije ni mogoče varno preveriti." }); return;
  }
  let transactionId = body.transactionId?.trim() ?? "";
  if (!transactionId && body.orderCode?.trim()) {
    const orderStatus = await preveriVivaStatus(
      body.orderCode.trim(),
      tc.vivaClientId,
      tc.vivaClientSecret,
      tc.vivaDemoNacin,
    );
    if (orderStatus.status !== "PAID" || !orderStatus.transactionId) {
      res.status(409).json({
        status: "UNKNOWN",
        error: orderStatus.napaka ?? "Viva naročilne kode ni bilo mogoče razrešiti v potrjeno transakcijo.",
      });
      return;
    }
    transactionId = orderStatus.transactionId;
  }
  let verified;
  try {
    verified = await preveriVivaTransakcijo(
      transactionId, Math.round(Number(attempt.znesek) * 100), paymentAttemptId,
      tc.vivaClientId, tc.vivaClientSecret, tc.vivaDemoNacin,
    );
  } catch (err) {
    verified = {
      status: "UNKNOWN" as const,
      transactionId,
      amountCents: null,
      napaka: err instanceof Error ? err.message : "Viva transakcije trenutno ni mogoče preveriti.",
    };
  }
  const evidence = existingAmountEvidence(attempt);
  const verifiedAmounts = evidence
    ? verifyCardProviderAmounts({
      evidence,
      providerTotalCents: verified.amountCents,
    })
    : { ok: false as const, error: "Viva Android attempt nima veljavnega centnega dokaza." };
  const normalizedStatus = verified.status === "PAID" && verifiedAmounts.ok
    ? "completed"
    : verified.status === "FAILED"
      ? "failed"
      : "unknown";
  const normalizedError = verified.napaka
    ?? (verifiedAmounts.ok ? null : verifiedAmounts.error);
  await setCardPaymentAttempt(attempt.id, {
    providerReferenca: attempt.providerReferenca ?? paymentAttemptId,
    providerRawStatus: verified.status,
    status: normalizedStatus,
    napaka: normalizedError,
    rezultatJson: evidence
      ? amountEvidenceJson(
        verifiedAmounts.ok ? verifiedAmounts.evidence : evidence,
        { ...verified },
      )
      : JSON.stringify(verified),
  });
  res.status(verified.status === "PAID" && !verifiedAmounts.ok ? 409 : 200).json({
    ...verified,
    status: normalizedStatus === "completed" ? "PAID" : normalizedStatus === "failed" ? "FAILED" : "UNKNOWN",
    napaka: normalizedError,
    paymentAttemptId,
  });
});

// ── POST /terminal/viva/terminal/pay — Viva POS terminal ─────────────────────
router.post("/terminal/viva/terminal/pay", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const body = req.body as { znesek?: number; narociloId?: number; znesekNapitninaKartica?: number };
  const napravaKljuc = getRequestDeviceKey(req);
  if (!napravaKljuc) {
    res.status(400).json({ error: DEVICE_KEY_REQUIRED_MESSAGE });
    return;
  }

  const tc = await getDeviceTerminalConfig(tenotaId, napravaKljuc);

  if (!tc.vivaTerminalAktiven) {
    res.status(400).json({ error: "Viva Terminal ni aktiviran. Vklopite ga v nastavitvah naprave." });
    return;
  }

  if (!tc.vivaTerminalId) {
    res.status(400).json({ error: "Viva Terminal ID ni nastavljen. Dodajte ga v nastavitvah naprave." });
    return;
  }

  if (!tc.vivaClientId || !tc.vivaClientSecret) {
    res.status(400).json({ error: "Viva Wallet Client ID ali Client Secret ni nastavljen." });
    return;
  }

  const paymentAttemptId = getPaymentAttemptKey(req);
  const companyId = (req as any).companyId as string | undefined;
  const znesek = Number(body.znesek);
  if (!paymentAttemptId) {
    res.status(400).json({ error: "Manjka veljaven paymentAttemptId oziroma Idempotency-Key." });
    return;
  }
  if (!companyId || !Number.isInteger(body.narociloId) || body.narociloId! <= 0 || !Number.isFinite(znesek) || znesek <= 0) {
    res.status(400).json({ error: "Manjka podjetje, naročilo ali veljaven znesek kartičnega plačila." });
    return;
  }
  const amountEvidence = requestedCardAmountEvidence(body, znesek);
  if (!amountEvidence.ok) { res.status(400).json({ error: amountEvidence.error }); return; }
  let reservation;
  try {
    reservation = await reserveCardPaymentAttempt(
      companyId, tenotaId, paymentAttemptId, "viva_terminal",
      body.narociloId, znesek, "receipt", (req as any).clerkUserId, napravaKljuc,
    );
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Idempotency konflikt." });
    return;
  }
  if (!reservation) {
    res.status(503).json({ error: "Kartično plačilo se že rezervira; ponovite isti paymentAttemptId." });
    return;
  }
  if (!reservation.created) {
    if (reservation.attempt.providerReferenca) {
      res.json({ sessionId: reservation.attempt.providerReferenca, paymentAttemptId, status: reservation.attempt.status });
    } else {
      res.status(202).json({ paymentAttemptId, status: reservation.attempt.status, recoveryRequired: true });
    }
    return;
  }
  const sessionId = randomUUID();

  try {
    await setCardPaymentAttempt(reservation.attempt.id, {
      providerReferenca: sessionId,
      providerRawStatus: "PENDING",
      status: "pending",
      rezultatJson: amountEvidenceJson(amountEvidence.evidence),
    });
    await posljiNaVivaTerminal(
      znesek, sessionId, tc.vivaTerminalId, paymentAttemptId,
      tc.vivaClientId, tc.vivaClientSecret, tc.vivaDemoNacin
    );
    res.json({ sessionId, paymentAttemptId, status: "pending" });
  } catch (err) {
    await setCardPaymentAttempt(reservation.attempt.id, {
      status: "unknown", napaka: err instanceof Error ? err.message : "Viva Terminal napaka",
    }).catch(() => {});
    req.log.error({ err }, "Viva Terminal pay napaka");
    res.status(502).json({ error: err instanceof Error ? err.message : "Viva Terminal napaka", paymentAttemptId, status: "unknown" });
  }
});

// ── GET /terminal/viva/terminal/status/:sessionId ────────────────────────────
router.get("/terminal/viva/terminal/status/:sessionId", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const { sessionId } = req.params;
  const napravaKljuc = getRequestDeviceKey(req);
  if (!napravaKljuc) {
    res.status(400).json({ status: "FAILED", napaka: DEVICE_KEY_REQUIRED_MESSAGE });
    return;
  }

  const tc = await getDeviceTerminalConfig(tenotaId, napravaKljuc);

  if (!tc.vivaClientId || !tc.vivaClientSecret) {
    res.status(400).json({ status: "FAILED", napaka: "Viva Wallet Client ID ali Secret ni nastavljen" });
    return;
  }

  try {
    const odgovor = await preveriVivaTerminalSessionStatus(
      sessionId, tc.vivaClientId, tc.vivaClientSecret, tc.vivaDemoNacin
    );
    const companyId = (req as any).companyId as string | undefined;
    const attempt = companyId
      ? await db.query.posKarticnaPlacilaAttemptTable.findFirst({ where: and(
        eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
        eq(posKarticnaPlacilaAttemptTable.enotaId, tenotaId),
        eq(posKarticnaPlacilaAttemptTable.provider, "viva_terminal"),
        eq(posKarticnaPlacilaAttemptTable.providerReferenca, sessionId),
      ) })
      : null;
    let status = odgovor.status;
    let napaka = odgovor.napaka ?? null;
    if (odgovor.status === "PAID" && attempt && odgovor.transactionId) {
      const transaction = await preveriVivaTransakcijo(
        odgovor.transactionId,
        Math.round(Number(attempt.znesek) * 100),
        attempt.idempotencyKey,
        tc.vivaClientId,
        tc.vivaClientSecret,
        tc.vivaDemoNacin,
      );
      const evidence = existingAmountEvidence(attempt);
      const amounts = evidence
        ? verifyCardProviderAmounts({ evidence, providerTotalCents: transaction.amountCents })
        : { ok: false as const, error: "Viva Terminal attempt nima veljavnega centnega dokaza." };
      if (transaction.status === "PAID" && amounts.ok) {
        await setCardPaymentAttempt(attempt.id, {
          status: "completed",
          providerRawStatus: odgovor.status,
          rezultatJson: amountEvidenceJson(amounts.evidence, { ...transaction, sessionId }),
        });
      } else {
        status = "UNKNOWN";
        napaka = transaction.napaka ?? (amounts.ok ? "Viva Terminal zneska ni mogoče potrditi." : amounts.error);
        await setCardPaymentAttempt(attempt.id, { status: "unknown", providerRawStatus: odgovor.status, napaka });
      }
    } else if (companyId) {
      if (odgovor.status === "UNKNOWN" || odgovor.status === "PAID") {
        await markCardStatusCheckUnavailable(companyId, tenotaId, "viva_terminal", sessionId);
        if (odgovor.status === "PAID") {
          status = "UNKNOWN";
          napaka = "Viva Terminal ni vrnil preverljive reference in zneska transakcije.";
        }
      } else if (odgovor.status === "FAILED") {
        await setCardPaymentAttemptStatus(companyId, tenotaId, "viva_terminal", sessionId, odgovor.status);
      }
    }
    res.json({
      status,
      napaka,
      transactionId: odgovor.transactionId ?? null,
      orderCode: odgovor.orderCode ?? null,
    });
  } catch (err) {
    const companyId = (req as any).companyId as string | undefined;
    if (companyId) await markCardStatusCheckUnavailable(companyId, tenotaId, "viva_terminal", sessionId);
    req.log.warn({ err }, "Viva Terminal status trenutno ni dosegljiv");
    res.json({ status: "UNKNOWN", napaka: "Preverjanje statusa Viva Terminal ni dosegljivo." });
  }
});

// ── DELETE /terminal/viva/terminal/refund — storniraj Viva terminal plačilo ──
const MAX_VRACILA = 3;

type VivaRefundAuditActor = {
  actorClerkUserId: string | null;
  actorNatakarId: number | null;
  napravaKljuc: string;
};
type VivaRefundAuditVir = "reservation" | "provider" | "provider_error" | "manual";

async function transitionVivaRefundStatus(
  refundSessionId: string,
  enotaId: number,
  noviStatus: "unknown" | "paid" | "failed",
  napaka: string | null,
  actor: VivaRefundAuditActor,
  audit: {
    vir: VivaRefundAuditVir;
    razlog?: string | null;
    dokazReferenca?: string | null;
    dokazPriponkaId?: string;
    zahtevaniStatus?: "pending" | "unknown";
  },
): Promise<boolean> {
  const zakljucenoAt = noviStatus === "paid" || noviStatus === "failed" ? new Date() : null;
  const dovoljeniStatus = audit.zahtevaniStatus === "unknown"
    ? sql`current.status = 'unknown'`
    : sql`current.status IN ('pending', 'unknown')`;
  const result = await db.execute(sql`
    WITH current_refund AS (
      SELECT id, status
      FROM viva_vracila
      WHERE refund_session_id = ${refundSessionId}
        AND enota_id = ${enotaId}
        AND (${audit.vir} <> 'manual' OR EXISTS (
          SELECT 1 FROM viva_vracilo_dokazila d
          WHERE d.id = ${audit.dokazPriponkaId ?? null}
            AND d.viva_vracilo_id = viva_vracila.id AND d.enota_id = ${enotaId}
        ))
      FOR UPDATE
    ),
    updated_refund AS (
      UPDATE viva_vracila AS v
      SET status = ${noviStatus},
          napaka = ${napaka},
          zakljuceno_at = COALESCE(${zakljucenoAt}, v.zakljuceno_at)
      FROM current_refund AS current
      WHERE v.id = current.id
        AND ${dovoljeniStatus}
        AND current.status IS DISTINCT FROM ${noviStatus}
      RETURNING v.id, current.status AS prejsnji_status
    )
    INSERT INTO viva_vracilo_status_prehodi (
      viva_vracilo_id,
      enota_id,
      prejsnji_status,
      novi_status,
      napaka,
      actor_clerk_user_id,
      actor_natakar_id,
      naprava_kljuc,
      provider_referenca,
      vir,
      razlog,
      dokaz_referenca,
      dokaz_priponka
    )
    SELECT
      updated.id,
      ${enotaId},
      updated.prejsnji_status,
      ${noviStatus},
      ${napaka},
      ${actor.actorClerkUserId},
      ${actor.actorNatakarId},
      ${actor.napravaKljuc},
      ${refundSessionId},
      ${audit.vir},
      ${audit.razlog ?? null},
      ${audit.dokazReferenca ?? null},
      (SELECT d.priponka FROM viva_vracilo_dokazila d
       WHERE d.id = ${audit.dokazPriponkaId ?? null}
         AND d.viva_vracilo_id = updated.id AND d.enota_id = ${enotaId})
    FROM updated_refund AS updated
    RETURNING id
  `);
  return result.rows.length > 0;
}

function mayManageUnknownVivaRefund(vloga: string | undefined): boolean {
  return vloga === "admin" || vloga === "admin_enote" || vloga === "superadmin";
}

router.get("/terminal/viva/terminal/refunds/alert-settings", async (req, res): Promise<void> => {
  const posReq = req as PosRequest;
  if (!mayManageUnknownVivaRefund(posReq.vloga)) {
    res.status(403).json({ error: "Za opozorila vračil je potrebna administratorska vloga." });
    return;
  }
  const settings = await readRefundAlertSettings(posReq.companyId);
  const alerts = await pool.query(`
    SELECT a.id, a.refund_id AS "refundId", a.threshold, a.threshold_hours AS "thresholdHours",
      a.created_at AS "createdAt", r.stevilka_racuna AS "stevilkaRacuna"
    FROM viva_refund_alerts a
    JOIN viva_vracila v ON v.id = a.refund_id
    JOIN racuni r ON r.id = v.racun_id
    JOIN enote e ON e.id = v.enota_id
    WHERE a.closed_at IS NULL AND v.status IN ('unknown', 'awaiting_approval')
      AND v.enota_id = $1 AND e.company_id = $2
    ORDER BY a.created_at DESC, a.id DESC
  `, [posReq.enotaId, posReq.companyId]);
  res.setHeader("Cache-Control", "no-store");
  res.json(GetVivaRefundAlertOverviewResponse.parse({ settings, alerts: alerts.rows }));
});

router.put("/terminal/viva/terminal/refunds/alert-settings", async (req, res): Promise<void> => {
  const posReq = req as PosRequest;
  if (!["admin", "superadmin"].includes(posReq.vloga)) {
    res.status(403).json({ error: "Pragove lahko spreminja samo administrator podjetja." });
    return;
  }
  const parsed = UpdateVivaRefundAlertSettingsBody.safeParse(req.body);
  if (!parsed.success || !Number.isInteger(parsed.data.overdueHours) || !Number.isInteger(parsed.data.criticalHours)
    || parsed.data.criticalHours <= parsed.data.overdueHours) {
    res.status(400).json({ error: "Pragova morata biti celi uri: zapadlo najmanj 1 h, kritično pozneje in največ 8760 h." });
    return;
  }
  await pool.query(`
    INSERT INTO viva_refund_alert_settings(company_id, overdue_hours, critical_hours)
    VALUES ($1, $2, $3)
    ON CONFLICT (company_id) DO UPDATE
    SET overdue_hours = EXCLUDED.overdue_hours, critical_hours = EXCLUDED.critical_hours
  `, [posReq.companyId, parsed.data.overdueHours, parsed.data.criticalHours]);
  res.json(parsed.data);
});

router.get("/terminal/viva/terminal/refunds/unknown", async (req, res): Promise<void> => {
  const posReq = req as unknown as PosRequest;
  if (!mayManageUnknownVivaRefund(posReq.vloga)) {
    res.status(403).json({ error: "Za pregled nejasnih vračil je potrebna administratorska vloga." });
    return;
  }
  const settings = await readRefundAlertSettings(posReq.companyId);
  const items = await db.select({
    id: vivaVracilaTable.id,
    racunId: vivaVracilaTable.racunId,
    stevilkaRacuna: racuniTable.stevilkaRacuna,
    refundSessionId: vivaVracilaTable.refundSessionId,
    znesek: vivaVracilaTable.znesek,
    status: vivaVracilaTable.status,
    predlaganiStatus: vivaVracilaTable.predlaganiStatus,
    prviOdobriteljClerkUserId: vivaVracilaTable.prviOdobriteljClerkUserId,
    napaka: vivaVracilaTable.napaka,
    actorClerkUserId: vivaVracilaTable.actorClerkUserId,
    actorNatakarId: vivaVracilaTable.actorNatakarId,
    napravaKljuc: vivaVracilaTable.napravaKljuc,
    ustvarjeno: vivaVracilaTable.ustvarjeno,
  }).from(vivaVracilaTable)
    .innerJoin(racuniTable, eq(racuniTable.id, vivaVracilaTable.racunId))
    .where(and(
      eq(vivaVracilaTable.enotaId, posReq.enotaId),
      inArray(vivaVracilaTable.status, ["unknown", "awaiting_approval"]),
    ))
    .orderBy(vivaVracilaTable.ustvarjeno);
  const [unit] = await db.select({ threshold: enoteTable.vivaRefundApprovalThreshold })
    .from(enoteTable).where(eq(enoteTable.id, posReq.enotaId));
  res.json({
    approvalThreshold: Number(unit?.threshold ?? 100),
    items: items.map(item => ({
      ...item,
      canApprove: item.status !== "awaiting_approval" || item.prviOdobriteljClerkUserId !== posReq.clerkUserId,
      ...refundAgeState(item.ustvarjeno, settings),
      znesek: Number(item.znesek),
      ustvarjeno: item.ustvarjeno instanceof Date ? item.ustvarjeno.toISOString() : item.ustvarjeno,
    })),
  });
});

router.put("/terminal/viva/terminal/refunds/approval-policy", async (req, res): Promise<void> => {
  const posReq = req as unknown as PosRequest;
  if (!mayManageUnknownVivaRefund(posReq.vloga) || !posReq.clerkUserId) {
    res.status(403).json({ error: "Potrebna je prijava administratorja." }); return;
  }
  const threshold = req.body?.approvalThreshold;
  const cents = typeof threshold === "number" ? exactEuroCents(threshold) : null;
  if (cents == null || cents < 0 || cents > 9999999999) {
    res.status(400).json({ error: "Prag mora biti nenegativen znesek z največ dvema decimalkama." }); return;
  }
  await db.update(enoteTable).set({ vivaRefundApprovalThreshold: (cents / 100).toFixed(2) })
    .where(eq(enoteTable.id, posReq.enotaId));
  res.json({ approvalThreshold: cents / 100 });
});

router.delete("/terminal/viva/terminal/refund", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const body = req.body as { znesek?: number; originalSessionId?: string };
  const napravaKljuc = getRequestDeviceKey(req);
  if (!napravaKljuc) {
    res.status(400).json({ error: DEVICE_KEY_REQUIRED_MESSAGE });
    return;
  }

  const tc = await getDeviceTerminalConfig(tenotaId, napravaKljuc);

  if (!tc.vivaTerminalAktiven) {
    res.status(400).json({ error: "Viva Terminal ni aktiviran." });
    return;
  }

  if (!tc.vivaTerminalId || !tc.vivaClientId || !tc.vivaClientSecret) {
    res.status(400).json({ error: "Viva Terminal ni pravilno nastavljen." });
    return;
  }

  const znesek = Number(body.znesek);
  const requestedRefundCents = exactEuroCents(znesek);
  if (requestedRefundCents == null || requestedRefundCents <= 0) {
    res.status(400).json({ error: "Znesek vračila mora biti pozitiven in natančno izražen v centih." });
    return;
  }
  if (!body.originalSessionId) {
    res.status(400).json({ error: "Za Viva vračilo manjka originalna terminalsko-sejna referenca računa." });
    return;
  }

  // Refund ne zaupa identifikatorju odjemalca. Originalni račun in vse Viva
  // reference se vedno vzamejo iz baze trenutne enote.
  const racun = await db.query.racuniTable.findFirst({
    where: and(
      eq(racuniTable.vivaTerminalSessionId, body.originalSessionId),
      eq(racuniTable.enotaId, tenotaId),
    ),
    columns: {
      id: true,
      stevilkaRacuna: true,
      vivaTerminalSessionId: true,
      vivaTransactionId: true,
      vivaOrderCode: true,
      znesekKartica: true,
    },
  });
  if (!racun?.vivaTerminalSessionId) {
    res.status(404).json({ error: "Izvorni Viva Terminal račun ni najden." });
    return;
  }
  const expectedRefundCents = Math.round(Number(racun.znesekKartica ?? 0) * 100);
  if (expectedRefundCents <= 0 || requestedRefundCents !== expectedRefundCents) {
    res.status(409).json({ error: "Vračilo mora biti enako celotnemu shranjenemu kartičnemu znesku računa, vključno s kartično napitnino." });
    return;
  }
  const canonicalRefundEur = expectedRefundCents / 100;
  const posReq = req as unknown as PosRequest;
  const auditActor: VivaRefundAuditActor = {
    actorClerkUserId: posReq.clerkUserId ?? null,
    actorNatakarId: posReq.posActorNatakarId ?? null,
    napravaKljuc,
  };

  const refundSessionId = randomUUID();
  // Viva Cloud Terminal zahteva merchantovo stabilno oznako blagajne. Naprava
  // še nima ločene nastavitve cashRegisterId, zato je ta vezana na enoto.
  // preveri v Viva demo: ali merchant želi drugo, eksplicitno oznako blagajne.
  const cashRegisterId = `BOOKIE-ENOTA-${tenotaId}`;

  const reservation = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM racuni WHERE id = ${racun.id} AND enota_id = ${tenotaId} FOR UPDATE`);
    const [existing] = await tx.select().from(vivaVracilaTable).where(and(
      eq(vivaVracilaTable.racunId, racun.id),
      eq(vivaVracilaTable.enotaId, tenotaId),
      eq(vivaVracilaTable.znesek, canonicalRefundEur.toFixed(2)),
      inArray(vivaVracilaTable.status, ["pending", "unknown", "awaiting_approval", "paid"]),
    )).orderBy(desc(vivaVracilaTable.ustvarjeno)).limit(1);
    if (existing) return { row: existing, replay: true };

    const [{ value: steviloVracil }] = await tx.select({ value: count() })
      .from(vivaVracilaTable)
      .where(and(
        eq(vivaVracilaTable.racunId, racun.id),
        eq(vivaVracilaTable.enotaId, tenotaId),
      ));
    if (steviloVracil >= MAX_VRACILA) {
      throw Object.assign(new Error("refund_limit"), { code: "refund_limit" });
    }
    const [inserted] = await tx.insert(vivaVracilaTable).values({
      racunId: racun.id,
      enotaId: tenotaId,
      refundSessionId,
      znesek: canonicalRefundEur.toFixed(2),
      status: "pending",
      actorClerkUserId: auditActor.actorClerkUserId,
      actorNatakarId: auditActor.actorNatakarId,
      napravaKljuc: auditActor.napravaKljuc,
    }).returning();
    await tx.insert(vivaVraciloStatusPrehodiTable).values({
      vivaVraciloId: inserted!.id,
      enotaId: tenotaId,
      prejsnjiStatus: null,
      noviStatus: "pending",
      actorClerkUserId: auditActor.actorClerkUserId,
      actorNatakarId: auditActor.actorNatakarId,
      napravaKljuc: auditActor.napravaKljuc,
      providerReferenca: refundSessionId,
      vir: "reservation",
    });
    return { row: inserted!, replay: false };
  }).catch(err => {
    if ((err as { code?: string }).code === "refund_limit") return null;
    throw err;
  });
  if (!reservation) {
    res.status(409).json({ error: `Doseženo je največje število poskusov vračila (${MAX_VRACILA}). Vračilo ni možno.` });
    return;
  }
  if (reservation.replay) {
    res.status(reservation.row.status === "paid" ? 200 : 202).json({
      sessionId: reservation.row.refundSessionId,
      status: reservation.row.status,
      idempotentReplay: true,
    });
    return;
  }

  try {
    await stornirajVivaTerminal(
      {
        refundSessionId: reservation.row.refundSessionId,
        // Uradna ECR :refund shema zahteva parentSessionId; to je originalna
        // ECR seja, ne na novo ustvarjeni UUID vračila.
        parentSessionId: racun.vivaTerminalSessionId,
        originalTransactionId: racun.vivaTransactionId ?? null,
        originalOrderCode: racun.vivaOrderCode ?? null,
        amountEur: canonicalRefundEur,
        terminalId: tc.vivaTerminalId,
        merchantReference: `REFUND:${racun.stevilkaRacuna ?? racun.id}`,
        customerTrns: `Vračilo računa ${racun.stevilkaRacuna ?? racun.id}`,
        context: { model: "merchant", cashRegisterId },
      },
      tc.vivaClientId, tc.vivaClientSecret, tc.vivaDemoNacin
    );

    res.json({ sessionId: reservation.row.refundSessionId, status: "pending", idempotentReplay: false });
  } catch (err) {
    req.log.error({ err }, "Viva Terminal refund napaka");
    const napaka = err instanceof Error ? err.message : "Viva Terminal storno napaka";
    await transitionVivaRefundStatus(reservation.row.refundSessionId, tenotaId, "unknown", napaka, auditActor, { vir: "provider_error" });
    res.status(202).json({
      sessionId: reservation.row.refundSessionId,
      status: "unknown",
      error: "Izid terminalskega vračila ni znan; potrebna je ročna uskladitev.",
    });
  }
});

// ── GET /terminal/viva/terminal/refund/status/:sessionId ─────────────────────
router.get("/terminal/viva/terminal/refund/status/:sessionId", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const { sessionId } = req.params;
  const napravaKljuc = getRequestDeviceKey(req);
  if (!napravaKljuc) {
    res.status(400).json({ status: "FAILED", napaka: DEVICE_KEY_REQUIRED_MESSAGE });
    return;
  }
  const posReq = req as unknown as PosRequest;
  const auditActor: VivaRefundAuditActor = {
    actorClerkUserId: posReq.clerkUserId ?? null,
    actorNatakarId: posReq.posActorNatakarId ?? null,
    napravaKljuc,
  };

  const existingRefund = await db.query.vivaVracilaTable.findFirst({
    where: and(
      eq(vivaVracilaTable.refundSessionId, sessionId),
      eq(vivaVracilaTable.enotaId, tenotaId),
    ),
  });
  if (!existingRefund) {
    res.status(404).json({ status: "UNKNOWN", napaka: "Vračilo ni najdeno." });
    return;
  }
  if (existingRefund.status === "awaiting_approval") {
    res.json({ status: "UNKNOWN", napaka: "Čaka na odobritev drugega uporabnika.", idempotentReplay: true });
    return;
  }
  if (existingRefund.status === "paid" || existingRefund.status === "failed") {
    res.json({
      status: existingRefund.status === "paid" ? "PAID" : "FAILED",
      napaka: existingRefund.napaka ?? null,
      idempotentReplay: true,
    });
    return;
  }

  const tc = await getDeviceTerminalConfig(tenotaId, napravaKljuc);
  if (!tc.vivaClientId || !tc.vivaClientSecret) {
    res.status(400).json({ status: "FAILED", napaka: "Viva Wallet Client ID ali Secret ni nastavljen" });
    return;
  }

  try {
    const odgovor = await preveriVivaTerminalSessionStatus(
      sessionId, tc.vivaClientId, tc.vivaClientSecret, tc.vivaDemoNacin
    );

    if (odgovor.status === "PAID" || odgovor.status === "FAILED") {
      const dbStatus = odgovor.status === "PAID" ? "paid" : "failed";
      await transitionVivaRefundStatus(sessionId, tenotaId, dbStatus, odgovor.napaka ?? null, auditActor, { vir: "provider" });
    } else if (odgovor.status === "UNKNOWN") {
      await transitionVivaRefundStatus(
        sessionId,
        tenotaId,
        "unknown",
        odgovor.napaka ?? "Izid terminalskega vračila ni znan; potrebna je ročna uskladitev.",
        auditActor,
        { vir: "provider_error" },
      );
    }

    const current = await db.query.vivaVracilaTable.findFirst({
      where: and(eq(vivaVracilaTable.id, existingRefund.id), eq(vivaVracilaTable.enotaId, tenotaId)),
    });
    res.json({
      status: current?.status === "paid" ? "PAID" : current?.status === "failed" ? "FAILED" : "UNKNOWN",
      napaka: current?.napaka ?? odgovor.napaka ?? null,
    });
  } catch (err) {
    const napakaSporocilo = err instanceof Error ? err.message : "Viva Terminal napaka";
    await transitionVivaRefundStatus(sessionId, tenotaId, "unknown", napakaSporocilo, auditActor, { vir: "provider_error" }).catch(() => {});
    req.log.error({ err }, "Viva Terminal refund status napaka");
    res.json({ status: "UNKNOWN", napaka: "Izid terminalskega vračila ni znan; potrebna je ročna uskladitev." });
  }
});

const refundEvidenceStorage = new ObjectStorageService();
const refundEvidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: REFUND_EVIDENCE_MAX_BYTES, files: 1, fields: 0 },
  fileFilter: (_req, file, cb) => {
    if (!REFUND_EVIDENCE_MIMES.includes(file.mimetype)) cb(new Error("Unsupported evidence MIME"));
    else cb(null, true);
  },
}).single("file");

router.post("/terminal/viva/terminal/refund/:sessionId/evidence", async (req, res): Promise<void> => {
  const posReq = req as unknown as PosRequest;
  if (!mayManageUnknownVivaRefund(posReq.vloga) || !posReq.clerkUserId) {
    res.status(403).json({ error: "Za nalaganje dokazila je potrebna administratorska vloga." });
    return;
  }
  const [refund] = await db.select().from(vivaVracilaTable).where(and(
    eq(vivaVracilaTable.refundSessionId, req.params.sessionId),
    eq(vivaVracilaTable.enotaId, posReq.enotaId),
    inArray(vivaVracilaTable.status, ["unknown", "awaiting_approval"]),
  )).limit(1);
  if (!refund) {
    res.status(409).json({ error: "Vračilo ni v stanju UNKNOWN ali ne pripada aktivni enoti." });
    return;
  }
  refundEvidenceUpload(req, res, async error => {
    if (error || !req.file || !validateRefundEvidence(req.file.buffer, req.file.mimetype)) {
      res.status(error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
        .json({ error: "Naložite veljaven PDF, PNG, JPEG ali WebP, velik največ 10 MB." });
      return;
    }
    try {
      const objectPath = await refundEvidenceStorage.saveObjectEntityToNewPath(
        `refund-evidence/${posReq.enotaId}`, req.file.buffer, req.file.mimetype,
      );
      const priponka = {
        id: randomUUID(), objectPath, sha256: refundEvidenceHash(req.file.buffer),
        name: req.file.originalname.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 150) || "dokazilo",
        mime: req.file.mimetype, size: req.file.size,
      };
      await db.insert(vivaVraciloDokazilaTable).values({
        id: priponka.id, vivaVraciloId: refund.id, enotaId: posReq.enotaId,
        actorClerkUserId: posReq.clerkUserId!, priponka,
      });
      res.status(201).json({ id: priponka.id, name: priponka.name, sha256: priponka.sha256 });
    } catch (err) {
      req.log.error({ err }, "Refund evidence upload failed");
      res.status(503).json({ error: "Dokazila ni bilo mogoče trajno shraniti. Razrešitev ni dovoljena." });
    }
  });
});

router.get("/terminal/viva/terminal/refund-evidence/:id", async (req, res): Promise<void> => {
  const posReq = req as unknown as PosRequest;
  res.setHeader("Cache-Control", "private, no-store");
  if (!mayManageUnknownVivaRefund(posReq.vloga)) {
    res.status(403).json({ error: "Ogled dokazila je dovoljen le administratorju." });
    return;
  }
  const [audit] = await db.select({ priponka: vivaVraciloStatusPrehodiTable.dokazPriponka })
    .from(vivaVraciloStatusPrehodiTable).where(and(
      eq(vivaVraciloStatusPrehodiTable.enotaId, posReq.enotaId),
      sql`${vivaVraciloStatusPrehodiTable.dokazPriponka}->>'id' = ${req.params.id}`,
    )).limit(1);
  if (!audit?.priponka) {
    res.status(404).json({ error: "Dokazilo ni najdeno." });
    return;
  }
  try {
    const file = await refundEvidenceStorage.getObjectEntityFile(audit.priponka.objectPath);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) !== audit.priponka.size || Number(metadata.size) > REFUND_EVIDENCE_MAX_BYTES) {
      throw new Error("Evidence size mismatch");
    }
    const [bytes] = await file.download();
    if (refundEvidenceHash(bytes) !== audit.priponka.sha256) throw new Error("Evidence hash mismatch");
    res.setHeader("Content-Type", audit.priponka.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.setHeader("Content-Disposition", `inline; filename="${audit.priponka.name.replace(/["\\]/g, "_")}"`);
    res.send(bytes);
  } catch (err) {
    req.log.error({ err }, "Refund evidence unavailable or integrity check failed");
    res.status(503).json({ error: "Dokazila ni mogoče varno prikazati ali preveriti njegovega odtisa." });
  }
});

router.post("/terminal/viva/terminal/refund/:sessionId/resolve", async (req, res): Promise<void> => {
  const posReq = req as unknown as PosRequest;
  if (!mayManageUnknownVivaRefund(posReq.vloga)) {
    res.status(403).json({ error: "Za ročno razrešitev vračila je potrebna administratorska vloga." });
    return;
  }
  if (!posReq.clerkUserId) {
    res.status(403).json({ error: "Odobritev zahteva prijavljenega Clerk uporabnika." }); return;
  }
  const napravaKljuc = getRequestDeviceKey(req);
  if (!napravaKljuc) {
    res.status(400).json({ error: DEVICE_KEY_REQUIRED_MESSAGE });
    return;
  }
  const status = req.body?.status;
  const razlog = typeof req.body?.razlog === "string" ? req.body.razlog.trim() : "";
  const dokazReferenca = typeof req.body?.dokazReferenca === "string" ? req.body.dokazReferenca.trim() : "";
  const dokazPriponkaId = typeof req.body?.dokazPriponkaId === "string" ? req.body.dokazPriponkaId : "";
  if (!/^[0-9a-f-]{36}$/.test(dokazPriponkaId)) {
    res.status(400).json({ error: "Pred razrešitvijo naložite dokazilo." });
    return;
  }
  if (status !== "paid" && status !== "failed") {
    res.status(400).json({ error: "Ročna razrešitev mora biti paid ali failed." });
    return;
  }
  if (razlog.length < 10 || razlog.length > 1000) {
    res.status(400).json({ error: "Razlog mora vsebovati od 10 do 1000 znakov." });
    return;
  }
  if (dokazReferenca.length < 3 || dokazReferenca.length > 500) {
    res.status(400).json({ error: "Dokaz ali referenca mora vsebovati od 3 do 500 znakov." });
    return;
  }
  const actor: VivaRefundAuditActor = {
    actorClerkUserId: posReq.clerkUserId ?? null,
    actorNatakarId: posReq.posActorNatakarId ?? null,
    napravaKljuc,
  };
  const result = await db.transaction(async tx => {
    const [refund] = await tx.select().from(vivaVracilaTable).where(and(
      eq(vivaVracilaTable.refundSessionId, req.params.sessionId),
      eq(vivaVracilaTable.enotaId, posReq.enotaId),
    )).for("update");
    if (!refund || !["unknown", "awaiting_approval"].includes(refund.status)) {
      return { error: "Vračilo ni več nejasno ali ne pripada aktivni enoti. Osvežite seznam." };
    }
    const [evidence] = await tx.select().from(vivaVraciloDokazilaTable).where(and(
      eq(vivaVraciloDokazilaTable.id, dokazPriponkaId),
      eq(vivaVraciloDokazilaTable.vivaVraciloId, refund.id),
      eq(vivaVraciloDokazilaTable.enotaId, posReq.enotaId),
    )).limit(1);
    if (!evidence) return { error: "Dokazilo ne pripada temu vračilu in aktivni enoti." };
    const secondApproval = refund.status === "awaiting_approval";
    if (secondApproval && refund.prviOdobriteljClerkUserId === posReq.clerkUserId) {
      return { error: "Drugi odobritelj mora biti drug Clerk uporabnik." };
    }
    if (secondApproval && refund.predlaganiStatus !== status) {
      return { error: "Druga odobritev mora potrditi isti predlagani izid." };
    }
    const [unit] = await tx.select({ threshold: enoteTable.vivaRefundApprovalThreshold })
      .from(enoteTable).where(eq(enoteTable.id, posReq.enotaId)).for("share");
    if (!unit) return { error: "Aktivna enota ni najdena." };
    const needsApproval = !secondApproval && (status === "paid"
      || exactEuroCents(Number(refund.znesek))! >= exactEuroCents(Number(unit.threshold))!);
    const nextStatus = needsApproval ? "awaiting_approval" as const : status;
    const updated = await tx.update(vivaVracilaTable).set({
      status: nextStatus,
      predlaganiStatus: status,
      prviOdobriteljClerkUserId: secondApproval ? refund.prviOdobriteljClerkUserId : posReq.clerkUserId,
      napaka: nextStatus === "failed" ? razlog : refund.napaka,
      zakljucenoAt: needsApproval ? null : new Date(),
    }).where(and(
      eq(vivaVracilaTable.id, refund.id),
      eq(vivaVracilaTable.status, refund.status),
    )).returning({ id: vivaVracilaTable.id });
    if (!updated.length) return { error: "Vračilo je bilo medtem spremenjeno. Osvežite seznam." };
    await tx.insert(vivaVraciloStatusPrehodiTable).values({
      vivaVraciloId: refund.id, enotaId: posReq.enotaId,
      prejsnjiStatus: refund.status, noviStatus: nextStatus, predlaganiStatus: status,
      ...actor, providerReferenca: req.params.sessionId, vir: "manual",
      razlog, dokazReferenca, dokazPriponka: evidence.priponka,
    });
    return { status: nextStatus };
  });
  if ("error" in result) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.json({ sessionId: req.params.sessionId, status: result.status, manualResolution: true });
});

export default router;
