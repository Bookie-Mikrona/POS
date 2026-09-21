import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, fursPayloadSnapshotsTable, narocilaTable, offlineFiscalReceiptAttemptsTable,
  offlineFiscalReceiptsTable, postavkeTable, racunFinalizationPlansTable, racuniTable,
  offlineFursTransportAttemptsTable, offlineFursTransportEventsTable,
} from "@workspace/db";
import {
  buildSignedTransportAttempt, pridobiCompanyCert, submitSignedFursInvoice, type FursRacunData,
  type LegalInvoiceCore, type SignedFursInvoiceRequest,
} from "../../lib/pos-furs";
import {
  assertValidFinalizationPlan, executeFinalizationPlan, finalizationPlanHash,
  finalizationPlanAuthority, materializeGatewayLines, FinalizationPlanConflict, type FinalizationPlan,
} from "./finalization-plan";

export type OfflineClaimResult = {
  receiptId: string; racunId: number | null;
  state: "confirmed" | "failed" | "unknown" | "sending" | "needs_review";
  eor: string | null; replay: boolean;
};
export type OfflineFiscalWorkerHooks = {
  afterFursConfirmationPersisted?: () => void | Promise<void>;
  beforeBusinessFinalization?: () => void | Promise<void>;
};
let offlineFiscalWorkerHooks: OfflineFiscalWorkerHooks = {};
export function setOfflineFiscalWorkerHooks(hooks: OfflineFiscalWorkerHooks): void {
  offlineFiscalWorkerHooks = hooks;
}
export function resetOfflineFiscalWorkerHooks(): void {
  offlineFiscalWorkerHooks = {};
}

class OfflineImportConflict extends Error {
  code = "OFFLINE_ORDER_CHANGED";
}

