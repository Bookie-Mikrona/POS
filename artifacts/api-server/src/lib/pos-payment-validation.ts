import { UpdateRacunPlacilnaNacinBody } from "@workspace/api-zod";

export type PosPaymentMethod =
  | "gotovina" | "kartica" | "bon" | "bon_pica" | "negotovinsko" | "reprezentanca" | "lastna_poraba";

export type PosPaymentValidationInput = {
  placilnaNacin: PosPaymentMethod;
  skupaj: number;
  znesekGotovina?: number | null;
  znesekKartica?: number | null;
  znesekBon?: number | null;
  /** Informativni podatek o pokritju s picabon-i; ni plačilni vir. */
  znesekBonPica?: number | null;
  znesekNegotovinsko?: number | null;
  znesekSubvencija?: number | null;
  znesekNapitnina?: number | null;
  steviloBonov?: number | null;
  sspReferenca?: string | null;
};

export type PosPaymentValidationResult =
  | { ok: true; napitnina: number; normalizedKartica: number; suppliedPaymentFields: boolean }
  | { ok: false; error: string };

export type TipPaymentMethod = "cash" | "card";

export type CardPaymentAmountEvidence = {
  version: 1;
  requestedCardTotalCents: number;
  expectedCardTipCents: number;
  providerTotalCents: number | null;
  providerTipCents: number | null;
  providerAmountsVerified: boolean;
};

type CardPaymentAmountEvidenceResult =
  | { ok: true; evidence: CardPaymentAmountEvidence }
  | { ok: false; error: string };

export function validateStudentskiBonAvailability(
  znesekSubvencija: number,
  studentskiBonAktiven: boolean,
): { ok: true } | { ok: false; error: string; code: "STUDENTSKI_BON_NI_OMOGOCEN" } {
  if (znesekSubvencija <= 0 || studentskiBonAktiven) return { ok: true };
  return {
    ok: false,
    code: "STUDENTSKI_BON_NI_OMOGOCEN",
    error: "Študentski bon v tej poslovni enoti ni omogočen.",
  };
}

export function validateQrTipOrigin(
  napitnina: number,
  qrNapitnina: number,
): { ok: true } | { ok: false; error: string; code: "NAPITNINA_SAMO_QR" } {
  if (Math.abs(napitnina - qrNapitnina) <= 0.005) return { ok: true };
  return {
    ok: false,
    code: "NAPITNINA_SAMO_QR",
    error: "Napitnino lahko določi samo gost v javnem QR meniju.",
  };
}

/** Resolve the immutable tip channel from the declared channel or unambiguous recorded payments. */
export function resolveTipPaymentMethod(input: {
  napitnina: number;
  tipPaymentMethod?: TipPaymentMethod | null;
  gotovina: number;
  kartica: number;
}): { ok: true; tipPaymentMethod: TipPaymentMethod | null } | { ok: false; error: string } {
  if (input.napitnina <= 0) return { ok: true, tipPaymentMethod: null };
  const declared = input.tipPaymentMethod;
  if (declared) {
    const captured = declared === "cash" ? input.gotovina : input.kartica;
    if (captured + 0.005 < input.napitnina) {
      return { ok: false, error: `Zabeleženi ${declared === "cash" ? "gotovinski" : "kartični"} znesek ne pokriva napitnine.` };
    }
    return { ok: true, tipPaymentMethod: declared };
  }
  const cash = input.gotovina > 0.005;
  const card = input.kartica > 0.005;
  if (cash && card) {
    return { ok: false, error: "Pri mešanem plačilu z napitnino je obvezen način zajema napitnine." };
  }
  if (cash && input.gotovina + 0.005 >= input.napitnina) return { ok: true, tipPaymentMethod: "cash" };
  if (card && input.kartica + 0.005 >= input.napitnina) return { ok: true, tipPaymentMethod: "card" };
  return { ok: false, error: "Noben zabeleženi gotovinski ali kartični znesek ne pokriva napitnine." };
}

const round2 = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;
const isCentAmount = (amount: number) =>
  Number.isFinite(amount) && amount >= 0 && Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-7;
const MAX_TIP = 99_999_999.99;

function exactNonNegativeEuroCents(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  return Math.abs(value * 100 - cents) < 1e-8 ? cents : null;
}

