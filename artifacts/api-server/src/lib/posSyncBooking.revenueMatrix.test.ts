import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";

import { getCategoryRevenueAccount, getRevenueAccount } from "./posSyncBooking";

const settings = {
  revenueMaterial22AccountId: "material-22",
  revenueMaterial95AccountId: "material-95",
  revenueMaterial5AccountId: "material-5",
  revenueGoods22AccountId: "goods-22",
  revenueGoods95AccountId: "goods-95",
  revenueGoods5AccountId: "goods-5",
  revenueService22AccountId: "service-22",
  revenueService95AccountId: "service-95",
  revenueService5AccountId: "service-5",
  revenueAccountId: "unknown-fallback",
};

describe("POS prihodkovna matrika", () => {
  it.each([
    ["material", 22, "material-22"],
    ["material", 9.5, "material-95"],
    ["material", 5, "material-5"],
    ["blago", 22, "goods-22"],
    ["blago", 9.5, "goods-95"],
    ["blago", 5, "goods-5"],
    ["storitev", 22, "service-22"],
    ["storitev", 9.5, "service-95"],
    ["storitev", 5, "service-5"],
  ] as const)("za %s pri %s %% uporabi ločen konto", (vrsta, stopnja, accountId) => {
    expect(getRevenueAccount(vrsta, new Decimal(stopnja), settings)).toBe(accountId);
  });

  it("gostinske storitve in zaprte steklenice knjiži na pravilne konte", () => {
    const gostinskaNastavitev = {
      ...settings,
      revenueService95AccountId: "7601200",
      revenueService22AccountId: "7601100",
      revenueGoods22AccountId: "7620100",
    };

    expect(getRevenueAccount("storitev", new Decimal(9.5), gostinskaNastavitev)).toBe("7601200");
    expect(getRevenueAccount("storitev", new Decimal(22), gostinskaNastavitev)).toBe("7601100");
    expect(getRevenueAccount("blago", new Decimal(22), gostinskaNastavitev)).toBe("7620100");
  });

  it("uporabi splošni fallback samo za neznano kombinacijo", () => {
    expect(getRevenueAccount("neznano", new Decimal(22), settings)).toBe("unknown-fallback");
    expect(getRevenueAccount("storitev", new Decimal(5), {
      ...settings,
      revenueService5AccountId: null,
    })).toBeNull();
  });

  it("kategorijska preslikava ima prednost pred splošnim in starim matričnim kontom", () => {
    expect(getCategoryRevenueAccount(
      42,
      "storitev",
      new Decimal(22),
      settings,
      new Map([[42, "category-42"]]),
    )).toBe("category-42");
  });

  it("kategorija brez preslikave uporabi splošni prihodkovni konto", () => {
    expect(getCategoryRevenueAccount(
      42,
      "storitev",
      new Decimal(22),
      settings,
      new Map(),
    )).toBe("unknown-fallback");
  });

  it.each([null, 42])(
    "postavka s kategorijo %s brez preslikave in splošnega konta ohrani staro prihodkovno matriko",
    (kategorijaId) => {
    expect(getCategoryRevenueAccount(
      kategorijaId,
      "storitev",
      new Decimal(22),
      { ...settings, revenueAccountId: null },
      new Map(),
    )).toBe("service-22");
    },
  );
});