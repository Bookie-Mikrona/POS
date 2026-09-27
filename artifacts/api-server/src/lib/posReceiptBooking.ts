import { createHash } from "node:crypto";
import {
  accountingPeriodsTable,
  accountsTable,
  artikliTable,
  counterpartiesTable,
  db,
  enoteTable,
  journalEntriesTable,
  journalEntryLinesTable,
  posBookingSettingsTable,
  posReceiptBookingSourcesTable,
  prejemniceOdvisniStroskiTable,
  prejemnicePostavkeTable,
  prejemniceTable,
  vatCodeTable,
} from "@workspace/db";
import { and, eq, inArray, like, lte, gte, or, sql } from "drizzle-orm";
import { resolveInputVatCode } from "./uvoz/vat-code-resolver";

export type BookingIssue = {
  code: string;
  message: string;
  context?: Record<string, unknown>;
};

export type ReceiptBookingAccount = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  allowsPosting: boolean;
  requiresPartner: boolean;
  requiresCostCenter: boolean;
  costCenterPolicy?: "not_allowed" | "allowed" | "required";
  requiresProject: boolean;
};

export type ReceiptBookingInput = {
  receipt: {
    id: number;
    number: string | null;
    supplierDocumentNumber?: string | null;
    date: string;
    documentDate: string;
    documentType?: "RACUN" | "DOBAVNICA" | "DOBROPIS" | "BREMEPIS" | null;
    taxDate: string;
    receiptDate: string;
    paymentMethod: string | null;
    cashPaid?: boolean;
    supplierId: string | null;
    supplierExists: boolean;
    costCenterId: string | null;
    periodId: string | null;
  };
  lines: Array<{
    id: number;
    articleId: number | null;
    articleType: string | null;
    returnablePackaging?: boolean;
    drobniInventar?: boolean;
    lineType: string;
    netAmount: unknown;
    vatRate: unknown;
    vatAmount: unknown;
    vatCodeId: string | null;
    vatCodeValid: boolean;
    vatCodeResolution: "matched" | "missing" | "ambiguous" | "invalid" | "unsupported";
  }>;
  dependentCosts: Array<{
    id: number;
    name: string;
    treatment: string;
    netAmount: unknown;
    vatRate: unknown;
    vatCodeId: string | null;
    vatCodeResolution: "matched" | "missing" | "ambiguous";
  }>;
  settings: {
    inventoryMaterialAccountId: string | null;
    inventoryGoodsAccountId: string | null;
    inventoryAccountId: string | null;
    otherCostsAccountId: string | null;
    rawMaterialExpenseAccountId: string | null;
    inboundFreightExpenseAccountId: string | null;
    drobniInventarExpenseAccountId?: string | null;
    nabavaObracunAccountId: string | null;
    inputVatAccountId: string | null;
    inputVat22AccountId: string | null;
    inputVat95AccountId: string | null;
    inputVat5AccountId: string | null;
    payablesAccountId?: string | null;
    returnablePackagingAccountId?: string | null;
    cashAccountId?: string | null;
  } | null;
  accounts: ReceiptBookingAccount[];
  legacySharedDraft?: boolean;
  existingState: "none" | "draft" | "posted";
  existingJournalEntryId: string | null;
};

export type PosReceiptVatEvidenceLine = {
  lineId: string;
  vatCodeId: string;
  amount: string;
  vatAmount: string | null;
  vatDeductionPercent: string | null;
  partnerId: string | null;
  description: string;
};

export type ReceiptBookingPreview = {
  header: {
    receiptId: number;
    receiptNumber: string | null;
    entryDate: string;
    documentDate: string;
    taxDate: string;
    receiptDate: string;
    description: string;
    reference: string;
    sourceType: "document";
    createdBy: "pos-receipt-booking";
  };
  lines: Array<{
    accountId: string;
    accountCode: string;
    accountName: string;
    side: "debit" | "credit";
    amount: string;
    description: string;
    partnerId: string | null;
    costCenterId: string | null;
    vatCodeId: string | null;
    vatAmount: string | null;
  }>;
  debitTotal: string;
  creditTotal: string;
  netAmount: string;
  warnings: BookingIssue[];
  blockingErrors: BookingIssue[];
  previewHash: string;
  existing: { state: "none" | "draft" | "posted"; journalEntryId: string | null };
};

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);
const money = (value: number) => (value / 100).toFixed(2);

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function buildPosReceiptVatEvidence(input: ReceiptBookingInput): PosReceiptVatEvidenceLine[] {
  const evidence: PosReceiptVatEvidenceLine[] = [];
  for (const line of input.lines) {
    if (input.receipt.documentType === "DOBROPIS" && line.returnablePackaging) continue;
    const net = numeric(line.netAmount);
    const rate = numeric(line.vatRate);
    if (line.returnablePackaging && net === 0) continue;
    if (net === null || net <= 0 || rate === null || rate < 0 || !line.vatCodeId || !line.vatCodeValid) continue;
    const vat = optionalNumeric(line.vatAmount);
    evidence.push({
      lineId: `prejemnica-postavka-${line.id}`,
      vatCodeId: line.vatCodeId,
      amount: money(cents(net)),
      vatAmount: money(cents(vat ?? net * rate / 100)),
      vatDeductionPercent: "100.00",
      partnerId: input.receipt.supplierId,
      description: line.returnablePackaging
        ? "Embalaža"
        : line.lineType === "poraba_surovin"
          ? "Strošek surovin"
          : line.lineType === "prevoz"
            ? "Prevozne storitve pri nabavi"
          : line.articleType === "material"
            ? "Surovina"
            : "Blago",
    });
  }
  for (const cost of input.dependentCosts) {
    const net = numeric(cost.netAmount);
    const rate = numeric(cost.vatRate);
    if (net === null || net <= 0 || rate === null || rate < 0 || !cost.vatCodeId) continue;
    evidence.push({
      lineId: `prejemnica-strosek-${cost.id}`,
      vatCodeId: cost.vatCodeId,
      amount: money(cents(net)),
      vatAmount: money(cents(net * rate / 100)),
      vatDeductionPercent: "100.00",
      partnerId: input.receipt.supplierId,
      description: cost.name,
    });
  }
  return evidence;
}

