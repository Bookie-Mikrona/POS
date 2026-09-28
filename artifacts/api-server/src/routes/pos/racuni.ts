import { Router, type IRouter, type Request, type Response } from "express";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, inArray, isNotNull, isNull, ne, or, sql, sum } from "drizzle-orm";
import { artikliTable, blagajneTable, darilniBonGibiTable, darilniBonIzdajeTable, db, enoteTable, fursAttemptsTable, fursPayloadSnapshotsTable, izmeneTable, mizeTable, modifikatorjiTable, modNormativiTable, napraveTable, narocilaTable, natakariTable, normativiTable, odmoriTable, partnerCenikiTable, posKarticnaPlacilaAttemptTable, posKarticnaPlacilaReferenceTable, postavkeTable, posBookingSettingsTable, racunFinalizationPlansTable, racunIzdajaZahteveTable, racuniTable, tiskalneNalogeTable, tipDistributionProfileEntriesTable, tipDistributionProfilesTable, vivaVracilaTable, vivaVraciloStatusPrehodiTable, zalogaGibiTable } from "@workspace/db";
import { broadcastToUnit } from "../../lib/pos-sse";
import { faktorNormativaModifikatorja, faktorNormativaPodModifikatorja } from "../../lib/pica-poraba";
import { recomputeZaloge } from "../../lib/pos-zaloge-utils";
import { syncPosBookingForDay } from "../../lib/posSyncBooking";
import { getSimDatumOrNow } from "../../lib/sim-datum";
import { preveriCheckout as preveriSumupCheckout } from "../../lib/pos-sumup";
import { classifyFursDeliveryOutcome, fursQrKoda, fursQrUrl as buildFursQrUrl, fursSigningContextFingerprint as signingContextFingerprint, izracunajDDVZaokrozen, izracunajZOILokalno, posljiNaFURS, preveriSkupajKonsistentnost, pridobiCompanyCert, round2, zgradiStornoPayloadIzSnapshota } from "../../lib/pos-furs";
import { assertPackagingVatMatchesParent, buildEscPosReceipt, buildNb80TextReceipt, buildTextReceipt, projectPackagingDisplayPrices, type PrintRacunData } from "../../lib/pos-escpos";
import { buildEscPosReceiptBitmap } from "../../lib/pos-escpos-bitmap";
import * as net from "net";
import iconv from "iconv-lite";
import QRCode from "qrcode";
import { logger } from "../../lib/logger";
import { readAll, readAllWithFallback, toResponse } from "./nastavitve";
import { upsertPogostKupec } from "./kupec";
// bcrypt: use (await import('bcryptjs')).default for hashing
import { posljiEmailRacun, posljiEslogEmail } from "../../lib/pos-email";
import { captureStockMovementIntents, createFinalizationPlan, executeFinalizationPlan, finalizationPlanHash, type FinalizationPlan } from "../../services/pos/finalization-plan";
import { companiesTable, counterpartiesTable, bizboxNastavitveTable } from "@workspace/db";
import { desifrirajBizboxGeslo } from "../../lib/kripto-bizbox";
import { generirajEracunXml, type EracunInput } from "../../lib/eracun/generator";
import { getBizboxHost, loginBizbox, buildEnvelope, posljiBizbox, sestaviEddress, preveriEdiEnabled, parseBizboxDocId, getBizboxDocMetadata } from "../../lib/eracun/bizbox";
import { generatePosInvoicePdf } from "../../lib/external-export-pdf";
import { buildEslogInvoicePackage } from "../../lib/document-export-package";
import { getBusinessDayBounds } from "../../lib/pos-business-day";
import { CreateRacunBody, ListCardPaymentAttemptsQueryParams, ListCardPaymentAttemptsResponse, ListFursAttemptsQueryParams, ListFursAttemptsResponse } from "@workspace/api-zod";
import { cardPaymentEvidenceMatchesReceipt, PatchRacunPlacilnaNacinBody, resolveTipPaymentMethod, validatePatchedReceiptPayments, validatePosPayments, validateQrTipOrigin, validateStudentskiBonAvailability } from "../../lib/pos-payment-validation";
import { hasCardTerminalCharge, reserveTerminalReference } from "../../lib/pos-terminal-reference";
import { calculateTipTreatment, resolveTipPolicy } from "../../lib/tip-policy";
import { receiptPrintIdempotencyKey } from "../../lib/pos-print-queue";
import { compensateTipAllocationsForReceipt } from "../../lib/tip-storno-ledger";
import type { PosRequest } from "../../middlewares/pos";
import { writePosActorAudit } from "../../lib/posActorAudit";
import { mayUseEmployerControlledTips } from "../tips";

const router: IRouter = Router();

/** New internal multicourse components are operationally billed but never
 * customer or fiscal receipt lines. The zero price is part of the marker so
 * legacy receipts whose paired wines were charged remain legally immutable. */
export function isInternalMulticourseMenuComponent(line: {
  pairingGroupId: string | null;
  courseNumber: number | null;
  cenaKos: string | number | null;
}): boolean {
  return line.pairingGroupId !== null
    && line.courseNumber !== null
    && Number(line.cenaKos) === 0;
}

function receiptVisiblePostavkaClause() {
  return or(
    isNull(postavkeTable.pairingGroupId),
    isNull(postavkeTable.courseNumber),
    ne(postavkeTable.cenaKos, "0"),
  );
}

export function cardPaymentAttemptIdentifierPredicate(identifier: string) {
  // Cast the UUID column to text so legacy/non-UUID idempotency keys cannot
  // cause PostgreSQL's "invalid input syntax for type uuid" before the OR is
  // evaluated.
  return or(
    sql`${posKarticnaPlacilaAttemptTable.id}::text = ${identifier}`,
    eq(posKarticnaPlacilaAttemptTable.idempotencyKey, identifier),
  )!;
}

function unconsumedCompletedCardAttemptPredicate() {
  return sql`NOT EXISTS (
      SELECT 1 FROM pos_racun_izdaja_zahteve AS izdaja_zahteva
      WHERE izdaja_zahteva.card_payment_attempt_id = ${posKarticnaPlacilaAttemptTable.id}
    )
    AND NOT EXISTS (
      SELECT 1 FROM racuni AS izdani_racun
      WHERE izdani_racun.card_payment_attempt_id = ${posKarticnaPlacilaAttemptTable.id}
    )
    AND NOT EXISTS (
      SELECT 1 FROM darilni_bon_izdaje AS izdaja_bona
      WHERE izdaja_bona.card_payment_attempt_id = ${posKarticnaPlacilaAttemptTable.id}
    )`;
}

async function hasFreshRecoverySelectionClaim(input: {
  enotaId: number;
  attemptId: string;
  narociloId: number;
  amountCents: number;
  actorUserId: string;
  deviceKey: string | null;
  selectionToken: string;
}): Promise<boolean> {
  const tokenHash = createHash("sha256").update(input.selectionToken).digest("hex");
  const result = await db.execute(sql`
    SELECT 1 FROM pos_actor_audit
    WHERE enota_id = ${input.enotaId}
      AND action = ${"card_payment_recovery_selected"}
      AND metadata->>'attemptId' = ${input.attemptId}
      AND metadata->>'orderId' = ${String(input.narociloId)}
      AND metadata->>'amountCents' = ${String(input.amountCents)}
      AND actor_clerk_user_id = ${input.actorUserId}
      AND COALESCE(metadata->>'deviceKey', '') = ${input.deviceKey ?? ""}
      AND metadata->>'selectionTokenHash' = ${tokenHash}
      AND (metadata->>'selectionExpiresAt')::timestamptz > now()
    LIMIT 1
  `);
  return result.rows.length > 0;
}

export function expectedCardPaymentProvider(references: {
  sumupCheckoutId: string;
  vivaTerminalSessionId: string;
  vivaOrderCode: string;
  vivaTransactionId?: string;
}): "sumup" | "viva_terminal" | "viva_smart" | "payten" {
  return references.sumupCheckoutId ? "sumup"
    : references.vivaTerminalSessionId ? "viva_terminal"
      : references.vivaOrderCode ? "viva_smart"
        : references.vivaTransactionId ? "viva_terminal" : "payten";
}

export function receiptProviderReferenceFields(
  provider: "payten" | "sumup" | "viva_smart" | "viva_terminal" | "simulacija",
  providerReference: string,
) {
  return provider === "sumup" ? { sumupCheckoutId: providerReference }
    : provider === "viva_terminal" ? { vivaTerminalSessionId: providerReference }
      : provider === "viva_smart" ? { vivaOrderCode: providerReference }
        : {};
}

function porabaZaVelikostPice(
  kolicina: number,
  faktor: number,
  enotaMere: string | null,
  preserveFractional = false,
): number {
  const poraba = kolicina * faktor;
  // Tehtne/volumske sestavine so lahko decimalne; gnezdeni normativi ohranijo
  // ulomljeno normativno sled tudi pri kosovnem ciljnem artiklu.
  return preserveFractional
    || /^(kg|kgm|g|grm|l|ltr|dl|dlt|ml|mlt|kilogram|gram|liter|deciliter|mililiter)$/i.test(enotaMere?.trim() ?? "")
    ? poraba
    : Math.round(poraba);
}

type ZalogaMovementPlan = { artikelId: number; kolicina: number; opomba: string; ustvarjeno: string };

export async function buildZalogaMovementPlan(
  postavke: any[],
  stevilkaRacuna: string,
  datumCas: Date,
): Promise<ZalogaMovementPlan[]> {
  const aggregated = new Map<number, number>();
  const postavkaById = new Map(postavke.map((postavka) => [postavka.id, postavka]));
  const add = (artikelId: number, porabljeno: number) =>
    aggregated.set(artikelId, (aggregated.get(artikelId) ?? 0) - porabljeno);
  for (const postavka of postavke) {
    if (postavka.artikelId != null) {
      const [saleArticle] = await db.select({ mealType: artikliTable.mealType })
        .from(artikliTable).where(eq(artikliTable.id, postavka.artikelId));
      if (saleArticle?.mealType === "composite") {
        const components = await db.select().from(normativiTable)
          .where(eq(normativiTable.artikelId, postavka.artikelId));
        for (const component of components) {
          const [componentArticle] = await db.select({ mealType: artikliTable.mealType })
            .from(artikliTable).where(eq(artikliTable.id, component.vhodniArtikelId));
          if (componentArticle?.mealType !== "ala_carte") continue;
          const componentNorms = await db.select().from(normativiTable)
            .where(eq(normativiTable.artikelId, component.vhodniArtikelId));
          for (const normativ of componentNorms) {
            const [input] = await db.select({ enotaMere: artikliTable.enotaMere })
              .from(artikliTable).where(eq(artikliTable.id, normativ.vhodniArtikelId));
            add(normativ.vhodniArtikelId, porabaZaVelikostPice(
              Number(normativ.kolicina) * Number(component.kolicina) * Number(postavka.kolicina),
              Number(postavka.normativFaktor ?? 1), input?.enotaMere ?? null,
            ));
          }
        }
      } else if (saleArticle?.mealType !== "prepared") {
        const norms = await db.select().from(normativiTable).where(eq(normativiTable.artikelId, postavka.artikelId));
        for (const normativ of norms) {
          const [input] = await db.select({ enotaMere: artikliTable.enotaMere })
            .from(artikliTable).where(eq(artikliTable.id, normativ.vhodniArtikelId));
          add(normativ.vhodniArtikelId, porabaZaVelikostPice(
            Number(normativ.kolicina) * Number(postavka.kolicina),
            Number(postavka.normativFaktor ?? 1), input?.enotaMere ?? null,
          ));
        }
      }
    }
    if (postavka.modifikatorId != null) {
      const modifierNorms = await db.select({
        vhodniArtikelId: modNormativiTable.vhodniArtikelId,
        kolicina: modNormativiTable.kolicina,
        cenaDodatek: modifikatorjiTable.cenaDodatek,
      }).from(modNormativiTable)
        .innerJoin(modifikatorjiTable, eq(modifikatorjiTable.id, modNormativiTable.modifikatorId))
        .where(eq(modNormativiTable.modifikatorId, postavka.modifikatorId));
      for (const normativ of modifierNorms) {
        const [input] = await db.select({
          enotaMere: artikliTable.enotaMere,
          mealType: artikliTable.mealType,
        })
          .from(artikliTable).where(eq(artikliTable.id, normativ.vhodniArtikelId));
        const isNestedModifier = postavka.modifierSourceArticleId != null;
        const nestedParent = isNestedModifier && postavka.parentPostavkaId != null
          ? postavkaById.get(postavka.parentPostavkaId)
          : undefined;
        if (isNestedModifier && !nestedParent) {
          throw new Error(`Podizbira ${postavka.id} nima nadrejenega modifikatorja na računu.`);
        }
        const normativFactor = isNestedModifier
          ? faktorNormativaPodModifikatorja(
            Number(postavka.normativFaktor ?? 1),
            faktorNormativaModifikatorja(nestedParent.normativFaktor, nestedParent.cenaKos),
          )
          : Number(postavka.normativFaktor ?? 1);
        const modifierFactor = faktorNormativaModifikatorja(
          normativFactor,
          normativ.cenaDodatek,
          isNestedModifier,
        );
        const modifierQuantity = Number(normativ.kolicina) * Number(postavka.kolicina);
        // Neprodajni à la carte polizdelki imajo prav tako recept; prodajniArtikel
        // določa le vidnost v prodaji, ne trenutka porabe njihovih surovin.
        const sourceRecipe = Number(normativ.kolicina) > 0
          && input?.mealType === "ala_carte"
          ? await db.select().from(normativiTable).where(eq(normativiTable.artikelId, normativ.vhodniArtikelId))
          : [];
        if (sourceRecipe.length > 0) {
          for (const ingredientNorm of sourceRecipe) {
            const [ingredient] = await db.select({ enotaMere: artikliTable.enotaMere })
              .from(artikliTable).where(eq(artikliTable.id, ingredientNorm.vhodniArtikelId));
            add(ingredientNorm.vhodniArtikelId, porabaZaVelikostPice(
              Number(ingredientNorm.kolicina) * modifierQuantity,
              modifierFactor,
              ingredient?.enotaMere ?? null,
              isNestedModifier,
            ));
          }
        } else {
          // Prepared sale articles remain stock-counted as prepared portions;
          // non-sale inputs and sale articles without a recipe are stockable
          // directly rather than being charged as sold lines.
          add(normativ.vhodniArtikelId, porabaZaVelikostPice(
            modifierQuantity,
            modifierFactor,
            input?.enotaMere ?? null,
            isNestedModifier,
          ));
        }
      }
    }
  }
  return [...aggregated.entries()].filter(([, kolicina]) => kolicina !== 0).map(([artikelId, kolicina]) => ({
    artikelId, kolicina, opomba: `Račun ${stevilkaRacuna}`, ustvarjeno: datumCas.toISOString(),
  }));
}

function prevediFursNapako(napaka: string): string {
  if (/certifikat/i.test(napaka) || /certPem|certKljuc|produkcijsk/i.test(napaka)) {
    return "Fiskalizacija ni uspela: FURS certifikat ni naložen za to podjetje — naložite ga v Podjetje/FURS.";
  }
  if (/^S003\b/.test(napaka)) {
    return "FURS je zavrnil račun (S003 — napaka pri podpisu ali DDV neskladju). Preverite davčne stopnje artiklov in nastavitve certifikata.";
  }
  if (/^S001\b/.test(napaka)) {
    return "FURS je zavrnil račun (S001 — napaka v formatu zahtevka). Obvestite skrbnika sistema.";
  }
  if (/^S002\b/.test(napaka)) {
    return "FURS je zavrnil račun (S002 — davčna napaka). Obvestite skrbnika sistema.";
  }
  const sKodaMatch = napaka.match(/^(S\d+)\b[:\s]*(.*)/);
  if (sKodaMatch) {
    const koda = sKodaMatch[1];
    const opis = sKodaMatch[2]?.trim();
    return `FURS je vrnil napako ${koda}${opis ? `: ${opis}` : ""}. Obvestite skrbnika sistema.`;
  }
  if (/timeout/i.test(napaka)) {
    return "Strežnik FURS se ni odzval (timeout). Preverite omrežno povezavo in poskusite znova.";
  }
  if (/ECONNREFUSED|ENOTFOUND|network|omrežn/i.test(napaka)) {
    return "Ni mogoče vzpostaviti povezave s FURS strežnikom. Preverite omrežno povezavo.";
  }
  return `Fiskalizacija ni uspela: ${napaka}`;
}

