/**
 * Native gateway UUID reconciliation integration coverage.
 *
 * This deliberately uses the real PostgreSQL connection, real ingest/runner
 * code and real finalization transactions. Only the certificate/FURS boundary
 * is replaced: the database claim UPDATE and all business effects are real.
 */
import { createHash, createPrivateKey, createPublicKey, createSign, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  artikliTable, companiesTable, db, enoteTable, izmeneTable, narocilaTable,
  nastavitveTable, natakariTable, offlineAuthorityBundlesTable, offlineFiscalDevicesTable, modSkupineTable,
  modifikatorjiTable, artModSkupineTable,
  offlineFiscalReceiptsTable, poslovniProstoriTable, postavkeTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import * as furs from "../../lib/pos-furs";
import { sifrirajBizboxGeslo } from "../../lib/kripto-bizbox";
import { assertValidFinalizationPlan, deterministicFinalizationUuid, finalizationPlanAuthority, finalizationPlanHash, type FinalizationPlan } from "../../services/pos/finalization-plan";
import { canonicalAuthorityJson } from "../../services/pos/offline-authority";
import { claimAndSubmitOfflineReceipt, resetOfflineFiscalWorkerHooks, setOfflineFiscalWorkerHooks } from "../../services/pos/offline-fiscal-worker";
import { runOfflineFiscalOnce } from "../../services/pos/offline-fiscal-runner";
import { OFFLINE_FISCAL_ENABLED_KEY } from "../../services/pos/offline-fiscal-policy";
import { ingestOfflineReceipt } from "./offline-fiscal";
import { assertOfflineFiscalIsolatedTestDatabase } from "./offlineFiscalIsolatedTestDb";
import express from "express";
import supertest from "supertest";

const root = path.resolve(import.meta.dirname, "../../../../..");
const golden = JSON.parse(readFileSync(path.join(root, "fiscal-service/contract/golden-vectors-furs-v2.json"), "utf8"));
const certPem = readFileSync(path.resolve(root, "fiscal-service/contract", golden.testAuthority.fixtureCertificatePath), "utf8");
const privateKeyPem = readFileSync(path.resolve(root, "fiscal-service/contract", golden.testAuthority.fixturePrivateKeyPath), "utf8");
const publicKeyPem = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "pem" }).toString();
const fingerprint = golden.testAuthority.certificateFingerprintSha256 as string;

