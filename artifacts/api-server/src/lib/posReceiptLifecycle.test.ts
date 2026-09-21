import { describe, expect, it } from "vitest";
import {
  assertPosReceiptCanBeConfirmed,
  PosReceiptNotReady,
} from "./posReceiptLifecycle";

describe("življenjski cikel POS prejemnice", () => {
  it("dovoli potrditev popolnega osnutka", () => {
    expect(() => assertPosReceiptCanBeConfirmed("draft", [{ articleId: 10 }, { articleId: 11 }])).not.toThrow();
  });

  it("zavrne osnutek brez postavk ali z neuparjeno postavko", () => {
    expect(() => assertPosReceiptCanBeConfirmed("draft", [])).toThrow(PosReceiptNotReady);
    expect(() => assertPosReceiptCanBeConfirmed("draft", [{ articleId: 10 }, { articleId: null }])).toThrow(
      "Pred potrditvijo je treba upariti vse postavke prejemnice.",
    );
  });

  it("dovoli neposredni strošek brez artikla", () => {
    expect(() => assertPosReceiptCanBeConfirmed("draft", [
      { articleId: null, lineType: "poraba_surovin" },
      { articleId: null, lineType: "prevoz" },
    ])).not.toThrow();
  });

  it("ponovna potrditev že potrjene prejemnice ostane idempotentna", () => {
    expect(() => assertPosReceiptCanBeConfirmed("confirmed", [])).not.toThrow();
  });
});