type FursSnapshotPayload = {
  stevilkaRacuna: string;
  datumCas: string;
  skupaj: number;
  ddv: number;
  placilnaNacin: "gotovina" | "kartica" | "bon" | "other";
  postavke: Array<{ ime: string; kolicina: number; cenaKos: number; davek: number; skupaj?: number }>;
  davcnaStevilka?: string;
  poslovnaProstor?: string;
  blagajnaId?: string;
  operatorDavcna?: string;
  kupecDavcnaStevilka?: string | null;
  jeStorno?: boolean;
  izvornaStevRacuna?: string;
  izvornaStevRacunaDatumCas?: string;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(",")}}`;
}

function snapshotHash(payload: FursSnapshotPayload): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function snapshotToFursData(payload: FursSnapshotPayload, cert: Awaited<ReturnType<typeof pridobiCompanyCert>>, proxyUrl?: string) {
  return {
    ...payload,
    datumCas: new Date(payload.datumCas),
    izvornaStevRacunaDatumCas: payload.izvornaStevRacunaDatumCas ? new Date(payload.izvornaStevRacunaDatumCas) : undefined,
    ...(cert ?? {}),
    proxyUrl: proxyUrl || undefined,
  };
}

type ReceiptRegisterResolution =
  | {
      ok: true;
      activePP: string;
      activeBId: string;
      usedLegacyFallback: boolean;
      legacyDefaultsMissing: boolean;
    }
  | { ok: false; status: 400 | 403; code: string; error: string };

async function resolveReceiptRegister(
  enotaId: number,
  requestedBlagajnaId: unknown,
  configuredPP: string | null | undefined,
  configuredBId: string | null | undefined,
): Promise<ReceiptRegisterResolution> {
  if (requestedBlagajnaId != null) {
    const blagajnaId = Number(requestedBlagajnaId);
    const [blagajna] = Number.isInteger(blagajnaId) && blagajnaId > 0
      ? await db.select().from(blagajneTable).where(and(
          eq(blagajneTable.id, blagajnaId),
          eq(blagajneTable.enotaId, enotaId),
          eq(blagajneTable.aktivna, true),
        )).limit(1)
      : [];
    if (!blagajna) {
      return {
        ok: false,
        status: 403,
        code: "BLAGAJNA_INVALID",
        error: "Izbrana blagajna ni aktivna blagajna trenutne enote.",
      };
    }
    return {
      ok: true,
      activePP: blagajna.ppId,
      activeBId: blagajna.bId,
      usedLegacyFallback: false,
      legacyDefaultsMissing: false,
    };
  }

  const [activeBlagajna] = await db.select({ id: blagajneTable.id })
    .from(blagajneTable)
    .where(and(
      eq(blagajneTable.enotaId, enotaId),
      eq(blagajneTable.aktivna, true),
    ))
    .limit(1);
  if (activeBlagajna) {
    return {
      ok: false,
      status: 400,
      code: "BLAGAJNA_REQUIRED",
      error: "Pred izdajo računa izberite aktivno blagajno trenutne enote.",
    };
  }

  return {
    ok: true,
    activePP: configuredPP ?? "PP001",
    activeBId: configuredBId ?? "B001",
    usedLegacyFallback: true,
    legacyDefaultsMissing: !configuredPP || !configuredBId,
  };
}

function fursOutcome(odgovor: { uspeh: boolean; eor?: string | null }, transportUnknown = false): "confirmed" | "failed" | "unknown" {
  return classifyFursDeliveryOutcome({
    uspeh: odgovor.uspeh, eor: odgovor.eor ?? "", deliveryUnknown: transportUnknown || (odgovor as { deliveryUnknown?: boolean }).deliveryUnknown,
  });
}

async function nextStevilkaRacun(poslovniProstor: string, blagajnaId: string, tenotaId: number): Promise<string> {
  const prefix = `${poslovniProstor}-${blagajnaId}-`;
  const result = await db.execute(
    sql`
      WITH existing_max AS (
        SELECT COALESCE(MAX(
          CASE
            WHEN SUBSTRING(stevilka_racuna, ${sql.raw(String(prefix.length + 1))}) ~ '^[0-9]+$'
            THEN CAST(SUBSTRING(stevilka_racuna, ${sql.raw(String(prefix.length + 1))}) AS INTEGER)
            ELSE NULL
          END
        ), 0) + 1 AS next_value
        FROM racuni
        WHERE LEFT(stevilka_racuna, ${sql.raw(String(prefix.length))}) = ${prefix}
          AND enota_id = ${tenotaId}
      )
      INSERT INTO pos_racun_stevilke (enota_id, poslovni_prostor, blagajna_id, last_value)
      SELECT ${tenotaId}, ${poslovniProstor}, ${blagajnaId}, next_value
      FROM existing_max
      ON CONFLICT (enota_id, poslovni_prostor, blagajna_id)
      DO UPDATE SET
        last_value = GREATEST(pos_racun_stevilke.last_value + 1, EXCLUDED.last_value),
        posodobljeno = now()
      RETURNING last_value AS next
    `
  );
  const nextSeq = Number((result.rows[0] as { next: string })?.next ?? 1);
  return `${prefix}${String(nextSeq).padStart(6, "0")}`;
}

async function reserveTerminalPaymentReference(
  companyId: string,
  sumupCheckoutId: string,
  vivaTerminalSessionId: string,
): Promise<{ id: string } | null> {
  return reserveTerminalReference(async (provider, referenca) => {
    const [reservation] = await db.insert(posKarticnaPlacilaReferenceTable).values({
      companyId, provider, referenca,
    }).onConflictDoNothing().returning({ id: posKarticnaPlacilaReferenceTable.id });
    return reservation ?? null;
  }, sumupCheckoutId, vivaTerminalSessionId);
}

async function setTerminalPaymentReferenceStatus(
  id: string | null,
  status: "used" | "failed",
  racunId?: number,
): Promise<void> {
  if (!id) return;
  await db.update(posKarticnaPlacilaReferenceTable)
    .set({ status, ...(racunId ? { racunId } : {}) })
    .where(eq(posKarticnaPlacilaReferenceTable.id, id));
}

async function getSumupApiKeyForDevice(tenotaId: number, napravaKljuc: string | undefined): Promise<string | null> {
  if (!napravaKljuc) return null;
  const [naprava] = await db.select({ nastavitveJson: napraveTable.nastavitveJson })
    .from(napraveTable)
    .where(and(eq(napraveTable.enotaId, tenotaId), eq(napraveTable.napravaKljuc, napravaKljuc)))
    .limit(1);
  if (!naprava?.nastavitveJson) return null;
  try {
    const settings = JSON.parse(naprava.nastavitveJson) as Record<string, unknown>;
    return settings.sumupAktiven === true && typeof settings.sumupApiKey === "string" && settings.sumupApiKey.trim()
      ? settings.sumupApiKey.trim()
      : null;
  } catch {
    return null;
  }
}

type DarilniBonStanje = {
  izdano: number;
  unovceno: number;
  odprto: number;
};

/**
 * Evidenca je namerno skupna za podjetje, brez kod in individualnih saldov.
 * Stornirani računi se ne štejejo, saj njihovega ekonomskega učinka ni več.
 */
async function getDarilniBonStanje(companyId: string): Promise<DarilniBonStanje> {
  const rows = await db
    .select({
      tip: darilniBonGibiTable.tip,
      skupaj: sum(darilniBonGibiTable.znesek),
    })
    .from(darilniBonGibiTable)
    .innerJoin(racuniTable, eq(racuniTable.id, darilniBonGibiTable.racunId))
    .where(and(eq(darilniBonGibiTable.companyId, companyId), ne(racuniTable.status, "storniran")))
    .groupBy(darilniBonGibiTable.tip);

  const izdano = Number(rows.find(row => row.tip === "izdaja")?.skupaj ?? 0);
  const unovceno = Number(rows.find(row => row.tip === "unovcitev")?.skupaj ?? 0);
  return {
    izdano: Math.round(izdano * 100) / 100,
    unovceno: Math.round(unovceno * 100) / 100,
    odprto: Math.round((izdano - unovceno) * 100) / 100,
  };
}

async function lockIndividualVoucherForReceipt(tx: any, input: {
  companyId: string;
  code: string;
  amountCents: number;
}): Promise<string> {
  const found = await tx.execute(sql`
    SELECT id, status, expires_at
    FROM individual_vouchers
    WHERE company_id = ${input.companyId}
      AND code_hash = ${createHash("sha256").update(input.code).digest("hex")}
    FOR UPDATE
  `);
  const voucher = found.rows[0] as { id: string; status: string; expires_at: Date | string | null } | undefined;
  if (!voucher) {
    throw Object.assign(new Error("Spletni bon ni najden."), { status: 404, code: "INDIVIDUAL_VOUCHER_UNAVAILABLE" });
  }
  if (voucher.status !== "active" || (voucher.expires_at && new Date(voucher.expires_at) <= new Date())) {
    throw Object.assign(new Error("Spletni bon ni aktiven ali je potekel."), { status: 409, code: "INDIVIDUAL_VOUCHER_UNAVAILABLE" });
  }
  const balanceResult = await tx.execute(sql`
    SELECT COALESCE(sum(CASE WHEN type IN ('issue','reverse') THEN amount_cents ELSE -amount_cents END),0)::int balance
    FROM individual_voucher_movements WHERE voucher_id = ${voucher.id}
  `);
  const heldResult = await tx.execute(sql`
    SELECT COALESCE(sum(amount_cents),0)::int held
    FROM pos_individual_voucher_redemption_holds WHERE voucher_id = ${voucher.id} AND status = 'held'
  `);
  const available = Math.max(0, Number(balanceResult.rows[0]?.balance ?? 0) - Number(heldResult.rows[0]?.held ?? 0));
  if (input.amountCents > available) {
    throw Object.assign(
      new Error("Znesek bona presega razpoložljivo stanje po upoštevanju čakajočih rezervacij."),
      { status: 409, code: "INDIVIDUAL_VOUCHER_UNAVAILABLE", balanceCents: available },
    );
  }
  return voucher.id;
}

export async function reserveIndividualVoucherForReceipt(tx: any, input: {
  companyId: string;
  code: string;
  operationId: string;
  amountCents: number;
  receiptId: number;
}): Promise<void> {
  const voucherId = await lockIndividualVoucherForReceipt(tx, input);
  const hold = await tx.execute(sql`
    INSERT INTO pos_individual_voucher_redemption_holds
      (operation_id, voucher_id, company_id, amount_cents, receipt_id, status)
    VALUES (
      ${input.operationId}, ${voucherId}, ${input.companyId},
      ${input.amountCents}, ${input.receiptId}, 'held'
    )
    RETURNING id
  `);
  if (hold.rows.length !== 1) {
    throw Object.assign(new Error("Rezervacije spletnega bona ni mogoče varno povezati z računom."), {
      code: "INDIVIDUAL_VOUCHER_HOLD_CREATE_FAILED",
    });
  }
}

const baseSelect = {
  id: racuniTable.id,
  narociloId: racuniTable.narociloId,
  stevilkaRacuna: racuniTable.stevilkaRacuna,
  skupaj: racuniTable.skupaj,
  ddv: racuniTable.ddv,
  osnova: racuniTable.osnova,
  placilnaNacin: racuniTable.placilnaNacin,
  status: racuniTable.status,
  fursState: racuniTable.fursState,
  zoi: racuniTable.zoi,
  eor: racuniTable.eor,
  fursOdgovor: racuniTable.fursOdgovor,
  natakarIme: racuniTable.natakarIme,
  natakarDavcna: racuniTable.natakarDavcna,
  ustvarjeno: racuniTable.ustvarjeno,
  datumCas: racuniTable.datumCas,
  mizaStevilka: mizeTable.stevilka,
  steviloPrintov: racuniTable.steviloPrintov,
  opomba: racuniTable.opomba,
  jeDelni: racuniTable.jeDelni,
  znesekGotovina: racuniTable.znesekGotovina,
  znesekKartica: racuniTable.znesekKartica,
  znesekNapitnina: racuniTable.znesekNapitnina,
  tipPaymentMethod: racuniTable.tipPaymentMethod,
  znesekBon: racuniTable.znesekBon,
  steviloBonov: racuniTable.steviloBonov,
  znesekBonPica: racuniTable.znesekBonPica,
  znesekSubvencija: racuniTable.znesekSubvencija,
  sspReferenca: racuniTable.sspReferenca,
  znesekNegotovinsko: racuniTable.znesekNegotovinsko,
  dniOdloga: racuniTable.dniOdloga,
  jeStorno: racuniTable.jeStorno,
  izvorniRacunId: racuniTable.izvorniRacunId,
  kupecDavcnaStevilka: racuniTable.kupecDavcnaStevilka,
  kupecNaziv: racuniTable.kupecNaziv,
  kupecNaslov: racuniTable.kupecNaslov,
  sumupCheckoutId: racuniTable.sumupCheckoutId,
  vivaTerminalSessionId: racuniTable.vivaTerminalSessionId,
  vivaTransactionId: racuniTable.vivaTransactionId,
  vivaOrderCode: racuniTable.vivaOrderCode,
  eRacunStatus: racuniTable.eRacunStatus,
  eRacunNapaka: racuniTable.eRacunNapaka,
  eRacunPoslanoDne: racuniTable.eRacunPoslanoDne,
  eRacunBizboxId: racuniTable.eRacunBizboxId,
  eRacunBizboxStatus: racuniTable.eRacunBizboxStatus,
  eRacunBizboxOdgovor: racuniTable.eRacunBizboxOdgovor,
  eRacunEmailOdgovor: racuniTable.eRacunEmailOdgovor,
  kupecCpId: racuniTable.kupecCpId,
};

async function respondWithExistingStorno(res: any, stornoId: number): Promise<void> {
  const [existing] = await db.select({ ...baseSelect })
    .from(racuniTable)
    .leftJoin(narocilaTable, eq(racuniTable.narociloId, narocilaTable.id))
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .where(and(eq(racuniTable.id, stornoId), eq(racuniTable.jeStorno, true)));
  if (!existing) {
    res.status(409).json({ error: "Za ta račun je storno že rezerviran, vendar rezultata ni mogoče prebrati." });
    return;
  }
  const status = existing.fursState === "confirmed" ? 200
    : existing.fursState === "failed" ? 422
      : 202;
  res.status(status).json({
    ...existing,
    skupaj: Number(existing.skupaj),
    ddv: Number(existing.ddv),
    osnova: existing.osnova != null ? Number(existing.osnova) : null,
    znesekNapitnina: Number(existing.znesekNapitnina ?? 0),
    idempotentReplay: true,
  });
}

router.get("/racuni", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const query = { success: true as const, data: req.query };
  if (!query.success) { res.status(400).json({ error: (query as any).error.message }); return; }

  let rows;
  if (query.data.datum) {
    const bounds = await getBusinessDayBounds(tenotaId, String(query.data.datum));
    rows = await db
      .select(baseSelect)
      .from(racuniTable)
      .leftJoin(narocilaTable, eq(racuniTable.narociloId, narocilaTable.id))
      .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
      .where(and(
        sql`${racuniTable.ustvarjeno} >= ${bounds.start}`,
        sql`${racuniTable.ustvarjeno} < ${bounds.end}`,
        sql`true`,
        eq(racuniTable.enotaId, tenotaId)
      ))
      .orderBy(desc(racuniTable.ustvarjeno));
  } else {
    rows = await db
      .select(baseSelect)
      .from(racuniTable)
      .leftJoin(narocilaTable, eq(racuniTable.narociloId, narocilaTable.id))
      .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
      .where(and(eq(racuniTable.enotaId, tenotaId)))
      .orderBy(desc(racuniTable.ustvarjeno));
  }

  const mapped = rows.map((r) => ({
    ...r,
    skupaj: Number(r.skupaj),
    ddv: Number(r.ddv),
    osnova: r.osnova != null ? Number(r.osnova) : null,
    zoi: r.zoi ?? null,
    eor: r.eor ?? null,
    fursOdgovor: r.fursOdgovor ?? null,
    natakarIme: r.natakarIme ?? null,
    natakarDavcna: r.natakarDavcna ?? null,
    mizaStevilka: r.mizaStevilka ?? null,
    jeDelni: r.jeDelni ?? false,
    jeStorno: r.jeStorno ?? false,
    izvorniRacunId: r.izvorniRacunId ?? null,
    znesekGotovina: r.znesekGotovina != null ? Number(r.znesekGotovina) : null,
    znesekKartica: r.znesekKartica != null ? Number(r.znesekKartica) : null,
    znesekNapitnina: Number(r.znesekNapitnina ?? 0),
    tipPaymentMethod: r.tipPaymentMethod ?? null,
    znesekBon: r.znesekBon != null ? Number(r.znesekBon) : null,
    steviloBonov: r.steviloBonov ?? null,
    znesekBonPica: r.znesekBonPica != null ? Number(r.znesekBonPica) : null,
    znesekSubvencija: r.znesekSubvencija != null ? Number(r.znesekSubvencija) : null,
    sspReferenca: r.sspReferenca ?? null,
    znesekNegotovinsko: (r as { znesekNegotovinsko?: string | null }).znesekNegotovinsko != null ? Number((r as { znesekNegotovinsko?: string | null }).znesekNegotovinsko) : null,
    dniOdloga: r.dniOdloga ?? null,
    kupecDavcnaStevilka: r.kupecDavcnaStevilka ?? null,
    kupecNaziv: r.kupecNaziv ?? null,
    kupecNaslov: r.kupecNaslov ?? null,
    sumupCheckoutId: r.sumupCheckoutId ?? null,
    vivaTerminalSessionId: r.vivaTerminalSessionId ?? null,
    vivaTransactionId: r.vivaTransactionId ?? null,
    vivaOrderCode: r.vivaOrderCode ?? null,
    eRacunStatus: r.eRacunStatus ?? null,
    eRacunNapaka: r.eRacunNapaka ?? null,
    eRacunPoslanoDne: r.eRacunPoslanoDne ?? null,
    eRacunBizboxId: r.eRacunBizboxId ?? null,
    eRacunBizboxStatus: r.eRacunBizboxStatus ?? null,
    eRacunBizboxOdgovor: r.eRacunBizboxOdgovor ?? null,
    eRacunEmailOdgovor: r.eRacunEmailOdgovor ?? null,
    kupecCpId: r.kupecCpId ?? null,
  }));

  res.json((mapped));
});

router.get("/darilni-boni/stanje", async (req, res): Promise<void> => {
  const companyId = (req as any).companyId as string;
  res.json(await getDarilniBonStanje(companyId));
});

router.get("/racuni/card-payment-attempts", async (req, res): Promise<void> => {
  const tenotaId = (req as PosRequest).enotaId;
  const companyId = (req as PosRequest).companyId;
  const parsed = ListCardPaymentAttemptsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { provider, status, narociloId } = parsed.data;
  const page = parsed.data.page ?? 1, pageSize = parsed.data.pageSize ?? 50;
  const conditions = [
    eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
    eq(posKarticnaPlacilaAttemptTable.enotaId, tenotaId),
    ...(provider ? [eq(posKarticnaPlacilaAttemptTable.provider, provider)] : []),
    ...(status ? [eq(posKarticnaPlacilaAttemptTable.status, status)] : []),
    ...(narociloId != null ? [eq(posKarticnaPlacilaAttemptTable.narociloId, narociloId)] : []),
  ];
  const [totalRow] = await db.select({ total: count() }).from(posKarticnaPlacilaAttemptTable).where(and(...conditions));
  const rows = await db.select({
    attempt: posKarticnaPlacilaAttemptTable,
    receiptId: racuniTable.id,
  }).from(posKarticnaPlacilaAttemptTable)
    .leftJoin(racuniTable, eq(racuniTable.cardPaymentAttemptId, posKarticnaPlacilaAttemptTable.id))
    .where(and(...conditions))
    .orderBy(desc(posKarticnaPlacilaAttemptTable.ustvarjeno))
    .limit(pageSize).offset((page - 1) * pageSize);
  res.json(ListCardPaymentAttemptsResponse.parse({
    page, pageSize, total: Number(totalRow?.total ?? 0),
    items: rows.map(({ attempt, receiptId }) => ({
      id: attempt.id, provider: attempt.provider, providerRawStatus: attempt.providerRawStatus ?? null,
      status: attempt.status, purpose: attempt.purpose, narociloId: attempt.narociloId ?? null,
      znesek: Number(attempt.znesek), providerReferenca: attempt.providerReferenca ?? null,
      napaka: attempt.napaka ?? null, retryCount: 0, receiptId: receiptId ?? null,
      actor: attempt.actor ?? null, deviceKey: attempt.deviceKey ?? null,
      ustvarjeno: attempt.ustvarjeno, posodobljeno: attempt.posodobljeno,
    })),
  }));
});

router.get("/racuni/furs-attempts", async (req, res): Promise<void> => {
  const tenotaId = (req as PosRequest).enotaId;
  const parsed = ListFursAttemptsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { state, racunId } = parsed.data;
  const page = parsed.data.page ?? 1, pageSize = parsed.data.pageSize ?? 50;
  const conditions = [
    eq(racuniTable.enotaId, tenotaId),
    ...(state ? [eq(racuniTable.fursState, state)] : []),
    ...(racunId != null ? [eq(racuniTable.id, racunId)] : []),
  ];
  const [totalRow] = await db.select({ total: count() }).from(racuniTable).where(and(...conditions));
  const receipts = await db.select().from(racuniTable).where(and(...conditions))
    .orderBy(desc(racuniTable.ustvarjeno)).limit(pageSize).offset((page - 1) * pageSize);
  const ids = receipts.map(receipt => receipt.id);
  const ledger = ids.length ? await db.select().from(fursAttemptsTable)
    .where(inArray(fursAttemptsTable.racunId, ids)).orderBy(desc(fursAttemptsTable.startedAt)) : [];
  res.json(ListFursAttemptsResponse.parse({
    page, pageSize, total: Number(totalRow?.total ?? 0),
    items: receipts.map(receipt => {
      const attempts = ledger.filter(item => item.racunId === receipt.id);
      return {
        id: receipt.id, racunId: receipt.id, stevilkaRacuna: receipt.stevilkaRacuna,
        state: receipt.fursState, attempts: receipt.fursAttemptCount,
        lastError: receipt.fursLastError ?? null, zoi: receipt.zoi ?? null, eor: receipt.eor ?? null,
        retryActor: attempts[0]?.actor ?? null,
        attemptLedger: attempts.map(item => ({
          id: item.id, attemptId: item.attemptId, requestHash: item.requestHash,
          startedAt: item.startedAt, finishedAt: item.finishedAt ?? null,
          outcome: item.outcome ?? null, rawError: item.rawError ?? null, actor: item.actor,
        })),
      };
    }),
  }));
});

/**
 * Produkcijska prodaja večnamenskega darilnega bona.
 *
 * Bon je predplačilo, zato nima prihodka ali DDV, vendar je vseeno običajen
 * fiskaliziran POS račun z lastno številko, ZOI/EOR in sledjo plačila.
 */
router.post("/darilni-boni/izdaja", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const companyId = (req as any).companyId as string;
  const requestedAmount = Number(req.body?.znesek);
  const amountCents = Number.isFinite(requestedAmount) ? Math.round(requestedAmount * 100) : NaN;
  const hasExactCents = Number.isInteger(amountCents)
    && Math.abs(requestedAmount * 100 - amountCents) < 1e-8;
  const znesek = hasExactCents ? amountCents / 100 : requestedAmount;
  const placilnaNacin = req.body?.placilnaNacin;
  const idempotencyKey = typeof req.body?.idempotencyKey === "string"
    ? req.body.idempotencyKey.trim()
    : "";
  if (!hasExactCents || znesek <= 0 || znesek > 10_000) {
    res.status(400).json({ error: "Znesek darilnega bona mora biti med 0,01 € in 10.000,00 € ter imeti največ dve decimalni mesti." });
    return;
  }
  if (placilnaNacin !== "gotovina" && placilnaNacin !== "kartica") {
    res.status(400).json({ error: "Darilni bon je mogoče prodati za gotovino ali s kartico." });
    return;
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
    res.status(400).json({ error: "Za izdajo darilnega bona je potreben veljaven idempotentni ključ." });
    return;
  }

  // Že izdani rezultat mora ostati ponovljiv tudi, če se je konfiguracija
  // blagajne po prvi izdaji spremenila. To ne obide pravil za novo izdajo:
  // vrnemo le isti račun za popolnoma enak ključ in poslovne podatke.
  const requestedPaymentAttemptId = typeof req.body?.paymentAttemptId === "string"
    ? req.body.paymentAttemptId.trim()
    : "";
  const [existingIssuedGift] = await db.select().from(darilniBonIzdajeTable).where(and(
    eq(darilniBonIzdajeTable.companyId, companyId),
    eq(darilniBonIzdajeTable.idempotencyKey, idempotencyKey),
  )).limit(1);
  if (
    existingIssuedGift?.racunId
    && existingIssuedGift.enotaId === tenotaId
    && existingIssuedGift.placilnaNacin === placilnaNacin
    && Math.round(Number(existingIssuedGift.znesek) * 100) === amountCents
    && existingIssuedGift.cardPaymentAttemptId === (requestedPaymentAttemptId || null)
  ) {
    const [existingRacun] = await db.select().from(racuniTable)
      .where(eq(racuniTable.id, existingIssuedGift.racunId)).limit(1);
    if (existingRacun) {
      if (["pending", "sending", "unknown"].includes(existingRacun.fursState)) {
        const unknown = existingRacun.fursState === "unknown";
        res.status(unknown ? 202 : 409).json({
          id: existingRacun.id,
          fursState: existingRacun.fursState,
          code: unknown ? "ISSUE_OUTCOME_UNKNOWN" : "ISSUE_IN_PROGRESS",
          error: unknown ? "Izid FURS oddaje bona ni znan." : "Izdaja bona je še v obdelavi.",
        });
        return;
      }
      const stanje = await getDarilniBonStanje(companyId);
      res.status(200).json({
        id: existingRacun.id,
        stevilkaRacuna: existingRacun.stevilkaRacuna,
        skupaj: Number(existingRacun.skupaj),
        status: existingRacun.status,
        datumCas: existingRacun.datumCas,
        zoi: existingRacun.zoi,
        eor: existingRacun.eor,
        stanje,
        idempotentno: true,
      });
      return;
    }
  }

  const nastavitveMap = await readAll("", tenotaId);
  const nastavitve = toResponse(nastavitveMap);
  // Fiskalizacijski način je strežniška nastavitev enote. Vrednosti iz
  // odjemalca se namerno ne berejo, tudi za stare POS odjemalce ne.
  const fursNacin: "simulacija" | "testno" | "produkcija" = nastavitve.fursNacin;

  const register = await resolveReceiptRegister(
    tenotaId,
    req.body?.blagajnaId,
    nastavitve.poslovniProstor,
    nastavitve.elektronskaNaprava,
  );
  if (!register.ok) {
    res.status(register.status).json({ code: register.code, error: register.error });
    return;
  }
  const { activePP, activeBId } = register;

  let cardPaymentAttempt: typeof posKarticnaPlacilaAttemptTable.$inferSelect | null = null;
  if (
    placilnaNacin === "kartica"
    && (req.body?.sumupCheckoutId != null || req.body?.vivaTerminalSessionId != null)
  ) {
    res.status(400).json({ error: "Terminalske reference določi strežnik; odjemalec jih ne sme poslati." });
    return;
  }
  const paymentAttemptId = requestedPaymentAttemptId;
  if (placilnaNacin === "kartica") {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentAttemptId)) {
      res.status(400).json({ error: "Kartična izdaja zahteva veljaven UUID plačilnega poskusa." });
      return;
    }
    const [selectedAttempt] = await db.select().from(posKarticnaPlacilaAttemptTable).where(and(
      eq(posKarticnaPlacilaAttemptTable.id, paymentAttemptId),
      eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
      eq(posKarticnaPlacilaAttemptTable.enotaId, tenotaId),
    )).limit(1);
    cardPaymentAttempt = selectedAttempt ?? null;
    const roundedAmount = amountCents / 100;
    if (
      !cardPaymentAttempt
      || cardPaymentAttempt.purpose !== "gift_voucher"
      || cardPaymentAttempt.provider !== "sumup"
      || cardPaymentAttempt.idempotencyKey !== idempotencyKey
      || cardPaymentAttempt.narociloId !== null
      || cardPaymentAttempt.status !== "completed"
      || Math.round(Number(cardPaymentAttempt.znesek) * 100) !== amountCents
      || !cardPaymentAttempt.providerReferenca?.trim()
    ) {
      res.status(409).json({ error: "Plačilni poskus ni veljavno zaključeno SumUp plačilo tega darilnega bona." });
      return;
    }
  }
  // Gotovinska pot namerno ignorira morebitna zastarela kartična polja.
  const sumupCheckoutId = cardPaymentAttempt?.providerReferenca?.trim() ?? "";
  const vivaTerminalSessionId = "";
  const karticnaReferenca = sumupCheckoutId ? `sumup:${sumupCheckoutId}` : null;
  // Najprej atomarno rezerviramo ključ. Tako dvojni klik ne pošlje še enega
  // računa na FURS, niti če drugi zahtevek prispe sočasno.
  let [reservation] = await db.insert(darilniBonIzdajeTable).values({
    companyId,
    enotaId: tenotaId,
    idempotencyKey,
    placilnaNacin,
    znesek: (amountCents / 100).toFixed(2),
    karticnaReferenca,
    cardPaymentAttemptId: cardPaymentAttempt?.id ?? null,
  }).onConflictDoNothing().returning();

  if (!reservation) {
    const [previous] = await db.select().from(darilniBonIzdajeTable).where(and(
      eq(darilniBonIzdajeTable.companyId, companyId),
      eq(darilniBonIzdajeTable.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (previous) {
      if (
        previous.enotaId !== tenotaId
        || previous.placilnaNacin !== placilnaNacin
        || Math.round(Number(previous.znesek) * 100) !== amountCents
        || previous.karticnaReferenca !== karticnaReferenca
        || previous.cardPaymentAttemptId !== (cardPaymentAttempt?.id ?? null)
      ) {
        res.status(409).json({ error: "Idempotentni ključ je že uporabljen z drugačnimi podatki izdaje." });
        return;
      }
      if (previous.racunId) {
        const [existingRacun] = await db.select().from(racuniTable)
          .where(eq(racuniTable.id, previous.racunId)).limit(1);
        if (existingRacun) {
          if (["pending", "sending", "unknown"].includes(existingRacun.fursState)) {
            const unknown = existingRacun.fursState === "unknown";
            res.status(unknown ? 202 : 409).json({
              id: existingRacun.id,
              fursState: existingRacun.fursState,
              code: unknown ? "ISSUE_OUTCOME_UNKNOWN" : "ISSUE_IN_PROGRESS",
              error: unknown ? "Izid FURS oddaje bona ni znan." : "Izdaja bona je še v obdelavi.",
            });
            return;
          }
          const stanje = await getDarilniBonStanje(companyId);
          res.status(200).json({
            id: existingRacun.id,
            stevilkaRacuna: existingRacun.stevilkaRacuna,
            skupaj: Number(existingRacun.skupaj),
            status: existingRacun.status,
            datumCas: existingRacun.datumCas,
            zoi: existingRacun.zoi,
            eor: existingRacun.eor,
            stanje,
            idempotentno: true,
          });
          return;
        }
      }
      if (previous.status === "failed") {
        const [resumedReservation] = await db.update(darilniBonIzdajeTable)
          .set({ status: "pending" })
          .where(and(
            eq(darilniBonIzdajeTable.id, previous.id),
            eq(darilniBonIzdajeTable.status, "failed"),
          ))
          .returning();
        if (resumedReservation) {
          reservation = resumedReservation;
        } else {
          res.status(409).json({ error: "Izdaja darilnega bona s tem ključem se že obdeluje." });
          return;
        }
      } else {
        res.status(409).json({ error: "Izdaja darilnega bona s tem ključem se že obdeluje." });
        return;
      }
    }
    else {
      res.status(409).json({ error: "Terminalska referenca je že uporabljena pri drugi izdaji darilnega bona." });
      return;
    }
  }
  // Zunanjo SumUp preverbo izvajamo samo za novo izdajo. Že izdan račun se
  // prek istega ključa vrne zgoraj tudi ob kasnejšem izpadu ponudnika.
  if (cardPaymentAttempt) {
    const napravaKljuc = (req as any).napravaKljuc ?? req.headers["x-naprava-id"] as string | undefined;
    const sumupApiKey = await getSumupApiKeyForDevice(tenotaId, napravaKljuc);
    if (!sumupApiKey) {
      await db.update(darilniBonIzdajeTable).set({ status: "failed" })
        .where(eq(darilniBonIzdajeTable.id, reservation.id));
      res.status(400).json({ error: "Za kartični darilni bon SumUp ni nastavljen na tej napravi." });
      return;
    }
    let payment: Awaited<ReturnType<typeof preveriSumupCheckout>>;
    try {
      payment = await preveriSumupCheckout(sumupCheckoutId, sumupApiKey);
    } catch (err) {
      await db.update(darilniBonIzdajeTable).set({ status: "failed" })
        .where(eq(darilniBonIzdajeTable.id, reservation.id));
      req.log.warn({ err, companyId, enotaId: tenotaId }, "SumUp preverjanje darilnega bona ni dosegljivo pred fiskalizacijo");
      res.status(503).json({ error: "SumUp plačila trenutno ni mogoče preveriti. Izdaja še ni fiskalizirana; poskusite ponovno z istim ključem." });
      return;
    }
    if (
      payment.status !== "PAID"
      || payment.currency !== "EUR"
      || payment.amount === null
      || Math.abs(payment.amount * 100 - Math.round(payment.amount * 100)) >= 1e-8
      || Math.round(payment.amount * 100) !== amountCents
    ) {
      await db.update(darilniBonIzdajeTable).set({ status: "failed" })
        .where(eq(darilniBonIzdajeTable.id, reservation.id));
      res.status(409).json({ error: "SumUp plačilo ni potrjeno ali se znesek ne ujema z darilnim bonom." });
      return;
    }
    await db.update(darilniBonIzdajeTable).set({ terminalskoPlaciloPreverjeno: "preverjeno" })
      .where(eq(darilniBonIzdajeTable.id, reservation.id));
  }
  // Pri novem ključu je že shranjena referenca nedovoljena. Pri istem
  // idempotentnem ključu pa smo zgoraj že vrnili obstoječi račun.
  if (sumupCheckoutId || vivaTerminalSessionId) {
    const [usedReceipt] = await db.select({ id: racuniTable.id }).from(racuniTable)
      .where(sumupCheckoutId
        ? eq(racuniTable.sumupCheckoutId, sumupCheckoutId)
        : eq(racuniTable.vivaTerminalSessionId, vivaTerminalSessionId))
      .limit(1);
    if (usedReceipt) {
      await db.update(darilniBonIzdajeTable)
        .set({ status: "failed" })
        .where(eq(darilniBonIzdajeTable.id, reservation.id));
      res.status(409).json({ error: "Terminalska referenca je že uporabljena pri drugem računu." });
      return;
    }
  }
  const terminalReferenceReservation = await reserveTerminalPaymentReference(
    companyId,
    sumupCheckoutId,
    vivaTerminalSessionId,
  );
  if ((sumupCheckoutId || vivaTerminalSessionId) && !terminalReferenceReservation) {
    await db.update(darilniBonIzdajeTable)
      .set({ status: "failed" })
      .where(eq(darilniBonIzdajeTable.id, reservation.id));
    res.status(409).json({ error: "Terminalska referenca je že uporabljena pri drugem računu." });
    return;
  }
  const opozoriloNastavljeno = register.usedLegacyFallback && register.legacyDefaultsMissing
    ? "Prodajni prostor ali blagajna ni nastavljena — račun je izdan v simulaciji. Preverite nastavitve blagajne."
    : null;
  const effectiveFursNacin: "simulacija" | "testno" | "produkcija" = opozoriloNastavljeno ? "simulacija" : fursNacin;
  const stevilkaRacuna = await nextStevilkaRacun(activePP, activeBId, tenotaId);
  const datumCas = await getSimDatumOrNow(tenotaId);
  const zaokrozenZnesek = amountCents / 100;

  let natakarIme: string | null = null;
  let natakarDavcna: string | null = null;
  let izmenaId: number | null = null;
  const natakariId = (req as PosRequest).posActorNatakarId ?? Number(req.body?.natakariId);
  if (Number.isInteger(natakariId) && natakariId > 0) {
    const [openShift] = await db.select({ id: izmeneTable.id }).from(izmeneTable)
      .where(and(eq(izmeneTable.natakariId, natakariId), isNull(izmeneTable.konec), eq(izmeneTable.enotaId, tenotaId)));
    const [openBreak] = openShift
      ? await db.select({ id: odmoriTable.id }).from(odmoriTable)
        .where(and(eq(odmoriTable.izmenaId, openShift.id), isNull(odmoriTable.konec))).limit(1)
      : [];
    const [natakar] = !openBreak
      ? await db.select().from(natakariTable)
        .where(and(eq(natakariTable.id, natakariId), eq(natakariTable.companyId, companyId)))
      : [];
    if (natakar && openShift) {
      natakarIme = `${natakar.ime} ${natakar.priimek}`;
      natakarDavcna = natakar.davcnaStevilka ?? null;
      izmenaId = openShift.id;
    }
  }

  const companyCert = await pridobiCompanyCert(companyId);
  const certPem = companyCert?.certPem;
  const certKljuc = companyCert?.certKljuc;
  const giftFursPayload: FursSnapshotPayload = {
    stevilkaRacuna,
    datumCas: datumCas.toISOString(),
    skupaj: zaokrozenZnesek,
    ddv: 0,
    placilnaNacin,
    postavke: [{ ime: "Darilni bon — predplačilo", kolicina: 1, cenaKos: zaokrozenZnesek, davek: 0 }],
    davcnaStevilka: nastavitve.davcnaStevilka,
    poslovnaProstor: activePP,
    blagajnaId: activeBId,
    operatorDavcna: natakarDavcna ?? undefined,
  };
  const requestHash = snapshotHash(giftFursPayload);
  const giftSplosnaStopnja = Number(nastavitveMap["ddvSplosnaSt"] ?? "22");
  const giftAttemptId = randomUUID();
  const giftActor = (req as any).clerkUserId ?? "pos";
  let racun!: typeof racuniTable.$inferSelect;
  const giftSnapshot = await db.transaction(async tx => {
    const [narocilo] = await tx.insert(narocilaTable).values({
      enotaId: tenotaId, status: "odprto", skupaj: zaokrozenZnesek.toFixed(2),
    }).returning({ id: narocilaTable.id });
    [racun] = await tx.insert(racuniTable).values({
      enotaId: tenotaId, narociloId: narocilo.id, stevilkaRacuna, datumCas, ustvarjeno: datumCas,
      skupaj: zaokrozenZnesek.toFixed(2), ddv: "0.00", osnova: zaokrozenZnesek.toFixed(2),
      placilnaNacin, status: "napaka", fursState: "sending",
      fursClaimedAt: new Date(), fursClaimedBy: giftAttemptId, requestHash,
      natakarIme, natakarDavcna, izmenaId, jeDarilniBonIzdaja: true,
      opomba: "Izdaja večnamenskega darilnega bona — predplačilo brez DDV",
      znesekGotovina: placilnaNacin === "gotovina" ? zaokrozenZnesek.toFixed(2) : "0.00",
      znesekKartica: placilnaNacin === "kartica" ? zaokrozenZnesek.toFixed(2) : "0.00",
      znesekBon: "0.00", znesekBonPica: "0.00", znesekNegotovinsko: "0.00",
      sumupCheckoutId: sumupCheckoutId || null, vivaTerminalSessionId: vivaTerminalSessionId || null,
      cardPaymentAttemptId: cardPaymentAttempt?.id ?? null,
    }).returning();
    const [snapshot] = await tx.insert(fursPayloadSnapshotsTable).values({
      companyId, enotaId: tenotaId, operationKey: `darilni-bon:${reservation.id}`,
      giftReservationId: reservation.id, racunId: racun.id, payload: giftFursPayload,
      requestHash, fursNacin: effectiveFursNacin, preskociPreverjanje: false,
      splosnaStopnja: giftSplosnaStopnja.toFixed(2),
      signingContextFingerprint: signingContextFingerprint(effectiveFursNacin, companyCert?.certPem),
    }).returning({ id: fursPayloadSnapshotsTable.id });
    await tx.insert(postavkeTable).values({
      narociloId: narocilo.id, racunId: racun.id, ime: "Darilni bon — predplačilo",
      kolicina: 1, cenaKos: zaokrozenZnesek.toFixed(2), skupaj: zaokrozenZnesek.toFixed(2),
      davek: "0.00", vrstaArtikla: "storitev",
    });
    await tx.update(darilniBonIzdajeTable).set({ racunId: racun.id })
      .where(eq(darilniBonIzdajeTable.id, reservation.id));
    await tx.insert(fursAttemptsTable).values({
      racunId: racun.id, attemptId: giftAttemptId, requestHash, actor: giftActor,
    });
    return snapshot;
  });

  const zoiLokalno = izracunajZOILokalno(
    stevilkaRacuna, datumCas, zaokrozenZnesek,
    nastavitve.davcnaStevilka ?? "12345678", activePP, activeBId, effectiveFursNacin,
    certKljuc,
  );
  let fursOdgovor: Awaited<ReturnType<typeof posljiNaFURS>>;
  let fursTransportUnknown = false;
  if ((nastavitveMap["simulirajFursNapako"] ?? "false") === "true") {
    fursOdgovor = { uspeh: false, zoi: zoiLokalno, eor: null, napaka: "Simulirana napaka sistema FURS: Storitev trenutno ni na voljo (S100)", surovOdgovor: "simulacija" } as unknown as Awaited<ReturnType<typeof posljiNaFURS>>;
  } else {
    try {
      fursOdgovor = await posljiNaFURS(
        snapshotToFursData(giftFursPayload, companyCert, nastavitve.fursProxyUrl),
        effectiveFursNacin,
        false,
        giftSplosnaStopnja,
      );
    } catch (err) {
      const napaka = err instanceof Error ? err.message : String(err);
      fursTransportUnknown = true;
      fursOdgovor = { uspeh: false, zoi: zoiLokalno, eor: null, napaka, surovOdgovor: "omrežna napaka" } as unknown as Awaited<ReturnType<typeof posljiNaFURS>>;
    }
  }
  const fursState = fursOutcome(fursOdgovor, fursTransportUnknown);
  const status = fursState === "confirmed" ? (effectiveFursNacin === "produkcija" ? "poslan" : "testni") : "napaka";
  const fursNapaka = !fursOdgovor.uspeh && fursOdgovor.napaka ? prevediFursNapako(fursOdgovor.napaka) : null;
  let giftCasMiss = false;
  try {
    racun = await db.transaction(async (tx) => {
    const [novRacun] = await tx.update(racuniTable).set({
      status,
      zoi: fursOdgovor.zoi || zoiLokalno || null,
      eor: fursOdgovor.eor || null,
      fursOdgovor: fursOdgovor.surovOdgovor,
      fursState,
      fursAttemptCount: 1,
      fursLastAttemptAt: new Date(),
      fursLastError: fursState === "confirmed" ? null : (fursOdgovor.napaka ?? null),
      fursConfirmedAt: fursState === "confirmed" ? new Date() : null,
      fursClaimedAt: null,
      fursClaimedBy: null,
      opomba: `Izdaja večnamenskega darilnega bona — predplačilo brez DDV${fursNapaka ? `; ${fursNapaka}` : ""}`,
    }).where(and(
      eq(racuniTable.id, racun.id),
      eq(racuniTable.fursState, "sending"),
      eq(racuniTable.fursClaimedBy, giftAttemptId),
    )).returning();
    if (!novRacun) {
      await tx.update(fursAttemptsTable).set({
        finishedAt: new Date(), outcome: "unknown",
        rawError: "CAS claim miss; FURS izid darilnega bona zahteva ročno uskladitev.",
      }).where(eq(fursAttemptsTable.attemptId, giftAttemptId));
      await tx.update(darilniBonIzdajeTable).set({ status: "pending" })
        .where(eq(darilniBonIzdajeTable.id, reservation.id));
      giftCasMiss = true;
      return racun;
    }
    await tx.update(fursAttemptsTable).set({
      finishedAt: new Date(), outcome: fursState,
      rawResponse: fursOdgovor.surovOdgovor, rawError: fursState === "confirmed" ? null : (fursOdgovor.napaka ?? null),
    }).where(eq(fursAttemptsTable.attemptId, giftAttemptId));
    if (fursState === "confirmed") {
      await finalizeConfirmedGiftReceipt(tx, novRacun.id, companyId);
      if (terminalReferenceReservation) {
        await tx.update(posKarticnaPlacilaReferenceTable)
          .set({ status: "used", racunId: novRacun.id })
          .where(eq(posKarticnaPlacilaReferenceTable.id, terminalReferenceReservation.id));
      }
    }
    return novRacun;
    });
    if (giftCasMiss) {
      res.status(202).json({
        id: racun.id, fursState: "unknown",
        error: "FURS odgovor ni bil pripet zaradi CAS konflikta; potrebna je ročna uskladitev.",
      });
      return;
    }
  } catch (err) {
    // Stub, snapshot in začeti audit so trajni. Nedokončan sending bo ob
    // naslednjem pregledu postal unknown in se ne sme avtomatsko ponoviti.
    req.log.error({ err, companyId, enotaId: tenotaId, idempotencyKey, racunId: racun.id }, "Finalizacija darilnega bona po FURS ni uspela; receipt ostaja trajno rezerviran");
    res.status(202).json({
      id: racun.id,
      fursState: "sending",
      error: "FURS odgovor ni bil varno finaliziran. Račun in zahtevek sta shranjena; ne ponavljajte plačila.",
      pending: true,
    });
    return;
  }

  broadcastToUnit((req as any).enotaId, "update", { type: "racun" });
  const datum = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Ljubljana" }).format(datumCas);
  setImmediate(() => {
    syncPosBookingForDay(companyId, datum).catch(err => console.warn("[POS sync]", err));
  });
  const stanje = await getDarilniBonStanje(companyId);
  res.status(201).json({
    id: racun.id,
    stevilkaRacuna: racun.stevilkaRacuna,
    skupaj: Number(racun.skupaj),
    status: racun.status,
    datumCas: racun.datumCas,
    zoi: racun.zoi,
    eor: racun.eor,
    fursNapaka,
    stanje,
    opozorilo: opozoriloNastavljeno,
  });
});

router.post("/racuni", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const companyId = (req as any).companyId as string;
  const parsed = CreateRacunBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const idempotencyKey = parsed.data.idempotencyKey;
  const payloadHash = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
  const individualVoucherCode = parsed.data.individualVoucherCode?.trim() || null;

  const [existingRequest] = await db.select().from(racunIzdajaZahteveTable).where(and(
    eq(racunIzdajaZahteveTable.companyId, companyId),
    eq(racunIzdajaZahteveTable.enotaId, tenotaId),
    eq(racunIzdajaZahteveTable.idempotencyKey, idempotencyKey),
  )).limit(1);
  if (existingRequest) {
    if (existingRequest.payloadHash !== payloadHash) {
      res.status(409).json({ code: "IDEMPOTENCY_PAYLOAD_MISMATCH", error: "Isti ključ izdaje je bil že uporabljen z drugačnimi podatki." });
      return;
    }
    if (existingRequest.racunId) {
      const [existingRacun] = await db.select().from(racuniTable)
        .where(eq(racuniTable.id, existingRequest.racunId)).limit(1);
      if (existingRacun) {
        if (existingRacun.fursState === "sending" || existingRacun.fursState === "pending" || existingRacun.fursState === "unknown") {
          const unknown = existingRacun.fursState === "unknown";
          res.status(unknown ? 202 : 409).json({
            id: existingRacun.id,
            fursState: existingRacun.fursState,
            code: unknown ? "ISSUE_OUTCOME_UNKNOWN" : "ISSUE_IN_PROGRESS",
            error: unknown
              ? "Izid FURS oddaje ni znan; avtomatska ponovitev ni dovoljena."
              : "Izdaja računa je še v obdelavi.",
          });
          return;
        }
        if (existingRacun.fursState === "confirmed" && !existingRacun.businessFinalizedAt) {
          await db.transaction(tx => finalizeConfirmedStandardReceipt(
            tx, existingRacun.id, (req as any).clerkUserId ?? "pos-replay",
          ));
        }
        res.status(200).json({
          ...existingRacun,
          skupaj: Number(existingRacun.skupaj),
          ddv: Number(existingRacun.ddv),
          osnova: existingRacun.osnova != null ? Number(existingRacun.osnova) : null,
          znesekGotovina: existingRacun.znesekGotovina != null ? Number(existingRacun.znesekGotovina) : null,
          znesekKartica: existingRacun.znesekKartica != null ? Number(existingRacun.znesekKartica) : null,
          znesekNapitnina: Number(existingRacun.znesekNapitnina ?? 0),
          znesekBon: existingRacun.znesekBon != null ? Number(existingRacun.znesekBon) : null,
          znesekBonPica: existingRacun.znesekBonPica != null ? Number(existingRacun.znesekBonPica) : null,
          znesekSubvencija: Number(existingRacun.znesekSubvencija ?? 0),
          idempotentReplay: true,
        });
        return;
      }
    }
    res.status(409).json({
      code: existingRequest.status === "unknown" ? "ISSUE_OUTCOME_UNKNOWN" : "ISSUE_IN_PROGRESS",
      error: existingRequest.status === "unknown"
        ? "Izid prejšnje izdaje ni znan. Zaradi zaščite pred dvojno fiskalizacijo je potreben pregled."
        : "Izdaja računa z istim ključem že poteka. Počakajte in nato ponovite preverjanje.",
    });
    return;
  }

  const [narocilo] = await db.select().from(narocilaTable)
    .where(and(eq(narocilaTable.id, parsed.data.narociloId), sql`true`, eq(narocilaTable.enotaId, tenotaId)));
  if (!narocilo) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  if (narocilo.status === "zakljuceno") {
    res.status(409).json({
      code: "ORDER_ALREADY_CLOSED",
      error: "Naročilo je že zaključeno in račun je bil izdan na drugem terminalu.",
    });
    return;
  }

  const allPostavke = await db.select().from(postavkeTable).where(eq(postavkeTable.narociloId, narocilo.id));
  if (allPostavke.length === 0) { res.status(400).json({ error: "Naročilo nima postavk" }); return; }

  // Determine which postavke this receipt covers (partial or full billing)
  const postavkeIdsReq = (parsed.data as { postavkeIds?: number[] }).postavkeIds;
  let selectedPostavke = allPostavke;
  let jeDelni = false;

  if (postavkeIdsReq !== undefined && postavkeIdsReq.length === 0) {
    res.status(400).json({ error: "Seznam postavk za delni račun ne sme biti prazen" }); return;
  }

  if (postavkeIdsReq && postavkeIdsReq.length > 0) {
    const allIdsSet = new Set(allPostavke.map((p: any) => p.id));
    const invalidIds = postavkeIdsReq.filter((id: any) => !allIdsSet.has(id));
    if (invalidIds.length > 0) {
      res.status(400).json({ error: "Nekatere izbrane postavke ne pripadajo temu naročilu" }); return;
    }
    const selectedIdsSet = new Set<number>(postavkeIdsReq);
    // A commercial component is indivisible. Expand from any selected member
    // in both directions so a child/modifier cannot be billed without its
    // parent, and nested descendants remain with the same receipt.
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const line of allPostavke) {
        if (selectedIdsSet.has(line.id) && line.parentPostavkaId != null && !selectedIdsSet.has(line.parentPostavkaId)) {
          selectedIdsSet.add(line.parentPostavkaId);
          expanded = true;
        }
        if (line.parentPostavkaId != null && selectedIdsSet.has(line.parentPostavkaId) && !selectedIdsSet.has(line.id)) {
          selectedIdsSet.add(line.id);
          expanded = true;
        }
      }
    }
    // A multicourse menu is also one commercial component: its paid envelope
    // and all zero-priced operational course rows share pairingGroupId.
    const selectedMenuGroups = new Set(allPostavke
      .filter((p: any) => selectedIdsSet.has(p.id) && p.pairingGroupId != null)
      .map((p: any) => p.pairingGroupId));
    for (const component of allPostavke) {
      if (component.pairingGroupId != null
        && selectedMenuGroups.has(component.pairingGroupId)
        && !selectedIdsSet.has(component.id)) {
        selectedIdsSet.add(component.id);
      }
    }
    selectedPostavke = allPostavke.filter(p => selectedIdsSet.has(p.id));
    const alreadyCovered = selectedPostavke.filter(p => p.racunId !== null);
    if (alreadyCovered.length > 0) {
      res.status(409).json({ error: "Nekatere izbrane postavke so že pokrite z računom" }); return;
    }
    jeDelni = selectedPostavke.length < allPostavke.length;
  } else {
    selectedPostavke = allPostavke.filter(p => p.racunId === null);
    if (selectedPostavke.length === 0) {
      res.status(409).json({
        code: "ORDER_ALREADY_CLOSED",
        error: "Vse postavke naročila so že pokrite z računom.",
      });
      return;
    }
    jeDelni = selectedPostavke.length < allPostavke.length;
  }

  // Partnerski cenik — če je podan kupecId (UUID string) ali stari integer kupecId, prekalkuliramo cene iz cenika
  // kupecId je UUID string (iz šifranta counterparties)
  const kupecId = (parsed.data as { kupecId?: string | null }).kupecId ?? null;
  let partnerCenikMap: Map<number, number> | null = null;
  if (kupecId) {
    const cenikVrstice = await db
      .select({ artikelId: partnerCenikiTable.artikelId, cena: partnerCenikiTable.cena })
      .from(partnerCenikiTable)
      .where(eq(partnerCenikiTable.kupecId, kupecId));
    if (cenikVrstice.length > 0) {
      partnerCenikMap = new Map(cenikVrstice.map(v => [v.artikelId, Number(v.cena)]));
    }
  }

  // Bon za pico — izračun efektivnega popusta na pokrite pice (sortirano od najdražje)
  const steviloBonov = (parsed.data as { steviloBonov?: number | null }).steviloBonov ?? 0;
  const bonPicaPopustMap = new Map<number, { reducedAmount: number; pokriteKol: number }>();
  if (steviloBonov > 0) {
    const artikelIdsVPostavkah = (selectedPostavke as any[])
      .map((p: any) => p.artikelId)
      .filter((id: any): id is number => id != null);
    const pizzaArtikliSet = new Set<number>();
    if (artikelIdsVPostavkah.length > 0) {
      const pizzaArtikli = await db.select({ id: artikliTable.id })
        .from(artikliTable)
        .where(and(inArray(artikliTable.id, artikelIdsVPostavkah), eq(artikliTable.jePica, true)));
      for (const a of pizzaArtikli) pizzaArtikliSet.add(a.id);
    }
    type PicaUnit = { postavkaId: number; cenaKos: number };
    const piceSeznam: PicaUnit[] = [];
    for (const p of selectedPostavke as any[]) {
      if (p.artikelId != null && pizzaArtikliSet.has(p.artikelId) && Number(p.kolicina) > 0) {
        for (let i = 0; i < Number(p.kolicina); i++) {
          piceSeznam.push({ postavkaId: p.id, cenaKos: Number(p.cenaKos) });
        }
      }
    }
    piceSeznam.sort((a, b) => b.cenaKos - a.cenaKos);
    for (const pica of piceSeznam.slice(0, steviloBonov)) {
      if (pica.cenaKos <= 0) continue;
      const ex = bonPicaPopustMap.get(pica.postavkaId);
      if (ex) { ex.reducedAmount += pica.cenaKos; ex.pokriteKol += 1; }
      else bonPicaPopustMap.set(pica.postavkaId, { reducedAmount: pica.cenaKos, pokriteKol: 1 });
    }
  }

  // Preračunamo skupaj/ddv — za postavke s partnerskim cenikom zamenjamo ceno;
  // za pokrite pice upoštevamo bon za pico popust (skupaj zmanjšan za vrednost pokritih enot)
  const jeReprezentancaAliLastna = ["reprezentanca", "lastna_poraba"].includes(parsed.data.placilnaNacin);
  const skupajIzPostavk = round2((selectedPostavke as any[]).reduce((acc: number, p: any) => {
    const customCena = (partnerCenikMap && p.artikelId) ? partnerCenikMap.get(p.artikelId) : undefined;
    let vsota = customCena !== undefined ? round2(customCena * Number(p.kolicina)) : Number(p.skupaj);
    const bonPopust = bonPicaPopustMap.get(p.id);
    if (bonPopust) vsota = Math.max(0, vsota - bonPopust.reducedAmount);
    return acc + vsota;
  }, 0));
  // Za reprezentanco in lastno porabo: skupaj = 0 (100% popust, brezplačno),
  // ddv in osnova pa ostaneta iz originalnih cen — za prikaz na računu in FURS TaxesPerSeller.
  const prodajaDdv = round2((selectedPostavke as any[]).reduce((acc: number, p: any) => {
    const customCena = (partnerCenikMap && p.artikelId) ? partnerCenikMap.get(p.artikelId) : undefined;
    let vsota = customCena !== undefined ? round2(customCena * Number(p.kolicina)) : Number(p.skupaj);
    const bonPopust = bonPicaPopustMap.get(p.id);
    if (bonPopust) vsota = Math.max(0, vsota - bonPopust.reducedAmount);
    return acc + izracunajDDVZaokrozen(vsota, Number(p.davek));
  }, 0));
  const prodajaOsnova = round2(skupajIzPostavk - prodajaDdv);
  // skupaj = 0 za reprezentanco/lastno porabo (100% interni popust) — DDV osnova/znesek ostaneta iz originalnih cen
  const prodajaSkupaj = jeReprezentancaAliLastna ? 0 : skupajIzPostavk;
  let skupaj = prodajaSkupaj;
  let ddv = prodajaDdv;
  let osnova = prodajaOsnova;
  const datumCas = await getSimDatumOrNow(tenotaId);

  // SŠP subvencija je samostojen debetni vir (terjatev do države), ne popust:
  // prihodki, DDV in FURS zato vedno ostanejo od celotne bruto vrednosti.
  const rawSubvencija = (parsed.data as { znesekSubvencija?: unknown }).znesekSubvencija;
  const znesekSubvencija = rawSubvencija == null ? 0 : Number(rawSubvencija);
  if (znesekSubvencija > 0) {
    const posNastavitve = toResponse(await readAll("", tenotaId));
    const availability = validateStudentskiBonAvailability(
      znesekSubvencija,
      posNastavitve.studentskiBonAktiven === true,
    );
    if (!availability.ok) {
      res.status(403).json({ code: availability.code, error: availability.error });
      return;
    }
  }
  // Napitnina ni prodaja: ne sme vplivati na skupaj, osnovo, DDV ali FURS
  // postavke. Bon za pico je informativen; subvencija pa je plačilni vir.
  const rawSspReferenca = (parsed.data as { sspReferenca?: unknown }).sspReferenca;
  const sspReferenca = typeof rawSspReferenca === "string" && rawSspReferenca.trim()
    ? rawSspReferenca.trim()
    : null;
  const paymentValidation = validatePosPayments({
    placilnaNacin: parsed.data.placilnaNacin,
    skupaj: prodajaSkupaj,
    znesekGotovina: parsed.data.znesekGotovina,
    znesekKartica: parsed.data.znesekKartica,
    znesekBon: parsed.data.znesekBon,
    znesekBonPica: parsed.data.znesekBonPica,
    znesekNegotovinsko: parsed.data.znesekNegotovinsko,
    znesekSubvencija,
    znesekNapitnina: parsed.data.znesekNapitnina,
    sspReferenca,
  });
  if (!paymentValidation.ok) { res.status(400).json({ error: paymentValidation.error }); return; }
  const { napitnina, normalizedKartica, suppliedPaymentFields } = paymentValidation;
  const individualVoucherAmountCents = Math.round(Number(parsed.data.znesekBon ?? 0) * 100);
  if (individualVoucherCode && individualVoucherAmountCents <= 0) {
    res.status(400).json({ error: "Za spletni individualni bon mora biti naveden pozitiven znesek v polju znesekBon." });
    return;
  }
  if (individualVoucherCode && Math.abs(Number(parsed.data.znesekBon) * 100 - individualVoucherAmountCents) > 0.001) {
    res.status(400).json({ error: "Znesek spletnega bona mora biti izražen v celih centih." });
    return;
  }
  if (individualVoucherCode && normalizedKartica > 0.005) {
    res.status(409).json({
      code: "INDIVIDUAL_VOUCHER_CARD_ORDER_UNSAFE",
      error: "Spletnega bona ni mogoče združiti s kartičnim plačilom: kartica se lahko bremeni pred rezervacijo bona. Kartičnega plačila ne ponavljajte; najprej uskladite terminalski poskus.",
    });
    return;
  }
  const qrNapitnina = Number(narocilo.znesekNapitnina ?? 0);
  const tipOrigin = validateQrTipOrigin(napitnina, qrNapitnina);
  if (!tipOrigin.ok) {
    res.status(400).json({ code: tipOrigin.code, error: tipOrigin.error });
    return;
  }
  // Older callers which did not send a payment breakdown have one
  // deterministic primary channel. Persist it now so new tipped receipts
  // never need the historical reporting heuristic.
  const normalizedGotovina = !suppliedPaymentFields && parsed.data.placilnaNacin === "gotovina"
    ? round2(prodajaSkupaj + napitnina)
    : Number(parsed.data.znesekGotovina ?? 0);
  const tipPaymentResolution = resolveTipPaymentMethod({
    napitnina,
    tipPaymentMethod: (parsed.data as { tipPaymentMethod?: "cash" | "card" | null }).tipPaymentMethod,
    gotovina: normalizedGotovina,
    kartica: normalizedKartica,
  });
  if (!tipPaymentResolution.ok) { res.status(400).json({ error: tipPaymentResolution.error }); return; }
  const tipPaymentMethod = tipPaymentResolution.tipPaymentMethod;
  let tipTreatment;
  try {
    const policy = napitnina > 0 ? await resolveTipPolicy(companyId, tenotaId, datumCas) : null;
    if (policy?.mode === "employer_controlled") {
      const [company] = await db.select({ employerControlledTipsEnabled: companiesTable.employerControlledTipsEnabled })
        .from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
      if (!mayUseEmployerControlledTips(policy.mode, company?.employerControlledTipsEnabled === true)) {
        res.status(409).json({
          code: "EMPLOYER_CONTROLLED_TIPS_DISABLED",
          error: "Obvezni dodatek za storitev je za to podjetje izklopljen; novega računa ni mogoče izdati s to politiko.",
        });
        return;
      }
    }
    tipTreatment = calculateTipTreatment(napitnina, policy, 22, tipPaymentMethod ?? "card");
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    res.status(409).json({
      code,
      error: code === "TIP_POLICY_EVIDENCE_REQUIRED"
        ? "Napitnina ni dovoljena, dokler za izbrani režim ni potrjen verodostojen pogodbeni dogovor."
        : "Napitnina ni dovoljena, dokler podjetje nima časovno veljavne politike napitnin.",
    });
    return;
  }
  if (tipTreatment.mode === "employer_controlled") {
    skupaj = round2(prodajaSkupaj + napitnina);
    ddv = round2(prodajaDdv + tipTreatment.vatAmount);
    osnova = round2(prodajaOsnova + napitnina - tipTreatment.vatAmount);
  }
  if (!Number.isFinite(znesekSubvencija) || znesekSubvencija < 0) {
    res.status(400).json({ error: "Subvencija študentskega bona ne sme biti negativna." });
    return;
  }
  if (znesekSubvencija > prodajaSkupaj + 0.005) {
    res.status(400).json({ error: "Subvencija študentskega bona ne sme preseči bruto vrednosti računa." });
    return;
  }
  if (znesekSubvencija > 0 && steviloBonov > 0) {
    res.status(400).json({ error: "Študentskega bona v tej fazi ni mogoče kombinirati z bonom za pico." });
    return;
  }
  if (sspReferenca && sspReferenca.length > 128) {
    res.status(400).json({ error: "Lokalna referenca študentskega bona je predolga (največ 128 znakov)." });
    return;
  }
  const placanoBrezSubvencije = round2(
    Number(parsed.data.znesekGotovina ?? 0)
      + normalizedKartica
      + Number(parsed.data.znesekBon ?? 0)
      + Number((parsed.data as { znesekNegotovinsko?: number | null }).znesekNegotovinsko ?? 0),
  );
  if (znesekSubvencija > 0 && Math.abs(round2(placanoBrezSubvencije + znesekSubvencija) - round2(prodajaSkupaj + napitnina)) > 0.005) {
    res.status(400).json({ error: "Doplačilo skupaj s subvencijo mora biti enako bruto vrednosti računa." });
    return;
  }
  if (znesekSubvencija > 0 && (
    Number(parsed.data.znesekBon ?? 0) > 0.005 ||
    Number((parsed.data as { znesekNegotovinsko?: number | null }).znesekNegotovinsko ?? 0) > 0.005
  )) {
    res.status(400).json({ error: "Doplačilo ob študentskem bonu je lahko samo gotovina ali kartica." });
    return;
  }

  let izrednaOpomba: string | null = null;

  // DDV consistency check — preskoči kadar je aktiven partnerski cenik ali reprezentanca/lastna_poraba
  const jeNadaljevanje = allPostavke.some(p => p.racunId !== null);
  if (!jeDelni && !jeNadaljevanje && !partnerCenikMap && !jeReprezentancaAliLastna && steviloBonov === 0) {
    const narociloSkupaj = Number(narocilo.skupaj);
    try {
      preveriSkupajKonsistentnost(prodajaOsnova, prodajaDdv, narociloSkupaj);
    } catch (err) {
      const razlika = round2(Math.abs(skupajIzPostavk - narociloSkupaj));
      const preskoci = (parsed.data as { preskociDDVPreverjanje?: boolean }).preskociDDVPreverjanje ?? false;
      const skrbnisPIN = (parsed.data as { skrbnisPIN?: string }).skrbnisPIN ?? "";

      if (preskoci && razlika < 0.05 && skrbnisPIN) {
        const nastavitveMapZ = await readAll("", tenotaId);
        const shranjeniHash = nastavitveMapZ["izrednaIzdajaPINHash"] ?? "";
        if (!shranjeniHash) {
          res.status(403).json({ code: "IZREDNI_PIN_NI_NASTAVLJEN", error: "Skrbniški PIN za izredno izdajo ni nastavljen. Nastavite ga v razdelku Nastavitve." });
          return;
        }
        const pinOk = await (await import("bcryptjs")).default.compare(skrbnisPIN, shranjeniHash);
        if (!pinOk) {
          res.status(403).json({ code: "NAPACEN_IZREDNI_PIN", error: "Napačen skrbniški PIN." });
          return;
        }
        izrednaOpomba = `Izredna izdaja — DDV neskladje preskočeno s PIN kodo (razlika ${razlika.toFixed(2)} €)`;
        logger.warn({
          msg: "Izredna izdaja z PIN kodo — DDV neskladje preskočeno",
          narociloId: narocilo.id,
          skupajNarocilo: narociloSkupaj,
          skupajIzPostavk,
          ddv,
          razlika});
      } else {
        logger.warn({
          msg: "DDV neskladje pri izdaji računa",
          narociloId: narocilo.id,
          skupajNarocilo: narociloSkupaj,
          skupajIzPostavk,
          ddv,
          razlika});
        const postavkeRazclenjene = selectedPostavke.map((p: any) => {
          const total = Number(p.skupaj);
          const stopnja = Number(p.davek);
          return {
            ime: p.ime,
            kolicina: p.kolicina,
            skupaj: total,
            davek: stopnja,
            ddv: izracunajDDVZaokrozen(total, stopnja)};
        });
        res.status(422).json({
          code: "DDV_NESKLADJE",
          error: err instanceof Error ? err.message : String(err),
          razlika,
          skupajNarocilo: narociloSkupaj,
          skupajIzPostavk,
          postavke: postavkeRazclenjene});
        return;
      }
    }
  }

  const nastavitveMap = await readAll("", tenotaId);
  const nastavitve = toResponse(nastavitveMap);
  const fursNacin: "simulacija" | "testno" | "produkcija" = nastavitve.fursNacin;

  const rawSumupCheckoutId = typeof (parsed.data as { sumupCheckoutId?: unknown }).sumupCheckoutId === "string"
    ? (parsed.data as { sumupCheckoutId: string }).sumupCheckoutId.trim()
    : "";
  const rawVivaTerminalSessionId = typeof (parsed.data as { vivaTerminalSessionId?: unknown }).vivaTerminalSessionId === "string"
    ? (parsed.data as { vivaTerminalSessionId: string }).vivaTerminalSessionId.trim()
    : "";
  const rawVivaTransactionId = typeof (parsed.data as { vivaTransactionId?: unknown }).vivaTransactionId === "string"
    ? (parsed.data as { vivaTransactionId: string }).vivaTransactionId.trim()
    : "";
  const rawVivaOrderCode = typeof (parsed.data as { vivaOrderCode?: unknown }).vivaOrderCode === "string"
    ? (parsed.data as { vivaOrderCode: string }).vivaOrderCode.trim()
    : "";
  // Mešano plačilo (npr. darilni bon + kartica + napitnina) je terminalska
  // transakcija, če ima po normalizaciji dejanski kartični del prodaje.
  const isCardPayment = hasCardTerminalCharge(normalizedKartica, napitnina);
  let sumupCheckoutId = isCardPayment ? rawSumupCheckoutId : "";
  let vivaTerminalSessionId = isCardPayment ? rawVivaTerminalSessionId : "";
  const vivaTransactionId = isCardPayment ? rawVivaTransactionId : "";
  let vivaOrderCode = isCardPayment ? rawVivaOrderCode : "";
  const paymentAttemptId = isCardPayment ? (parsed.data as { paymentAttemptId?: string }).paymentAttemptId?.trim() ?? "" : "";
  // This field is intentionally not part of OpenAPI: terminal recovery is a
  // handwritten POS flow. It carries no provider data, only the durable attempt
  // that the operator explicitly selected immediately before issuing.
  const recoverySelectedAttemptId = typeof req.body?.recoverySelectedAttemptId === "string"
    ? req.body.recoverySelectedAttemptId.trim()
    : "";
  const recoverySelectionToken = typeof req.body?.recoverySelectionToken === "string"
    ? req.body.recoverySelectionToken.trim()
    : "";
  if (!isCardPayment && (rawSumupCheckoutId || rawVivaTerminalSessionId)) {
    res.status(400).json({ error: "Terminalska referenca zahteva pozitiven kartični del plačila." });
    return;
  }
  if (sumupCheckoutId && vivaTerminalSessionId) {
    res.status(400).json({ error: "Kartično plačilo lahko vsebuje samo eno terminalsko referenco." });
    return;
  }
  if (isCardPayment && !paymentAttemptId) {
    res.status(400).json({ error: "Kartični del računa zahteva paymentAttemptId uspešno zaključenega plačila." });
    return;
  }
  if (
    sumupCheckoutId.length > 255
    || vivaTerminalSessionId.length > 255
    || vivaTransactionId.length > 255
    || vivaOrderCode.length > 255
  ) {
    res.status(400).json({ error: "Terminalska referenca je predolga." });
    return;
  }
  if (sumupCheckoutId || vivaTerminalSessionId) {
    const karticnaReferenca = sumupCheckoutId
      ? `sumup:${sumupCheckoutId}`
      : `viva-terminal:${vivaTerminalSessionId}`;
    const [usedReceipt] = await db.select({ id: racuniTable.id }).from(racuniTable)
      .where(sumupCheckoutId
        ? eq(racuniTable.sumupCheckoutId, sumupCheckoutId)
        : eq(racuniTable.vivaTerminalSessionId, vivaTerminalSessionId))
      .limit(1);
    const [usedGiftIssue] = await db.select({ id: darilniBonIzdajeTable.id }).from(darilniBonIzdajeTable)
      .where(and(
        eq(darilniBonIzdajeTable.companyId, companyId),
        eq(darilniBonIzdajeTable.karticnaReferenca, karticnaReferenca),
      ))
      .limit(1);
    if (usedReceipt || usedGiftIssue) {
      res.status(409).json({ error: "Terminalska referenca je že uporabljena pri drugem računu." });
      return;
    }
  }

  // The browser-provided terminal identifiers are only display metadata.  The
  // durable attempt is the authority for provider, order and charged amount.
  // This happens before the FURS call; the receipt's unique FK below makes a
  // completed attempt consumable by exactly one receipt even under races.
  let cardPaymentAttempt: typeof posKarticnaPlacilaAttemptTable.$inferSelect | null = null;
  if (isCardPayment) {
    const browserExpectedProvider = (sumupCheckoutId || vivaTerminalSessionId || vivaOrderCode)
      ? expectedCardPaymentProvider({
      sumupCheckoutId,
      vivaTerminalSessionId,
      vivaOrderCode,
      vivaTransactionId,
      })
      : null;
    cardPaymentAttempt = await db.query.posKarticnaPlacilaAttemptTable.findFirst({
      where: and(
        cardPaymentAttemptIdentifierPredicate(paymentAttemptId),
        eq(posKarticnaPlacilaAttemptTable.companyId, companyId),
        eq(posKarticnaPlacilaAttemptTable.enotaId, tenotaId),
        eq(posKarticnaPlacilaAttemptTable.narociloId, narocilo.id),
        unconsumedCompletedCardAttemptPredicate(),
      ),
    }) ?? null;
    // Simulation has no client terminal reference. It is admissible only under
    // the same development/unit conditions that created the durable attempt.
    const isSimulationAttempt = cardPaymentAttempt?.provider === "simulacija";
    const [simulationUnit] = isSimulationAttempt
      ? await db.select({ capabilities: enoteTable.capabilities }).from(enoteTable).where(and(
          eq(enoteTable.id, tenotaId), eq(enoteTable.companyId, companyId),
        )).limit(1)
      : [];
    const simulationAllowed = process.env.NODE_ENV !== "production"
      && nastavitve.fursNacin === "simulacija"
      && simulationUnit?.capabilities.includes("simulation") === true;
    const expectedReference = sumupCheckoutId || vivaTerminalSessionId || vivaOrderCode;
    if (!cardPaymentAttempt
      || cardPaymentAttempt.purpose !== "receipt"
      || cardPaymentAttempt.status !== "completed"
      || (isSimulationAttempt ? !simulationAllowed : browserExpectedProvider !== null && cardPaymentAttempt.provider !== browserExpectedProvider)
      || Number(cardPaymentAttempt.znesek) !== Number(normalizedKartica.toFixed(2))
      || (!isSimulationAttempt && !cardPaymentEvidenceMatchesReceipt({
        evidenceJson: cardPaymentAttempt.rezultatJson,
        cardTotalEur: normalizedKartica,
        tipEur: napitnina,
        tipPaymentMethod,
      }))
      || !cardPaymentAttempt.providerReferenca
      || (expectedReference && cardPaymentAttempt.providerReferenca !== expectedReference)) {
      res.status(409).json({ error: "Kartični payment attempt ni potrjen ali ne ustreza naročilu, ponudniku, referenci oziroma znesku računa." });
      return;
    }
    if (recoverySelectedAttemptId && recoverySelectedAttemptId !== cardPaymentAttempt.id) {
      res.status(409).json({ error: "Izbrani poskus obnovitve se ne ujema s kartičnim plačilom računa." });
      return;
    }
    if (Boolean(recoverySelectedAttemptId) !== Boolean(recoverySelectionToken)
      || (recoverySelectionToken && !/^[A-Za-z0-9_-]{43}$/.test(recoverySelectionToken))) {
      res.status(400).json({ error: "Obnovitev kartičnega plačila zahteva veljavno, izrecno izbiro." });
      return;
    }
    // Po osvežitvi brskalnik morda nima več ponudnikove reference. Trajni,
    // strežniško potrjeni attempt je avtoritativni vir za fiskalni račun.
    if (!expectedReference) {
      const restoredReferences = receiptProviderReferenceFields(
        cardPaymentAttempt.provider,
        cardPaymentAttempt.providerReferenca,
      );
      sumupCheckoutId = restoredReferences.sumupCheckoutId ?? "";
      vivaTerminalSessionId = restoredReferences.vivaTerminalSessionId ?? "";
      vivaOrderCode = restoredReferences.vivaOrderCode ?? "";
    }
  }

  const register = await resolveReceiptRegister(
    tenotaId,
    parsed.data.blagajnaId,
    nastavitve.poslovniProstor,
    nastavitve.elektronskaNaprava,
  );
  if (!register.ok) {
    res.status(register.status).json({ code: register.code, error: register.error });
    return;
  }
  const { activePP, activeBId } = register;

  if (recoverySelectedAttemptId && cardPaymentAttempt) {
    const headerDeviceKey = req.headers["x-naprava-id"];
    const deviceKey = typeof (req as any).napravaKljuc === "string"
      ? (req as any).napravaKljuc
      : typeof headerDeviceKey === "string" ? headerDeviceKey : null;
    const validSelection = await hasFreshRecoverySelectionClaim({
      enotaId: tenotaId,
      attemptId: cardPaymentAttempt.id,
      narociloId: narocilo.id,
      amountCents: Math.round(normalizedKartica * 100),
      actorUserId: String((req as any).clerkUserId ?? ""),
      deviceKey,
      selectionToken: recoverySelectionToken,
    });
    if (!validSelection) {
      res.status(409).json({ error: "Izbira obnovitve je potekla, ne ustreza trenutnemu uporabniku/napravi ali ni veljavna." });
      return;
    }
  }

  // ── Z-zaklep: prepreči račun na zaklenjen dan ─────────────────────────────
  {
    const { checkZDnevniZaklep, getCurrentPoslovniDatum } = await import("../../lib/pos-z-helpers");
    const [activeBlagajna] = await db.select({ id: blagajneTable.id })
      .from(blagajneTable)
      .where(and(
        eq(blagajneTable.ppId, activePP),
        eq(blagajneTable.bId, activeBId),
        eq(blagajneTable.enotaId, tenotaId),
      ))
      .limit(1);
    if (activeBlagajna) {
      const pDatum = await getCurrentPoslovniDatum(tenotaId);
      const zLocked = await checkZDnevniZaklep(tenotaId, activeBlagajna.id, pDatum);
      if (zLocked) {
        res.status(409).json({
          code: "Z_ZAKLEP",
          error: `Blagajna za dan ${pDatum} je zaklenjena z Z-poročilom. Odprite naslednji dan ali jo odklenite.`,
        });
        return;
      }
    }
  }

  const opozoriloNastavljeno = register.usedLegacyFallback && register.legacyDefaultsMissing
    ? "Prodajni prostor ali blagajna ni nastavljena — račun izdan s privzetimi vrednostmi. Preverite nastavitve blagajne."
    : null;

  const effectiveFursNacin: "simulacija" | "testno" | "produkcija" = opozoriloNastavljeno ? "simulacija" : fursNacin;
  const recoveryAuditDeviceKey = recoverySelectedAttemptId && cardPaymentAttempt
    ? ((req as PosRequest & { napravaKljuc?: string }).napravaKljuc
      ?? (typeof req.headers["x-naprava-id"] === "string" ? req.headers["x-naprava-id"] : null))
    : null;

  const [issueReservation] = await db.insert(racunIzdajaZahteveTable).values({
    companyId,
    enotaId: tenotaId,
    narociloId: narocilo.id,
    blagajnaKljuc: `${activePP}:${activeBId}`,
    idempotencyKey,
    payloadHash,
    cardPaymentAttemptId: cardPaymentAttempt?.id ?? null,
  }).onConflictDoNothing().returning({ id: racunIzdajaZahteveTable.id });
  if (!issueReservation) {
    const [conflictingAttemptRequest] = cardPaymentAttempt
      ? await db.select().from(racunIzdajaZahteveTable).where(
          eq(racunIzdajaZahteveTable.cardPaymentAttemptId, cardPaymentAttempt.id),
        ).limit(1)
      : [];
    if (conflictingAttemptRequest) {
      res.status(409).json({
        code: "CARD_PAYMENT_ATTEMPT_ALREADY_USED",
        error: "Kartično plačilo je že rezervirano ali uporabljeno pri drugem računu.",
      });
      return;
    }
    const [conflictingRequest] = await db.select().from(racunIzdajaZahteveTable).where(and(
      eq(racunIzdajaZahteveTable.companyId, companyId),
      eq(racunIzdajaZahteveTable.enotaId, tenotaId),
      eq(racunIzdajaZahteveTable.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (conflictingRequest?.payloadHash && conflictingRequest.payloadHash !== payloadHash) {
      res.status(409).json({ code: "IDEMPOTENCY_PAYLOAD_MISMATCH", error: "Isti ključ izdaje je bil že uporabljen z drugačnimi podatki." });
      return;
    }
    res.status(409).json({
      code: conflictingRequest ? "ISSUE_IN_PROGRESS" : "REGISTER_ISSUE_IN_PROGRESS",
      error: conflictingRequest
        ? "Izdaja računa z istim ključem že poteka."
        : "Na tej blagajni že poteka druga izdaja računa. Počakajte, da se zaključi.",
    });
    return;
  }

  const stevilkaRacuna = await nextStevilkaRacun(activePP, activeBId, tenotaId);

  let natakarIme: string | null = null;
  let natakarDavcna: string | null = null;
  const attributedNatakarId = (req as any).posActorNatakarId ?? parsed.data.natakariId;
  let izmenaId: number | null = null;
  if (attributedNatakarId) {
    const [openShift] = await db
      .select({ id: izmeneTable.id })
      .from(izmeneTable)
      .where(and(
        eq(izmeneTable.natakariId, attributedNatakarId),
        isNull(izmeneTable.konec),
        eq(izmeneTable.enotaId, tenotaId),
      ));
    const [openBreak] = openShift
      ? await db.select({ id: odmoriTable.id }).from(odmoriTable)
        .where(and(eq(odmoriTable.izmenaId, openShift.id), isNull(odmoriTable.konec))).limit(1)
      : [];
    const [natakar] = await db
      .select()
      .from(natakariTable)
      .where(and(eq(natakariTable.id, attributedNatakarId), eq(natakariTable.companyId, companyId)));
    if (natakar && openShift && !openBreak) {
      natakarIme = `${natakar.ime} ${natakar.priimek}`;
      natakarDavcna = natakar.davcnaStevilka ?? null;
      izmenaId = openShift.id;
    }
  }

  const fursPostavke: FursSnapshotPayload["postavke"] = [];
  const receiptPostavke = (selectedPostavke as any[]).filter((p) => !isInternalMulticourseMenuComponent(p));
  for (const p of receiptPostavke) {
    const customCena = (partnerCenikMap && p.artikelId) ? partnerCenikMap.get(p.artikelId) : undefined;
    const origCena = customCena !== undefined ? customCena : Number(p.cenaKos);
    const bonPopust = bonPicaPopustMap.get(p.id);
    if (bonPopust && bonPopust.reducedAmount > 0 && origCena > 0) {
      const placaneKol = Number(p.kolicina) - bonPopust.pokriteKol;
      if (placaneKol > 0) fursPostavke.push({ ime: p.ime, kolicina: placaneKol, cenaKos: origCena, davek: Number(p.davek) });
      fursPostavke.push({ ime: p.ime, kolicina: bonPopust.pokriteKol, cenaKos: 0, davek: Number(p.davek) });
    } else {
      fursPostavke.push({ ime: p.ime, kolicina: Number(p.kolicina), cenaKos: origCena, davek: Number(p.davek) });
    }
  }
  if (tipTreatment.mode === "employer_controlled" && napitnina > 0) {
    fursPostavke.push({
      ime: "Napitnina", kolicina: 1, cenaKos: napitnina,
      davek: Number(nastavitveMap["ddvSplosnaSt"] ?? "22"),
    });
  }
  const canonicalFursPayload: FursSnapshotPayload = {
    stevilkaRacuna,
    datumCas: datumCas.toISOString(),
    skupaj,
    ddv,
    placilnaNacin: (["negotovinsko", "reprezentanca", "lastna_poraba"].includes(parsed.data.placilnaNacin) ? "other" : parsed.data.placilnaNacin) as FursSnapshotPayload["placilnaNacin"],
    postavke: fursPostavke,
    davcnaStevilka: nastavitve.davcnaStevilka,
    poslovnaProstor: activePP,
    blagajnaId: activeBId,
    operatorDavcna: natakarDavcna ?? undefined,
    kupecDavcnaStevilka: (parsed.data as { kupecDavcnaStevilka?: string | null }).kupecDavcnaStevilka ?? undefined,
  };
  const initialFursRequestHash = snapshotHash(canonicalFursPayload);
  const splosnaStopnja = Number(nastavitveMap["ddvSplosnaSt"] ?? "22");

  // ZOI izračunamo lokalno PRED klicem FURS — zagotovi ZOI na izpisu tudi ko FURS ni dosegljiv
  const companyCert = await pridobiCompanyCert(companyId);
  const certPem = companyCert?.certPem;
  const certKljuc = companyCert?.certKljuc;
  const zoiLokalno = izracunajZOILokalno(
    stevilkaRacuna,
    datumCas,
    skupaj,
    nastavitve.davcnaStevilka ?? "12345678",
    activePP,
    activeBId,
    effectiveFursNacin,
    certKljuc,
  );
  const terminalReferenceReservation = await reserveTerminalPaymentReference(
    companyId,
    sumupCheckoutId,
    vivaTerminalSessionId,
  );
  if ((sumupCheckoutId || vivaTerminalSessionId) && !terminalReferenceReservation) {
    await db.delete(racunIzdajaZahteveTable).where(eq(racunIzdajaZahteveTable.id, issueReservation.id));
    res.status(409).json({ error: "Terminalska referenca je že uporabljena pri drugem računu." });
    return;
  }
  const zalogaMovements = await buildZalogaMovementPlan(
    selectedPostavke as any[], stevilkaRacuna, datumCas,
  );
  const initialFursAttemptId = randomUUID();
  const initialFursActor = (req as any).clerkUserId ?? "pos";
  let racun!: typeof racuniTable.$inferSelect;
  let fursSnapshot: { id: typeof fursPayloadSnapshotsTable.$inferSelect["id"] };
  try {
    fursSnapshot = await db.transaction(async tx => {
    const [snapshot] = await tx.insert(fursPayloadSnapshotsTable).values({
      companyId, enotaId: tenotaId, operationKey: `racun:${issueReservation.id}`,
      issueReservationId: issueReservation.id, payload: canonicalFursPayload,
      requestHash: initialFursRequestHash, fursNacin: effectiveFursNacin,
      preskociPreverjanje: izrednaOpomba !== null || jeReprezentancaAliLastna,
      splosnaStopnja: splosnaStopnja.toFixed(2),
      signingContextFingerprint: signingContextFingerprint(effectiveFursNacin, companyCert?.certPem),
    }).returning({ id: fursPayloadSnapshotsTable.id });
    [racun] = await tx.insert(racuniTable).values({
      enotaId: tenotaId, narociloId: narocilo.id, stevilkaRacuna, datumCas, ustvarjeno: datumCas,
      localReceiptId: issueReservation.id,
      skupaj: skupaj.toFixed(2), ddv: ddv.toFixed(2), osnova: osnova.toFixed(2),
      placilnaNacin: parsed.data.placilnaNacin, status: "napaka",
      fursState: "sending", fursClaimedAt: new Date(), fursClaimedBy: initialFursAttemptId,
      requestHash: initialFursRequestHash, natakarIme, natakarDavcna, izmenaId,
      opomba: izrednaOpomba, jeDelni, znesekNapitnina: napitnina.toFixed(2),
      tipPaymentMethod,
      znesekGotovina: (parsed.data.znesekGotovina != null || (!suppliedPaymentFields && parsed.data.placilnaNacin === "gotovina")) ? normalizedGotovina.toFixed(2) : null,
      znesekKartica: (parsed.data.znesekKartica != null || (!suppliedPaymentFields && parsed.data.placilnaNacin === "kartica")) ? normalizedKartica.toFixed(2) : null,
      znesekBon: parsed.data.znesekBon != null ? Number(parsed.data.znesekBon).toFixed(2) : null,
      steviloBonov: parsed.data.steviloBonov ?? null,
      znesekBonPica: parsed.data.znesekBonPica != null ? Number(parsed.data.znesekBonPica).toFixed(2) : null,
      znesekSubvencija: znesekSubvencija.toFixed(2), sspReferenca,
      znesekNegotovinsko: (parsed.data as any).znesekNegotovinsko != null ? Number((parsed.data as any).znesekNegotovinsko).toFixed(2) : null,
      tipPolicyId: tipTreatment.policy?.id ?? null, tipPolicyMode: tipTreatment.mode,
      tipCardFeeTreatment: tipTreatment.policy?.cardFeeTreatment ?? null,
      tipCardFeeKind: tipTreatment.policy?.cardFeeKind ?? null,
      tipCardFeeTaxTreatment: tipTreatment.feeTaxTreatment,
      tipVatAmount: tipTreatment.vatAmount.toFixed(2), tipCardFeeAmount: tipTreatment.feeAmount.toFixed(2),
      tipCardFeeFlatAmount: tipTreatment.flatFeeAmount.toFixed(2),
      kupecDavcnaStevilka: (parsed.data as any).kupecDavcnaStevilka ?? null,
      kupecNaziv: (parsed.data as any).kupecNaziv ?? null, kupecNaslov: (parsed.data as any).kupecNaslov ?? null,
      kupecZavezanecDdv: (parsed.data as any).kupecZavezanecDdv ?? null,
      kupecId: typeof kupecId === "number" ? kupecId : null, kupecCpId: typeof kupecId === "string" ? kupecId : null,
      sumupCheckoutId: sumupCheckoutId || null, vivaTerminalSessionId: vivaTerminalSessionId || null,
      vivaTransactionId: vivaTransactionId || null, vivaOrderCode: vivaOrderCode || null,
      cardPaymentAttemptId: cardPaymentAttempt?.id ?? null,
    }).returning();
    if (individualVoucherCode) {
      await reserveIndividualVoucherForReceipt(tx, {
        companyId, code: individualVoucherCode, operationId: issueReservation.id,
        amountCents: individualVoucherAmountCents, receiptId: racun.id,
      });
    }
    const stockMovements = await captureStockMovementIntents(tx, zalogaMovements);
    const vatGroupMap = new Map<number, { gross: number; vat: number }>();
    for (const line of fursPostavke) {
      const gross = round2(Number(line.skupaj ?? Number(line.kolicina) * Number(line.cenaKos)));
      const rate = Number(line.davek);
      const group = vatGroupMap.get(rate) ?? { gross: 0, vat: 0 };
      group.gross = round2(group.gross + gross);
      group.vat = round2(group.vat + izracunajDDVZaokrozen(gross, rate));
      vatGroupMap.set(rate, group);
    }
    const businessDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Ljubljana" }).format(datumCas);
    let distributionProfile: FinalizationPlan["tip"]["distributionProfile"] = null;
    if (tipTreatment.policy && tipTreatment.mode === "direct_employee") {
      const [profile] = await tx.select().from(tipDistributionProfilesTable).where(and(
        eq(tipDistributionProfilesTable.companyId, companyId),
        eq(tipDistributionProfilesTable.enotaId, tenotaId),
        sql`${tipDistributionProfilesTable.effectiveFrom} <= ${businessDate}::date`,
        or(isNull(tipDistributionProfilesTable.effectiveTo), sql`${tipDistributionProfilesTable.effectiveTo} >= ${businessDate}::date`),
      )).orderBy(sql`${tipDistributionProfilesTable.effectiveFrom} DESC`).limit(1);
      if (profile) {
        const entries = await tx.select().from(tipDistributionProfileEntriesTable)
          .where(eq(tipDistributionProfileEntriesTable.profileId, profile.id))
          .orderBy(sql`${tipDistributionProfileEntriesTable.createdAt} ASC`);
        const total = entries.reduce((sum, entry) => sum + Number(entry.sharePercent), 0);
        if (entries.length > 0 && Math.abs(total - 100) <= 0.0001) {
          distributionProfile = {
            id: profile.id,
            name: profile.name,
            entries: entries.map(entry => ({
              id: entry.id,
              groupName: entry.groupName,
              recipientNatakarId: entry.recipientNatakarId,
              recipientSnapshot: entry.recipientSnapshot,
              sharePercent: Number(entry.sharePercent),
            })),
          };
        }
      }
    }
    const ppBSequence = Number(stevilkaRacuna.slice(stevilkaRacuna.lastIndexOf("-") + 1));
    const finalizationPlan = createFinalizationPlan({
      version: 2,
      source: "online",
      sourceOperationId: issueReservation.id,
      receipt: {
        localReceiptId: issueReservation.id, serverRacunId: racun.id,
        companyId, enotaId: tenotaId, orderId: narocilo.id,
        legalNumber: stevilkaRacuna, pp: activePP, b: activeBId, ppBSequence,
        issuedAt: datumCas.toISOString(), isPartial: jeDelni,
      },
      soldLines: selectedPostavke.map((p: any) => {
        const customPrice = p.artikelId ? partnerCenikMap?.get(p.artikelId) : undefined;
        const unitGross = customPrice ?? Number(p.cenaKos);
        return {
          id: p.id, articleId: p.artikelId ?? null, modifierId: p.modifikatorId ?? null,
          name: String(p.ime), quantity: Number(p.kolicina), unitGross,
          gross: round2(unitGross * Number(p.kolicina)), vatRate: Number(p.davek),
          normativeFactor: p.normativFaktor == null ? null : Number(p.normativFaktor),
          articleKind: p.vrstaArtikla ?? null,
        };
      }),
      normativeSnapshot: stockMovements.map(movement => ({
        articleId: movement.articleId, quantity: movement.quantity,
      })),
      totals: {
        gross: skupaj, net: osnova, vat: ddv,
        vatGroups: [...vatGroupMap.entries()].sort(([a], [b]) => a - b)
          .map(([rate, group]) => ({ rate, gross: group.gross, vat: group.vat })),
      },
      payment: {
        method: parsed.data.placilnaNacin, cash: normalizedGotovina, card: normalizedKartica,
        voucher: Number(parsed.data.znesekBon ?? 0), pizzaVoucher: Number(parsed.data.znesekBonPica ?? 0),
        nonCash: Number((parsed.data as any).znesekNegotovinsko ?? 0),
        terminalReferenceReservationId: terminalReferenceReservation?.id ?? null,
        cardPaymentAttemptId: cardPaymentAttempt?.id ?? null,
        giftVoucherRedemption: individualVoucherCode ? 0 : Number(parsed.data.znesekBon ?? 0),
        individualVoucherRedemptionCents: individualVoucherCode ? individualVoucherAmountCents : null,
      },
      operator: {
        waiterId: attributedNatakarId ?? null, name: natakarIme, taxNumber: natakarDavcna,
        shiftId: izmenaId, actor: initialFursActor,
      },
      closure: {
        allLinesCovered: allPostavke.filter(p => p.racunId !== null).length + selectedPostavke.length >= allPostavke.length,
        closeOrder: allPostavke.filter(p => p.racunId !== null).length + selectedPostavke.length >= allPostavke.length,
        orderId: narocilo.id, tableId: narocilo.mizaId ?? null, clearTipAmount: napitnina > 0,
      },
      tip: {
        amount: napitnina, mode: tipTreatment.mode, policyId: tipTreatment.policy?.id ?? null,
        feeAmount: tipTreatment.policy?.cardFeeTreatment === "deduct_from_tip" ? tipTreatment.feeAmount : 0,
        netAmount: tipTreatment.employeeLiability,
        distributionProfile,
      },
      stockMovements,
      // Receipt finalization currently has no KDS mutation; recording the empty
      // intent prevents a future executor from inferring one from live lines.
      kds: { effects: [] },
      accounting: {
        companyId,
        businessDate,
        syncAfterCommit: true,
      },
      print: {
        receiptNumber: stevilkaRacuna, issuedAt: datumCas.toISOString(),
        customerName: (parsed.data as any).kupecNaziv ?? null,
        customerAddress: (parsed.data as any).kupecNaslov ?? null,
        customerTaxNumber: (parsed.data as any).kupecDavcnaStevilka ?? null,
      },
      reservations: { issueReservationId: issueReservation.id },
      furs: {
        snapshotId: snapshot.id, requestHash: initialFursRequestHash,
        canonicalArtifactLink: `furs-payload-snapshot:${snapshot.id}:${initialFursRequestHash}`,
      },
    } satisfies FinalizationPlan);
    await tx.insert(racunFinalizationPlansTable).values({
      racunId: racun.id, companyId, enotaId: tenotaId, sourceOperationId: issueReservation.id,
      localReceiptId: finalizationPlan.receipt.localReceiptId, plan: finalizationPlan,
      planHash: finalizationPlanHash(finalizationPlan),
    });
    const reservedLines = await tx.update(postavkeTable).set({ racunId: racun.id })
      .where(and(inArray(postavkeTable.id, selectedPostavke.map((p: any) => p.id)), isNull(postavkeTable.racunId)))
      .returning({ id: postavkeTable.id });
    if (reservedLines.length !== selectedPostavke.length) {
      throw Object.assign(new Error("Izbrane postavke je sočasno rezerviral drug račun."), {
        code: "COMMERCIAL_GROUP_ALREADY_RESERVED",
      });
    }
    await tx.update(fursPayloadSnapshotsTable).set({ racunId: racun.id }).where(eq(fursPayloadSnapshotsTable.id, snapshot.id));
    // The register-wide "processing" reservation only serializes receipt stub
    // creation and number allocation. Once the immutable receipt, FURS
    // snapshot and finalization plan exist, later receipts may safely reserve
    // the next number even while this receipt awaits FURS reconciliation.
    await tx.update(racunIzdajaZahteveTable).set({
      status: "completed",
      racunId: racun.id,
      posodobljeno: new Date(),
    })
      .where(eq(racunIzdajaZahteveTable.id, issueReservation.id));
    await tx.insert(fursAttemptsTable).values({
      racunId: racun.id, attemptId: initialFursAttemptId, requestHash: initialFursRequestHash, actor: initialFursActor,
    });
    if (recoverySelectedAttemptId && cardPaymentAttempt) {
      const posReq = req as PosRequest;
      await writePosActorAudit(query => tx.execute(query), {
        enotaId: tenotaId,
        natakarId: posReq.posActorNatakarId ?? null,
        actorClerkUserId: posReq.clerkUserId,
        action: "card_payment_recovery_completed",
        metadata: {
          attemptId: cardPaymentAttempt.id,
          orderId: narocilo.id,
          receiptId: racun.id,
          amountCents: Math.round(normalizedKartica * 100),
          provider: cardPaymentAttempt.provider,
          deviceKey: recoveryAuditDeviceKey,
        },
      });
    }
    return snapshot;
    });
  } catch (error) {
    const cleanup = await Promise.allSettled([
      setTerminalPaymentReferenceStatus(terminalReferenceReservation?.id ?? null, "failed"),
      db.delete(racunIzdajaZahteveTable).where(eq(racunIzdajaZahteveTable.id, issueReservation.id)),
    ]);
    for (const result of cleanup) {
      if (result.status === "rejected") {
        req.log.error({ err: result.reason }, "Čiščenje neuspele začetne izdaje računa ni uspelo");
      }
    }
    const errorCode = (error as { code?: string }).code;
    if (errorCode === "INDIVIDUAL_VOUCHER_UNAVAILABLE") {
      res.status(Number((error as { status?: number }).status) || 409).json({
        code: errorCode, error: error instanceof Error ? error.message : "Spletnega bona ni mogoče rezervirati.",
        ...((error as { balanceCents?: number }).balanceCents != null
          ? { balanceCents: (error as { balanceCents: number }).balanceCents }
          : {}),
      });
      return;
    }
    if (errorCode !== "COMMERCIAL_GROUP_ALREADY_RESERVED") throw error;
    res.status(409).json({ code: errorCode, error: "Celotno sestavljeno postavko je sočasno rezerviral drug račun." });
    return;
  }

  let fursOdgovor: Awaited<ReturnType<typeof posljiNaFURS>>;
  let fursTransportUnknown = false;
  if ((nastavitveMap["simulirajFursNapako"] ?? "false") === "true") {
    req.log.warn({ stevilkaRacuna }, "simulirajFursNapako=true — FURS klic preskočen, račun shranjen z napako");
    fursOdgovor = { uspeh: false, zoi: zoiLokalno, eor: null, napaka: "Simulirana napaka sistema FURS: Storitev trenutno ni na voljo (S100)", surovOdgovor: "simulacija" } as unknown as Awaited<ReturnType<typeof posljiNaFURS>>;
  } else
  try {
    fursOdgovor = await posljiNaFURS(
      snapshotToFursData(canonicalFursPayload, companyCert, nastavitve.fursProxyUrl),
      effectiveFursNacin,
      izrednaOpomba !== null || jeReprezentancaAliLastna,
      splosnaStopnja
    );
  } catch (err) {
    const sporocilo = err instanceof Error ? err.message : String(err);
    if (sporocilo.startsWith("DDV neskladje") || sporocilo.startsWith("Neskladje med skupaj")) {
      req.log.warn(
        { stevilkaRacuna, ddv, steviloPostavk: selectedPostavke.length, napaka: sporocilo },
        "DDV neskladje pred oddajo na FURS — račun zavrnjen"
      );
      await setTerminalPaymentReferenceStatus(terminalReferenceReservation?.id ?? null, "failed");
      const validationFinishedAt = new Date();
      await db.transaction(async tx => {
        await tx.update(racuniTable).set({
          fursState: "failed", status: "napaka", fursClaimedAt: null, fursClaimedBy: null,
          fursLastAttemptAt: validationFinishedAt, fursLastError: sporocilo, fursAttemptCount: 1,
        }).where(and(eq(racuniTable.id, racun.id), eq(racuniTable.fursClaimedBy, initialFursAttemptId)));
        await tx.update(fursAttemptsTable).set({
          finishedAt: validationFinishedAt, outcome: "failed", rawError: sporocilo,
        }).where(eq(fursAttemptsTable.attemptId, initialFursAttemptId));
        await tx.update(racunIzdajaZahteveTable).set({ status: "unknown", posodobljeno: validationFinishedAt })
          .where(eq(racunIzdajaZahteveTable.id, issueReservation.id));
      });
      res.status(422).json({ code: "DDV_NESKLADJE", error: sporocilo });
      return;
    }
    // FURS nedosegljiv (omrežna napaka, timeout) — račun shranimo z napako za kasnejšo registracijo
    req.log.warn(
      { stevilkaRacuna, ddv, steviloPostavk: selectedPostavke.length, napaka: sporocilo },
      "FURS nedosegljiv — račun shranjen z napako za kasnejšo registracijo"
    );
    fursTransportUnknown = true;
    fursOdgovor = { uspeh: false, zoi: zoiLokalno, eor: null, napaka: sporocilo, surovOdgovor: "omrežna napaka" } as unknown as Awaited<ReturnType<typeof posljiNaFURS>>;
  }

  const fursState = fursOutcome(fursOdgovor, fursTransportUnknown);
  const status = fursState === "confirmed" ? (effectiveFursNacin !== "produkcija" ? "testni" : "poslan") : "napaka";

  let fursNapakaSporocilo: string | null = null;
  if (!fursOdgovor.uspeh && fursOdgovor.napaka) {
    fursNapakaSporocilo = prevediFursNapako(fursOdgovor.napaka);
    req.log.warn(
      { stevilkaRacuna, napaka: fursOdgovor.napaka, prevod: fursNapakaSporocilo },
      "Fiskalizacija ni uspela — račun shranjen z napako"
    );
  }

  let darilniBonOpozorilo: string | null = null;
  try {
    [racun] = await db.update(racuniTable).set({
    enotaId: tenotaId,
    narociloId: narocilo.id,
    stevilkaRacuna,
    datumCas,
    ustvarjeno: datumCas,
    skupaj: String(skupaj.toFixed(2)),
    ddv: String(ddv.toFixed(2)),
    osnova: String(osnova.toFixed(2)),
    placilnaNacin: parsed.data.placilnaNacin as "gotovina" | "kartica" | "bon" | "bon_pica" | "negotovinsko" | "reprezentanca" | "lastna_poraba",
    status,
    zoi: fursOdgovor.zoi || zoiLokalno || null,
    eor: fursOdgovor.eor || null,
    fursOdgovor: fursOdgovor.surovOdgovor,
    fursState,
    fursAttemptCount: 1,
    fursLastAttemptAt: new Date(),
    fursLastError: fursState === "confirmed" ? null : (fursOdgovor.napaka ?? null),
    fursConfirmedAt: fursState === "confirmed" ? new Date() : null,
    fursClaimedAt: null,
    fursClaimedBy: null,
    requestHash: initialFursRequestHash,
    natakarIme,
    natakarDavcna,
    izmenaId,
    opomba: izrednaOpomba,
    jeDelni,
    znesekGotovina: (parsed.data.znesekGotovina != null || (!suppliedPaymentFields && parsed.data.placilnaNacin === "gotovina")) ? normalizedGotovina.toFixed(2) : null,
    znesekKartica: (parsed.data.znesekKartica != null || (!suppliedPaymentFields && parsed.data.placilnaNacin === "kartica")) ? normalizedKartica.toFixed(2) : null,
    znesekNapitnina: napitnina.toFixed(2),
    tipPaymentMethod,
    tipPolicyId: tipTreatment.policy?.id ?? null,
    tipPolicyMode: tipTreatment.mode,
    tipCardFeeTreatment: tipTreatment.policy?.cardFeeTreatment ?? null,
    tipCardFeeKind: tipTreatment.policy?.cardFeeKind ?? null,
    tipCardFeeTaxTreatment: tipTreatment.feeTaxTreatment,
    tipVatAmount: tipTreatment.vatAmount.toFixed(2),
    tipCardFeeAmount: tipTreatment.feeAmount.toFixed(2),
    tipCardFeeFlatAmount: tipTreatment.flatFeeAmount.toFixed(2),
    znesekBon: parsed.data.znesekBon != null ? String((parsed.data.znesekBon as number).toFixed(2)) : null,
    steviloBonov: parsed.data.steviloBonov ?? null,
    znesekBonPica: parsed.data.znesekBonPica != null ? String((parsed.data.znesekBonPica as number).toFixed(2)) : null,
    znesekSubvencija: znesekSubvencija.toFixed(2),
    sspReferenca,
    znesekNegotovinsko: (parsed.data as { znesekNegotovinsko?: number | null }).znesekNegotovinsko != null ? String(((parsed.data as { znesekNegotovinsko?: number | null }).znesekNegotovinsko as number).toFixed(2)) : null,
    dniOdloga: (parsed.data as { dniOdloga?: number | null }).dniOdloga ?? null,
    izdaniKuponi: (parsed.data as { izdaniKuponi?: number | null }).izdaniKuponi ?? null,
    kupecDavcnaStevilka: (parsed.data as { kupecDavcnaStevilka?: string | null }).kupecDavcnaStevilka ?? null,
    kupecNaziv: (parsed.data as { kupecNaziv?: string | null }).kupecNaziv ?? null,
    kupecNaslov: (parsed.data as { kupecNaslov?: string | null }).kupecNaslov ?? null,
    kupecZavezanecDdv: (parsed.data as { kupecZavezanecDdv?: boolean | null }).kupecZavezanecDdv ?? null,
    kupecId: typeof kupecId === "number" ? kupecId : null,
    kupecCpId: typeof kupecId === "string" ? kupecId : null,
      sumupCheckoutId: sumupCheckoutId || null,
      vivaTerminalSessionId: vivaTerminalSessionId || null,
      vivaTransactionId: vivaTransactionId || null,
      vivaOrderCode: vivaOrderCode || null,
      cardPaymentAttemptId: cardPaymentAttempt?.id ?? null,
    }).where(and(
      eq(racuniTable.id, racun.id),
      eq(racuniTable.fursState, "sending"),
      eq(racuniTable.fursClaimedBy, initialFursAttemptId),
    )).returning();
    if (!racun) {
      const casError = "FURS odgovor ni bil pripet: initial claim token se ne ujema. Potrebna je ročna uskladitev.";
      await db.update(fursAttemptsTable).set({
        finishedAt: new Date(), outcome: "unknown", rawError: casError,
      }).where(eq(fursAttemptsTable.attemptId, initialFursAttemptId));
      await db.update(racunIzdajaZahteveTable).set({ status: "unknown", posodobljeno: new Date() })
        .where(eq(racunIzdajaZahteveTable.id, issueReservation.id));
      res.status(202).json({ fursState: "unknown", error: casError });
      return;
    }
    await db.update(fursAttemptsTable).set({
      finishedAt: new Date(), outcome: fursState, rawResponse: fursOdgovor.surovOdgovor,
      rawError: fursState === "confirmed" ? null : (fursOdgovor.napaka ?? null),
    }).where(eq(fursAttemptsTable.attemptId, initialFursAttemptId));
    // All confirmed-receipt business effects, including tip allocation and
    // payment-reference consumption, are committed by executeFinalizationPlan.
  } catch (err) {
    await setTerminalPaymentReferenceStatus(terminalReferenceReservation?.id ?? null, "failed");
    await db.update(racunIzdajaZahteveTable).set({
      status: "unknown",
      posodobljeno: new Date(),
    }).where(eq(racunIzdajaZahteveTable.id, issueReservation.id));
    throw err;
  }

  if (fursState !== "confirmed") {
    res.status(fursState === "unknown" ? 202 : 422).json({
      id: racun.id,
      stevilkaRacuna: racun.stevilkaRacuna,
      fursState,
      status: racun.status,
      error: fursNapakaSporocilo ?? "FURS oddaja ni bila potrjena.",
    });
    return;
  }
  await db.transaction(async tx => {
    await finalizeConfirmedStandardReceipt(tx, racun.id, (req as any).clerkUserId ?? "pos");
  });

  // znesekBon je izključno večnamenski darilni bon. Bon za pico ima ločen
  // znesekBonPica in ga ta evidenca nikoli ne upošteva.
  const unovceniDarilniBon = individualVoucherCode ? 0 : Number(parsed.data.znesekBon ?? 0);
  if (unovceniDarilniBon > 0.005) {
    await db.insert(darilniBonGibiTable).values({
      companyId,
      racunId: racun.id,
      tip: "unovcitev",
      znesek: unovceniDarilniBon.toFixed(2),
    }).onConflictDoNothing();
    const [bookingSettings] = await db.select({
      warnGiftVoucherNegative: posBookingSettingsTable.warnGiftVoucherNegative,
    }).from(posBookingSettingsTable).where(eq(posBookingSettingsTable.companyId, companyId)).limit(1);
    if (bookingSettings?.warnGiftVoucherNegative ?? true) {
      const stanje = await getDarilniBonStanje(companyId);
      if (stanje.odprto < -0.005) {
        darilniBonOpozorilo =
          `Unovčeni darilni boni presegajo evidentirano izdajo za ${Math.abs(stanje.odprto).toFixed(2)} €. ` +
          "Račun je izdan; preverite morebitne bone, izdane pred uvedbo evidence.";
      }
    }
  }

  // Auto-upsert frequent customer when kupecNaziv is set
  const _kupecNaziv = (parsed.data as { kupecNaziv?: string | null }).kupecNaziv ?? null;
  if (_kupecNaziv) {
    upsertPogostKupec({
      companyId,
      naziv: _kupecNaziv,
      naslov: (parsed.data as { kupecNaslov?: string | null }).kupecNaslov ?? null,
      davcnaStevilka: (parsed.data as { kupecDavcnaStevilka?: string | null }).kupecDavcnaStevilka ?? null}).catch(err => logger.warn({ err }, "upsertPogostKupec failed"));
  }

  // Mark covered postavke with this receipt's ID.
  // Cenik-adjusted prices are NOT written back to postavke (that would break the
  // order-level consistency check). Instead, kupecId is stored on the racun so
  // the print route can apply cenik dynamically when generating the receipt.
  await db.update(postavkeTable)
    .set({ racunId: racun.id })
    .where(inArray(postavkeTable.id, selectedPostavke.map((p: any) => p.id)));

  // Inventory is applied exclusively by finalizeConfirmedStandardReceipt from
  // the immutable pre-FURS movement plan.
  if (false) await db.transaction(async (tx) => {
    const prizadetiArtikelIds: number[] = [];
    for (const postavka of selectedPostavke) {
      if (postavka.artikelId == null) continue;
      // Prepared portions consume materials at daily preparation close, while
      // composite parents are only a menu grouping and never consume their own
      // normative at receipt posting.
      const [saleArticle] = await tx.select({ mealType: artikliTable.mealType })
        .from(artikliTable).where(eq(artikliTable.id, postavka.artikelId));
      if (saleArticle?.mealType === "prepared") continue;
      if (saleArticle?.mealType === "composite") {
        // Composite itself has no material recipe at sale. Its validated
        // components are only ala_carte/prepared: recurse one level through
        // each ala_carte component recipe; prepared portions are counted by
        // the daily prepared ledger and never consume ingredients here.
        const components = await tx.select().from(normativiTable)
          .where(eq(normativiTable.artikelId, postavka.artikelId));
        for (const component of components) {
          const [componentArticle] = await tx.select({
            mealType: artikliTable.mealType,
          }).from(artikliTable).where(eq(artikliTable.id, component.vhodniArtikelId));
          if (componentArticle?.mealType !== "ala_carte") continue;
          const componentNorms = await tx.select().from(normativiTable)
            .where(eq(normativiTable.artikelId, component.vhodniArtikelId));
          for (const normativ of componentNorms) {
            const [vhodniArtikel] = await tx.select({ enotaMere: artikliTable.enotaMere })
              .from(artikliTable).where(eq(artikliTable.id, normativ.vhodniArtikelId));
            const porabljeno = porabaZaVelikostPice(
              Number(normativ.kolicina) * Number(component.kolicina) * postavka.kolicina,
              Number(postavka.normativFaktor ?? 1),
              vhodniArtikel?.enotaMere ?? null,
            );
            await tx.insert(zalogaGibiTable).values({
              artikelId: normativ.vhodniArtikelId, tip: "poraba", kolicina: String(-porabljeno),
              opomba: `Račun ${stevilkaRacuna}`, referencaId: racun.id, ustvarjeno: datumCas,
            });
            if (!prizadetiArtikelIds.includes(normativ.vhodniArtikelId)) prizadetiArtikelIds.push(normativ.vhodniArtikelId);
          }
        }
        continue;
      }
      const normativi = await tx.select().from(normativiTable).where(eq(normativiTable.artikelId, postavka.artikelId));
      for (const normativ of normativi) {
        const [vhodniArtikel] = await tx.select({ enotaMere: artikliTable.enotaMere })
          .from(artikliTable).where(eq(artikliTable.id, normativ.vhodniArtikelId));
        const faktor = Number(postavka.normativFaktor ?? 1);
        const porabljeno = porabaZaVelikostPice(Number(normativ.kolicina) * postavka.kolicina, faktor, vhodniArtikel?.enotaMere ?? null);
        await tx.insert(zalogaGibiTable).values({
          artikelId: normativ.vhodniArtikelId,
          tip: "poraba",
          kolicina: String(-porabljeno),
          opomba: `Račun ${stevilkaRacuna}`,
          referencaId: racun.id,
          ustvarjeno: datumCas});
        if (!prizadetiArtikelIds.includes(normativ.vhodniArtikelId)) {
          prizadetiArtikelIds.push(normativ.vhodniArtikelId);
        }
      }
    }
    // Razknjiženje sestavin modifikatorjev
    const postavkaById = new Map(selectedPostavke.map((postavka: any) => [postavka.id, postavka]));
    for (const postavka of selectedPostavke) {
      if (postavka.modifikatorId == null) continue;
      const modNormativi = await tx.select({
        id: modNormativiTable.id,
        modifikatorId: modNormativiTable.modifikatorId,
        vhodniArtikelId: modNormativiTable.vhodniArtikelId,
        kolicina: modNormativiTable.kolicina,
        vrstniRed: modNormativiTable.vrstniRed,
        cenaDodatek: modifikatorjiTable.cenaDodatek,
      }).from(modNormativiTable)
        .innerJoin(modifikatorjiTable, eq(modifikatorjiTable.id, modNormativiTable.modifikatorId))
        .where(eq(modNormativiTable.modifikatorId, postavka.modifikatorId));
      for (const mn of modNormativi) {
        const [vhodniArtikel] = await tx.select({ enotaMere: artikliTable.enotaMere })
          .from(artikliTable).where(eq(artikliTable.id, mn.vhodniArtikelId));
        const isNestedModifier = postavka.modifierSourceArticleId != null;
        const nestedParent = isNestedModifier && postavka.parentPostavkaId != null
          ? postavkaById.get(postavka.parentPostavkaId)
          : undefined;
        const normativFactor = isNestedModifier
          ? faktorNormativaPodModifikatorja(
            Number(postavka.normativFaktor ?? 1),
            nestedParent?.normativFaktor ?? 1,
          )
          : Number(postavka.normativFaktor ?? 1);
        const faktor = faktorNormativaModifikatorja(
          normativFactor,
          mn.cenaDodatek,
          isNestedModifier,
        );
        const porabljeno = porabaZaVelikostPice(
          Number(mn.kolicina) * postavka.kolicina,
          faktor,
          vhodniArtikel?.enotaMere ?? null,
          isNestedModifier,
        );
        await tx.insert(zalogaGibiTable).values({
          artikelId: mn.vhodniArtikelId,
          tip: "poraba",
          kolicina: String(-porabljeno),
          opomba: `Račun ${stevilkaRacuna}`,
          referencaId: racun.id,
          ustvarjeno: datumCas});
        if (!prizadetiArtikelIds.includes(mn.vhodniArtikelId)) {
          prizadetiArtikelIds.push(mn.vhodniArtikelId);
        }
      }
    }
    await recomputeZaloge(prizadetiArtikelIds, tx);
    if (napitnina > 0) {
      await tx.update(narocilaTable)
        .set({ znesekNapitnina: "0.00" })
        .where(eq(narocilaTable.id, narocilo.id));
    }
  });

  // Close order only when all postavke are now covered by receipts
  const coveredBeforeThis = allPostavke.filter(p => p.racunId !== null).length;
  const allCovered = coveredBeforeThis + selectedPostavke.length >= allPostavke.length;

  if (allCovered) {
    await db.update(narocilaTable).set({ status: "zakljuceno" }).where(eq(narocilaTable.id, narocilo.id));

    if (narocilo.mizaId != null) {
      const activeNarocila = await db
        .select()
        .from(narocilaTable)
        .where(and(eq(narocilaTable.mizaId, narocilo.mizaId), sql`true`, eq(narocilaTable.enotaId, tenotaId)));
      const hasOpenOrders = activeNarocila.some((n) => n.status === "odprto");
      if (!hasOpenOrders) {
        await db.update(mizeTable).set({
          status: "prosta",
          rezervacijaNarocnikId: null,
          rezervacijaStrankaIme: null,
          rezervacijaTelefon: null,
          rezervacijaOpomba: null,
          rezervacijaVeljaDo: null,
        }).where(and(
          eq(mizeTable.id, narocilo.mizaId),
          eq(mizeTable.enotaId, tenotaId),
          sql`NOT EXISTS (
            SELECT 1
            FROM ${narocilaTable}
            WHERE ${narocilaTable.mizaId} = ${mizeTable.id}
              AND ${narocilaTable.enotaId} = ${tenotaId}
              AND ${narocilaTable.status} = 'odprto'
          )`,
        ));
      }
    }
  }

  const [withMiza] = await db
    .select({
      id: racuniTable.id,
      narociloId: racuniTable.narociloId,
      stevilkaRacuna: racuniTable.stevilkaRacuna,
      skupaj: racuniTable.skupaj,
      ddv: racuniTable.ddv,
      osnova: racuniTable.osnova,
      placilnaNacin: racuniTable.placilnaNacin,
      status: racuniTable.status,
      zoi: racuniTable.zoi,
      eor: racuniTable.eor,
      fursOdgovor: racuniTable.fursOdgovor,
      ustvarjeno: racuniTable.ustvarjeno,
      datumCas: racuniTable.datumCas,
      mizaStevilka: mizeTable.stevilka,
      opomba: racuniTable.opomba,
      znesekGotovina: racuniTable.znesekGotovina,
      znesekKartica: racuniTable.znesekKartica,
      znesekNapitnina: racuniTable.znesekNapitnina,
      znesekBon: racuniTable.znesekBon,
      steviloBonov: racuniTable.steviloBonov,
      znesekBonPica: racuniTable.znesekBonPica,
      znesekSubvencija: racuniTable.znesekSubvencija,
      sspReferenca: racuniTable.sspReferenca,
      jeDelni: racuniTable.jeDelni,
      kupecDavcnaStevilka: racuniTable.kupecDavcnaStevilka,
      kupecNaziv: racuniTable.kupecNaziv,
      kupecNaslov: racuniTable.kupecNaslov,
      sumupCheckoutId: racuniTable.sumupCheckoutId,
      vivaTerminalSessionId: racuniTable.vivaTerminalSessionId,
      vivaTransactionId: racuniTable.vivaTransactionId,
      vivaOrderCode: racuniTable.vivaOrderCode})
    .from(racuniTable)
    .leftJoin(narocilaTable, eq(racuniTable.narociloId, narocilaTable.id))
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .where(eq(racuniTable.id, racun.id));

  if (fursState === "confirmed") {
    await db.transaction(tx => finalizeConfirmedStandardReceipt(
      tx, racun.id, (req as any).clerkUserId ?? "pos",
    ));
  }

  broadcastToUnit((req as any).enotaId, "update", { type: "racun" });

  // POS → ERP samodejni knjižni osnutki (fire-and-forget, ne blokira odgovora)
  setImmediate(() => {
    const datum = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Ljubljana" }).format(datumCas);
    syncPosBookingForDay(companyId, datum).catch(err => console.warn("[POS sync]", err));
  });

  // ── e-račun generiranje (fire-and-forget, ne blokira odgovora, ne sme pokvariti fiskalizacije) ──
  const jeNegotovinsko = parsed.data.placilnaNacin === "negotovinsko";
  if (jeNegotovinsko && kupecId != null && fursOdgovor.uspeh) {
    setImmediate(async () => {
      try {
        // Naloži kupca iz skupnega šifranta (kupecCpId je UUID)
        const kupecCpId = racun.kupecCpId ?? (typeof kupecId === "string" ? kupecId : null);
        if (!kupecCpId) { req.log.debug({ racunId: racun.id }, "e-račun preskočen: ni kupec_cp_id"); return; }
        const [kupec] = await db.select().from(counterpartiesTable)
          .where(eq(counterpartiesTable.id, kupecCpId));
        if (!kupec?.eRacunPrejemnik || !kupec.taxId) {
          req.log.debug({ racunId: racun.id, kupecId }, "e-račun preskočen: kupec nima eRacunPrejemnik ali davčne");
          return;
        }

        // Naloži podatke podjetja
        const [podjetje] = await db.select().from(companiesTable)
          .where(eq(companiesTable.id, companyId));
        if (!podjetje) {
          req.log.warn({ racunId: racun.id, companyId }, "e-račun: podjetje ni najdeno");
          return;
        }

        // Zgradi vhod za generator
        assertPackagingVatMatchesParent(receiptPostavke.map(p => ({
          ime: String(p.ime),
          kolicina: Number(p.kolicina),
          cenaKos: Number(p.cenaKos),
          skupaj: Number(p.skupaj),
          davek: Number(p.davek ?? "22"),
          postavkaId: p.id,
          parentPostavkaId: p.parentPostavkaId ?? null,
          jeEmbalaza: p.jeEmbalaza === true,
        })));
        const eracunPostavke = projectPackagingDisplayPrices(receiptPostavke.map(p => {
          const customCena = (partnerCenikMap && p.artikelId) ? partnerCenikMap.get(p.artikelId) : undefined;
          const cenaBruto = customCena !== undefined ? customCena : Number(p.cenaKos);
          return {
            postavkaId: p.id,
            ime: String(p.ime),
            kolicina: Number(p.kolicina),
            cenaKos: cenaBruto,
            skupaj: round2(cenaBruto * Number(p.kolicina)),
            davek: Number(p.davek ?? "22"),
            parentPostavkaId: p.parentPostavkaId ?? null,
            jeEmbalaza: p.jeEmbalaza === true,
            toGo: p.toGo === true,
          };
        }));
        const eracunVhod: EracunInput = {
          stevilkaRacuna,
          datumCas,
          dniOdloga: (parsed.data as { dniOdloga?: number | null }).dniOdloga ?? null,
          skupaj: skupaj,
          ddv: ddv,
          osnova: osnova,
          postavke: eracunPostavke.map(p => ({
            ime: p.ime,
            kolicina: String(p.kolicina),
            cenaBrutoKos: String(p.cenaKos),
            davek: String(p.davek),
          })),
          izdajatelj: {
            naziv: podjetje.naziv,
            ulica: podjetje.ulica,
            postnaStevika: podjetje.postnaStevika,
            kraj: podjetje.kraj,
            drzava: podjetje.drzava,
            kodaDrzave: podjetje.kodaDrzave,
            podjetjeDavcna: podjetje.podjetjeDavcna,
            idZaDdv: podjetje.idZaDdv,
            maticnaStevilka: podjetje.maticnaStevilka,
            trr: (podjetje.trr as Array<{ iban: string; bic: string }> | null) ?? [],
          },
          prejemnik: {
            naziv: kupec.name,
            naslov: kupec.address,
            ulica: kupec.ulica,
            postnaStevilka: kupec.postCode,
            kraj: kupec.city,
            drzava: kupec.country,
            kodaDrzave: kupec.kodaDrzave,
            davcnaStevilka: kupec.taxId,
            idZaDdv: kupec.idZaDdv,
            maticnaStevilka: kupec.registrationNumber,
            eRacunNaslov: kupec.eRacunNaslov,
            eRacunSifraPu: kupec.eRacunSifraPu,
            eRacunBic: kupec.eRacunBic,
            eRacunOmrezje: kupec.eRacunOmrezje,
            trr: (kupec.trr as Array<{ iban: string; bic: string }> | null) ?? [],
          },
        };

        const xml = generirajEracunXml(eracunVhod);

        // Generiraj PDF enkrat ob izdaji — ne vsakič ob prenosu
        let eRacunPdf: string | null = null;
        try {
          const pdfBuf = await generatePosInvoicePdf({
            companyName: podjetje.naziv,
            invoiceNumber: stevilkaRacuna,
            issuedAt: datumCas.toISOString().slice(0, 10),
            customerName: kupec.name,
            customerAddress: kupec.address ?? (kupec as Record<string, unknown>)["ulica"] as string | null ?? null,
            paymentMethod: "negotovinsko",
            total: String(skupaj),
            vat: String(ddv),
            items: projectPackagingDisplayPrices(receiptPostavke.map(p => ({
              postavkaId: p.id,
              ime: String(p.ime),
              kolicina: Number(p.kolicina),
              cenaKos: Number(p.cenaKos),
              skupaj: Number(p.skupaj),
              davek: Number(p.davek ?? "22"),
              parentPostavkaId: p.parentPostavkaId ?? null,
              jeEmbalaza: p.jeEmbalaza === true,
              toGo: p.toGo === true,
            }))).map(p => ({
              name: p.ime,
              quantity: String(p.kolicina),
              unitPrice: String(p.cenaKos),
              total: String(p.skupaj),
              vatRate: String(p.davek),
              isPackaging: p.jeEmbalaza === true,
            })),
          });
          eRacunPdf = pdfBuf.toString("base64");
        } catch (pdfErr) {
          req.log.warn({ racunId: racun.id }, `e-račun PDF generiranje neuspešno: ${String(pdfErr)}`);
        }

        await db.update(racuniTable).set({
          eRacunXml: xml,
          eRacunPdf,
          eRacunStatus: "pripravljen",
          eRacunDatum: new Date(),
          eRacunNapaka: null,
        }).where(eq(racuniTable.id, racun.id));

        req.log.info({ racunId: racun.id, stevilkaRacuna, hasPdf: !!eRacunPdf }, "e-račun XML in PDF generirani in shranjeni");
      } catch (err) {
        const sporocilo = err instanceof Error ? err.message : String(err);
        req.log.warn({ racunId: racun.id, stevilkaRacuna, err: sporocilo }, "e-račun generiranje neuspešno");
        // Shrani napako, ne sme izjemiti
        await db.update(racuniTable).set({
          eRacunStatus: "napaka",
          eRacunNapaka: sporocilo,
        }).where(eq(racuniTable.id, racun.id)).catch(() => {});
      }
    });
  }

  res.status(201).json(({
    ...withMiza,
    skupaj: Number(withMiza!.skupaj),
    ddv: Number(withMiza!.ddv),
    osnova: withMiza!.osnova != null ? Number(withMiza!.osnova) : null,
    zoi: withMiza!.zoi ?? null,
    eor: withMiza!.eor ?? null,
    fursOdgovor: withMiza!.fursOdgovor ?? null,
    mizaStevilka: withMiza!.mizaStevilka ?? null,
    fursNapaka: fursNapakaSporocilo ?? null,
    opomba: withMiza!.opomba ?? null,
    opozorilo: [opozoriloNastavljeno, darilniBonOpozorilo].filter(Boolean).join(" ") || null,
    jeDelni: withMiza!.jeDelni ?? false,
    znesekGotovina: withMiza!.znesekGotovina != null ? Number(withMiza!.znesekGotovina) : null,
    znesekKartica: withMiza!.znesekKartica != null ? Number(withMiza!.znesekKartica) : null,
    znesekNapitnina: Number(withMiza!.znesekNapitnina ?? 0),
    znesekBon: withMiza!.znesekBon != null ? Number(withMiza!.znesekBon) : null,
    steviloBonov: withMiza!.steviloBonov ?? null,
    znesekBonPica: withMiza!.znesekBonPica != null ? Number(withMiza!.znesekBonPica) : null,
    znesekSubvencija: withMiza!.znesekSubvencija != null ? Number(withMiza!.znesekSubvencija) : null,
    sspReferenca: withMiza!.sspReferenca ?? null,
    kupecDavcnaStevilka: withMiza!.kupecDavcnaStevilka ?? null,
    kupecNaziv: withMiza!.kupecNaziv ?? null,
    kupecNaslov: withMiza!.kupecNaslov ?? null,
    sumupCheckoutId: withMiza!.sumupCheckoutId ?? null,
    vivaTerminalSessionId: withMiza!.vivaTerminalSessionId ?? null,
    vivaTransactionId: withMiza!.vivaTransactionId ?? null,
    vivaOrderCode: withMiza!.vivaOrderCode ?? null}));
});

export function releasedFursClaimFields() {
  return {
    fursClaimedAt: null,
    fursClaimedBy: null,
    fursClaimBatchId: null,
    fursClaimLeaseUntil: null,
  };
}

async function retryClaimedFurs(racun: typeof racuniTable.$inferSelect, tenotaId: number, companyId: string, actor: string) {
  const [snapshot] = await db.select().from(fursPayloadSnapshotsTable)
    .where(and(eq(fursPayloadSnapshotsTable.racunId, racun.id), eq(fursPayloadSnapshotsTable.companyId, companyId)))
    .limit(1);
  const payload = snapshot?.payload as FursSnapshotPayload | undefined;
  const requestHash = payload ? snapshotHash(payload) : "";
  if (!snapshot || !payload || requestHash !== snapshot.requestHash || racun.requestHash !== snapshot.requestHash) {
    const now = new Date(), attemptId = randomUUID(), error = "Ponovitev ni varna: manjka veljaven kanonični FURS payload snapshot ali se njegov hash ne ujema.";
    await db.transaction(async tx => {
      await tx.update(racuniTable).set({
        fursState: "failed", ...releasedFursClaimFields(),
        fursLastAttemptAt: now, fursLastError: error,
        fursAttemptCount: sql`${racuniTable.fursAttemptCount} + 1`,
      }).where(eq(racuniTable.id, racun.id));
      await tx.insert(fursAttemptsTable).values({ racunId: racun.id, attemptId, requestHash: racun.requestHash ?? (requestHash || "missing-snapshot"), finishedAt: now, outcome: "failed", rawError: error, actor });
    });
    return { uspeh: false, napaka: "Manjka veljaven nespremenljiv FURS snapshot; potrebna je ročna uskladitev." };
  }
  const attemptId = randomUUID();
  const nastavitveMap = await readAll("", tenotaId);
  const nastavitve = toResponse(nastavitveMap);
  const retryCert = await pridobiCompanyCert(companyId);
  const currentSigningFingerprint = signingContextFingerprint(snapshot.fursNacin, retryCert?.certPem);
  if (snapshot.signingContextFingerprint !== currentSigningFingerprint) {
    const now = new Date();
    const error = "FURS certifikat se je po prvotni oddaji spremenil; avtomatska ponovitev je blokirana in zahteva ročno uskladitev.";
    await db.transaction(async tx => {
      await tx.update(racuniTable).set({
        fursState: "failed", ...releasedFursClaimFields(),
        fursLastAttemptAt: now, fursLastError: error,
      }).where(eq(racuniTable.id, racun.id));
      await tx.insert(fursAttemptsTable).values({
        racunId: racun.id, attemptId, requestHash, finishedAt: now,
        outcome: "failed", rawError: error, actor,
      });
    });
    return { uspeh: false, napaka: error, outcome: "failed" as const };
  }
  await db.insert(fursAttemptsTable).values({ racunId: racun.id, attemptId, requestHash, actor });
  let odgovor: Awaited<ReturnType<typeof posljiNaFURS>>;
  let transportUnknown = false;
  try {
    odgovor = await posljiNaFURS(
      snapshotToFursData(payload, retryCert, nastavitve.fursProxyUrl),
      snapshot.fursNacin,
      snapshot.preskociPreverjanje,
      Number(snapshot.splosnaStopnja),
    );
  } catch (err) {
    transportUnknown = true;
    const napaka = err instanceof Error ? err.message : String(err);
    odgovor = { uspeh: false, zoi: racun.zoi ?? "", eor: "", napaka, surovOdgovor: "omrežna napaka" };
  }
  const outcome = fursOutcome(odgovor, transportUnknown);
  const now = new Date();
  let casApplied = false;
  await db.transaction(async tx => {
    const finalized = await tx.update(racuniTable).set({
      status: outcome === "confirmed" ? (snapshot.fursNacin === "produkcija" ? "poslan" : "testni") : "napaka",
      fursState: outcome, fursAttemptCount: sql`${racuniTable.fursAttemptCount} + 1`, fursLastAttemptAt: now,
      fursLastError: outcome === "confirmed" ? null : (odgovor.napaka ?? null), fursConfirmedAt: outcome === "confirmed" ? now : null,
      ...releasedFursClaimFields(),
      zoi: odgovor.zoi || racun.zoi, eor: outcome === "confirmed" ? odgovor.eor : null, fursOdgovor: odgovor.surovOdgovor,
    }).where(and(
      eq(racuniTable.id, racun.id),
      eq(racuniTable.fursState, "sending"),
      eq(racuniTable.fursClaimedBy, racun.fursClaimedBy ?? ""),
    )).returning({ id: racuniTable.id });
    if (!finalized.length) {
      await tx.update(fursAttemptsTable).set({
        finishedAt: now, outcome: "unknown", rawError: "CAS claim miss; FURS izid zahteva ročno uskladitev.",
      }).where(eq(fursAttemptsTable.attemptId, attemptId));
      return;
    }
    casApplied = true;
    await tx.update(fursAttemptsTable).set({ finishedAt: now, outcome, rawResponse: odgovor.surovOdgovor, rawError: outcome === "confirmed" ? null : (odgovor.napaka ?? null) })
      .where(eq(fursAttemptsTable.attemptId, attemptId));
    if (outcome === "confirmed" && racun.jeStorno) {
      await finalizeConfirmedStorno(tx, racun.id, actor);
    }
    if (outcome === "confirmed" && racun.jeDarilniBonIzdaja) {
      await finalizeConfirmedGiftReceipt(tx, racun.id, companyId);
    }
    if (outcome === "confirmed" && !racun.jeStorno && !racun.jeDarilniBonIzdaja) {
      await finalizeConfirmedStandardReceipt(tx, racun.id, actor);
    }
  });
  if (!casApplied) {
    return { uspeh: false, eor: null, napaka: "CAS claim miss; FURS izid zahteva ročno uskladitev.", outcome: "unknown" as const };
  }
  return { uspeh: outcome === "confirmed", eor: odgovor.eor || null, napaka: odgovor.napaka ?? null, outcome };
}

async function claimFailedFurs(id: number, tenotaId: number, actor: string) {
  const claimToken = `${actor}:${randomUUID()}`;
  const [claimed] = await db.update(racuniTable).set({ fursState: "sending", fursClaimedAt: new Date(), fursClaimedBy: claimToken })
    .where(and(eq(racuniTable.id, id), eq(racuniTable.enotaId, tenotaId), eq(racuniTable.fursState, "failed"),
      or(isNull(racuniTable.fursClaimedAt), sql`${racuniTable.fursClaimedAt} < now() - interval '5 minutes'`))).returning();
  return claimed;
}

async function expireStaleFursClaim(tenotaId: number, id?: number): Promise<void> {
  await db.update(racuniTable).set({
    fursState: "unknown",
    ...releasedFursClaimFields(),
    fursLastError: "Prejšnji FURS poskus se ni zaključil. Zaradi zaščite pred dvojno oddajo je potrebna ročna uskladitev.",
  }).where(and(
    eq(racuniTable.enotaId, tenotaId),
    ...(id != null ? [eq(racuniTable.id, id)] : []),
    eq(racuniTable.fursState, "sending"),
    sql`${racuniTable.fursClaimedAt} < now() - interval '5 minutes'`,
  ));
}

router.post("/racuni/retry-furs-batch", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId, actor = (req as any).clerkUserId ?? "pos-batch", companyId = (req as any).companyId;
  await expireStaleFursClaim(tenotaId);
  // Claim the bounded work set in one transaction. SKIP LOCKED means another
  // worker never waits for or sends the same immutable snapshot.
  const batchId = randomUUID();
  const claimToken = `${actor}:${batchId}`;
  const candidates = await db.transaction(async tx => {
    const claimed = await tx.execute(sql`
      WITH candidates AS (
        SELECT id
        FROM racuni
        WHERE enota_id = ${tenotaId}
          AND furs_state = 'failed'
          AND request_hash IS NOT NULL
          AND (furs_claim_lease_until IS NULL OR furs_claim_lease_until < now())
        ORDER BY ustvarjeno
        FOR UPDATE SKIP LOCKED
        LIMIT 50
      )
      UPDATE racuni r
      SET furs_state = 'sending',
          furs_claimed_at = now(),
          furs_claimed_by = ${claimToken},
          furs_claim_batch_id = ${batchId}::uuid,
          furs_claim_lease_until = now() + interval '5 minutes'
      FROM candidates c
      WHERE r.id = c.id
      RETURNING r.id
    `);
    const ids = claimed.rows.map(row => Number((row as { id: number }).id)).filter(Number.isInteger);
    return ids.length
      ? tx.select().from(racuniTable).where(and(inArray(racuniTable.id, ids), eq(racuniTable.fursClaimedBy, claimToken)))
      : [];
  });
  const results = [];
  for (const candidate of candidates) {
    results.push({ id: candidate.id, stevilkaRacuna: candidate.stevilkaRacuna, ...(await retryClaimedFurs(candidate, tenotaId, companyId, actor)) });
  }
  if (results.some(r => r.uspeh)) broadcastToUnit(tenotaId, "update", { type: "racun" });
  res.json({ batchId, skupaj: results.length, uspesno: results.filter(r => r.uspeh).length, neuspesno: results.filter(r => !r.uspeh).length, racuni: results });
});

router.post("/racuni/:id/ponovi-furs", async (req, res): Promise<void> => {
  const id = Number(req.params.id), tenotaId = (req as any).enotaId, actor = (req as any).clerkUserId ?? "pos";
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Neveljaven ID računa." }); return; }
  await expireStaleFursClaim(tenotaId, id);
  const claimed = await claimFailedFurs(id, tenotaId, actor);
  if (!claimed) { res.status(409).json({ error: "Ponoviti je mogoče samo neuspešen, ne-zaklenjen FURS poskus. Neznanega izida ni dovoljeno samodejno poslati." }); return; }
  const result = await retryClaimedFurs(claimed, tenotaId, (req as any).companyId, actor);
  if (result.uspeh) broadcastToUnit(tenotaId, "update", { type: "racun" });
  res.json({ id, ...result });
});

export async function finalizeConfirmedStorno(tx: any, stornoRacunId: number, actor: string): Promise<void> {
  const locked = await tx.execute(sql`
    SELECT id, izvorni_racun_id, datum_cas, ustvarjeno, furs_state, storno_finalized_at
    FROM racuni WHERE id = ${stornoRacunId} AND je_storno = true FOR UPDATE
  `);
  const storno = locked.rows[0] as {
    id: number; izvorni_racun_id: number | null; datum_cas: Date | null;
    ustvarjeno: Date; furs_state: string; storno_finalized_at: Date | null;
  } | undefined;
  if (!storno || storno.furs_state !== "confirmed" || storno.storno_finalized_at || !storno.izvorni_racun_id) return;

  const [izvorni] = await tx.select().from(racuniTable)
    .where(eq(racuniTable.id, storno.izvorni_racun_id)).limit(1);
  if (!izvorni) throw new Error("Izvorni račun storna ne obstaja.");

  await tx.update(racuniTable).set({ status: "storniran" })
    .where(eq(racuniTable.id, izvorni.id));
  const voucherRedemptions = await tx.execute(sql`
    SELECT m.id, m.voucher_id, m.company_id, m.amount_cents
    FROM individual_voucher_movements m
    JOIN individual_vouchers v ON v.id = m.voucher_id
    WHERE m.receipt_id = ${izvorni.id} AND m.type = 'redeem'
    ORDER BY m.voucher_id
    FOR UPDATE OF m, v
  `);
  for (const redemption of voucherRedemptions.rows as Array<{
    id: string; voucher_id: string; company_id: string; amount_cents: number;
  }>) {
    const operationKey = `pos-storno:${storno.id}`;
    const reversal = await tx.execute(sql`
      INSERT INTO individual_voucher_movements
        (voucher_id, company_id, operation_key, type, amount_cents, receipt_id)
      VALUES (${redemption.voucher_id}, ${redemption.company_id}, ${operationKey},
              'reverse', ${redemption.amount_cents}, ${storno.id})
      ON CONFLICT (voucher_id, operation_key) DO NOTHING
      RETURNING id
    `);
    if (!reversal.rows.length) {
      const existingReversal = await tx.execute(sql`
        SELECT id FROM individual_voucher_movements
        WHERE voucher_id = ${redemption.voucher_id} AND operation_key = ${operationKey}
          AND type = 'reverse' AND amount_cents = ${redemption.amount_cents} AND receipt_id = ${storno.id}
      `);
      if (!existingReversal.rows.length) {
        throw new Error("Storno bona je v konfliktu z obstoječim gibanjem; potrebna je uskladitev.");
      }
    }
    await tx.execute(sql`
      UPDATE pos_individual_voucher_redemption_holds
      SET status = 'reversed', reversed_at = COALESCE(reversed_at, now())
      WHERE receipt_id = ${izvorni.id} AND voucher_id = ${redemption.voucher_id}
        AND status = 'committed'
    `);
    await tx.execute(sql`
      UPDATE individual_vouchers v
      SET status = CASE
        WHEN v.expires_at IS NOT NULL AND v.expires_at <= now() THEN 'spent'
        WHEN (
          SELECT COALESCE(sum(CASE WHEN m.type IN ('issue','reverse') THEN m.amount_cents ELSE -m.amount_cents END),0)
          FROM individual_voucher_movements m WHERE m.voucher_id = v.id
        ) > 0 THEN 'active'
        ELSE 'spent'
      END
      WHERE v.id = ${redemption.voucher_id}
    `);
  }
  await compensateTipAllocationsForReceipt(tx, {
    racunId: izvorni.id,
    actor,
    evidenceReference: `Fiskalni storno računa ${storno.id}`,
  });

  const porabe = await tx.select().from(zalogaGibiTable)
    .where(and(
      eq(zalogaGibiTable.referencaId, izvorni.id),
      eq(zalogaGibiTable.tip, "poraba"),
      or(
        eq(zalogaGibiTable.sourceSnapshot, "racun_finalization_plan"),
        and(
          isNull(zalogaGibiTable.sourceSnapshot),
          eq(zalogaGibiTable.opomba, `Račun ${izvorni.stevilkaRacuna}`),
        ),
      ),
    ));
  const prizadetiArtikelIds: number[] = [];
  for (const poraba of porabe) {
    const originalQuantity = Number(poraba.kolicina);
    const originalValue = poraba.vrednost == null ? null : Number(poraba.vrednost);
    const originalUnitCost = poraba.cenaKos == null
      ? (originalValue != null && originalQuantity !== 0 ? originalValue / originalQuantity : null)
      : Number(poraba.cenaKos);
    if (
      !Number.isFinite(originalQuantity)
      || originalUnitCost == null
      || !Number.isFinite(originalUnitCost)
      || (originalValue != null && !Number.isFinite(originalValue))
    ) {
      throw new Error(`Izvorno gibanje zaloge ${poraba.id} nima veljavnega nespremenljivega stroškovnega posnetka.`);
    }
    const reversalValue = originalValue == null
      ? -originalQuantity * originalUnitCost
      : -originalValue;
    await tx.insert(zalogaGibiTable).values({
      artikelId: poraba.artikelId,
      tip: "storno",
      kolicina: String(-originalQuantity),
      cenaKos: originalUnitCost.toFixed(6),
      vrednost: reversalValue.toFixed(4),
      opomba: `Storno računa ${izvorni.stevilkaRacuna}`,
      referencaId: stornoRacunId,
      reversalOfId: poraba.id,
      ustvarjeno: new Date(storno.datum_cas ?? storno.ustvarjeno),
      effectiveAtSnapshot: poraba.effectiveAtSnapshot,
      actorSnapshot: actor,
      sourceSnapshot: "racun_storno",
    });
    if (!prizadetiArtikelIds.includes(poraba.artikelId)) prizadetiArtikelIds.push(poraba.artikelId);
  }
  await recomputeZaloge(prizadetiArtikelIds, tx);
  await tx.update(racuniTable).set({ stornoFinalizedAt: new Date() })
    .where(and(eq(racuniTable.id, stornoRacunId), isNull(racuniTable.stornoFinalizedAt)));
}

async function finalizeConfirmedGiftReceipt(tx: any, racunId: number, companyId: string): Promise<void> {
  const locked = await tx.execute(sql`
    SELECT id, narocilo_id, skupaj, furs_state, business_finalized_at
    FROM racuni WHERE id = ${racunId} AND je_darilni_bon_izdaja = true FOR UPDATE
  `);
  const receipt = locked.rows[0] as {
    id: number; narocilo_id: number; skupaj: string; furs_state: string; business_finalized_at: Date | null;
  } | undefined;
  if (!receipt || receipt.furs_state !== "confirmed" || receipt.business_finalized_at) return;
  await tx.insert(darilniBonGibiTable).values({
    companyId, racunId, tip: "izdaja", znesek: Number(receipt.skupaj).toFixed(2),
  }).onConflictDoNothing();
  await tx.update(darilniBonIzdajeTable).set({ status: "issued", racunId })
    .where(eq(darilniBonIzdajeTable.racunId, racunId));
  await tx.update(narocilaTable).set({ status: "zakljuceno" })
    .where(eq(narocilaTable.id, receipt.narocilo_id));
  await tx.update(racuniTable).set({ businessFinalizedAt: new Date() })
    .where(and(eq(racuniTable.id, racunId), isNull(racuniTable.businessFinalizedAt)));
}

async function finalizeConfirmedStandardReceipt(tx: any, racunId: number, actor: string): Promise<boolean> {
  const [stored] = await tx.select().from(racunFinalizationPlansTable)
    .where(eq(racunFinalizationPlansTable.racunId, racunId)).limit(1);
  if (!stored) throw new Error("Immutable receipt finalization plan manjka.");
  const plan = stored.plan as FinalizationPlan;
  return (await executeFinalizationPlan(tx, racunId, plan.sourceOperationId, actor, plan)) !== null;
}

async function finalizeLegacyConfirmedReceipt(tx: any, racunId: number): Promise<void> {
  const locked = await tx.execute(sql`
    SELECT id, furs_state, business_finalized_at, narocilo_id, skupaj, je_storno, je_darilni_bon_izdaja,
           COALESCE(furs_confirmed_at, ustvarjeno) AS finalized_at
    FROM racuni
    WHERE id = ${racunId}
    FOR UPDATE
  `);
  const receipt = locked.rows[0] as {
    id: number;
    furs_state: string;
    business_finalized_at: Date | null;
    narocilo_id: number;
    skupaj: string;
    je_storno: boolean;
    je_darilni_bon_izdaja: boolean;
    finalized_at: Date;
  } | undefined;
  if (!receipt) throw Object.assign(new Error("Račun ne obstaja."), { status: 404 });
  if (receipt.business_finalized_at) return;
  if (receipt.furs_state !== "confirmed" || receipt.je_storno || receipt.je_darilni_bon_izdaja) {
    throw Object.assign(new Error("Ta račun ni primeren za ročno poslovno finalizacijo."), { status: 409 });
  }

  const verification = await tx.execute(sql`
    SELECT
      n.status AS narocilo_status,
      (SELECT COUNT(*)::int FROM postavke p WHERE p.narocilo_id = ${receipt.narocilo_id}) AS postavke,
      (SELECT COUNT(*)::int FROM postavke p WHERE p.narocilo_id = ${receipt.narocilo_id} AND p.racun_id = ${racunId}) AS vezane_postavke,
      (SELECT COALESCE(SUM(p.skupaj::numeric), 0) FROM postavke p WHERE p.narocilo_id = ${receipt.narocilo_id}) AS postavke_skupaj,
      (SELECT COUNT(*)::int FROM zaloga_gibi z WHERE z.referenca_id = ${racunId} AND z.tip = 'poraba') AS zaloga_gibi
    FROM narocila n
    WHERE n.id = ${receipt.narocilo_id}
  `);
  const check = verification.rows[0] as {
    narocilo_status: string;
    postavke: number;
    vezane_postavke: number;
    postavke_skupaj: string;
    zaloga_gibi: number;
  } | undefined;
  if (
    !check
    || check.narocilo_status !== "zakljuceno"
    || check.postavke < 1
    || check.postavke !== check.vezane_postavke
    || Number(check.postavke_skupaj) !== Number(receipt.skupaj)
    || check.zaloga_gibi < 1
  ) {
    throw Object.assign(
      new Error("Manjkajo dokazi, da so bili vsi poslovni učinki računa že izvedeni; potrebna je ročna uskladitev."),
      { status: 409 },
    );
  }

  await tx.update(racuniTable).set({ businessFinalizedAt: receipt.finalized_at })
    .where(and(eq(racuniTable.id, racunId), isNull(racuniTable.businessFinalizedAt)));
}

router.post("/racuni/:id/poslovna-finalizacija", async (req, res): Promise<void> => {
  const posReq = req as unknown as PosRequest;
  if (!["admin", "admin_enote", "superadmin"].includes(posReq.vloga)) {
    res.status(403).json({ error: "Poslovna finalizacija zahteva vodjo ali administratorja." });
    return;
  }
  const racunId = Number(req.params.id);
  if (!Number.isInteger(racunId) || racunId < 1) {
    res.status(400).json({ error: "Neveljaven ID računa." });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [receipt] = await tx.select({
        id: racuniTable.id,
        stevilkaRacuna: racuniTable.stevilkaRacuna,
        enotaId: racuniTable.enotaId,
        businessFinalizedAt: racuniTable.businessFinalizedAt,
      }).from(racuniTable).where(and(
        eq(racuniTable.id, racunId),
        eq(racuniTable.enotaId, posReq.enotaId),
      )).limit(1);
      if (!receipt) throw Object.assign(new Error("Račun ne obstaja v aktivni enoti."), { status: 404 });
      if (receipt.businessFinalizedAt) return receipt;

      const [plan] = await tx.select({ id: racunFinalizationPlansTable.id })
        .from(racunFinalizationPlansTable)
        .where(eq(racunFinalizationPlansTable.racunId, racunId))
        .limit(1);
      if (plan) {
        const finalized = await finalizeConfirmedStandardReceipt(
          tx, racunId, (posReq as any).clerkUserId ?? "pos-manual-finalization",
        );
        if (!finalized) throw Object.assign(new Error("Računa ni mogoče finalizirati."), { status: 409 });
      } else {
        await finalizeLegacyConfirmedReceipt(tx, racunId);
      }

      const [updated] = await tx.select({
        id: racuniTable.id,
        stevilkaRacuna: racuniTable.stevilkaRacuna,
        businessFinalizedAt: racuniTable.businessFinalizedAt,
      }).from(racuniTable).where(eq(racuniTable.id, racunId)).limit(1);
      return updated;
    });
    broadcastToUnit((req as any).enotaId, "update", { type: "racun" });
    res.json({ ...result, finalized: true });
  } catch (error: unknown) {
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status) : 500;
    const message = error instanceof Error ? error.message : "Poslovne finalizacije ni bilo mogoče dokončati.";
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
  }
});

router.post("/racuni/:id/poslji-email", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const { prejemnik } = req.body as { prejemnik?: string };
  if (!prejemnik || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prejemnik.trim())) {
    res.status(400).json({ error: "Neveljaven e-poštni naslov" });
    return;
  }

  const [racun] = await db
    .select({
      id: racuniTable.id,
      stevilkaRacuna: racuniTable.stevilkaRacuna,
      skupaj: racuniTable.skupaj,
      ddv: racuniTable.ddv,
      placilnaNacin: racuniTable.placilnaNacin,
      zoi: racuniTable.zoi,
      eor: racuniTable.eor,
      ustvarjeno: racuniTable.ustvarjeno})
    .from(racuniTable)
    .where(and(eq(racuniTable.id, id), sql`true`, eq(racuniTable.enotaId, tenotaId)));

  if (!racun) { res.status(404).json({ error: "Račun ni najden" }); return; }

  const nastavitveMap = await readAll("", tenotaId);
  const nastavitve = toResponse(nastavitveMap);

  const rezultat = await posljiEmailRacun(
    { ...nastavitve, smtpPassword: nastavitveMap["smtpPassword"] ?? "" },
    prejemnik.trim(),
    {
      stevilkaRacuna: racun.stevilkaRacuna,
      skupaj: Number(racun.skupaj),
      ddv: Number(racun.ddv),
      placilnaNacin: racun.placilnaNacin,
      zoi: racun.zoi ?? null,
      eor: racun.eor ?? null,
      ustvarjeno: racun.ustvarjeno},
    nastavitve.nazivRestavracije ?? nastavitve.davcnaStevilka ?? "",
  );

  res.json({ uspeh: rezultat.uspeh, napaka: rezultat.napaka ?? null });
});

router.post("/racuni/:id/storniraj", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }

  const [racun] = await db
    .select()
    .from(racuniTable)
    .where(and(eq(racuniTable.id, params.data.id), sql`true`, eq(racuniTable.enotaId, tenotaId)));

  if (!racun) { res.status(404).json({ error: "Račun ni najden" }); return; }
  if (racun.jeStorno) {
    res.status(400).json({ error: "Storno računa ni mogoče stornirati" }); return;
  }
  if (racun.status === "napaka") {
    res.status(400).json({ error: "Računa z napako FURS ni mogoče stornirati (FURS ga ni prejel — preprosto opustite ta račun)" }); return;
  }

  // Preveri da že ne obstaja storno tega računa
  const [obstojeciStorno] = await db
    .select({ id: racuniTable.id })
    .from(racuniTable)
    .where(and(eq(racuniTable.izvorniRacunId, racun.id), eq(racuniTable.jeStorno, true)));
  if (obstojeciStorno) {
    await respondWithExistingStorno(res, obstojeciStorno.id); return;
  }
  if (racun.status === "storniran") {
    res.status(409).json({ error: "Račun je označen kot storniran, pripadajoči storno dokument pa manjka." }); return;
  }
  // Naloži postavke izvornega računa za FURS zahtevek
  const izvornePostavke = await db.select().from(postavkeTable).where(eq(postavkeTable.racunId, racun.id));
  const [izvorniFursSnapshot] = await db.select().from(fursPayloadSnapshotsTable)
    .where(eq(fursPayloadSnapshotsTable.racunId, racun.id))
    .limit(1);
  const kandidatIzvorniPayload = izvorniFursSnapshot?.payload as FursSnapshotPayload | undefined;
  const imaVeljavenIzvorniSnapshot = Boolean(
    kandidatIzvorniPayload
    && snapshotHash(kandidatIzvorniPayload) === izvorniFursSnapshot?.requestHash
    && racun.requestHash === izvorniFursSnapshot?.requestHash,
  );
  const izvorniSnapshotPayload = imaVeljavenIzvorniSnapshot ? kandidatIzvorniPayload : undefined;
  if (!izvorniSnapshotPayload) {
    req.log.warn(
      { racunId: racun.id, stevilkaRacuna: racun.stevilkaRacuna },
      "Legacy storno brez veljavnega immutable FURS snapshota; payload bo zaradi operativne združljivosti rekonstruiran iz DB",
    );
  }

  // Storno: izda se kot nov račun z negativnimi zneski (FURS zahteva)
  const nastavitveMap = await readAll("", tenotaId);
  const nastavitve = toResponse(nastavitveMap);

  // Prevzami PP/B iz izvornega stevilkaRacuna (npr. "PP001-B001-000001" → PP001, B001)
  const ppBMatch = racun.stevilkaRacuna.match(/^(.+)-(.+)-\d+$/);
  const activePP = ppBMatch?.[1] ?? nastavitve.poslovniProstor ?? "PP001";
  const activeBId = ppBMatch?.[2] ?? nastavitve.elektronskaNaprava ?? "B001";

  const simulirajFursNapako = (nastavitveMap["simulirajFursNapako"] ?? "false") === "true";
  let stornoStevilka = "";

  // Negativni zneski za FURS
  const stornoSkupaj = round2(-Number(izvorniSnapshotPayload?.skupaj ?? racun.skupaj));
  const stornoDdv = round2(-Number(izvorniSnapshotPayload?.ddv ?? racun.ddv));

  // Negativne postavke za FURS izračun DDV skupin
  const stornoPostavkeFurs: FursSnapshotPayload["postavke"] = izvorniSnapshotPayload
    ? izvorniSnapshotPayload.postavke.map(p => ({
        ...p,
        kolicina: -p.kolicina,
        ...(p.skupaj === undefined ? {} : { skupaj: round2(-p.skupaj) }),
      }))
    : izvornePostavke
      .filter((p: any) => !isInternalMulticourseMenuComponent(p))
      .map((p: any) => ({
        ime: p.ime,
        kolicina: -p.kolicina,
        cenaKos: Number(p.cenaKos),
        davek: Number(p.davek),
      }));
  if (!izvorniSnapshotPayload && racun.tipPolicyMode === "employer_controlled" && Number(racun.znesekNapitnina ?? 0) !== 0) {
    stornoPostavkeFurs.push({
      ime: "Napitnina",
      kolicina: -1,
      cenaKos: Number(racun.znesekNapitnina),
      davek: Number(nastavitveMap["ddvSplosnaSt"] ?? "22"),
    });
  }

  const fursNacin: "simulacija" | "testno" | "produkcija" = (izvorniSnapshotPayload ? izvorniFursSnapshot?.fursNacin : undefined)
    ?? (racun.status === "poslan" ? "produkcija" : nastavitve.fursNacin);
  const datumCas = await getSimDatumOrNow(tenotaId);
  const stornoSplosnaStopnja = izvorniSnapshotPayload && izvorniFursSnapshot
    ? Number(izvorniFursSnapshot.splosnaStopnja)
    : Number(nastavitveMap["ddvSplosnaSt"] ?? "22");
  const stornoCompanyCert = await pridobiCompanyCert((req as any).companyId);
  let stornoRacun: typeof racuniTable.$inferSelect;
  let stornoPayload!: FursSnapshotPayload;
  try {
    stornoRacun = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM racuni WHERE id = ${racun.id} AND enota_id = ${tenotaId} FOR UPDATE`);
      const [already] = await tx.select().from(racuniTable)
        .where(and(eq(racuniTable.izvorniRacunId, racun.id), eq(racuniTable.jeStorno, true))).limit(1);
      if (already) throw Object.assign(new Error("already_reserved"), { code: "already_reserved", stornoId: already.id });

      // Izvorna vrstica je že zaklenjena: šele sedaj rezerviramo naslednjo številko.
      stornoStevilka = await nextStevilkaRacun(activePP, activeBId, tenotaId);
      stornoPayload = izvorniSnapshotPayload
        ? zgradiStornoPayloadIzSnapshota(izvorniSnapshotPayload, stornoStevilka, datumCas.toISOString())
        : {
            stevilkaRacuna: stornoStevilka,
            datumCas: datumCas.toISOString(),
            skupaj: stornoSkupaj,
            ddv: stornoDdv,
            placilnaNacin: (["negotovinsko", "reprezentanca", "lastna_poraba"].includes(racun.placilnaNacin) ? "other" : racun.placilnaNacin) as FursSnapshotPayload["placilnaNacin"],
            postavke: stornoPostavkeFurs,
            davcnaStevilka: nastavitve.davcnaStevilka,
            poslovnaProstor: activePP,
            blagajnaId: activeBId,
            operatorDavcna: racun.natakarDavcna ?? undefined,
            jeStorno: true,
            izvornaStevRacuna: racun.stevilkaRacuna,
            izvornaStevRacunaDatumCas: new Date(racun.datumCas ?? racun.ustvarjeno).toISOString(),
          };
      const requestHash = snapshotHash(stornoPayload);
      const [inserted] = await tx.insert(racuniTable).values({
        enotaId: tenotaId, narociloId: racun.narociloId, stevilkaRacuna: stornoStevilka,
        datumCas, ustvarjeno: datumCas, skupaj: stornoSkupaj.toFixed(2), ddv: stornoDdv.toFixed(2),
        osnova: round2(-Number(racun.osnova ?? 0)).toFixed(2), placilnaNacin: racun.placilnaNacin,
        status: "napaka", fursState: "pending", requestHash,
        natakarIme: racun.natakarIme, natakarDavcna: racun.natakarDavcna,
        opomba: `Storno računa ${racun.stevilkaRacuna}`, jeStorno: true,
        jeDarilniBonIzdaja: racun.jeDarilniBonIzdaja, izvorniRacunId: racun.id,
        znesekNapitnina: round2(-Number(racun.znesekNapitnina ?? 0)).toFixed(2),
        tipPaymentMethod: racun.tipPaymentMethod,
        tipPolicyId: racun.tipPolicyId, tipPolicyMode: racun.tipPolicyMode,
        tipCardFeeTreatment: racun.tipCardFeeTreatment, tipCardFeeKind: racun.tipCardFeeKind,
        tipCardFeeTaxTreatment: racun.tipCardFeeTaxTreatment,
        tipVatAmount: round2(-Number(racun.tipVatAmount ?? 0)).toFixed(2),
        tipCardFeeAmount: round2(-Number(racun.tipCardFeeAmount ?? 0)).toFixed(2),
        tipCardFeeFlatAmount: round2(-Number(racun.tipCardFeeFlatAmount ?? 0)).toFixed(2),
        znesekGotovina: racun.znesekGotovina != null ? round2(-Number(racun.znesekGotovina)).toFixed(2) : null,
        znesekKartica: racun.znesekKartica != null ? round2(-Number(racun.znesekKartica)).toFixed(2) : null,
        znesekBon: racun.znesekBon != null ? round2(-Number(racun.znesekBon)).toFixed(2) : null,
        znesekBonPica: racun.znesekBonPica != null ? round2(-Number(racun.znesekBonPica)).toFixed(2) : null,
        znesekNegotovinsko: racun.znesekNegotovinsko != null ? round2(-Number(racun.znesekNegotovinsko)).toFixed(2) : null,
      }).returning();
      if (izvornePostavke.length) {
        await tx.insert(postavkeTable).values(izvornePostavke.map(p => ({
          narociloId: racun.narociloId, artikelId: p.artikelId, kategorijaId: p.kategorijaId,
          ime: p.ime, kolicina: -p.kolicina,
          cenaKos: p.cenaKos, cenaKosOriginalna: p.cenaKosOriginalna,
          skupaj: round2(-p.kolicina * Number(p.cenaKos)).toFixed(2), davek: p.davek,
          opomba: p.opomba, racunId: inserted!.id, gostStevilka: p.gostStevilka,
          vrstaArtikla: p.vrstaArtikla ?? null,
        })));
      }
      await tx.insert(fursPayloadSnapshotsTable).values({
        companyId: (req as any).companyId, enotaId: tenotaId,
        operationKey: `storno:${racun.id}`, racunId: inserted!.id,
        payload: stornoPayload, requestHash, fursNacin,
        preskociPreverjanje: true, splosnaStopnja: stornoSplosnaStopnja.toFixed(2),
        signingContextFingerprint: signingContextFingerprint(fursNacin, stornoCompanyCert?.certPem),
      });
      return inserted!;
    });
  } catch (err) {
    if ((err as { code?: string }).code === "already_reserved" || (err as { code?: string }).code === "23505") {
      const stornoId = Number((err as { stornoId?: number }).stornoId);
      if (Number.isInteger(stornoId) && stornoId > 0) {
        await respondWithExistingStorno(res, stornoId);
      } else {
        const [existing] = await db.select({ id: racuniTable.id }).from(racuniTable)
          .where(and(eq(racuniTable.izvorniRacunId, racun.id), eq(racuniTable.jeStorno, true))).limit(1);
        if (existing) await respondWithExistingStorno(res, existing.id);
        else res.status(409).json({ error: "Za ta račun je storno že rezerviran ali izdan." });
      }
      return;
    }
    throw err;
  }
  const stornoAttemptId = randomUUID();
  const stornoActor = (req as any).clerkUserId ?? "pos";
  await db.transaction(async tx => {
    await tx.update(racuniTable).set({
      fursState: "sending", fursClaimedAt: new Date(), fursClaimedBy: stornoActor,
    }).where(and(eq(racuniTable.id, stornoRacun.id), eq(racuniTable.fursState, "pending")));
    await tx.insert(fursAttemptsTable).values({
      racunId: stornoRacun.id, attemptId: stornoAttemptId,
      requestHash: snapshotHash(stornoPayload), actor: stornoActor,
    });
  });

  let fursOdgovor: Awaited<ReturnType<typeof posljiNaFURS>>;
  let stornoTransportUnknown = false;
  if (simulirajFursNapako) {
    fursOdgovor = { uspeh: false, zoi: "", eor: "", napaka: "Simulirana napaka sistema FURS (S100)", surovOdgovor: "simulacija" };
  } else try {
    fursOdgovor = await posljiNaFURS(
      snapshotToFursData(stornoPayload, stornoCompanyCert, nastavitve.fursProxyUrl),
      fursNacin,
      true,
      stornoSplosnaStopnja,
    );
  } catch (err) {
    const sporocilo = err instanceof Error ? err.message : String(err);
    req.log.error({ racunId: racun.id, stornoStevilka, napaka: sporocilo }, "Napaka pri FURS storno zahtevku");
    stornoTransportUnknown = true;
    fursOdgovor = { uspeh: false, zoi: "", eor: "", napaka: sporocilo, surovOdgovor: "omrežna napaka" };
  }

  const stornoOutcome = fursOutcome(fursOdgovor, stornoTransportUnknown);
  const stornoStatus = stornoOutcome === "confirmed" ? (fursNacin !== "produkcija" ? "testni" : "poslan") : "napaka";

  const stornoNow = new Date();
  await db.transaction(async tx => {
    await tx.update(racuniTable).set({
      status: stornoStatus,
      fursState: stornoOutcome,
      fursAttemptCount: 1,
      fursLastAttemptAt: stornoNow,
      fursLastError: stornoOutcome === "confirmed" ? null : (fursOdgovor.napaka ?? null),
      fursConfirmedAt: stornoOutcome === "confirmed" ? stornoNow : null,
      fursClaimedAt: null,
      fursClaimedBy: null,
      zoi: fursOdgovor.zoi || null,
      eor: stornoOutcome === "confirmed" ? (fursOdgovor.eor || null) : null,
      fursOdgovor: fursOdgovor.surovOdgovor,
    }).where(eq(racuniTable.id, stornoRacun.id));
    await tx.update(fursAttemptsTable).set({
      finishedAt: stornoNow,
      outcome: stornoOutcome,
      rawResponse: fursOdgovor.surovOdgovor,
      rawError: stornoOutcome === "confirmed" ? null : (fursOdgovor.napaka ?? null),
    }).where(eq(fursAttemptsTable.attemptId, stornoAttemptId));
    if (stornoOutcome === "confirmed") {
      await finalizeConfirmedStorno(tx, stornoRacun.id, (req as any).clerkUserId ?? "pos");
    }
  });
  [stornoRacun] = await db.select().from(racuniTable).where(eq(racuniTable.id, stornoRacun.id));

  if (stornoOutcome === "confirmed") {
    req.log.info(
      { racunId: racun.id, stornoRacunId: stornoRacun.id, stornoStevilka, fursNacin },
      "Storno računa potrjen na FURS in finaliziran",
    );
  } else {
    req.log.warn(
      { racunId: racun.id, stornoRacunId: stornoRacun.id, stornoStevilka, fursNacin, fursState: stornoOutcome },
      stornoOutcome === "unknown"
        ? "Izid pošiljanja storna na FURS je neznan; avtomatska ponovitev ni dovoljena"
        : "FURS je storno zavrnil; storno ni finaliziran in ga je mogoče varno ponoviti iz snapshota",
    );
  }

  const [withMiza] = await db
    .select({
      ...baseSelect})
    .from(racuniTable)
    .leftJoin(narocilaTable, eq(racuniTable.narociloId, narocilaTable.id))
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .where(eq(racuniTable.id, stornoRacun!.id));

  broadcastToUnit((req as any).enotaId, "update", { type: "racun" });
  res.status(stornoOutcome === "confirmed" ? 200 : stornoOutcome === "unknown" ? 202 : 422).json(({
    ...withMiza,
    skupaj: Number(withMiza!.skupaj),
    ddv: Number(withMiza!.ddv),
    osnova: withMiza!.osnova != null ? Number(withMiza!.osnova) : null,
    zoi: withMiza!.zoi ?? null,
    eor: withMiza!.eor ?? null,
    fursOdgovor: withMiza!.fursOdgovor ?? null,
    fursState: stornoOutcome,
    natakarIme: withMiza!.natakarIme ?? null,
    natakarDavcna: withMiza!.natakarDavcna ?? null,
    mizaStevilka: withMiza!.mizaStevilka ?? null,
    fursNapaka: (!fursOdgovor.uspeh && fursOdgovor.napaka) ? prevediFursNapako(fursOdgovor.napaka) : null,
    opomba: withMiza!.opomba ?? null,
    jeDelni: withMiza!.jeDelni ?? false,
    jeStorno: withMiza!.jeStorno ?? false,
    znesekNapitnina: Number(withMiza!.znesekNapitnina ?? 0),
    izvorniRacunId: (withMiza as any).izvorniRacunId ?? (withMiza as any).izvorniRacunId ?? null}));
});

