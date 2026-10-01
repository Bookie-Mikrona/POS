import { describe, expect, it, vi } from "vitest";
import {
  assertRequestedInvoiceDate,
  assertValidRateDate,
  clearEcbUsdEurQuoteCacheForTests,
  convertDocumentAmounts,
  DocumentExchangeRateError,
  getEcbUsdEurQuote,
  sloveniaDateString,
} from "./documentExchangeRate";

describe("document exchange rate conversion", () => {
  it("converts USD amounts to EUR independently and preserves source quantities and VAT rates", () => {
    const result = convertDocumentAmounts(
      [{
        quantity: 2,
        unitPrice: 55,
        vatRate: 22,
        vatBase: 110,
        vatAmount: 24.2,
      }],
      { net: 110, vat: 24.2, gross: 134.2 },
      1.1,
    );

    expect(result.convertedLines).toEqual([{
      quantity: 2,
      unitPrice: 50,
      vatRate: 22,
      vatBase: 100,
      vatAmount: 22,
    }]);
    expect(result.eurTotals).toEqual({ net: 100, vat: 22, gross: 122 });
    expect(result.sourceTotals).toEqual({ net: 110, vat: 24.2, gross: 134.2 });
    expect(result.roundingDifference).toBe(0);
  });

  it("rounds net and tax for each converted line independently and reports the aggregate rounding difference", () => {
    const result = convertDocumentAmounts(
      [
        { quantity: 1, unitPrice: 0.01, vatRate: 100, vatBase: 0.01, vatAmount: 0.01 },
        { quantity: 1, unitPrice: 0.01, vatRate: 100, vatBase: 0.01, vatAmount: 0.01 },
      ],
      { net: 0.02, vat: 0.02, gross: 0.04 },
      1.5,
    );

    expect(result.convertedLines.map(({ unitPrice, vatBase, vatAmount }) => ({ unitPrice, vatBase, vatAmount })))
      .toEqual([{ unitPrice: 0.0067, vatBase: 0.01, vatAmount: 0.01 }, { unitPrice: 0.0067, vatBase: 0.01, vatAmount: 0.01 }]);
    expect(result.eurTotals).toEqual({ net: 0.02, vat: 0.02, gross: 0.04 });
    expect(result.roundingDifference).toBe(0.01);
  });

  it("uses exact decimal division and half-away-from-zero rounding for positive and negative half cents", () => {
    const positive = convertDocumentAmounts(
      [{ quantity: 1, unitPrice: 0.87, vatRate: 0, vatBase: 0.87, vatAmount: 0 }],
      { net: 0.87, vat: 0, gross: 0.87 },
      1.2,
    );
    expect(positive.convertedLines[0].vatBase).toBe(0.73);

    const halfCent = convertDocumentAmounts(
      [{ quantity: 1, unitPrice: 0.29, vatRate: 0, vatBase: 0.29, vatAmount: 0 }],
      { net: 0.29, vat: 0, gross: 0.29 },
      2,
    );
    expect(halfCent.convertedLines[0].vatBase).toBe(0.15);

    const negative = convertDocumentAmounts(
      [{ quantity: 1, unitPrice: -0.87, vatRate: 0, vatBase: -0.87, vatAmount: 0 }],
      { net: -0.87, vat: 0, gross: -0.87 },
      1.2,
    );
    expect(negative.convertedLines[0].vatBase).toBe(-0.73);
  });

  it("converts typical four-decimal ECB rates with exact net/tax rounding", () => {
    const result = convertDocumentAmounts(
      [{ quantity: 1, unitPrice: 122, vatRate: 22, vatBase: 100, vatAmount: 22 }],
      { net: 100, vat: 22, gross: 122 },
      1.1723,
    );
    expect(result.convertedLines[0]).toEqual({
      quantity: 1,
      unitPrice: 104.0689,
      vatRate: 22,
      vatBase: 85.3,
      vatAmount: 18.77,
    });
    expect(result.eurTotals).toEqual({ net: 85.3, vat: 18.77, gross: 104.07 });
  });

  it("rejects zero, non-finite, and malformed source rates and does not silently lose unmatched OCR totals", () => {
    const lines = [{ quantity: 1, unitPrice: 10, vatRate: 22, vatBase: 10, vatAmount: 2.2 }];
    expect(() => convertDocumentAmounts(lines, { net: 10, vat: 2.2, gross: 12.2 }, 0))
      .toThrowError(DocumentExchangeRateError);
    expect(() => convertDocumentAmounts(lines, { net: 11, vat: 2.2, gross: 13.2 }, 1.1))
      .toThrowError(/se ne ujemajo/);
    expect(() => convertDocumentAmounts(lines, { net: 10, vat: 2.2, gross: 12.1 }, 1.1))
      .toThrowError(/se ne ujemajo/);
  });
});

