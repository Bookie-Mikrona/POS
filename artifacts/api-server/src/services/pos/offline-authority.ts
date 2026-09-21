import { createHash, createSign, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  db, offlineAuthorityBundlesTable, offlineFiscalDevicesTable,
} from "@workspace/db";

export function canonicalAuthorityJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalAuthorityJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalAuthorityJson(child)}`).join(",")}}`;
}

export async function issueOfflineAuthorityBundle(input: {
  deviceId: string; enotaId: number; companyId: string;
  operator: { waiterId: number | null; name: string | null; taxNumber: string | null; shiftId: number | null };
}) {
  const privateKey = process.env.OFFLINE_AUTHORITY_PRIVATE_KEY_PEM?.replace(/\\n/g, "\n");
  const publicKey = process.env.OFFLINE_AUTHORITY_PUBLIC_KEY_PEM?.replace(/\\n/g, "\n");
  const keyId = process.env.OFFLINE_AUTHORITY_KEY_ID;
  const attestationVersion = process.env.OFFLINE_FISCAL_GOLDEN_ATTESTATION_SHA256;
  if (!privateKey || !publicKey || !keyId || !attestationVersion) {
    throw Object.assign(new Error("Offline authority signing key ali attestation ni konfiguriran."), { status: 503 });
  }
  const [device] = await db.select().from(offlineFiscalDevicesTable).where(and(
    eq(offlineFiscalDevicesTable.id, input.deviceId), eq(offlineFiscalDevicesTable.enotaId, input.enotaId),
    eq(offlineFiscalDevicesTable.status, "active"), eq(offlineFiscalDevicesTable.productionEnabled, true),
  )).limit(1);
  if (!device) throw Object.assign(new Error("Aktivna attestirana naprava ni najdena."), { status: 404 });
  const cacheThreshold = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const [cached] = await db.select().from(offlineAuthorityBundlesTable).where(and(
    eq(offlineAuthorityBundlesTable.deviceId, device.id),
    eq(offlineAuthorityBundlesTable.authorityVersion, device.authorityVersion),
    isNull(offlineAuthorityBundlesTable.revokedAt), gt(offlineAuthorityBundlesTable.validUntil, cacheThreshold),
  )).orderBy(desc(offlineAuthorityBundlesTable.validUntil)).limit(1);
  if (cached) return { ...cached.payload as object, bundleSha256: cached.bundleSha256, signatureBase64: cached.signatureBase64 };

  const catalog = await db.execute<{
    id: number; name: string; price: string; vat_rate: string; kind: string | null;
    modifier_id: number | null; input_article_id: number | null; normative_quantity: string | null; wac: string | null;
  }>(sql`
    SELECT a.id, a.ime AS name, a.cena AS price, a.davek AS vat_rate,
           CASE WHEN a.je_modifikator THEN 'modifier' WHEN a.nabavni_artikel THEN 'purchase' ELSE 'sale' END AS kind,
           NULL::integer AS modifier_id, n.vhodni_artikel_id AS input_article_id,
           n.kolicina AS normative_quantity, z.povprecna_cena AS wac
    FROM artikli a
    LEFT JOIN normativi n ON n.artikel_id = a.id
    LEFT JOIN zaloge z ON z.artikel_id = COALESCE(n.vhodni_artikel_id, a.id)
    WHERE a.enota_id = ${input.enotaId} AND a.aktiven = true AND a.prodajni_artikel = true
    ORDER BY a.id, n.id
  `);
  const modifiers = await db.execute<{
    id: number; name: string; price_delta: string; input_article_id: number | null; group_id: number; article_ids: number[];
    normative_quantity: string | null; wac: string | null;
  }>(sql`
    SELECT m.id, m.ime AS name, m.cena_dodatek AS price_delta, s.id AS group_id,
           n.vhodni_artikel_id AS input_article_id, n.kolicina AS normative_quantity,
           z.povprecna_cena AS wac,
           ARRAY(SELECT ams.artikel_id FROM artikli_modifikatorske_skupine ams WHERE ams.skupina_id = s.id) AS article_ids
    FROM modifikatorji m
    JOIN modifikatorske_skupine s ON s.id = m.skupina_id
    LEFT JOIN modifikator_normativi n ON n.modifikator_id = m.id
    LEFT JOIN zaloge z ON z.artikel_id = n.vhodni_artikel_id
    WHERE s.enota_id = ${input.enotaId} AND m.aktiven = true
    ORDER BY m.id, n.id
  `);
  const now = new Date();
  const validUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const bundleId = randomUUID();
  const payload = {
    schema: "bookie-offline-authority-v1", bundleId,
    server: { companyId: input.companyId, enotaId: input.enotaId },
    scope: { deviceId: device.id, premiseId: device.poslovniProstorId, bIdentifier: device.bIdentifier },
    contract: { version: "furs-v2", goldenAttestationSha256: attestationVersion, authorityVersion: device.authorityVersion },
    validity: { validFrom: now.toISOString(), validUntil: validUntil.toISOString(), outageSubmissionBusinessDays: 2 },
    operator: input.operator,
    catalog: catalog.rows.map(row => ({
      articleId: row.id, name: row.name, unitGross: row.price, vatRate: row.vat_rate, articleKind: row.kind,
      inputArticleId: row.input_article_id, normativeQuantity: row.normative_quantity, unitWac: row.wac,
    })),
    modifiers: modifiers.rows.map(row => ({
      modifierId: row.id, name: row.name, priceDelta: row.price_delta, groupId: row.group_id,
      vatRule: "inherit_parent" as const,
      articleIds: row.article_ids ?? [],
      inputArticleId: row.input_article_id, normativeQuantity: row.normative_quantity, unitWac: row.wac,
    })),
    policies: {
      paymentMethods: ["cash"], maxReceiptGross: "10000.00", maxLines: 250,
      stock: "signed-snapshot-exactly-once", kds: "signed-effects-exactly-once",
      accounting: "server-after-confirmation", staleOrder: "quarantine",
    },
    authority: { keyId, algorithm: "RSA-SHA256", publicKeyPem: publicKey },
  };
  const canonical = canonicalAuthorityJson(payload);
  const bundleSha256 = createHash("sha256").update(canonical).digest("hex");
  const signer = createSign("RSA-SHA256"); signer.update(canonical); signer.end();
  const signatureBase64 = signer.sign(privateKey).toString("base64");
  await db.insert(offlineAuthorityBundlesTable).values({
    id: bundleId, deviceId: device.id, enotaId: input.enotaId, authorityVersion: device.authorityVersion,
    bundleSha256, payload, keyId, signatureBase64, validFrom: now, validUntil,
  });
  return { ...payload, bundleSha256, signatureBase64 };
}