router.patch("/racuni/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const parsed = PatchRacunPlacilnaNacinBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  let updated: { id: number } | undefined;
  let paymentError: string | null = null;
  await db.transaction(async tx => {
    const lockedResult = await tx.execute(sql`
      SELECT skupaj, placilna_nacin, znesek_napitnina, znesek_subvencija, znesek_negotovinsko,
        znesek_gotovina, znesek_kartica, znesek_bon, znesek_bon_pica, stevilo_bonov, ssp_referenca
      FROM racuni WHERE id = ${id} AND enota_id = ${tenotaId} FOR UPDATE
    `);
    const existing = lockedResult.rows[0] as {
      skupaj: string; placilna_nacin: any; znesek_napitnina: string | null; znesek_subvencija: string | null; znesek_negotovinsko: string | null;
      znesek_gotovina: string | null; znesek_kartica: string | null; znesek_bon: string | null; znesek_bon_pica: string | null; stevilo_bonov: number | null; ssp_referenca: string | null;
    } | undefined;
    if (!existing) return;
    const validation = validatePatchedReceiptPayments({
      skupaj: Number(existing.skupaj),
      znesekNapitnina: Number(existing.znesek_napitnina ?? 0),
      znesekSubvencija: Number(existing.znesek_subvencija ?? 0),
      znesekNegotovinsko: Number(existing.znesek_negotovinsko ?? 0),
      steviloBonov: existing.stevilo_bonov,
      sspReferenca: existing.ssp_referenca,
      znesekGotovina: Number(existing.znesek_gotovina ?? 0),
      znesekKartica: Number(existing.znesek_kartica ?? 0),
      znesekBon: Number(existing.znesek_bon ?? 0),
      znesekBonPica: Number(existing.znesek_bon_pica ?? 0),
    }, {
      placilnaNacin: parsed.data.placilnaNacin,
      znesekGotovina: parsed.data.znesekGotovina,
      znesekKartica: parsed.data.znesekKartica,
      znesekBon: parsed.data.znesekBon,
      znesekBonPica: parsed.data.znesekBonPica,
      steviloBonov: parsed.data.steviloBonov,
    });
    if (!validation.ok) { paymentError = validation.error; return; }
    [updated] = await tx.update(racuniTable).set({
      placilnaNacin: parsed.data.placilnaNacin,
      znesekGotovina: parsed.data.znesekGotovina !== undefined
        ? parsed.data.znesekGotovina == null ? null : String((parsed.data.znesekGotovina as number).toFixed(2))
        : undefined,
      // Tipped receipt always persists the validated full card charge, even
      // when PATCH changes only the primary payment method.
      znesekKartica: Number(existing.znesek_napitnina ?? 0) > 0
        ? validation.normalizedKartica.toFixed(2)
        : parsed.data.znesekKartica !== undefined
          ? parsed.data.znesekKartica == null ? null : String((parsed.data.znesekKartica as number).toFixed(2))
          : undefined,
      znesekBon: parsed.data.znesekBon !== undefined
        ? parsed.data.znesekBon == null ? null : String((parsed.data.znesekBon as number).toFixed(2))
        : undefined,
      steviloBonov: parsed.data.steviloBonov !== undefined ? parsed.data.steviloBonov : undefined,
      znesekBonPica: parsed.data.znesekBonPica !== undefined
        ? parsed.data.znesekBonPica == null ? null : String((parsed.data.znesekBonPica as number).toFixed(2))
        : undefined,
      izdaniKuponi: (parsed.data as { izdaniKuponi?: number | null }).izdaniKuponi ?? null,
      ...(parsed.data as { kupecDavcnaStevilka?: string | null }).kupecDavcnaStevilka !== undefined && { kupecDavcnaStevilka: (parsed.data as { kupecDavcnaStevilka?: string | null }).kupecDavcnaStevilka },
      ...(parsed.data as { kupecNaziv?: string | null }).kupecNaziv !== undefined && { kupecNaziv: (parsed.data as { kupecNaziv?: string | null }).kupecNaziv },
      ...(parsed.data as { kupecNaslov?: string | null }).kupecNaslov !== undefined && { kupecNaslov: (parsed.data as { kupecNaslov?: string | null }).kupecNaslov },
      ...(parsed.data as { kupecZavezanecDdv?: boolean | null }).kupecZavezanecDdv !== undefined && { kupecZavezanecDdv: (parsed.data as { kupecZavezanecDdv?: boolean | null }).kupecZavezanecDdv },
    }).where(and(eq(racuniTable.id, id), eq(racuniTable.enotaId, tenotaId))).returning({ id: racuniTable.id });
  });

  if (paymentError) { res.status(400).json({ error: paymentError }); return; }
  if (!updated) { res.status(404).json({ error: "Račun ni najden" }); return; }

  res.json({ id: updated.id });
});

