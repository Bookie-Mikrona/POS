import { describe, expect, it } from "vitest";
import {
  cardPaymentEvidenceMatchesReceipt,
  createCardPaymentAmountEvidence,
  PatchRacunPlacilnaNacinBody,
  resolveTipPaymentMethod,
  validatePatchedReceiptPayments,
  validatePosPayments,
  validateQrTipOrigin,
  validateStudentskiBonAvailability,
  verifyCardProviderAmounts,
} from "./pos-payment-validation";

const valid = (overrides = {}) => validatePosPayments({
  placilnaNacin: "kartica", skupaj: 12, znesekKartica: 15, znesekNapitnina: 3, ...overrides,
});

describe("validatePosPayments", () => {
  it("PATCH shema zavrne neveljaven način plačila in zneske napačnega tipa", () => {
    expect(PatchRacunPlacilnaNacinBody.safeParse({
      placilnaNacin: "invalid",
      znesekKartica: "15.00",
    }).success).toBe(false);
    expect(PatchRacunPlacilnaNacinBody.safeParse({
      placilnaNacin: "kartica",
      znesekKartica: Number.POSITIVE_INFINITY,
    }).success).toBe(false);
  });
  it("upošteva celotno kartico, vključno z napitnino", () => {
    expect(valid()).toMatchObject({ ok: true, normalizedKartica: 15, napitnina: 3 });
  });
  it("pravilno sešteje darilni bon, kartico in napitnino", () => {
    expect(valid({ skupaj: 20, znesekBon: 5, znesekKartica: 18, znesekNapitnina: 3 })).toMatchObject({ ok: true });
  });
  it.each([
    { skupaj: 0, znesekBonPica: 10, znesekKartica: 0 },
    { skupaj: 2, znesekBonPica: 10, znesekKartica: 2 },
  ])("bon za pico je informativen in ne poveča plačilnega seštevka", input => {
    expect(valid({ ...input, znesekNapitnina: 0 })).toMatchObject({ ok: true });
  });
  it("v plačilni seštevek všteje SŠP subvencijo", () => {
    expect(valid({ skupaj: 12, znesekKartica: 9, znesekSubvencija: 4, znesekNapitnina: 1, sspReferenca: "SSP-1" })).toMatchObject({ ok: true });
  });
  it("zavrne napitnino brez pozitivne kartične prodaje", () => {
    expect(valid({ skupaj: 3, znesekKartica: 3, znesekNapitnina: 3 })).toMatchObject({ ok: false });
  });
  it("zavrne zneske, ki niso v centih", () => {
    expect(valid({ znesekKartica: 15.001 })).toMatchObject({ ok: false });
  });
  it("sprejme poljubno QR napitnino z največ dvema decimalnima mestoma", () => {
    expect(valid({ znesekKartica: 13.25, znesekNapitnina: 1.25 }))
      .toMatchObject({ ok: true, napitnina: 1.25 });
  });
  it.each([1.234, 100_000_000])("zavrne neveljavno napitnino %s EUR", znesekNapitnina => {
    expect(valid({ znesekKartica: 12 + znesekNapitnina, znesekNapitnina })).toMatchObject({ ok: false });
  });
  it("ohrani fallback starega nerazčlenjenega kartičnega računa", () => {
    expect(validatePosPayments({ placilnaNacin: "kartica", skupaj: 12, znesekNapitnina: 3 }))
      .toMatchObject({ ok: true, normalizedKartica: 15, suppliedPaymentFields: false });
  });
  it("ohrani fallback starega nerazčlenjenega gotovinskega računa", () => {
    expect(validatePosPayments({ placilnaNacin: "gotovina", skupaj: 12, znesekNapitnina: 3 }))
      .toMatchObject({ ok: true, suppliedPaymentFields: false });
  });
  it("PATCH ne more pustiti napitnine ob nekartičnem, nerazčlenjenem plačilu", () => {
    expect(validatePatchedReceiptPayments(
      { skupaj: 12, znesekNapitnina: 3 },
      { placilnaNacin: "gotovina", znesekGotovina: 12 },
    )).toMatchObject({ ok: false });
  });
  it("PATCH samo načina kartičnega računa ohrani celoten kartični znesek", () => {
    expect(validatePatchedReceiptPayments(
      { skupaj: 12, znesekNapitnina: 3, znesekKartica: 15 },
      { placilnaNacin: "kartica" },
    )).toMatchObject({ ok: true, normalizedKartica: 15 });
  });
  it("PATCH samo načina ohrani bon, kartični del in napitnino mešanega plačila", () => {
    expect(validatePatchedReceiptPayments(
      { skupaj: 20, znesekNapitnina: 3, znesekBon: 10, znesekKartica: 13 },
      { placilnaNacin: "bon" },
    )).toMatchObject({ ok: true, normalizedKartica: 13 });
  });
  it("PATCH zavrne bon ob obstoječi SŠP subvenciji", () => {
    expect(validatePatchedReceiptPayments(
      { skupaj: 12, znesekSubvencija: 4, sspReferenca: "SSP-1" },
      { placilnaNacin: "bon", znesekBon: 8 },
    )).toMatchObject({ ok: false });
  });
  it("PATCH zavrne novo število picabonov ob obstoječi SŠP subvenciji", () => {
    expect(validatePatchedReceiptPayments(
      { skupaj: 12, znesekSubvencija: 4, sspReferenca: "SSP-1", steviloBonov: 0 },
      { placilnaNacin: "kartica", znesekKartica: 8, znesekBonPica: 0, steviloBonov: 1 },
    )).toMatchObject({ ok: false });
  });
  it("PATCH sprejme veljaven SŠP, kartico in napitnino", () => {
    expect(validatePatchedReceiptPayments(
      { skupaj: 12, znesekNapitnina: 1, znesekSubvencija: 4, sspReferenca: "SSP-1" },
      { placilnaNacin: "kartica", znesekKartica: 9 },
    )).toMatchObject({ ok: true });
  });
});

