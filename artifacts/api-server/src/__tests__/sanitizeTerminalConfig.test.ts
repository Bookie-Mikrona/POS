/**
 * Testi za sanitizeTerminalConfig v naprave.ts
 *
 * Preverja:
 * - tiskalnikSirina: vrne vrednost; undefined ko ni nastavljeno (brez privzetka 58)
 * - tiskalnikCodePage: vrne veljavne vrednosti; undefined za neveljavne
 * - tiskalnikTip: vrne vrednost; undefined za prazno/manjkajoče
 * - payten/sumup/viva polja niso pokvarjena
 * - null/prazen JSON → null
 */

import { describe, it, expect } from "vitest";

// sanitizeTerminalConfig ni exportirana — uvozimo jo prek sanitizeTerminalConfig
// ki je re-exportirana za testne namene iz naprave.ts
import { sanitizeTerminalConfigForTest } from "../routes/pos/napraveTestHelper";

describe("sanitizeTerminalConfig — tiskalnikSirina", () => {
  it("vrne tiskalnikSirina: 58 ko je nastavljeno", () => {
    const r = sanitizeTerminalConfigForTest(JSON.stringify({ tiskalnikSirina: 58 }));
    expect(r?.tiskalnikSirina).toBe(58);
  });

  it("vrne tiskalnikSirina: 30", () => {
    const r = sanitizeTerminalConfigForTest(JSON.stringify({ tiskalnikSirina: 30 }));
    expect(r?.tiskalnikSirina).toBe(30);
  });

  it("vrne tiskalnikSirina: 80", () => {
    const r = sanitizeTerminalConfigForTest(JSON.stringify({ tiskalnikSirina: 80 }));
    expect(r?.tiskalnikSirina).toBe(80);
  });

  it("vrne undefined (ne 58) ko tiskalnikSirina ni nastavljeno — samodejno zaznaj", () => {
    const r = sanitizeTerminalConfigForTest(JSON.stringify({ agentTiskalnikIme: "" }));
    expect(r?.tiskalnikSirina).toBeUndefined();
  });

  it("vrne undefined ko tiskalnikSirina je null v JSON", () => {
    const r = sanitizeTerminalConfigForTest(JSON.stringify({ tiskalnikSirina: null }));
    expect(r?.tiskalnikSirina).toBeUndefined();
  });
});

describe("sanitizeTerminalConfig — tiskalnikCodePage", () => {
  it("vrne cp1250", () => {
    const r = sanitizeTerminalConfigForTest(JSON.stringify({ tiskalnikCodePage: "cp1250" }));
    expect(r?.tiskalnikCodePage).toBe("cp1250");
  });

  it("vrne wpc1250", () => {
    const r = sanitizeTerminalConfigForTest(JSON.stringify({ tiskalnikCodePage: "wpc1250" }));
    expect(r?.tiskalnikCodePage).toBe("wpc1250");
  });

  it("vrne cp852", () => {
    const r = sanitizeTerminalConfigForTest(JSON.stringify({ tiskalnikCodePage: "cp852" }));
    expect(r?.tiskalnikCodePage).toBe("cp852");
  });

  it("vrne ascii-translit", () => {
    const r = sanitizeTerminalConfigForTest(JSON.stringify({ tiskalnikCodePage: "ascii-translit" }));
    expect(r?.tiskalnikCodePage).toBe("ascii-translit");
  });

  it("undefined za neveljavno vrednost (GBK, UTF-8, ipd.)", () => {
    const r = sanitizeTerminalConfigForTest(JSON.stringify({ tiskalnikCodePage: "GBK" }));
    expect(r?.tiskalnikCodePage).toBeUndefined();
  });

  it("undefined ko tiskalnikCodePage ni nastavljeno", () => {
    const r = sanitizeTerminalConfigForTest(JSON.stringify({ agentTiskalnikIme: "P1" }));
    expect(r?.tiskalnikCodePage).toBeUndefined();
  });

  it("undefined za prazno polje", () => {
    const r = sanitizeTerminalConfigForTest(JSON.stringify({ tiskalnikCodePage: "" }));
    expect(r?.tiskalnikCodePage).toBeUndefined();
  });
});

describe("sanitizeTerminalConfig — tiskalnikTip", () => {
  it("vrne 'windows' ko je nastavljeno", () => {
    const r = sanitizeTerminalConfigForTest(JSON.stringify({ tiskalnikTip: "windows" }));
    expect(r?.tiskalnikTip).toBe("windows");
  });

  it("undefined za prazno polje", () => {
    const r = sanitizeTerminalConfigForTest(JSON.stringify({ tiskalnikTip: "" }));
    expect(r?.tiskalnikTip).toBeUndefined();
  });

  it("undefined ko ni nastavljeno", () => {
    const r = sanitizeTerminalConfigForTest(JSON.stringify({ agentTiskalnikIme: "P1" }));
    expect(r?.tiskalnikTip).toBeUndefined();
  });
});

describe("sanitizeTerminalConfig — obstoječa polja nespremenjena", () => {
  it("payten/sumup/viva polja se pravilno vrnejo", () => {
    const cfg = {
      terminalAktiven: true,
      terminalIp: "10.0.0.1",
      terminalPort: 8080,
      paytenAndroidAktiven: true,
      sumupAktiven: true,
      vivaAktiven: true,
      agentTiskalnikIme: "HP LaserJet",
    };
    const r = sanitizeTerminalConfigForTest(JSON.stringify(cfg));
    expect(r?.terminalAktiven).toBe(true);
    expect(r?.terminalIp).toBe("10.0.0.1");
    expect(r?.terminalPort).toBe(8080);
    expect(r?.paytenAndroidAktiven).toBe(true);
    expect(r?.sumupAktiven).toBe(true);
    expect(r?.vivaAktiven).toBe(true);
    expect(r?.agentTiskalnikIme).toBe("HP LaserJet");
  });
});

describe("sanitizeTerminalConfig — robni primeri", () => {
  it("null JSON → null", () => {
    expect(sanitizeTerminalConfigForTest(null)).toBeNull();
  });

  it("undefined → null", () => {
    expect(sanitizeTerminalConfigForTest(undefined)).toBeNull();
  });

  it("prazno → null", () => {
    expect(sanitizeTerminalConfigForTest("")).toBeNull();
  });

  it("pokvarjen JSON → null", () => {
    expect(sanitizeTerminalConfigForTest("{NEVELJAVNO")).toBeNull();
  });
});
