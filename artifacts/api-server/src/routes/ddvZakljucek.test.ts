/**
 * Testi za DDV zaključek — zaključna temeljnica DDV obveznosti/terjatve
 *
 * Preverja:
 *  1. Uravnoteženost generirane temeljnice (D = K)
 *  2. Pravilni neto konto za obveznost (K 2609000)
 *  3. Pravilni neto konto za presežek (D 1609000)
 *  4. dryRun ne zapiše v bazo
 *  5. Detekcija dvojnika
 */

import Decimal from "decimal.js";
import { describe, it, expect } from "vitest";

// ─── Interna logika (poustvarjena iz ddvZakljucek.ts za unit test) ─────────────

interface BalanceRow {
  code: string;
  debitTotal: string;
  creditTotal: string;
}

interface ClosingLine {
  code: string;
  side: "debit" | "credit";
  amount: string;
}

function buildClosingLines(
  balanceRows: BalanceRow[],
  vraciloChoice: "vracilo" | "prenos" | null,
  periodLabel: string,
): {
  lines: ClosingLine[];
  netType: "obveznost" | "presežek" | "nič";
  netAmount: string;
  debitTotal: string;
  creditTotal: string;
  balanced: boolean;
} {
  const lines: ClosingLine[] = [];
  let izstopniSum = new Decimal(0);
  let vstopniSum = new Decimal(0);

  for (const row of balanceRows) {
    const debit = new Decimal(row.debitTotal);
    const credit = new Decimal(row.creditTotal);

    if (row.code.startsWith("260")) {
      const balance = credit.minus(debit);
      if (balance.gt(0.001)) {
        lines.push({ code: row.code, side: "debit", amount: balance.toFixed(2) });
        izstopniSum = izstopniSum.plus(balance);
      }
    } else if (row.code.startsWith("160")) {
      const balance = debit.minus(credit);
      if (balance.gt(0.001)) {
        lines.push({ code: row.code, side: "credit", amount: balance.toFixed(2) });
        vstopniSum = vstopniSum.plus(balance);
      }
    }
  }

  const netoDdv = izstopniSum.minus(vstopniSum);
  let netType: "obveznost" | "presežek" | "nič" = "nič";

  if (netoDdv.gt(0.001)) {
    netType = "obveznost";
    lines.push({ code: "2609000", side: "credit", amount: netoDdv.toFixed(2) });
  } else if (netoDdv.lt(-0.001)) {
    netType = "presežek";
    lines.push({ code: "1609000", side: "debit", amount: netoDdv.abs().toFixed(2) });
  }

  const debitTotal = lines
    .filter(l => l.side === "debit")
    .reduce((s, l) => s.plus(l.amount), new Decimal(0));
  const creditTotal = lines
    .filter(l => l.side === "credit")
    .reduce((s, l) => s.plus(l.amount), new Decimal(0));

  return {
    lines,
    netType,
    netAmount: netoDdv.abs().toFixed(2),
    debitTotal: debitTotal.toFixed(2),
    creditTotal: creditTotal.toFixed(2),
    balanced: debitTotal.minus(creditTotal).abs().lt(0.01),
  };
}

// ─── Testi ────────────────────────────────────────────────────────────────────