function rateKey(value: number): "22" | "9.5" | "5" | "0" | null {
  if (Math.abs(value - 22) < 0.001) return "22";
  if (Math.abs(value - 9.5) < 0.001) return "9.5";
  if (Math.abs(value - 5) < 0.001) return "5";
  if (Math.abs(value) < 0.001) return "0";
  return null;
}

export function isSupportedOrdinaryInputVatCandidate(candidate: {
  code: string;
  rate: string;
  isReverseCharge: boolean;
  isImport: boolean;
  kprVatField: string | null;
}): boolean {
  const code = candidate.code.trim().toUpperCase().replace(/[\s._-]+/g, "");
  const expected = Number(candidate.rate) === 22
    ? "P22"
    : Number(candidate.rate) === 9.5
      ? "P95"
      : Number(candidate.rate) === 5
        ? "P5"
        : null;
  return expected !== null
    && code === expected
    && !candidate.isReverseCharge
    && !candidate.isImport
    && Boolean(candidate.kprVatField);
}

export function normalizeIncomingPaymentMethod(value: string | null | undefined): "cash" | "other" {
  const normalized = (value ?? "")
    .trim()
    .toLocaleLowerCase("sl")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  return /(?:^|[^a-z])gotovin/.test(normalized) || /\bcash\b/.test(normalized) ? "cash" : "other";
}

