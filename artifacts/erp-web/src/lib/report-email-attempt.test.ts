import { describe, expect, it } from "vitest";
import { createReportEmailAttempt } from "./report-email-attempt";

describe("email export attempt keys", () => {
  const payload = { companyId: "company-a", reportType: "balance-sheet", email: "a@example.test", asOf: "2026-01-01" };
  it("retains the key after network failure and parameter order changes", () => {
    const attempt = createReportEmailAttempt();
    const first = attempt.keyFor(payload);
    expect(attempt.keyFor({ asOf: payload.asOf, companyId: payload.companyId,
      email: payload.email, reportType: payload.reportType, compareAsOf: undefined })).toBe(first);
  });
  it("creates new keys for changed company, recipient or parameters", () => {
    for (const changes of [{ companyId: "b" }, { email: "b@example.test" }, { asOf: "2026-02-01" }]) {
      const attempt = createReportEmailAttempt();
      expect(attempt.keyFor({ ...payload, ...changes })).not.toBe(attempt.keyFor(payload));
    }
  });
  it("uses a fresh key for an explicit new export, even with identical content", () => {
    const attempt = createReportEmailAttempt();
    const first = attempt.keyFor(payload);
    attempt.reset();
    expect(attempt.keyFor(payload)).not.toBe(first);
  });
});