describe("cloud-origin offline fiscal PostgreSQL reconciliation", () => {
  beforeAll(async () => {
    await assertOfflineFiscalIsolatedTestDatabase();
  });

  let scope: string;
  let companyId: string; let enotaId: number; let premiseId: number; let deviceId: string;
  let waiterId: number; let shiftId: number; let articleId: number; let modifierId: number; let alternateModifierId: number; let modifierArticleId: number; let operationId: string;
  let cloudOrderId: number; let parentLineId: number; let childLineId: number;
  let nativeRef: string;
  let receiptId: string; let transportCalls = 0;
  let plan: FinalizationPlan; let core: any;
  const app = express();
  app.use(express.json({ limit: "3mb" }));
  app.post("/ingest", (req, res) => {
    Object.assign(req, { companyId, enotaId, clerkUserId: "native-integration" });
    void ingestOfflineReceipt(req, res);
  });

  function canonical(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    return `{${Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }

  beforeEach(async () => {
    resetOfflineFiscalWorkerHooks();
    scope = randomUUID();
    transportCalls = 0;
    process.env.BIZBOX_ENC_KEY ??= "native-reconciliation-test-key";
    process.env.OFFLINE_FISCAL_PRODUCTION_ENABLED = "true";
    process.env.OFFLINE_AUTHORITY_KEY_ID = "native-integration";
    process.env.OFFLINE_AUTHORITY_PUBLIC_KEY_PEM = publicKeyPem;
    const [company] = await db.insert(companiesTable).values({
      naziv: `Native UUID integration ${scope}`, podjetjeDavcna: `N${scope.replace(/-/g, "").slice(0, 7)}`,
      fursCertifikatPem: certPem, fursKljucEnc: sifrirajBizboxGeslo(privateKeyPem),
    }).returning();
    companyId = company!.id;
    const [unit] = await db.insert(enoteTable).values({ companyId, ime: `Native ${scope}` }).returning(); enotaId = unit!.id;
    await db.insert(nastavitveTable).values({
      enotaId,
      kljuc: OFFLINE_FISCAL_ENABLED_KEY,
      vrednost: "true",
    });
    const [premise] = await db.insert(poslovniProstoriTable).values({ enotaId, prostorId: `N${scope.slice(0, 4)}` }).returning(); premiseId = premise!.id;
    const [waiter] = await db.insert(natakariTable).values({ companyId, ime: "Native", priimek: "Operator", davcnaStevilka: "87654321" }).returning(); waiterId = waiter!.id;
    const [shift] = await db.insert(izmeneTable).values({ enotaId, natakariId: waiterId }).returning(); shiftId = shift!.id;
    const [article] = await db.insert(artikliTable).values({ enotaId, ime: "Native article", cena: "10.00", davek: "22.00" }).returning(); articleId = article!.id;
    const [modifierArticle] = await db.insert(artikliTable).values({ enotaId, ime: "Priced modifier", cena: "2.00", davek: "22.00" }).returning(); modifierArticleId = modifierArticle!.id;
    const [modifierGroup] = await db.insert(modSkupineTable).values({ enotaId, ime: "Cloud modifiers", maxIzbir: 2 }).returning();
    const [modifier] = await db.insert(modifikatorjiTable).values({ skupinaId: modifierGroup!.id, ime: "Extra priced", cenaDodatek: "2.00" }).returning(); modifierId = modifier!.id;
    const [alternateModifier] = await db.insert(modifikatorjiTable).values({ skupinaId: modifierGroup!.id, ime: "Alternate priced", cenaDodatek: "2.00" }).returning(); alternateModifierId = alternateModifier!.id;
    await db.insert(artModSkupineTable).values({ artikelId: articleId, skupinaId: modifierGroup!.id });
    const [order] = await db.insert(narocilaTable).values({ enotaId, status: "odprto", skupaj: "12.00", opomba: `Cloud offline ${scope}` }).returning();
    cloudOrderId = order!.id;
    const [parent] = await db.insert(postavkeTable).values({ narociloId: cloudOrderId, artikelId: articleId, ime: "Cloud parent", kolicina: 1, cenaKos: "10.00", skupaj: "10.00", davek: "22.00" }).returning();
    parentLineId = parent!.id;
    const [child] = await db.insert(postavkeTable).values({ narociloId: cloudOrderId, artikelId: null, modifikatorId: modifierId, ime: "Cloud priced modifier", kolicina: 1, cenaKos: "2.00", skupaj: "2.00", davek: "22.00", parentPostavkaId: parentLineId }).returning();
    childLineId = child!.id;
    deviceId = randomUUID();
    const authorityId = randomUUID(); const now = new Date(); const deviceKey = privateKeyPem;
    const authorityPayload = {
      ...structuredClone(golden.legalCore.authorityBundle), bundleId: authorityId,
      server: { companyId, enotaId }, scope: { deviceId, premiseId, bIdentifier: "NB01" },
      validity: { ...golden.legalCore.authorityBundle.validity, validFrom: new Date(now.getTime() - 60_000).toISOString(), validUntil: new Date(now.getTime() + 86_400_000).toISOString() },
       catalog: [{ articleId, name: "Native article", unitGross: "10.00", vatRate: "22.00", articleKind: "sale", inputArticleId: null, normativeQuantity: null, unitWac: null }, { articleId: modifierArticleId, name: "Priced modifier", unitGross: "2.00", vatRate: "22.00", articleKind: "sale", inputArticleId: null, normativeQuantity: null, unitWac: null }],
       modifiers: [{ modifierId, name: "Extra priced", priceDelta: "2.00", groupId: modifierGroup!.id, vatRule: "inherit_parent", articleIds: [articleId], inputArticleId: null, normativeQuantity: null, unitWac: null }], operator: { waiterId, name: "Native Operator", taxNumber: "87654321", shiftId },
      authority: { keyId: "native-integration", algorithm: "RSA-SHA256", publicKeyPem },
    } as Record<string, any>;
    delete authorityPayload.bundleSha256; delete authorityPayload.signatureBase64;
    const bundleSha256 = createHash("sha256").update(canonicalAuthorityJson(authorityPayload)).digest("hex");
    const signer = createSign("RSA-SHA256"); signer.update(canonicalAuthorityJson(authorityPayload)); signer.end();
    const signatureBase64 = signer.sign(privateKeyPem).toString("base64");
    await db.insert(offlineFiscalDevicesTable).values({
      id: deviceId, enotaId, poslovniProstorId: premiseId, bIdentifier: "NB01", platform: "android",
      publicKeyPem, keyFingerprintSha256: golden.testAuthority.publicKeyFingerprintSha256,
      expectedFursCertFingerprint: fingerprint, contractVersion: "furs-v2",
      goldenAttestationSha256: authorityPayload.contract.goldenAttestationSha256,
      productionEnabled: true, status: "active", activatedAt: now,
    });
    await db.insert(offlineAuthorityBundlesTable).values({
      id: authorityId, deviceId, enotaId, authorityVersion: 1, bundleSha256, payload: authorityPayload,
      keyId: "native-integration", signatureBase64, validFrom: new Date(now.getTime() - 60_000), validUntil: new Date(now.getTime() + 86_400_000),
    });
    operationId = randomUUID();
    const localReceiptId = deterministicFinalizationUuid(operationId, "receipt");
    const issuedAt = new Date(); issuedAt.setMilliseconds(0);
    const template = structuredClone(golden.legalCore.finalizationPlan) as FinalizationPlan;
    nativeRef = randomUUID();
    const line = { ...template.soldLines[0]!, id: 0, sourceLineRef: `cloud:${nativeRef}:parent`, cloudLineId: null, articleId, modifierId: null, name: "Native article", quantity: 1, unitGross: 10, gross: 10, vatRate: 22, parentSourceLineRef: null };
    plan = {
      ...template, sourceOperationId: operationId, sourceAuthority: "CLOUD_OFFLINE",
      receipt: { ...template.receipt, localReceiptId, companyId, enotaId, orderId: cloudOrderId, cloudOrderId, sourceOrderRef: nativeRef, legalNumber: `NB01-${scope.slice(0, 4)}-1`, pp: `N${scope.slice(0, 4)}`, b: "NB01", ppBSequence: 1, issuedAt: issuedAt.toISOString() },
      soldLines: [
        { ...line, id: parentLineId, sourceLineRef: `cloud:${cloudOrderId}:${parentLineId}`, cloudLineId: parentLineId, name: "Cloud parent", unitGross: 10, gross: 10 },
        { ...line, id: childLineId, sourceLineRef: `cloud:${cloudOrderId}:${childLineId}`, cloudLineId: childLineId, parentSourceLineRef: `cloud:${cloudOrderId}:${parentLineId}`, articleId: null, modifierId, name: "Cloud priced modifier", unitGross: 2, gross: 2 },
      ],
      cloudBaseline: undefined,
      totals: { gross: 12, net: 9.84, vat: 2.16, vatGroups: [{ rate: 22, gross: 12, vat: 2.16 }] },
      payment: { ...template.payment, method: "gotovina", cash: 12, card: 0, nonCash: 0 },
      operator: { ...template.operator, waiterId, shiftId, actor: "offline-device:native" },
      closure: { ...template.closure, orderId: cloudOrderId, cloudOrderId, tableId: null },
      normativeSnapshot: [], stockMovements: [], kds: { effects: [] },
      accounting: { companyId, businessDate: issuedAt.toISOString().slice(0, 10), syncAfterCommit: true },
      reservations: { issueReservationId: deterministicFinalizationUuid(operationId, "issue-reservation") },
      furs: { snapshotId: deterministicFinalizationUuid(operationId, "furs-snapshot"), requestHash: `sha256:${"0".repeat(64)}`, canonicalArtifactLink: `offline:${operationId}` },
    };
    const authorityBundle = { ...authorityPayload, bundleSha256, signatureBase64 };
    assertValidFinalizationPlan(plan);
    core = furs.buildLegalCore({
      operationId, localReceiptId, authorityBundle, finalizationPlan: plan, finalizationPlanSha256: finalizationPlanHash(plan),
       data: { stevilkaRacuna: plan.receipt.legalNumber, datumCas: issuedAt, skupaj: 12, ddv: 2.16, placilnaNacin: "gotovina", postavke: [{ ime: "Cloud parent", kolicina: 1, cenaKos: 10, davek: 22, skupaj: 10 }, { ime: "Cloud priced modifier", kolicina: 1, cenaKos: 2, davek: 22, skupaj: 2 }], davcnaStevilka: "12345678", poslovnaProstor: plan.receipt.pp, blagajnaId: "NB01", operatorDavcna: "87654321", certPem, certKljuc: privateKeyPem },
      deviceKeyFingerprintSha256: golden.testAuthority.publicKeyFingerprintSha256, devicePrivateKey: deviceKey,
    });
    vi.spyOn(furs, "pridobiCompanyCert").mockResolvedValue({ certPem, certKljuc: privateKeyPem } as any);
    vi.spyOn(furs, "verifyZOI").mockReturnValue(true);
    vi.spyOn(furs, "submitSignedFursInvoice").mockImplementation(async () => {
      transportCalls += 1;
      return { outcome: "confirmed", eor: "EOR-NATIVE", surovOdgovor: "ok" } as any;
    });
    const response = await supertest(app).post("/ingest").send(core);
    if (response.status !== 201) throw new Error(JSON.stringify(response.body));
    expect(response.body.deliveryState).toBe("PENDING");
    receiptId = response.body.id;
  });

  afterEach(async () => {
    resetOfflineFiscalWorkerHooks();
    if (deviceId) await db.execute(sql`UPDATE offline_fiscal_devices SET production_enabled = false WHERE id = ${deviceId}`);
    vi.restoreAllMocks();
  });

  it("materializes and finalizes a native UUID receipt exactly once", async () => {
    expect(await runOfflineFiscalOnce({ throwOnError: true, fursModeOverride: "testno" })).toBeGreaterThan(0);
    const [receipt] = await db.select().from(offlineFiscalReceiptsTable).where(eq(offlineFiscalReceiptsTable.id, receiptId));
    expect(receipt?.fursState).toBe("confirmed");
    expect(receipt?.fursLastError).toBeNull();
    expect(receipt?.racunId).not.toBeNull();
    const [order] = await db.select().from(narocilaTable).where(sql`enota_id = ${enotaId} AND opomba = ${`Cloud offline ${scope}`}`);
    expect(order).toBeTruthy();
    const racun = await db.execute(sql`SELECT business_finalized_at, furs_state, status, narocilo_id FROM racuni WHERE id = ${receipt!.racunId}`);
    expect(racun.rows[0], JSON.stringify({ receipt: receipt?.fursLastError, racun: racun.rows[0]})).toBeTruthy();
    expect(racun.rows[0]?.business_finalized_at).not.toBeNull();
    expect(transportCalls).toBe(1);
    const counts = await db.execute(sql`
      SELECT (SELECT count(*) FROM narocila WHERE enota_id = ${enotaId} AND opomba = ${`Cloud offline ${scope}`}) AS orders,
             (SELECT count(*) FROM racuni WHERE id = ${receipt?.racunId}) AS invoices,
             (SELECT count(*) FROM postavke WHERE racun_id = ${receipt?.racunId}) AS lines,
             (SELECT count(*) FROM pos_racun_finalization_plans WHERE racun_id = ${receipt?.racunId}) AS plans,
             (SELECT count(*) FROM offline_furs_transport_attempts WHERE offline_receipt_id = ${receiptId}) AS attempts
    `);
    expect(counts.rows[0]).toEqual({ orders: "1", invoices: "1", lines: "2", plans: "1", attempts: "1" });
    const replay = await runOfflineFiscalOnce({ throwOnError: true, fursModeOverride: "testno" });
    expect(replay).toBe(0);
  });

  it("recovers confirmed receipt without certificate or second transport", async () => {
    let crashCount = 0;
    setOfflineFiscalWorkerHooks({ afterFursConfirmationPersisted: () => { crashCount += 1; throw new Error("simulated crash"); } });
    await expect(runOfflineFiscalOnce({
      throwOnError: true, fursModeOverride: "testno",
    })).rejects.toThrow("simulated crash");
    const [confirmed] = await db.select().from(offlineFiscalReceiptsTable).where(eq(offlineFiscalReceiptsTable.id, receiptId));
    expect(crashCount).toBe(1);
    expect(confirmed?.fursState).toBe("confirmed");
    expect(confirmed?.eor).toBe("EOR-NATIVE");
    expect(confirmed?.finalizationAttemptCount).toBe(0);
    expect(transportCalls).toBe(1);
    const transport = await db.execute(sql`SELECT count(*)::int AS count FROM offline_furs_transport_attempts WHERE offline_receipt_id = ${receiptId}`);
    expect(Number(transport.rows[0]?.count)).toBe(1);
    const before = await db.execute(sql`SELECT business_finalized_at FROM racuni WHERE id = ${confirmed?.racunId}`);
    expect(before.rows[0]?.business_finalized_at).toBeNull();
    resetOfflineFiscalWorkerHooks();
    vi.clearAllMocks();
    vi.spyOn(furs, "pridobiCompanyCert").mockRejectedValue(new Error("certificate must not be requested"));
    const selected = await runOfflineFiscalOnce({ throwOnError: true, fursModeOverride: "testno" });
    expect(selected).toBe(1);
    expect(transportCalls).toBe(1);
    expect(furs.pridobiCompanyCert).not.toHaveBeenCalled();
    const after = await db.execute(sql`SELECT business_finalized_at FROM racuni WHERE id = ${confirmed?.racunId}`);
    expect(after.rows[0]?.business_finalized_at).not.toBeNull();
  });
  it("serializes concurrent native claims", async () => {
    const results = await Promise.allSettled([
      runOfflineFiscalOnce({ throwOnError: true, fursModeOverride: "testno" }),
      runOfflineFiscalOnce({ throwOnError: true, fursModeOverride: "testno" }),
    ]);
    expect(results.filter(result => result.status === "fulfilled").length).toBeGreaterThan(0);
    expect(transportCalls).toBe(1);
    const [receipt] = await db.select().from(offlineFiscalReceiptsTable).where(eq(offlineFiscalReceiptsTable.id, receiptId));
    const order = await db.execute(sql`SELECT id, status FROM narocila WHERE enota_id = ${enotaId} AND opomba = ${`Cloud offline ${scope}`}`);
    const racun = await db.execute(sql`SELECT id, business_finalized_at FROM racuni WHERE id = ${receipt?.racunId}`);
    const lines = await db.execute(sql`SELECT count(*)::int AS count FROM postavke WHERE racun_id = ${receipt?.racunId}`);
    expect(order.rows).toHaveLength(1);
    expect(racun.rows).toHaveLength(1);
    expect(Number(lines.rows[0]?.count)).toBe(2);
    expect(order.rows[0]?.status).toBe("zakljuceno");
    expect(racun.rows[0]?.business_finalized_at).not.toBeNull();
  });
  it("backs off finalization failure while preserving confirmation", async () => {
    let failures = 0;
    setOfflineFiscalWorkerHooks({ beforeBusinessFinalization: () => { failures += 1; throw new Error("transient finalization"); } });
    const selected = await runOfflineFiscalOnce({
      throwOnError: true, fursModeOverride: "testno",
    });
    expect(selected).toBe(1);
    const [row] = await db.select().from(offlineFiscalReceiptsTable).where(eq(offlineFiscalReceiptsTable.id, receiptId));
    expect(failures).toBe(1);
    expect(row?.fursState).toBe("confirmed"); expect(row?.eor).toBe("EOR-NATIVE");
    expect(row?.finalizationAttemptCount).toBe(1);
    expect(row?.finalizationNextAttemptAt && row.finalizationNextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(transportCalls).toBe(1);
    resetOfflineFiscalWorkerHooks();
    const transport = await db.execute(sql`SELECT count(*)::int AS count FROM offline_furs_transport_attempts WHERE offline_receipt_id = ${receiptId}`);
    expect(Number(transport.rows[0]?.count)).toBe(1);
    const immediate = await runOfflineFiscalOnce({ fursModeOverride: "testno" });
    expect(immediate).toBe(0);
    await db.execute(sql`UPDATE offline_fiscal_receipts SET finalization_next_attempt_at = now() - interval '1 second' WHERE id = ${receiptId}`);
    const recovered = await runOfflineFiscalOnce({ throwOnError: true, fursModeOverride: "testno" });
    expect(recovered).toBe(1);
    expect(transportCalls).toBe(1);
    const finalized = await db.execute(sql`SELECT business_finalized_at FROM racuni WHERE id = ${row?.racunId}`);
    expect(finalized.rows[0]?.business_finalized_at).not.toBeNull();
  });
  it("does not select finalized confirmed rows", async () => {
    expect(await runOfflineFiscalOnce({ throwOnError: true, fursModeOverride: "testno" })).toBe(1);
    const before = await db.execute(sql`
      SELECT (SELECT count(*) FROM narocila WHERE enota_id = ${enotaId}) AS orders,
             (SELECT count(*) FROM racuni WHERE enota_id = ${enotaId}) AS invoices,
             (SELECT count(*) FROM postavke WHERE racun_id = (SELECT racun_id FROM offline_fiscal_receipts WHERE id = ${receiptId})) AS lines
    `);
    expect(await runOfflineFiscalOnce({ throwOnError: true, fursModeOverride: "testno" })).toBe(0);
    const after = await db.execute(sql`
      SELECT (SELECT count(*) FROM narocila WHERE enota_id = ${enotaId}) AS orders,
             (SELECT count(*) FROM racuni WHERE enota_id = ${enotaId}) AS invoices,
             (SELECT count(*) FROM postavke WHERE racun_id = (SELECT racun_id FROM offline_fiscal_receipts WHERE id = ${receiptId})) AS lines
    `);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
  it("quarantines a DB modifier identity mutation before transport", async () => {
    await db.execute(sql`UPDATE postavke SET modifikator_id = ${alternateModifierId}, artikel_id = NULL WHERE id = ${childLineId}`);
    expect(await runOfflineFiscalOnce({ fursModeOverride: "testno" })).toBe(1);
    expect(transportCalls).toBe(0);
    const [receipt] = await db.select().from(offlineFiscalReceiptsTable).where(eq(offlineFiscalReceiptsTable.id, receiptId));
    expect(receipt?.fursState).toBe("quarantined");
    expect((await db.execute(sql`SELECT business_finalized_at FROM racuni WHERE id = ${receipt?.racunId}`)).rows[0]?.business_finalized_at ?? null).toBeNull();
  });
  it("quarantines a DB parent reparent/orphan mutation before transport", async () => {
    await db.execute(sql`UPDATE postavke SET parent_postavka_id = NULL WHERE id = ${childLineId}`);
    expect(await runOfflineFiscalOnce({ fursModeOverride: "testno" })).toBe(1);
    expect(transportCalls).toBe(0);
    const [receipt] = await db.select().from(offlineFiscalReceiptsTable).where(eq(offlineFiscalReceiptsTable.id, receiptId));
    expect(receipt?.fursState).toBe("quarantined");
    expect((await db.execute(sql`SELECT business_finalized_at FROM racuni WHERE id = ${receipt?.racunId}`)).rows[0]?.business_finalized_at ?? null).toBeNull();
  });
  it.each(["ime", "course_number", "course_sequence", "course_name_snapshot", "pairing_group_id"])(
    "quarantines CLOUD_OFFLINE signed-fact mutation of %s before transport", async (field) => {
      if (field === "ime") await db.execute(sql`UPDATE postavke SET ime = 'Tampered name' WHERE id = ${parentLineId}`);
      if (field === "course_number") await db.execute(sql`UPDATE postavke SET course_number = 7 WHERE id = ${parentLineId}`);
      if (field === "course_sequence") await db.execute(sql`UPDATE postavke SET course_sequence = 8 WHERE id = ${parentLineId}`);
      if (field === "course_name_snapshot") await db.execute(sql`UPDATE postavke SET course_name_snapshot = 'Tampered course' WHERE id = ${parentLineId}`);
      if (field === "pairing_group_id") await db.execute(sql`UPDATE postavke SET pairing_group_id = 'tampered-pair' WHERE id = ${parentLineId}`);
      expect(await runOfflineFiscalOnce({ fursModeOverride: "testno" })).toBe(1);
      expect(transportCalls).toBe(0);
      const [receipt] = await db.select().from(offlineFiscalReceiptsTable).where(eq(offlineFiscalReceiptsTable.id, receiptId));
      expect(receipt?.fursState).toBe("quarantined");
      const state = await db.execute(sql`
        SELECT r.business_finalized_at, o.status, count(p.id)::int AS reserved
        FROM narocila o
        LEFT JOIN racuni r ON r.offline_receipt_id = ${receiptId}
        LEFT JOIN postavke p ON p.racun_id = r.id
        WHERE o.id = ${cloudOrderId}
        GROUP BY r.business_finalized_at, o.status
      `);
      expect(state.rows[0]?.business_finalized_at ?? null).toBeNull();
      expect(state.rows[0]?.status).toBe("odprto");
      expect(Number(state.rows[0]?.reserved ?? 0)).toBe(0);
    },
  );
  it("rejects a signed invalid sourceAuthority before persistence or worker claim", async () => {
    const invalidOperationId = randomUUID();
    const invalidPlan = {
      ...plan,
      sourceOperationId: invalidOperationId,
      sourceAuthority: "OTHER",
      receipt: {
        ...plan.receipt,
        localReceiptId: deterministicFinalizationUuid(invalidOperationId, "receipt"),
        legalNumber: `NB01-${scope.slice(0, 4)}-3`,
        ppBSequence: 3,
      },
      furs: {
        ...plan.furs,
        snapshotId: deterministicFinalizationUuid(invalidOperationId, "furs-snapshot"),
        canonicalArtifactLink: `offline:${invalidOperationId}`,
      },
      reservations: { issueReservationId: deterministicFinalizationUuid(invalidOperationId, "issue-reservation") },
    } as unknown as FinalizationPlan;
    const invalidCore = furs.buildLegalCore({
      operationId: invalidOperationId, localReceiptId: invalidPlan.receipt.localReceiptId,
      authorityBundle: core.authorityBundle, finalizationPlan: invalidPlan,
      finalizationPlanSha256: finalizationPlanHash(invalidPlan),
      data: {
        stevilkaRacuna: invalidPlan.receipt.legalNumber, datumCas: new Date(invalidPlan.receipt.issuedAt),
        skupaj: 12, ddv: 2.16, placilnaNacin: "gotovina",
        postavke: [{ ime: "Cloud parent", kolicina: 1, cenaKos: 10, davek: 22, skupaj: 10 }, { ime: "Cloud priced modifier", kolicina: 1, cenaKos: 2, davek: 22, skupaj: 2 }],
        davcnaStevilka: "12345678", poslovnaProstor: invalidPlan.receipt.pp, blagajnaId: "NB01",
        operatorDavcna: "87654321", certPem, certKljuc: privateKeyPem,
      },
      deviceKeyFingerprintSha256: golden.testAuthority.publicKeyFingerprintSha256, devicePrivateKey: privateKeyPem,
    });
    const response = await supertest(app).post("/ingest").send(invalidCore);
    expect(response.status).toBe(422);
    await db.execute(sql`UPDATE offline_fiscal_receipts SET production_enabled = false WHERE id = ${receiptId}`);
    expect(await runOfflineFiscalOnce({ fursModeOverride: "testno" })).toBe(0);
    expect(transportCalls).toBe(0);
    expect((await db.execute(sql`SELECT count(*)::int AS count FROM offline_furs_transport_attempts WHERE offline_receipt_id = ${receiptId}`)).rows[0]?.count).toBe(0);
  });
  it("rejects a mismatched canonical parent reference before FURS", async () => {
    const malformed = {
      ...plan,
      soldLines: plan.soldLines.map((line, index) => index === 1
        ? { ...line, parentSourceLineRef: `cloud:${cloudOrderId}:999999` } : line),
    };
    expect(() => assertValidFinalizationPlan(malformed)).toThrow(/parentSourceLineRef/);
    expect(transportCalls).toBe(0);
  });
  it("infers legacy numeric cloud plans as CLOUD_OFFLINE", async () => {
    const legacyOperationId = randomUUID();
    const legacyPlan: FinalizationPlan = {
      ...plan,
      sourceOperationId: legacyOperationId,
      receipt: {
        ...plan.receipt,
        localReceiptId: deterministicFinalizationUuid(legacyOperationId, "receipt"),
        legalNumber: `NB01-${scope.slice(0, 4)}-2`,
        ppBSequence: 2,
      },
      furs: {
        ...plan.furs,
        snapshotId: deterministicFinalizationUuid(legacyOperationId, "furs-snapshot"),
        canonicalArtifactLink: `offline:${legacyOperationId}`,
      },
      reservations: { issueReservationId: deterministicFinalizationUuid(legacyOperationId, "issue-reservation") },
    };
    delete (legacyPlan as { sourceAuthority?: unknown }).sourceAuthority;
    const legacyCore = furs.buildLegalCore({
      operationId: legacyOperationId, localReceiptId: legacyPlan.receipt.localReceiptId,
      authorityBundle: core.authorityBundle, finalizationPlan: legacyPlan,
      finalizationPlanSha256: finalizationPlanHash(legacyPlan),
      data: {
        stevilkaRacuna: legacyPlan.receipt.legalNumber, datumCas: new Date(legacyPlan.receipt.issuedAt),
        skupaj: 12, ddv: 2.16, placilnaNacin: "gotovina",
        postavke: [{ ime: "Cloud parent", kolicina: 1, cenaKos: 10, davek: 22, skupaj: 10 }, { ime: "Cloud priced modifier", kolicina: 1, cenaKos: 2, davek: 22, skupaj: 2 }],
        davcnaStevilka: "12345678", poslovnaProstor: legacyPlan.receipt.pp, blagajnaId: "NB01",
        operatorDavcna: "87654321", certPem, certKljuc: privateKeyPem,
      },
      deviceKeyFingerprintSha256: golden.testAuthority.publicKeyFingerprintSha256, devicePrivateKey: privateKeyPem,
    });
    expect(finalizationPlanAuthority(legacyPlan)).toBe("CLOUD_OFFLINE");
    expect(legacyCore.finalizationPlanSha256).toBe(finalizationPlanHash(legacyPlan));
  });
});