import { describe, expect, it } from "vitest";
import {
  defaultCostCenterPolicy,
  requiresCostCenterForPolicy,
} from "./accountCostCenterPolicy";

describe("accountCostCenterPolicy", () => {
  it.each([
    ["040", "allowed"],
    ["1000", "not_allowed"],
    ["220", "not_allowed"],
    ["400", "required"],
    ["760", "allowed"],
    ["900", "not_allowed"],
    ["500", "allowed"],
  ] as const)("za konto %s določi privzeto politiko %s", (code, expected) => {
    expect(defaultCostCenterPolicy(code)).toBe(expected);
  });

  it("ohrani staro zahtevo kot obvezno ne glede na razred", () => {
    expect(defaultCostCenterPolicy("220", true)).toBe("required");
  });

  it("združljivostni boolean izpelje samo iz obvezne politike", () => {
    expect(requiresCostCenterForPolicy("required")).toBe(true);
    expect(requiresCostCenterForPolicy("allowed")).toBe(false);
    expect(requiresCostCenterForPolicy("not_allowed")).toBe(false);
  });
});