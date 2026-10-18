import { registerBankStatementEvidence } from "./register-bank-statement";
import type { BankTransaction } from "../routes/bankStatements";

interface StatementRegistration {
  companyId: string;
  bankAccountId: string;
  createdBy: string;
  sourceFilename: string;
  sourceSha256: string;
  transactions: BankTransaction[];
  metadata?: {
    sourceIban?: string | null;
    statementNumber?: string | null;
    statementDate?: string | null;
    periodFrom?: string | null;
    periodTo?: string | null;
    openingBalance?: string | number | null;
    closingBalance?: string | number | null;
    currency?: string | null;
  } | null;
}

// Evidence registration must never create, reconcile, or post payments.
export async function persistBankStatement(input: StatementRegistration) {
  const { companyId, bankAccountId, createdBy, sourceFilename, sourceSha256, transactions, metadata } = input;
  const dates = transactions.map(item => item.date).sort();
  const lastDate = dates.at(-1);
  if (!lastDate) throw new Error("Bančni izpisek potrebuje vsaj eno transakcijo z datumom.");
  return registerBankStatementEvidence({
      companyId,
      bankAccountId,
      sourceIban: metadata?.sourceIban ?? null,
      statementNumber: metadata?.statementNumber ?? null,
      statementDate: metadata?.statementDate ?? lastDate,
      periodFrom: metadata?.periodFrom ?? dates[0],
      periodTo: metadata?.periodTo ?? lastDate,
      openingBalance: metadata?.openingBalance == null ? null : String(metadata.openingBalance),
      closingBalance: metadata?.closingBalance == null ? null : String(metadata.closingBalance),
      currency: metadata?.currency ?? transactions[0]?.currency ?? "EUR",
      sourceFilename,
      sourceSha256,
      createdBy,
    },
      transactions.map((item, index) => ({
        transactionKey: item.id,
        lineNumber: index + 1,
        bookingDate: item.date,
        amount: String(item.amount),
        currency: item.currency,
        reference: item.reference,
        counterpartyName: item.counterpartyName,
        counterpartyIban: item.counterpartyIban,
        description: item.description,
      })),
    );
}