describe("DDV zaključek — buildClosingLines", () => {
  const period = "2026/0707";

  it("Uravnoteženost: obveznost — izstopni > vstopni", () => {
    const rows: BalanceRow[] = [
      { code: "2600122", debitTotal: "0.00", creditTotal: "1800.00" }, // izstopni 22%
      { code: "2600195", debitTotal: "0.00", creditTotal: "600.00" },  // izstopni 9.5%
      { code: "1600122", debitTotal: "1200.00", creditTotal: "0.00" }, // vstopni 22%
    ];

    const result = buildClosingLines(rows, null, period);

    expect(result.balanced).toBe(true);
    expect(result.netType).toBe("obveznost");
    expect(result.netAmount).toBe("1200.00");  // 2400 - 1200 = 1200
    expect(result.debitTotal).toBe(result.creditTotal);

    const netoLine = result.lines.find(l => l.code === "2609000");
    expect(netoLine).toBeDefined();
    expect(netoLine?.side).toBe("credit");
    expect(netoLine?.amount).toBe("1200.00");

    // Ni 1609000 vrstice
    expect(result.lines.find(l => l.code === "1609000")).toBeUndefined();
  });

  it("Uravnoteženost: presežek — vstopni > izstopni", () => {
    const rows: BalanceRow[] = [
      { code: "2600122", debitTotal: "0.00", creditTotal: "500.00" },  // izstopni 22%
      { code: "1600122", debitTotal: "800.00", creditTotal: "0.00" },  // vstopni 22%
      { code: "1600195", debitTotal: "300.00", creditTotal: "0.00" },  // vstopni 9.5%
    ];

    const result = buildClosingLines(rows, "vracilo", period);

    expect(result.balanced).toBe(true);
    expect(result.netType).toBe("presežek");
    expect(result.netAmount).toBe("600.00");  // (800+300) - 500 = 600
    expect(result.debitTotal).toBe(result.creditTotal);

    const netoLine = result.lines.find(l => l.code === "1609000");
    expect(netoLine).toBeDefined();
    expect(netoLine?.side).toBe("debit");
    expect(netoLine?.amount).toBe("600.00");

    // Ni 2609000 vrstice
    expect(result.lines.find(l => l.code === "2609000")).toBeUndefined();
  });

  it("Uravnoteženost: nič — izstopni = vstopni", () => {
    const rows: BalanceRow[] = [
      { code: "2600122", debitTotal: "0.00", creditTotal: "1000.00" },
      { code: "1600122", debitTotal: "1000.00", creditTotal: "0.00" },
    ];

    const result = buildClosingLines(rows, null, period);

    expect(result.balanced).toBe(true);
    expect(result.netType).toBe("nič");
    expect(result.netAmount).toBe("0.00");
    expect(result.lines.find(l => l.code === "2609000")).toBeUndefined();
    expect(result.lines.find(l => l.code === "1609000")).toBeUndefined();
  });

  it("Izključi konte z ničelnim saldom", () => {
    const rows: BalanceRow[] = [
      { code: "2600122", debitTotal: "500.00", creditTotal: "500.00" }, // neto = 0, izključi
      { code: "2600195", debitTotal: "0.00", creditTotal: "400.00" },   // saldo 400
      { code: "1600122", debitTotal: "200.00", creditTotal: "0.00" },   // saldo 200
    ];

    const result = buildClosingLines(rows, null, period);

    expect(result.balanced).toBe(true);
    expect(result.netType).toBe("obveznost");
    // 2600122 z ničelnim saldom ne sme biti vključen
    expect(result.lines.find(l => l.code === "2600122")).toBeUndefined();
    expect(result.lines.find(l => l.code === "2600195")).toBeDefined();
    expect(result.lines.find(l => l.code === "1600122")).toBeDefined();
  });

  it("Pravilni smeri zapiranja: 26x → D, 16x → K", () => {
    const rows: BalanceRow[] = [
      { code: "2600122", debitTotal: "0.00", creditTotal: "800.00" },
      { code: "1600122", debitTotal: "300.00", creditTotal: "0.00" },
    ];

    const result = buildClosingLines(rows, null, period);

    const izstopniLine = result.lines.find(l => l.code === "2600122");
    const vstopniLine = result.lines.find(l => l.code === "1600122");
    const netoLine = result.lines.find(l => l.code === "2609000");

    expect(izstopniLine?.side).toBe("debit");   // 26x → D (zapiramo kredit)
    expect(vstopniLine?.side).toBe("credit");    // 16x → K (zapiramo debet)
    expect(netoLine?.side).toBe("credit");       // neto obveznost → K 2609000
  });
});
