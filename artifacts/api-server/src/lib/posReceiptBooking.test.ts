import { describe, expect, it } from "vitest";
import {
  assertPosReceiptDraftRequest,
  buildPosReceiptBooking,
  buildPosReceiptVatEvidence,
  isSupportedOrdinaryInputVatCandidate,
  normalizeIncomingPaymentMethod,
  type ReceiptBookingAccount,
  type ReceiptBookingInput,
} from "./posReceiptBooking";
import { resolveInputVatCode } from "./uvoz/vat-code-resolver";

const account = (id: string, code: string, overrides: Partial<ReceiptBookingAccount> = {}): ReceiptBookingAccount => ({
  id,
  code,
  name: `Konto ${code}`,
  isActive: true,
  allowsPosting: true,
  requiresPartner: false,
  requiresCostCenter: false,
  requiresProject: false,
  ...overrides,
});

function input(overrides: Partial<ReceiptBookingInput> = {}): ReceiptBookingInput {
  return {
    receipt: {
      id: 285,
      number: "P-285",
      date: "2026-02-20",
      documentDate: "2026-02-18",
      taxDate: "2026-02-18",
      receiptDate: "2026-02-20",
      paymentMethod: null,
      supplierId: "supplier",
      supplierExists: true,
      costCenterId: "center",
      periodId: "period",
    },
    lines: [{
      id: 1,
      articleId: 10,
      articleType: "material",
      lineType: "zaloga",
      netAmount: "100.00",
      vatRate: "22",
      vatAmount: "22.00",
      vatCodeId: "vat-code-in-22",
      vatCodeValid: true,
      vatCodeResolution: "matched",
    }],
    dependentCosts: [],
    settings: {
      inventoryMaterialAccountId: "material",
      inventoryGoodsAccountId: "goods",
      inventoryAccountId: "inventory",
      otherCostsAccountId: "cost",
      rawMaterialExpenseAccountId: null,
      inboundFreightExpenseAccountId: null,
      cashAccountId: "cash",
      payablesAccountId: "payables",
      nabavaObracunAccountId: "300",
      inputVatAccountId: "vat",
      inputVat22AccountId: "vat22",
      inputVat95AccountId: "vat95",
      inputVat5AccountId: "vat5",
    },
    accounts: [
      account("material", "310"),
      account("goods", "660"),
      account("inventory", "600"),
      account("cost", "419"),
      account("cash", "1000000"),
      account("payables", "2200000", { requiresPartner: true }),
      account("300", "3000000", { requiresPartner: true, requiresCostCenter: true }),
      account("vat", "160"),
      account("vat22", "16022"),
      account("vat95", "16095"),
      account("vat5", "16005"),
    ],
    existingState: "none",
    existingJournalEntryId: null,
    ...overrides,
  };
}

