import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db, offlineFiscalDevicesTable, offlineFiscalReceiptAttemptsTable,
  offlineFiscalReceiptsTable, poslovniProstoriTable, narocilaTable, natakariTable, izmeneTable,
  racuniTable,
  offlineAuthorityBundlesTable,
  offlineProvisioningChallengesTable,
  offlineProvisioningBundlesTable,
} from "@workspace/db";
import { createHash, createVerify, randomBytes, randomUUID, X509Certificate } from "node:crypto";
import { SignedXml } from "xml-crypto";
import { requirePosAdminRole, type PosRequest } from "../../middlewares/pos";
import { pridobiCompanyCert, verifyZOI, type LegalInvoiceCore } from "../../lib/pos-furs";
import {
  assertValidFinalizationPlan, deterministicFursMessageId, deterministicInvoiceRequestId,
  finalizationPlanAuthority, finalizationPlanHash, type FinalizationPlan,
} from "../../services/pos/finalization-plan";
import { claimAndSubmitOfflineReceipt } from "../../services/pos/offline-fiscal-worker";
import { readAll, toResponse } from "./nastavitve";
import { canonicalAuthorityJson, issueOfflineAuthorityBundle } from "../../services/pos/offline-authority";
import { createProvisioningBundle, deviceRegistrationProofInput, normalizeDevicePublicKey } from "../../services/pos/offline-provisioning";

const router: IRouter = Router();

const roundLegal = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function verifyCanonicalVat(plan: FinalizationPlan, authorityPayload: any, companyId: string, enotaId: number): void {
  if (authorityPayload?.schema !== "bookie-offline-authority-v1" ||
      authorityPayload.server?.companyId !== companyId ||
      Number(authorityPayload.server?.enotaId) !== enotaId ||
      authorityPayload.contract?.version !== "furs-v2" ||
      !Array.isArray(authorityPayload.catalog) || !Array.isArray(authorityPayload.modifiers)) {
    throw new Error("Podpisan authority snapshot nima zahtevanih zgodovinskih dejstev.");
  }
  const catalog = new Map<number, any>(authorityPayload.catalog.map((fact: any) => [Number(fact.articleId), fact]));
  const modifiers = new Map<number, any>(authorityPayload.modifiers.map((fact: any) => [Number(fact.modifierId), fact]));
  const bySource = new Map(plan.soldLines.map(line => [line.sourceLineRef ?? String(line.id), line]));
  const groups = new Map<number, { gross: number; vat: number }>();
  for (const line of plan.soldLines) {
    let expectedRate: number;
    if (line.modifierId != null) {
      const modifier = modifiers.get(Number(line.modifierId));
      if (!modifier || !line.parentSourceLineRef) throw new Error("Neveljaven ali osirotel podpisan modifikator.");
      const parent = bySource.get(line.parentSourceLineRef);
      if (!parent) throw new Error("Nadrejena postavka modifikatorja manjka.");
      const article = catalog.get(Number(parent.articleId));
      if (!article) throw new Error("Nadrejeni artikel modifikatorja ni veljaven.");
      if (modifier.vatRule !== "inherit_parent" && modifier.vatRule !== "own") {
        throw new Error("Podpisan modifier vatRule manjka.");
      }
      if (!Array.isArray(modifier.articleIds) || !modifier.articleIds.includes(Number(parent.articleId))) {
        throw new Error("Modifikator nima podpisane veljavne uporabe za nadrejeni artikel.");
      }
      expectedRate = modifier.vatRule === "inherit_parent"
        ? Number(article.vatRate) : Number(modifier.vatRate);
      if (!Number.isFinite(expectedRate)) throw new Error("Podpisan modifier nima veljavne DDV stopnje.");
      if (Math.abs(Number(modifier.priceDelta) - line.unitGross) > 0.01) {
        throw new Error("Cena modifikatorja se ne ujema z avtoritativno ceno.");
      }
    } else {
      const article = line.articleId == null ? undefined : catalog.get(Number(line.articleId));
      if (!article) throw new Error("Artikel ni veljaven za izbrano enoto.");
      expectedRate = Number(article.vatRate);
      if (Math.abs(Number(article.unitGross) - line.unitGross) > 0.01) {
        throw new Error("Cena artikla se ne ujema z avtoritativno ceno.");
      }
    }
    if (!Number.isFinite(line.quantity) || line.quantity <= 0 ||
        !Number.isFinite(line.unitGross) || !Number.isFinite(line.gross) ||
        roundLegal(line.gross) !== roundLegal(line.quantity * line.unitGross)) {
      throw new Error("Bruto postavke se ne ujema s podpisano količino in ceno.");
    }
    if (Math.abs(expectedRate - line.vatRate) > 0.001) throw new Error("DDV postavke se ne ujema z avtoritativnim DDV.");
    const net = roundLegal(line.vatRate > 0 ? line.gross / (1 + line.vatRate / 100) : line.gross);
    const vat = roundLegal(line.gross - net);
    const group = groups.get(line.vatRate) ?? { gross: 0, vat: 0 };
    group.gross += line.gross; group.vat += vat; groups.set(line.vatRate, group);
  }
  const gross = roundLegal(plan.soldLines.reduce((sum, line) => sum + line.gross, 0));
  const vat = roundLegal([...groups.values()].reduce((sum, group) => sum + group.vat, 0));
  if (Math.abs(plan.totals.gross - gross) > 0.01 || Math.abs(plan.totals.vat - vat) > 0.01 ||
      Math.abs(plan.totals.net - roundLegal(gross - vat)) > 0.01) {
    throw new Error("Davčni seštevki niso izračunani iz kanoničnih postavk.");
  }
  if (plan.totals.vatGroups.length !== groups.size) {
    throw new Error("Davčne skupine niso popolne.");
  }
  for (const expected of plan.totals.vatGroups) {
    const group = groups.get(expected.rate);
    if (!group || Math.abs(expected.gross - roundLegal(group.gross)) > 0.01 ||
        Math.abs(expected.vat - roundLegal(group.vat)) > 0.01) {
      throw new Error("Davčna skupina se ne ujema s kanoničnimi postavkami.");
    }
  }
}

router.post("/offline-fiscal/provisioning/challenges", requirePosAdminRole, async (req, res) => {
  const context = req as PosRequest;
  const poslovniProstorId = Number(req.body?.poslovniProstorId);
  const [premise] = await db.select({ id: poslovniProstoriTable.id }).from(poslovniProstoriTable).where(and(
    eq(poslovniProstoriTable.id, poslovniProstorId), eq(poslovniProstoriTable.enotaId, context.enotaId),
  )).limit(1);
  if (!premise) { res.status(403).json({ error: "Poslovni prostor ne pripada aktivni enoti." }); return; }
  const row = {
    id: randomUUID(), enotaId: context.enotaId, poslovniProstorId,
    challenge: randomBytes(32).toString("base64url"), expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  };
  await db.insert(offlineProvisioningChallengesTable).values(row);
  res.status(201).json({ challengeId: row.id, challenge: row.challenge, expiresAt: row.expiresAt });
});

