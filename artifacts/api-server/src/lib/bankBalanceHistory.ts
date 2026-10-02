export interface BalanceEvidence {
  bankAccountId: string;
  evidenceDate: string;
  balance: string;
}

// Rows must be sorted by evidence date, statement date, creation time and ID
// (oldest first). Later imports for the same evidence day supersede earlier ones.
export function buildBankBalanceHistory(
  accountIds: string[],
  evidence: BalanceEvidence[],
  dateFrom: string,
  dateTo: string,
): Array<{ date: string; balance: string }> {
  if (accountIds.length === 0 || evidence.length === 0) return [];

  const lastEvidenceDate = evidence[evidence.length - 1].evidenceDate;
  const end = lastEvidenceDate < dateTo ? lastEvidenceDate : dateTo;
  const balances = new Map<string, number>();
  const points: Array<{ date: string; balance: string }> = [];
  let cursor = 0;

  for (
    let day = Date.parse(`${dateFrom}T00:00:00Z`);
    day <= Date.parse(`${end}T00:00:00Z`);
    day += 86_400_000
  ) {
    const date = new Date(day).toISOString().slice(0, 10);
    while (cursor < evidence.length && evidence[cursor].evidenceDate <= date) {
      const row = evidence[cursor++];
      balances.set(row.bankAccountId, Math.round(Number(row.balance) * 100));
    }
    if (accountIds.every(id => balances.has(id))) {
      const cents = accountIds.reduce((sum, id) => sum + balances.get(id)!, 0);
      points.push({ date, balance: (cents / 100).toFixed(2) });
    }
  }
  return points;
}