router.get("/racuni/:id/postavke", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const racunId = Number(req.params.id);
  if (isNaN(racunId)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [racun] = await db.select({ id: racuniTable.id })
    .from(racuniTable)
    .where(and(eq(racuniTable.id, racunId), sql`true`, eq(racuniTable.enotaId, tenotaId)));

  if (!racun) { res.status(404).json({ error: "Račun ni najden" }); return; }

  const postavke = await db
    .select({
      artikelId: postavkeTable.artikelId,
      ime: postavkeTable.ime,
      kolicina: postavkeTable.kolicina,
      cenaKos: postavkeTable.cenaKos})
    .from(postavkeTable)
    .where(and(
      eq(postavkeTable.racunId, racunId),
      receiptVisiblePostavkaClause(),
    ));

  // Aggregate by artikelId (handles partial-receipt duplicates): sum quantities, keep last price/name
  const byArtikel = new Map<number, { artikelId: number; ime: string; kolicina: number; cenaKos: number }>();
  for (const p of postavke) {
    if (p.artikelId == null) continue;
    const existing = byArtikel.get(p.artikelId);
    if (existing) {
      existing.kolicina += p.kolicina;
    } else {
      byArtikel.set(p.artikelId, { artikelId: p.artikelId, ime: p.ime, kolicina: p.kolicina, cenaKos: Number(p.cenaKos) });
    }
  }
  res.json(Array.from(byArtikel.values()));
});