export function buildPosReceiptBooking(input: ReceiptBookingInput): ReceiptBookingPreview {
  const warnings: BookingIssue[] = [];
  const blockingErrors: BookingIssue[] = [];
  const accountById = new Map(input.accounts.map(account => [account.id, account]));
  const rawLines: Array<{
    accountId: string;
    side: "debit" | "credit";
    cents: number;
    description: string;
    partnerId: string | null;
    costCenterId: string | null;
    vatCodeId: string | null;
    vatAmountCents: number;
  }> = [];
  let netCents = 0;
  let vatCents = 0;

  const addError = (code: string, message: string, context?: Record<string, unknown>) =>
    blockingErrors.push({ code, message, ...(context ? { context } : {}) });
  const creditNotePackagingLines = input.receipt.documentType === "DOBROPIS"
    ? input.lines.filter(line => line.returnablePackaging)
    : [];
  const creditNoteIsPackagingOnly = input.receipt.documentType === "DOBROPIS"
    && creditNotePackagingLines.length > 0
    && creditNotePackagingLines.length === input.lines.length;
  if (creditNoteIsPackagingOnly) {
    addError(
      "CREDIT_NOTE_REQUIRES_PACKAGING_ALLOCATION",
      "Dobropis se ne sme knjižiti kot običajna prejemnica. Uporabite ujemanje povratne embalaže s fizičnim vračilom; sicer bi nastala podvojena temeljnica DR 315 / CR 220.",
      { receiptId: input.receipt.id },
    );
  }
  const chooseInventory = (articleType: string | null, context: Record<string, unknown>) => {
    if (articleType === "material") {
      return input.settings?.inventoryMaterialAccountId ?? input.settings?.inventoryAccountId ?? null;
    }
    if (articleType === "blago") {
      return input.settings?.inventoryGoodsAccountId ?? input.settings?.inventoryAccountId ?? null;
    }
    addError("UNMATCHED_ARTICLE_TYPE", "Vrste artikla ni mogoče deterministično povezati s kontom zaloge.", context);
    return null;
  };
  const addDebit = (
    accountId: string | null,
    amount: number,
    description: string,
    context: Record<string, unknown>,
    vatCodeId: string | null = null,
    vatAmountCents = 0,
  ) => {
    if (!accountId) {
      addError("MISSING_ACCOUNT", "Zahtevani debetni konto ni nastavljen.", context);
      return;
    }
    rawLines.push({
      accountId,
      side: "debit",
      cents: amount,
      description,
      partnerId: null,
      costCenterId: input.receipt.costCenterId,
      vatCodeId,
      vatAmountCents,
    });
  };
  const addVat = (rate: "22" | "9.5" | "5", amount: number, context: Record<string, unknown>) => {
    const specific = rate === "22"
      ? input.settings?.inputVat22AccountId
      : rate === "9.5"
        ? input.settings?.inputVat95AccountId
        : input.settings?.inputVat5AccountId;
    const accountId = specific ?? input.settings?.inputVatAccountId ?? null;
    if (!specific && accountId) {
      warnings.push({
        code: "GENERIC_INPUT_VAT_ACCOUNT",
        message: `Za DDV ${rate} % je uporabljen splošni konto vstopnega DDV.`,
        context,
      });
    }
    addDebit(accountId, amount, `Vstopni DDV ${rate} %`, context);
  };

  if (!input.settings) addError("MISSING_SETTINGS", "Nastavitve knjiženja POS niso nastavljene.");
  if (!input.receipt.supplierId || !input.receipt.supplierExists) {
    addError("MISSING_SUPPLIER", "Prejemnica nima veljavnega dobavitelja podjetja.");
  }
  if (!input.receipt.periodId) addError("MISSING_OPEN_PERIOD", "Za datum prejemnice ni odprtega obdobja.");
  if (input.existingState === "posted") {
    addError("RECEIPT_ALREADY_POSTED", "Prejemnica je že vir potrjene temeljnice.");
  }
  if (input.legacySharedDraft) {
    addError(
      "LEGACY_SHARED_DRAFT",
      "Prejemnica je vključena v starejšo zbirno temeljnico. Pred posamičnim knjiženjem jo mora računovodstvo izrecno razrešiti.",
    );
  }
  if (input.lines.length === 0) addError("MISSING_RECEIPT_LINES", "Prejemnica nima postavk za knjiženje.");
  const validatePrefix = (accountId: string | null | undefined, prefix: string, code: string, message: string) => {
    if (!accountId) return;
    const configured = accountById.get(accountId);
    if (!configured) {
      addError("ACCOUNT_NOT_FOUND", "Nastavljeni konto ne pripada podjetju.", { accountId });
    } else if (!configured.code.startsWith(prefix)) {
      addError(code, message, { accountId, accountCode: configured.code });
    }
  };
  validatePrefix(
    input.settings?.nabavaObracunAccountId,
    "300",
    "INVALID_NABAVA_OBRACUN_ACCOUNT_CLASS",
    "Konto obračuna nabave mora biti analitika skupine 300.",
  );
  for (const accountId of [
    input.settings?.inputVatAccountId,
    input.settings?.inputVat22AccountId,
    input.settings?.inputVat95AccountId,
    input.settings?.inputVat5AccountId,
  ]) {
    validatePrefix(accountId, "160", "INVALID_INPUT_VAT_ACCOUNT_CLASS", "Konto vstopnega DDV mora biti iz razreda 160.");
  }
  validatePrefix(input.settings?.returnablePackagingAccountId, "3107", "INVALID_RETURNABLE_PACKAGING_ACCOUNT_CLASS", "Konto zaloge povratne embalaže mora biti 3107000.");
  validatePrefix(input.settings?.rawMaterialExpenseAccountId, "4", "INVALID_RAW_MATERIAL_EXPENSE_ACCOUNT_CLASS", "Konto neposrednega stroška surovin mora biti v razredu 4.");
  validatePrefix(input.settings?.inboundFreightExpenseAccountId, "4", "INVALID_INBOUND_FREIGHT_EXPENSE_ACCOUNT_CLASS", "Konto prevoznih storitev mora biti v razredu 4.");
  validatePrefix(
    input.settings?.drobniInventarExpenseAccountId,
    "404",
    "INVALID_SMALL_EQUIPMENT_EXPENSE_ACCOUNT_CLASS",
    "Konto stroška drobnega inventarja mora biti aktivna analitika 404*.",
  );
  const smallEquipmentAccountId = input.settings?.drobniInventarExpenseAccountId;
  const smallEquipmentAccount = smallEquipmentAccountId
    ? accountById.get(smallEquipmentAccountId)
    : undefined;
  if (smallEquipmentAccount && !/^404\d{4}$/.test(smallEquipmentAccount.code)) {
    addError(
      "INVALID_SMALL_EQUIPMENT_EXPENSE_ACCOUNT_CLASS",
      "Konto stroška drobnega inventarja mora biti aktivna sedemmestna analitika 404*.",
      { accountId: smallEquipmentAccount.id, accountCode: smallEquipmentAccount.code },
    );
  }
  validatePrefix(input.settings?.payablesAccountId, "220", "INVALID_PAYABLES_ACCOUNT_CLASS", "Konto obveznosti do dobaviteljev mora biti iz razreda 220.");
  validatePrefix(input.settings?.cashAccountId, "100", "INVALID_CASH_ACCOUNT_CLASS", "Konto gotovine mora biti analitika skupine 100.");
  const isInvoice = input.receipt.documentType === "RACUN";
  const isCashPaidInvoice = isInvoice
    && (input.receipt.cashPaid === true
      || (input.receipt.cashPaid == null && normalizeIncomingPaymentMethod(input.receipt.paymentMethod) === "cash"));

  for (const line of input.lines) {
    if (input.receipt.documentType === "DOBROPIS" && line.returnablePackaging) continue;
    if (!line.articleId && (line.lineType === "poraba_surovin" || line.lineType === "prevoz")) {
      // Neposredni stroški nimajo artikla in nikoli ne vplivajo na zalogo.
    } else if (!line.articleId || !line.articleType) {
      addError("UNMATCHED_ARTICLE", "Postavka nima veljavnega povezanega artikla.", { lineId: line.id });
      continue;
    }
    const net = numeric(line.netAmount);
    // Vrednost 0 pri povratni embalaži ni manjkajoč podatek: dobavitelj jo
    // lahko navede kot fizični prejem oziroma vračilo brez kavcijskega zneska.
    // Količina ostane v evidenci embalaže, računovodska temeljnica pa nima
    // nobenega denarnega učinka.
    if (line.returnablePackaging && net === 0) continue;
    const rate = numeric(line.vatRate);
    const explicitVat = optionalNumeric(line.vatAmount);
    if (net === null || net <= 0) {
      addError("INVALID_AMOUNT", "Neto znesek postavke mora biti pozitivno število.", { lineId: line.id });
      continue;
    }
    if (rate === null || rate < 0 || !rateKey(rate)) {
      addError("UNSUPPORTED_VAT_RATE", "DDV stopnja postavke ni podprta.", { lineId: line.id, rate: line.vatRate });
      continue;
    }
    if (explicitVat !== null && (!Number.isFinite(explicitVat) || explicitVat < 0)) {
      addError("INVALID_VAT_AMOUNT", "Znesek DDV postavke ni veljaven.", { lineId: line.id });
      continue;
    }
    if (line.lineType !== "zaloga" && line.lineType !== "poraba_surovin" && line.lineType !== "prevoz") {
      addError("INVALID_LINE_TREATMENT", "Računovodska obravnava postavke ni podprta.", { lineId: line.id });
      continue;
    }
    const netAmount = cents(net);
    const vatAmount = cents(explicitVat ?? net * rate / 100);
    if (line.returnablePackaging) {
      if (line.vatCodeResolution === "unsupported") {
        addError(
          "UNSUPPORTED_INPUT_VAT_REGIME",
          "Knjiženje prejemnice trenutno podpira samo običajne domače odbitne P22/P95/P5 kode.",
          { lineId: line.id, vatCodeId: line.vatCodeId },
        );
      } else if (line.vatCodeResolution === "invalid") {
        addError(
          "INVALID_INPUT_VAT_CODE",
          "DDV koda postavke ni veljavna vhodna koda za datum dokumenta.",
          { lineId: line.id, vatCodeId: line.vatCodeId },
        );
      } else if (vatAmount > 0 && (!line.vatCodeId || !line.vatCodeValid)) {
        const issueCode = line.vatCodeResolution === "ambiguous"
          ? "AMBIGUOUS_INPUT_VAT_CODE"
          : "MISSING_INPUT_VAT_CODE";
        addError(
          issueCode,
          issueCode === "AMBIGUOUS_INPUT_VAT_CODE"
            ? "Za postavko obstaja več možnih vhodnih DDV kod."
            : "Postavka nima podprte vhodne DDV kode.",
          { lineId: line.id, vatCodeId: line.vatCodeId },
        );
      }
      const packagingAccount = input.settings?.returnablePackagingAccountId ?? null;
      if (!packagingAccount) addError("MISSING_RETURNABLE_PACKAGING_ACCOUNT", "Konto povratne embalaže (315) ni nastavljen.", { lineId: line.id });
      addDebit(packagingAccount, netAmount, "Embalaža", { lineId: line.id }, vatAmount > 0 ? line.vatCodeId : null, vatAmount);
      if (vatAmount > 0) {
        const key = rateKey(rate);
        if (key && key !== "0") addVat(key, vatAmount, { lineId: line.id });
      }
      if (isInvoice) {
        netCents += netAmount;
        vatCents += vatAmount;
        continue;
      }
      const settlementAccount = input.settings?.payablesAccountId ?? null;
      if (!settlementAccount) {
        addError("MISSING_PAYABLES_ACCOUNT", "Konto obveznosti do dobaviteljev (220) ni nastavljen.", { lineId: line.id });
      }
      if (settlementAccount) rawLines.push({
        accountId: settlementAccount, side: "credit", cents: netAmount + vatAmount,
        description: "Embalaža", partnerId: input.receipt.supplierId,
        costCenterId: input.receipt.costCenterId, vatCodeId: null, vatAmountCents: 0,
      });
      continue;
    }
    if (line.vatCodeResolution === "unsupported") {
      addError(
        "UNSUPPORTED_INPUT_VAT_REGIME",
        "Knjiženje prejemnice trenutno podpira samo običajne domače odbitne P22/P95/P5 kode.",
        { lineId: line.id, vatCodeId: line.vatCodeId },
      );
    } else if (line.vatCodeResolution === "invalid") {
      addError(
        "INVALID_INPUT_VAT_CODE",
        "DDV koda postavke ni veljavna vhodna koda za datum dokumenta.",
        { lineId: line.id, vatCodeId: line.vatCodeId },
      );
    } else if (!line.vatCodeId || !line.vatCodeValid) {
      const issueCode = line.vatCodeResolution === "ambiguous"
          ? "AMBIGUOUS_INPUT_VAT_CODE"
          : "MISSING_INPUT_VAT_CODE";
      addError(
        issueCode,
        issueCode === "AMBIGUOUS_INPUT_VAT_CODE"
          ? "Za postavko obstaja več možnih vhodnih DDV kod."
          : "Postavka nima podprte vhodne DDV kode.",
        { lineId: line.id, vatCodeId: line.vatCodeId },
      );
    }
    netCents += netAmount;
    vatCents += vatAmount;
    const accountId = line.drobniInventar
      ? input.settings?.drobniInventarExpenseAccountId ?? null
      : line.lineType === "poraba_surovin"
      ? input.settings?.rawMaterialExpenseAccountId ?? null
      : line.lineType === "prevoz"
        ? input.settings?.inboundFreightExpenseAccountId ?? null
      : chooseInventory(line.articleType, { lineId: line.id, articleType: line.articleType });
    if (line.drobniInventar && !accountId) {
      addError(
        "MISSING_SMALL_EQUIPMENT_EXPENSE_ACCOUNT",
        "Konto stroška drobnega inventarja (aktivna analitika 404*) ni nastavljen; knjiženje prejemnice je blokirano.",
        { lineId: line.id },
      );
    } else addDebit(
      accountId,
      netAmount,
      line.drobniInventar
        ? "Drobni inventar"
        : line.lineType === "poraba_surovin"
        ? "Strošek surovin"
        : line.lineType === "prevoz"
          ? "Prevozne storitve pri nabavi"
        : line.articleType === "material"
          ? "Surovina"
          : "Blago",
      { lineId: line.id },
      vatAmount > 0 ? line.vatCodeId : null,
      vatAmount,
    );
    const key = rateKey(rate);
    if (vatAmount > 0 && key && key !== "0") addVat(key, vatAmount, { lineId: line.id });
  }

  const stockTypes = [...new Set(input.lines
    .filter(line => line.lineType === "zaloga" && (line.articleType === "material" || line.articleType === "blago"))
    .map(line => line.articleType as "material" | "blago"))];
  for (const cost of input.dependentCosts) {
    const net = numeric(cost.netAmount);
    const rate = numeric(cost.vatRate);
    if (net === null || net <= 0) {
      addError("INVALID_DEPENDENT_COST_AMOUNT", "Znesek odvisnega stroška mora biti pozitiven.", { costId: cost.id });
      continue;
    }
    if (rate === null || rate < 0 || !rateKey(rate)) {
      addError("UNSUPPORTED_VAT_RATE", "DDV stopnja odvisnega stroška ni podprta.", { costId: cost.id, rate: cost.vatRate });
      continue;
    }
    if (cost.treatment !== "zaloga" && cost.treatment !== "strosek") {
      addError("INVALID_DEPENDENT_COST_TREATMENT", "Obravnava odvisnega stroška ni podprta.", { costId: cost.id });
      continue;
    }
    const netAmount = cents(net);
    const vatAmount = cents(net * rate / 100);
    if (!cost.vatCodeId) {
      addError(
        cost.vatCodeResolution === "ambiguous" ? "AMBIGUOUS_INPUT_VAT_CODE" : "MISSING_INPUT_VAT_CODE",
        cost.vatCodeResolution === "ambiguous"
          ? "Za odvisni strošek obstaja več možnih vhodnih DDV kod."
          : "Odvisni strošek nima podprte vhodne DDV kode.",
        { costId: cost.id },
      );
    }
    netCents += netAmount;
    vatCents += vatAmount;
    let accountId: string | null = null;
    if (cost.treatment === "strosek") {
      accountId = input.settings?.otherCostsAccountId ?? null;
    } else if (stockTypes.length === 1) {
      accountId = chooseInventory(stockTypes[0], { costId: cost.id });
    } else {
      accountId = input.settings?.inventoryAccountId ?? null;
      if (accountId) warnings.push({
        code: "DEPENDENT_COST_INVENTORY_FALLBACK",
        message: "Odvisnega stroška ni mogoče zanesljivo razporediti med material in blago; uporabljen je splošni konto zaloge.",
        context: { costId: cost.id },
      });
    }
    addDebit(
      accountId,
      netAmount,
      cost.name,
      { costId: cost.id, treatment: cost.treatment },
      cost.vatCodeId,
      vatAmount,
    );
    const key = rateKey(rate);
    if (vatAmount > 0 && key && key !== "0") addVat(key, vatAmount, { costId: cost.id });
  }

  const grossCents = netCents + vatCents;
  const creditAccountId = isInvoice
    ? input.settings?.payablesAccountId
    : input.settings?.nabavaObracunAccountId;
  if (!creditAccountId) {
    addError(
      isInvoice ? "MISSING_PAYABLES_ACCOUNT" : "MISSING_NABAVA_OBRACUN_ACCOUNT",
      isInvoice
        ? "Konto obveznosti do dobaviteljev (220) ni nastavljen."
        : "Konto obračuna nabave (300) ni nastavljen.",
    );
  } else if (grossCents > 0) {
    rawLines.push({
      accountId: creditAccountId,
      side: "credit",
      cents: grossCents,
      description: isInvoice ? "Obveznost do dobavitelja" : "Obračun nabave materiala",
      partnerId: input.receipt.supplierId,
      costCenterId: input.receipt.costCenterId,
      vatCodeId: null,
      vatAmountCents: 0,
    });
  }
  if (isCashPaidInvoice && grossCents > 0) {
    const cashAccountId = input.settings?.cashAccountId;
    const payablesAccountId = input.settings?.payablesAccountId;
    if (!cashAccountId) {
      addError("MISSING_CASH_ACCOUNT", "Konto gotovine (100) ni nastavljen.");
    }
    if (payablesAccountId) {
      rawLines.push({
        accountId: payablesAccountId,
        side: "debit",
        cents: grossCents,
        description: "Zapiranje obveznosti – gotovinsko plačilo",
        partnerId: input.receipt.supplierId,
        costCenterId: input.receipt.costCenterId,
        vatCodeId: null,
        vatAmountCents: 0,
      });
    }
    if (cashAccountId) {
      rawLines.push({
        accountId: cashAccountId,
        side: "credit",
        cents: grossCents,
        description: "Plačano z gotovino",
        partnerId: null,
        costCenterId: input.receipt.costCenterId,
        vatCodeId: null,
        vatAmountCents: 0,
      });
    }
  }

  const merged = new Map<string, typeof rawLines[number]>();
  for (const line of rawLines) {
    const key = [
      line.accountId,
      line.side,
      line.partnerId ?? "",
      line.costCenterId ?? "",
    ].join("|");
    const previous = merged.get(key);
    if (previous) {
      previous.cents += line.cents;
      previous.vatAmountCents += line.vatAmountCents;
      if (previous.vatCodeId !== line.vatCodeId) previous.vatCodeId = null;
    }
    else merged.set(key, { ...line });
  }
  const normalized = [...merged.values()].filter(line => line.cents > 0);
  for (const line of normalized) {
    const account = accountById.get(line.accountId);
    if (!account) {
      addError("ACCOUNT_NOT_FOUND", "Nastavljeni konto ne pripada podjetju.", { accountId: line.accountId });
      continue;
    }
    // POS uporablja stroškovno mesto enote kot privzeto dimenzijo. Na vrsticah
    // kontov, ki te dimenzije ne dovoljujejo, ga generator varno izpusti.
    if (account.costCenterPolicy === "not_allowed") {
      line.costCenterId = null;
    }
    if (!account.isActive || !account.allowsPosting) {
      addError("ACCOUNT_NOT_POSTABLE", `Konto ${account.code} ni aktiven ali ne dovoljuje knjiženja.`, { accountId: account.id });
    }
    if (account.requiresPartner && !line.partnerId) {
      addError("MISSING_REQUIRED_PARTNER", `Konto ${account.code} zahteva partnerja.`, { accountId: account.id });
    }
    if ((account.costCenterPolicy === "required" || (!account.costCenterPolicy && account.requiresCostCenter)) && !line.costCenterId) {
      addError("MISSING_REQUIRED_COST_CENTER", `Konto ${account.code} zahteva stroškovno mesto.`, { accountId: account.id });
    }
    if (account.requiresProject) {
      addError("MISSING_REQUIRED_PROJECT", `Konto ${account.code} zahteva projekt.`, { accountId: account.id });
    }
  }
  const debitCents = normalized.filter(line => line.side === "debit").reduce((sum, line) => sum + line.cents, 0);
  const creditCents = normalized.filter(line => line.side === "credit").reduce((sum, line) => sum + line.cents, 0);
  if (debitCents !== creditCents) {
    addError("UNBALANCED_ENTRY", "Temeljnica ni uravnotežena.", { debit: money(debitCents), credit: money(creditCents) });
  }

  const lines = normalized.map(line => {
    const account = accountById.get(line.accountId);
    return {
      accountId: line.accountId,
      accountCode: account?.code ?? "",
      accountName: account?.name ?? "",
      side: line.side,
      amount: money(line.cents),
      description: line.description,
      partnerId: line.partnerId,
      costCenterId: line.costCenterId,
      vatCodeId: line.vatCodeId,
      vatAmount: line.vatAmountCents > 0 ? money(line.vatAmountCents) : null,
    };
  });
  const hashPayload = {
    receipt: input.receipt,
    lines,
    debitTotal: money(debitCents),
    creditTotal: money(creditCents),
    netAmount: money(netCents),
    warnings,
    blockingErrors,
  };
  return {
    header: {
      receiptId: input.receipt.id,
      receiptNumber: input.receipt.number,
      entryDate: input.receipt.documentDate,
      documentDate: input.receipt.documentDate,
      taxDate: input.receipt.taxDate,
      receiptDate: input.receipt.receiptDate,
      description: input.receipt.supplierDocumentNumber?.trim()
        ? `POS prejemnica ${input.receipt.number ?? input.receipt.id} – dokument ${input.receipt.supplierDocumentNumber.trim()}`
        : `POS prejemnica ${input.receipt.number ?? input.receipt.id}`,
      reference: input.receipt.supplierDocumentNumber?.trim() || `POS:NABAVA:${input.receipt.id}`,
      sourceType: "document",
      createdBy: "pos-receipt-booking",
    },
    lines,
    debitTotal: money(debitCents),
    creditTotal: money(creditCents),
    netAmount: money(netCents),
    warnings,
    blockingErrors,
    previewHash: createHash("sha256").update(JSON.stringify(hashPayload)).digest("hex"),
    existing: { state: input.existingState, journalEntryId: input.existingJournalEntryId },
  };
}