export function createCardPaymentAmountEvidence(
  requestedCardTotalEur: number,
  expectedCardTipEur: number,
): CardPaymentAmountEvidenceResult {
  const requestedCardTotalCents = exactNonNegativeEuroCents(requestedCardTotalEur);
  const expectedCardTipCents = exactNonNegativeEuroCents(expectedCardTipEur);
  if (
    requestedCardTotalCents == null
    || requestedCardTotalCents <= 0
    || expectedCardTipCents == null
    || expectedCardTipCents > requestedCardTotalCents
  ) {
    return { ok: false, error: "Kartični znesek in kartična napitnina morata biti veljavna centna zneska." };
  }
  return {
    ok: true,
    evidence: {
      version: 1,
      requestedCardTotalCents,
      expectedCardTipCents,
      providerTotalCents: null,
      providerTipCents: null,
      providerAmountsVerified: false,
    },
  };
}

export function parseCardPaymentAmountEvidence(value: unknown): CardPaymentAmountEvidence | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Partial<CardPaymentAmountEvidence> & { amountEvidence?: unknown };
  if (candidate.amountEvidence != null) return parseCardPaymentAmountEvidence(candidate.amountEvidence);
  if (
    candidate.version !== 1
    || !Number.isInteger(candidate.requestedCardTotalCents)
    || !Number.isInteger(candidate.expectedCardTipCents)
    || candidate.requestedCardTotalCents! <= 0
    || candidate.expectedCardTipCents! < 0
    || candidate.expectedCardTipCents! > candidate.requestedCardTotalCents!
    || (candidate.providerTotalCents != null && (!Number.isInteger(candidate.providerTotalCents) || candidate.providerTotalCents < 0))
    || (candidate.providerTipCents != null && (!Number.isInteger(candidate.providerTipCents) || candidate.providerTipCents < 0))
    || typeof candidate.providerAmountsVerified !== "boolean"
  ) {
    return null;
  }
  return candidate as CardPaymentAmountEvidence;
}

export function verifyCardProviderAmounts(input: {
  evidence: CardPaymentAmountEvidence;
  providerTotalCents: number | null;
  providerTipCents?: number | null;
}): CardPaymentAmountEvidenceResult {
  const providerTipCents = input.providerTipCents ?? null;
  if (
    !Number.isInteger(input.providerTotalCents)
    || input.providerTotalCents! <= 0
    || (providerTipCents != null && (!Number.isInteger(providerTipCents) || providerTipCents < 0))
  ) {
    return { ok: false, error: "Ponudnik ni vrnil preverljivega kartičnega zneska." };
  }
  if (input.providerTotalCents !== input.evidence.requestedCardTotalCents) {
    return { ok: false, error: "Terminalski skupni znesek se ne ujema z zahtevanim kartičnim zneskom." };
  }
  if (providerTipCents != null && providerTipCents !== input.evidence.expectedCardTipCents) {
    return { ok: false, error: "Terminalska napitnina se ne ujema z ločeno pričakovano kartično napitnino." };
  }
  return {
    ok: true,
    evidence: {
      ...input.evidence,
      providerTotalCents: input.providerTotalCents,
      providerTipCents,
      providerAmountsVerified: true,
    },
  };
}

export function cardPaymentEvidenceMatchesReceipt(input: {
  evidenceJson: string | null;
  cardTotalEur: number;
  tipEur: number;
  tipPaymentMethod: TipPaymentMethod | null;
}): boolean {
  const cardTotalCents = exactNonNegativeEuroCents(input.cardTotalEur);
  const cardTipCents = exactNonNegativeEuroCents(
    input.tipPaymentMethod === "card" ? input.tipEur : 0,
  );
  const evidence = parseCardPaymentAmountEvidence(input.evidenceJson);
  if (!evidence) {
    // Pred uvedbo centnega dokaza terminalski poskusi niso hranili ločitve.
    // Varno združljivost ohranimo samo za račune brez kartične napitnine.
    return cardTipCents === 0;
  }
  return evidence.providerAmountsVerified
    && evidence.providerTotalCents === cardTotalCents
    && evidence.requestedCardTotalCents === cardTotalCents
    && evidence.expectedCardTipCents === cardTipCents
    && (evidence.providerTipCents == null || evidence.providerTipCents === cardTipCents);
}

export const PatchRacunPlacilnaNacinBody = UpdateRacunPlacilnaNacinBody.strict().superRefine((data, ctx) => {
  for (const field of ["znesekGotovina", "znesekKartica", "znesekBon", "znesekBonPica"] as const) {
    const value = data[field];
    if (value != null && !Number.isFinite(value)) {
      ctx.addIssue({ code: "custom", path: [field], message: "Znesek mora biti končno število." });
    }
  }
  if (data.steviloBonov != null && (!Number.isFinite(data.steviloBonov) || !Number.isInteger(data.steviloBonov))) {
    ctx.addIssue({ code: "custom", path: ["steviloBonov"], message: "Število bonov mora biti celo število." });
  }
});