// ── Helper: per-podjetje bizBox poverilnice (z env fallback) ─────────────────
//
// Prioriteta:
//   1. bizbox_nastavitve tabela (per companyId, AES-256-GCM šifrirano geslo)
//   2. Fallback: process.env.BIZBOX_USER + BIZBOX_PASS (za nazaj-kompatibilnost / demo)
//
// Vrne null, če niso nastavljene niti per-podjetje niti env poverilnice.
// Geslo se NIKOLI ne logira, ne vrača v API odgovoru, ne shranjuje plaintext.
async function pridobiBizboxPoverilnice(
  companyId: string,
  enotaId: number,
): Promise<{
  user: string;
  pass: string;
  okolje: "test" | "prod";
  posiljateljDavcna: string | null;
  vir: "db" | "env";
} | null> {
  // 1. Per-podjetje iz bizbox_nastavitve
  //
  // VARNOSTNO PRAVILO: Če DB vnosek obstaja a je geslo neberljivo
  // (BIZBOX_ENC_KEY manjka/napačen), napaka MORA vidno izpliveti (ne tihega
  // fallbacka na env), da ne pride do oddaje pod napačnim računom.
  const [row] = await db
    .select()
    .from(bizboxNastavitveTable)
    .where(eq(bizboxNastavitveTable.companyId, companyId));

  if (row) {
    // Vrže Error, če BIZBOX_ENC_KEY manjka ali zapis ni berljiv —
    // klicatelj dobi 500 raje kot tih fallback na napačen račun.
    const pass = desifrirajBizboxGeslo(row.bizboxPassEnc);
    return {
      user: row.bizboxUser,
      pass,
      okolje: (row.bizboxOkolje ?? "test") as "test" | "prod",
      posiljateljDavcna: row.posiljateljDavcna ?? null,
      vir: "db",
    };
  }

  // 2. Brez DB vnostka → fallback na env spremenljivki (za nazaj-kompatibilnost / demo)
  const user = process.env["BIZBOX_USER"] ?? null;
  const pass = process.env["BIZBOX_PASS"] ?? null;
  if (!user || !pass) return null;

  const nastavitveMap = await readAll("", enotaId);
  const okolje = (nastavitveMap["bizBoxOkolje"] ?? "test") as "test" | "prod";
  return { user, pass, okolje, posiljateljDavcna: null, vir: "env" };
}