describe("buildPosReceiptBooking", () => {
  it("knjiži drobni inventar na namenski 404 strošek, vendar ohrani DDV in dobavitelja", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      lines: [{ ...base.lines[0]!, drobniInventar: true }],
      settings: { ...base.settings!, drobniInventarExpenseAccountId: "small-equipment" },
      accounts: [...base.accounts, account("small-equipment", "4040110")],
      receipt: { ...base.receipt, documentType: "RACUN" },
    }));

    expect(preview.blockingErrors).toEqual([]);
    expect(preview.lines).toContainEqual(expect.objectContaining({
      accountCode: "4040110",
      side: "debit",
      amount: "100.00",
    }));
    expect(preview.lines).not.toContainEqual(expect.objectContaining({ accountCode: "310" }));
    expect(preview.lines).toContainEqual(expect.objectContaining({
      accountCode: "2200000",
      side: "credit",
      partnerId: "supplier",
    }));
    expect(preview.lines).toContainEqual(expect.objectContaining({
      accountCode: "16022",
      side: "debit",
      amount: "22.00",
    }));
  });

  it("blokira knjiženje drobnega inventarja, ko namenski stroškovni konto manjka", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      lines: [{ ...base.lines[0]!, drobniInventar: true }],
      settings: { ...base.settings!, drobniInventarExpenseAccountId: null },
    }));

    expect(preview.blockingErrors).toContainEqual(expect.objectContaining({
      code: "MISSING_SMALL_EQUIPMENT_EXPENSE_ACCOUNT",
    }));
    expect(preview.lines).not.toContainEqual(expect.objectContaining({ accountCode: "310" }));
  });

  it("zahteva aktivno sedemmestno analitiko 404 za drobni inventar", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      lines: [{ ...base.lines[0]!, drobniInventar: true }],
      settings: { ...base.settings!, drobniInventarExpenseAccountId: "small-equipment" },
      accounts: [...base.accounts, account("small-equipment", "404")],
    }));

    expect(preview.blockingErrors).toContainEqual(expect.objectContaining({
      code: "INVALID_SMALL_EQUIPMENT_EXPENSE_ACCOUNT_CLASS",
    }));
  });

  it("samodejno prepozna samo nedvoumno gotovinsko plačilo", () => {
    expect(normalizeIncomingPaymentMethod("Plačano z gotovino")).toBe("cash");
    expect(normalizeIncomingPaymentMethod("CASH")).toBe("cash");
    expect(normalizeIncomingPaymentMethod("Nakazilo na TRR")).toBe("other");
    expect(normalizeIncomingPaymentMethod(null)).toBe("other");
  });

  it("izrecna kljukica ima prednost pred OCR besedilom", () => {
    const base = input();
    const checked = buildPosReceiptBooking(input({
      receipt: { ...base.receipt, documentType: "RACUN", paymentMethod: null, cashPaid: true },
    }));
    expect(checked.lines).toContainEqual(expect.objectContaining({ accountCode: "1000000", side: "credit" }));
    expect(checked.lines).toContainEqual(expect.objectContaining({ accountCode: "2200000", side: "credit" }));
    expect(checked.lines).toContainEqual(expect.objectContaining({ accountCode: "2200000", side: "debit" }));

    const unchecked = buildPosReceiptBooking(input({
      receipt: { ...base.receipt, documentType: "RACUN", paymentMethod: "gotovina", cashPaid: false },
    }));
    expect(unchecked.lines).toContainEqual(expect.objectContaining({ accountCode: "2200000", side: "credit" }));
    expect(unchecked.lines.some((line) => line.accountCode.startsWith("100"))).toBe(false);
  });

  it("gotovinsko plačan račun najprej pripozna in nato zapre obveznost", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      receipt: {
        ...base.receipt,
        documentType: "RACUN",
        paymentMethod: "Plačano z gotovino",
      },
    }));

    expect(preview.blockingErrors).toEqual([]);
    expect(preview.lines).toContainEqual(expect.objectContaining({
      accountCode: "1000000",
      side: "credit",
      amount: "122.00",
      description: "Plačano z gotovino",
    }));
    expect(preview.lines).toContainEqual(expect.objectContaining({
      accountCode: "2200000",
      side: "credit",
      amount: "122.00",
      description: "Obveznost do dobavitelja",
    }));
    expect(preview.lines).toContainEqual(expect.objectContaining({
      accountCode: "2200000",
      side: "debit",
      amount: "122.00",
      description: "Zapiranje obveznosti – gotovinsko plačilo",
    }));
    expect(preview.lines.some((line) => line.accountCode.startsWith("300"))).toBe(false);
  });

  it("na prepovedanih kontih samodejno izpusti stroškovno mesto enote", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      receipt: {
        ...base.receipt,
        documentType: "RACUN",
        cashPaid: true,
      },
      accounts: base.accounts.map(item => ({
        ...item,
        costCenterPolicy: ["1000000", "2200000", "16022"].includes(item.code)
          ? "not_allowed"
          : item.code === "310"
            ? "allowed"
            : item.costCenterPolicy,
      })),
    }));

    expect(preview.blockingErrors).toEqual([]);
    expect(preview.lines.filter(line =>
      ["1000000", "2200000", "16022"].includes(line.accountCode),
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: "1000000", costCenterId: null }),
      expect.objectContaining({ accountCode: "2200000", costCenterId: null }),
      expect.objectContaining({ accountCode: "16022", costCenterId: null }),
    ]));
    expect(preview.lines).toContainEqual(expect.objectContaining({
      accountCode: "310",
      costCenterId: "center",
    }));
  });

  it("gotovinski račun s povratno embalažo ustvari in zapre obveznost 220", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      receipt: {
        ...base.receipt,
        documentType: "RACUN",
        paymentMethod: "gotovina",
      },
      lines: [{
        ...base.lines[0],
        returnablePackaging: true,
        vatRate: "0",
        vatAmount: "0",
        vatCodeId: "vat0",
      }],
      settings: {
        ...base.settings!,
        returnablePackagingAccountId: "packaging",
      },
      accounts: [
        ...base.accounts,
        account("packaging", "3107000"),
      ],
    }));

    expect(preview.blockingErrors).toEqual([]);
    expect(preview.lines).toContainEqual(expect.objectContaining({
      accountCode: "1000000",
      side: "credit",
      amount: "100.00",
    }));
    expect(preview.lines).toContainEqual(expect.objectContaining({
      accountCode: "2200000",
      side: "credit",
      amount: "100.00",
    }));
    expect(preview.lines).toContainEqual(expect.objectContaining({
      accountCode: "2200000",
      side: "debit",
      amount: "100.00",
    }));
  });

  it("neposredni stroški brez artikla uporabijo ločena konta in ne zahtevajo zaloge", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      lines: [
        {
          ...base.lines[0],
          id: 1,
          articleId: null,
          articleType: null,
          lineType: "poraba_surovin",
          netAmount: "40.00",
          vatAmount: "8.80",
        },
        {
          ...base.lines[0],
          id: 2,
          articleId: null,
          articleType: null,
          lineType: "prevoz",
          netAmount: "10.00",
          vatAmount: "2.20",
        },
      ],
      settings: {
        ...base.settings!,
        rawMaterialExpenseAccountId: "raw-expense",
        inboundFreightExpenseAccountId: "freight-expense",
      },
      accounts: [
        ...base.accounts,
        account("raw-expense", "4001000"),
        account("freight-expense", "4110000"),
      ],
    }));

    expect(preview.blockingErrors).toEqual([]);
    expect(preview.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        accountCode: "4001000",
        amount: "40.00",
        description: "Strošek surovin",
      }),
      expect.objectContaining({
        accountCode: "4110000",
        amount: "10.00",
        description: "Prevozne storitve pri nabavi",
      }),
    ]));
  });

  it("blokira DOBROPIS v običajnem toku, da ne ustvari druge temeljnice 3107/220", () => {
    const preview = buildPosReceiptBooking(input({
      receipt: { ...input().receipt, documentType: "DOBROPIS" },
      lines: [{ ...input().lines[0], returnablePackaging: true }],
    }));
    expect(preview.blockingErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "CREDIT_NOTE_REQUIRES_PACKAGING_ALLOCATION" }),
    ]));
  });

  it("ne blokira DOBROPIS brez povratne embalaže v običajnem toku", () => {
    const preview = buildPosReceiptBooking(input({ receipt: { ...input().receipt, documentType: "DOBROPIS" } }));
    expect(preview.blockingErrors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "CREDIT_NOTE_REQUIRES_PACKAGING_ALLOCATION" }),
    ]));
  });

  it("pri mešanem DOBROPISU knjiži le ne-embalažno vrstico", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      receipt: { ...base.receipt, documentType: "DOBROPIS" },
      lines: [
        { ...base.lines[0], returnablePackaging: true },
        { ...base.lines[0], id: 2, netAmount: "20.00", vatAmount: "4.40", returnablePackaging: false },
      ],
    }));
    expect(preview.blockingErrors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "CREDIT_NOTE_REQUIRES_PACKAGING_ALLOCATION" }),
    ]));
    expect(preview.lines.every(line => line.amount !== "100.00")).toBe(true);
    expect(preview.netAmount).toBe("20.00");
  });

  it("knjiži prevzem materiala proti obračunu nabave v skupini 300", () => {
    const preview = buildPosReceiptBooking(input());
    expect(preview.blockingErrors).toEqual([]);
    expect(preview.debitTotal).toBe("122.00");
    expect(preview.creditTotal).toBe("122.00");
    expect(preview.netAmount).toBe("100.00");
    expect(preview.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        accountCode: "310",
        side: "debit",
        amount: "100.00",
        description: "Surovina",
        vatCodeId: "vat-code-in-22",
        vatAmount: "22.00",
      }),
      expect.objectContaining({ accountCode: "16022", side: "debit", amount: "22.00", vatCodeId: null }),
      expect.objectContaining({
        accountCode: "3000000",
        side: "credit",
        amount: "122.00",
        partnerId: "supplier",
        costCenterId: "center",
      }),
    ]));
  });

  it("isti konto prikaže samo enkrat in sešteje vse artikle", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      lines: [
        base.lines[0],
        { ...base.lines[0], id: 2, articleId: 11, netAmount: "25.00", vatAmount: "5.50" },
        { ...base.lines[0], id: 3, articleId: 12, netAmount: "15.00", vatAmount: "3.30" },
      ],
    }));
    const materialLines = preview.lines.filter((line) => line.accountCode === "310");
    expect(materialLines).toHaveLength(1);
    expect(materialLines[0]).toEqual(expect.objectContaining({
      amount: "140.00",
      description: "Surovina",
      vatAmount: "30.80",
    }));
  });

  it("povratno embalažo pri 0 % knjiži na 3107/220", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      lines: [{ ...base.lines[0], returnablePackaging: true, netAmount: "12.34", vatRate: "0", vatAmount: "0", vatCodeId: "vat0" }],
      settings: { ...base.settings!, returnablePackagingAccountId: "3107", payablesAccountId: "220" },
      accounts: [...base.accounts, account("3107", "3107000"), account("220", "2200000")],
    }));
    expect(preview.blockingErrors).toEqual([]);
    expect(preview.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: "3107000", side: "debit", amount: "12.34", description: "Embalaža" }),
      expect.objectContaining({ accountCode: "2200000", side: "credit", amount: "12.34", description: "Embalaža", partnerId: "supplier" }),
    ]));
    expect(preview.lines.some(line => line.accountCode.startsWith("300"))).toBe(false);
  });

  it("nič-vrednostno povratno embalažo vodi le količinsko, brez temeljnice", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      lines: [{ ...base.lines[0], returnablePackaging: true, netAmount: "0", vatRate: "0", vatAmount: "0", vatCodeId: null }],
    }));
    expect(preview.blockingErrors).toEqual([]);
    expect(preview.lines).toEqual([]);
    expect(preview.debitTotal).toBe("0.00");
    expect(preview.creditTotal).toBe("0.00");
  });

  it("povratna embalaža knjiži dejanski DDV in eksplicitni vatAmount", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      lines: [{ ...base.lines[0], returnablePackaging: true, netAmount: "10", vatRate: "22", vatAmount: "1.11" }],
      settings: { ...base.settings!, returnablePackagingAccountId: "3107", payablesAccountId: "220" },
      accounts: [...base.accounts, account("3107", "3107000"), account("220", "2200000")],
    }));
    expect(preview.blockingErrors).toEqual([]);
    expect(preview.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: "3107000", side: "debit", amount: "10.00" }),
      expect.objectContaining({ accountCode: "16022", side: "debit", amount: "1.11" }),
      expect.objectContaining({ accountCode: "2200000", side: "credit", amount: "11.11", partnerId: "supplier" }),
    ]));
  });

  it("blokira manjkajoča ali napačna konta povratne embalaže", () => {
    const base = input();
    const line = { ...base.lines[0], returnablePackaging: true, vatRate: "0", vatAmount: "0", vatCodeId: "vat0" };
    expect(buildPosReceiptBooking(input({
      lines: [line],
      settings: {
        ...base.settings!,
        returnablePackagingAccountId: null,
        payablesAccountId: null,
      },
    })).blockingErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MISSING_RETURNABLE_PACKAGING_ACCOUNT" }),
      expect.objectContaining({ code: "MISSING_PAYABLES_ACCOUNT" }),
    ]));
    const wrong = buildPosReceiptBooking(input({
      lines: [line],
      settings: { ...base.settings!, returnablePackagingAccountId: "3107", payablesAccountId: "220" },
      accounts: [...base.accounts, account("3107", "3100000"), account("220", "2100000")],
    }));
    expect(wrong.blockingErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "INVALID_RETURNABLE_PACKAGING_ACCOUNT_CLASS" }),
      expect.objectContaining({ code: "INVALID_PAYABLES_ACCOUNT_CLASS" }),
    ]));
  });

  it("navadna vrstica ostane na obstoječi zalogi in 300", () => {
    const preview = buildPosReceiptBooking(input());
    expect(preview.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: "310", side: "debit" }),
      expect.objectContaining({ accountCode: "3000000", side: "credit" }),
    ]));
  });

  it("neplačano fakturo-dobavnico knjiži v dobro obveznosti do dobavitelja", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      receipt: { ...base.receipt, documentType: "RACUN" },
    }));
    expect(preview.blockingErrors).toEqual([]);
    expect(preview.lines).toContainEqual(expect.objectContaining({
      accountCode: "2200000",
      side: "credit",
      amount: "122.00",
      description: "Obveznost do dobavitelja",
    }));
  });

  it("blokira manjkajoči konto obračuna nabave", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      settings: { ...base.settings!, nabavaObracunAccountId: null },
    }));
    expect(preview.blockingErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MISSING_NABAVA_OBRACUN_ACCOUNT" }),
    ]));
    expect(preview.lines.some(line => line.accountCode.startsWith("220"))).toBe(false);
  });

  it("varna splošna DDV nastavitev vrne opozorilo", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      settings: { ...base.settings!, inputVat22AccountId: null },
    }));
    expect(preview.blockingErrors).toEqual([]);
    expect(preview.warnings).toContainEqual(expect.objectContaining({
      code: "GENERIC_INPUT_VAT_ACCOUNT",
    }));
    expect(preview.lines).toContainEqual(expect.objectContaining({
      accountCode: "160",
      amount: "22.00",
    }));
  });

  it("odvisne stroške razporedi v zalogo ali neposredni strošek", () => {
    const preview = buildPosReceiptBooking(input({
      dependentCosts: [
        { id: 1, name: "Prevoz", treatment: "zaloga", netAmount: "10", vatRate: "9.5", vatCodeId: "p95", vatCodeResolution: "matched" },
        { id: 2, name: "Carina", treatment: "strosek", netAmount: "5", vatRate: "5", vatCodeId: "p5", vatCodeResolution: "matched" },
      ],
    }));
    expect(preview.blockingErrors).toEqual([]);
    expect(preview.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: "310", description: "Surovina", amount: "110.00" }),
      expect.objectContaining({ accountCode: "419", description: "Carina", amount: "5.00" }),
      expect.objectContaining({ accountCode: "3000000", amount: "138.20" }),
    ]));
  });

  it("mešana zaloga uporabi varen splošni fallback za odvisni strošek", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      lines: [
        base.lines[0],
        { ...base.lines[0], id: 2, articleId: 11, articleType: "blago", netAmount: "20", vatAmount: "4.40" },
      ],
      dependentCosts: [{
        id: 3, name: "Prevoz", treatment: "zaloga", netAmount: "3", vatRate: "5",
        vatCodeId: "p5", vatCodeResolution: "matched",
      }],
    }));
    expect(preview.warnings).toContainEqual(expect.objectContaining({
      code: "DEPENDENT_COST_INVENTORY_FALLBACK",
    }));
    expect(preview.lines).toContainEqual(expect.objectContaining({
      accountCode: "600",
      description: "Prevoz",
    }));
  });

  it("blokira neaktiven konto, manjkajoče dimenzije in potrjen vir", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      receipt: { ...base.receipt, costCenterId: null },
      accounts: base.accounts.map(item => item.id === "material"
        ? { ...item, isActive: false, requiresProject: true }
        : item),
      existingState: "posted",
      existingJournalEntryId: "posted-entry",
    }));
    expect(preview.blockingErrors.map(issue => issue.code)).toEqual(expect.arrayContaining([
      "ACCOUNT_NOT_POSTABLE",
      "MISSING_REQUIRED_PROJECT",
      "MISSING_REQUIRED_COST_CENTER",
      "RECEIPT_ALREADY_POSTED",
    ]));
  });

  it("obstoječi osnutek je idempotenten: ohrani hash in ne blokira ponovitve", () => {
    const first = buildPosReceiptBooking(input());
    const second = buildPosReceiptBooking(input({
      existingState: "draft",
      existingJournalEntryId: "draft-entry",
    }));
    expect(first.previewHash).toBe(second.previewHash);
    expect(second.blockingErrors).toEqual([]);
    expect(first.header.reference).toBe("POS:NABAVA:285");
    expect(first.header).toEqual(expect.objectContaining({
      documentDate: "2026-02-18",
      taxDate: "2026-02-18",
      receiptDate: "2026-02-20",
    }));
  });

  it("kot vidni sklic uporabi dobaviteljevo številko dokumenta", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      receipt: {
        ...base.receipt,
        supplierDocumentNumber: "3920-195-1724",
      },
    }));
    expect(preview.header.reference).toBe("3920-195-1724");
    expect(preview.header.description).toContain("dokument 3920-195-1724");
  });

  it("blokira prejemnico, vključeno v starejši zbirni osnutek", () => {
    const preview = buildPosReceiptBooking(input({ legacySharedDraft: true }));
    expect(preview.blockingErrors).toContainEqual(expect.objectContaining({
      code: "LEGACY_SHARED_DRAFT",
    }));
  });

  it("blokira manjkajočega dobavitelja, neujemajoč artikel ter negativne ali neveljavne zneske", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      receipt: { ...base.receipt, supplierId: null, supplierExists: false },
      lines: [
        { ...base.lines[0], id: 1, articleId: null },
        { ...base.lines[0], id: 2, netAmount: "-1" },
        { ...base.lines[0], id: 3, netAmount: "ni-znesek" },
      ],
    }));
    expect(preview.blockingErrors.map(issue => issue.code)).toEqual(expect.arrayContaining([
      "MISSING_SUPPLIER",
      "UNMATCHED_ARTICLE",
      "INVALID_AMOUNT",
    ]));
  });

  it("blokira manjkajočo ali neveljavno vhodno DDV kodo", () => {
    const base = input();
    const missing = buildPosReceiptBooking(input({
      lines: [{ ...base.lines[0], vatCodeId: null, vatCodeValid: false, vatCodeResolution: "missing" }],
    }));
    const invalid = buildPosReceiptBooking(input({
      lines: [{ ...base.lines[0], vatCodeValid: false, vatCodeResolution: "invalid" }],
    }));
    expect(missing.blockingErrors).toContainEqual(expect.objectContaining({ code: "MISSING_INPUT_VAT_CODE" }));
    expect(invalid.blockingErrors).toContainEqual(expect.objectContaining({ code: "INVALID_INPUT_VAT_CODE" }));
  });

  it("blokira semantično napačen konto obračuna nabave ali DDV", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      accounts: base.accounts.map(item => item.id === "300"
        ? { ...item, code: "2200000" }
        : item.id === "vat22"
          ? { ...item, code: "161" }
          : item),
    }));
    expect(preview.blockingErrors.map(issue => issue.code)).toEqual(expect.arrayContaining([
      "INVALID_NABAVA_OBRACUN_ACCOUNT_CLASS",
      "INVALID_INPUT_VAT_ACCOUNT_CLASS",
    ]));
  });

  it("ob združitvi enakih osnov sešteje tudi DDV metapodatke", () => {
    const base = input();
    const preview = buildPosReceiptBooking(input({
      lines: [
        { ...base.lines[0], netAmount: "50", vatAmount: "11" },
        { ...base.lines[0], id: 2, articleId: 11, netAmount: "50", vatAmount: "11" },
      ],
    }));
    expect(preview.lines).toContainEqual(expect.objectContaining({
      accountCode: "310",
      amount: "100.00",
      vatCodeId: "vat-code-in-22",
      vatAmount: "22.00",
    }));
  });

  it("sprememba dokumentnega datuma spremeni preview hash", () => {
    const base = input();
    const changed = input({
      receipt: { ...base.receipt, documentDate: "2026-02-19", taxDate: "2026-02-19" },
    });
    expect(buildPosReceiptBooking(base).previewHash).not.toBe(buildPosReceiptBooking(changed).previewHash);
  });

  it("orchestrator zavrne zastarel hash in potrjen vir, veljaven ponovni hash pa sprejme", () => {
    const preview = buildPosReceiptBooking(input());
    expect(() => assertPosReceiptDraftRequest(preview, preview.previewHash)).not.toThrow();
    expect(() => assertPosReceiptDraftRequest(preview, "stale")).toThrowError(expect.objectContaining({
      code: "STALE_PREVIEW",
    }));
    const posted = buildPosReceiptBooking(input({
      existingState: "posted",
      existingJournalEntryId: "posted-entry",
    }));
    expect(() => assertPosReceiptDraftRequest(posted, posted.previewHash)).toThrowError(expect.objectContaining({
      code: "POSTED_SOURCE",
    }));
  });

  it("resolver opremi ročno obdavčljivo postavko in odvisni strošek s KPR metapodatki", () => {
    const candidates = [
      { id: "p22-id", code: "P22", rate: "22.00" },
      { id: "p95-id", code: "P95", rate: "9.50" },
    ];
    const lineResolution = resolveInputVatCode(candidates, "S", "22");
    const costResolution = resolveInputVatCode(candidates, null, "9.5");
    expect(lineResolution).toEqual({ kind: "matched", vatCodeId: "p22-id" });
    expect(costResolution).toEqual({ kind: "matched", vatCodeId: "p95-id" });
    if (lineResolution.kind !== "matched" || costResolution.kind !== "matched") throw new Error("resolution failed");

    const base = input();
    const resolved = input({
      lines: [{
        ...base.lines[0],
        vatCodeId: lineResolution.vatCodeId,
        vatCodeValid: true,
        vatCodeResolution: "matched",
      }],
      dependentCosts: [{
        id: 9,
        name: "Prevoz",
        treatment: "zaloga",
        netAmount: "10",
        vatRate: "9.5",
        vatCodeId: costResolution.vatCodeId,
        vatCodeResolution: "matched",
      }],
    });
    const preview = buildPosReceiptBooking(resolved);
    expect(preview.blockingErrors).toEqual([]);
    expect(preview.lines.filter((line) => line.accountCode === "310")).toHaveLength(1);
    expect(buildPosReceiptVatEvidence(resolved)).toEqual(expect.arrayContaining([
      expect.objectContaining({ vatCodeId: "p22-id", vatAmount: "22.00", amount: "100.00" }),
      expect.objectContaining({ vatCodeId: "p95-id", vatAmount: "0.95", amount: "10.00" }),
    ]));
  });

  it("dvoumna razrešitev obdavčljivega stroška ostane blokirajoča", () => {
    const resolution = resolveInputVatCode([
      { id: "special-a", code: "SPECIAL-A", rate: "22" },
      { id: "special-b", code: "SPECIAL-B", rate: "22" },
    ], null, "22");
    expect(resolution.kind).toBe("ambiguous");
    const preview = buildPosReceiptBooking(input({
      dependentCosts: [{
        id: 10,
        name: "Prevoz",
        treatment: "zaloga",
        netAmount: "10",
        vatRate: "22",
        vatCodeId: null,
        vatCodeResolution: resolution.kind,
      }],
    }));
    expect(preview.blockingErrors).toContainEqual(expect.objectContaining({
      code: "AMBIGUOUS_INPUT_VAT_CODE",
    }));
  });

  it("dovoli samo odbitne P22/P95/P5 kandidate in zavrne RC, uvoz, PN ter neodbitne kode", () => {
    const candidate = {
      code: "P22",
      rate: "22",
      isReverseCharge: false,
      isImport: false,
      kprVatField: "P18",
    };
    expect(isSupportedOrdinaryInputVatCandidate(candidate)).toBe(true);
    expect(isSupportedOrdinaryInputVatCandidate({ ...candidate, code: "RC76A-22", isReverseCharge: true })).toBe(false);
    expect(isSupportedOrdinaryInputVatCandidate({ ...candidate, code: "UV22", isImport: true })).toBe(false);
    expect(isSupportedOrdinaryInputVatCandidate({ ...candidate, code: "PN22" })).toBe(false);
    expect(isSupportedOrdinaryInputVatCandidate({ ...candidate, code: "P22", kprVatField: null })).toBe(false);

    const base = input();
    for (const vatCodeId of ["rc-id", "import-id", "pn-id", "non-deductible-id"]) {
      const preview = buildPosReceiptBooking(input({
        lines: [{
          ...base.lines[0],
          vatCodeId,
          vatCodeValid: false,
          vatCodeResolution: "unsupported",
        }],
      }));
      expect(preview.blockingErrors).toContainEqual(expect.objectContaining({
        code: "UNSUPPORTED_INPUT_VAT_REGIME",
      }));
    }
  });

  it("ničelna stopnja brez podprte običajne P kode je blokirajoča", () => {
    const base = input();
    const linePreview = buildPosReceiptBooking(input({
      lines: [{
        ...base.lines[0],
        vatRate: "0",
        vatAmount: "0",
        vatCodeId: null,
        vatCodeValid: false,
        vatCodeResolution: "missing",
      }],
    }));
    expect(linePreview.blockingErrors).toContainEqual(expect.objectContaining({
      code: "MISSING_INPUT_VAT_CODE",
    }));
    const costPreview = buildPosReceiptBooking(input({
      dependentCosts: [{
        id: 11,
        name: "Posebni strošek",
        treatment: "zaloga",
        netAmount: "10",
        vatRate: "0",
        vatCodeId: null,
        vatCodeResolution: "missing",
      }],
    }));
    expect(costPreview.blockingErrors).toContainEqual(expect.objectContaining({
      code: "MISSING_INPUT_VAT_CODE",
    }));
  });
});