/**
 * Validira plačilne vire novega POS računa. Bon za pico ostane namenoma zunaj
 * seštevka: skupaj je že neto znesek po tem pokritju. Napitnino lahko gost
 * doda v gotovini ali na kartici; subvencija pa je plačilni vir poleg kartice
 * in gotovine.
 */
export function validatePosPayments(input: PosPaymentValidationInput): PosPaymentValidationResult {
  const gotovina = Number(input.znesekGotovina ?? 0);
  const karticaInput = Number(input.znesekKartica ?? 0);
  const bon = Number(input.znesekBon ?? 0);
  const bonPica = Number(input.znesekBonPica ?? 0);
  const negotovinsko = Number(input.znesekNegotovinsko ?? 0);
  const subvencija = Number(input.znesekSubvencija ?? 0);
  const napitnina = Number(input.znesekNapitnina ?? 0);
  const amounts = [gotovina, karticaInput, bon, bonPica, negotovinsko, subvencija, napitnina];
  if (!Number.isFinite(input.skupaj) || input.skupaj < 0 || !amounts.every(isCentAmount)) {
    return { ok: false, error: "Plačila in napitnina morajo biti nenegativni zneski v centih." };
  }
  if (napitnina > MAX_TIP) {
    return { ok: false, error: "Napitnina presega največji dovoljeni znesek." };
  }

  // Bon za pico ni vir plačila, vendar ga validiramo kot denarni podatek.
  const suppliedPaymentFields = [
    input.znesekGotovina, input.znesekKartica, input.znesekBon,
    input.znesekNegotovinsko, input.znesekSubvencija,
  ].some(value => value != null);
  const target = round2(input.skupaj + napitnina);
  const normalizedKartica = !suppliedPaymentFields && input.placilnaNacin === "kartica"
    ? target
    : karticaInput;
  // Pri razčlenjenem plačilu je kanal napitnine razviden iz zneskov: kartica
  // lahko vsebuje prodajo + napitnino, gotovina pa lahko vsebuje oboje. Za
  // varnost vseeno zahtevamo dejanski pozitivni plačilni delež prodaje.
  const hasCashOrCardSale = normalizedKartica > 0 || gotovina > 0
    || (!suppliedPaymentFields && input.placilnaNacin === "gotovina");
  if (napitnina > 0 && !hasCashOrCardSale) {
    return { ok: false, error: "Napitnina je dovoljena samo ob pozitivnem gotovinskem ali kartičnem deležu plačila." };
  }

  // Stari odjemalci niso pošiljali razčlenitve. Za namen validacije ohranimo
  // njihov primarni način plačila kot celoten znesek, ne da bi ga prepisovali.
  let paymentTotal = round2(gotovina + normalizedKartica + bon + negotovinsko + subvencija);
  if (!suppliedPaymentFields) paymentTotal = target;
  if (suppliedPaymentFields && Math.abs(paymentTotal - target) > 0.005) {
    return { ok: false, error: "Vsota plačil mora biti enaka skupaj z napitnino." };
  }
  if (subvencija > 0) {
    if (bon > 0 || bonPica > 0 || (input.steviloBonov ?? 0) > 0) {
      return { ok: false, error: "Študentskega bona ni mogoče kombinirati z darilnim ali bonom za pico." };
    }
    if (!input.sspReferenca?.trim()) {
      return { ok: false, error: "Za študentski bon je obvezna lokalna referenca." };
    }
  }
  return { ok: true, napitnina, normalizedKartica, suppliedPaymentFields };
}

/** Validacija rezultata PATCH-a, kadar se obstoječa napitnina ne sme izgubiti. */
export function validatePatchedReceiptPayments(
  existing: Omit<PosPaymentValidationInput, "placilnaNacin">,
  patch: Pick<PosPaymentValidationInput, "placilnaNacin"> & Partial<Pick<PosPaymentValidationInput, "znesekGotovina" | "znesekKartica" | "znesekBon" | "znesekBonPica" | "steviloBonov">>,
) {
  // PATCH polja z undefined pomenijo »ohrani obstoječo vrednost«, ne pa nič.
  return validatePosPayments({
    ...existing,
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
  } as PosPaymentValidationInput);
}