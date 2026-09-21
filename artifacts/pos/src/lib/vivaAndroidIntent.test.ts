import { describe, expect, it } from "vitest";
import {
  BOOKIE_VIVA_CLIENT_APP_ID,
  buildBookieVivaBridgeCallbackUrl,
  buildBookieVivaBridgeLaunchUrl,
  buildVivaAndroidSaleIntent,
  getVivaCallbackNarociloId,
  isVivaAndroidSaleCallback,
  parseVivaAndroidSaleCallback,
  VIVA_TERMINAL_DEMO_PACKAGE,
  VIVA_TERMINAL_PRODUCTION_PACKAGE,
} from "./vivaAndroidIntent";

function parseIntentUrl(intentUrl: string) {
  const [intentPart] = intentUrl.split("#Intent;");
  return new URL(intentPart.replace("intent://", "vivapayclient://"));
}

describe("Viva Android sale intent", () => {
  it("iz callback URL takoj razbere naročilo za neposredno nalaganje", () => {
    expect(getVivaCallbackNarociloId("narocilo=42&vivaTapToPay=1&status=success")).toBe(42);
    expect(getVivaCallbackNarociloId("narocilo=7&vivaAndroid=1")).toBe(7);
    expect(getVivaCallbackNarociloId("narocilo=42")).toBeNull();
    expect(getVivaCallbackNarociloId("narocilo=abc&vivaTapToPay=1")).toBeNull();
  });

  it("sestavi demo Tap to Pay sale intent z uradnimi CardPresent parametri", () => {
    const intentUrl = buildVivaAndroidSaleIntent({
      amountCents: 1234,
      clientTransactionId: "tap-transaction-1",
      callbackUrl: "https://pos.example.test/pos/blagajna?narocilo=42&vivaTapToPay=1",
      sourceCode: "1234",
      demo: true,
    });
    const uri = parseIntentUrl(intentUrl);

    expect(uri.toString()).toContain("vivapayclient://pay/v1?");
    expect(Object.fromEntries(uri.searchParams)).toMatchObject({
      appId: BOOKIE_VIVA_CLIENT_APP_ID,
      action: "sale",
      clientTransactionId: "tap-transaction-1",
      amount: "1234",
      paymentMethod: "CardPresent",
      show_receipt: "true",
      show_transaction_result: "true",
      show_rating: "false",
      callback: "https://pos.example.test/pos/blagajna?narocilo=42&vivaTapToPay=1",
      sourceCode: "1234",
    });
    expect(intentUrl).toContain(`scheme=vivapayclient;package=${VIVA_TERMINAL_DEMO_PACKAGE};`);
    expect(intentUrl).toContain("S.browser_fallback_url=https%3A%2F%2Fwww.vivawallet.com%2F");
    expect(uri.searchParams.get("merchantReference")).toBeNull();
  });

  it("sestavi produkcijski Android Terminal intent z istim sale protokolom", () => {
    const intentUrl = buildVivaAndroidSaleIntent({
      amountCents: 99,
      clientTransactionId: "terminal-transaction-1",
      callbackUrl: "https://pos.example.test/pos/blagajna?narocilo=7&vivaAndroid=1",
      demo: false,
    });
    const uri = parseIntentUrl(intentUrl);

    expect(uri.toString()).toContain("vivapayclient://pay/v1?");
    expect(uri.searchParams.get("action")).toBe("sale");
    expect(uri.searchParams.get("amount")).toBe("99");
    expect(uri.searchParams.get("paymentMethod")).toBe("CardPresent");
    expect(uri.searchParams.get("sourceCode")).toBeNull();
    expect(intentUrl).toContain(`scheme=vivapayclient;package=${VIVA_TERMINAL_PRODUCTION_PACKAGE};`);
  });

  it("zavrne neštevilčni sourceCode", () => {
    expect(() => buildVivaAndroidSaleIntent({
      amountCents: 100,
      clientTransactionId: "terminal-transaction-2",
      callbackUrl: "bookie-viva-bridge://result/state",
      sourceCode: "POS 1",
      demo: true,
    })).toThrow("Viva sourceCode mora biti številčna koda.");
  });

  it("sprejme uradni Viva callback status=success in stari vivaResult=ok", () => {
    expect(parseVivaAndroidSaleCallback(new URLSearchParams({
      status: "success",
      transactionId: "official-transaction",
    }))).toEqual({
      kind: "approved",
      transactionId: "official-transaction",
    });
    expect(parseVivaAndroidSaleCallback(new URLSearchParams({
      vivaResult: "ok",
      transactionId: "legacy-transaction",
    }))).toEqual({
      kind: "approved",
      transactionId: "legacy-transaction",
    });
  });

  it("prepozna callback tudi ko Viva prepiše naš URL-marker", () => {
    const params = new URLSearchParams({
      status: "success",
      transactionId: "official-transaction",
      clientTransactionId: "client-transaction",
    });

    expect(isVivaAndroidSaleCallback(params, "vivaTapToPay", true)).toBe(true);
    expect(isVivaAndroidSaleCallback(params, "vivaTapToPay", false)).toBe(false);
  });

  it("v callback vgradi stanje za native Bookie bridge brez občutljivih podatkov", () => {
    const callback = buildBookieVivaBridgeCallbackUrl(
      "https://bookie.example.test/pos/blagajna?narocilo=42&vivaTapToPay=1",
      "attempt-123",
    );

    expect(callback).toMatch(/^bookie-viva-bridge:\/\/result\/[A-Za-z0-9_-]+$/);
    expect(callback).not.toContain("bookie.example.test");
    expect(callback).not.toContain("attempt-123");
  });

  it("Viva intent zažene prek native bridgea", () => {
    const callback = buildBookieVivaBridgeCallbackUrl(
      "https://bookie-erp.replit.app/pos/blagajna?vivaTapToPay=1",
      "attempt-123",
    );
    const viva = buildVivaAndroidSaleIntent({
      amountCents: 1234,
      clientTransactionId: "attempt-123",
      callbackUrl: callback,
      demo: true,
    });
    const launch = buildBookieVivaBridgeLaunchUrl(viva, callback);

    expect(launch).toMatch(/^bookie-viva-bridge:\/\/pay\//);
    expect(new URL(launch).searchParams.get("target")).toBe(viva);
  });
});