router.post("/offline-fiscal/provisioning/register", requirePosAdminRole, async (req, res) => {
  const context = req as PosRequest; const body = req.body as Record<string, any>;
  const [challenge] = await db.select().from(offlineProvisioningChallengesTable).where(and(
    eq(offlineProvisioningChallengesTable.id, String(body.challengeId)),
    eq(offlineProvisioningChallengesTable.enotaId, context.enotaId),
  )).limit(1);
  if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()) {
    res.status(409).json({ error: "Provisioning challenge je potekel ali že uporabljen." }); return;
  }
  let publicKeyPem: string, fingerprint: string;
  try {
    const normalized = normalizeDevicePublicKey(String(body.publicKeyPem ?? ""));
    publicKeyPem = normalized.publicKeyPem; fingerprint = normalized.fingerprintSha256;
  } catch {
    res.status(400).json({ error: "Zahtevan je veljaven SPKI javni ključ." }); return;
  }
  const proofInput = deviceRegistrationProofInput(challenge.id, challenge.challenge, fingerprint);
  try {
    const verifier = createVerify("RSA-SHA256"); verifier.update(proofInput); verifier.end();
    if (!verifier.verify(publicKeyPem, Buffer.from(String(body.proofSignatureBase64 ?? ""), "base64"))) throw new Error();
  } catch { res.status(403).json({ error: "Dokaz posedovanja zasebnega ključa ni veljaven." }); return; }
  const bIdentifier = String(body.bIdentifier ?? "").trim();
  const expectedFingerprint = String(body.expectedFursCertFingerprint ?? "");
  const attestation = String(body.goldenAttestationSha256 ?? "");
  if (!bIdentifier || !["android", "windows"].includes(body.platform) ||
      !/^sha256:[a-f0-9]{64}$/.test(expectedFingerprint) || !/^[a-f0-9]{64}$/.test(attestation)) {
    res.status(400).json({ error: "Neveljavi provisioning parametri." }); return;
  }
  const companyCert = await pridobiCompanyCert(context.companyId);
  const configuredAttestation = process.env.OFFLINE_FISCAL_GOLDEN_ATTESTATION_SHA256;
  if (!companyCert?.certPem ||
      `sha256:${new X509Certificate(companyCert.certPem).fingerprint256.replace(/:/g, "").toLowerCase()}` !== expectedFingerprint ||
      !configuredAttestation || attestation !== configuredAttestation) {
    res.status(409).json({ error: "FURS certifikat ali golden attestation se ne ujema s konfiguracijo strežnika." }); return;
  }
  const [premise] = await db.select({ oznaka: poslovniProstoriTable.prostorId }).from(poslovniProstoriTable)
    .where(eq(poslovniProstoriTable.id, challenge.poslovniProstorId)).limit(1);
  const deviceId = randomUUID();
  try {
    let bundle: Awaited<ReturnType<typeof createProvisioningBundle>> | undefined;
    await db.transaction(async tx => {
      const consumed = await tx.update(offlineProvisioningChallengesTable).set({ consumedAt: new Date() }).where(and(
        eq(offlineProvisioningChallengesTable.id, challenge.id), isNull(offlineProvisioningChallengesTable.consumedAt),
      )).returning({ id: offlineProvisioningChallengesTable.id });
      if (!consumed[0]) throw Object.assign(new Error("Challenge je že uporabljen."), { status: 409 });
      await tx.insert(offlineFiscalDevicesTable).values({
        id: deviceId, enotaId: context.enotaId, poslovniProstorId: challenge.poslovniProstorId,
        bIdentifier, platform: body.platform, publicKeyPem, keyFingerprintSha256: fingerprint,
        expectedFursCertFingerprint: expectedFingerprint, contractVersion: "furs-v2",
        goldenAttestationSha256: attestation, status: "active",
        productionEnabled: process.env.OFFLINE_FISCAL_PRODUCTION_ENABLED === "true" &&
          attestation === process.env.OFFLINE_FISCAL_GOLDEN_ATTESTATION_SHA256,
        activatedAt: new Date(),
      });
      bundle = await createProvisioningBundle({
        deviceId, companyId: context.companyId, enotaId: context.enotaId,
        poslovniProstorId: challenge.poslovniProstorId, poslovniProstorOznaka: premise!.oznaka,
        bIdentifier, expectedFursCertFingerprint: expectedFingerprint, authorityVersion: 1,
        devicePublicKeyFingerprintSha256: fingerprint,
        goldenAttestationSha256: attestation,
      }, tx);
    });
    res.status(201).json(bundle!);
  } catch (error: any) {
    res.status(error?.status ?? (error?.code === "23505" ? 409 : 500)).json({ error: error?.message ?? "Registracija ni uspela." });
  }
});