async function loadInput(executor: any, companyId: string, enotaId: number, receiptId: number): Promise<ReceiptBookingInput | null> {
  const [receipt] = await executor.select({
    id: prejemniceTable.id,
    number: prejemniceTable.stevilka,
    supplierDocumentNumber: prejemniceTable.stDokumenta,
    date: sql<string>`to_char(${prejemniceTable.datum}, 'YYYY-MM-DD')`,
    documentDate: sql<string>`COALESCE(${prejemniceTable.datumDokumenta}, ${prejemniceTable.datum}::date)::text`,
    documentType: prejemniceTable.vrstaDokumenta,
    paymentMethod: prejemniceTable.placilniNacin,
    cashPaid: prejemniceTable.placanoZGotovino,
    supplierId: prejemniceTable.dobaviteljId,
    costCenterId: enoteTable.costCenterId,
  }).from(prejemniceTable)
    .innerJoin(enoteTable, and(eq(enoteTable.id, prejemniceTable.enotaId), eq(enoteTable.companyId, companyId)))
    .where(and(eq(prejemniceTable.id, receiptId), eq(prejemniceTable.enotaId, enotaId)))
    .limit(1);
  if (!receipt) return null;

  // A node-postgres transaction owns one client. Keep these reads sequential:
  // concurrent client.query calls are deprecated and can race protocol state.
  const lineRows = await executor.select({
      id: prejemnicePostavkeTable.id,
      articleId: prejemnicePostavkeTable.artikelId,
      articleType: artikliTable.vrstaArtikla,
      returnablePackaging: artikliTable.povratnaEmbalaza,
      drobniInventar: artikliTable.drobniInventar,
      lineType: prejemnicePostavkeTable.vrsticaTip,
      preferredNetAmount: prejemnicePostavkeTable.ddvOsnova,
      netAmount: prejemnicePostavkeTable.netoZnesek,
      fallbackNetAmount: prejemnicePostavkeTable.skupaj,
      vatRate: prejemnicePostavkeTable.ddvStopnja,
      vatAmount: prejemnicePostavkeTable.ddvZnesek,
      vatCodeId: prejemnicePostavkeTable.vatCodeId,
      vatCategory: prejemnicePostavkeTable.ddvKategorija,
    }).from(prejemnicePostavkeTable)
      .leftJoin(artikliTable, and(eq(artikliTable.id, prejemnicePostavkeTable.artikelId), eq(artikliTable.enotaId, enotaId)))
      .where(eq(prejemnicePostavkeTable.prejemnicaId, receiptId));
  const costs = await executor.select().from(prejemniceOdvisniStroskiTable)
    .where(eq(prejemniceOdvisniStroskiTable.prejemnicaId, receiptId));
  const settingsRows = await executor.select().from(posBookingSettingsTable)
    .where(eq(posBookingSettingsTable.companyId, companyId)).limit(1);
  let resolvedSettings = settingsRows[0] ?? null;
  if (
    resolvedSettings
    && !resolvedSettings.returnablePackagingAccountId
    && lineRows.some((line: any) => Boolean(line.returnablePackaging))
  ) {
    const [defaultPackagingAccount] = await executor.select({ id: accountsTable.id })
      .from(accountsTable)
      .where(and(
        eq(accountsTable.companyId, companyId),
        eq(accountsTable.code, "3107000"),
        eq(accountsTable.isActive, true),
        eq(accountsTable.allowsPosting, true),
      ))
      .limit(1);
    if (defaultPackagingAccount) {
      resolvedSettings = {
        ...resolvedSettings,
        returnablePackagingAccountId: defaultPackagingAccount.id,
      };
    }
  }
  const supplierRows = receipt.supplierId
    ? await executor.select({ id: counterpartiesTable.id }).from(counterpartiesTable)
        .where(and(
          eq(counterpartiesTable.id, receipt.supplierId),
          eq(counterpartiesTable.companyId, companyId),
          eq(counterpartiesTable.isActive, true),
          inArray(counterpartiesTable.type, ["supplier", "both"]),
        )).limit(1)
    : [];
  const periodRows = await executor.select({ id: accountingPeriodsTable.id }).from(accountingPeriodsTable)
      .where(and(
        eq(accountingPeriodsTable.companyId, companyId),
        eq(accountingPeriodsTable.status, "open"),
        lte(accountingPeriodsTable.startDate, receipt.documentDate),
        gte(accountingPeriodsTable.endDate, receipt.documentDate),
      )).limit(1);
  const sourceRows = await executor.select({
    journalEntryId: journalEntriesTable.id,
    status: journalEntriesTable.status,
    reference: journalEntriesTable.reference,
    createdBy: journalEntriesTable.createdBy,
    sourceCount: sql<number>`(
      SELECT count(*)::int FROM pos_receipt_booking_sources ownership
      WHERE ownership.journal_entry_id = ${journalEntriesTable.id}
    )`,
    ownsReceipt: sql<boolean>`true`,
  }).from(posReceiptBookingSourcesTable)
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, posReceiptBookingSourcesTable.journalEntryId))
    .where(and(eq(posReceiptBookingSourcesTable.prejemnicaId, receiptId), eq(journalEntriesTable.companyId, companyId)));
  const legacyRows = await executor.select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(and(
      eq(journalEntriesTable.companyId, companyId),
      or(
        eq(journalEntriesTable.reference, `POS:PREJEMNICA:${receipt.date}`),
        eq(journalEntriesTable.reference, `POS:PREJEMNICA:${receipt.date}:E${enotaId}`),
        like(journalEntriesTable.reference, `POS:PREJEMNICA:${receipt.date}:%:E${enotaId}`),
      ),
    ));
  const vatCandidates = await executor.select({
    id: vatCodeTable.id,
    code: vatCodeTable.code,
    rate: vatCodeTable.rate,
    isReverseCharge: vatCodeTable.isReverseCharge,
    isImport: vatCodeTable.isImport,
    kprVatField: vatCodeTable.kprVatField,
  }).from(vatCodeTable).where(and(
    eq(vatCodeTable.direction, "IN"),
    lte(vatCodeTable.validFrom, receipt.date),
    sql`(${vatCodeTable.validTo} IS NULL OR ${vatCodeTable.validTo} >= ${receipt.date})`,
  ));
  const settings = resolvedSettings;
  const candidates = vatCandidates.map((candidate: any) => ({
    id: candidate.id,
    code: candidate.code,
    rate: String(candidate.rate),
    isReverseCharge: candidate.isReverseCharge,
    isImport: candidate.isImport,
    kprVatField: candidate.kprVatField,
  }));
  const ordinaryCandidates = candidates.filter(isSupportedOrdinaryInputVatCandidate);
  const accountIds = settings ? [...new Set([
    settings.inventoryMaterialAccountId, settings.inventoryGoodsAccountId, settings.inventoryAccountId,
    settings.otherCostsAccountId, settings.rawMaterialExpenseAccountId, settings.inboundFreightExpenseAccountId,
    settings.nabavaObracunAccountId, settings.cashAccountId, settings.inputVatAccountId,
    settings.inputVat22AccountId, settings.inputVat95AccountId, settings.inputVat5AccountId,
    settings.payablesAccountId, settings.returnablePackagingAccountId,
    settings.drobniInventarExpenseAccountId,
  ].filter((id): id is string => Boolean(id)))] : [];
  const accountRows = accountIds.length
    ? await executor.select({
        id: accountsTable.id, code: accountsTable.code, name: accountsTable.name,
        isActive: accountsTable.isActive, allowsPosting: accountsTable.allowsPosting,
        requiresPartner: accountsTable.requiresPartner, requiresCostCenter: accountsTable.requiresCostCenter,
        costCenterPolicy: accountsTable.costCenterPolicy,
        requiresProject: accountsTable.requiresProject,
      }).from(accountsTable).where(and(eq(accountsTable.companyId, companyId), inArray(accountsTable.id, accountIds)))
    : [];
  const existingById = new Map<string, (typeof sourceRows)[number]>();
  for (const row of sourceRows) {
    const previous = existingById.get(row.journalEntryId);
    existingById.set(row.journalEntryId, previous
      ? {
          ...previous,
          ownsReceipt: Boolean(previous.ownsReceipt || row.ownsReceipt),
          sourceCount: Math.max(Number(previous.sourceCount), Number(row.sourceCount)),
        }
      : row);
  }
  const existingRows = [...existingById.values()];
  const legacySharedDraft = legacyRows.length > 0 || existingRows.some((row: any) => {
    const sourceCount = Number(row.sourceCount);
    const safelyOwned = sourceCount === 1
      && row.ownsReceipt
      && row.createdBy === "pos-receipt-booking";
    return !safelyOwned;
  });
  const posted = existingRows.find((row: any) => row.status !== "draft");
  const draft = existingRows.find((row: any) => row.status === "draft");
  return {
    receipt: {
      ...receipt,
      supplierExists: supplierRows.length > 0,
      periodId: periodRows[0]?.id ?? null,
      taxDate: receipt.documentDate,
      receiptDate: receipt.date,
    },
    lines: lineRows.map((line: any) => {
      const rate = line.vatRate == null ? null : String(line.vatRate);
      if (line.vatCodeId) {
        const explicitCandidate = candidates.find((candidate: any) => candidate.id === line.vatCodeId);
        const explicit = ordinaryCandidates.find((candidate: any) =>
          candidate.id === line.vatCodeId && Number(candidate.rate) === Number(rate));
        return {
          ...line,
          netAmount: line.preferredNetAmount ?? line.netAmount ?? line.fallbackNetAmount,
          vatCodeValid: Boolean(explicit),
          vatCodeResolution: explicit
            ? "matched" as const
            : explicitCandidate
              ? "unsupported" as const
              : "invalid" as const,
        };
      }
      const resolution = resolveInputVatCode(ordinaryCandidates, line.vatCategory ?? null, rate);
      return {
        ...line,
        netAmount: line.preferredNetAmount ?? line.netAmount ?? line.fallbackNetAmount,
        vatCodeId: resolution.kind === "matched" ? resolution.vatCodeId : null,
        vatCodeValid: resolution.kind === "matched",
        vatCodeResolution: resolution.kind,
      };
    }),
    dependentCosts: costs.map((cost: any) => {
      const rate = cost.ddvStopnja == null ? null : String(cost.ddvStopnja);
      const resolution = resolveInputVatCode(ordinaryCandidates, null, rate);
      return {
        id: cost.id,
        name: cost.naziv,
        treatment: cost.obravnava,
        netAmount: cost.znesek,
        vatRate: cost.ddvStopnja,
        vatCodeId: resolution.kind === "matched" ? resolution.vatCodeId : null,
        vatCodeResolution: resolution.kind,
      };
    }),
    settings,
    accounts: accountRows,
    legacySharedDraft,
    existingState: posted ? "posted" : draft ? "draft" : "none",
    existingJournalEntryId: (posted ?? draft)?.journalEntryId ?? null,
  };
}

