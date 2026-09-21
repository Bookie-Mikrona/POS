import { describe, expect, it } from "vitest";
import { applyTipCapture, tipPolicyNotice } from "./tipCapture";

describe("zajem napitnine v POS-u", () => {
  it("gotovinsko napitnino prišteje samo gotovini", () => {
    expect(applyTipCapture(10, 0, 2.5, "cash")).toEqual({ cash: 12.5, card: 0 });
  });

  it("kartično napitnino prišteje samo kartici", () => {
    expect(applyTipCapture(0, 10, 2.5, "card")).toEqual({ cash: 0, card: 12.5 });
  });

  it("pri mešanem plačilu ohrani prodajna deleža in napitnino doda v izbrani kanal", () => {
    expect(applyTipCapture(8, 12, 1.25, "cash")).toEqual({ cash: 9.25, card: 12 });
    expect(applyTipCapture(8, 12, 1.25, "card")).toEqual({ cash: 8, card: 13.25 });
  });

  it("ne daje splošne trditve o DDV", () => {
    expect(tipPolicyNotice()).toContain("veljavni politiki podjetja");
    expect(tipPolicyNotice()).not.toMatch(/ločeno od.*DDV|brez DDV|neobdavčen/i);
  });
});