type Envelope = {
  operationId: string; deviceId: string; poslovniProstorId: number;
  poslovniProstorOznaka: string; bIdentifier: string; sequence: number;
  canonicalPayload: unknown; payloadSha256: string; deviceSignature: string;
  signingPublicKeyFingerprintSha256: string; issuedAt: string; interruptionStartedAt: string;
  operatorReference: string | null; orderId: number; paymentReference: string | null;
  paymentMethod: "cash";
};
type FursV1Payload = {
  envelopeVersion: "furs-v1";
  authorityBundle: Record<string, any> & { bundleId: string; bundleSha256: string; signatureBase64: string };
  finalizationPlan: FinalizationPlan;
  finalizationPlanSha256: string;
  fursArtifact: {
    signedXmlBase64: string; signedXmlSha256: string; zoi: string;
    certificateFingerprint: string; canonicalFields: Record<string, unknown>;
  };
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
function hashPayload(payload: unknown): string {
  return createHash("sha256").update(canonical(payload)).digest("hex");
}
/** The device signs routing/legal fields as well as the payload hash. */
function signatureMessage(receipt: Envelope): string {
  return canonical({
    operationId: receipt.operationId, deviceId: receipt.deviceId,
    poslovniProstorId: receipt.poslovniProstorId, poslovniProstorOznaka: receipt.poslovniProstorOznaka,
    bIdentifier: receipt.bIdentifier, sequence: receipt.sequence, payloadSha256: receipt.payloadSha256,
    issuedAt: receipt.issuedAt, interruptionStartedAt: receipt.interruptionStartedAt,
    operatorReference: receipt.operatorReference ?? null, orderId: receipt.orderId ?? null,
    paymentReference: receipt.paymentReference, paymentMethod: receipt.paymentMethod,
  });
}
function deadline(interruption: Date): Date {
  // Statutory deadline is two business days; weekends never consume a day.
  const result = new Date(interruption);
  let days = 0;
  while (days < 2) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (result.getUTCDay() !== 0 && result.getUTCDay() !== 6) days++;
  }
  return result;
}
function id(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}
function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}
async function receiptResponse(row: typeof offlineFiscalReceiptsTable.$inferSelect) {
  const [businessReceipt] = row.racunId
    ? await db.select({ businessFinalizedAt: racuniTable.businessFinalizedAt, orderId: racuniTable.narociloId })
      .from(racuniTable).where(eq(racuniTable.id, row.racunId)).limit(1)
    : [];
  const delivered = row.fursState === "confirmed" && businessReceipt?.businessFinalizedAt != null &&
    businessReceipt.orderId != null;
  const deliveryState = delivered ? "DELIVERED"
    : row.fursState === "needs_review" || row.fursState === "quarantined" ? "NEEDS_REVIEW" : "PENDING";
  return {
    id: row.id, localReceiptId: row.localReceiptId, operationId: row.operationId,
    number: `${row.poslovniProstorOznaka}-${row.bIdentifier}-${row.sequence}`,
    zoi: row.zoi, eor: row.eor, fursState: row.fursState, printState: row.printState,
    orderId: row.orderId ?? businessReceipt?.orderId ?? null,
    businessFinalized: Boolean(businessReceipt?.businessFinalizedAt),
    deliveryState,
    submissionDeadlineAt: row.submissionDeadlineAt, overdue: row.fursState !== "confirmed" && row.submissionDeadlineAt < new Date(),
    receivedAt: row.receivedAt,
  };
}

/**
 * v2 accepts no device-produced SOAP/XML transport artifact.  The signed legal
 * core is the only device evidence; each server delivery gets a fresh attempt.
 */