export async function getPosReceiptBookingPreview(companyId: string, enotaId: number, receiptId: number) {
  const input = await loadInput(db, companyId, enotaId, receiptId);
  return input ? buildPosReceiptBooking(input) : null;
}

export async function getPosReceiptBookingVatEvidence(companyId: string, enotaId: number, receiptId: number) {
  const input = await loadInput(db, companyId, enotaId, receiptId);
  return input ? buildPosReceiptVatEvidence(input) : [];
}

export class ReceiptBookingConflict extends Error {
  constructor(public readonly code: "STALE_PREVIEW" | "POSTED_SOURCE" | "LEGACY_SHARED_DRAFT", message: string) {
    super(message);
  }
}

export class ReceiptEditConflict extends Error {
  constructor(public readonly code: "RECEIPT_NOT_FOUND" | "RECEIPT_BOOKING_POSTED" | "RECEIPT_CONFIRMED" | "CREDIT_NOTE_ALLOCATION_HISTORY_LOCKED", message: string) {
    super(message);
  }
}

export async function lockPosReceiptForEdit(
  tx: any,
  companyId: string,
  enotaId: number,
  receiptId: number,
): Promise<void> {
  const locked = await tx.execute(sql`
    SELECT p.id, p.status
    FROM prejemnice p
    INNER JOIN enote e ON e.id = p.enota_id AND e.company_id = ${companyId}
    WHERE p.id = ${receiptId} AND p.enota_id = ${enotaId}
    FOR UPDATE
  `);
  if (locked.rows.length === 0) {
    throw new ReceiptEditConflict("RECEIPT_NOT_FOUND", "Prejemnica ni najdena.");
  }
  if (locked.rows[0]?.status === "confirmed") {
    throw new ReceiptEditConflict("RECEIPT_CONFIRMED", "Potrjene prejemnice ni dovoljeno spreminjati.");
  }
  const immutable = await tx.execute(sql`
    SELECT je.id
    FROM journal_entries je
    WHERE je.status <> 'draft'
      AND (
        (je.company_id = ${companyId} AND je.reference = ${`POS:NABAVA:${receiptId}`})
        OR EXISTS (
          SELECT 1
          FROM pos_receipt_booking_sources src
          WHERE src.prejemnica_id = ${receiptId}
            AND src.journal_entry_id = je.id
        )
      )
    LIMIT 1
  `);
  if (immutable.rows.length > 0) {
    throw new ReceiptEditConflict("RECEIPT_BOOKING_POSTED", "Potrjene knjižbe prejemnice ni dovoljeno spreminjati.");
  }
}

