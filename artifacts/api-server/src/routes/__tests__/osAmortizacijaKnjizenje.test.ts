/**
 * Testi za osAmortizacijaKnjizenje.ts
 *
 * Testira čiste logične funkcije (brez DB):
 *   - isActiveInMonth: mesečna aktivnost doknjižb
 *   - buildKnjizenjePredogled: agregacija po konto-parih, dvostavno ravnovesje,
 *       validacija kontov (isActive, allowsPosting, requiresCostCenter, requiresPartner, requiresProject),
 *       dimenzije (costCenterId) prenesene na vrstice
 */

import { describe, it, expect } from "vitest";
import {
  isActiveInMonth,
  buildKnjizenjePredogled,
} from "../osAmortizacijaKnjizenje";

// ─── isActiveInMonth ─────────────────────────────────────────────────────────

describe("isActiveInMonth", () => {
  it("vrne false za NULL datumAktivacije", () => {
    expect(isActiveInMonth(null, null, 2024, 6)).toBe(false);
  });

  it("vrne true za sredstvo aktivirano pred letom, brez izpisa", () => {
    expect(isActiveInMonth("2019-11-01", null, 2024, 6)).toBe(true);
  });

  it("vrne true za aktivacijo v istem mesecu", () => {
    expect(isActiveInMonth("2024-06-15", null, 2024, 6)).toBe(true);
  });

  it("vrne false za aktivacijo v naslednjem mesecu", () => {
    expect(isActiveInMonth("2024-07-01", null, 2024, 6)).toBe(false);
  });

  it("vrne false za aktivacijo v naslednjem letu", () => {
    expect(isActiveInMonth("2025-01-01", null, 2024, 6)).toBe(false);
  });

  it("vrne true za izpis v istem mesecu", () => {
    expect(isActiveInMonth("2020-01-01", "2024-06-30", 2024, 6)).toBe(true);
  });

  it("vrne false za izpis pred iskanim mesecem (isti leto)", () => {
    expect(isActiveInMonth("2020-01-01", "2024-05-31", 2024, 6)).toBe(false);
  });

  it("vrne false za izpis v preteklem letu", () => {
    expect(isActiveInMonth("2020-01-01", "2023-12-31", 2024, 1)).toBe(false);
  });

  it("vrne true za izpis po iskanem mesecu", () => {
    expect(isActiveInMonth("2020-01-01", "2024-12-31", 2024, 6)).toBe(true);
  });

  it("vrne true za izpis v naslednjem letu", () => {
    expect(isActiveInMonth("2020-01-01", "2025-01-01", 2024, 12)).toBe(true);
  });

  it("januar 2024 — aktivirano januarja 2024", () => {
    expect(isActiveInMonth("2024-01-15", null, 2024, 1)).toBe(true);
  });

  it("december 2024 — aktivirano decembra 2024", () => {
    expect(isActiveInMonth("2024-12-01", null, 2024, 12)).toBe(true);
  });

  it("vrne false za aktivacijo decembra 2024 pri iskanju novembra 2024", () => {
    expect(isActiveInMonth("2024-12-01", null, 2024, 11)).toBe(false);
  });
});

// ─── AccountInfo mapa za teste ────────────────────────────────────────────────

const DEFAULT_STROSKI_ID = "acc-stroski-uuid";
const DEFAULT_POPRAVKA_ID = "acc-popravka-uuid";
const CUSTOM_STROSKI_ID  = "custom-stroski-uuid";
const CUSTOM_POPRAVKA_ID  = "custom-popravka-uuid";
const INACTIVE_ACC_ID    = "inactive-acc-uuid";
const GROUP_ACC_ID       = "group-acc-uuid";
const REQUIRES_PARTNER_ID = "requires-partner-uuid";
const REQUIRES_PROJECT_ID = "requires-project-uuid";
const REQUIRES_CC_ID     = "requires-cc-uuid";

type AccountInfo = {
  code: string;
  name: string;
  isActive: boolean;
  allowsPosting: boolean;
  requiresCostCenter: boolean;
  requiresPartner: boolean;
  requiresProject: boolean;
};

const makeAcc = (code: string, name: string, overrides: Partial<AccountInfo> = {}): AccountInfo => ({
  code, name, isActive: true, allowsPosting: true,
  requiresCostCenter: false, requiresPartner: false, requiresProject: false,
  ...overrides,
});