describe("ECB USD/EUR quote provider", () => {
  it("selects the latest available daily rate before a weekend invoice date within the bounded lookback", async () => {
    clearEcbUsdEurQuoteCacheForTests();
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("startPeriod")).toBe("2026-01-01");
      expect(url.searchParams.get("endPeriod")).toBe("2026-01-11");
      expect(url.searchParams.get("format")).toBe("csvdata");
      return new Response(
        'KEY,FREQ,CURRENCY,CURRENCY_DENOM,COMMENT,TIME_PERIOD,OBS_VALUE\n' +
        'EXR.D.USD.EUR.SP00.A,D,USD,EUR,"reference, daily",2026-01-09,1.1700\n',
        { status: 200, headers: { "content-type": "text/csv" } },
      );
    });

    const quote = await getEcbUsdEurQuote("2026-01-11", {
      now: new Date("2026-01-12T00:00:00Z"),
      fetcher: fetcher as typeof fetch,
    });
    expect(quote).toMatchObject({ rateDate: "2026-01-09", unitsPerEur: 1.17, source: "ECB" });
    expect(quote.sourceUrl).toContain("data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("caches successful public ECB quotes briefly", async () => {
    clearEcbUsdEurQuoteCacheForTests();
    const fetcher = vi.fn(async () => new Response(
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,2026-01-09,1.1700\n",
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetcher);
    try {
      await getEcbUsdEurQuote("2026-01-11", { now: new Date("2026-01-12T00:00:00Z") });
      await getEcbUsdEurQuote("2026-01-11", { now: new Date("2026-01-12T00:00:00Z") });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      clearEcbUsdEurQuoteCacheForTests();
    }
  });

  it.each(["0x10", "0b10", "0o10", "1e3", "Infinity", "NaN", "1.2.3"])(
    "rejects non-decimal ECB observation %s",
    async (observation) => {
      const fetcher = async () => new Response(
        `KEY,FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,2026-01-09,${observation}\n`,
        { status: 200 },
      );
      await expect(getEcbUsdEurQuote("2026-01-11", {
        now: new Date("2026-01-12T00:00:00Z"),
        fetcher: fetcher as typeof fetch,
      })).rejects.toMatchObject({ code: "ECB_INVALID_RESPONSE", status: 502 });
    },
  );

  it("returns actionable failures for provider errors and no rate in the bounded window", async () => {
    const unavailable = async () => new Response("offline", { status: 503 });
    await expect(getEcbUsdEurQuote("2026-01-11", {
      now: new Date("2026-01-12T00:00:00Z"),
      fetcher: unavailable as typeof fetch,
    })).rejects.toMatchObject({ code: "ECB_HTTP_ERROR", status: 503 });

    const noRate = async () => new Response(
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\n",
      { status: 200 },
    );
    await expect(getEcbUsdEurQuote("2026-01-11", {
      now: new Date("2026-01-12T00:00:00Z"),
      fetcher: noRate as typeof fetch,
    })).rejects.toMatchObject({ code: "ECB_RATE_NOT_AVAILABLE", status: 503 });
  });

  it("times out a stalled ECB request", async () => {
    vi.useFakeTimers();
    try {
      const stalled = (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      const pending = getEcbUsdEurQuote("2026-01-11", {
        now: new Date("2026-01-12T00:00:00Z"),
        fetcher: stalled as typeof fetch,
      });
      const rejection = expect(pending).rejects.toMatchObject({ code: "ECB_TIMEOUT", status: 503 });
      await vi.advanceTimersByTimeAsync(4_001);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects invalid, future, and out-of-range dates", () => {
    expect(() => assertRequestedInvoiceDate("2026-02-30", "2026-03-01"))
      .toThrowError(/ISO/);
    expect(() => assertRequestedInvoiceDate("2026-03-02", "2026-03-01"))
      .toThrowError(/prihodnosti/);
    expect(() => assertValidRateDate("2026-03-02", "2026-03-01", "2026-03-01"))
      .toThrowError(/računa/);
  });

  it("validates invoice dates against the current Slovenia calendar day rather than UTC day", () => {
    const justAfterMidnightInSlovenia = new Date("2026-09-30T22:30:00.000Z");
    const localToday = sloveniaDateString(justAfterMidnightInSlovenia);
    expect(localToday).toBe("2026-10-01");
    expect(() => assertRequestedInvoiceDate("2026-10-01", localToday)).not.toThrow();
    expect(() => assertRequestedInvoiceDate("2026-10-02", localToday))
      .toThrowError(/prihodnosti/);
  });

  it("rejects non-USD/EUR data and mismatched series keys from ECB", async () => {
    const wrongCurrency = async () => new Response(
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\nEXR.D.GBP.EUR.SP00.A,D,GBP,EUR,2026-01-09,1.1700\n",
      { status: 200 },
    );
    await expect(getEcbUsdEurQuote("2026-01-11", {
      now: new Date("2026-01-12T00:00:00Z"),
      fetcher: wrongCurrency as typeof fetch,
    })).rejects.toMatchObject({ code: "ECB_WRONG_SERIES", status: 502 });

    const wrongPair = async () => new Response(
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\nEXR.D.USD.GBP.SP00.A,D,USD,GBP,2026-01-09,1.1700\n",
      { status: 200 },
    );
    await expect(getEcbUsdEurQuote("2026-01-11", {
      now: new Date("2026-01-12T00:00:00Z"),
      fetcher: wrongPair as typeof fetch,
    })).rejects.toMatchObject({ code: "ECB_WRONG_SERIES", status: 502 });
  });
});