import { describe, expect, it } from "vitest";
import { isDispatchEligible } from "../lib/kds-dispatch";

describe("KDS dispatch readiness", () => {
  it.each([
    [[], false],
    [["aktivno"], false],
    [["ack"], false],
    [["bumped"], true],
    [["bumped", "bumped"], true],
    [["bumped", "aktivno"], false],
    [["bumped", "ack"], false],
  ] as const)("requires at least one and exclusively bumped tickets: %j", (states, expected) => {
    expect(isDispatchEligible(states)).toBe(expected);
  });
});