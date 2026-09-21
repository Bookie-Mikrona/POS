import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  darilniBonGibiTable,
  mizeTable,
  narocilaTable,
  posKarticnaPlacilaReferenceTable,
  postavkeTable,
  racunFinalizationPlansTable,
  racunIzdajaZahteveTable,
  racuniTable,
  tipAllocationsTable,
  zalogaGibiTable,
  zalogeTable,
} from "@workspace/db";
import { recomputeZaloge } from "../../lib/pos-zaloge-utils";

export type Money = `${number}`;
export type FinalizationSource = "online" | "offline";
export type FinalizationSourceAuthority = "GATEWAY" | "CLOUD_OFFLINE";

export interface FinalizationPlan {
  readonly version: 2;
  readonly source: FinalizationSource;
  readonly sourceAuthority?: FinalizationSourceAuthority;
  /** Stable device/API operation id. It is the idempotency boundary. */
  readonly sourceOperationId: string;
  readonly receipt: {
    /** Cross-platform legal receipt identity; never a racuni.id. */
    readonly localReceiptId: string;
    /** Server-only execution output. Offline producers MUST omit it. */
    readonly serverRacunId?: number;
    readonly companyId: string;
    readonly enotaId: number;
    readonly orderId: number | null;
    /** Gateway-owned UUID reference; never used as a cloud FK. */
    readonly cloudOrderId?: number | null;
    readonly sourceOrderRef?: string;
    readonly legalNumber: string;
    readonly pp: string;
    readonly b: string;
    readonly ppBSequence: number;
    readonly issuedAt: string;
    readonly isPartial: boolean;
  };
  readonly soldLines: readonly {
    readonly id: number;
    readonly sourceLineRef?: string;
    readonly cloudLineId?: number | null;
    readonly articleId: number | null;
    readonly modifierId: number | null;
    readonly name: string;
    readonly quantity: number;
    readonly unitGross: number;
    readonly gross: number;
    readonly vatRate: number;
    readonly normativeFactor: number | null;
    readonly articleKind: string | null;
    readonly note?: string | null;
    readonly toGo?: boolean;
    readonly courseNumber?: number | null;
    readonly courseSequence?: number | null;
    readonly courseNameSnapshot?: string | null;
    readonly pairingGroupId?: string | null;
    readonly parentCloudLineId?: number | null;
    readonly parentSourceLineRef?: string | null;
  }[];
  /** Immutable cloud state captured before gateway edits. */
  readonly cloudBaseline?: readonly {
    readonly cloudLineId: number;
    readonly articleId: number | null;
    readonly modifierId: number | null;
    readonly quantity: number;
    readonly unitGross: number;
    readonly gross: number;
    readonly vatRate: number;
    readonly name?: string | null;
    readonly note?: string | null;
    readonly toGo?: boolean;
    readonly courseNumber?: number | null;
    readonly courseSequence?: number | null;
    readonly courseNameSnapshot?: string | null;
    readonly pairingGroupId?: string | null;
    readonly parentCloudLineId?: number | null;
    readonly parentSourceLineRef?: string | null;
  }[];
  /** Resolved recipes and modifier recipes; execution never reads recipe/article rows. */
  readonly normativeSnapshot: readonly {
    readonly articleId: number;
    readonly quantity: number;
  }[];
  readonly totals: {
    readonly gross: number;
    readonly net: number;
    readonly vat: number;
    readonly vatGroups: readonly { readonly rate: number; readonly gross: number; readonly vat: number }[];
  };
  readonly payment: {
    readonly method: string;
    readonly cash: number;
    readonly card: number;
    readonly voucher: number;
    readonly pizzaVoucher: number;
    readonly nonCash: number;
    readonly terminalReferenceReservationId: string | null;
    readonly cardPaymentAttemptId: string | null;
    readonly giftVoucherRedemption: number;
  };
  readonly operator: {
    readonly waiterId: number | null;
    readonly name: string | null;
    readonly taxNumber: string | null;
    readonly shiftId: number | null;
    readonly actor: string;
  };
  readonly closure: {
    readonly allLinesCovered: boolean;
    readonly closeOrder: boolean;
    readonly orderId: number | null;
    readonly cloudOrderId?: number | null;
    readonly sourceOrderRef?: string;
    readonly tableId: number | null;
    readonly clearTipAmount: boolean;
  };
  readonly tip: {
    readonly amount: number;
    readonly mode: string | null;
    readonly policyId: string | null;
    readonly feeAmount: number;
    readonly netAmount: number;
    readonly distributionProfile: {
      readonly id: string;
      readonly name: string;
      readonly entries: readonly {
        readonly id: string;
        readonly groupName: string;
        readonly recipientNatakarId: number;
        readonly recipientSnapshot: string;
        readonly sharePercent: number;
      }[];
    } | null;
  };
  readonly stockMovements: readonly {
    readonly articleId: number;
    readonly quantity: number;
    readonly unitWac: number;
    readonly value: number;
    readonly note: string;
    readonly effectiveAt: string;
  }[];
  readonly kds: { readonly effects: readonly { readonly kind: string; readonly lineId: number }[] };
  readonly accounting: { readonly companyId: string; readonly businessDate: string; readonly syncAfterCommit: boolean };
  readonly print: {
    readonly receiptNumber: string;
    readonly issuedAt: string;
    readonly customerName: string | null;
    readonly customerAddress: string | null;
    readonly customerTaxNumber: string | null;
  };
  readonly reservations: { readonly issueReservationId: string };
  readonly furs: { readonly snapshotId: string; readonly requestHash: string; readonly canonicalArtifactLink: string };
}