/**
 * Serializes reconciliation work with receipt edits without treating the
 * already-posted booking as an error. Callers may only inspect/link the
 * receipt; all mutation endpoints must continue to use lockPosReceiptForEdit.
 */
export async function lockPosReceiptForReconciliation(
  tx: any,
  companyId: string,
  enotaId: number,
  receiptId: number,
): Promise<void> {
  const locked = await tx.execute(sql`
    SELECT p.id
    FROM prejemnice p
    INNER JOIN enote e ON e.id = p.enota_id AND e.company_id = ${companyId}
    WHERE p.id = ${receiptId} AND p.enota_id = ${enotaId}
    FOR UPDATE
  `);
  if (locked.rows.length === 0) {
    throw new ReceiptEditConflict("RECEIPT_NOT_FOUND", "Prejemnica ni najdena.");
  }
}

export function assertPosReceiptDraftRequest(preview: ReceiptBookingPreview, previewHash: string): void {
  if (preview.existing.state === "posted") {
    throw new ReceiptBookingConflict("POSTED_SOURCE", "Prejemnica je že vir potrjene temeljnice.");
  }
  if (preview.previewHash !== previewHash) {
    throw new ReceiptBookingConflict("STALE_PREVIEW", "Predogled ni več aktualen.");
  }
}

