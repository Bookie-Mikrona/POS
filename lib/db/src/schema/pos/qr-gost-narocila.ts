import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";
import { mizeTable } from "./mize";
import { narocilaTable } from "./narocila";

/** One accepted public QR submission. The unique key is the retry boundary. */
export const qrGostNarocilaTable = pgTable("qr_gost_narocila", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  mizaId: integer("miza_id").notNull().references(() => mizeTable.id, { onDelete: "restrict" }),
  qrNapravaId: text("qr_naprava_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  narociloId: integer("narocilo_id").notNull().references(() => narocilaTable.id, { onDelete: "restrict" }),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ux_qr_gost_narocila_retry").on(t.enotaId, t.mizaId, t.qrNapravaId, t.idempotencyKey),
  index("ix_qr_gost_narocila_narocilo").on(t.narociloId),
]);