export class FinalizationPlanConflict extends Error {
  readonly status = 409;
  readonly code = "FINALIZATION_PLAN_MISMATCH";
}

export function canonicalFinalizationJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalFinalizationJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalFinalizationJson(child)}`)
    .join(",")}}`;
}

export function finalizationPlanHash(plan: FinalizationPlan): string {
  return createHash("sha256").update(canonicalFinalizationJson(plan)).digest("hex");
}

export function finalizationPlanAuthority(plan: FinalizationPlan): FinalizationSourceAuthority {
  if (Object.prototype.hasOwnProperty.call(plan, "sourceAuthority")) {
    if (plan.sourceAuthority !== "GATEWAY" && plan.sourceAuthority !== "CLOUD_OFFLINE") {
      throw new FinalizationPlanConflict("Invalid finalization plan sourceAuthority.");
    }
    return plan.sourceAuthority;
  }
  const sourceRef = plan.receipt.sourceOrderRef ?? "";
  if (plan.cloudBaseline !== undefined ||
      (plan.receipt.cloudOrderId == null &&
       /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceRef))) {
    return "GATEWAY";
  }
  return "CLOUD_OFFLINE";
}

export function canonicalGatewaySourceLineRef(orderId: number | string, lineId: number | string): string {
  return `cloud:${orderId}:${lineId}`;
}

/** RFC 4122 UUIDv5, using the operation UUID itself as namespace. */
export function deterministicFinalizationUuid(operationId: string, name: "receipt" | "issue-reservation" | "furs-snapshot"): string {
  const namespace = operationId.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(namespace)) throw new Error("Operation ID must be a UUID.");
  const hash = createHash("sha1").update(Buffer.concat([Buffer.from(namespace, "hex"), Buffer.from(name)])).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const FURS_MESSAGE_ID_NAMESPACE = "7f14bb3e-89d4-5e84-aec8-1ce261acbe10";

export function deterministicFursMessageId(operationId: string): string {
  return uuidV5(FURS_MESSAGE_ID_NAMESPACE, `furs-v1:invoice-message:${operationId}`);
}

/** Fresh identity for a durably allocated FURS transport attempt. */
export function deterministicFursAttemptMessageId(operationId: string, attemptNo: number): string {
  if (!Number.isInteger(attemptNo) || attemptNo < 1) throw new Error("FURS attemptNo mora biti pozitivno celo število.");
  return uuidV5(FURS_MESSAGE_ID_NAMESPACE, `furs-v1:invoice-message:${operationId}:attempt:${attemptNo}`);
}

export function deterministicInvoiceRequestId(localReceiptId: string, operationId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(localReceiptId) || !/^[0-9a-f-]{36}$/i.test(operationId)) {
    throw new Error("Receipt and operation IDs must be UUIDs.");
  }
  return `InvoiceRequest-${localReceiptId.replace(/-/g, "")}-${operationId.replace(/-/g, "")}`;
}

export function deterministicFursAttemptInvoiceRequestId(localReceiptId: string, operationId: string, attemptNo: number): string {
  if (!Number.isInteger(attemptNo) || attemptNo < 1) throw new Error("FURS attemptNo mora biti pozitivno celo število.");
  return `${deterministicInvoiceRequestId(localReceiptId, operationId)}-A${attemptNo}`;
}

