import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, bankStatementsTable } from "@workspace/db";

export interface BankStatementBalanceEvidence {
  statementId: string;
  bankAccountId: string;
  balance: string;
  evidenceDate: string;
  statementNumber: string | null;
  sourceIban: string | null;
  currency: string;
}

export async function getLatestBankStatementBalances(
  companyId: string,
  bankAccountIds: string[],
): Promise<Map<string, BankStatementBalanceEvidence>> {
  if (bankAccountIds.length === 0) return new Map();

  const rows = await db
    .select({
      statementId: bankStatementsTable.id,
      bankAccountId: bankStatementsTable.bankAccountId,
      balance: bankStatementsTable.closingBalance,
      evidenceDate: sql<string>`COALESCE(${bankStatementsTable.periodTo}, ${bankStatementsTable.statementDate})`,
      statementNumber: bankStatementsTable.statementNumber,
      sourceIban: bankStatementsTable.sourceIban,
      currency: bankStatementsTable.currency,
    })
    .from(bankStatementsTable)
    .where(and(
      eq(bankStatementsTable.companyId, companyId),
      inArray(bankStatementsTable.bankAccountId, bankAccountIds),
      isNotNull(bankStatementsTable.closingBalance),
    ))
    .orderBy(
      desc(sql`COALESCE(${bankStatementsTable.periodTo}, ${bankStatementsTable.statementDate})`),
      desc(bankStatementsTable.statementDate),
      desc(bankStatementsTable.createdAt),
      desc(bankStatementsTable.id),
    );

  const result = new Map<string, BankStatementBalanceEvidence>();
  for (const row of rows) {
    if (result.has(row.bankAccountId) || row.balance == null) continue;
    result.set(row.bankAccountId, {
      statementId: row.statementId,
      bankAccountId: row.bankAccountId,
      balance: row.balance,
      evidenceDate: row.evidenceDate,
      statementNumber: row.statementNumber,
      sourceIban: row.sourceIban,
      currency: row.currency,
    });
  }
  return result;
}

export async function getLatestBankStatementBalance(
  companyId: string,
  bankAccountId: string,
): Promise<BankStatementBalanceEvidence | null> {
  const balances = await getLatestBankStatementBalances(companyId, [bankAccountId]);
  return balances.get(bankAccountId) ?? null;
}