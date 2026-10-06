import { test } from "node:test";
import assert from "node:assert/strict";
import { cents, planHistoricalPayments } from "./bookie-old-payment-plan.mjs";

const base = { company_id: "company", entry_id: "entry", period_id: "period",
  reference: "BOOKIE-OLD/K2/2025/10/000001", status: "posted",
  created_by: "bookie-old-k2-import", statement_id: "statement",
  statement_bank_account_id: "bank", statement_date: "2025-01-02" };
const bank = { ...base, line_id: "bank-line", account_id: "bank", account_code: "1100000",
  amount: "150.00", side: "debit" };
const partner = { ...base, line_id: "partner-line", account_id: "ar", account_code: "1200000",
  amount: "150.00", side: "credit", partner_id: "partner", source_line_id: "42",
  description: "Plačilo [Bookie Old GLAVNA #42, konto 1200000]" };
const statementLine = { id: "source-bank-line", statement_id: "statement", amount: "150.00", booking_date: "2025-01-02" };

test("one proven receipt reuses the journal and the matching bank line", () => {
  const result = planHistoricalPayments([bank, partner], [statementLine], "company");
  assert.equal(result.payments.length, 1);
  assert.equal(result.payments[0].bank_statement_line_id, "source-bank-line");
  assert.equal(result.payments[0].linked_entry_id, "entry");
  assert.equal(result.payments[0].status, "posted");
  assert.deepEqual(result, planHistoricalPayments([bank, partner], [statementLine], "company"));
});
test("multiple receipts never reuse an aggregate net bank line", () => {
  const result = planHistoricalPayments([bank, { ...partner, amount: "100.00" },
    { ...partner, line_id: "second", source_line_id: "43", amount: "50.00" }], [statementLine], "company");
  assert.equal(result.payments.length, 2);
  assert.ok(result.payments.every(row => row.bank_statement_line_id === null));
  assert.notEqual(result.payments[0].id, result.payments[1].id);
});
test("outbound direction uses the actual debit partner line, not account class", () => {
  const result = planHistoricalPayments([{ ...bank, side: "credit" },
    { ...partner, account_code: "2300001", side: "debit" }],
  [{ ...statementLine, amount: "-150.00" }], "company");
  assert.equal(result.payments[0].direction, "outbound");
});
test("ambiguous offsets, missing statements, foreign tenants and unsupported statuses are rejected", () => {
  assert.equal(planHistoricalPayments([bank, { ...partner, amount: "200.00" }], [], "company").payments.length, 0);
  for (const patch of [{ statement_id: null }, { status: "reversed" }, { statement_bank_account_id: "other" }]) {
    assert.equal(planHistoricalPayments([ { ...bank, ...patch }, { ...partner, ...patch } ], [], "company").payments.length, 0);
  }
  assert.throws(() => planHistoricalPayments([{ ...bank, company_id: "foreign" }], [], "company"));
});
test("historical draft stays draft without posting its voucher", () => {
  const result = planHistoricalPayments([{ ...bank, status: "draft" }, { ...partner, status: "draft" }], [], "company");
  assert.equal(result.payments[0].status, "draft");
});
test("no synthetic partners, allocations or floating point amounts", () => {
  assert.equal(planHistoricalPayments([bank, { ...partner, partner_id: null }], [], "company").payments.length, 0);
  assert.equal(cents("9999999999999999.99"), 999999999999999999n);
  assert.throws(() => cents("-1.00"));
  assert.ok(!("allocations" in planHistoricalPayments([bank, partner], [], "company").payments[0]));
});