describe("resolveTipPaymentMethod", () => {
  it("uses and verifies an explicit cash or card tip channel", () => {
    expect(resolveTipPaymentMethod({ napitnina: 3, tipPaymentMethod: "cash", gotovina: 3, kartica: 12 }))
      .toMatchObject({ ok: true, tipPaymentMethod: "cash" });
    expect(resolveTipPaymentMethod({ napitnina: 3, tipPaymentMethod: "card", gotovina: 12, kartica: 3 }))
      .toMatchObject({ ok: true, tipPaymentMethod: "card" });
    expect(resolveTipPaymentMethod({ napitnina: 3, tipPaymentMethod: "card", gotovina: 15, kartica: 2.99 }))
      .toMatchObject({ ok: false });
  });

  it("infers a single recorded cash/card channel for backwards compatibility", () => {
    expect(resolveTipPaymentMethod({ napitnina: 2, gotovina: 12, kartica: 0 }))
      .toMatchObject({ ok: true, tipPaymentMethod: "cash" });
    expect(resolveTipPaymentMethod({ napitnina: 2, gotovina: 0, kartica: 12 }))
      .toMatchObject({ ok: true, tipPaymentMethod: "card" });
  });

  it("rejects an omitted channel for mixed payments", () => {
    expect(resolveTipPaymentMethod({ napitnina: 2, gotovina: 5, kartica: 7 }))
      .toMatchObject({ ok: false });
  });
});

describe("omejitve zaključka računa", () => {
  it("zavrne subvencijo, ko študentski bon v enoti ni omogočen", () => {
    expect(validateStudentskiBonAvailability(4, false)).toMatchObject({
      ok: false,
      code: "STUDENTSKI_BON_NI_OMOGOCEN",
    });
    expect(validateStudentskiBonAvailability(4, true)).toEqual({ ok: true });
    expect(validateStudentskiBonAvailability(0, false)).toEqual({ ok: true });
  });

  it("sprejme samo napitnino, ki se ujema z gostovo QR izbiro", () => {
    expect(validateQrTipOrigin(2.5, 2.5)).toEqual({ ok: true });
    expect(validateQrTipOrigin(0, 0)).toEqual({ ok: true });
    expect(validateQrTipOrigin(5, 0)).toMatchObject({
      ok: false,
      code: "NAPITNINA_SAMO_QR",
    });
  });
});

describe("pogodba terminalskega kartičnega zneska in napitnine", () => {
  it.each([
    ["Payten TCP", 1340, null],
    ["SumUp checkout", 1340, null],
    ["Viva Terminal verify", 1340, 200],
    ["Viva Smart/Android verify", 1340, 200],
  ])("%s normalizira celotni kartični znesek in ohrani napitnino ločeno", (_provider, providerTotalCents, providerTipCents) => {
    const initial = createCardPaymentAmountEvidence(13.4, 2);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const verified = verifyCardProviderAmounts({
      evidence: initial.evidence,
      providerTotalCents,
      providerTipCents,
    });
    expect(verified).toMatchObject({
      ok: true,
      evidence: {
        requestedCardTotalCents: 1340,
        expectedCardTipCents: 200,
        providerTotalCents: 1340,
        providerAmountsVerified: true,
      },
    });
  });

  it.each([
    ["manjkajoči total", null, null],
    ["napačni total", 1140, null],
    ["neskladna ločena napitnina", 1340, 150],
  ])("fail-closed zavrne %s", (_label, providerTotalCents, providerTipCents) => {
    const initial = createCardPaymentAmountEvidence(13.4, 2);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    expect(verifyCardProviderAmounts({
      evidence: initial.evidence,
      providerTotalCents,
      providerTipCents,
    })).toMatchObject({ ok: false });
  });

  it("račun zahteva isti celotni kartični znesek in isti kartični del napitnine", () => {
    const initial = createCardPaymentAmountEvidence(13.4, 2);
    if (!initial.ok) throw new Error(initial.error);
    const verified = verifyCardProviderAmounts({
      evidence: initial.evidence,
      providerTotalCents: 1340,
    });
    if (!verified.ok) throw new Error(verified.error);
    const evidenceJson = JSON.stringify({ amountEvidence: verified.evidence });
    expect(cardPaymentEvidenceMatchesReceipt({
      evidenceJson,
      cardTotalEur: 13.4,
      tipEur: 2,
      tipPaymentMethod: "card",
    })).toBe(true);
    expect(cardPaymentEvidenceMatchesReceipt({
      evidenceJson,
      cardTotalEur: 11.4,
      tipEur: 2,
      tipPaymentMethod: "card",
    })).toBe(false);
    expect(cardPaymentEvidenceMatchesReceipt({
      evidenceJson,
      cardTotalEur: 13.4,
      tipEur: 0,
      tipPaymentMethod: null,
    })).toBe(false);
  });
});