async function ingestV2LegalCore(req: Request, res: Response): Promise<void> {
  const context = req as PosRequest;
  const core = req.body as LegalInvoiceCore;
  const bundle = core?.authorityBundle as Record<string, any> | undefined;
  const plan = core?.finalizationPlan as FinalizationPlan | undefined;
  const scope = bundle?.scope;
  if (!core || !plan || core.envelopeVersion !== "furs-v2" || !id(core.operationId) || !id(core.localReceiptId) ||
      !bundle || !scope || !id(scope.deviceId) || !/^[a-f0-9]{64}$/i.test(core.deviceKeyFingerprintSha256 ?? "") ||
      !/^[a-f0-9]{64}$/i.test(core.finalizationPlanSha256 ?? "") || typeof core.deviceSignatureBase64 !== "string") {
    res.status(400).json({ error: "Neveljaven furs-v2 LegalInvoiceCore." }); return;
  }
  if ((req as Request & { deviceSyncDeviceId?: string }).deviceSyncDeviceId &&
      (req as Request & { deviceSyncDeviceId?: string }).deviceSyncDeviceId !== scope.deviceId) {
    res.status(403).json({ error: "Sync podpis in LegalInvoiceCore naprava se ne ujemata." }); return;
  }
  const [device] = await db.select().from(offlineFiscalDevicesTable).where(and(
    eq(offlineFiscalDevicesTable.id, scope.deviceId), eq(offlineFiscalDevicesTable.enotaId, context.enotaId),
  )).limit(1);
  if (!device || device.status !== "active" || !device.productionEnabled || device.contractVersion !== "furs-v2" ||
      device.keyFingerprintSha256 !== core.deviceKeyFingerprintSha256 ||
      device.poslovniProstorId !== scope.premiseId || device.bIdentifier !== scope.bIdentifier) {
    res.status(403).json({ error: "Naprava ali furs-v2 scope ni aktiven." }); return;
  }
  const [authority] = await db.select().from(offlineAuthorityBundlesTable).where(and(
    eq(offlineAuthorityBundlesTable.id, String(bundle.bundleId)), eq(offlineAuthorityBundlesTable.deviceId, device.id),
    eq(offlineAuthorityBundlesTable.enotaId, context.enotaId),
  )).limit(1);
  const issued = new Date((plan as any)?.receipt?.issuedAt);
  if (!authority || authority.revokedAt || authority.authorityVersion !== device.authorityVersion ||
      Number.isNaN(+issued) || issued < authority.validFrom || issued > authority.validUntil ||
      authority.bundleSha256 !== bundle.bundleSha256 || authority.signatureBase64 !== bundle.signatureBase64 ||
      canonicalAuthorityJson(authority.payload) !== canonicalAuthorityJson(Object.fromEntries(
        Object.entries(bundle).filter(([key]) => key !== "bundleSha256" && key !== "signatureBase64"),
      )) || bundle.contract?.version !== "furs-v2") {
    res.status(422).json({ error: "Authority bundle ni veljaven za furs-v2 core.", code: "OFFLINE_FISCAL_QUARANTINE" }); return;
  }
  const { deviceSignatureBase64, ...unsignedCore } = core;
  try {
    const authorityPublicKey = process.env.OFFLINE_AUTHORITY_PUBLIC_KEY_PEM?.replace(/\\n/g, "\n");
    const authorityVerifier = createVerify("RSA-SHA256");
    authorityVerifier.update(canonicalAuthorityJson(authority.payload)); authorityVerifier.end();
    if (!authorityPublicKey || bundle.authority?.keyId !== process.env.OFFLINE_AUTHORITY_KEY_ID ||
        bundle.authority?.publicKeyPem !== authorityPublicKey ||
        !authorityVerifier.verify(authorityPublicKey, Buffer.from(authority.signatureBase64, "base64"))) {
      throw new Error("Authority bundle podpis ni veljaven.");
    }
    const verifier = createVerify("RSA-SHA256"); verifier.update(canonical(unsignedCore)); verifier.end();
    if (!verifier.verify(device.publicKeyPem, Buffer.from(deviceSignatureBase64, "base64"))) throw new Error("Podpis naprave ni veljaven.");
    assertValidFinalizationPlan(plan);
    verifyCanonicalVat(plan, authority.payload, context.companyId, context.enotaId);
    if (finalizationPlanHash(plan) !== core.finalizationPlanSha256 ||
        plan.source !== "offline" || plan.sourceOperationId !== core.operationId || plan.receipt.localReceiptId !== core.localReceiptId ||
        plan.receipt.enotaId !== context.enotaId || plan.receipt.pp !== core.legalInvoice.businessPremiseId ||
        plan.receipt.b !== core.legalInvoice.electronicDeviceId || plan.receipt.ppBSequence !== core.legalInvoice.invoiceNumber ||
        plan.totals.gross.toFixed(2) !== core.legalInvoice.invoiceAmount || plan.payment.cash.toFixed(2) !== core.legalInvoice.paymentAmount) {
      throw new Error("LegalInvoiceCore in finalization plan se ne ujemata.");
    }
    const cert = await pridobiCompanyCert(context.companyId);
    if (!cert?.certPem) throw new Error("Podjetje nima FURS certifikata.");
    const fingerprint = `sha256:${new X509Certificate(cert.certPem).fingerprint256.replace(/:/g, "").toLowerCase()}`;
    const publicKeyPem = new X509Certificate(cert.certPem).publicKey.export({ type: "spki", format: "pem" }).toString();
    if (core.certificateFingerprint !== fingerprint || core.legalInvoice.certificateFingerprint !== fingerprint ||
        device.expectedFursCertFingerprint !== fingerprint ||
        !verifyZOI(core, publicKeyPem, fingerprint)) throw new Error("ZOI podpis ali FURS fingerprint ni veljaven.");
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "Neveljaven furs-v2 core.", code: "OFFLINE_FISCAL_QUARANTINE" }); return;
  }
  const sourceOrderRef = String((plan.receipt as any).sourceOrderRef ?? "");
  const cloudOrderId = (plan.receipt as any).cloudOrderId ?? plan.receipt.orderId;
  const localGatewayReceipt = finalizationPlanAuthority(plan) === "GATEWAY";
  if (!localGatewayReceipt && !Number.isInteger(cloudOrderId)) {
    res.status(422).json({ error: "FURS receipt nima veljavnega cloudOrderId ali sourceOrderRef." }); return;
  }
  if (localGatewayReceipt) {
    // Gateway UUID receipts are legal/audit evidence only at the cloud
    // boundary. Never look up or mutate narocila, inventory, payments, or KDS.
    if (!hasExactKeys(plan.receipt, [
      "localReceiptId", "companyId", "enotaId", "orderId", "cloudOrderId", "sourceOrderRef",
      "legalNumber", "pp", "b", "ppBSequence", "issuedAt", "isPartial",
    ])) {
      res.status(422).json({ error: "Local gateway receipt nima popolnega sourceOrderRef kontrakta." }); return;
    }
  } else {
    const [order] = await db.select({ id: narocilaTable.id }).from(narocilaTable).where(and(
      eq(narocilaTable.id, cloudOrderId), eq(narocilaTable.enotaId, context.enotaId),
    )).limit(1);
    if (!order) { res.status(409).json({ error: "Naročilo ne pripada aktivni enoti." }); return; }
  }
  const payloadSha256 = hashPayload(core);
  const [row] = await db.insert(offlineFiscalReceiptsTable).values({
    id: randomUUID(), operationId: core.operationId, localReceiptId: core.localReceiptId, deviceId: device.id,
    enotaId: context.enotaId, poslovniProstorId: device.poslovniProstorId, poslovniProstorOznaka: plan.receipt.pp,
    bIdentifier: plan.receipt.b, sequence: plan.receipt.ppBSequence, canonicalPayload: core, payloadSha256,
    deviceSignature: core.deviceSignatureBase64, signingPublicKeyFingerprintSha256: core.deviceKeyFingerprintSha256,
    issuedAt: issued, interruptionStartedAt: issued, submissionDeadlineAt: deadline(issued), orderId: plan.receipt.orderId,
    paymentMethod: "cash", zoi: core.legalInvoice.zoi, finalizationPlan: plan, finalizationPlanSha256: core.finalizationPlanSha256,
    fursCertificateFingerprint: core.certificateFingerprint, productionEnabled: device.productionEnabled,
     fursState: "pending",
    authorityBundleId: authority.id, authorityBundleSha256: authority.bundleSha256,
  } as any).onConflictDoNothing().returning();
  if (!row) {
    const [replay] = await db.select().from(offlineFiscalReceiptsTable).where(eq(offlineFiscalReceiptsTable.operationId, core.operationId)).limit(1);
    if (replay && replay.payloadSha256 === payloadSha256 && replay.deviceId === device.id) { res.json(await receiptResponse(replay)); return; }
    res.status(409).json({ error: "LegalInvoiceCore identiteta je že uporabljena z drugačno vsebino.", code: "OFFLINE_RECEIPT_HASH_MISMATCH" });
    return;
  }
  if (localGatewayReceipt) {
    // This additive column is populated only after deployments that include
    // migration 193; cloud-only bootstrap schemas need no UUID column.
    await db.execute(sql`UPDATE offline_fiscal_receipts SET source_order_ref = ${sourceOrderRef} WHERE id = ${row.id}`);
  }
  await db.insert(offlineFiscalReceiptAttemptsTable).values({
    receiptId: row.id,
     action: "ingested",
     outcome: "accepted",
    actorReference: context.clerkUserId,
  });
  res.status(201).json(await receiptResponse(row));
}

/** Admin-only provisioning. The private key is neither accepted nor stored. */
router.post("/offline-fiscal/devices", requirePosAdminRole, async (req: Request, res: Response) => {
  const context = req as PosRequest;
  const body = req.body as Record<string, unknown>;
  if (body.contractVersion === "furs-v1") {
    res.status(410).json({ error: "furs-v1 zahteva challenge/proof provisioning; neposredna registracija ključa je onemogočena." }); return;
  }
  const premiseId = Number(body.poslovniProstorId);
  const bIdentifier = typeof body.bIdentifier === "string" ? body.bIdentifier.trim() : "";
  const suppliedPublicKeyPem = typeof body.publicKeyPem === "string" ? body.publicKeyPem : "";
  const expectedFursCertFingerprint = typeof body.expectedFursCertFingerprint === "string" ? body.expectedFursCertFingerprint : "";
  const goldenAttestationSha256 = typeof body.goldenAttestationSha256 === "string" ? body.goldenAttestationSha256 : "";
  if (!Number.isInteger(premiseId) || !bIdentifier || !suppliedPublicKeyPem || !["android", "windows"].includes(String(body.platform))) {
    res.status(400).json({ error: "Obvezni so poslovniProstorId, bIdentifier, platform in publicKeyPem." }); return;
  }
  if (body.contractVersion !== "furs-v1" || !/^sha256:[a-f0-9]{64}$/.test(expectedFursCertFingerprint) ||
      !/^[a-f0-9]{64}$/.test(goldenAttestationSha256)) {
    res.status(400).json({ error: "Zahtevani so contractVersion=furs-v1, FURS fingerprint in golden attestation SHA-256." }); return;
  }
  let publicKeyPem: string, fingerprint: string;
  try {
    const normalized = normalizeDevicePublicKey(suppliedPublicKeyPem);
    publicKeyPem = normalized.publicKeyPem; fingerprint = normalized.fingerprintSha256;
  } catch { res.status(400).json({ error: "publicKeyPem ni veljaven SPKI javni ključ PEM." }); return; }
  const [premise] = await db.select({ id: poslovniProstoriTable.id }).from(poslovniProstoriTable)
    .where(and(eq(poslovniProstoriTable.id, premiseId), eq(poslovniProstoriTable.enotaId, context.enotaId))).limit(1);
  if (!premise) { res.status(403).json({ error: "Poslovni prostor ne pripada aktivni enoti." }); return; }
  try {
    const [device] = await db.insert(offlineFiscalDevicesTable).values({
      id: randomUUID(), enotaId: context.enotaId, poslovniProstorId: premise.id, bIdentifier,
      platform: body.platform as "android" | "windows", publicKeyPem, keyFingerprintSha256: fingerprint,
      expectedFursCertFingerprint, contractVersion: "furs-v1", goldenAttestationSha256,
      metadata: typeof body.metadata === "object" && body.metadata !== null ? body.metadata : {},
    }).returning();
    res.status(201).json(device);
  } catch (error: any) {
    if (error?.code === "23505") { res.status(409).json({ error: "B naprava je za ta poslovni prostor že registrirana." }); return; }
    throw error;
  }
});

