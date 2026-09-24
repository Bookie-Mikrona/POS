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
  nastavitveTable, natakariTable, offlineAuthorityBundlesTable, offlineFiscalDevicesTable,
  offlineFiscalReceiptsTable, poslovniProstoriTable, postavkeTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import * as furs from "../../lib/pos-furs";
import { sifrirajBizboxGeslo } from "../../lib/kripto-bizbox";
import { assertValidFinalizationPlan, deterministicFinalizationUuid, finalizationPlanHash, type FinalizationPlan } from "../../services/pos/finalization-plan";
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

describe("native UUID offline fiscal PostgreSQL reconciliation", () => {
  beforeAll(async () => {
    await assertOfflineFiscalIsolatedTestDatabase();
  });

  let scope: string;
  let companyId: string; let enotaId: number; let premiseId: number; let deviceId: string;
  let waiterId: number; let shiftId: number; let articleId: number; let operationId: string;
  let nativeRef: string;
  let receiptId: string; let transportCalls = 0;
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
    deviceId = randomUUID();
    const authorityId = randomUUID(); const now = new Date(); const deviceKey = privateKeyPem;
    const authorityPayload = {
      ...structuredClone(golden.legalCore.authorityBundle), bundleId: authorityId,
      server: { companyId, enotaId }, scope: { deviceId, premiseId, bIdentifier: "NB01" },
      validity: { ...golden.legalCore.authorityBundle.validity, validFrom: new Date(now.getTime() - 60_000).toISOString(), validUntil: new Date(now.getTime() + 86_400_000).toISOString() },
      catalog: [{ articleId, name: "Native article", unitGross: "10.00", vatRate: "22.00", articleKind: "sale", inputArticleId: null, normativeQuantity: null, unitWac: null }],
      modifiers: [], operator: { waiterId, name: "Native Operator", taxNumber: "87654321", shiftId },
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
    const plan: FinalizationPlan = {
      ...template, sourceOperationId: operationId,
      sourceAuthority: "GATEWAY",
      receipt: { ...template.receipt, localReceiptId, companyId, enotaId, orderId: null, cloudOrderId: null, sourceOrderRef: nativeRef, legalNumber: `NB01-${scope.slice(0, 4)}-1`, pp: `N${scope.slice(0, 4)}`, b: "NB01", ppBSequence: 1, issuedAt: issuedAt.toISOString() },
      soldLines: [line], cloudBaseline: [],
      totals: { gross: 10, net: 8.2, vat: 1.8, vatGroups: [{ rate: 22, gross: 10, vat: 1.8 }] },
      payment: { ...template.payment, method: "gotovina", cash: 10, card: 0, nonCash: 0 },
      operator: { ...template.operator, waiterId, shiftId, actor: "offline-device:native" },
      closure: { ...template.closure, orderId: null, cloudOrderId: null, tableId: null },
      normativeSnapshot: [], stockMovements: [], kds: { effects: [] },
      accounting: { companyId, businessDate: issuedAt.toISOString().slice(0, 10), syncAfterCommit: true },
      reservations: { issueReservationId: deterministicFinalizationUuid(operationId, "issue-reservation") },
      furs: { snapshotId: deterministicFinalizationUuid(operationId, "furs-snapshot"), requestHash: `sha256:${"0".repeat(64)}`, canonicalArtifactLink: `offline:${operationId}` },
    };
    const authorityBundle = { ...authorityPayload, bundleSha256, signatureBase64 };
    assertValidFinalizationPlan(plan);
    const core = furs.buildLegalCore({
      operationId, localReceiptId, authorityBundle, finalizationPlan: plan, finalizationPlanSha256: finalizationPlanHash(plan),
      data: { stevilkaRacuna: plan.receipt.legalNumber, datumCas: issuedAt, skupaj: 10, ddv: 1.8, placilnaNacin: "gotovina", postavke: [{ ime: "Native article", kolicina: 1, cenaKos: 10, davek: 22, skupaj: 10 }], davcnaStevilka: "12345678", poslovnaProstor: plan.receipt.pp, blagajnaId: "NB01", operatorDavcna: "87654321", certPem, certKljuc: privateKeyPem },
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
    await db.execute(sql`UPDATE offline_fiscal_devices SET production_enabled = false WHERE id = ${deviceId}`);
    vi.restoreAllMocks();
  });

  it("materializes and finalizes a native UUID receipt exactly once", async () => {
    expect(await runOfflineFiscalOnce({ throwOnError: true, fursModeOverride: "testno" })).toBeGreaterThan(0);
    const [receipt] = await db.select().from(offlineFiscalReceiptsTable).where(eq(offlineFiscalReceiptsTable.id, receiptId));
    expect(receipt?.fursState).toBe("confirmed");
    expect(receipt?.fursLastError).toBeNull();
    expect(receipt?.racunId).not.toBeNull();
    const [order] = await db.select().from(narocilaTable).where(sql`enota_id = ${enotaId} AND opomba = ${`Gateway native order ${nativeRef}`}`);
    expect(order).toBeTruthy();
    const racun = await db.execute(sql`SELECT business_finalized_at, furs_state, status, narocilo_id FROM racuni WHERE id = ${receipt!.racunId}`);
    expect(racun.rows[0], JSON.stringify({ receipt: receipt?.fursLastError, racun: racun.rows[0]})).toBeTruthy();
    expect(racun.rows[0]?.business_finalized_at).not.toBeNull();
    expect(transportCalls).toBe(1);
    const counts = await db.execute(sql`
      SELECT (SELECT count(*) FROM narocila WHERE enota_id = ${enotaId} AND opomba = ${`Gateway native order ${nativeRef}`}) AS orders,
             (SELECT count(*) FROM racuni WHERE id = ${receipt?.racunId}) AS invoices,
             (SELECT count(*) FROM postavke WHERE racun_id = ${receipt?.racunId}) AS lines,
             (SELECT count(*) FROM pos_racun_finalization_plans WHERE racun_id = ${receipt?.racunId}) AS plans,
             (SELECT count(*) FROM offline_furs_transport_attempts WHERE offline_receipt_id = ${receiptId}) AS attempts
    `);
    expect(counts.rows[0]).toEqual({ orders: "1", invoices: "1", lines: "1", plans: "1", attempts: "1" });
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
    const order = await db.execute(sql`SELECT id, status FROM narocila WHERE enota_id = ${enotaId} AND opomba = ${`Gateway native order ${nativeRef}`}`);
    const racun = await db.execute(sql`SELECT id, business_finalized_at FROM racuni WHERE id = ${receipt?.racunId}`);
    const lines = await db.execute(sql`SELECT count(*)::int AS count FROM postavke WHERE racun_id = ${receipt?.racunId}`);
    expect(order.rows).toHaveLength(1);
    expect(racun.rows).toHaveLength(1);
    expect(Number(lines.rows[0]?.count)).toBe(1);
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
});