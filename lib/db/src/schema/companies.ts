import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Stand-in za podjetja (poslovne partnerje) iz FURS POS Web.
 * Ko bo skupna baza integrirana, bo ta tabela nadomeščena z referenco
 * na obstoječo tabelo poslovnih partnerjev v FURS POS Web.
 */
export const companiesTable = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  taxNumber: text("tax_number"), // davčna številka (SI + 8 številk)
  registrationNumber: text("registration_number"), // matična številka (10 številk)
  address: text("address"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCompanySchema = createInsertSchema(companiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const selectCompanySchema = createSelectSchema(companiesTable);
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companiesTable.$inferSelect;