router.post("/offline-fiscal/devices/:id/activate", requirePosAdminRole, async (req, res) => {
  const context = req as PosRequest;
  const [candidate] = await db.select().from(offlineFiscalDevicesTable)
    .where(and(eq(offlineFiscalDevicesTable.id, String(req.params.id)), eq(offlineFiscalDevicesTable.enotaId, context.enotaId))).limit(1);
  if (!candidate) { res.status(404).json({ error: "Naprava ni najdena." }); return; }
  const companyCert = await pridobiCompanyCert(context.companyId);
  if (!companyCert?.certPem) { res.status(409).json({ error: "Podjetje nima konfiguriranega FURS certifikata." }); return; }
  const currentFursFingerprint = `sha256:${new X509Certificate(companyCert.certPem).fingerprint256.replace(/:/g, "").toLowerCase()}`;
  if (candidate.expectedFursCertFingerprint !== currentFursFingerprint) {
    res.status(409).json({ error: "Pričakovani FURS certifikat naprave se ne ujema s certifikatom podjetja." }); return;
  }
  const expectedAttestation = process.env.OFFLINE_FISCAL_GOLDEN_ATTESTATION_SHA256;
  const productionEnabled = process.env.OFFLINE_FISCAL_PRODUCTION_ENABLED === "true"
    && candidate.contractVersion === "furs-v2" && !!expectedAttestation
    && candidate.goldenAttestationSha256 === expectedAttestation && !!candidate.expectedFursCertFingerprint;
  const [row] = await db.update(offlineFiscalDevicesTable).set({ status: "active", productionEnabled, activatedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(offlineFiscalDevicesTable.id, String(req.params.id)), eq(offlineFiscalDevicesTable.enotaId, context.enotaId))).returning();
  if (!row) { res.status(404).json({ error: "Naprava ni najdena." }); return; } res.json(row);
});
router.post("/offline-fiscal/devices/:id/revoke", requirePosAdminRole, async (req, res) => {
  const context = req as PosRequest;
  const row = await db.transaction(async tx => {
    const now = new Date();
    const [device] = await tx.update(offlineFiscalDevicesTable).set({
      status: "revoked", revokedAt: now, revokedReason: String(req.body?.reason ?? ""),
      authorityVersion: sql`${offlineFiscalDevicesTable.authorityVersion} + 1`, productionEnabled: false, updatedAt: now,
    }).where(and(eq(offlineFiscalDevicesTable.id, String(req.params.id)), eq(offlineFiscalDevicesTable.enotaId, context.enotaId))).returning();
    if (device) {
      await tx.update(offlineProvisioningBundlesTable).set({ revokedAt: now })
        .where(and(eq(offlineProvisioningBundlesTable.deviceId, device.id), isNull(offlineProvisioningBundlesTable.revokedAt)));
      await tx.update(offlineAuthorityBundlesTable).set({ revokedAt: now })
        .where(and(eq(offlineAuthorityBundlesTable.deviceId, device.id), isNull(offlineAuthorityBundlesTable.revokedAt)));
    }
    return device;
  });
  if (!row) { res.status(404).json({ error: "Naprava ni najdena." }); return; } res.json(row);
});
router.post("/offline-fiscal/devices/:id/authority-bundles", requirePosAdminRole, async (req, res) => {
  const context = req as PosRequest;
  const waiterId = Number(req.body?.waiterId);
  const shiftId = Number(req.body?.shiftId);
  if (!Number.isInteger(waiterId) || !Number.isInteger(shiftId)) {
    res.status(400).json({ error: "Za bundle sta obvezna waiterId in shiftId." }); return;
  }
  const [operator] = await db.select({
    id: natakariTable.id, ime: natakariTable.ime, priimek: natakariTable.priimek,
    taxNumber: natakariTable.davcnaStevilka,
  }).from(natakariTable).where(and(eq(natakariTable.id, waiterId), eq(natakariTable.companyId, context.companyId))).limit(1);
  const [shift] = await db.select({ id: izmeneTable.id }).from(izmeneTable).where(and(
    eq(izmeneTable.id, shiftId), eq(izmeneTable.enotaId, context.enotaId), eq(izmeneTable.natakariId, waiterId),
  )).limit(1);
  if (!operator || !shift) { res.status(403).json({ error: "Operater/izmena ne pripadata aktivni enoti in podjetju." }); return; }
  try {
    const bundle = await issueOfflineAuthorityBundle({
      deviceId: String(req.params.id), enotaId: context.enotaId, companyId: context.companyId,
      operator: { waiterId, name: `${operator.ime} ${operator.priimek}`, taxNumber: operator.taxNumber, shiftId },
    });
    res.setHeader("Cache-Control", "private, max-age=3600"); res.json(bundle);
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error instanceof Error ? error.message : "Bundle ni bil izdan." });
  }
});

