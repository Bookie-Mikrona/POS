import { createHash } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  db, documentsTable, companiesTable, accountsTable, counterpartiesTable,
  accountingPeriodsTable, journalEntriesTable, journalEntryLinesTable,
  bankStatementsTable, bankStatementLinesTable, invoicesTable, paymentAllocationsTable,
  auditLogTable,
} from "@workspace/db";
import { parseScannedBankStatement } from "./scannedBankStatement";
import { ObjectStorageService } from "./objectStorage";

export class BankDraftError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export interface ScannedBankDraftInput {
  periodId: string;
  bankAccountId: string;
  replaceDraftInvoice?: boolean;
  transactions: { transactionId: string; counterAccountId: string; counterpartyId?: string | null }[];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normalizeIban = (value: string) => value.replace(/\s/g, "").toUpperCase();

/** Authorization is performed by the route; all financial ownership is rechecked here. */
export async function createScannedBankDraft(
  companyId: string, documentId: string, actorId: string, actorLabel: string,
  input: ScannedBankDraftInput,
) {
  if (!input || !uuid.test(input.periodId ?? "") || !uuid.test(input.bankAccountId ?? "")
    || !Array.isArray(input.transactions) || input.transactions.length === 0
    || input.transactions.some(line => !line || typeof line.transactionId !== "string"
      || !uuid.test(line.counterAccountId ?? "")
      || (line.counterpartyId != null && !uuid.test(line.counterpartyId)))) {
    throw new BankDraftError("Izberite obdobje, bančni konto in veljavne konte ter partnerje za vse transakcije.");
  }
  const [source] = await db.select().from(documentsTable).where(and(
    eq(documentsTable.id, documentId), eq(documentsTable.companyId, companyId),
  )).limit(1);
  if (!source) throw new BankDraftError("Dokument ni najden.", 404);
  if (source.confirmedData?.bankStatementDraft) return source.confirmedData.bankStatementDraft;
  // Hash the ORIGINAL file, not the model's transcription or a client-supplied hash.
  const file = await new ObjectStorageService().getObjectEntityFile(source.objectPath);
  const [bytes] = await file.download();
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");

  return db.transaction(async tx => {
    const [doc] = await tx.select().from(documentsTable).where(and(
      eq(documentsTable.id, documentId), eq(documentsTable.companyId, companyId),
    )).for("update");
    if (!doc) throw new BankDraftError("Dokument ni najden.", 404);
    if (doc.confirmedData?.bankStatementDraft) return doc.confirmedData.bankStatementDraft;
    if (doc.status !== "done" && doc.status !== "confirmed") throw new BankDraftError("Dokument ni pripravljen za prenos.");
    const statement = parseScannedBankStatement(doc.ocrResult?.rawText ?? "");
    if (!statement) throw new BankDraftError("Dokument ni prepoznan kot bančni izpisek.");
    if (statement.errors.length) throw new BankDraftError(statement.errors.join(" "));
    const movements = statement.transactions;
    const requested = new Map(input.transactions.map(line => [line.transactionId, line]));
    if (requested.size !== input.transactions.length || requested.size !== movements.length
      || movements.some(line => !requested.has(line.transactionId))) {
      throw new BankDraftError("Pregled mora vključevati natanko vse transakcije izpiska.");
    }
    const [company] = await tx.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    const ownerTaxMatches = statement.ownerTaxId
      && company?.podjetjeDavcna.replace(/\D/g, "") === statement.ownerTaxId;
    const ownerIbanMatches = company?.trr?.some(account => normalizeIban(account.iban) === statement.sourceIban);
    if (!company || (statement.ownerTaxId ? !ownerTaxMatches : !ownerIbanMatches)) {
      throw new BankDraftError("Izpisek ne dokazuje pripadnosti aktivnemu podjetju.", 403);
    }
    const [period] = await tx.select().from(accountingPeriodsTable).where(and(
      eq(accountingPeriodsTable.id, input.periodId), eq(accountingPeriodsTable.companyId, companyId),
    )).for("share");
    if (!period || period.status !== "open" || movements.some(line => line.bookingDate < period.startDate || line.bookingDate > period.endDate)
      || statement.statementDate! < period.startDate || statement.statementDate! > period.endDate) {
      throw new BankDraftError("Izberite odprto obdobje, ki zajema datum izpiska in vse transakcije.");
    }
    const accountIds = [...new Set([input.bankAccountId, ...input.transactions.map(line => line.counterAccountId)])];
    const accounts = await tx.select().from(accountsTable).where(and(
      eq(accountsTable.companyId, companyId), inArray(accountsTable.id, accountIds),
      eq(accountsTable.isActive, true), eq(accountsTable.allowsPosting, true),
    )).for("share");
    const accountMap = new Map(accounts.map(account => [account.id, account]));
    const bankAccount = accountMap.get(input.bankAccountId);
    if (accounts.length !== accountIds.length || !bankAccount?.code.startsWith("110")
      || input.transactions.some(line => line.counterAccountId === bankAccount.id)) {
      throw new BankDraftError("Bančni konto mora biti knjižljiv 110x; protikonti morajo biti aktivni konti tega podjetja.");
    }
    const partnerIds = [...new Set(input.transactions.flatMap(line => line.counterpartyId ? [line.counterpartyId] : []))];
    const partners = partnerIds.length ? await tx.select().from(counterpartiesTable).where(and(
      eq(counterpartiesTable.companyId, companyId), inArray(counterpartiesTable.id, partnerIds),
      eq(counterpartiesTable.isActive, true),
    )).for("share") : [];
    if (partners.length !== partnerIds.length) throw new BankDraftError("Partner ni aktiven v tem podjetju.");
    if (input.transactions.some(line => accountMap.get(line.counterAccountId)?.requiresPartner && !line.counterpartyId)) {
      throw new BankDraftError("Za izbrani protikonto morate določiti partnerja.");
    }
    // Prevent duplicate scans even when the PDF was regenerated with different bytes.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`scanned-bank:${companyId}:${statement.sourceIban}:${statement.statementDate}:${statement.statementNumber}`}, 0))`);
    const [duplicate] = await tx.select({ id: bankStatementsTable.id }).from(bankStatementsTable).where(and(
      eq(bankStatementsTable.companyId, companyId),
      or(eq(bankStatementsTable.sourceSha256, sourceSha256), and(
        eq(bankStatementsTable.sourceIban, statement.sourceIban!),
        eq(bankStatementsTable.statementNumber, statement.statementNumber!),
        eq(bankStatementsTable.statementDate, statement.statementDate!),
      )),
    )).limit(1);
    if (duplicate) throw new BankDraftError("Ta izpisek je že v evidenci bančnih izpiskov. Ponovni prenos je preprečen.", 409);

    let replacedInvoiceId: string | undefined;
    if (doc.linkedInvoiceId) {
      if (input.replaceDraftInvoice !== true) throw new BankDraftError("Izrecno potrdite zamenjavo napačnega osnutka računa.", 409);
      const [invoice] = await tx.select().from(invoicesTable).where(and(
        eq(invoicesTable.id, doc.linkedInvoiceId), eq(invoicesTable.companyId, companyId),
      )).for("update");
      const [payment] = await tx.select({ id: paymentAllocationsTable.id }).from(paymentAllocationsTable)
        .where(eq(paymentAllocationsTable.invoiceId, doc.linkedInvoiceId)).limit(1);
      if (!invoice || invoice.status !== "draft" || invoice.linkedEntryId || payment) {
        throw new BankDraftError("Račun ima knjižbo, plačilo ali ni več osnutek; samodejna zamenjava ni dovoljena.", 409);
      }
      replacedInvoiceId = invoice.id;
      const notes = `${invoice.notes ?? ""}\nRazveljavljen neknjiženi osnutek: izvor je bančni izpisek, prenesen v bančno temeljnico.`;
      await tx.update(invoicesTable).set({ status: "void", notes }).where(eq(invoicesTable.id, invoice.id));
      await tx.insert(auditLogTable).values({
        companyId, entityType: "invoice", entityId: invoice.id, action: "void", changedBy: actorId,
        payload: { before: { status: invoice.status }, after: { status: "void" }, reason: "scanned_bank_statement_conversion", documentId },
      });
    } else if (doc.status === "confirmed") {
      throw new BankDraftError("Potrjen dokument brez varno zamenljivega osnutka ni dovoljen za ponovni prenos.", 409);
    }
    const [bankStatement] = await tx.insert(bankStatementsTable).values({
      companyId, bankAccountId: bankAccount.id, sourceIban: statement.sourceIban,
      statementNumber: statement.statementNumber, statementDate: statement.statementDate!,
      periodFrom: movements.map(t => t.bookingDate).sort()[0],
      periodTo: movements.map(t => t.bookingDate).sort().at(-1),
      openingBalance: statement.openingBalance!.toFixed(2), closingBalance: statement.closingBalance!.toFixed(2),
      currency: "EUR", sourceFilename: doc.fileName, sourceSha256, createdBy: actorId,
    }).returning();
    await tx.insert(bankStatementLinesTable).values(movements.map((movement, index) => ({
      statementId: bankStatement.id, transactionKey: movement.transactionId, lineNumber: index + 1,
      bookingDate: movement.bookingDate, amount: movement.amount.toFixed(2), currency: "EUR",
      reference: movement.reference, counterpartyName: movement.counterpartyName,
      counterpartyIban: movement.counterpartyIban, description: movement.description,
    })));
    const [entry] = await tx.insert(journalEntriesTable).values({
      companyId, periodId: period.id, documentDate: statement.statementDate,
      entryDate: statement.statementDate!, description: `Bančni izpisek ${statement.statementNumber} – ${statement.sourceIban}`,
      reference: `IZP-${statement.statementNumber}/${statement.statementDate}`,
      status: "draft", sourceType: "bank_import", createdBy: actorId,
    }).returning();
    await tx.insert(journalEntryLinesTable).values(movements.flatMap((movement, index) => {
      const selection = requested.get(movement.transactionId)!;
      const common = { entryId: entry.id, amount: Math.abs(movement.amount).toFixed(2),
        description: `${movement.description} · transakcija ${movement.transactionId}` };
      return [
        { ...common, accountId: bankAccount.id, side: movement.amount > 0 ? "debit" as const : "credit" as const, sequence: index * 2 + 1 },
        { ...common, accountId: selection.counterAccountId, partnerId: selection.counterpartyId,
          side: movement.amount > 0 ? "credit" as const : "debit" as const, sequence: index * 2 + 2 },
      ];
    }));
    const result = { journalEntryId: entry.id, statementId: bankStatement.id,
      ...(replacedInvoiceId ? { replacedInvoiceId } : {}) };
    await tx.update(documentsTable).set({
      status: "confirmed", documentType: "other", confirmedBy: actorLabel,
      linkedInvoiceId: null, sourceDocumentId: null,
      confirmedData: { ...doc.ocrResult!, lines: [], bankStatementDraft: result },
    }).where(eq(documentsTable.id, doc.id));
    await tx.insert(auditLogTable).values([
      { companyId, entityType: "journal_entry", entityId: entry.id, action: "create", changedBy: actorId,
        payload: { source: "scanned_bank_statement", documentId, ...result, status: "draft", transactions: input.transactions } },
      { companyId, entityType: "document", entityId: doc.id, action: "confirm_bank", changedBy: actorId,
        payload: { before: { status: doc.status, documentType: doc.documentType, linkedInvoiceId: doc.linkedInvoiceId }, after: result } },
      { companyId, entityType: "bank_statement", entityId: bankStatement.id, action: "create_scanned_bank_draft", changedBy: actorId,
        payload: { documentId, journalEntryId: entry.id } },
    ]);
    return result;
  });
}