async function assertOrderStillAcceptsPlan(tx: any, plan: FinalizationPlan): Promise<void> {
  const orderId = plan.receipt.cloudOrderId ?? plan.receipt.orderId;
  if (orderId == null) throw new OfflineImportConflict("Gateway UUID receipt is audit-only.");
  const locked = await tx.execute(sql`SELECT id, status FROM narocila WHERE id = ${orderId} AND enota_id = ${plan.receipt.enotaId} FOR UPDATE`);
  if (!locked.rows[0] || locked.rows[0].status !== "odprto") throw new OfflineImportConflict("Naročilo ni več odprto.");
  if (finalizationPlanAuthority(plan) === "GATEWAY" &&
      plan.receipt.sourceOrderRef && plan.soldLines.some(line => line.sourceLineRef !== undefined)) {
    const baseline = plan.cloudBaseline;
    if (!baseline) throw new OfflineImportConflict("Manjka nespremenljiva osnovna slika cloud naročila.");
    const current = await tx.execute(sql`
       SELECT id, artikel_id, modifikator_id, ime, kolicina, cena_kos, skupaj, davek, opomba, to_go,
              parent_postavka_id, course_number, course_sequence, course_name_snapshot, pairing_group_id
      FROM postavke WHERE narocilo_id = ${orderId} AND racun_id IS NULL
      FOR UPDATE
    `);
    const expected = new Map(baseline.map(line => [Number(line.cloudLineId), line]));
    const actual = new Map((current.rows as Record<string, any>[]).map(row => [Number(row.id), row]));
    if (expected.size !== actual.size || [...expected.keys()].some(id => !actual.has(id))) {
      throw new OfflineImportConflict("Cloud vrstice naročila so bile dodane, odstranjene ali zamenjane.");
    }
    for (const [id, line] of expected) {
      const row = actual.get(id)!;
      if ((row.artikel_id == null ? null : Number(row.artikel_id)) !== line.articleId ||
          (row.modifikator_id == null ? null : Number(row.modifikator_id)) !== line.modifierId ||
          String(row.ime ?? "") !== String(line.name ?? "") ||
          Number(row.kolicina) !== Number(line.quantity) ||
          Number(row.cena_kos) !== Number(line.unitGross) ||
          Number(row.skupaj) !== Number(line.gross) ||
          Number(row.davek) !== Number(line.vatRate) ||
          String(row.opomba ?? "") !== String(line.note ?? "") ||
          Boolean(row.to_go) !== Boolean(line.toGo) ||
           (row.course_number == null ? null : Number(row.course_number)) !== (line.courseNumber == null ? null : Number(line.courseNumber)) ||
           (row.course_sequence == null ? null : Number(row.course_sequence)) !== (line.courseSequence == null ? null : Number(line.courseSequence)) ||
           String(row.course_name_snapshot ?? "") !== String(line.courseNameSnapshot ?? "") ||
           String(row.pairing_group_id ?? "") !== String(line.pairingGroupId ?? "") ||
          (row.parent_postavka_id == null ? null : Number(row.parent_postavka_id)) !==
            (line.parentCloudLineId == null ? null : Number(line.parentCloudLineId))) {
        throw new OfflineImportConflict(`Cloud postavka ${id} je bila spremenjena.`);
      }
    }
  }
  if (finalizationPlanAuthority(plan) === "GATEWAY" &&
      plan.receipt.sourceOrderRef && plan.soldLines.some(line => line.sourceLineRef !== undefined)) {
    const cloudIds = plan.soldLines
      .map(line => line.cloudLineId)
      .filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0);
    const rows = cloudIds.length ? await tx.select({
      id: postavkeTable.id, racunId: postavkeTable.racunId,
    }).from(postavkeTable).where(and(eq(postavkeTable.narociloId, orderId), inArray(postavkeTable.id, cloudIds))) : [];
    if (rows.length !== cloudIds.length) throw new OfflineImportConflict("Gateway cloud postavka manjka.");
    for (const row of rows) {
      if (row.racunId != null) throw new OfflineImportConflict(`Gateway cloud postavka ${row.id} je že uporabljena.`);
    }
    return;
  }
  if (finalizationPlanAuthority(plan) === "CLOUD_OFFLINE" &&
      plan.soldLines.some(line => line.sourceLineRef !== undefined)) {
    const bySource = new Map<string, number>();
    for (const line of plan.soldLines) {
      if (!line.sourceLineRef || line.cloudLineId == null || bySource.has(line.sourceLineRef)) {
        throw new OfflineImportConflict("Cloud offline source line identity is missing or ambiguous.");
      }
      bySource.set(line.sourceLineRef, line.cloudLineId);
    }
    const cloudIds = [...bySource.values()];
    const rows = await tx.execute(sql`
      SELECT id, artikel_id, modifikator_id, kolicina, cena_kos, skupaj, davek,
             ime, opomba, to_go, parent_postavka_id, course_number, course_sequence,
             course_name_snapshot, pairing_group_id, racun_id
      FROM postavke
      WHERE narocilo_id = ${orderId} AND id IN (${sql.join(cloudIds.map(id => sql`${id}`), sql`, `)})
      FOR UPDATE
    `);
    if (rows.rows.length !== cloudIds.length) throw new OfflineImportConflict("Cloud offline postavka manjka.");
    const actual = new Map((rows.rows as Record<string, any>[]).map(row => [Number(row.id), row]));
    for (const line of plan.soldLines) {
      const cloudId = bySource.get(line.sourceLineRef!)!;
      const row = actual.get(cloudId)!;
      const expectedParent = line.parentSourceLineRef == null ? null : bySource.get(line.parentSourceLineRef);
      if (line.parentSourceLineRef != null && expectedParent == null) {
        throw new OfflineImportConflict("Cloud offline parent source line is missing or ambiguous.");
      }
      if (row.racun_id != null ||
          (row.artikel_id == null ? null : Number(row.artikel_id)) !== line.articleId ||
          (row.modifikator_id == null ? null : Number(row.modifikator_id)) !== line.modifierId ||
          (row.parent_postavka_id == null ? null : Number(row.parent_postavka_id)) !== (expectedParent ?? null) ||
          String(row.ime ?? "") !== String(line.name ?? "") ||
          Number(row.kolicina) !== line.quantity || Number(row.cena_kos) !== line.unitGross ||
          Number(row.skupaj) !== line.gross || Number(row.davek) !== line.vatRate ||
          String(row.opomba ?? "") !== String(line.note ?? "") ||
          Boolean(row.to_go) !== Boolean(line.toGo) ||
          (row.course_number == null ? null : Number(row.course_number)) !== (line.courseNumber == null ? null : Number(line.courseNumber)) ||
          (row.course_sequence == null ? null : Number(row.course_sequence)) !== (line.courseSequence == null ? null : Number(line.courseSequence)) ||
          String(row.course_name_snapshot ?? "") !== String(line.courseNameSnapshot ?? "") ||
          String(row.pairing_group_id ?? "") !== String(line.pairingGroupId ?? "")) {
        throw new OfflineImportConflict(`Cloud offline postavka ${cloudId} se ne ujema s podpisanim planom.`);
      }
    }
    return;
  }
  const ids = plan.soldLines.map(line => line.id);
  const rows = ids.length ? await tx.select({
    id: postavkeTable.id, artikelId: postavkeTable.artikelId, kolicina: postavkeTable.kolicina,
    cenaKos: postavkeTable.cenaKos, skupaj: postavkeTable.skupaj, davek: postavkeTable.davek,
    racunId: postavkeTable.racunId,
  }).from(postavkeTable).where(and(eq(postavkeTable.narociloId, orderId), inArray(postavkeTable.id, ids))) : [];
  if (rows.length !== ids.length) throw new OfflineImportConflict("Postavke naročila manjkajo.");
  const expected = new Map(plan.soldLines.map(line => [line.id, line]));
  for (const row of rows) {
    const line = expected.get(row.id)!;
    if (row.racunId != null || row.artikelId !== line.articleId ||
        Math.abs(Number(row.kolicina) - line.quantity) > 0.0001 ||
        Math.abs(Number(row.cenaKos) - line.unitGross) > 0.01 ||
        Math.abs(Number(row.skupaj) - line.gross) > 0.01 ||
        Math.abs(Number(row.davek) - line.vatRate) > 0.001) {
      throw new OfflineImportConflict(`Postavka ${row.id} je bila spremenjena ali že uporabljena.`);
    }
  }
}

