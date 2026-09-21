import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";
import { narocilaTable } from "./narocila";
import { poslovniProstoriTable } from "./poslovni-prostori";

/**
 * A registered electronic device B.  The signing private key deliberately
 * never reaches this table: it remains in the Android/Windows fiscal service.
 */
export const offlineFiscalDevicesTable = pgTable("offline_fiscal_devices", {
  id: uuid("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "restrict" }),
  poslovniProstorId: integer("poslovni_prostor_id").notNull().references(() => poslovniProstoriTable.id, { onDelete: "restrict" }),
  bIdentifier: text("b_identifier").notNull(),
  platform: text("platform", { enum: ["android", "windows"] }).notNull(),
  publicKeyPem: text("public_key_pem").notNull(),
  keyFingerprintSha256: text("key_fingerprint_sha256").notNull(),
  expectedFursCertFingerprint: text("expected_furs_cert_fingerprint"),
  contractVersion: text("contract_version").notNull().default("provisional"),
  goldenAttestationSha256: text("golden_attestation_sha256"),
  productionEnabled: boolean("production_enabled").notNull().default(false),
  authorityVersion: integer("authority_version").notNull().default(1),
  status: text("status", { enum: ["provisioned", "active", "revoked"] }).notNull().default("provisioned"),
  provisionedAt: timestamp("provisioned_at", { withTimezone: true }).notNull().defaultNow(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
  lastSequence: integer("last_sequence").notNull().default(0),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ux_offline_fiscal_devices_scope_b").on(table.enotaId, table.poslovniProstorId, table.bIdentifier),
]);

/** Immutable legal envelope received from an offline fiscal service. */
export const offlineFiscalReceiptsTable = pgTable("offline_fiscal_receipts", {
  id: uuid("id").primaryKey(),
  operationId: uuid("operation_id").notNull(),
  localReceiptId: uuid("local_receipt_id").notNull(),
  deviceId: uuid("device_id").notNull().references(() => offlineFiscalDevicesTable.id, { onDelete: "restrict" }),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "restrict" }),
  poslovniProstorId: integer("poslovni_prostor_id").notNull().references(() => poslovniProstoriTable.id, { onDelete: "restrict" }),
  poslovniProstorOznaka: text("poslovni_prostor_oznaka").notNull(),
  bIdentifier: text("b_identifier").notNull(),
  sequence: integer("sequence").notNull(),
  canonicalPayload: jsonb("canonical_payload").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  deviceSignature: text("device_signature").notNull(),
  authorityBundleId: uuid("authority_bundle_id"),
  authorityBundleSha256: text("authority_bundle_sha256"),
  finalizationPlan: jsonb("finalization_plan"),
  finalizationPlanSha256: text("finalization_plan_sha256"),
  signedFursXmlBase64: text("signed_furs_xml_base64"),
  signedFursXmlSha256: text("signed_furs_xml_sha256"),
  fursCanonicalFields: jsonb("furs_canonical_fields"),
  fursCertificateFingerprint: text("furs_certificate_fingerprint"),
  signingPublicKeyFingerprintSha256: text("signing_public_key_fingerprint_sha256").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  interruptionStartedAt: timestamp("interruption_started_at", { withTimezone: true }).notNull(),
  submissionDeadlineAt: timestamp("submission_deadline_at", { withTimezone: true }).notNull(),
  operatorReference: text("operator_reference"),
  orderId: integer("order_id").references(() => narocilaTable.id, { onDelete: "restrict" }),
  paymentReference: text("payment_reference"),
  paymentMethod: text("payment_method", { enum: ["cash"] }).notNull().default("cash"),
  zoi: text("zoi").notNull(),
  printState: text("print_state", { enum: ["not_printed", "printed", "failed"] }).notNull().default("not_printed"),
  fursState: text("furs_state", { enum: ["received_pending_review", "pending", "sending", "confirmed", "failed", "unknown", "needs_review", "quarantined"] }).notNull().default("received_pending_review"),
  eor: text("eor"),
  fursAttemptCount: integer("furs_attempt_count").notNull().default(0),
  fursLastError: text("furs_last_error"),
  fursLastAttemptAt: timestamp("furs_last_attempt_at", { withTimezone: true }),
  fursConfirmedAt: timestamp("furs_confirmed_at", { withTimezone: true }),
  finalizationAttemptCount: integer("finalization_attempt_count").notNull().default(0),
  finalizationNextAttemptAt: timestamp("finalization_next_attempt_at", { withTimezone: true }),
  finalizationLastError: text("finalization_last_error"),
  racunId: integer("racun_id"),
  claimToken: uuid("claim_token"),
  claimLeaseUntil: timestamp("claim_lease_until", { withTimezone: true }),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  productionEnabled: boolean("production_enabled").notNull().default(false),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ux_offline_fiscal_receipts_operation").on(table.operationId),
  uniqueIndex("offline_fiscal_receipts_local_receipt_unique").on(table.localReceiptId),
  uniqueIndex("ux_offline_fiscal_receipts_number").on(table.enotaId, table.poslovniProstorOznaka, table.bIdentifier, table.sequence),
  uniqueIndex("ux_offline_fiscal_receipts_racun").on(table.racunId),
]);