const accMap = new Map<string, AccountInfo>([
  [DEFAULT_STROSKI_ID,  makeAcc("4300", "Amortizacija opreme")],
  [DEFAULT_POPRAVKA_ID, makeAcc("0190", "Popravek vrednosti opreme")],
  [CUSTOM_STROSKI_ID,   makeAcc("4310", "Amortizacija stavb")],
  [CUSTOM_POPRAVKA_ID,  makeAcc("0290", "Popravek vrednosti stavb")],
  [INACTIVE_ACC_ID,     makeAcc("4400", "Neaktiven konto", { isActive: false })],
  [GROUP_ACC_ID,        makeAcc("4000", "Skupinski konto", { allowsPosting: false })],
  [REQUIRES_PARTNER_ID, makeAcc("4500", "Konto z partnerjem", { requiresPartner: true })],
  [REQUIRES_PROJECT_ID, makeAcc("4600", "Konto s projektom", { requiresProject: true })],
  [REQUIRES_CC_ID,      makeAcc("4700", "Konto s STM", { requiresCostCenter: true })],
]);

const CC_ID = "cost-center-uuid";

// ─── buildKnjizenjePredogled ──────────────────────────────────────────────────

describe("buildKnjizenjePredogled", () => {
  it("prazni vhod → prazne vrstice, vsote 0.00", () => {
    const result = buildKnjizenjePredogled([], DEFAULT_STROSKI_ID, DEFAULT_POPRAVKA_ID, accMap, "AMORT:2024", 2024, null);
    expect(result.vrstice).toHaveLength(0);
    expect(result.skupajBreme).toBe("0.00");
    expect(result.skupajDobro).toBe("0.00");
    expect(result.steviloSredstev).toBe(0);
    expect(result.uravnotezeno).toBe(true);
  });

  it("sredstvo z amortizacijo 0 → ni v vrsticah", () => {
    const data = [{ skupnaObracunana: "0.00", kontoStroskaId: null, kontoPopravkaId: null, costCenterId: null }];
    const result = buildKnjizenjePredogled(data, DEFAULT_STROSKI_ID, DEFAULT_POPRAVKA_ID, accMap, "AMORT:2024", 2024, null);
    expect(result.vrstice).toHaveLength(0);
    expect(result.steviloSredstev).toBe(0);
  });

  it("eno sredstvo → 1 vrstica, privzeti konti, breme = dobro", () => {
    const data = [{ skupnaObracunana: "1234.56", kontoStroskaId: null, kontoPopravkaId: null, costCenterId: null }];
    const result = buildKnjizenjePredogled(data, DEFAULT_STROSKI_ID, DEFAULT_POPRAVKA_ID, accMap, "AMORT:2024", 2024, null);
    expect(result.vrstice).toHaveLength(1);
    expect(result.vrstice[0].kontoStroskaId).toBe(DEFAULT_STROSKI_ID);
    expect(result.vrstice[0].kontoStroskaCode).toBe("4300");
    expect(result.vrstice[0].kontoPopravkaId).toBe(DEFAULT_POPRAVKA_ID);
    expect(result.vrstice[0].kontoPopravkaCode).toBe("0190");
    expect(result.vrstice[0].znesek).toBe("1234.56");
    expect(result.vrstice[0].costCenterId).toBeNull();
    expect(result.skupajBreme).toBe("1234.56");
    expect(result.skupajDobro).toBe("1234.56");
    expect(result.uravnotezeno).toBe(true);
    expect(result.steviloSredstev).toBe(1);
  });

  it("sredstvo s lastnimi konti → lastni konti, ne privzeti", () => {
    const data = [{ skupnaObracunana: "500.00", kontoStroskaId: CUSTOM_STROSKI_ID, kontoPopravkaId: CUSTOM_POPRAVKA_ID, costCenterId: null }];
    const result = buildKnjizenjePredogled(data, DEFAULT_STROSKI_ID, DEFAULT_POPRAVKA_ID, accMap, "AMORT:2024", 2024, null);
    expect(result.vrstice[0].kontoStroskaId).toBe(CUSTOM_STROSKI_ID);
    expect(result.vrstice[0].kontoStroskaCode).toBe("4310");
    expect(result.vrstice[0].kontoPopravkaId).toBe(CUSTOM_POPRAVKA_ID);
  });

  it("costCenterId se prenese na vrstico", () => {
    const data = [{ skupnaObracunana: "800.00", kontoStroskaId: null, kontoPopravkaId: null, costCenterId: CC_ID }];
    const result = buildKnjizenjePredogled(data, DEFAULT_STROSKI_ID, DEFAULT_POPRAVKA_ID, accMap, "AMORT:2024", 2024, null);
    expect(result.vrstice[0].costCenterId).toBe(CC_ID);
  });

  it("dve sredstvi z istim konto-parom in istim STM → en vrstica (aggregirano)", () => {
    const data = [
      { skupnaObracunana: "1000.00", kontoStroskaId: null, kontoPopravkaId: null, costCenterId: CC_ID },
      { skupnaObracunana: "500.00",  kontoStroskaId: null, kontoPopravkaId: null, costCenterId: CC_ID },
    ];
    const result = buildKnjizenjePredogled(data, DEFAULT_STROSKI_ID, DEFAULT_POPRAVKA_ID, accMap, "AMORT:2024", 2024, null);
    expect(result.vrstice).toHaveLength(1);
    expect(result.vrstice[0].znesek).toBe("1500.00");
    expect(result.vrstice[0].steviloSredstev).toBe(2);
  });

  it("dve sredstvi z istim konto-parom ampak RAZLIČNIM STM → dve vrstici", () => {
    const data = [
      { skupnaObracunana: "1000.00", kontoStroskaId: null, kontoPopravkaId: null, costCenterId: CC_ID },
      { skupnaObracunana: "500.00",  kontoStroskaId: null, kontoPopravkaId: null, costCenterId: "other-cc-uuid" },
    ];
    const result = buildKnjizenjePredogled(data, DEFAULT_STROSKI_ID, DEFAULT_POPRAVKA_ID, accMap, "AMORT:2024", 2024, null);
    expect(result.vrstice).toHaveLength(2);
    expect(result.skupajBreme).toBe("1500.00");
  });

  it("dve sredstvi z različnima konto-paroma → dve vrstici", () => {
    const data = [
      { skupnaObracunana: "1000.00", kontoStroskaId: null,              kontoPopravkaId: null,              costCenterId: null },
      { skupnaObracunana: "800.00",  kontoStroskaId: CUSTOM_STROSKI_ID, kontoPopravkaId: CUSTOM_POPRAVKA_ID, costCenterId: null },
    ];
    const result = buildKnjizenjePredogled(data, DEFAULT_STROSKI_ID, DEFAULT_POPRAVKA_ID, accMap, "AMORT:2024", 2024, null);
    expect(result.vrstice).toHaveLength(2);
    expect(result.skupajBreme).toBe("1800.00");
    expect(result.skupajDobro).toBe("1800.00");
    expect(result.uravnotezeno).toBe(true);
  });

  it("brez privzetih kontov in brez lastnih → brezKontov++, prazne vrstice", () => {
    const data = [{ skupnaObracunana: "500.00", kontoStroskaId: null, kontoPopravkaId: null, costCenterId: null }];
    const result = buildKnjizenjePredogled(data, null, null, accMap, "AMORT:2024", 2024, null);
    expect(result.vrstice).toHaveLength(0);
    expect(result.brezKontov).toBe(1);
    expect(result.skupajBreme).toBe("0.00");
  });

  it("neaktiven konto stroška → brezKontov++, vrstica izpuščena", () => {
    const data = [{ skupnaObracunana: "500.00", kontoStroskaId: INACTIVE_ACC_ID, kontoPopravkaId: DEFAULT_POPRAVKA_ID, costCenterId: null }];
    const result = buildKnjizenjePredogled(data, null, null, accMap, "AMORT:2024", 2024, null);
    expect(result.vrstice).toHaveLength(0);
    expect(result.brezKontov).toBe(1);
  });

  it("skupinski konto (allowsPosting=false) → brezKontov++, vrstica izpuščena", () => {
    const data = [{ skupnaObracunana: "500.00", kontoStroskaId: GROUP_ACC_ID, kontoPopravkaId: DEFAULT_POPRAVKA_ID, costCenterId: null }];
    const result = buildKnjizenjePredogled(data, null, null, accMap, "AMORT:2024", 2024, null);
    expect(result.vrstice).toHaveLength(0);
    expect(result.brezKontov).toBe(1);
  });

  it("konto zahteva partnerja → brezKontov++, amortizacija nima partnerja", () => {
    const data = [{ skupnaObracunana: "500.00", kontoStroskaId: REQUIRES_PARTNER_ID, kontoPopravkaId: DEFAULT_POPRAVKA_ID, costCenterId: null }];
    const result = buildKnjizenjePredogled(data, null, null, accMap, "AMORT:2024", 2024, null);
    expect(result.vrstice).toHaveLength(0);
    expect(result.brezKontov).toBe(1);
  });

  it("konto zahteva projekt → brezKontov++", () => {
    const data = [{ skupnaObracunana: "500.00", kontoStroskaId: REQUIRES_PROJECT_ID, kontoPopravkaId: DEFAULT_POPRAVKA_ID, costCenterId: null }];
    const result = buildKnjizenjePredogled(data, null, null, accMap, "AMORT:2024", 2024, null);
    expect(result.vrstice).toHaveLength(0);
    expect(result.brezKontov).toBe(1);
  });

  it("requiresCostCenter=true + costCenterId=null → brezKontov++", () => {
    const data = [{ skupnaObracunana: "500.00", kontoStroskaId: REQUIRES_CC_ID, kontoPopravkaId: DEFAULT_POPRAVKA_ID, costCenterId: null }];
    const result = buildKnjizenjePredogled(data, null, null, accMap, "AMORT:2024", 2024, null);
    expect(result.vrstice).toHaveLength(0);
    expect(result.brezKontov).toBe(1);
  });

  it("requiresCostCenter=true + costCenterId nastavljen → vrstica se ustvari", () => {
    const data = [{ skupnaObracunana: "500.00", kontoStroskaId: REQUIRES_CC_ID, kontoPopravkaId: DEFAULT_POPRAVKA_ID, costCenterId: CC_ID }];
    const result = buildKnjizenjePredogled(data, null, null, accMap, "AMORT:2024", 2024, null);
    expect(result.vrstice).toHaveLength(1);
    expect(result.vrstice[0].costCenterId).toBe(CC_ID);
    expect(result.brezKontov).toBe(0);
  });

  it("mesečna referenca vsebuje mesec", () => {
    const data = [{ skupnaObracunana: "100.00", kontoStroskaId: null, kontoPopravkaId: null, costCenterId: null }];
    const result = buildKnjizenjePredogled(data, DEFAULT_STROSKI_ID, DEFAULT_POPRAVKA_ID, accMap, "AMORT:2024-03", 2024, 3);
    expect(result.referenca).toBe("AMORT:2024-03");
    expect(result.mesec).toBe(3);
    expect(result.leto).toBe(2024);
  });

  it("dvostavno ravnovesje vedno drži (skupajBreme == skupajDobro)", () => {
    const data = [
      { skupnaObracunana: "123.45", kontoStroskaId: null,              kontoPopravkaId: null,              costCenterId: null },
      { skupnaObracunana: "678.90", kontoStroskaId: CUSTOM_STROSKI_ID, kontoPopravkaId: CUSTOM_POPRAVKA_ID, costCenterId: null },
      { skupnaObracunana: "0.01",   kontoStroskaId: null,              kontoPopravkaId: null,              costCenterId: null },
    ];
    const result = buildKnjizenjePredogled(data, DEFAULT_STROSKI_ID, DEFAULT_POPRAVKA_ID, accMap, "AMORT:2024", 2024, null);
    expect(result.skupajBreme).toBe(result.skupajDobro);
    expect(result.uravnotezeno).toBe(true);
  });

  it("konto, ki ni v accountMap (cross-company) → brezKontov++", () => {
    const data = [{ skupnaObracunana: "500.00", kontoStroskaId: "unknown-acc-uuid", kontoPopravkaId: DEFAULT_POPRAVKA_ID, costCenterId: null }];
    const result = buildKnjizenjePredogled(data, null, null, accMap, "AMORT:2024", 2024, null);
    expect(result.vrstice).toHaveLength(0);
    expect(result.brezKontov).toBe(1);
  });
});