// ── Cron zaščita in handler za /api/racuni/eracun/batch-status-update ─────────
//
// Posodobi eRacunBizboxStatus za vse račune z nedokončanim bizBox pošiljanjem
// (eRacunBizboxStatus IN ('oddano','v_obdelavi')).
//
// Registracija poti je v pos/index.ts PRED globalnim requireEnota blokom.
export function zahtevajCronSecret(req: Request, res: Response, next: () => void): void {
  const cronSecret = process.env["CRON_SECRET"];
  if (!cronSecret) {
    res.status(503).json({ error: "CRON_SECRET ni nastavljen — batch ni dostopen" });
    return;
  }

  const requestSecret = req.get("X-Cron-Secret") ?? "";
  const expected = Buffer.from(cronSecret, "utf8");
  const received = Buffer.from(requestSecret, "utf8");
  const secretsMatch =
    expected.length === received.length && timingSafeEqual(expected, received);

  if (!secretsMatch) {
    res.status(401).json({ error: "Nepooblaščen dostop — X-Cron-Secret ne ustreza" });
    return;
  }

  next();
}

export async function batchStatusUpdateHandler(req: Request, res: Response): Promise<void> {
  const BATCH_LIMIT = 50;

  // 1. Poišči vse račune z nedokončanim bizBox statusom (cross-enota)
  let neDoconcani: Array<{
    id: number;
    enotaId: number;
    eRacunBizboxId: string | null;
    eRacunBizboxStatus: string | null;
    companyId: string | null;
  }>;
  try {
    neDoconcani = await db
      .select({
        id: racuniTable.id,
        enotaId: racuniTable.enotaId,
        eRacunBizboxId: racuniTable.eRacunBizboxId,
        eRacunBizboxStatus: racuniTable.eRacunBizboxStatus,
        companyId: enoteTable.companyId,
      })
      .from(racuniTable)
      .innerJoin(enoteTable, eq(racuniTable.enotaId, enoteTable.id))
      .where(
        and(
          isNotNull(racuniTable.eRacunBizboxId),
          inArray(racuniTable.eRacunBizboxStatus, ["oddano", "v_obdelavi"]),
        ),
      )
      .orderBy(desc(racuniTable.ustvarjeno))
      .limit(BATCH_LIMIT);
  } catch (err) {
    req.log.error({ err }, "batch-status-update: DB napaka pri iskanju");
    res.status(500).json({ error: "DB napaka" }); return;
  }

  if (neDoconcani.length === 0) {
    res.json({ skupaj: 0, posodobljeno: 0, preskoceno: 0, napake: 0, cas: new Date().toISOString() });
    return;
  }

  // 2. Združi po companyId
  const poPodjejtu = new Map<string, typeof neDoconcani>();
  for (const r of neDoconcani) {
    if (!r.companyId) { continue; }
    const skupina = poPodjejtu.get(r.companyId) ?? [];
    skupina.push(r);
    poPodjejtu.set(r.companyId, skupina);
  }

  let posodobljeno = 0;
  let preskoceno = 0;
  let napake = 0;

  for (const [companyId, skupina] of poPodjejtu.entries()) {
    const enotaId = skupina[0]!.enotaId;

    // 3. Pridobi poverilnice — preskoči podjetje brez poverilnic, ne sesuj job-a
    let poverilnice: Awaited<ReturnType<typeof pridobiBizboxPoverilnice>>;
    try {
      poverilnice = await pridobiBizboxPoverilnice(companyId, enotaId);
    } catch (err) {
      req.log.warn({ companyId }, `batch-status: napaka poverilnic — preskakujem (${String(err)})`);
      preskoceno += skupina.length;
      continue;
    }
    if (!poverilnice) {
      preskoceno += skupina.length;
      continue;
    }

    const host = getBizboxHost(poverilnice.okolje);

    // 4. Login (en token za celotno skupino)
    let token: string;
    try {
      token = await loginBizbox(host, poverilnice.user, poverilnice.pass);
    } catch (err) {
      req.log.warn({ companyId, host }, `batch-status: login neuspešen — preskakujem (${String(err)})`);
      preskoceno += skupina.length;
      continue;
    }

    // 5. Preveri vsak račun
    for (const racun of skupina) {
      if (!racun.eRacunBizboxId) { preskoceno++; continue; }
      try {
        const { bizboxStatus } = await getBizboxDocMetadata(host, token, racun.eRacunBizboxId);
        await db.update(racuniTable)
          .set({ eRacunBizboxStatus: bizboxStatus })
          .where(eq(racuniTable.id, racun.id));
        posodobljeno++;
      } catch {
        napake++;
      }
    }
  }

  req.log.info({ skupaj: neDoconcani.length, posodobljeno, preskoceno, napake }, "batch-status-update zaključen");
  res.json({
    skupaj: neDoconcani.length,
    posodobljeno,
    preskoceno,
    napake,
    cas: new Date().toISOString(),
  });
}

// ── POST /racuni/:id/eracun/poslji — ročna oddaja e-računa prek bizBox ────────
//
// Poverilnice se berejo v prioriteti:
//   1. bizbox_nastavitve tabela (per-podjetje, AES-256-GCM šifrirano geslo)
//   2. Fallback: env BIZBOX_USER + BIZBOX_PASS
// Geslo se NIKOLI ne logira, hardkodira ali vrača v odgovorih.
router.post("/racuni/:id/eracun/poslji", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const companyId = (req as any).companyId as string;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID računa" }); return; }

  // 1) Poverilnice: per-podjetje DB (AES-256-GCM dešifrirano), fallback na env
  const poverilnice = await pridobiBizboxPoverilnice(companyId, tenotaId);
  if (!poverilnice) {
    res.status(400).json({
      error: "bizBox ni konfiguriran — nastavite poverilnice v Nastavitve › bizBox ali Replit Secrets (BIZBOX_USER/BIZBOX_PASS).",
    });
    return;
  }
  const bizboxUser = poverilnice.user;
  const bizboxPass = poverilnice.pass;

  // 2) Naloži račun — mora biti v enoti in imeti pripravljen XML
  const [row] = await db
    .select({
      id: racuniTable.id,
      stevilkaRacuna: racuniTable.stevilkaRacuna,
      eRacunXml: racuniTable.eRacunXml,
      eRacunStatus: racuniTable.eRacunStatus,
      kupecId: racuniTable.kupecId,
      kupecCpId: racuniTable.kupecCpId,   // UUID referencu na counterparties (za eDDress)
    })
    .from(racuniTable)
    .where(and(eq(racuniTable.id, id), eq(racuniTable.enotaId, tenotaId)));

  if (!row) { res.status(404).json({ error: "Račun ni najden" }); return; }
  if (!row.eRacunXml) {
    res.status(400).json({ error: "e-Račun XML ni generiran za ta račun" }); return;
  }
  if (row.eRacunStatus === "napaka") {
    res.status(400).json({ error: "e-Račun je v stanju napake — regenerirajte ga najprej" }); return;
  }

  // 3) Naloži podatke podjetja in kupca za eDDress
  const [podjetje] = await db.select().from(companiesTable)
    .where(eq(companiesTable.id, companyId));
  if (!podjetje) { res.status(500).json({ error: "Podjetje ni najdeno" }); return; }

  let kupecDavcna: string | null = null;
  let kupecEddress: string | null = null;
  // Poišči kupca v skupnem šifrantu (kupec_cp_id je UUID)
  const kupecCpIdBizBox = row.kupecCpId ?? null;
  if (kupecCpIdBizBox) {
    const [kupec] = await db.select({
      davcnaStevilka: counterpartiesTable.taxId,
      eRacunNaslov: counterpartiesTable.eRacunNaslov,
    }).from(counterpartiesTable).where(eq(counterpartiesTable.id, kupecCpIdBizBox));
    if (kupec) {
      kupecDavcna = kupec.davcnaStevilka ?? null;
      kupecEddress = kupec.eRacunNaslov ?? null;
    }
  }
  if (!kupecDavcna && !kupecEddress) {
    res.status(400).json({ error: "Kupec nima davčne številke ali eDDress-a — oddaja ni možna" }); return;
  }

  // 4) Okolje in host iz per-podjetje poverilnic (DB > env-fallback bizBoxOkolje)
  const bizBoxOkolje = poverilnice.okolje;
  const host = getBizboxHost(bizBoxOkolje);

  // 5) Sestavi eDDress pošiljatelja in prejemnika
  // posiljateljDavcna: per-podjetje override > podjetje_davcna iz companies
  const fromEddress = sestaviEddress(poverilnice.posiljateljDavcna ?? podjetje.podjetjeDavcna);
  const toEddress = sestaviEddress(kupecDavcna ?? "", kupecEddress);

  // 6) Login — poverilnic nikoli ne logiraj
  let token: string;
  try {
    token = await loginBizbox(host, bizboxUser, bizboxPass);
  } catch (err) {
    const sporocilo = err instanceof Error ? err.message : String(err);
    req.log.warn({ racunId: id }, `bizBox login neuspešen: ${sporocilo}`);
    await db.update(racuniTable).set({
      eRacunBizboxOdgovor: `LOGIN NAPAKA: ${sporocilo}`,
      eRacunBizboxStatus: "napaka",
    }).where(eq(racuniTable.id, id)).catch(() => {});
    res.status(502).json({ error: `bizBox prijava ni uspela: ${sporocilo}` });
    return;
  }

  // 6.5) isEdiEnabled predpreverba — informativna, ne blokira oddaje
  // Preveri, ali ima prejemnik aktiven bizBox eNabiralnik.
  let ediEnabled: boolean | null = null;
  try {
    const ediRes = await preveriEdiEnabled(host, token, fromEddress, toEddress);
    ediEnabled = ediRes.enabled;
    if (!ediEnabled) {
      req.log.info(
        { racunId: id, toEddress },
        "bizBox isEdiEnabled: prejemnik ni registriran — pošiljamo vseeno (opozorilo v odgovoru)",
      );
    }
  } catch {
    // Predpreverba spodletela — ne blokiramo oddaje, samo logiramo
    req.log.debug({ racunId: id }, "bizBox isEdiEnabled predpreverba spodletela — ignoriramo");
  }

  // 7) Zgradi envelope in pošlji ZIP
  const docFileName = `eracun-${row.stevilkaRacuna.replace(/[^a-zA-Z0-9\-_.]/g, "_")}.xml`;
  const envelopeXml = buildEnvelope(fromEddress, toEddress, docFileName, row.stevilkaRacuna);

  try {
    const { status: httpStatus, body } = await posljiBizbox(
      host, token, envelopeXml, docFileName, row.eRacunXml,
    );

    // 8) Razčleni docId iz odgovora (result = int64 po OpenAPI 2.0.1 spec)
    const docId = parseBizboxDocId(body);

    // 9) Shrani uspešno oddajo — eRacunBizboxId + začetni status 'oddano'
    const odgovorSled = `HTTP ${httpStatus}: ${body.slice(0, 500)}`;
    await db.update(racuniTable).set({
      eRacunStatus: "poslano",
      eRacunPoslanoDne: new Date(),
      eRacunBizboxOdgovor: odgovorSled,
      eRacunNapaka: null,
      eRacunBizboxId: docId ?? undefined,
      eRacunBizboxStatus: "oddano",
    }).where(eq(racuniTable.id, id));

    req.log.info(
      { racunId: id, stevilkaRacuna: row.stevilkaRacuna, host, httpStatus, docId },
      "e-račun poslan prek bizBox",
    );
    res.json({
      uspeh: true,
      host,
      okolje: bizBoxOkolje,
      httpStatus,
      from: fromEddress,
      to: toEddress,
      docId: docId ?? null,
      ediEnabled,
    });
  } catch (err) {
    const sporocilo = err instanceof Error ? err.message : String(err);
    req.log.warn({ racunId: id }, `bizBox pošiljanje neuspešno: ${sporocilo}`);

    // Pusti eRacunStatus 'pripravljen' — možen ponovni poskus
    await db.update(racuniTable).set({
      eRacunBizboxOdgovor: `NAPAKA ODDAJE: ${sporocilo}`,
      eRacunBizboxStatus: "napaka",
    }).where(eq(racuniTable.id, id)).catch(() => {});

    res.status(502).json({ error: `bizBox oddaja ni uspela: ${sporocilo}` });
  }
});

