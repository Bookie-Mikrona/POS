import { db, companiesTable, enoteTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { CompanyEmailSender } from "./email-sender";

/** Resolve the owner of the already-authorized document/unit, not a request-body company. */
export async function loadUnitEmailSender(enotaId: number): Promise<CompanyEmailSender | undefined> {
  const [sender] = await db.select({
    companyName: companiesTable.naziv,
    companyEmail: companiesTable.email,
  }).from(enoteTable)
    .innerJoin(companiesTable, eq(companiesTable.id, enoteTable.companyId))
    .where(eq(enoteTable.id, enotaId)).limit(1);
  return sender;
}