/** Remove only this receipt's private draft booking; posted entries are immutable. */
export async function invalidatePosReceiptBookingDraft(tx: any, receiptId: number): Promise<void> {
  const drafts = await tx.select({ id: journalEntriesTable.id })
    .from(posReceiptBookingSourcesTable)
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, posReceiptBookingSourcesTable.journalEntryId))
    .where(and(
      eq(posReceiptBookingSourcesTable.prejemnicaId, receiptId),
      eq(journalEntriesTable.status, "draft"),
      eq(journalEntriesTable.createdBy, "pos-receipt-booking"),
    ));
  if (drafts.length) {
    await tx.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, drafts.map((row: { id: string }) => row.id)));
  }
}

export async function savePosReceiptBookingDraft(
  companyId: string,
  enotaId: number,
  receiptId: number,
  previewHash: string,
): Promise<ReceiptBookingPreview | null> {
  return db.transaction(async tx => {
    try {
      await lockPosReceiptForReconciliation(tx, companyId, enotaId, receiptId);
    } catch (error) {
      if (error instanceof ReceiptEditConflict && error.code === "RECEIPT_NOT_FOUND") return null;
      throw error;
    }
    const input = await loadInput(tx, companyId, enotaId, receiptId);
    if (!input) return null;
    const preview = buildPosReceiptBooking(input);
    assertPosReceiptDraftRequest(preview, previewHash);
    if (preview.blockingErrors.length) return preview;

    const linked = await tx.select({
      id: journalEntriesTable.id,
      status: journalEntriesTable.status,
      reference: journalEntriesTable.reference,
      createdBy: journalEntriesTable.createdBy,
      sourceCount: sql<number>`(
        SELECT count(*)::int FROM pos_receipt_booking_sources ownership
        WHERE ownership.journal_entry_id = ${journalEntriesTable.id}
      )`,
    })
      .from(posReceiptBookingSourcesTable)
      .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, posReceiptBookingSourcesTable.journalEntryId))
      .where(and(
        eq(posReceiptBookingSourcesTable.prejemnicaId, receiptId),
        eq(journalEntriesTable.companyId, companyId),
      ));
    if (linked.some(row => row.status !== "draft")) {
      throw new ReceiptBookingConflict("POSTED_SOURCE", "Vir kaže na potrjeno temeljnico.");
    }
    if (linked.some(row =>
      Number(row.sourceCount) !== 1
      || row.createdBy !== "pos-receipt-booking")) {
      throw new ReceiptBookingConflict(
        "LEGACY_SHARED_DRAFT",
        "Povezani zbirni osnutek je treba pred posamičnim knjiženjem izrecno razrešiti.",
      );
    }
    const draftIds = linked.filter(row => row.status === "draft").map(row => row.id);
    if (draftIds.length) await tx.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, draftIds));

    const [entry] = await tx.insert(journalEntriesTable).values({
      companyId,
      periodId: input.receipt.periodId!,
      entryDate: preview.header.entryDate,
      documentDate: preview.header.documentDate,
      taxDate: preview.header.taxDate,
      receiptDate: preview.header.receiptDate,
      description: preview.header.description,
      reference: preview.header.reference,
      status: "draft",
      sourceType: "document",
      createdBy: "pos-receipt-booking",
    }).returning({ id: journalEntriesTable.id });
    await tx.insert(journalEntryLinesTable).values(preview.lines.map((line, sequence) => ({
      entryId: entry.id,
      accountId: line.accountId,
      side: line.side,
      amount: line.amount,
      description: line.description,
      sequence,
      partnerId: line.partnerId,
      costCenterId: line.costCenterId,
      vatCodeId: line.vatCodeId,
      vatAmount: line.vatAmount,
    })));
    await tx.insert(posReceiptBookingSourcesTable).values({
      prejemnicaId: receiptId,
      journalEntryId: entry.id,
      netAmount: preview.netAmount,
      packagingReconciliationSafe: input.receipt.documentType === "DOBROPIS"
        && input.lines.some(line => line.returnablePackaging),
    });
    return { ...preview, existing: { state: "draft", journalEntryId: entry.id } };
  });
}