// ── POST /racuni/:id/eracun/status — preveri status dostave prek bizBox ────────
//
// Pokliče GET /documents/{docId}/metaData (OpenAPI 2.0.1) z obstoječim docId.
// Zahteva:  račun mora imeti shranjen eRacunBizboxId (nastavi ga /eracun/poslji).
// Odgovor:  { bizboxStatus, docId, raw }
// Stranski učinek: posodobi e_racun_bizbox_status v DB.
//
// Poverilnici se berejo IZKLJUČNO iz env BIZBOX_USER in BIZBOX_PASS.
router.post("/racuni/:id/eracun/status", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const companyId = (req as any).companyId as string;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID računa" }); return; }

  // 1) Poverilnice: per-podjetje DB (AES-256-GCM dešifrirano), fallback na env
  const poverilnice = await pridobiBizboxPoverilnice(companyId, tenotaId);
  if (!poverilnice) {
    res.status(400).json({ error: "bizBox ni konfiguriran — nastavite poverilnice v Nastavitve › bizBox ali Replit Secrets (BIZBOX_USER/BIZBOX_PASS)." });
    return;
  }
  const bizboxUser = poverilnice.user;
  const bizboxPass = poverilnice.pass;

  // 2) Naloži račun — potrebujemo eRacunBizboxId
  const [row] = await db
    .select({
      id: racuniTable.id,
      eRacunBizboxId: racuniTable.eRacunBizboxId,
      eRacunStatus: racuniTable.eRacunStatus,
    })
    .from(racuniTable)
    .where(and(eq(racuniTable.id, id), eq(racuniTable.enotaId, tenotaId)));

  if (!row) { res.status(404).json({ error: "Račun ni najden" }); return; }

  if (!row.eRacunBizboxId) {
    res.status(422).json({
      error: "Ta račun nima shranjenega bizBox document ID — status ni na voljo. " +
             "Oddajte račun prek /eracun/poslji, da se docId shrani.",
    });
    return;
  }

  // 3) Okolje iz per-podjetje poverilnic (enotaId je del konteksta prek middleware)
  const bizBoxOkolje = poverilnice.okolje;
  const host = getBizboxHost(bizBoxOkolje);

  // 4) Login
  let token: string;
  try {
    token = await loginBizbox(host, bizboxUser, bizboxPass);
  } catch (err) {
    const sporocilo = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `bizBox prijava ni uspela: ${sporocilo}` });
    return;
  }

  // 5) Preveri status prek GET /documents/{docId}/metaData
  let bizboxStatus: "v_obdelavi" | "dostavljeno" | "zavrnjeno";
  let raw: string;
  try {
    const result = await getBizboxDocMetadata(host, token, row.eRacunBizboxId);
    bizboxStatus = result.bizboxStatus;
    raw = result.raw;
  } catch (err) {
    const sporocilo = err instanceof Error ? err.message : String(err);
    req.log.warn({ racunId: id, docId: row.eRacunBizboxId }, `bizBox metaData napaka: ${sporocilo}`);
    // Shrani napako v DB in vrni 502
    await db.update(racuniTable).set({ eRacunBizboxStatus: "napaka" })
      .where(eq(racuniTable.id, id)).catch(() => {});
    res.status(502).json({ error: `bizBox status preverjanje ni uspelo: ${sporocilo}` });
    return;
  }

  // 6) Posodobi DB in vrni rezultat
  await db.update(racuniTable).set({ eRacunBizboxStatus: bizboxStatus })
    .where(eq(racuniTable.id, id));

  req.log.info(
    { racunId: id, docId: row.eRacunBizboxId, bizboxStatus },
    "bizBox status preverjanje uspešno",
  );
  res.json({
    bizboxStatus,
    docId: row.eRacunBizboxId,
    raw: raw.slice(0, 500),
  });
});

// ── GET /racuni/:id/eracun.xml — prenos e-SLOG XML datoteke ──────────────────
router.get("/racuni/:id/eracun.xml", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID računa" }); return; }

  const [row] = await db
    .select({
      stevilkaRacuna: racuniTable.stevilkaRacuna,
      eRacunXml: racuniTable.eRacunXml,
      eRacunStatus: racuniTable.eRacunStatus,
    })
    .from(racuniTable)
    .where(and(eq(racuniTable.id, id), eq(racuniTable.enotaId, tenotaId)));

  if (!row) { res.status(404).json({ error: "Račun ni najden" }); return; }
  if (!row.eRacunXml || row.eRacunStatus === "napaka") {
    res.status(404).json({ error: "e-Račun XML ni na voljo za ta račun" }); return;
  }

  const imeDataoteke = `eracun-${row.stevilkaRacuna.replace(/[^a-zA-Z0-9\-_.]/g, "_")}.xml`;
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${imeDataoteke}"`);
  res.send(row.eRacunXml);
});

// ── GET /racuni/:id/eracun-paket.zip — e-SLOG XML + strežniški PDF ───────────
router.get("/racuni/:id/eracun-paket.zip", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID računa" }); return; }

  const [racun] = await db.select({
    stevilkaRacuna: racuniTable.stevilkaRacuna,
    eRacunXml: racuniTable.eRacunXml,
    eRacunPdf: racuniTable.eRacunPdf,
    eRacunStatus: racuniTable.eRacunStatus,
    datumCas: racuniTable.datumCas,
    ustvarjeno: racuniTable.ustvarjeno,
    placilnaNacin: racuniTable.placilnaNacin,
    skupaj: racuniTable.skupaj,
    ddv: racuniTable.ddv,
    kupecNaziv: racuniTable.kupecNaziv,
    kupecNaslov: racuniTable.kupecNaslov,
    enotaIme: enoteTable.ime,
  }).from(racuniTable)
    .innerJoin(enoteTable, eq(enoteTable.id, racuniTable.enotaId))
    .where(and(eq(racuniTable.id, id), eq(racuniTable.enotaId, tenotaId))).limit(1);
  if (!racun) { res.status(404).json({ error: "Račun ni najden" }); return; }
  if (!racun.eRacunXml || racun.eRacunStatus === "napaka") {
    res.status(404).json({ error: "e-Račun XML ni na voljo za ta račun" }); return;
  }
  try {
    const issuedAt = (racun.datumCas ?? racun.ustvarjeno).toISOString().slice(0, 10);
    // Uporabi shranjeni PDF (generiran ob izdaji) ali generiraj na-the-fly (stari računi)
    let pdf: Buffer;
    if (racun.eRacunPdf) {
      pdf = Buffer.from(racun.eRacunPdf, "base64");
    } else {
      const items = await db.select({
        id: postavkeTable.id,
        name: postavkeTable.ime,
        quantity: postavkeTable.kolicina,
        unitPrice: postavkeTable.cenaKos,
        total: postavkeTable.skupaj,
        vatRate: postavkeTable.davek,
        parentPostavkaId: postavkeTable.parentPostavkaId,
        jeEmbalaza: postavkeTable.jeEmbalaza,
        toGo: postavkeTable.toGo,
      }).from(postavkeTable).where(and(
        eq(postavkeTable.racunId, id),
        receiptVisiblePostavkaClause(),
      ));
      pdf = await generatePosInvoicePdf({
        companyName: racun.enotaIme,
        invoiceNumber: racun.stevilkaRacuna,
        issuedAt,
        customerName: racun.kupecNaziv,
        customerAddress: racun.kupecNaslov,
        paymentMethod: racun.placilnaNacin,
        total: racun.skupaj,
        vat: racun.ddv,
        items: projectPackagingDisplayPrices(items.map((item) => ({
          postavkaId: item.id,
          ime: item.name,
          kolicina: Number(item.quantity),
          cenaKos: Number(item.unitPrice),
          skupaj: Number(item.total),
          davek: Number(item.vatRate),
          parentPostavkaId: item.parentPostavkaId,
          jeEmbalaza: item.jeEmbalaza === true,
          toGo: item.toGo === true,
        }))).map((item) => ({
          name: item.ime,
          quantity: String(item.kolicina),
          unitPrice: String(item.cenaKos),
          total: String(item.skupaj),
          vatRate: String(item.davek),
          isPackaging: item.jeEmbalaza === true,
        })),
      });
    }
    const zip = await buildEslogInvoicePackage({
      invoiceNumber: racun.stevilkaRacuna,
      xml: racun.eRacunXml,
      pdf,
    });
    const filename = `eracun-paket-${racun.stevilkaRacuna.replace(/[^a-zA-Z0-9\-_.]/g, "_")}.zip`;
    res.type("application/zip").attachment(filename).send(zip);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Priprava paketa ni uspela";
    res.status(422).json({ error: message });
  }
});

// ── POST /racuni/:id/eracun/poslji-email — pošlje e-SLOG XML + PDF na kupčev eRacunEmail ──
router.post("/racuni/:id/eracun/poslji-email", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID računa" }); return; }

  // 1. Naloži račun z XML, PDF in kupec CP id
  const [racun] = await db.select({
    id: racuniTable.id,
    stevilkaRacuna: racuniTable.stevilkaRacuna,
    eRacunXml: racuniTable.eRacunXml,
    eRacunPdf: racuniTable.eRacunPdf,
    eRacunStatus: racuniTable.eRacunStatus,
    datumCas: racuniTable.datumCas,
    ustvarjeno: racuniTable.ustvarjeno,
    skupaj: racuniTable.skupaj,
    ddv: racuniTable.ddv,
    kupecNaziv: racuniTable.kupecNaziv,
    kupecNaslov: racuniTable.kupecNaslov,
    kupecCpId: racuniTable.kupecCpId,
    enotaId: racuniTable.enotaId,
    placilnaNacin: racuniTable.placilnaNacin,
    eRacunPoslanoDne: racuniTable.eRacunPoslanoDne,
    enotaIme: enoteTable.ime,
  }).from(racuniTable)
    .innerJoin(enoteTable, eq(enoteTable.id, racuniTable.enotaId))
    .where(and(eq(racuniTable.id, id), eq(racuniTable.enotaId, tenotaId))).limit(1);

  if (!racun) { res.status(404).json({ error: "Račun ni najden" }); return; }
  if (!racun.eRacunXml || racun.eRacunStatus === "napaka") {
    res.status(422).json({ error: "e-Račun XML ni generiran za ta račun — najprej izdajte e-račun" }); return;
  }

  // Idempotentnost: prepreči nenamerno dvojno pošiljanje v kratkem oknu (60 s)
  // Za namerno ponovitev pošlji z ?forcePonoviPosilj=1
  const forcePonoviPosilj = req.query["forcePonoviPosilj"] === "1";
  if (
    !forcePonoviPosilj &&
    racun.eRacunStatus === "poslano_email" &&
    racun.eRacunPoslanoDne &&
    Date.now() - new Date(racun.eRacunPoslanoDne).getTime() < 60_000
  ) {
    res.status(409).json({
      error: "e-Račun je bil poslan pred manj kot 60 sekundami. Za ponovitev dodajte ?forcePonoviPosilj=1.",
      poslanoPred: racun.eRacunPoslanoDne,
    });
    return;
  }

  // 2. Pridobi e_racun_email kupca iz skupnega šifranta
  if (!racun.kupecCpId) {
    res.status(422).json({ error: "Račun nima povezanega kupca — e-poštni naslov ni znan" }); return;
  }
  const [kupecCp] = await db.select({
    id: counterpartiesTable.id,
    name: counterpartiesTable.name,
    eRacunEmail: counterpartiesTable.eRacunEmail,
  }).from(counterpartiesTable).where(eq(counterpartiesTable.id, racun.kupecCpId)).limit(1);

  if (!kupecCp?.eRacunEmail?.trim()) {
    res.status(422).json({
      error: `Kupec "${kupecCp?.name ?? racun.kupecCpId}" nima nastavljenega e-naslova za e-račune.\nDodajte ga v razdelku Partnerji → polje "E-naslov za e-račune".`,
    }); return;
  }
  const prejemnikEmail = kupecCp.eRacunEmail.trim();

  // 3. Pripravi PDF (shranjeni ali generiraj na-the-fly za stare račune)
  let pdfBuffer: Buffer;
  if (racun.eRacunPdf) {
    pdfBuffer = Buffer.from(racun.eRacunPdf, "base64");
  } else {
    try {
      const items = await db.select({
        id: postavkeTable.id,
        name: postavkeTable.ime,
        quantity: postavkeTable.kolicina,
        unitPrice: postavkeTable.cenaKos,
        total: postavkeTable.skupaj,
        vatRate: postavkeTable.davek,
        parentPostavkaId: postavkeTable.parentPostavkaId,
        jeEmbalaza: postavkeTable.jeEmbalaza,
        toGo: postavkeTable.toGo,
      }).from(postavkeTable).where(and(
        eq(postavkeTable.racunId, id),
        receiptVisiblePostavkaClause(),
      ));
      const issuedAt = (racun.datumCas ?? racun.ustvarjeno).toISOString().slice(0, 10);
      pdfBuffer = await generatePosInvoicePdf({
        companyName: racun.enotaIme,
        invoiceNumber: racun.stevilkaRacuna,
        issuedAt,
        customerName: racun.kupecNaziv,
        customerAddress: racun.kupecNaslov,
        paymentMethod: racun.placilnaNacin,
        total: racun.skupaj,
        vat: racun.ddv,
        items: projectPackagingDisplayPrices(items.map((item) => ({
          postavkaId: item.id,
          ime: item.name,
          kolicina: Number(item.quantity),
          cenaKos: Number(item.unitPrice),
          skupaj: Number(item.total),
          davek: Number(item.vatRate),
          parentPostavkaId: item.parentPostavkaId,
          jeEmbalaza: item.jeEmbalaza === true,
          toGo: item.toGo === true,
        }))).map(item => ({
          name: item.ime,
          quantity: String(item.kolicina),
          unitPrice: String(item.cenaKos),
          total: String(item.skupaj),
          vatRate: String(item.davek),
          isPackaging: item.jeEmbalaza === true,
        })),
      });
    } catch (pdfErr) {
      res.status(500).json({ error: `PDF generiranje ni uspelo: ${String(pdfErr)}` }); return;
    }
  }

  // 4. Naloži SMTP nastavitve in pošlji
  const nastavitveMap = await readAll("", tenotaId);
  const nastavitve = toResponse(nastavitveMap);
  const smtp = { ...nastavitve, smtpPassword: nastavitveMap["smtpPassword"] ?? "" };

  const issuedAt = (racun.datumCas ?? racun.ustvarjeno).toISOString().slice(0, 10);
  const rezultat = await posljiEslogEmail(
    smtp,
    prejemnikEmail,
    {
      stevilkaRacuna: racun.stevilkaRacuna,
      skupaj: Number(racun.skupaj),
      ddv: Number(racun.ddv),
      datumIzdaje: issuedAt,
      kupecNaziv: racun.kupecNaziv,
    },
    racun.eRacunXml,
    pdfBuffer,
    nastavitve.nazivRestavracije ?? nastavitve.davcnaStevilka ?? racun.enotaIme,
  );

  // 5. Zabeleži rezultat
  if (rezultat.uspeh) {
    await db.update(racuniTable).set({
      eRacunStatus: "poslano_email",
      eRacunPoslanoDne: new Date(),
      eRacunEmailOdgovor: `OK: ${prejemnikEmail}`,
    }).where(eq(racuniTable.id, id));
    res.json({ uspeh: true, email: prejemnikEmail });
  } else {
    const napakaSled = `NAPAKA: ${rezultat.napaka ?? "neznana"}`;
    await db.update(racuniTable).set({
      eRacunEmailOdgovor: napakaSled,
    }).where(eq(racuniTable.id, id)).catch(() => {});
    res.status(500).json({ error: rezultat.napaka ?? "Pošiljanje ni uspelo" });
  }
});

router.get("/racuni/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }

  const [row] = await db
    .select({
      id: racuniTable.id,
      narociloId: racuniTable.narociloId,
      stevilkaRacuna: racuniTable.stevilkaRacuna,
      skupaj: racuniTable.skupaj,
      ddv: racuniTable.ddv,
      osnova: racuniTable.osnova,
      placilnaNacin: racuniTable.placilnaNacin,
      status: racuniTable.status,
      zoi: racuniTable.zoi,
      eor: racuniTable.eor,
      fursOdgovor: racuniTable.fursOdgovor,
      natakarIme: racuniTable.natakarIme,
      natakarDavcna: racuniTable.natakarDavcna,
      ustvarjeno: racuniTable.ustvarjeno,
      datumCas: racuniTable.datumCas,
      mizaStevilka: mizeTable.stevilka,
      opomba: racuniTable.opomba,
      jeDelni: racuniTable.jeDelni,
      znesekGotovina: racuniTable.znesekGotovina,
      znesekKartica: racuniTable.znesekKartica,
      znesekNapitnina: racuniTable.znesekNapitnina,
      znesekBon: racuniTable.znesekBon,
      steviloBonov: racuniTable.steviloBonov,
      znesekBonPica: racuniTable.znesekBonPica,
      kupecDavcnaStevilka: racuniTable.kupecDavcnaStevilka,
      kupecNaziv: racuniTable.kupecNaziv,
      kupecNaslov: racuniTable.kupecNaslov})
    .from(racuniTable)
    .leftJoin(narocilaTable, eq(racuniTable.narociloId, narocilaTable.id))
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .where(and(eq(racuniTable.id, params.data.id), sql`true`, eq(racuniTable.enotaId, tenotaId)));

  if (!row) { res.status(404).json({ error: "Račun ni najden" }); return; }

  res.json(({
    ...row,
    skupaj: Number(row.skupaj),
    ddv: Number(row.ddv),
    osnova: row.osnova != null ? Number(row.osnova) : null,
    zoi: row.zoi ?? null,
    eor: row.eor ?? null,
    fursOdgovor: row.fursOdgovor ?? null,
    natakarIme: row.natakarIme ?? null,
    natakarDavcna: row.natakarDavcna ?? null,
    mizaStevilka: row.mizaStevilka ?? null,
    opomba: row.opomba ?? null,
    jeDelni: row.jeDelni ?? false,
    znesekGotovina: row.znesekGotovina != null ? Number(row.znesekGotovina) : null,
    znesekKartica: row.znesekKartica != null ? Number(row.znesekKartica) : null,
    znesekNapitnina: Number(row.znesekNapitnina ?? 0),
    znesekBon: row.znesekBon != null ? Number(row.znesekBon) : null,
    steviloBonov: row.steviloBonov ?? null,
    znesekBonPica: row.znesekBonPica != null ? Number(row.znesekBonPica) : null,
    kupecDavcnaStevilka: row.kupecDavcnaStevilka ?? null,
    kupecNaziv: row.kupecNaziv ?? null,
    kupecNaslov: row.kupecNaslov ?? null}));
});

export function mayViewVivaRefundAudit(vloga: string | undefined): boolean {
  return vloga === "admin" || vloga === "admin_enote" || vloga === "superadmin";
}

router.get("/racuni/:id/vracila", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const vloga = (req as unknown as PosRequest).vloga;
  const lahkoVidiAudit = mayViewVivaRefundAudit(vloga);
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID računa" }); return; }

  const racun = await db.select({ id: racuniTable.id })
    .from(racuniTable)
    .where(and(eq(racuniTable.id, id), sql`true`, eq(racuniTable.enotaId, tenotaId)))
    .limit(1);

  if (racun.length === 0) { res.status(404).json({ error: "Račun ni najden" }); return; }

  const vracila = await db.select({
    id: vivaVracilaTable.id,
    racunId: vivaVracilaTable.racunId,
    refundSessionId: vivaVracilaTable.refundSessionId,
    znesek: vivaVracilaTable.znesek,
    status: vivaVracilaTable.status,
    napaka: vivaVracilaTable.napaka,
    actorClerkUserId: vivaVracilaTable.actorClerkUserId,
    actorNatakarId: vivaVracilaTable.actorNatakarId,
    napravaKljuc: vivaVracilaTable.napravaKljuc,
    ustvarjeno: vivaVracilaTable.ustvarjeno})
    .from(vivaVracilaTable)
    .where(and(
      eq(vivaVracilaTable.racunId, id),
      sql`true`,
      eq(vivaVracilaTable.enotaId, tenotaId),
    ));

  const refundIds = vracila.map(v => v.id);
  const prehodi = !lahkoVidiAudit || refundIds.length === 0 ? [] : await db.select({
    id: vivaVraciloStatusPrehodiTable.id,
    vivaVraciloId: vivaVraciloStatusPrehodiTable.vivaVraciloId,
    prejsnjiStatus: vivaVraciloStatusPrehodiTable.prejsnjiStatus,
    noviStatus: vivaVraciloStatusPrehodiTable.noviStatus,
    napaka: vivaVraciloStatusPrehodiTable.napaka,
    actorClerkUserId: vivaVraciloStatusPrehodiTable.actorClerkUserId,
    actorNatakarId: vivaVraciloStatusPrehodiTable.actorNatakarId,
    napravaKljuc: vivaVraciloStatusPrehodiTable.napravaKljuc,
    providerReferenca: vivaVraciloStatusPrehodiTable.providerReferenca,
    vir: vivaVraciloStatusPrehodiTable.vir,
    razlog: vivaVraciloStatusPrehodiTable.razlog,
    dokazReferenca: vivaVraciloStatusPrehodiTable.dokazReferenca,
    ustvarjeno: vivaVraciloStatusPrehodiTable.ustvarjeno,
  }).from(vivaVraciloStatusPrehodiTable)
    .where(and(
      eq(vivaVraciloStatusPrehodiTable.enotaId, tenotaId),
      inArray(vivaVraciloStatusPrehodiTable.vivaVraciloId, refundIds),
    ))
    .orderBy(vivaVraciloStatusPrehodiTable.ustvarjeno);
  const prehodiPoVracilu = new Map<number, typeof prehodi>();
  for (const prehod of prehodi) {
    const current = prehodiPoVracilu.get(prehod.vivaVraciloId) ?? [];
    current.push(prehod);
    prehodiPoVracilu.set(prehod.vivaVraciloId, current);
  }

  res.json(vracila.map(v => ({
    ...v,
    actorClerkUserId: lahkoVidiAudit ? v.actorClerkUserId : null,
    actorNatakarId: lahkoVidiAudit ? v.actorNatakarId : null,
    napravaKljuc: lahkoVidiAudit ? v.napravaKljuc : null,
    providerReferenca: v.refundSessionId,
    znesek: Number(v.znesek),
    ustvarjeno: v.ustvarjeno instanceof Date ? v.ustvarjeno.toISOString() : v.ustvarjeno,
    statusPrehodi: (prehodiPoVracilu.get(v.id) ?? []).map(prehod => ({
      ...prehod,
      ustvarjeno: prehod.ustvarjeno instanceof Date ? prehod.ustvarjeno.toISOString() : prehod.ustvarjeno,
    })),
  })));
});

// ── GET /print/racun/:id/nb80 — JSON za NB80 Android tiskalni most ───────────
// NB80 ima 80 mm papir → 40 stolpcev. APK na localhost:8091 sprejme JSON in
// tiska prek NB80 PrinterService (com.noryox.printer) prek AIDL Binder.
router.get("/print/racun/:id/nb80", async (req: Request, res: Response): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const zbirni = req.query.zbirni === "1";

  const [racunRaw] = await db
    .select({ ...baseSelect, kupecZavezanecDdv: racuniTable.kupecZavezanecDdv })
    .from(racuniTable)
    .leftJoin(narocilaTable, eq(racuniTable.narociloId, narocilaTable.id))
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .where(and(eq(racuniTable.id, id), eq(racuniTable.enotaId, tenotaId)))
    .limit(1);

  if (!racunRaw) { res.status(404).json({ error: "Račun ni najden" }); return; }

  // ── 1. Inkrement steviloPrintov ─────────────────────────────────────────────
  const [updatedNb80] = await db
    .update(racuniTable)
    .set({ steviloPrintov: sql`${racuniTable.steviloPrintov} + 1` })
    .where(and(eq(racuniTable.id, id), eq(racuniTable.enotaId, tenotaId)))
    .returning({ steviloPrintov: racuniTable.steviloPrintov });
  const steviloPrintovNb80 = updatedNb80?.steviloPrintov ?? 1;

  // ── 2. Vzporedne poizvedbe ──────────────────────────────────────────────────
  const [postavkeRawNb80, nastavitveMapNb80, enotaRowNb80] = await Promise.all([
    db.select({
      id: postavkeTable.id, ime: postavkeTable.ime, kolicina: postavkeTable.kolicina,
      cenaKos: postavkeTable.cenaKos, cenaKosOriginalna: postavkeTable.cenaKosOriginalna,
      skupaj: postavkeTable.skupaj, davek: postavkeTable.davek,
      opomba: postavkeTable.opomba, parentPostavkaId: postavkeTable.parentPostavkaId,
      artikelId: postavkeTable.artikelId, jeEmbalaza: postavkeTable.jeEmbalaza, toGo: postavkeTable.toGo,
    }).from(postavkeTable).where(and(
      eq(postavkeTable.racunId, id),
      receiptVisiblePostavkaClause(),
    )).orderBy(postavkeTable.id),
    readAllWithFallback(tenotaId),
    db.select({ opis: enoteTable.opis }).from(enoteTable).where(eq(enoteTable.id, tenotaId)).limit(1),
  ]);
  const navNb80 = toResponse(nastavitveMapNb80);
  const enotaOpisNb80 = enotaRowNb80[0]?.opis ?? null;

  const postavkeNb80 = await buildBonPicaAdjustedPostavke(postavkeRawNb80 as any, racunRaw.steviloBonov);

  // ── 3. Storno referenca ─────────────────────────────────────────────────────
  let stornoStevilkaNb80: string | null = null;
  if (racunRaw.jeStorno && racunRaw.izvorniRacunId) {
    const [izv] = await db.select({ stevilkaRacuna: racuniTable.stevilkaRacuna })
      .from(racuniTable).where(eq(racuniTable.id, racunRaw.izvorniRacunId)).limit(1);
    stornoStevilkaNb80 = izv?.stevilkaRacuna ?? null;
  }

  // ── 4. FURS QR URL ──────────────────────────────────────────────────────────
  const datumCasNb80 = new Date(racunRaw.datumCas ?? racunRaw.ustvarjeno);
  const qrVsebinaНB80 = racunRaw.zoi
    ? fursQrKoda(racunRaw.zoi, navNb80.davcnaStevilka ?? "12345678", datumCasNb80, Number(racunRaw.skupaj))
    : null;

  // ── 5. Sestavi tiskalne podatke — 40 stolpcev (80mm) ali 30 stolpcev (58mm) ──
  const reqCols = req.query.cols === "30" ? 30 : 40;
  const nb80PrintData = {
    stevilkaRacuna: racunRaw.stevilkaRacuna,
    datum: datumCasNb80,
    mizaStevilka: racunRaw.mizaStevilka ?? null,
    skupaj: Number(racunRaw.skupaj),
    ddv: Number(racunRaw.ddv),
    placilnaNacin: racunRaw.placilnaNacin as "gotovina" | "kartica" | "bon" | "bon_pica" | "negotovinsko" | "reprezentanca" | "lastna_poraba",
    status: racunRaw.status as "poslan" | "napaka" | "testni",
    zoi: racunRaw.zoi ?? null,
    eor: racunRaw.eor ?? null,
    fursQrUrl: qrVsebinaНB80,
    nazivRestvracije: navNb80.nazivRestavracije ?? "Restavracija",
    naslovRestvracije: navNb80.naslovRestavracije ?? "",
    enotaOpis: enotaOpisNb80,
    davcnaStevilka: navNb80.davcnaStevilka ?? "12345678",
    racunPozdrav1: navNb80.racunPozdrav1 ?? "Hvala za obisk!",
    racunPozdrav2: navNb80.racunPozdrav2 ?? "Vracamo se — se vidimo.",
    steviloPrintov: steviloPrintovNb80,
    kupecDavcnaStevilka: racunRaw.kupecDavcnaStevilka ?? null,
    kupecNaziv: racunRaw.kupecNaziv ?? null,
    kupecNaslov: racunRaw.kupecNaslov ?? null,
    kupecZavezanecDdv: racunRaw.kupecZavezanecDdv ?? null,
    vivaTerminalSessionId: racunRaw.vivaTerminalSessionId ?? null,
    sumupCheckoutId: racunRaw.sumupCheckoutId ?? null,
    natakarIme: racunRaw.natakarIme ?? null,
    stornoIzvornaRacunStevilka: stornoStevilkaNb80,
    racunMaticna: navNb80.racunMaticna || null,
    racunSodisce: navNb80.racunSodisce || null,
    racunKapital: navNb80.racunKapital || null,
    racunDdvKlavzula: navNb80.racunDdvKlavzula || null,
    racunPravnaKlavzula: navNb80.racunPravnaKlavzula || null,
    prodajalecIban: navNb80.prodajalecIban || null,
    prodajalecBic: navNb80.prodajalecBic || null,
    dniOdloga: racunRaw.dniOdloga ?? null,
    znesekGotovina: racunRaw.znesekGotovina != null ? Number(racunRaw.znesekGotovina) : null,
    znesekKartica: racunRaw.znesekKartica != null ? Number(racunRaw.znesekKartica) : null,
    znesekNapitnina: Number(racunRaw.znesekNapitnina ?? 0),
    znesekBon: racunRaw.znesekBon != null ? Number(racunRaw.znesekBon) : null,
    steviloBonov: racunRaw.steviloBonov ?? null,
    znesekBonPica: racunRaw.znesekBonPica != null ? Number(racunRaw.znesekBonPica) : null,
    znesekNegotovinsko: racunRaw.znesekNegotovinsko != null ? Number(racunRaw.znesekNegotovinsko) : null,
    jeDdvZavezanec: (req as any).jeDdvZavezanec ?? true,
    postavke: (postavkeNb80 as any[]).map((p: any) => ({
      postavkaId: p.id, ime: p.ime, kolicina: Number(p.kolicina),
      cenaKos: Number(p.cenaKos),
      cenaKosOriginalna: p.cenaKosOriginalna != null ? Number(p.cenaKosOriginalna) : null,
      skupaj: Number(p.skupaj), davek: Number(p.davek),
      opomba: p.opomba ?? null, parentPostavkaId: p.parentPostavkaId ?? null,
      jeEmbalaza: p.jeEmbalaza === true,
      toGo: p.toGo === true,
    })),
  };
  // NB80 58mm: 32 kolon (vsi 58mm izpisi imajo 32 kolon, razen ZCS Z92 s 30)
  // NB80 80mm (cols=40): buildNb80TextReceipt → "B" vrstici na HALF=20 (2×20=40 celic)
  const rezultatNb80 = reqCols === 30
    ? buildTextReceipt(nb80PrintData, 32, true)
    : buildNb80TextReceipt(nb80PrintData);

  // ── 6. QR koda kot PNG base64 ───────────────────────────────────────────────
  if (qrVsebinaНB80) {
    try {
      const qrPng = await QRCode.toBuffer(qrVsebinaНB80, {
        type: "png", width: 300, margin: 1, errorCorrectionLevel: "M",
      });
      rezultatNb80.qrBase64 = qrPng.toString("base64");
    } catch { /* QR PNG ni uspel */ }
  }

  (rezultatNb80 as any).zoi = racunRaw.zoi ?? null;
  res.json(rezultatNb80);
});