function uuidV5(namespaceId: string, name: string): string {
  const namespace = namespaceId.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(namespace)) throw new Error("Namespace ID must be a UUID.");
  const hash = createHash("sha1").update(Buffer.concat([Buffer.from(namespace, "hex"), Buffer.from(name)])).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function validateFinalizationPlan(plan: FinalizationPlan): readonly string[] {
  const errors: string[] = [];
  if (plan.version !== 2) errors.push("Unsupported finalization plan version.");
  if (!plan.sourceOperationId.trim()) errors.push("sourceOperationId is required.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(plan.receipt.localReceiptId)) {
    errors.push("localReceiptId must be a UUID.");
  }
  if (plan.receipt.serverRacunId !== undefined && (!Number.isInteger(plan.receipt.serverRacunId) || plan.receipt.serverRacunId < 1)) {
    errors.push("serverRacunId must be omitted or a positive integer.");
  }
  if (!/^(.*)-(.*)-(\d+)$/.test(plan.receipt.legalNumber)) errors.push("Legal receipt number must contain PP-B-sequence.");
  const cloudOrderId = plan.receipt.cloudOrderId ?? plan.receipt.orderId;
  if (cloudOrderId != null && (!Number.isSafeInteger(cloudOrderId) || cloudOrderId < 1)) {
    errors.push("cloudOrderId must be null or a positive integer.");
  }
  if (finalizationPlanAuthority(plan) === "GATEWAY" && cloudOrderId == null &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(plan.receipt.sourceOrderRef ?? "")) {
    errors.push("Local gateway receipts require an opaque UUID sourceOrderRef.");
  }
  if (plan.receipt.ppBSequence < 1 || !Number.isInteger(plan.receipt.ppBSequence)) errors.push("PP-B sequence must be a positive integer.");
  if (!plan.soldLines.length) errors.push("At least one sold line is required.");
  const authority = finalizationPlanAuthority(plan);
  if (authority === "GATEWAY") {
    const bySource = new Map<string, FinalizationPlan["soldLines"][number]>();
    const cloudIds = new Set<number>();
    for (const line of plan.soldLines) {
      if (typeof line.sourceLineRef !== "string" || line.sourceLineRef !== line.sourceLineRef.trim() || !line.sourceLineRef.trim()) {
        errors.push("Gateway sold lines require a non-empty stable sourceLineRef.");
      } else if (bySource.has(line.sourceLineRef)) {
        errors.push("Gateway sold lines require globally unique sourceLineRef values.");
      } else {
        bySource.set(line.sourceLineRef, line);
      }
      if (line.cloudLineId != null) {
        if (!Number.isSafeInteger(line.cloudLineId) || line.cloudLineId < 1) {
          errors.push("Gateway cloudLineId must be null or a positive integer.");
        } else if (cloudIds.has(line.cloudLineId)) {
          errors.push("Gateway cloudLineId values must be unique.");
        } else {
          cloudIds.add(line.cloudLineId);
        }
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (source: string): void => {
      if (visiting.has(source)) {
        errors.push("Gateway parentSourceLineRef contains a cycle.");
        return;
      }
      if (visited.has(source)) return;
      visiting.add(source);
      const line = bySource.get(source);
      const parent = line?.parentSourceLineRef;
      const isChild = line?.parentCloudLineId != null || line?.modifierId != null || parent != null;
      if (isChild && (typeof parent !== "string" || parent !== parent.trim() || !parent.trim())) {
        errors.push("Gateway child lines require a non-empty parentSourceLineRef.");
      } else if (parent != null) {
        if (!bySource.has(parent)) errors.push("Gateway parentSourceLineRef must resolve within the same plan.");
        else if (parent === source) errors.push("Gateway parentSourceLineRef cannot reference itself.");
        else visit(parent);
      }
      visiting.delete(source);
      visited.add(source);
    };
    for (const source of bySource.keys()) visit(source);
  }
  if (finalizationPlanAuthority(plan) === "CLOUD_OFFLINE") {
    const refs = new Set(plan.soldLines.map(line => line.sourceLineRef).filter((ref): ref is string => Boolean(ref)));
    for (const line of plan.soldLines) {
      if (line.sourceLineRef && line.cloudLineId != null &&
          line.sourceLineRef !== canonicalGatewaySourceLineRef(plan.receipt.cloudOrderId ?? plan.receipt.orderId ?? "", line.cloudLineId)) {
        errors.push("Cloud offline sourceLineRef ni kanoničen.");
      }
      if (line.parentSourceLineRef && !refs.has(line.parentSourceLineRef)) {
        errors.push("Cloud offline parentSourceLineRef ne kaže na obstoječo vrstico.");
      }
    }
  }
  if (![plan.totals.gross, plan.totals.net, plan.totals.vat].every(Number.isFinite)) errors.push("Receipt totals must be finite.");
  if (Math.abs(plan.totals.gross - plan.totals.net - plan.totals.vat) > 0.02) errors.push("Receipt totals are inconsistent.");
  if (plan.stockMovements.some(m => ![m.quantity, m.unitWac, m.value].every(Number.isFinite))) errors.push("Stock snapshots must be finite.");
  if (!plan.furs.snapshotId || !plan.furs.requestHash || !plan.furs.canonicalArtifactLink) errors.push("Canonical FURS artifact is required.");
  if (plan.source === "offline") {
    if (plan.payment.method !== "gotovina" || plan.payment.card !== 0 || plan.payment.terminalReferenceReservationId) {
      errors.push("Offline finalization accepts cash only.");
    }
    if (!plan.receipt.legalNumber) errors.push("Offline finalization requires a preissued legal number.");
    try {
      if (plan.receipt.localReceiptId !== deterministicFinalizationUuid(plan.sourceOperationId, "receipt") ||
          plan.reservations.issueReservationId !== deterministicFinalizationUuid(plan.sourceOperationId, "issue-reservation") ||
          plan.furs.snapshotId !== deterministicFinalizationUuid(plan.sourceOperationId, "furs-snapshot") ||
          plan.furs.canonicalArtifactLink !== `offline:${plan.sourceOperationId}`) {
        errors.push("Offline finalization IDs do not match deterministic UUIDv5 derivation.");
      }
    } catch {
      errors.push("Offline sourceOperationId must be a UUID.");
    }
    if (plan.receipt.serverRacunId !== undefined) errors.push("Offline producer must not provide serverRacunId.");
  }
  return errors;
}

export function assertValidFinalizationPlan(plan: FinalizationPlan): void {
  const errors = validateFinalizationPlan(plan);
  if (errors.length) throw Object.assign(new Error(errors.join(" ")), { status: 422, code: "INVALID_FINALIZATION_PLAN" });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** Validates and seals the fully materialized snapshot before persistence. */
export function createFinalizationPlan(input: FinalizationPlan): FinalizationPlan {
  assertValidFinalizationPlan(input);
  return deepFreeze(input);
}

export async function captureStockMovementIntents(
  tx: any,
  movements: readonly { artikelId: number; kolicina: number; opomba: string; ustvarjeno: string }[],
): Promise<FinalizationPlan["stockMovements"]> {
  const articleIds = [...new Set(movements.map(m => m.artikelId))].sort((a, b) => a - b);
  if (!articleIds.length) return [];
  await recomputeZaloge(articleIds, tx);
  const rows = await tx.select({ articleId: zalogeTable.artikelId, wac: zalogeTable.povprecnaCena })
    .from(zalogeTable).where(inArray(zalogeTable.artikelId, articleIds));
  const wac = new Map<number, number>(rows.map((row: any) => [row.articleId, Number(row.wac ?? 0)]));
  return movements.map(movement => {
    const unitWac = wac.get(movement.artikelId);
    if (unitWac == null || !Number.isFinite(unitWac)) throw new Error(`Manjka zajeti WAC za artikel ${movement.artikelId}.`);
    return {
      articleId: movement.artikelId,
      quantity: movement.kolicina,
      unitWac,
      value: movement.kolicina * unitWac,
      note: movement.opomba,
      effectiveAt: movement.ustvarjeno,
    };
  });
}

export type GatewayMaterialization = {
  bySourceLineRef: Map<string, number>;
  orderedIds: number[];
};

export async function materializeGatewayLines(tx: any, plan: FinalizationPlan, orderId: number): Promise<GatewayMaterialization | null> {
  const gatewayLines = finalizationPlanAuthority(plan) === "GATEWAY" &&
    plan.soldLines.some(line => line.sourceLineRef !== undefined);
  if (!gatewayLines) return null;
  const cloudLineIds = new Set<number>();
  const sourceIds = new Set<string>();
  const resulting = new Map<string, number>();
  const ordered = [...plan.soldLines].sort((a, b) =>
    (a.parentSourceLineRef ? 1 : 0) - (b.parentSourceLineRef ? 1 : 0));
  for (const line of ordered) {
    if (!line.sourceLineRef || sourceIds.has(line.sourceLineRef)) {
      throw new FinalizationPlanConflict("Gateway source line relation is missing or ambiguous.");
    }
    sourceIds.add(line.sourceLineRef);
    const cloudLineId = line.cloudLineId;
    if (cloudLineId != null) {
      if (!Number.isSafeInteger(cloudLineId) || cloudLineId < 1 || cloudLineIds.has(cloudLineId)) {
        throw new FinalizationPlanConflict("Gateway cloud line identity is invalid.");
      }
      cloudLineIds.add(cloudLineId);
      const rows = await tx.execute(sql`
        SELECT id, artikel_id, kolicina, cena_kos, skupaj, davek, racun_id
        FROM postavke WHERE id = ${cloudLineId} AND narocilo_id = ${orderId} FOR UPDATE
      `);
      const row = rows.rows[0] as Record<string, any> | undefined;
      if (!row || row.racun_id != null) throw new FinalizationPlanConflict(`Gateway cloud line ${cloudLineId} is missing or billed.`);
      await tx.execute(sql`
        UPDATE postavke SET artikel_id = ${line.articleId}, modifikator_id = ${line.modifierId},
           ime = ${line.name}, kolicina = ${line.quantity}, cena_kos = ${line.unitGross},
            skupaj = ${line.gross}, davek = ${line.vatRate}, opomba = ${line.note ?? null},
            course_number = ${line.courseNumber ?? null}, course_sequence = ${line.courseSequence ?? null},
            course_name_snapshot = ${line.courseNameSnapshot ?? null}, pairing_group_id = ${line.pairingGroupId ?? null},
            to_go = ${Boolean(line.toGo)}
        WHERE id = ${cloudLineId} AND narocilo_id = ${orderId} AND racun_id IS NULL
      `);
      resulting.set(line.sourceLineRef, cloudLineId);
      continue;
    }
    const inserted = await tx.execute(sql`
      INSERT INTO postavke
        (narocilo_id, artikel_id, modifikator_id, ime, kolicina, cena_kos, skupaj, davek,
          opomba, racun_id, parent_postavka_id, course_number, course_sequence,
          course_name_snapshot, pairing_group_id, to_go)
      VALUES (${orderId}, ${line.articleId}, ${line.modifierId}, ${line.name}, ${line.quantity},
              ${line.unitGross}, ${line.gross}, ${line.vatRate}, ${line.note ?? null}, NULL, NULL,
              ${line.courseNumber ?? null}, ${line.courseSequence ?? null}, ${line.courseNameSnapshot ?? null},
              ${line.pairingGroupId ?? null}, ${Boolean(line.toGo)})
      RETURNING id
    `);
    const insertedId = Number((inserted.rows[0] as { id?: number } | undefined)?.id);
    if (!Number.isSafeInteger(insertedId) || insertedId < 1) {
      throw new FinalizationPlanConflict("Gateway cloud line insertion failed.");
    }
    resulting.set(line.sourceLineRef, insertedId);
  }
  for (const line of ordered) {
    if (line.parentSourceLineRef) {
      const childId = resulting.get(line.sourceLineRef!);
      const parentId = resulting.get(line.parentSourceLineRef);
      if (!childId || !parentId || childId === parentId) {
        throw new FinalizationPlanConflict("Gateway parent-child relation is invalid.");
      }
      await tx.execute(sql`UPDATE postavke SET parent_postavka_id = ${parentId}
        WHERE id = ${childId} AND narocilo_id = ${orderId} AND racun_id IS NULL`);
    } else {
      const topId = resulting.get(line.sourceLineRef!);
      if (!topId) throw new FinalizationPlanConflict("Gateway top-level line relation is invalid.");
      await tx.execute(sql`UPDATE postavke SET parent_postavka_id = NULL
        WHERE id = ${topId} AND narocilo_id = ${orderId} AND racun_id IS NULL`);
    }
  }
  const resultingIds = [...resulting.values()];
  const keep = resultingIds.length
    ? sql`AND id NOT IN (${sql.join(resultingIds.map(id => sql`${id}`), sql`,`)})`
    : sql``;
  await tx.execute(sql`DELETE FROM postavke WHERE narocilo_id = ${orderId} AND racun_id IS NULL ${keep}`);
  return {
    bySourceLineRef: resulting,
    orderedIds: plan.soldLines.map(line => {
      const id = resulting.get(line.sourceLineRef!);
      if (id == null) throw new FinalizationPlanConflict("Gateway source line mapping is incomplete.");
      return id;
    }),
  };
}

/**
 * Transactional execution seam. Call inside one database transaction. Receipt
 * lock is acquired first, followed by stock rows in ascending article id and
 * then order/table/payment rows. Exact replay returns the existing receipt.
 */
export async function executeFinalizationPlan(
  tx: any,
  racunId: number,
  sourceOperationId: string,
  actor: string,
  expectedPlan?: FinalizationPlan,
): Promise<typeof racuniTable.$inferSelect | null> {
  const closureOrderId = expectedPlan?.closure.cloudOrderId ?? expectedPlan?.closure.orderId;
  if (closureOrderId == null) {
    throw new FinalizationPlanConflict("Incomplete finalization plan: closure order identity is required.");
  }
  const locked = await tx.execute(sql`
    SELECT * FROM racuni
    WHERE id = ${racunId} AND je_storno = false AND je_darilni_bon_izdaja = false
    FOR UPDATE
  `);
  const receipt = locked.rows[0] as Record<string, any> | undefined;
  if (!receipt || receipt.furs_state !== "confirmed") return null;

  const [stored] = await tx.select().from(racunFinalizationPlansTable)
    .where(eq(racunFinalizationPlansTable.racunId, racunId)).limit(1);
  if (!stored) throw new Error("Immutable receipt finalization plan manjka.");
  const plan = stored.plan as FinalizationPlan;
  assertValidFinalizationPlan(plan);
  const actualHash = finalizationPlanHash(plan);
  if (actualHash !== stored.planHash) throw new FinalizationPlanConflict("Shranjeni finalization plan ima neveljaven hash.");
  if (stored.sourceOperationId !== sourceOperationId || plan.sourceOperationId !== sourceOperationId) {
    throw new FinalizationPlanConflict("Source operation ID se ne ujema.");
  }
  if (plan.receipt.serverRacunId !== undefined && plan.receipt.serverRacunId !== racunId) {
    throw new FinalizationPlanConflict("Finalization plan server receipt ID se ne ujema.");
  }
  if (receipt.local_receipt_id !== plan.receipt.localReceiptId) {
    throw new FinalizationPlanConflict("Finalization plan local receipt ID se ne ujema z DB linkage.");
  }
  if (expectedPlan && finalizationPlanHash(expectedPlan) !== actualHash) throw new FinalizationPlanConflict("Finalization plan replay se ne ujema.");
  if (receipt.business_finalized_at) {
    const [existing] = await tx.select().from(racuniTable).where(eq(racuniTable.id, racunId)).limit(1);
    return existing ?? null;
  }

  await tx.execute(sql`SELECT id FROM narocila WHERE id = ${closureOrderId} FOR UPDATE`);
  let materializedLineIds: number[] | null = null;
  if (finalizationPlanAuthority(plan) === "GATEWAY" &&
      plan.receipt.sourceOrderRef && plan.soldLines.some(line => line.sourceLineRef !== undefined)) {
    const persisted = await tx.execute(sql`
      SELECT m.cloud_line_id
        , m.source_line_ref
      FROM offline_gateway_receipt_line_mappings m
      JOIN racuni r ON r.offline_receipt_id = m.receipt_id
      WHERE r.id = ${racunId} AND m.order_id = ${closureOrderId}
      ORDER BY m.source_line_ref
    `);
      if (persisted.rows.length === plan.soldLines.length) {
       const expectedMappings = new Map(plan.soldLines.map(line => [line.sourceLineRef, line.cloudLineId]));
       const persistedMappings = new Map<string, number>();
       for (const row of persisted.rows as Array<{ cloud_line_id: number; source_line_ref: string }>) {
        if (!expectedMappings.has(row.source_line_ref) ||
            (expectedMappings.get(row.source_line_ref) != null &&
             expectedMappings.get(row.source_line_ref) !== Number(row.cloud_line_id))) {
          throw new FinalizationPlanConflict("Persisted gateway line mapping does not match signed lines.");
        }
         if (persistedMappings.has(row.source_line_ref)) {
           throw new FinalizationPlanConflict("Persisted gateway line mapping contains duplicate source refs.");
         }
         persistedMappings.set(row.source_line_ref, Number(row.cloud_line_id));
      }
       materializedLineIds = plan.soldLines.map(line => {
         const id = persistedMappings.get(line.sourceLineRef!);
         if (id == null) throw new FinalizationPlanConflict("Persisted gateway line mapping is incomplete.");
         return id;
       });
      const reserved = await tx.execute(sql`
        SELECT id FROM postavke
        WHERE narocilo_id = ${closureOrderId} AND racun_id = ${racunId}
          AND id IN (${sql.join(materializedLineIds.map(id => sql`${id}`), sql`,`)})
      `);
      if (reserved.rows.length !== materializedLineIds.length) {
        throw new FinalizationPlanConflict("Persisted gateway line mapping is not reserved by this receipt.");
      }
    } else {
      throw new FinalizationPlanConflict("Persisted gateway line mapping is incomplete.");
    }
  } else {
    const materialized = await materializeGatewayLines(tx, plan, closureOrderId);
    materializedLineIds = materialized?.orderedIds ?? null;
  }
  const articleIds = [...new Set(plan.stockMovements.map(m => m.articleId))].sort((a, b) => a - b);
  if (articleIds.length) {
    await recomputeZaloge(articleIds, tx);
    await tx.execute(sql`SELECT artikel_id FROM zaloge WHERE artikel_id IN (${sql.join(articleIds.map(id => sql`${id}`), sql`,`)}) ORDER BY artikel_id FOR UPDATE`);
  }
  if (plan.closure.tableId) await tx.execute(sql`SELECT id FROM mize WHERE id = ${plan.closure.tableId} FOR UPDATE`);
  if (plan.payment.terminalReferenceReservationId) {
    await tx.execute(sql`SELECT id FROM pos_karticna_placila_reference WHERE id = ${plan.payment.terminalReferenceReservationId} FOR UPDATE`);
  }

  const lineIds = materializedLineIds ?? plan.soldLines.map(line => line.id);
  if (lineIds.length) {
    const reserved = await tx.update(postavkeTable).set({ racunId })
      .where(and(inArray(postavkeTable.id, lineIds), or(isNull(postavkeTable.racunId), eq(postavkeTable.racunId, racunId))))
      .returning({ id: postavkeTable.id });
    if (reserved.length !== lineIds.length) throw new FinalizationPlanConflict("Postavke so vezane na drug račun.");
  }
  if (plan.tip.amount > 0 && plan.tip.mode === "direct_employee" && plan.tip.policyId) {
    // Profile is resolved and snapshotted when this plan is created; retries
    // must never consult live profile rows.
    const profile = plan.tip.distributionProfile;
    if (profile) {
      const entries = profile.entries;
      let allocatedGross = 0;
      let allocatedFee = 0;
      let allocatedNet = 0;
      for (const [index, entry] of entries.entries()) {
        const isLast = index === entries.length - 1;
        const share = Number(entry.sharePercent) / 100;
        const gross = isLast
          ? Math.max(0, plan.tip.amount - allocatedGross)
          : Math.round(plan.tip.amount * share * 100) / 100;
        const fee = isLast
          ? Math.max(0, plan.tip.feeAmount - allocatedFee)
          : Math.round(plan.tip.feeAmount * share * 100) / 100;
        const net = isLast
          ? Math.max(0, plan.tip.netAmount - allocatedNet)
          : Math.round(plan.tip.netAmount * share * 100) / 100;
        allocatedGross += gross;
        allocatedFee += fee;
        allocatedNet += net;
        const [inserted] = await tx.insert(tipAllocationsTable).values({
          companyId: plan.receipt.companyId, enotaId: plan.receipt.enotaId, racunId,
          tipPolicyId: plan.tip.policyId, natakarId: entry.recipientNatakarId,
          recipientNatakarId: entry.recipientNatakarId, recipientSnapshot: entry.recipientSnapshot,
          allocationKind: "auto", distributionProfileId: profile.id,
          distributionProfileEntryId: entry.id, distributionGroup: entry.groupName,
          distributionSharePercent: entry.sharePercent.toFixed(4),
          distributionProfileSnapshot: {
            profileId: profile.id, profileName: profile.name, groupName: entry.groupName,
            sharePercent: entry.sharePercent.toFixed(4), recipientSnapshot: entry.recipientSnapshot,
          },
          grossAmount: gross.toFixed(2), feeAmount: fee.toFixed(2), netAmount: net.toFixed(2), createdBy: actor,
        }).onConflictDoNothing().returning({ id: tipAllocationsTable.id });
        if (!inserted) {
          const [sameSnapshot] = await tx.select({
            id: tipAllocationsTable.id,
            grossAmount: tipAllocationsTable.grossAmount,
            feeAmount: tipAllocationsTable.feeAmount,
            netAmount: tipAllocationsTable.netAmount,
          }).from(tipAllocationsTable).where(and(
            eq(tipAllocationsTable.racunId, racunId),
            eq(tipAllocationsTable.distributionProfileId, profile.id),
            eq(tipAllocationsTable.distributionProfileEntryId, entry.id),
            eq(tipAllocationsTable.allocationKind, "auto"),
          )).limit(1);
          if (!sameSnapshot
            || Math.abs(Number(sameSnapshot.grossAmount) - gross) > 0.005
            || Math.abs(Number(sameSnapshot.feeAmount) - fee) > 0.005
            || Math.abs(Number(sameSnapshot.netAmount) - net) > 0.005) {
            throw new Error("TIP_ALLOCATION_PARTIAL_CONFLICT");
          }
        }
      }
    } else if (plan.tip.mode === "direct_employee" && plan.operator.waiterId) {
      await tx.insert(tipAllocationsTable).values({
        companyId: plan.receipt.companyId, enotaId: plan.receipt.enotaId, racunId,
        tipPolicyId: plan.tip.policyId, natakarId: plan.operator.waiterId,
        recipientNatakarId: plan.operator.waiterId, recipientSnapshot: plan.operator.name,
        allocationKind: "auto", grossAmount: plan.tip.amount.toFixed(2),
        feeAmount: plan.tip.feeAmount.toFixed(2), netAmount: plan.tip.netAmount.toFixed(2), createdBy: actor,
      }).onConflictDoNothing();
    }
  }
  if (plan.payment.giftVoucherRedemption > 0.005) {
    await tx.insert(darilniBonGibiTable).values({
      companyId: plan.receipt.companyId, racunId, tip: "unovcitev",
      znesek: plan.payment.giftVoucherRedemption.toFixed(2),
    }).onConflictDoNothing();
  }
  if (plan.stockMovements.length) {
    await tx.insert(zalogaGibiTable).values(plan.stockMovements.map(movement => ({
      artikelId: movement.articleId, tip: "poraba" as const, kolicina: String(movement.quantity),
      cenaKos: movement.unitWac.toFixed(6), vrednost: movement.value.toFixed(4),
      opomba: movement.note, referencaId: racunId, ustvarjeno: new Date(movement.effectiveAt),
      effectiveAtSnapshot: new Date(movement.effectiveAt), actorSnapshot: actor,
      sourceSnapshot: "racun_finalization_plan",
    })));
    await recomputeZaloge(articleIds, tx);
  }
  if (plan.closure.clearTipAmount) {
    await tx.update(narocilaTable).set({ znesekNapitnina: "0.00" }).where(eq(narocilaTable.id, closureOrderId));
  }
  if (plan.payment.terminalReferenceReservationId) {
    await tx.update(posKarticnaPlacilaReferenceTable).set({ status: "used", racunId })
      .where(eq(posKarticnaPlacilaReferenceTable.id, plan.payment.terminalReferenceReservationId));
  }
  await tx.update(racunIzdajaZahteveTable).set({ status: "completed", racunId, posodobljeno: new Date() })
    .where(eq(racunIzdajaZahteveTable.id, plan.reservations.issueReservationId));
  if (plan.closure.closeOrder) {
    await tx.update(narocilaTable).set({ status: "zakljuceno" }).where(eq(narocilaTable.id, closureOrderId));
    if (plan.closure.tableId) {
      await tx.update(mizeTable).set({
        status: "prosta", rezervacijaNarocnikId: null, rezervacijaStrankaIme: null,
        rezervacijaTelefon: null, rezervacijaOpomba: null, rezervacijaVeljaDo: null,
      }).where(and(eq(mizeTable.id, plan.closure.tableId), sql`NOT EXISTS (
        SELECT 1 FROM ${narocilaTable}
        WHERE ${narocilaTable.mizaId} = ${plan.closure.tableId} AND ${narocilaTable.status} = 'odprto'
      )`));
    }
  }
  const finalized = await tx.update(racuniTable).set({ businessFinalizedAt: new Date() })
    .where(and(eq(racuniTable.id, racunId), isNull(racuniTable.businessFinalizedAt))).returning();
  if (!finalized[0]) throw new FinalizationPlanConflict("Finalization CAS ni uspel.");
  return finalized[0];
}