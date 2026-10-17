import express from "express";
import supertest from "supertest";
import { createHash, createPrivateKey, createPublicKey, createSign, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  artikliTable, companiesTable, db, enoteTable, izmeneTable, narocilaTable,
  natakariTable, nastavitveTable, offlineAuthorityBundlesTable, offlineFiscalDevicesTable,
  offlineFiscalReceiptsTable, poslovniProstoriTable, postavkeTable,
} from "@workspace/db";
import * as furs from "../../lib/pos-furs";
import { sifrirajBizboxGeslo } from "../../lib/kripto-bizbox";
import {
  deterministicFinalizationUuid, finalizationPlanHash, type FinalizationPlan,
} from "../../services/pos/finalization-plan";
import { canonicalAuthorityJson } from "../../services/pos/offline-authority";
import { claimAndSubmitOfflineReceipt } from "../../services/pos/offline-fiscal-worker";
import { runOfflineFiscalOnce } from "../../services/pos/offline-fiscal-runner";
import { ingestOfflineReceipt } from "./offline-fiscal";

const workspace = path.resolve(import.meta.dirname, "../../../../..");
const contractDir = path.join(workspace, "fiscal-service/contract");
const golden = JSON.parse(readFileSync(path.join(contractDir, "golden-vectors-furs-v2.json"), "utf8"));
if (!String(golden.warning).includes("TEST ONLY") ||
    !String(golden.testAuthority.fixtureCertificatePath).startsWith("test-fixtures/") ||
    !String(golden.testAuthority.fixturePrivateKeyPath).startsWith("test-fixtures/")) {
  throw new Error("FURS v2 integration fixtures must remain declared test-only contract fixtures.");
}
const certPem = readFileSync(path.resolve(contractDir, golden.testAuthority.fixtureCertificatePath), "utf8");
const privateKeyPem = readFileSync(path.resolve(contractDir, golden.testAuthority.fixturePrivateKeyPath), "utf8");
const publicKeyPem = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "pem" }).toString();
const fingerprint = golden.testAuthority.certificateFingerprintSha256 as string;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
}