export async function ingestOfflineReceipt(req: Request, res: Response) {
  if (req.body?.envelopeVersion === "furs-v2") {
    await ingestV2LegalCore(req, res);
    return;
  }
  const context = req as PosRequest; const body = req.body as Envelope;
  if (!hasExactKeys(body, ["operationId", "deviceId", "poslovniProstorId", "poslovniProstorOznaka", "bIdentifier", "sequence",
      "issuedAt", "interruptionStartedAt", "orderId", "operatorReference", "paymentReference", "paymentMethod",
      "canonicalPayload", "payloadSha256", "deviceSignature", "signingPublicKeyFingerprintSha256"]) ||
      !id(body.operationId) || !id(body.deviceId) || !Number.isInteger(body.poslovniProstorId) ||
      !Number.isInteger(body.orderId) || !Number.isInteger(body.sequence) || body.sequence < 1 ||
      body.paymentMethod !== "cash" || !body.poslovniProstorOznaka || !body.bIdentifier || typeof body.payloadSha256 !== "string") {
    res.status(400).json({ error: "Neveljaven offline gotovinski račun." }); return;
  }
  if ((req as Request & { deviceSyncDeviceId?: string }).deviceSyncDeviceId &&
      (req as Request & { deviceSyncDeviceId?: string }).deviceSyncDeviceId !== body.deviceId) {
    res.status(403).json({ error: "Sync podpis in envelope deviceId se ne ujemata." }); return;
  }
  if (!/^[a-f0-9]{64}$/i.test(body.payloadSha256) || !/^[a-f0-9]{64}$/i.test(body.signingPublicKeyFingerprintSha256) ||
      typeof body.deviceSignature !== "string" ||
      !(body.operatorReference === null || typeof body.operatorReference === "string") ||
      !(body.paymentReference === null || typeof body.paymentReference === "string")) {
    res.status(400).json({ error: "Neveljavna stroga oblika offline ovoja." }); return;
  }
  const calculatedHash = hashPayload(body.canonicalPayload);
  if (calculatedHash !== body.payloadSha256.toLowerCase()) { res.status(400).json({ error: "SHA-256 kanoničnega payloada se ne ujema." }); return; }
  const issued = new Date(body.issuedAt), interrupted = new Date(body.interruptionStartedAt);
  if (Number.isNaN(+issued) || Number.isNaN(+interrupted) || issued < interrupted) { res.status(400).json({ error: "Neveljaven čas prekinitve ali izdaje." }); return; }
  const [device] = await db.select().from(offlineFiscalDevicesTable).where(and(eq(offlineFiscalDevicesTable.id, body.deviceId), eq(offlineFiscalDevicesTable.enotaId, context.enotaId))).limit(1);
  if (!device || device.status !== "active" || device.poslovniProstorId !== body.poslovniProstorId || device.bIdentifier !== body.bIdentifier) {
    res.status(403).json({ error: "Naprava ni aktivna ali ne pripada enoti/poslovnemu prostoru." }); return;
  }
  if (!device.productionEnabled || device.contractVersion !== "furs-v1") {
    res.status(403).json({ error: "Naprava ni prestala furs-v1 golden attestation ali je produkcijska funkcija izklopljena." }); return;
  }
  const [premise] = await db.select({ prostorId: poslovniProstoriTable.prostorId }).from(poslovniProstoriTable)
    .where(and(eq(poslovniProstoriTable.id, device.poslovniProstorId), eq(poslovniProstoriTable.enotaId, context.enotaId))).limit(1);
  if (!premise || premise.prostorId !== body.poslovniProstorOznaka) {
    res.status(403).json({ error: "Oznaka poslovnega prostora ne pripada registrirani napravi." }); return;
  }
  if (device.keyFingerprintSha256 !== body.signingPublicKeyFingerprintSha256) { res.status(403).json({ error: "Prstni odtis podpisnega ključa se ne ujema." }); return; }
  try {
    const verifier = createVerify("RSA-SHA256"); verifier.update(signatureMessage(body)); verifier.end();
    if (!verifier.verify(device.publicKeyPem, Buffer.from(body.deviceSignature, "base64"))) { res.status(403).json({ error: "Podpis naprave ni veljaven." }); return; }
  } catch { res.status(403).json({ error: "Podpisa naprave ni mogoče preveriti." }); return; }
  const payload = body.canonicalPayload as Partial<FursV1Payload>;
  let plan: FinalizationPlan;
  const artifact = payload.fursArtifact;
  try {
    if (payload.envelopeVersion !== "furs-v1" || !payload.finalizationPlan || !artifact) throw new Error("Manjkajo furs-v1 artefakti.");
    if (!hasExactKeys(payload, ["envelopeVersion", "authorityBundle", "finalizationPlan", "finalizationPlanSha256", "fursArtifact"]) ||
        !hasExactKeys(artifact, ["signedXmlBase64", "signedXmlSha256", "zoi", "certificateFingerprint", "canonicalFields"]) ||
        !hasExactKeys(payload.finalizationPlan.receipt, ["localReceiptId", "companyId", "enotaId", "orderId", "legalNumber", "pp", "b", "ppBSequence", "issuedAt", "isPartial"]) ||
        !hasExactKeys(payload.finalizationPlan, ["version", "source", "sourceOperationId", "receipt", "soldLines", "normativeSnapshot", "totals", "payment", "operator", "closure", "tip", "stockMovements", "kds", "accounting", "print", "reservations", "furs"])) {
      throw new Error("furs-v1 payload vsebuje manjkajoča ali neznana polja.");
    }
    const suppliedBundle = payload.authorityBundle;
    if (!suppliedBundle || !hasExactKeys(suppliedBundle, ["schema", "bundleId", "server", "scope", "contract", "validity", "operator", "catalog", "modifiers", "policies", "authority", "bundleSha256", "signatureBase64"])) {
      throw new Error("Offline authority bundle manjka.");
    }
    const [authority] = await db.select().from(offlineAuthorityBundlesTable).where(and(
      eq(offlineAuthorityBundlesTable.id, suppliedBundle.bundleId),
      eq(offlineAuthorityBundlesTable.deviceId, device.id),
      eq(offlineAuthorityBundlesTable.enotaId, context.enotaId),
    )).limit(1);
    if (!authority || authority.revokedAt || authority.authorityVersion !== device.authorityVersion ||
        issued < authority.validFrom || issued > authority.validUntil ||
        suppliedBundle.bundleSha256 !== authority.bundleSha256 || suppliedBundle.signatureBase64 !== authority.signatureBase64) {
      throw new Error("Authority bundle je preklican, potekel ali napačne verzije/scope.");
    }
    const { bundleSha256: _bundleHash, signatureBase64: _bundleSignature, ...unsignedBundle } = suppliedBundle;
    const authorityCanonical = canonicalAuthorityJson(unsignedBundle);
    if (createHash("sha256").update(authorityCanonical).digest("hex") !== authority.bundleSha256 ||
        canonicalAuthorityJson(authority.payload) !== authorityCanonical) {
      throw new Error("Authority bundle hash/payload se ne ujema.");
    }
    const authorityPublicKey = process.env.OFFLINE_AUTHORITY_PUBLIC_KEY_PEM?.replace(/\\n/g, "\n");
    const authorityKeyId = process.env.OFFLINE_AUTHORITY_KEY_ID;
    const authorityVerifier = createVerify("RSA-SHA256"); authorityVerifier.update(authorityCanonical); authorityVerifier.end();
    if (!authorityPublicKey || !authorityKeyId || suppliedBundle.authority?.keyId !== authorityKeyId ||
        suppliedBundle.authority?.publicKeyPem !== authorityPublicKey ||
        !authorityVerifier.verify(authorityPublicKey, Buffer.from(authority.signatureBase64, "base64"))) {
      throw new Error("Authority bundle podpis ni veljaven.");
    }
    const scope = suppliedBundle.scope;
    const contract = suppliedBundle.contract;
    const operator = suppliedBundle.operator;
    if (scope?.deviceId !== device.id || scope?.premiseId !== device.poslovniProstorId ||
        scope?.bIdentifier !== device.bIdentifier || contract?.version !== "furs-v1" ||
        contract?.goldenAttestationSha256 !== device.goldenAttestationSha256 ||
        operator?.waiterId !== payload.finalizationPlan.operator.waiterId ||
        operator?.shiftId !== payload.finalizationPlan.operator.shiftId) {
      throw new Error("Authority bundle scope/operator/attestation se ne ujema.");
    }
    plan = payload.finalizationPlan;
    assertValidFinalizationPlan(plan);
    if (plan.source !== "offline" || plan.sourceOperationId !== body.operationId ||
        plan.receipt.enotaId !== context.enotaId || plan.receipt.orderId !== body.orderId ||
        plan.receipt.issuedAt !== body.issuedAt || plan.payment.method !== "gotovina" ||
        plan.receipt.pp !== body.poslovniProstorOznaka || plan.receipt.b !== body.bIdentifier ||
        plan.receipt.ppBSequence !== body.sequence || plan.receipt.legalNumber !== `${body.poslovniProstorOznaka}-${body.bIdentifier}-${body.sequence}`) {
      throw new Error("Finalization plan ni vezan na isti pravni ovoj.");
    }
    if (payload.finalizationPlanSha256 !== finalizationPlanHash(plan)) throw new Error("Finalization plan hash se ne ujema.");
    const gross = plan.soldLines.reduce((sum, line) => sum + line.gross, 0);
    if (Math.abs(gross - plan.totals.gross) > 0.01 || Math.abs(plan.payment.cash - plan.totals.gross) > 0.01) {
      throw new Error("Prodajne vrstice, plačilo in totals se ne ujemajo.");
    }
    const xmlBytes = Buffer.from(artifact.signedXmlBase64, "base64");
    const xml = xmlBytes.toString("utf8");
    if (Buffer.from(xml, "utf8").length !== xmlBytes.length) throw new Error("FURS XML ni veljaven UTF-8.");
    const xmlHash = `sha256:${createHash("sha256").update(xmlBytes).digest("hex")}`;
    if (xmlHash !== artifact.signedXmlSha256) throw new Error("FURS XML hash se ne ujema.");
    const cert = await pridobiCompanyCert(context.companyId);
    if (!cert?.certPem) throw new Error("Podjetje nima FURS certifikata.");
    const certFingerprint = `sha256:${new X509Certificate(cert.certPem).fingerprint256.replace(/:/g, "").toLowerCase()}`;
    if (artifact.certificateFingerprint !== certFingerprint || device.expectedFursCertFingerprint !== certFingerprint) {
      throw new Error("FURS certifikat/fingerprint se ne ujema z registracijo naprave.");
    }
    const signatureXml = xml.match(/<Signature[\s\S]*?<\/Signature>/)?.[0];
    if (!signatureXml) throw new Error("FURS XML nima XMLDSig podpisa.");
    const xmlVerifier = new SignedXml({ publicCert: cert.certPem }); xmlVerifier.loadSignature(signatureXml);
    if (!xmlVerifier.checkSignature(xml)) throw new Error("FURS XML podpis ni veljaven.");
    if (artifact.zoi !== artifact.canonicalFields.zoi ||
        artifact.canonicalFields.invoiceAmount !== plan.totals.gross.toFixed(2)) {
      throw new Error("ZOI ali FURS totals se ne ujemajo.");
    }
    const expectedMessageId = deterministicFursMessageId(body.operationId);
    const expectedRequestId = deterministicInvoiceRequestId(plan.receipt.localReceiptId, body.operationId);
    if (artifact.canonicalFields.messageId !== expectedMessageId ||
        artifact.canonicalFields.invoiceRequestId !== expectedRequestId ||
        !xml.includes(`<fu:MessageID>${expectedMessageId}</fu:MessageID>`) ||
        (!xml.includes(`Id="${expectedRequestId}"`) && !xml.includes(`Id='${expectedRequestId}'`))) {
      throw new Error("Dinamična FURS MessageID/InvoiceRequest Id nista deterministično izpeljana.");
    }
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "Neveljaven furs-v1 payload.", code: "OFFLINE_FISCAL_QUARANTINE" }); return;
  }
  const [order] = await db.select({ id: narocilaTable.id }).from(narocilaTable).where(and(eq(narocilaTable.id, body.orderId), eq(narocilaTable.enotaId, context.enotaId))).limit(1);
  if (!order) { res.status(409).json({ error: "Naročilo ne pripada aktivni enoti." }); return; }
  try {
    const now = new Date();
    const [row] = await db.insert(offlineFiscalReceiptsTable).values({
      id: randomUUID(), operationId: body.operationId, deviceId: device.id, enotaId: context.enotaId,
      localReceiptId: plan.receipt.localReceiptId,
      poslovniProstorId: body.poslovniProstorId, poslovniProstorOznaka: body.poslovniProstorOznaka,
      bIdentifier: body.bIdentifier, sequence: body.sequence, canonicalPayload: body.canonicalPayload,
      payloadSha256: calculatedHash, deviceSignature: body.deviceSignature,
      signingPublicKeyFingerprintSha256: body.signingPublicKeyFingerprintSha256, issuedAt: issued,
      interruptionStartedAt: interrupted, submissionDeadlineAt: deadline(interrupted), operatorReference: body.operatorReference,
      orderId: body.orderId, paymentReference: body.paymentReference, paymentMethod: "cash", zoi: artifact!.zoi,
      finalizationPlan: plan, finalizationPlanSha256: payload.finalizationPlanSha256,
      signedFursXmlBase64: artifact!.signedXmlBase64, signedFursXmlSha256: artifact!.signedXmlSha256,
      fursCanonicalFields: artifact!.canonicalFields, fursCertificateFingerprint: artifact!.certificateFingerprint,
      productionEnabled: device.productionEnabled,
      authorityBundleId: payload.authorityBundle!.bundleId,
      authorityBundleSha256: payload.authorityBundle!.bundleSha256,
    }).returning();
    await db.insert(offlineFiscalReceiptAttemptsTable).values({ receiptId: row.id, action: "ingested", outcome: "accepted", actorReference: context.clerkUserId });
    // Deliberately not invoking monolithic racuni finalisation: its inventory,
    // payment and legal-number side effects are not safely replayable here.
    res.status(201).json(await receiptResponse(row));
  } catch (error: any) {
    if (error?.code !== "23505") throw error;
    const [replay] = await db.select().from(offlineFiscalReceiptsTable).where(eq(offlineFiscalReceiptsTable.operationId, body.operationId)).limit(1);
    if (replay) {
      if (replay.payloadSha256 === calculatedHash && replay.deviceId === body.deviceId) { res.json(await receiptResponse(replay)); return; }
      res.status(409).json({ error: "Operation UUID je že uporabljen z drugačnim ovojem.", code: "OFFLINE_RECEIPT_HASH_MISMATCH" }); return;
    }
    res.status(409).json({ error: "Številka PP-B-sequence je že zasedena; račun je v karanteni.", code: "OFFLINE_RECEIPT_SEQUENCE_CONFLICT" });
  }
}
router.post("/offline-fiscal/receipts/ingest", ingestOfflineReceipt);

