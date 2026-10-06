import { createHash } from "node:crypto";

export const HISTORICAL_PAYMENT_ACTOR = "bookie-old-payment-import";
export function cents(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error(`Neveljaven pozitiven znesek: ${value}`);
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}
export function paymentId(companyId, lineId) {
  const h = createHash("sha256").update(`bookie-old-payment:${companyId}:${lineId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Derive read-only payment records from exact, existing bank vouchers.
 * Never treat the net statement movement as several individual bank lines.
 * Never manufacture allocations: original closing evidence remains authoritative.
 */
export function planHistoricalPayments(rows, statementLines, companyId) {
  const groups = new Map();
  for (const row of rows) {
    if (row.company_id !== companyId) throw new Error("Tuja temeljnica");
    const group = groups.get(row.entry_id) ?? [];
    group.push(row);
    groups.set(row.entry_id, group);
  }
  const payments = [], skipped = [];
  for (const [entryId, group] of groups) {
    const head = group[0];
    const bank = group.filter(row => /^(110|111)/.test(row.account_code));
    const other = group.filter(row => !bank.includes(row));
    const bankIds = new Set(bank.map(row => row.account_id));
    const sum = (list, side) => list.filter(row => row.side === side).reduce((n, row) => n + cents(row.amount), 0n);
    if (!["posted", "draft"].includes(head.status) || head.created_by !== "bookie-old-k2-import"
      || !/^BOOKIE-OLD\/K2\/\d{4}\/10\/\d{6}$/.test(head.reference)
      || !head.statement_id || bankIds.size !== 1
      || bank[0]?.account_id !== head.statement_bank_account_id
      || group.some(row => !["debit", "credit"].includes(row.side))
      || sum(bank, "debit") !== sum(other, "credit")
      || sum(bank, "credit") !== sum(other, "debit")) {
      skipped.push({ entryId, reference: head.reference, reason: "Ni nedvoumnega bančnega toka po obeh straneh knjižbe." });
      continue;
    }
    const eligible = other.filter(row => row.partner_id && cents(row.amount) > 0n
      && /\[Bookie Old GLAVNA #\d+/.test(row.description ?? ""));
    const sourceLines = statementLines.filter(line => line.statement_id === head.statement_id);
    for (const row of eligible) {
      const direction = row.side === "credit" ? "inbound" : "outbound";
      if (sum(bank, direction === "inbound" ? "debit" : "credit") === 0n) continue;
      // Attach a bank line only for a proved one-to-one source relationship.
      const line = eligible.length === 1 && sourceLines.length === 1 ? sourceLines[0] : null;
      const signedAmount = `${direction === "outbound" ? "-" : ""}${row.amount}`;
      const bankLineId = line && line.amount === signedAmount
        && line.booking_date === head.statement_date ? line.id : null;
      payments.push({
        id: paymentId(companyId, row.line_id), company_id: companyId,
        counterparty_id: row.partner_id, period_id: head.period_id, direction,
        payment_date: head.statement_date, amount: row.amount,
        reference: `${head.reference}/GL/${row.source_line_id}`,
        bank_account_id: bank[0].account_id, ar_ap_account_id: row.account_id,
        status: head.status, linked_entry_id: entryId, bank_statement_line_id: bankLineId,
        notes: `Zgodovinsko plačilo iz Bookie Old, evidentirano po obstoječi GK (${head.status === "draft" ? "osnutek" : "knjiženo"}). Brez novega knjiženja ali zapiranja.\nIzvor: ${row.description}\n[bookie-old-line:${row.line_id};statement:${head.statement_id}]`,
        created_by: HISTORICAL_PAYMENT_ACTOR,
      });
    }
  }
  return { payments, skipped };
}