describe("offline fiscal furs-v2 durable DB pipeline", () => {
  const operationId = randomUUID();
  const localReceiptId = deterministicFinalizationUuid(operationId, "receipt");
  const authorityId = randomUUID();
  const deviceId = randomUUID();
  let companyId: string;
  let enotaId: number;
  let premiseId: number;
  let orderId: number;
  let lineId: number;
  let articleId: number;
  let shiftId: number;
  let core: furs.LegalInvoiceCore;
  let plan: FinalizationPlan;
  let receiptId: string;

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.post("/ingest", (req, res) => {
    Object.assign(req, { companyId, enotaId, clerkUserId: "furs-v2-integration" });
    void ingestOfflineReceipt(req, res);
  });

  beforeAll(async () => {
    await db.execute(sql`
      UPDATE offline_fiscal_receipts r
      SET production_enabled = false
      FROM enote e, companies c
      WHERE r.enota_id = e.id
        AND e.company_id = c.id
        AND c.naziv LIKE 'FURS v2 integration %'
    `);
    process.env.BIZBOX_ENC_KEY ??= "offline-furs-v2-integration-key-material";
    process.env.OFFLINE_FISCAL_PRODUCTION_ENABLED = "true";
    process.env.OFFLINE_AUTHORITY_KEY_ID = "integration-authority";
    process.env.OFFLINE_AUTHORITY_PUBLIC_KEY_PEM = publicKeyPem;

    const [company] = await db.insert(companiesTable).values({
      naziv: `FURS v2 integration ${operationId}`, podjetjeDavcna: `I${operationId.replace(/-/g, "").slice(0, 7)}`,
      fursCertifikatPem: certPem, fursKljucEnc: sifrirajBizboxGeslo(privateKeyPem),
    }).returning();
    companyId = company!.id;
    const [unit] = await db.insert(enoteTable).values({ companyId, ime: `FURS v2 ${operationId}` }).returning();
    enotaId = unit!.id;
    await db.insert(nastavitveTable).values({ enotaId, kljuc: "offlineFiscalEnabled", vrednost: "true" });
    const [premise] = await db.insert(poslovniProstoriTable).values({ enotaId, prostorId: "PP01" }).returning();
    premiseId = premise!.id;
    const [waiter] = await db.insert(natakariTable).values({
      companyId, ime: "Testni", priimek: "Operater", davcnaStevilka: "87654321",
    }).returning();
    const [shift] = await db.insert(izmeneTable).values({ enotaId, natakariId: waiter!.id }).returning();
    shiftId = shift!.id;
    const [article] = await db.insert(artikliTable).values({ enotaId, ime: "Kava v2", cena: "12.50", davek: "22.00" }).returning();
    articleId = article!.id;
    const [order] = await db.insert(narocilaTable).values({ enotaId, skupaj: "12.50" }).returning();
    orderId = order!.id;
    const [line] = await db.insert(postavkeTable).values({
      narociloId: orderId, artikelId: articleId, ime: "Kava v2", kolicina: 1, cenaKos: "12.50", skupaj: "12.50", davek: "22.00",
    }).returning();
    lineId = line!.id;
    const issuedAt = new Date();
    issuedAt.setMilliseconds(0);
    const template = structuredClone(golden.legalCore.finalizationPlan) as FinalizationPlan;
    plan = {
      ...template, sourceOperationId: operationId,
      receipt: {
        ...template.receipt, localReceiptId, companyId, enotaId, orderId, legalNumber: "PP01-B01-1",
        pp: "PP01", b: "B01", ppBSequence: 1, issuedAt: issuedAt.toISOString(),
      },
      soldLines: [{ ...template.soldLines[0]!, id: lineId, articleId, name: "Kava v2" }],
      normativeSnapshot: [{ articleId, quantity: -1 }],
      operator: { ...template.operator, waiterId: waiter!.id, shiftId, actor: "offline-device:integration" },
      closure: { ...template.closure, orderId, tableId: null },
      stockMovements: [{ ...template.stockMovements[0]!, articleId, quantity: -1, unitWac: 1, value: -1, effectiveAt: issuedAt.toISOString() }],
      kds: { effects: [{ kind: "complete", lineId }] },
      accounting: { companyId, businessDate: issuedAt.toISOString().slice(0, 10), syncAfterCommit: true },
      reservations: { issueReservationId: deterministicFinalizationUuid(operationId, "issue-reservation") },
      furs: {
        snapshotId: deterministicFinalizationUuid(operationId, "furs-snapshot"),
        requestHash: `sha256:${"0".repeat(64)}`, canonicalArtifactLink: `offline:${operationId}`,
      },
    };

    const now = new Date();
    const unsignedBundle = {
      ...structuredClone(golden.legalCore.authorityBundle),
      bundleId: authorityId,
      server: { companyId, enotaId },
      scope: { deviceId, premiseId, bIdentifier: "B01" },
      contract: { version: "furs-v2", goldenAttestationSha256: golden.legalCore.authorityBundle.contract.goldenAttestationSha256, authorityVersion: 1 },
      validity: { ...golden.legalCore.authorityBundle.validity, validFrom: new Date(now.getTime() - 60_000).toISOString(), validUntil: new Date(now.getTime() + 86_400_000).toISOString() },
      operator: { waiterId: waiter!.id, name: "Testni Operater", taxNumber: "87654321", shiftId },
      catalog: [{ ...golden.legalCore.authorityBundle.catalog[0], articleId }],
      authority: { keyId: "integration-authority", algorithm: "RSA-SHA256", publicKeyPem },
    } as Record<string, unknown>;
    delete unsignedBundle.bundleSha256;
    delete unsignedBundle.signatureBase64;
    const authorityCanonical = canonicalAuthorityJson(unsignedBundle);
    const bundleSha256 = createHash("sha256").update(authorityCanonical).digest("hex");
    const authoritySigner = createSign("RSA-SHA256"); authoritySigner.update(authorityCanonical); authoritySigner.end();
    const signatureBase64 = authoritySigner.sign(privateKeyPem).toString("base64");
    const authorityBundle = { ...unsignedBundle, bundleSha256, signatureBase64 };

    await db.insert(offlineFiscalDevicesTable).values({
      id: deviceId, enotaId, poslovniProstorId: premiseId, bIdentifier: "B01", platform: "android",
      publicKeyPem, keyFingerprintSha256: golden.testAuthority.publicKeyFingerprintSha256,
      expectedFursCertFingerprint: fingerprint, contractVersion: "furs-v2",
      goldenAttestationSha256: golden.legalCore.authorityBundle.contract.goldenAttestationSha256,
      productionEnabled: true, status: "active", activatedAt: now,
    });
    await db.insert(offlineAuthorityBundlesTable).values({
      id: authorityId, deviceId, enotaId, authorityVersion: 1, bundleSha256, payload: unsignedBundle,
      keyId: "integration-authority", signatureBase64, validFrom: new Date(now.getTime() - 60_000),
      validUntil: new Date(now.getTime() + 86_400_000),
    });
    core = furs.buildLegalCore({
      operationId, localReceiptId, authorityBundle, finalizationPlan: plan,
      finalizationPlanSha256: finalizationPlanHash(plan),
      data: {
        stevilkaRacuna: "PP01-B01-1", datumCas: issuedAt, skupaj: 12.5, ddv: 2.25,
        placilnaNacin: "gotovina", postavke: [{ ime: "Kava v2", kolicina: 1, cenaKos: 12.5, davek: 22, skupaj: 12.5 }],
        davcnaStevilka: "12345678", poslovnaProstor: "PP01", blagajnaId: "B01",
        operatorDavcna: "87654321", certPem, certKljuc: privateKeyPem,
      },
      deviceKeyFingerprintSha256: golden.testAuthority.publicKeyFingerprintSha256,
      devicePrivateKey: privateKeyPem,
    });
  });

  afterAll(async () => {
    await db.execute(sql`
      UPDATE offline_fiscal_receipts r
      SET production_enabled = false
      FROM enote e, companies c
      WHERE r.enota_id = e.id
        AND e.company_id = c.id
        AND c.naziv LIKE 'FURS v2 integration %'
    `);
    vi.restoreAllMocks();
  });

  it("ingests idempotently, retries with fresh XML, and finalizes effects exactly once", async () => {
    const firstIngest = await supertest(app).post("/ingest").send(core);
    expect(firstIngest.status, JSON.stringify(firstIngest.body)).toBe(201);
    receiptId = firstIngest.body.id;
    const replay = await supertest(app).post("/ingest").send(core);
    expect(replay.status).toBe(200);

    const changedPlan = { ...plan, operator: { ...plan.operator, actor: "offline-device:changed" } };
    const changedCore = furs.buildLegalCore({
      operationId, localReceiptId, authorityBundle: core.authorityBundle, finalizationPlan: changedPlan,
      finalizationPlanSha256: finalizationPlanHash(changedPlan),
      data: {
        stevilkaRacuna: "PP01-B01-1", datumCas: new Date(plan.receipt.issuedAt), skupaj: 12.5, ddv: 2.25,
        placilnaNacin: "gotovina", postavke: [{ ime: "Kava v2", kolicina: 1, cenaKos: 12.5, davek: 22, skupaj: 12.5 }],
        davcnaStevilka: "12345678", poslovnaProstor: "PP01", blagajnaId: "B01", operatorDavcna: "87654321",
        certPem, certKljuc: privateKeyPem,
      },
      deviceKeyFingerprintSha256: core.deviceKeyFingerprintSha256, devicePrivateKey: privateKeyPem,
    });
    expect((await supertest(app).post("/ingest").send(changedCore)).status).toBe(409);

    const transport = vi.spyOn(furs, "submitSignedFursInvoice")
      .mockResolvedValueOnce({
        outcome: "unknown", payloadHash: "", eor: "", zoi: core.legalInvoice.zoi, uspeh: false,
        napaka: "timeout", surovOdgovor: "{\"timeout\":true}", deliveryUnknown: true,
      })
      .mockResolvedValueOnce({
        outcome: "confirmed", payloadHash: "", eor: "EOR-V2-INTEGRATION", zoi: core.legalInvoice.zoi,
        uspeh: true, surovOdgovor: "<UniqueInvoiceID>EOR-V2-INTEGRATION</UniqueInvoiceID>",
      });

    const concurrent = await Promise.all([
      claimAndSubmitOfflineReceipt({ receiptId, enotaId, companyId, actor: "test-a", fursMode: "testno" }),
      claimAndSubmitOfflineReceipt({ receiptId, enotaId, companyId, actor: "test-b", fursMode: "testno" }),
    ]);
    expect(concurrent.filter(result => !result.replay)).toHaveLength(1);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM offline_furs_transport_attempts WHERE offline_receipt_id=${receiptId}`)).rows[0]!.n).toBe(1);
    expect((await db.select().from(offlineFiscalReceiptsTable).where(eq(offlineFiscalReceiptsTable.id, receiptId)))[0]!.fursState).toBe("pending");

    await db.execute(sql`UPDATE offline_furs_transport_attempts SET created_at=now()-interval '1 hour' WHERE offline_receipt_id=${receiptId}`);
    expect(await runOfflineFiscalOnce({ throwOnError: true, fursModeOverride: "testno" })).toBeGreaterThanOrEqual(1);

    const attempts = (await db.execute(sql`
      SELECT attempt_no, message_id, invoice_request_id, signed_xml_base64, signed_xml_sha256
      FROM offline_furs_transport_attempts WHERE offline_receipt_id=${receiptId} ORDER BY attempt_no
    `)).rows as Array<Record<string, string | number>>;
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts.map(row => row.attempt_no)).size).toBe(2);
    expect(new Set(attempts.map(row => row.message_id)).size).toBe(2);
    expect(new Set(attempts.map(row => row.invoice_request_id)).size).toBe(2);
    expect(new Set(attempts.map(row => row.signed_xml_sha256)).size).toBe(2);
    expect(attempts.every(row => Buffer.from(String(row.signed_xml_base64), "base64").toString().includes(`<fu:ProtectedID>${core.legalInvoice.zoi}</fu:ProtectedID>`))).toBe(true);

    const receipt = (await db.select().from(offlineFiscalReceiptsTable).where(eq(offlineFiscalReceiptsTable.id, receiptId)))[0]!;
    expect(receipt.fursState).toBe("confirmed");
    expect(receipt.eor).toBe("EOR-V2-INTEGRATION");
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM racuni WHERE offline_receipt_id=${receiptId}`)).rows[0]!.n).toBe(1);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM pos_racun_finalization_plans WHERE source_operation_id=${operationId}`)).rows[0]!.n).toBe(1);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM zaloga_gibi WHERE opomba='Golden Kava' AND artikel_id=${articleId}`)).rows[0]!.n).toBe(1);
    expect((await db.execute(sql`SELECT status FROM narocila WHERE id=${orderId}`)).rows[0]!.status).toBe("zakljuceno");
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM postavke WHERE id=${lineId} AND racun_id IS NOT NULL`)).rows[0]!.n).toBe(1);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.every(([, options]) => options.fursNacin === "testno")).toBe(true);
  });
});