/**
 * Claims one immutable v2 legal core and allocates a fresh server-signed
 * transport attempt before I/O.  A lease-expired `sending` claim intentionally
 * allocates a new attempt; ambiguous delivery is never replayed.
 */
export async function claimAndSubmitOfflineReceipt(input: {
  receiptId: string; enotaId: number; companyId: string; actor: string;
  fursMode: "testno" | "produkcija"; proxyUrl?: string;
  hooks?: {
    afterFursConfirmationPersisted?: () => void | Promise<void>;
    beforeBusinessFinalization?: () => void | Promise<void>;
  };
}): Promise<OfflineClaimResult> {
  const hooks = { ...offlineFiscalWorkerHooks, ...input.hooks };
  const token = randomUUID();
  let claimed: typeof offlineFiscalReceiptsTable.$inferSelect | undefined;
  let racunId: number | null = null;
  let signedRequest: SignedFursInvoiceRequest | undefined;
  let attemptId: string | undefined;
  let finalizationRequired = false;
  let skipTransportForConfirmed = false;
  let nativePlanResolved = false;
  let preflightQuarantined = false;
  let cert: Awaited<ReturnType<typeof pridobiCompanyCert>> | undefined;
  await db.transaction(async tx => {
      const result = await tx.execute(sql`
        UPDATE offline_fiscal_receipts
         SET claim_token = ${token}, claim_lease_until = now() + interval '5 minutes',
             claimed_at = now(),
             furs_state = CASE WHEN furs_state = 'confirmed' THEN 'confirmed' ELSE 'sending' END
        WHERE id = ${input.receiptId} AND enota_id = ${input.enotaId}
          AND production_enabled = true
           AND (
             furs_state IN ('received_pending_review','pending','sending')
             OR (furs_state = 'confirmed' AND racun_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM racuni r WHERE r.id = offline_fiscal_receipts.racun_id
                 AND r.business_finalized_at IS NULL
             ))
           )
          AND (claim_token IS NULL OR claim_lease_until < now())
        RETURNING *
      `);
      const claimedId = (result.rows[0] as { id?: string } | undefined)?.id;
      if (!claimedId) return;
      [claimed] = await tx.select().from(offlineFiscalReceiptsTable)
        .where(eq(offlineFiscalReceiptsTable.id, claimedId)).limit(1);
      if (!claimed) return;
      let plan = claimed.finalizationPlan as FinalizationPlan;
      const core = claimed.canonicalPayload as LegalInvoiceCore;
      let cloudOrderId = plan.receipt.cloudOrderId ?? plan.receipt.orderId;
      if (finalizationPlanAuthority(plan) === "GATEWAY" && cloudOrderId == null) {
        nativePlanResolved = true;
        const sourceRef = plan.receipt.sourceOrderRef;
        if (!sourceRef) throw new OfflineImportConflict("Gateway UUID receipt nima sourceOrderRef.");
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.enotaId}:${sourceRef}`}))`);
        const mapped = await tx.execute(sql`
          SELECT id FROM narocila
          WHERE enota_id = ${input.enotaId} AND opomba = ${`Gateway native order ${sourceRef}`}
          ORDER BY id ASC LIMIT 1 FOR UPDATE
        `);
        cloudOrderId = mapped.rows[0]?.id ? Number(mapped.rows[0].id) : null;
        if (cloudOrderId == null) {
          const created = await tx.execute(sql`
            INSERT INTO narocila
              (enota_id, status, skupaj, nacin, vir, opomba, ustvarjeno, posodobljeno)
            VALUES (${input.enotaId}, 'odprto', ${plan.totals.gross.toFixed(2)}, 'miza', 'osebje',
                    ${`Gateway native order ${sourceRef}`}, ${new Date(plan.receipt.issuedAt)}, now())
            RETURNING id
          `);
          cloudOrderId = Number(created.rows[0]?.id);
          if (!Number.isInteger(cloudOrderId)) throw new OfflineImportConflict("Native gateway order ni mogoče ustvariti.");
        }
        plan = {
          ...plan,
          receipt: { ...plan.receipt, orderId: cloudOrderId, cloudOrderId },
          closure: { ...plan.closure, orderId: cloudOrderId, cloudOrderId },
          cloudBaseline: plan.cloudBaseline ?? [],
        };
      }
      assertValidFinalizationPlan(plan);
      if (!nativePlanResolved && claimed.finalizationPlanSha256 !== finalizationPlanHash(plan)) {
        throw new Error("Finalization plan hash se ne ujema.");
      }
      if (core.envelopeVersion !== "furs-v2") {
        await tx.update(offlineFiscalReceiptsTable).set({
          fursState: "quarantined", fursLastError: "Legacy furs-v1 ovoja ni dovoljeno poslati.",
          claimToken: null, claimLeaseUntil: null, claimedAt: null, updatedAt: new Date(),
        }).where(and(eq(offlineFiscalReceiptsTable.id, claimed.id), eq(offlineFiscalReceiptsTable.claimToken, token)));
        return;
      }

      await tx.execute(sql`SAVEPOINT offline_gateway_preflight`);
      try {
      if (claimed.racunId) {
        racunId = claimed.racunId;
        const [existingReceipt] = await tx.select({ fursState: racuniTable.fursState })
          .from(racuniTable).where(eq(racuniTable.id, claimed.racunId)).limit(1);
        if (existingReceipt?.fursState === "confirmed") {
          skipTransportForConfirmed = true;
          finalizationRequired = true;
          await tx.update(offlineFiscalReceiptsTable).set({ claimToken: null, claimLeaseUntil: null, updatedAt: new Date() })
            .where(eq(offlineFiscalReceiptsTable.id, claimed.id));
          return;
        }
        await tx.update(racuniTable).set({ fursState: "sending", fursClaimedAt: new Date(), fursClaimedBy: token })
          .where(and(eq(racuniTable.id, claimed.racunId), eq(racuniTable.offlineReceiptId, claimed.id)));
      } else {
        if (cloudOrderId == null) throw new OfflineImportConflict("Cloud offline receipt nima cloudOrderId.");
        await assertOrderStillAcceptsPlan(tx, plan);
        const [racun] = await tx.insert(racuniTable).values({
        enotaId: input.enotaId, narociloId: cloudOrderId, izmenaId: plan.operator.shiftId,
        stevilkaRacuna: plan.receipt.legalNumber, skupaj: plan.totals.gross.toFixed(2),
        ddv: plan.totals.vat.toFixed(2), osnova: plan.totals.net.toFixed(2),
        placilnaNacin: "gotovina", status: "napaka", fursState: "sending",
          fursClaimedAt: new Date(), fursClaimedBy: token, requestHash: claimed.payloadSha256,
        natakarIme: plan.operator.name, natakarDavcna: plan.operator.taxNumber,
        datumCas: new Date(plan.receipt.issuedAt), ustvarjeno: new Date(plan.receipt.issuedAt),
        znesekGotovina: plan.payment.cash.toFixed(2), offlineReceiptId: claimed.id, zoi: claimed.zoi,
        localReceiptId: plan.receipt.localReceiptId,
      }).onConflictDoNothing().returning();
        if (!racun) {
          const [existing] = await tx.select().from(racuniTable).where(eq(racuniTable.offlineReceiptId, claimed.id)).limit(1);
          if (!existing) throw new OfflineImportConflict("Pravna številka je že uporabljena pri drugem računu.");
          if (existing.localReceiptId !== plan.receipt.localReceiptId) {
            throw new OfflineImportConflict("Lokalna identiteta računa se ne ujema z obstoječim DB računom.");
          }
          racunId = existing.id;
        } else {
          racunId = racun.id;
          await tx.insert(fursPayloadSnapshotsTable).values({
          companyId: input.companyId, enotaId: input.enotaId, operationKey: `offline:${claimed.operationId}`,
          racunId, payload: core.legalInvoice, requestHash: claimed.payloadSha256,
          fursNacin: input.fursMode, splosnaStopnja: "22.00",
          signingContextFingerprint: claimed.fursCertificateFingerprint!,
          }).returning();
          await tx.insert(racunFinalizationPlansTable).values({
          racunId, companyId: input.companyId, enotaId: input.enotaId,
          sourceOperationId: claimed.operationId, localReceiptId: plan.receipt.localReceiptId,
           plan, planHash: finalizationPlanHash(plan),
          });
        }
      }
      if (!claimed.racunId && cloudOrderId != null && finalizationPlanAuthority(plan) === "GATEWAY" && plan.receipt.sourceOrderRef &&
          plan.soldLines.some(line => line.sourceLineRef !== undefined)) {
        const materialized = await materializeGatewayLines(tx, plan, cloudOrderId);
         if (!materialized || materialized.bySourceLineRef.size !== plan.soldLines.length ||
             materialized.orderedIds.length !== plan.soldLines.length) {
          throw new OfflineImportConflict("Gateway vrstic ni mogoče materializirati.");
        }
         const orderedMaterializedIds = plan.soldLines.map(line => {
           const id = materialized.bySourceLineRef.get(line.sourceLineRef!);
           if (id == null) throw new OfflineImportConflict("Gateway source line mapping is incomplete.");
           return id;
         });
        const reserved = await tx.update(postavkeTable).set({ racunId })
           .where(and(inArray(postavkeTable.id, orderedMaterializedIds), sql`${postavkeTable.racunId} IS NULL`))
          .returning({ id: postavkeTable.id });
         if (reserved.length !== orderedMaterializedIds.length) {
          throw new OfflineImportConflict("Gateway postavke ni mogoče rezervirati.");
        }
         for (const line of plan.soldLines) {
           const cloudLineId = materialized.bySourceLineRef.get(line.sourceLineRef!);
           if (cloudLineId == null) throw new OfflineImportConflict("Gateway source line mapping is incomplete.");
          await tx.execute(sql`
            INSERT INTO offline_gateway_receipt_line_mappings
              (id, receipt_id, source_line_ref, cloud_line_id, company_id, enota_id, order_id)
             VALUES (${randomUUID()}, ${claimed.id}, ${line.sourceLineRef!}, ${cloudLineId},
                    ${input.companyId}, ${input.enotaId}, ${cloudOrderId})
          `);
        }
        const persistedMappings = await tx.execute(sql`
          SELECT source_line_ref, cloud_line_id
          FROM offline_gateway_receipt_line_mappings
          WHERE receipt_id = ${claimed.id} AND order_id = ${cloudOrderId}
        `);
        const expectedRefs = new Set(plan.soldLines.map(line => line.sourceLineRef));
        if (persistedMappings.rows.length !== plan.soldLines.length ||
            (persistedMappings.rows as Array<{ source_line_ref: string }>).some(row => !expectedRefs.has(row.source_line_ref))) {
          throw new OfflineImportConflict("Gateway source line mapping is incomplete before FURS.");
        }
      }
      await tx.execute(sql`RELEASE SAVEPOINT offline_gateway_preflight`);
      } catch (error) {
        if (!(error instanceof OfflineImportConflict) && !(error instanceof FinalizationPlanConflict)) throw error;
        await tx.execute(sql`ROLLBACK TO SAVEPOINT offline_gateway_preflight`);
        await tx.update(offlineFiscalReceiptsTable).set({
          fursState: "quarantined", fursLastError: error.message,
          claimToken: null, claimLeaseUntil: null, claimedAt: null, updatedAt: new Date(),
        }).where(and(eq(offlineFiscalReceiptsTable.id, claimed.id), eq(offlineFiscalReceiptsTable.claimToken, token)));
        await tx.insert(offlineFiscalReceiptAttemptsTable).values({
          receiptId: claimed.id, action: "quarantine", outcome: "rejected",
          actorReference: input.actor, detail: `preflight:${error.message}`,
        });
        preflightQuarantined = true;
      }
      if (preflightQuarantined) return;
      await tx.update(offlineFiscalReceiptsTable).set({ racunId, updatedAt: new Date() })
        .where(and(eq(offlineFiscalReceiptsTable.id, claimed.id), eq(offlineFiscalReceiptsTable.claimToken, token)));
      await tx.insert(offlineFiscalReceiptAttemptsTable).values({
        receiptId: claimed.id, action: "submit", outcome: "accepted", actorReference: input.actor,
        detail: `claim:${token}`,
      });
      const existingAttempts = await tx.select({ attemptNo: offlineFursTransportAttemptsTable.attemptNo })
        .from(offlineFursTransportAttemptsTable).where(eq(offlineFursTransportAttemptsTable.receiptId, claimed.id))
        .orderBy(sql`${offlineFursTransportAttemptsTable.attemptNo} DESC`).limit(1);
      const attemptNo = (existingAttempts[0]?.attemptNo ?? 0) + 1;
       cert = await pridobiCompanyCert(input.companyId);
       if (!cert?.certPem || !cert.certKljuc) throw new Error("FURS certifikat podjetja manjka.");
       const data: FursRacunData = {
        stevilkaRacuna: plan.receipt.legalNumber, datumCas: new Date(plan.receipt.issuedAt),
        skupaj: plan.totals.gross, ddv: plan.totals.vat, placilnaNacin: "gotovina",
        davcnaStevilka: core.legalInvoice.taxNumber, poslovnaProstor: core.legalInvoice.businessPremiseId,
        blagajnaId: core.legalInvoice.electronicDeviceId, operatorDavcna: core.legalInvoice.operatorTaxNumber,
        postavke: plan.soldLines.map(line => ({ ime: line.name, kolicina: line.quantity, cenaKos: line.unitGross, davek: line.vatRate, skupaj: line.gross })),
        certPem: cert.certPem, certKljuc: cert.certKljuc,
      };
      const attempt = buildSignedTransportAttempt(core, data, attemptNo, new Date());
      attemptId = randomUUID();
      await tx.insert(offlineFursTransportAttemptsTable).values({
        id: attemptId, receiptId: claimed.id, attemptNo, messageId: attempt.messageId,
        invoiceRequestId: attempt.invoiceRequestId, signedXmlBase64: attempt.signedXmlBytes.toString("base64"),
        signedXmlSha256: attempt.signedXmlSha256, certificateFingerprint: core.certificateFingerprint, state: "sending", sentAt: new Date(),
      });
      await tx.insert(offlineFursTransportEventsTable).values({ attemptId, eventType: "allocated", detail: { attemptNo, messageId: attempt.messageId } });
      signedRequest = {
        signedXml: attempt.signedXml, signedXmlBytes: attempt.signedXmlBytes, invoiceXml: "",
        zoi: core.legalInvoice.zoi, certificateFingerprint: core.certificateFingerprint,
        canonicalFields: { ...core.legalInvoice, messageId: attempt.messageId, invoiceRequestId: attempt.invoiceRequestId },
        payloadHash: attempt.signedXmlSha256,
      };
  });
  if (!claimed) {
    const [existing] = await db.select().from(offlineFiscalReceiptsTable)
      .where(and(eq(offlineFiscalReceiptsTable.id, input.receiptId), eq(offlineFiscalReceiptsTable.enotaId, input.enotaId))).limit(1);
    if (!existing) throw Object.assign(new Error("Offline račun ni najden."), { status: 404 });
    return { receiptId: existing.id, racunId: existing.racunId, state: existing.fursState as OfflineClaimResult["state"], eor: existing.eor, replay: true };
  }
  if (skipTransportForConfirmed) {
    try {
      await hooks.beforeBusinessFinalization?.();
      await db.transaction(async tx => {
        const persisted = await tx.execute(sql`SELECT plan FROM pos_racun_finalization_plans WHERE racun_id = ${racunId!} FOR UPDATE`);
        const effectivePlan = persisted.rows[0]?.plan as FinalizationPlan | undefined;
        if (!effectivePlan) throw new FinalizationPlanConflict("Persisted effective finalization plan is missing.");
        await executeFinalizationPlan(tx, racunId!, claimed!.operationId, input.actor, effectivePlan);
        await tx.update(offlineFiscalReceiptsTable).set({
          finalizationNextAttemptAt: null, finalizationLastError: null,
        }).where(eq(offlineFiscalReceiptsTable.id, claimed!.id));
      });
    } catch (error) {
      await db.update(offlineFiscalReceiptsTable).set({
        fursState: "confirmed", fursLastError: error instanceof Error ? error.message : "Business finalization failed.",
        finalizationAttemptCount: sql`${offlineFiscalReceiptsTable.finalizationAttemptCount} + 1`,
        finalizationNextAttemptAt: sql`now() + make_interval(secs => LEAST(3600, 15 * power(2, LEAST(${offlineFiscalReceiptsTable.finalizationAttemptCount} + 1, 8)))::integer)`,
        finalizationLastError: error instanceof Error ? error.message : "Business finalization failed.",
        updatedAt: new Date(),
      }).where(eq(offlineFiscalReceiptsTable.id, claimed.id));
    }
    const [persisted] = await db.select({ fursState: offlineFiscalReceiptsTable.fursState, eor: offlineFiscalReceiptsTable.eor })
      .from(offlineFiscalReceiptsTable).where(eq(offlineFiscalReceiptsTable.id, claimed.id)).limit(1);
    const [business] = racunId ? await db.select({ finalized: racuniTable.businessFinalizedAt })
      .from(racuniTable).where(eq(racuniTable.id, racunId)).limit(1) : [];
    return { receiptId: claimed.id, racunId, state: persisted?.fursState === "needs_review"
      ? "needs_review" : business?.finalized ? "confirmed" : "unknown",
      eor: persisted?.eor ?? null, replay: false };
  }
  if (!signedRequest || !attemptId) throw new Error("FURS transport attempt was not allocated.");
  const outcome = await submitSignedFursInvoice(signedRequest, {
    fursNacin: input.fursMode, proxyUrl: input.proxyUrl, certPem: cert!.certPem, certKljuc: cert!.certKljuc,
  });
  await db.transaction(async tx => {
    await tx.update(offlineFursTransportAttemptsTable).set({
      state: outcome.outcome === "confirmed" ? "confirmed" : outcome.outcome === "unknown" ? "retry_scheduled" : "failed",
      eor: outcome.outcome === "confirmed" ? outcome.eor : null, responseBody: outcome.surovOdgovor,
      errorCode: outcome.napaka, resolvedAt: new Date(),
    }).where(eq(offlineFursTransportAttemptsTable.id, attemptId!));
    await tx.insert(offlineFursTransportEventsTable).values({
      attemptId: attemptId!, eventType: "response",
      detail: { outcome: outcome.outcome, eor: outcome.eor || null, error: outcome.napaka ?? null, body: outcome.surovOdgovor },
    });
    await tx.insert(offlineFiscalReceiptAttemptsTable).values({
      receiptId: claimed!.id, action: outcome.outcome === "unknown" ? "response_unknown" : "submit",
      outcome: outcome.outcome, actorReference: input.actor,
      detail: outcome.outcome === "confirmed" ? `attempt:${attemptId};EOR:${outcome.eor}` : `attempt:${attemptId};${outcome.napaka ?? ""}`,
    });

    const locked = await tx.execute(sql`SELECT eor, furs_state, claim_token FROM offline_fiscal_receipts WHERE id = ${claimed!.id} FOR UPDATE`);
    const current = locked.rows[0] as { eor: string | null; furs_state: string; claim_token: string | null } | undefined;
    if (!current) return;
    if (outcome.outcome === "confirmed") {
      if (current.eor && current.eor !== outcome.eor) {
        await tx.update(offlineFiscalReceiptsTable).set({
          fursState: "needs_review", fursLastError: `Nasprotujoča EOR: ${current.eor} / ${outcome.eor}`,
          claimToken: null, claimLeaseUntil: null, updatedAt: new Date(),
        }).where(eq(offlineFiscalReceiptsTable.id, claimed!.id));
        await tx.update(offlineFursTransportAttemptsTable).set({ state: "review" })
          .where(eq(offlineFursTransportAttemptsTable.id, attemptId!));
        await tx.insert(offlineFursTransportEventsTable).values({
          attemptId: attemptId!, eventType: "review", detail: { reason: "EOR_CONFLICT", acceptedEor: current.eor, receivedEor: outcome.eor },
        });
        return;
      }
      if (current.eor === outcome.eor && current.furs_state === "confirmed") {
        await tx.insert(offlineFursTransportEventsTable).values({
          attemptId: attemptId!, eventType: "confirmed", detail: { eor: outcome.eor, duplicate: true },
        });
        finalizationRequired = true;
        return;
      }
      if (current.furs_state !== "needs_review") {
        await tx.update(offlineFiscalReceiptsTable).set({
          fursState: "confirmed", eor: outcome.eor,
          fursAttemptCount: sql`${offlineFiscalReceiptsTable.fursAttemptCount} + 1`,
          fursLastAttemptAt: new Date(), fursLastError: null, fursConfirmedAt: new Date(),
          claimToken: null, claimLeaseUntil: null, updatedAt: new Date(),
        }).where(eq(offlineFiscalReceiptsTable.id, claimed!.id));
        await tx.update(racuniTable).set({
          fursState: "confirmed", status: "poslan", eor: outcome.eor, fursOdgovor: outcome.surovOdgovor,
          fursLastAttemptAt: new Date(), fursLastError: null, fursConfirmedAt: new Date(),
        }).where(and(eq(racuniTable.id, racunId!), eq(racuniTable.offlineReceiptId, claimed!.id)));
        finalizationRequired = true;
      }
      await tx.insert(offlineFursTransportEventsTable).values({
        attemptId: attemptId!, eventType: "confirmed", detail: { eor: outcome.eor, duplicate: false },
      });
      return;
    }

    // A stale timeout/error remains immutable attempt evidence but cannot
    // overwrite a newer claim or an already accepted EOR.
    if (current.claim_token !== token || current.furs_state === "confirmed" || current.furs_state === "needs_review") return;
    const receiptState = outcome.outcome === "unknown" ? "pending" : "failed";
    await tx.update(offlineFiscalReceiptsTable).set({
      fursState: receiptState, fursAttemptCount: sql`${offlineFiscalReceiptsTable.fursAttemptCount} + 1`,
      fursLastAttemptAt: new Date(), fursLastError: outcome.napaka, claimToken: null, claimLeaseUntil: null, updatedAt: new Date(),
    }).where(and(eq(offlineFiscalReceiptsTable.id, claimed!.id), eq(offlineFiscalReceiptsTable.claimToken, token)));
    await tx.update(racuniTable).set({
      fursState: receiptState, status: "napaka", fursOdgovor: outcome.surovOdgovor,
      fursLastAttemptAt: new Date(), fursLastError: outcome.napaka,
    }).where(and(eq(racuniTable.id, racunId!), eq(racuniTable.offlineReceiptId, claimed!.id)));
    await tx.insert(offlineFursTransportEventsTable).values({
      attemptId: attemptId!, eventType: outcome.outcome === "unknown" ? "retry_scheduled" : "validation_error",
      detail: { error: outcome.napaka ?? null },
    });
  });
  if (outcome.outcome === "confirmed" && finalizationRequired) {
    await hooks.afterFursConfirmationPersisted?.();
    try {
      await db.transaction(async tx => {
        await hooks.beforeBusinessFinalization?.();
        const persisted = await tx.execute(sql`
          SELECT plan FROM pos_racun_finalization_plans
          WHERE racun_id = ${racunId!} FOR UPDATE
        `);
        const effectivePlan = persisted.rows[0]?.plan as FinalizationPlan | undefined;
        if (!effectivePlan) throw new FinalizationPlanConflict("Persisted effective finalization plan is missing.");
        await executeFinalizationPlan(tx, racunId!, claimed!.operationId, input.actor,
          effectivePlan);
        await tx.update(offlineFiscalReceiptsTable).set({
          finalizationNextAttemptAt: null, finalizationLastError: null,
        }).where(eq(offlineFiscalReceiptsTable.id, claimed!.id));
      });
    } catch (error) {
      await db.transaction(async tx => {
        await tx.update(offlineFiscalReceiptsTable).set({
          fursState: "confirmed", fursLastError: error instanceof Error ? error.message : "Business finalization failed.",
          finalizationAttemptCount: sql`${offlineFiscalReceiptsTable.finalizationAttemptCount} + 1`,
          finalizationNextAttemptAt: sql`now() + make_interval(secs => LEAST(3600, 15 * power(2, LEAST(${offlineFiscalReceiptsTable.finalizationAttemptCount} + 1, 8)))::integer)`,
          finalizationLastError: error instanceof Error ? error.message : "Business finalization failed.",
          claimToken: null, claimLeaseUntil: null, updatedAt: new Date(),
        }).where(eq(offlineFiscalReceiptsTable.id, claimed!.id));
      });
    }
  }
  const [persisted] = await db.select({ fursState: offlineFiscalReceiptsTable.fursState, eor: offlineFiscalReceiptsTable.eor })
    .from(offlineFiscalReceiptsTable).where(eq(offlineFiscalReceiptsTable.id, claimed.id)).limit(1);
  const resultState = persisted?.fursState === "needs_review" ? "needs_review" : stateForResult(outcome.outcome);
  return { receiptId: claimed.id, racunId, state: resultState, eor: persisted?.eor ?? (outcome.eor || null), replay: false };
}

function stateForResult(outcome: "confirmed" | "failed" | "unknown"): OfflineClaimResult["state"] {
  return outcome === "unknown" ? "unknown" : outcome;
}