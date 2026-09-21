import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { unconsumedCompletedAttemptPredicate } from "./terminal";

describe("completed card payment replay predicate", () => {
  it("excludes attempts already bound to a receipt or gift issuance", () => {
    const dialect = new PgDialect();
    const query = dialect.sqlToQuery(unconsumedCompletedAttemptPredicate());
    const normalized = query.sql.replace(/\s+/g, " ").toLowerCase();

    expect(normalized).toContain("not exists");
    expect(normalized).toContain("from pos_racun_izdaja_zahteve as izdaja_zahteva");
    expect(normalized).toContain("izdaja_zahteva.card_payment_attempt_id");
    expect(normalized).toContain("from racuni as izdani_racun");
    expect(normalized).toContain("izdani_racun.card_payment_attempt_id");
    expect(normalized).toContain("from darilni_bon_izdaje as izdaja_bona");
    expect(normalized).toContain("izdaja_bona.card_payment_attempt_id");
    expect(normalized).not.toContain('"poskarticnaplacilaattempttable"."card_payment_attempt_id"');
    expect(normalized.match(/not exists/g)).toHaveLength(3);
    expect(normalized.match(/card_payment_attempt_id/g)).toHaveLength(3);
  });
});