/** Append-only record of every submit/reconcile action; never contains keys. */
export const offlineFiscalReceiptAttemptsTable = pgTable("offline_fiscal_receipt_attempts", {
  id: serial("id").primaryKey(),
  receiptId: uuid("receipt_id").notNull().references(() => offlineFiscalReceiptsTable.id, { onDelete: "restrict" }),
  action: text("action", { enum: ["ingested", "submit", "response_unknown", "reconcile", "quarantine"] }).notNull(),
  outcome: text("outcome", { enum: ["accepted", "confirmed", "failed", "unknown", "rejected"] }).notNull(),
  detail: text("detail"),
  actorReference: text("actor_reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only, server-signed FURS transport attempts for one immutable legal core. */
export const offlineFursTransportAttemptsTable = pgTable("offline_furs_transport_attempts", {
  id: uuid("id").primaryKey(),
  receiptId: uuid("offline_receipt_id").notNull().references(() => offlineFiscalReceiptsTable.id, { onDelete: "restrict" }),
  attemptNo: integer("attempt_no").notNull(),
  messageId: uuid("message_id").notNull(),
  invoiceRequestId: text("invoice_request_id").notNull(),
  signedXmlBase64: text("signed_xml_base64").notNull(),
  signedXmlSha256: text("signed_xml_sha256").notNull(),
  certificateFingerprint: text("certificate_fingerprint").notNull(),
  state: text("state", { enum: ["allocated", "sending", "confirmed", "retry_scheduled", "failed", "review"] }).notNull(),
  eor: text("eor"),
  responseBody: text("response_body"),
  errorCode: text("error_code"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("offline_furs_transport_attempt_receipt_no_unique").on(table.receiptId, table.attemptNo),
  uniqueIndex("offline_furs_transport_attempt_message_unique").on(table.messageId),
  uniqueIndex("offline_furs_transport_attempt_request_unique").on(table.invoiceRequestId),
]);

export const offlineFursTransportEventsTable = pgTable("offline_furs_transport_events", {
  id: serial("id").primaryKey(),
  attemptId: uuid("attempt_id").notNull().references(() => offlineFursTransportAttemptsTable.id, { onDelete: "restrict" }),
  eventType: text("event_type", { enum: ["allocated", "sent", "response", "timeout", "network_error", "retry_scheduled", "validation_error", "confirmed", "review"] }).notNull(),
  detail: jsonb("detail").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const offlineAuthorityBundlesTable = pgTable("offline_authority_bundles", {
  id: uuid("id").primaryKey(),
  deviceId: uuid("device_id").notNull().references(() => offlineFiscalDevicesTable.id, { onDelete: "restrict" }),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "restrict" }),
  authorityVersion: integer("authority_version").notNull(),
  bundleSha256: text("bundle_sha256").notNull(),
  payload: jsonb("payload").notNull(),
  keyId: text("key_id").notNull(),
  signatureBase64: text("signature_base64").notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ux_offline_authority_bundle_hash").on(table.bundleSha256),
]);

export const offlineProvisioningChallengesTable = pgTable("offline_provisioning_challenges", {
  id: uuid("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "restrict" }),
  poslovniProstorId: integer("poslovni_prostor_id").notNull().references(() => poslovniProstoriTable.id, { onDelete: "restrict" }),
  challenge: text("challenge").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const offlineProvisioningBundlesTable = pgTable("offline_provisioning_bundles", {
  id: uuid("id").primaryKey(),
  deviceId: uuid("device_id").notNull().references(() => offlineFiscalDevicesTable.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  payload: jsonb("payload").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  signatureBase64: text("signature_base64").notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("offline_provisioning_bundle_device_version_unique").on(table.deviceId, table.version),
]);

export const offlineDeviceSyncNoncesTable = pgTable("offline_device_sync_nonces", {
  deviceId: uuid("device_id").notNull().references(() => offlineFiscalDevicesTable.id, { onDelete: "restrict" }),
  nonce: text("nonce").notNull(),
  requestTimestamp: timestamp("request_timestamp", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("offline_device_sync_nonce_unique").on(table.deviceId, table.nonce),
]);