router.get("/offline-fiscal/receipts", async (req, res) => {
  const context = req as PosRequest; const state = typeof req.query.state === "string" ? req.query.state : undefined;
  const where = state ? and(eq(offlineFiscalReceiptsTable.enotaId, context.enotaId), eq(offlineFiscalReceiptsTable.fursState, state as any)) : eq(offlineFiscalReceiptsTable.enotaId, context.enotaId);
  const rows = await db.select().from(offlineFiscalReceiptsTable).where(where).orderBy(offlineFiscalReceiptsTable.submissionDeadlineAt);
  res.json({ items: await Promise.all(rows.map(receiptResponse)), counts: { total: rows.length, overdue: rows.filter(row => row.fursState !== "confirmed" && row.submissionDeadlineAt < new Date()).length } });
});
router.get("/offline-fiscal/receipts/:id", async (req, res) => {
  const context = req as unknown as PosRequest; const [row] = await db.select().from(offlineFiscalReceiptsTable).where(and(eq(offlineFiscalReceiptsTable.id, String(req.params.id)), eq(offlineFiscalReceiptsTable.enotaId, context.enotaId))).limit(1);
  if (!row) { res.status(404).json({ error: "Offline račun ni najden." }); return; } res.json(await receiptResponse(row));
});
router.post("/offline-fiscal/receipts/:id/retry", requirePosAdminRole, async (req, res) => {
  const context = req as PosRequest; const [row] = await db.select().from(offlineFiscalReceiptsTable).where(and(eq(offlineFiscalReceiptsTable.id, String(req.params.id)), eq(offlineFiscalReceiptsTable.enotaId, context.enotaId))).limit(1);
  if (!row) { res.status(404).json({ error: "Offline račun ni najden." }); return; }
  if (row.fursState === "unknown") { res.status(409).json({ error: "Neznanega odgovora ni dovoljeno samodejno ponovno poslati.", code: "RECONCILIATION_REQUIRED" }); return; }
  if (row.fursState === "confirmed") {
    const [business] = row.racunId ? await db.select({ finalized: racuniTable.businessFinalizedAt })
      .from(racuniTable).where(eq(racuniTable.id, row.racunId)).limit(1) : [];
    if (business?.finalized) { res.status(409).json({ error: "Račun je že poslovno zaključen." }); return; }
    const [updated] = await db.update(offlineFiscalReceiptsTable).set({
      fursLastError: null, finalizationLastError: null, finalizationNextAttemptAt: null,
      claimToken: null, claimLeaseUntil: null, updatedAt: new Date(),
    }).where(eq(offlineFiscalReceiptsTable.id, row.id)).returning();
    res.json(await receiptResponse(updated)); return;
  }
  if (row.fursState !== "failed") { res.status(409).json({ error: "Ponovitev je dovoljena samo za stanje failed." }); return; }
  const [updated] = await db.update(offlineFiscalReceiptsTable).set({ fursState: "pending", fursLastError: null, updatedAt: new Date() }).where(eq(offlineFiscalReceiptsTable.id, row.id)).returning();
  await db.insert(offlineFiscalReceiptAttemptsTable).values({ receiptId: row.id, action: "submit", outcome: "accepted", actorReference: context.clerkUserId, detail: "Queued for controlled FURS submission." });
  res.json(await receiptResponse(updated));
});
router.post("/offline-fiscal/receipts/:id/reconcile", requirePosAdminRole, async (req, res) => {
  const context = req as PosRequest; const [row] = await db.select().from(offlineFiscalReceiptsTable).where(and(eq(offlineFiscalReceiptsTable.id, String(req.params.id)), eq(offlineFiscalReceiptsTable.enotaId, context.enotaId))).limit(1);
  if (!row) { res.status(404).json({ error: "Offline račun ni najden." }); return; }
  await db.insert(offlineFiscalReceiptAttemptsTable).values({ receiptId: row.id, action: "reconcile", outcome: "accepted", actorReference: context.clerkUserId, detail: String(req.body?.note ?? "Manual reconciliation requested") });
  res.json({ ...(await receiptResponse(row)), reconciliationRequired: true });
});
router.post("/offline-fiscal/receipts/:id/claim", requirePosAdminRole, async (req, res) => {
  const context = req as PosRequest;
  try {
    const settings = toResponse(await readAll("", context.enotaId));
    const configured = settings.fursNacin;
    if (configured === "simulacija") {
      res.status(409).json({ error: "Offline furs-v2 claim ni dovoljen v simulacijskem načinu." }); return;
    }
    const result = await claimAndSubmitOfflineReceipt({
      receiptId: String(req.params.id), enotaId: context.enotaId, companyId: context.companyId,
      actor: context.clerkUserId, fursMode: configured, proxyUrl: settings.fursProxyUrl || undefined,
    });
    res.status(result.replay ? 200 : 202).json(result);
  } catch (error: any) {
    res.status(error?.status ?? (error?.code === "OFFLINE_ORDER_CHANGED" ? 409 : 500)).json({
      error: error instanceof Error ? error.message : "Offline claim ni uspel.",
      code: error?.code,
    });
  }
});
export default router;