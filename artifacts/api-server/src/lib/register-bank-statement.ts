import { bankStatementLinesTable, bankStatementsTable, db } from "@workspace/db";

type StatementHeader = typeof bankStatementsTable.$inferInsert;
type StatementLine = Omit<typeof bankStatementLinesTable.$inferInsert, "statementId">;

/** Persist source evidence only; payment reconciliation is a separate operation. */
export async function registerBankStatementEvidence(header: StatementHeader, sourceLines: StatementLine[]) {
  return db.transaction(async function persistStatementSource(tx) {
    const [statement] = await tx.insert(bankStatementsTable).values(header)
      .returning({ id: bankStatementsTable.id });
    const lines = await tx.insert(bankStatementLinesTable).values(
      sourceLines.map(line => ({ ...line, statementId: statement.id })),
    ).returning({ id: bankStatementLinesTable.id, transactionKey: bankStatementLinesTable.transactionKey });
    return {
      statementId: statement.id,
      lineIds: Object.fromEntries(lines.map(line => [line.transactionKey, line.id])),
    };
  });
}
