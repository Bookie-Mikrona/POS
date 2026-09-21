import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { offlineFiscalDevicesTable } from "./pos/offline-racuni";
import { offlineFiscalReceiptsTable } from "./pos/offline-racuni";
import { postavkeTable } from "./pos/narocila";

/**
 * Append-only reconciliation boundary for collaborative Windows gateways.
 * Cloud stores these events for audit/projection only; it never replays receipt
 * side effects that the gateway has already finalised.
 */
export const offlineGatewayEventsTable = pgTable("offline_gateway_events", {
  id: uuid("id").primaryKey(),
  deviceId: uuid("device_id").notNull().references(() => offlineFiscalDevicesTable.id, { onDelete: "restrict" }),
  gatewaySeq: integer("gateway_seq").notNull(),
  operationId: text("operation_id").notNull(),
  eventType: text("event_type").notNull(),
  payloadHash: text("payload_hash").notNull(),
  payload: jsonb("payload").notNull(),
  state: text("state", { enum: ["accepted", "needs_review"] }).notNull().default("accepted"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("offline_gateway_events_device_seq").on(table.deviceId, table.gatewaySeq),
  uniqueIndex("offline_gateway_events_device_operation").on(table.deviceId, table.operationId),
 ]);

/** Durable evidence for an append-only stream conflict. Reviews do not mutate
 * accepted events or invoke any fiscal receipt side effect. */
export const offlineGatewaySyncReviewsTable = pgTable("offline_gateway_sync_reviews", {
  id: uuid("id").primaryKey(),
  deviceId: uuid("device_id").notNull().references(() => offlineFiscalDevicesTable.id, { onDelete: "restrict" }),
  gatewaySeq: integer("gateway_seq").notNull(),
  operationId: text("operation_id").notNull(),
  existingPayloadHash: text("existing_payload_hash"),
  incomingPayloadHash: text("incoming_payload_hash").notNull(),
  reason: text("reason").notNull(),
  state: text("state", { enum: ["open", "resolved"] }).notNull().default("open"),
  resolution: text("resolution"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),
  evidence: jsonb("evidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const offlineGatewaySyncCheckpointsTable = pgTable("offline_gateway_sync_checkpoints", {
  id: uuid("id").primaryKey(),
  deviceId: uuid("device_id").notNull().references(() => offlineFiscalDevicesTable.id, { onDelete: "restrict" }),
  lastAcceptedSeq: integer("last_accepted_seq").notNull().default(0),
  lastResolvedSeq: integer("last_resolved_seq").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("offline_gateway_sync_checkpoints_device").on(table.deviceId),
]);

/** Immutable source-line to cloud-line binding created before FURS I/O. */
export const offlineGatewayReceiptLineMappingsTable = pgTable("offline_gateway_receipt_line_mappings", {
  id: uuid("id").primaryKey(),
  receiptId: uuid("receipt_id").notNull().references(() => offlineFiscalReceiptsTable.id, { onDelete: "restrict" }),
  sourceLineRef: text("source_line_ref").notNull(),
  cloudLineId: integer("cloud_line_id").notNull().references(() => postavkeTable.id, { onDelete: "restrict" }),
  companyId: text("company_id").notNull(),
  enotaId: integer("enota_id").notNull(),
  orderId: integer("order_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("offline_gateway_receipt_line_mappings_receipt_source")
    .on(table.receiptId, table.sourceLineRef),
  uniqueIndex("offline_gateway_receipt_line_mappings_receipt_cloud")
    .on(table.receiptId, table.cloudLineId),
]);