// ── GET /print/racun/:id/zcs — JSON za ZCS Android tiskalni most ─────────────
// ZCS Z92 ima 30 kolon. APK na localhost:8090 sprejme JSON in tiska prek ZCS SDK.
router.get("/print/racun/:id/zcs", async (req: Request, res: Response): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const zbirni = req.query.zbirni === "1";

  const [racunRaw] = await db
    .select({ ...baseSelect, kupecZavezanecDdv: racuniTable.kupecZavezanecDdv })
    .from(racuniTable)
    .leftJoin(narocilaTable, eq(racuniTable.narociloId, narocilaTable.id))
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .where(and(eq(racuniTable.id, id), eq(racuniTable.enotaId, tenotaId)))
    .limit(1);

  if (!racunRaw) { res.status(404).json({ error: "Račun ni najden" }); return; }

  // ── 1. Inkrement steviloPrintov — atomično, pred vsem ostalim ──────────────
  const [updated] = await db
    .update(racuniTable)
    .set({ steviloPrintov: sql`${racuniTable.steviloPrintov} + 1` })
    .where(and(eq(racuniTable.id, id), eq(racuniTable.enotaId, tenotaId)))
    .returning({ steviloPrintov: racuniTable.steviloPrintov });
  const steviloPrintov = updated?.steviloPrintov ?? 1;

  // ── 2. Vzporedne poizvedbe ──────────────────────────────────────────────────
  const [postavkeRawZcs, nastavitveMap, enotaRow] = await Promise.all([
    db.select({
      id: postavkeTable.id, ime: postavkeTable.ime, kolicina: postavkeTable.kolicina,
      cenaKos: postavkeTable.cenaKos, cenaKosOriginalna: postavkeTable.cenaKosOriginalna,
      skupaj: postavkeTable.skupaj, davek: postavkeTable.davek,
      opomba: postavkeTable.opomba, parentPostavkaId: postavkeTable.parentPostavkaId,
      artikelId: postavkeTable.artikelId, jeEmbalaza: postavkeTable.jeEmbalaza, toGo: postavkeTable.toGo,
    }).from(postavkeTable).where(and(
      eq(postavkeTable.racunId, id),
      receiptVisiblePostavkaClause(),
    )).orderBy(postavkeTable.id),
    readAllWithFallback(tenotaId),
    db.select({ opis: enoteTable.opis }).from(enoteTable).where(eq(enoteTable.id, tenotaId)).limit(1),
  ]);
  const nav = toResponse(nastavitveMap);
  const enotaOpis = enotaRow[0]?.opis ?? null;

  // Prilagodi postavke za bon za pico (pokrite pice → cenaKos=0, DDV razrez bo pravilen)
  const postavke = await buildBonPicaAdjustedPostavke(postavkeRawZcs as any, racunRaw.steviloBonov);

  // ── 3. Storno referenca ─────────────────────────────────────────────────────
  let stornoIzvornaRacunStevilka: string | null = null;
  if (racunRaw.jeStorno && racunRaw.izvorniRacunId) {
    const [izv] = await db.select({ stevilkaRacuna: racuniTable.stevilkaRacuna })
      .from(racuniTable).where(eq(racuniTable.id, racunRaw.izvorniRacunId)).limit(1);
    stornoIzvornaRacunStevilka = izv?.stevilkaRacuna ?? null;
  }

  // ── 4. FURS QR URL — vedno generiraj (z "12345678" rezervo) ────────────────
  const datumCas = new Date(racunRaw.datumCas ?? racunRaw.ustvarjeno);
  const qrVsebina = racunRaw.zoi
    ? fursQrKoda(racunRaw.zoi, nav.davcnaStevilka ?? "12345678", datumCas, Number(racunRaw.skupaj))
    : null;

  // ── 5. Sestavi tiskalne podatke — enako kot original FURS-POS ──────────────
  // ?cols=32 za BT most 58mm (Q10); ?cols=40 za BT most 80mm; privzeto 30 (ZCS Z92 nespremenjen)
  const _c = req.query.cols;
  const reqCols: 30 | 32 | 40 = _c === "32" ? 32 : _c === "40" ? 40 : 30;
  // ZCS Z92 (cols=30) ne podpira "H" (dvojna višina) — APK ustavi tiskanje ob "H".
  // BT most (cols=32/40) "H" podpira. NB80 ima ločen endpoint.
  const supportsDoubleHeight = reqCols !== 30;

  const rezultat = buildTextReceipt({
    stevilkaRacuna: racunRaw.stevilkaRacuna,
    datum: datumCas,
    mizaStevilka: racunRaw.mizaStevilka ?? null,
    skupaj: Number(racunRaw.skupaj),
    ddv: Number(racunRaw.ddv),
    placilnaNacin: racunRaw.placilnaNacin as "gotovina" | "kartica" | "bon" | "bon_pica" | "negotovinsko" | "reprezentanca" | "lastna_poraba",
    status: racunRaw.status as "poslan" | "napaka" | "testni",
    zoi: racunRaw.zoi ?? null,
    eor: racunRaw.eor ?? null,
    fursQrUrl: qrVsebina,
    nazivRestvracije: nav.nazivRestavracije ?? "Restavracija",
    naslovRestvracije: nav.naslovRestavracije ?? "",
    enotaOpis,
    davcnaStevilka: nav.davcnaStevilka ?? "12345678",
    racunPozdrav1: nav.racunPozdrav1 ?? "Hvala za obisk!",
    racunPozdrav2: nav.racunPozdrav2 ?? "Vracamo se — se vidimo.",
    steviloPrintov,
    kupecDavcnaStevilka: racunRaw.kupecDavcnaStevilka ?? null,
    kupecNaziv: racunRaw.kupecNaziv ?? null,
    kupecNaslov: racunRaw.kupecNaslov ?? null,
    kupecZavezanecDdv: racunRaw.kupecZavezanecDdv ?? null,
    vivaTerminalSessionId: racunRaw.vivaTerminalSessionId ?? null,
    sumupCheckoutId: racunRaw.sumupCheckoutId ?? null,
    natakarIme: racunRaw.natakarIme ?? null,
    stornoIzvornaRacunStevilka,
    racunMaticna: nav.racunMaticna || null,
    racunSodisce: nav.racunSodisce || null,
    racunKapital: nav.racunKapital || null,
    racunDdvKlavzula: nav.racunDdvKlavzula || null,
    racunPravnaKlavzula: nav.racunPravnaKlavzula || null,
    prodajalecIban: nav.prodajalecIban || null,
    prodajalecBic: nav.prodajalecBic || null,
    dniOdloga: racunRaw.dniOdloga ?? null,
    znesekGotovina: racunRaw.znesekGotovina != null ? Number(racunRaw.znesekGotovina) : null,
    znesekKartica: racunRaw.znesekKartica != null ? Number(racunRaw.znesekKartica) : null,
    znesekNapitnina: Number(racunRaw.znesekNapitnina ?? 0),
    znesekBon: racunRaw.znesekBon != null ? Number(racunRaw.znesekBon) : null,
    steviloBonov: racunRaw.steviloBonov ?? null,
    znesekBonPica: racunRaw.znesekBonPica != null ? Number(racunRaw.znesekBonPica) : null,
    znesekNegotovinsko: racunRaw.znesekNegotovinsko != null ? Number(racunRaw.znesekNegotovinsko) : null,
    jeDdvZavezanec: (req as any).jeDdvZavezanec ?? true,
    postavke: (postavke as any[]).map((p: any) => ({
      postavkaId: p.id, ime: p.ime, kolicina: Number(p.kolicina),
      cenaKos: Number(p.cenaKos),
      cenaKosOriginalna: p.cenaKosOriginalna != null ? Number(p.cenaKosOriginalna) : null,
      skupaj: Number(p.skupaj), davek: Number(p.davek),
      opomba: p.opomba ?? null, parentPostavkaId: p.parentPostavkaId ?? null,
      jeEmbalaza: p.jeEmbalaza === true,
      toGo: p.toGo === true,
    })),
  }, reqCols, supportsDoubleHeight);

  // ── 6. QR koda kot PNG base64 — APK jo natisne kot sliko ───────────────────
  if (qrVsebina) {
    try {
      const qrPng = await QRCode.toBuffer(qrVsebina, {
        type: "png",
        width: 125,  // 250→125: 4cm→2cm na 80mm BT tiskalnik
        margin: 1,
        errorCorrectionLevel: "M",
      });
      rezultat.qrBase64 = qrPng.toString("base64");
    } catch (qrErr) {
      // QR PNG ni uspel — APK bo izpustil sliko
    }
  }

  // ZOI za Code 128 črtno kodo v APK-ju
  (rezultat as any).zoi = racunRaw.zoi ?? null;

  res.json(rezultat);
});

// ── GET /print/racun/:id/html — brskalniški tisk računa ──────────────────────
router.get("/print/racun/:id/html", async (req: Request, res: Response): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).send("Neveljaven ID"); return; }

  // Naloži račun — vsa polja enaka kot pri ESC/POS tiskanju
  const [racun] = await db
    .select({
      id: racuniTable.id,
      narociloId: racuniTable.narociloId,
      stevilkaRacuna: racuniTable.stevilkaRacuna,
      skupaj: racuniTable.skupaj,
      ddv: racuniTable.ddv,
      placilnaNacin: racuniTable.placilnaNacin,
      status: racuniTable.status,
      zoi: racuniTable.zoi,
      eor: racuniTable.eor,
      natakarIme: racuniTable.natakarIme,
      datumCas: racuniTable.datumCas,
      ustvarjeno: racuniTable.ustvarjeno,
      opomba: racuniTable.opomba,
      jeDelni: racuniTable.jeDelni,
      jeStorno: racuniTable.jeStorno,
      izvorniRacunId: racuniTable.izvorniRacunId,
      steviloPrintov: racuniTable.steviloPrintov,
      znesekGotovina: racuniTable.znesekGotovina,
      znesekKartica: racuniTable.znesekKartica,
      znesekNapitnina: racuniTable.znesekNapitnina,
      znesekBon: racuniTable.znesekBon,
      steviloBonov: racuniTable.steviloBonov,
      znesekBonPica: racuniTable.znesekBonPica,
      znesekNegotovinsko: racuniTable.znesekNegotovinsko,
      dniOdloga: racuniTable.dniOdloga,
      kupecDavcnaStevilka: racuniTable.kupecDavcnaStevilka,
      kupecNaziv: racuniTable.kupecNaziv,
      kupecNaslov: racuniTable.kupecNaslov,
      kupecZavezanecDdv: racuniTable.kupecZavezanecDdv,
      sumupCheckoutId: racuniTable.sumupCheckoutId,
      vivaTerminalSessionId: racuniTable.vivaTerminalSessionId,
      mizaStevilka: mizeTable.stevilka,
    })
    .from(racuniTable)
    .leftJoin(narocilaTable, eq(racuniTable.narociloId, narocilaTable.id))
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .where(and(eq(racuniTable.id, id), eq(racuniTable.enotaId, tenotaId)))
    .limit(1);

  if (!racun) { res.status(404).send("Račun ni najden"); return; }

  // Inkrement steviloPrintov — atomično pred vsem ostalim
  const [updatedHtml] = await db
    .update(racuniTable)
    .set({ steviloPrintov: sql`${racuniTable.steviloPrintov} + 1` })
    .where(and(eq(racuniTable.id, id), eq(racuniTable.enotaId, tenotaId)))
    .returning({ steviloPrintov: racuniTable.steviloPrintov });
  const steviloPrintovHtml = updatedHtml?.steviloPrintov ?? 1;

  // Naloži postavke, nastavitve in enoto vzporedno
  const [postavkeRawHtml, nastavitveMap, enota] = await Promise.all([
    db.select({
      id: postavkeTable.id,
      ime: postavkeTable.ime,
      kolicina: postavkeTable.kolicina,
      cenaKos: postavkeTable.cenaKos,
      cenaKosOriginalna: postavkeTable.cenaKosOriginalna,
      skupaj: postavkeTable.skupaj,
      davek: postavkeTable.davek,
      opomba: postavkeTable.opomba,
      parentPostavkaId: postavkeTable.parentPostavkaId,
      artikelId: postavkeTable.artikelId,
      jeEmbalaza: postavkeTable.jeEmbalaza,
      toGo: postavkeTable.toGo,
    }).from(postavkeTable).where(and(
      eq(postavkeTable.racunId, id),
      receiptVisiblePostavkaClause(),
    )).orderBy(postavkeTable.id),
    readAllWithFallback(tenotaId),
    db.select({ opis: enoteTable.opis }).from(enoteTable).where(eq(enoteTable.id, tenotaId)).limit(1),
  ]);
  const nav = toResponse(nastavitveMap);
  const enotaOpis = enota[0]?.opis ?? null;

  // Prilagodi postavke za bon za pico (pokrite pice → cenaKos=0, DDV razrez bo pravilen)
  const postavke = await buildBonPicaAdjustedPostavke(postavkeRawHtml as any, racun.steviloBonov);

  // Izvorni račun za storno — prikazano v glavi
  let stornoIzvornaRacunStevilka: string | null = null;
  if (racun.jeStorno && racun.izvorniRacunId) {
    const [izv] = await db
      .select({ stevilkaRacuna: racuniTable.stevilkaRacuna })
      .from(racuniTable)
      .where(eq(racuniTable.id, racun.izvorniRacunId))
      .limit(1);
    stornoIzvornaRacunStevilka = izv?.stevilkaRacuna ?? null;
  }

  const datumCas = new Date(racun.datumCas ?? racun.ustvarjeno);

  // Sestavi PrintRacunData — enako kot pri ESC/POS tiskalniku
  const printData: PrintRacunData = {
    stevilkaRacuna: racun.stevilkaRacuna,
    datum: datumCas,
    mizaStevilka: racun.mizaStevilka ?? null,
    natakarIme: racun.natakarIme ?? null,
    postavke: (postavke as any[]).map((p: any) => ({
      postavkaId: p.id,
      ime: p.ime,
      kolicina: Number(p.kolicina),
      cenaKos: Number(p.cenaKos),
      cenaKosOriginalna: p.cenaKosOriginalna != null ? Number(p.cenaKosOriginalna) : null,
      skupaj: Number(p.skupaj),
      davek: Number(p.davek),
      opomba: p.opomba ?? null,
      parentPostavkaId: p.parentPostavkaId ?? null,
      jeEmbalaza: p.jeEmbalaza === true,
      toGo: p.toGo === true,
    })),
    skupaj: Number(racun.skupaj),
    ddv: Number(racun.ddv),
    placilnaNacin: racun.placilnaNacin as PrintRacunData["placilnaNacin"],
    zoi: racun.zoi ?? null,
    eor: racun.eor ?? null,
    fursQrUrl: racun.zoi ? fursQrKoda(racun.zoi, nav.davcnaStevilka ?? "12345678", datumCas, Number(racun.skupaj)) : null,
    status: racun.status as "poslan" | "napaka" | "testni",
    nazivRestvracije: nav.nazivRestavracije ?? "Restavracija",
    naslovRestvracije: nav.naslovRestavracije ?? "",
    davcnaStevilka: nav.davcnaStevilka ?? "12345678",
    enotaOpis: enotaOpis,
    racunPozdrav1: nav.racunPozdrav1 ?? "Hvala za obisk!",
    racunPozdrav2: nav.racunPozdrav2 ?? "Vracamo se — se vidimo.",
    steviloPrintov: steviloPrintovHtml,
    kupecDavcnaStevilka: racun.kupecDavcnaStevilka ?? null,
    kupecNaziv: racun.kupecNaziv ?? null,
    kupecNaslov: racun.kupecNaslov ?? null,
    kupecZavezanecDdv: racun.kupecZavezanecDdv ?? null,
    stornoIzvornaRacunStevilka,
    racunMaticna: nav.racunMaticna || null,
    racunSodisce: nav.racunSodisce || null,
    racunKapital: nav.racunKapital || null,
    racunDdvKlavzula: nav.racunDdvKlavzula || null,
    racunPravnaKlavzula: nav.racunPravnaKlavzula || null,
    prodajalecIban: nav.prodajalecIban || null,
    prodajalecBic: nav.prodajalecBic || null,
    dniOdloga: racun.dniOdloga ?? null,
    znesekGotovina: racun.znesekGotovina != null ? Number(racun.znesekGotovina) : null,
    znesekKartica: racun.znesekKartica != null ? Number(racun.znesekKartica) : null,
    znesekNapitnina: Number(racun.znesekNapitnina ?? 0),
    znesekBon: racun.znesekBon != null ? Number(racun.znesekBon) : null,
    steviloBonov: racun.steviloBonov ?? null,
    znesekBonPica: racun.znesekBonPica != null ? Number(racun.znesekBonPica) : null,
    znesekNegotovinsko: racun.znesekNegotovinsko != null ? Number(racun.znesekNegotovinsko) : null,
    vivaTerminalSessionId: racun.vivaTerminalSessionId ?? null,
    sumupCheckoutId: racun.sumupCheckoutId ?? null,
    jeDdvZavezanec: (req as any).jeDdvZavezanec ?? true,
  };

  // ── HTML generacija — buildTextReceipt(32) → <pre> ─────────────────────────
  const { linee, formati, qrUrl } = buildTextReceipt(printData, 32);

  // QR koda server-side (qrcode paket, brez zunanjih klicev)
  let qrDataUrl: string | null = null;
  if (qrUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 180, margin: 1, color: { dark: "#000000", light: "#ffffff" } });
    } catch { /* preskoči */ }
  }

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Vsaka vrstica → ena vrstica v <pre>; krepke vrstice z <b>
  const preVsebina = linee.map((l, i) =>
    formati[i] === "B" ? `<b>${esc(l)}</b>` : esc(l)
  ).join("\n");

  const html = `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Račun ${esc(printData.stevilkaRacuna)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#fff;color:#000}
pre{
  font-family:'Courier New',Courier,monospace;
  font-size:12.5px;
  line-height:1.35;
  white-space:pre;
  padding:4mm 3mm 8mm;
}
b{font-weight:bold}
.qr{text-align:center;padding:4px 0}
@media print{
  pre{font-size:12px;line-height:1.3;padding:2mm 3mm 4mm}
  @page{margin:0;size:72mm auto}
}
</style>
</head>
<body>
<pre>${preVsebina}</pre>
${qrDataUrl ? `<div class="qr"><img src="${qrDataUrl}" width="180" height="180" alt="QR FURS"></div>` : ""}
<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),600));</script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// ── Pomožna funkcija za izgradnjo ESC/POS podatkov (deljeno med endpointi) ────
/**
 * Za tiskalniške izhode: prilagodi cenaKos/skupaj postavk pokritih z bon za pico.
 * Pokrite pice dobijo cenaKos=0, skupaj=0, cenaKosOriginalna=original →
 * escpos izpiše "100% popust" vrstico in pravilno izračuna DDV razrez po stopnjah.
 */
async function buildBonPicaAdjustedPostavke(
  postavke: Array<{ id: number; artikelId?: number | null; kolicina: number; cenaKos: unknown; skupaj: unknown; cenaKosOriginalna?: unknown; [k: string]: unknown }>,
  steviloBonov: number | null | undefined,
): Promise<typeof postavke> {
  if (!steviloBonov || steviloBonov <= 0) return postavke;
  const artikelIds = postavke.map(p => p.artikelId).filter((id): id is number => id != null);
  const pizzaSet = new Set<number>();
  if (artikelIds.length > 0) {
    const pizzaArtikli = await db.select({ id: artikliTable.id })
      .from(artikliTable)
      .where(and(inArray(artikliTable.id, artikelIds), eq(artikliTable.jePica, true)));
    for (const a of pizzaArtikli) pizzaSet.add(a.id);
  }
  type Unit = { postavkaId: number; cenaKos: number };
  const units: Unit[] = [];
  for (const p of postavke) {
    if (p.artikelId != null && pizzaSet.has(p.artikelId) && Number(p.kolicina) > 0) {
      for (let i = 0; i < Number(p.kolicina); i++) {
        units.push({ postavkaId: p.id, cenaKos: Number(p.cenaKos) });
      }
    }
  }
  units.sort((a, b) => b.cenaKos - a.cenaKos);
  const coveredMap = new Map<number, number>();
  for (const u of units.slice(0, steviloBonov)) {
    if (u.cenaKos <= 0) continue;
    coveredMap.set(u.postavkaId, (coveredMap.get(u.postavkaId) ?? 0) + 1);
  }
  return postavke.map(p => {
    const covered = coveredMap.get(p.id) ?? 0;
    if (covered <= 0) return p;
    const origCena = Number(p.cenaKos);
    const paidKol = Number(p.kolicina) - covered;
    if (covered >= Number(p.kolicina)) {
      return { ...p, cenaKos: 0, skupaj: 0, cenaKosOriginalna: origCena };
    } else {
      const newSkupaj = Math.round(paidKol * origCena * 100) / 100;
      return { ...p, skupaj: newSkupaj };
    }
  });
}

async function buildEscPosData(id: number, tenotaId: number, jeDdvZavezanec = true) {
  const [racunRaw] = await db
    .select({ ...baseSelect, kupecZavezanecDdv: racuniTable.kupecZavezanecDdv })
    .from(racuniTable)
    .leftJoin(narocilaTable, eq(racuniTable.narociloId, narocilaTable.id))
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .where(and(eq(racuniTable.id, id), eq(racuniTable.enotaId, tenotaId)))
    .limit(1);
  if (!racunRaw) return null;

  const [updatedEsc] = await db
    .update(racuniTable)
    .set({ steviloPrintov: sql`${racuniTable.steviloPrintov} + 1` })
    .where(and(eq(racuniTable.id, id), eq(racuniTable.enotaId, tenotaId)))
    .returning({ steviloPrintov: racuniTable.steviloPrintov });
  const steviloPrintov = updatedEsc?.steviloPrintov ?? 1;

  const [postavkeRaw, nastavitveMap, enotaRow] = await Promise.all([
    db.select().from(postavkeTable).where(and(
      eq(postavkeTable.racunId, id),
      receiptVisiblePostavkaClause(),
    )).orderBy(postavkeTable.id),
    readAllWithFallback(tenotaId),
    db.select({ opis: enoteTable.opis }).from(enoteTable).where(eq(enoteTable.id, tenotaId)).limit(1),
  ]);
  const nav = toResponse(nastavitveMap);

  // Prilagodi postavke za bon za pico (pokrite pice → cenaKos=0, DDV razrez bo pravilen)
  const postavke = await buildBonPicaAdjustedPostavke(postavkeRaw as any, racunRaw.steviloBonov);

  let stornoIzvornaRacunStevilka: string | null = null;
  if (racunRaw.jeStorno && racunRaw.izvorniRacunId) {
    const [izv] = await db.select({ stevilkaRacuna: racuniTable.stevilkaRacuna })
      .from(racuniTable).where(eq(racuniTable.id, racunRaw.izvorniRacunId)).limit(1);
    stornoIzvornaRacunStevilka = izv?.stevilkaRacuna ?? null;
  }

  const datumCas = new Date(racunRaw.datumCas ?? racunRaw.ustvarjeno);

  return {
    racunRaw,
    steviloPrintov,
    postavke,
    nav,
    enotaOpis: enotaRow[0]?.opis ?? null,
    stornoIzvornaRacunStevilka,
    datumCas,
    jeDdvZavezanec,
  };
}

/** Skupne vrednosti kodnih strani — veljavne za vse ESC/POS poti */
type TiskalnikEncoding = "cp1250" | "wpc1250" | "cp852" | "ascii-translit" | "bitmap";

/**
 * Prebere tiskalnikCodePage in tiskalnikSirina za enoto/napravo.
 *
 * Kdaj klicati z napravaId (priporočeno za BT/Serial/Sunmi tisk):
 *   resolveEncodingFromSettings(enotaId, napravaId)
 *   → bere config TOČNO te naprave; vrne njeno kodna stran + cols.
 *     Privzetki: cp1250, 32 cols (če naprava nima vrednosti ali ni najdena).
 *
 * Kdaj klicati brez napravaId (agent pot — išče napravo z agentTiskalnikIme):
 *   resolveEncodingFromSettings(enotaId)
 *   → stara logika: iterira vse naprave, vrne prvo z agentTiskalnikIme,
 *     fallback na katerokoli napravo z nastavljenim tiskalnikCodePage.
 */
async function resolveEncodingFromSettings(
  enotaId: number,
  napravaId?: number,
): Promise<{ encoding: TiskalnikEncoding; cols: number }> {
  let cols = 32;
  let encoding: TiskalnikEncoding = "cp1250";

  if (napravaId != null) {
    // ── Per-naprava pot: beri config točno te naprave ──────────────────────
    const [row] = await db
      .select({ nastavitveJson: napraveTable.nastavitveJson })
      .from(napraveTable)
      .where(and(eq(napraveTable.id, napravaId), eq(napraveTable.enotaId, enotaId)))
      .limit(1);
    if (row?.nastavitveJson) {
      try {
        const cfg = JSON.parse(row.nastavitveJson) as Record<string, unknown>;
        // cols: 58mm = privzeto 32, 80mm = 40, 30mm (NB80 58mm) = 30
        if (Number(cfg.tiskalnikSirina) === 80) cols = 40;
        else if (Number(cfg.tiskalnikSirina) === 30) cols = 30;
        // kodna stran: beri direktno iz te naprave
        if (cfg.tiskalnikCodePage === "cp852") encoding = "cp852";
        else if (cfg.tiskalnikCodePage === "wpc1250") encoding = "wpc1250";
        else if (cfg.tiskalnikCodePage === "ascii-translit") encoding = "ascii-translit";
        else if (cfg.tiskalnikCodePage === "bitmap") encoding = "bitmap";
        else if (cfg.tiskalnikCodePage === "cp1250") encoding = "cp1250";
        // brez tiskalnikCodePage → privzetek cp1250
      } catch { /* pokvarjen JSON → privzetki */ }
    }
    return { encoding, cols };
  }

  // ── Brez napravaId: stara logika za agent pot ──────────────────────────
  // Prioriteta: 1) naprava z agentTiskalnikIme  2) fallback na katerokoli z CP
  let fallbackEncoding: TiskalnikEncoding | null = null;
  const vseNaprave = await db
    .select({ nastavitveJson: napraveTable.nastavitveJson })
    .from(napraveTable)
    .where(eq(napraveTable.enotaId, enotaId));
  for (const row of vseNaprave) {
    if (!row.nastavitveJson) continue;
    try {
      const cfg = JSON.parse(row.nastavitveJson) as Record<string, unknown>;
      if (cfg.agentTiskalnikIme) {
        // Windows tiskalni agent — najvišja prioriteta
        if (Number(cfg.tiskalnikSirina) === 80) cols = 40;
        if (cfg.tiskalnikCodePage === "cp852") encoding = "cp852";
        else if (cfg.tiskalnikCodePage === "wpc1250") encoding = "wpc1250";
        else if (cfg.tiskalnikCodePage === "ascii-translit") encoding = "ascii-translit";
        else if (cfg.tiskalnikCodePage === "bitmap") encoding = "bitmap";
        return { encoding, cols }; // najdeno — takoj vrni
      }
      // Fallback: BT ali druga naprava z nastavljenim tiskalnikCodePage
      if (fallbackEncoding === null && cfg.tiskalnikCodePage) {
        const cp = cfg.tiskalnikCodePage as string;
        if (cp === "cp852" || cp === "wpc1250" || cp === "ascii-translit" || cp === "bitmap") fallbackEncoding = cp as TiskalnikEncoding;
        else if (cp === "cp1250") fallbackEncoding = "cp1250";
      }
    } catch { /* preskoči pokvarjen JSON */ }
  }
  if (fallbackEncoding !== null) encoding = fallbackEncoding;
  return { encoding, cols };
}

async function buildEscPosBytes(
  d: NonNullable<Awaited<ReturnType<typeof buildEscPosData>>>,
  cols: number,
  encoding: TiskalnikEncoding = "cp1250",
): Promise<Uint8Array> {
  const { racunRaw, steviloPrintov, postavke, nav, enotaOpis, stornoIzvornaRacunStevilka, datumCas, jeDdvZavezanec } = d;
  const printData: PrintRacunData = {
    stevilkaRacuna: racunRaw.stevilkaRacuna,
    datum: datumCas,
    mizaStevilka: racunRaw.mizaStevilka ?? null,
    skupaj: Number(racunRaw.skupaj),
    ddv: Number(racunRaw.ddv),
    placilnaNacin: racunRaw.placilnaNacin as "gotovina" | "kartica" | "bon" | "bon_pica" | "negotovinsko" | "reprezentanca" | "lastna_poraba",
    status: racunRaw.status as "poslan" | "napaka" | "testni",
    zoi: racunRaw.zoi ?? null,
    eor: racunRaw.eor ?? null,
    fursQrUrl: racunRaw.zoi ? fursQrKoda(racunRaw.zoi, nav.davcnaStevilka ?? "12345678", datumCas, Number(racunRaw.skupaj)) : null,
    nazivRestvracije: nav.nazivRestavracije ?? "Restavracija",
    naslovRestvracije: nav.naslovRestavracije ?? "",
    enotaOpis,
    davcnaStevilka: nav.davcnaStevilka ?? "12345678",
    racunPozdrav1: nav.racunPozdrav1 ?? "Hvala za obisk!",
    racunPozdrav2: nav.racunPozdrav2 ?? "Vracamo se — se vidimo.",
    steviloPrintov,
    kupecDavcnaStevilka: racunRaw.kupecDavcnaStevilka ?? null,
    kupecNaziv: racunRaw.kupecNaziv ?? null,
    kupecNaslov: racunRaw.kupecNaslov ?? null,
    kupecZavezanecDdv: racunRaw.kupecZavezanecDdv ?? null,
    vivaTerminalSessionId: racunRaw.vivaTerminalSessionId ?? null,
    sumupCheckoutId: racunRaw.sumupCheckoutId ?? null,
    natakarIme: racunRaw.natakarIme ?? null,
    stornoIzvornaRacunStevilka,
    racunMaticna: nav.racunMaticna || null,
    racunSodisce: nav.racunSodisce || null,
    racunKapital: nav.racunKapital || null,
    racunDdvKlavzula: nav.racunDdvKlavzula || null,
    racunPravnaKlavzula: nav.racunPravnaKlavzula || null,
    prodajalecIban: nav.prodajalecIban || null,
    prodajalecBic: nav.prodajalecBic || null,
    dniOdloga: racunRaw.dniOdloga ?? null,
    znesekGotovina: racunRaw.znesekGotovina != null ? Number(racunRaw.znesekGotovina) : null,
    znesekKartica: racunRaw.znesekKartica != null ? Number(racunRaw.znesekKartica) : null,
    znesekNapitnina: Number(racunRaw.znesekNapitnina ?? 0),
    znesekBon: racunRaw.znesekBon != null ? Number(racunRaw.znesekBon) : null,
    steviloBonov: racunRaw.steviloBonov ?? null,
    znesekBonPica: racunRaw.znesekBonPica != null ? Number(racunRaw.znesekBonPica) : null,
    znesekNegotovinsko: racunRaw.znesekNegotovinsko != null ? Number(racunRaw.znesekNegotovinsko) : null,
    jeDdvZavezanec,
    postavke: postavke.map(p => ({
      postavkaId: p.id, ime: String(p.ime ?? ""), kolicina: p.kolicina,
      cenaKos: Number(p.cenaKos),
      cenaKosOriginalna: p.cenaKosOriginalna != null ? Number(p.cenaKosOriginalna) : null,
      skupaj: Number(p.skupaj), davek: Number(p.davek),
      opomba: (p.opomba as string | null) ?? null,
      parentPostavkaId: (p.parentPostavkaId as number | null) ?? null,
      jeEmbalaza: p.jeEmbalaza === true,
      toGo: p.toGo === true,
    })),
  };
  // ── Bitmap (slikovni) način — rastrska slika; GBK-odporno ─────────────────
  if (encoding === "bitmap") return buildEscPosReceiptBitmap(printData, cols);
  // ── Besedilna pot — CP1250/WPC1250/CP852/ascii-translit ───────────────────
  return buildEscPosReceipt(printData, cols, { encoding });
}

/** ESC/POS binarni izpis — za USB Serial in Bluetooth tiskanje */
router.get("/print/racun/:id", async (req: Request, res: Response): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  // napravaId: query param ?napravaId=N — preberi config točno te naprave (BT/Serial/Sunmi)
  // Brez parametra: stara per-enota logika (združljivost)
  const napravaIdRaw = req.query.napravaId ? parseInt(String(req.query.napravaId), 10) : undefined;
  const napravaId = napravaIdRaw != null && !isNaN(napravaIdRaw) ? napravaIdRaw : undefined;

  const [d, { encoding }] = await Promise.all([
    buildEscPosData(id, tenotaId, (req as any).jeDdvZavezanec ?? true),
    resolveEncodingFromSettings(tenotaId, napravaId),
  ]);
  if (!d) { res.status(404).json({ error: "Račun ni najden" }); return; }

  const bytes = await buildEscPosBytes(d, 32, encoding);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="racun-${d.racunRaw.stevilkaRacuna}.bin"`);
  res.send(Buffer.from(bytes));
});

/** Proxy ESC/POS bajte na Wi-Fi/omrežni tiskalnik (TCP port 9100) */
router.post("/print/racun/:id/network", async (req: Request, res: Response): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const body = req.body as { naslov?: string };
  const naslov = body.naslov?.trim() ?? "";
  if (!naslov) { res.status(400).json({ error: "Naslov tiskalnika je obvezen" }); return; }

  const parts = naslov.split(":");
  const tcpHost = parts[0];
  const tcpPort = parts[1] ? parseInt(parts[1], 10) : 9100;
  if (!tcpHost || isNaN(tcpPort) || tcpPort < 1 || tcpPort > 65535) {
    res.status(400).json({ error: "Neveljaven naslov tiskalnika (npr. 192.168.1.100 ali 192.168.1.100:9100)" });
    return;
  }

  const d = await buildEscPosData(id, tenotaId, (req as any).jeDdvZavezanec ?? true);
  if (!d) { res.status(404).json({ error: "Račun ni najden" }); return; }

  const bytes = await buildEscPosBytes(d, 32);

  try {
    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      socket.setTimeout(5000);
      socket.connect(tcpPort, tcpHost, () => {
        socket.write(Buffer.from(bytes), (writeErr) => {
          if (writeErr) { socket.destroy(); reject(writeErr); }
          else { socket.end(); resolve(); }
        });
      });
      socket.on("error", reject);
      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error(`Timeout — tiskalnik ${tcpHost}:${tcpPort} ne odgovori`));
      });
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Napaka pri pošiljanju na tiskalnik" });
  }
});

/** Windows tiskalni agent — ustvari tiskalno nalogo v bazi (polling) */
router.post("/print/racun/:id/agent", async (req: Request, res: Response): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const d = await buildEscPosData(id, tenotaId, (req as any).jeDdvZavezanec ?? true);
  if (!d) { res.status(404).json({ error: "Račun ni najden" }); return; }

  // Preberi tiskalnikSirina in tiskalnikCodePage prek skupnega helperja
  // (POZOR: /agent endpoint kliče katerakoli naprava — iščemo napravo z agentTiskalnikIme)
  const { encoding: tiskalnikEncoding, cols: tiskalniCols } = await resolveEncodingFromSettings(tenotaId);

  const bytes = await buildEscPosBytes(d, tiskalniCols, tiskalnikEncoding);
  const bajti = Buffer.from(bytes).toString("base64");
  const suppliedOperationId = typeof req.body?.operationId === "string"
    ? req.body.operationId.trim()
    : typeof req.get("Idempotency-Key") === "string" ? req.get("Idempotency-Key")!.trim() : "";
  if (suppliedOperationId.length > 200) {
    res.status(400).json({ error: "operationId je lahko dolg največ 200 znakov." }); return;
  }
  // A no-header retry is still idempotent for an identical receipt payload.
  const payloadHash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  const operationId = suppliedOperationId || `receipt:${id}:${payloadHash}`;
  const idempotencyKey = receiptPrintIdempotencyKey(id, payloadHash, suppliedOperationId);
  const [inserted] = await db.insert(tiskalneNalogeTable).values({
    enotaId: tenotaId, racunId: id, bajti, purpose: "receipt", destination: "agent",
    idempotencyKey, payloadHash,
  }).onConflictDoNothing().returning({ id: tiskalneNalogeTable.id, status: tiskalneNalogeTable.status });
  const job = inserted ?? (await db.select({ id: tiskalneNalogeTable.id, status: tiskalneNalogeTable.status })
    .from(tiskalneNalogeTable)
    .where(and(eq(tiskalneNalogeTable.enotaId, tenotaId), eq(tiskalneNalogeTable.idempotencyKey, idempotencyKey)))
    .limit(1))[0];
  if (!job) { res.status(409).json({ error: "Tiskalne naloge ni bilo mogoče varno ustvariti." }); return; }
  logger.info({ racunId: id, tenotaId, jobId: job.id, duplicate: !inserted }, "agent-print: naloga v trajni vrsti");
  res.status(inserted ? 201 : 200).json({ ok: true, id: job.id, status: job.status, operationId });
});

/** Operator retry after a printer has exhausted automatic attempts or needs review. */
router.post("/print/naloge/:id/retry", async (req: Request, res: Response): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID." }); return; }
  const [job] = await db.update(tiskalneNalogeTable).set({
    status: "queued", availableAt: new Date(), claimedAt: null, claimedBy: null,
    leaseUntil: null, lastError: null,
  }).where(and(
    eq(tiskalneNalogeTable.id, id), eq(tiskalneNalogeTable.enotaId, tenotaId),
    inArray(tiskalneNalogeTable.status, ["failed", "needs_review"]),
  )).returning({ id: tiskalneNalogeTable.id, status: tiskalneNalogeTable.status });
  if (!job) { res.status(404).json({ error: "Neuspešna tiskalna naloga ni najdena." }); return; }
  res.json({ ok: true, ...job });
});

export default router;
