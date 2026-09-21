import { describe, expect, it } from "vitest";

import {
  DEFAULT_NEW_PURCHASE_ARTICLE_TYPE,
  DEFAULT_NEW_SALES_ARTICLE_TYPE,
} from "./article-type-defaults";

describe("privzeta vrsta novega prodajnega artikla", () => {
  it("je storitev", () => {
    expect(DEFAULT_NEW_SALES_ARTICLE_TYPE).toBe("storitev");
  });
});

describe("privzeta vrsta novega nabavnega artikla", () => {
  it("je material", () => {
    expect(DEFAULT_NEW_PURCHASE_ARTICLE_TYPE).toBe("material");
  });
});