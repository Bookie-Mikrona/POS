import { describe, expect, it } from "vitest";
import {
  calculateTheoreticalCashBalance,
  cashMovementLines,
  reverseCashMovementLines,
} from "./cashMovementAccounting";

const accounts = {
  cashAccountId: "100",
  payablesAccountId: "220",
  cashInTransitAccountId: "109",
  bankAccountId: "110",
};

describe("cashMovementAccounting", () => {
  it("knjiži izplačilo dobavitelju D 220 / K 100", () => {
    expect(cashMovementLines("IZPLACILO_DOBAVITELJU", accounts, "supplier")).toEqual([
      { accountId: "220", side: "debit", partnerId: "supplier" },
      { accountId: "100", side: "credit", partnerId: "supplier" },
    ]);
  });

  it("vse blagajniške prenose vodi prek 109", () => {
    expect(cashMovementLines("POLOG_GOTOVINE", accounts)).toEqual([
      { accountId: "100", side: "debit" },
      { accountId: "109", side: "credit" },
    ]);
    expect(cashMovementLines("DVIG_GOTOVINE", accounts)).toEqual([
      { accountId: "109", side: "debit" },
      { accountId: "110", side: "credit" },
    ]);
    expect(cashMovementLines("POLOG_TRR", accounts)).toEqual([
      { accountId: "109", side: "debit" },
      { accountId: "100", side: "credit" },
    ]);
  });

  it("storno obrne strani in saldo ne obravnava prenosa kot prihodek", () => {
    expect(reverseCashMovementLines(cashMovementLines("POLOG_TRR", accounts))).toEqual([
      { accountId: "109", side: "credit" },
      { accountId: "100", side: "debit" },
    ]);
    expect(calculateTheoreticalCashBalance({
      menjalniDenar: 50,
      gotovinskaProdaja: 360,
      pologiGotovine: 0,
      izplacilaDobaviteljem: 40,
      dvigiGotovine: 999,
      pologiTrr: 200,
    })).toBe(170);
  });
});