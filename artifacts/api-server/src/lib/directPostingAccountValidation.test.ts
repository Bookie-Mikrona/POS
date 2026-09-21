import { describe, expect, it } from "vitest";
import { validateDirectPostingAccounts } from "./directPostingAccountValidation";

const account = (overrides: Partial<{
  id: string;
  code: string;
  isActive: boolean;
  allowsPosting: boolean;
}> = {}) => ({
  id: "account-1",
  code: "4000",
  isActive: true,
  allowsPosting: true,
  ...overrides,
});

describe("validateDirectPostingAccounts", () => {
  it("dovoli aktivne knjižljive konte", () => {
    expect(validateDirectPostingAccounts(["account-1"], [account()])).toEqual({ valid: true });
  });

  it("zavrne neaktiven konto", () => {
    const result = validateDirectPostingAccounts(
      ["account-1"],
      [account({ isActive: false })],
    );

    expect(result).toMatchObject({ valid: false, reason: "inactive" });
  });

  it("zavrne skupinski konto", () => {
    const result = validateDirectPostingAccounts(
      ["account-1"],
      [account({ allowsPosting: false })],
    );

    expect(result).toMatchObject({ valid: false, reason: "group" });
  });

  it("zavrne konto, ki ne pripada preverjenemu podjetju", () => {
    const result = validateDirectPostingAccounts(["unknown"], [account()]);

    expect(result).toMatchObject({ valid: false, reason: "missing" });
  });
});