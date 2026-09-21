import { describe, expect, it } from "vitest";
import { canApplyKdsCommand, orderKdsHistory } from "../lib/kds-state";

describe("KDS state machine", () => {
  it("allows an idempotent retry without a second transition", () => {
    expect(canApplyKdsCommand("bumped", "bump", true)).toBe(true);
    expect(canApplyKdsCommand("ack", "ack", true)).toBe(true);
  });

  it("rejects invalid new transitions", () => {
    expect(canApplyKdsCommand("zadrzano", "bump", false)).toBe(false);
    expect(canApplyKdsCommand("zadrzano", "ack", false)).toBe(false);
    expect(canApplyKdsCommand("aktivno", "ack", false)).toBe(false);
    expect(canApplyKdsCommand("bumped", "bump", false)).toBe(false);
    expect(canApplyKdsCommand("ack", "ack", false)).toBe(false);
  });

  it("requires bump before ack", () => {
    expect(canApplyKdsCommand("aktivno", "bump", false)).toBe(true);
    expect(canApplyKdsCommand("bumped", "ack", false)).toBe(true);
  });

  it("orders append-only history by per-ticket sequence", () => {
    expect(orderKdsHistory([
      { zaporedje: 3, tip: "ack" },
      { zaporedje: 1, tip: "materializiran" },
      { zaporedje: 2, tip: "bump" },
    ]).map((event) => event.tip)).toEqual(["materializiran", "bump", "ack"]);
  });
});