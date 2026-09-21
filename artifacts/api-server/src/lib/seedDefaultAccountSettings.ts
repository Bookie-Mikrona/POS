import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  accountsTable,
  db,
  ddvZakljucekSettingsTable,
  osAmortizacijaNastavitveTable,
  posBookingSettingsTable,
  vatCodesTable,
} from "@workspace/db";

type AccountSettingsExecutor = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export const POS_DEFAULT_ACCOUNT_CODES = {
  cashAccountId: "1000000",
  bankAccountId: "1100000",
  cashInTransitAccountId: "1090000",
  cardAccountId: "1092000",
  voucherAccountId: "2301000",
  advancePaymentsAccountId: "2301000",
  subsidyReceivableAccountId: "1650000",
  revenueService22AccountId: "7601100",
  revenueService95AccountId: "7601200",
  revenueService5AccountId: "7601300",
  revenueGoods22AccountId: "7620100",
  revenueGoods95AccountId: "7620200",
  revenueGoods5AccountId: "7620300",
  vat22AccountId: "2600000",
  vat95AccountId: "2601000",
  vat5AccountId: "2602000",
  inputVat22AccountId: "1600000",
  inputVat95AccountId: "1601000",
  inputVat5AccountId: "1602000",
  inventoryMaterialAccountId: "3100000",
  inventoryGoodsAccountId: "6600000",
  payablesAccountId: "2200000",
  returnablePackagingAccountId: "3107000",
  nabavaObracunAccountId: "3000000",
  otherCostsAccountId: "4809000",
  cogsMaterialAccountId: "4000000",
  cogsGoodsAccountId: "7000000",
  wasteAccountId: "4050000",
  kirArAccountId: "1200000",
  reprezentancaAccountId: "4141000",
  lastnaPorabaAccountId: "4809000",
  openingBalanceAccountId: "9000000",
} as const;

type PosDefaultAccountField = keyof typeof POS_DEFAULT_ACCOUNT_CODES;

const POS_DEFAULT_ACCOUNT_FIELDS = Object.keys(
  POS_DEFAULT_ACCOUNT_CODES,
) as PosDefaultAccountField[];
const VAT_DEFAULTS = [
  {
    code: "S22",
    name: "Standardna stopnja 22 %",
    rate: "22.00",
    accountOutputCode: "2600000",
    accountInputCode: "1600000",
  },
  {
    code: "S95",
    name: "Znižana stopnja 9,5 %",
    rate: "9.50",
    accountOutputCode: "2601000",
    accountInputCode: "1601000",
  },
  {
    code: "S5",
    name: "Znižana stopnja 5 %",
    rate: "5.00",
    accountOutputCode: "2602000",
    accountInputCode: "1602000",
  },
] as const;

const OS_DEFAULT_ACCOUNT_CODES = {
  kontoStroskaId: "4302000",
  kontoPopravkaId: "0500000",
} as const;

const DDV_CLOSING_DEFAULT_ACCOUNT_CODES = {
  netoObveznostAccountId: "2609000",
  netoTerjatevAccountId: "1609000",
} as const;

export interface DefaultAccountSettingsSeedResult {
  posBookingSettings: { created: boolean; filled: number };
  vatCodes: { created: number; filled: number };
  amortization: { created: boolean; filled: number };
  vatClosing: { created: boolean; filled: number };
}

function countPresent(values: Record<string, string | null>): number {
  return Object.values(values).filter((value) => value !== null).length;
}

/**
 * Dopolni samo prazne konto-nastavitve podjetja z uradnimi privzetimi konti.
 *
 * Ne spreminja kontnega plana in ne prepiše ročno izbranih vrednosti. Zato se
 * lahko varno kliče ob ustvarjanju podjetja in pozneje za ročno dopolnitev
 * starega podjetja.
 */
export async function seedDefaultAccountSettings(
  companyId: string,
  executor: AccountSettingsExecutor = db,
): Promise<DefaultAccountSettingsSeedResult> {
  // Serijska izvedba prepreči podvojene singleton nastavitve in S-kode ob
  // sočasnih retry-jih ročnega endpointa. COALESCE spodaj dodatno ščiti
  // vzporedno ročno urejanje posameznega polja.
  await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${companyId}))`);

  const requiredCodes = [
    ...Object.values(POS_DEFAULT_ACCOUNT_CODES),
    ...VAT_DEFAULTS.flatMap((vat) => [vat.accountOutputCode, vat.accountInputCode]),
    ...Object.values(OS_DEFAULT_ACCOUNT_CODES),
    ...Object.values(DDV_CLOSING_DEFAULT_ACCOUNT_CODES),
  ];
  const accounts = await executor
    .select({ id: accountsTable.id, code: accountsTable.code })
    .from(accountsTable)
    .where(and(
      eq(accountsTable.companyId, companyId),
      inArray(accountsTable.code, [...new Set(requiredCodes)]),
    ));
  const accountIdByCode = new Map(accounts.map((account) => [account.code, account.id]));
  const accountId = (code: string): string | null => accountIdByCode.get(code) ?? null;

  const posDefaults = Object.fromEntries(
    POS_DEFAULT_ACCOUNT_FIELDS.map((field) => [
      field,
      accountId(POS_DEFAULT_ACCOUNT_CODES[field]),
    ]),
  ) as Record<PosDefaultAccountField, string | null>;
  const [currentPosSettings] = await executor
    .select()
    .from(posBookingSettingsTable)
    .where(eq(posBookingSettingsTable.companyId, companyId))
    .limit(1);

  let posCreated = false;
  let posFilled = 0;
  if (!currentPosSettings) {
    const conflictPatch = Object.fromEntries(
      POS_DEFAULT_ACCOUNT_FIELDS
        .filter((field) => posDefaults[field] !== null)
        .map((field) => [
          field,
          sql`coalesce(${posBookingSettingsTable[field]}, ${posDefaults[field]})`,
        ]),
    ) as Partial<typeof posBookingSettingsTable.$inferInsert>;
    await executor
      .insert(posBookingSettingsTable)
      .values({ companyId, ...posDefaults })
      .onConflictDoUpdate({
        target: posBookingSettingsTable.companyId,
        set: conflictPatch,
      });
    posCreated = true;
    posFilled = countPresent(posDefaults);
  } else {
    const patch: Partial<Record<PosDefaultAccountField, unknown>> = {};
    for (const field of POS_DEFAULT_ACCOUNT_FIELDS) {
      if (currentPosSettings[field] === null && posDefaults[field] !== null) {
        patch[field] = sql`coalesce(${posBookingSettingsTable[field]}, ${posDefaults[field]})`;
      }
    }
    posFilled = Object.keys(patch).length;
    if (posFilled > 0) {
      await executor
        .update(posBookingSettingsTable)
        .set(patch as Partial<typeof posBookingSettingsTable.$inferInsert>)
        .where(eq(posBookingSettingsTable.companyId, companyId));
    }
  }

  const existingVatCodes = await executor
    .select()
    .from(vatCodesTable)
    .where(and(
      eq(vatCodesTable.companyId, companyId),
      inArray(vatCodesTable.code, VAT_DEFAULTS.map((vat) => vat.code)),
    ));
  const vatCodesByCode = new Map<string, typeof existingVatCodes>();
  for (const vatCode of existingVatCodes) {
    const rows = vatCodesByCode.get(vatCode.code) ?? [];
    rows.push(vatCode);
    vatCodesByCode.set(vatCode.code, rows);
  }

  let vatCodesCreated = 0;
  let vatCodesFilled = 0;
  for (const vatDefault of VAT_DEFAULTS) {
    const desired = {
      accountOutputId: accountId(vatDefault.accountOutputCode),
      accountInputId: accountId(vatDefault.accountInputCode),
    };
    const existingRows = vatCodesByCode.get(vatDefault.code) ?? [];
    if (existingRows.length === 0) {
      await executor.insert(vatCodesTable).values({
        companyId,
        code: vatDefault.code,
        name: vatDefault.name,
        rate: vatDefault.rate,
        behavior: "standard",
        ...desired,
      });
      vatCodesCreated += 1;
      vatCodesFilled += countPresent(desired);
      continue;
    }

    for (const currentVatCode of existingRows) {
      const patch: { accountOutputId?: SQL; accountInputId?: SQL } = {};
      if (currentVatCode.accountOutputId === null && desired.accountOutputId !== null) {
        patch.accountOutputId = sql`coalesce(${vatCodesTable.accountOutputId}, ${desired.accountOutputId})`;
      }
      if (currentVatCode.accountInputId === null && desired.accountInputId !== null) {
        patch.accountInputId = sql`coalesce(${vatCodesTable.accountInputId}, ${desired.accountInputId})`;
      }
      vatCodesFilled += Object.keys(patch).length;
      if (Object.keys(patch).length > 0) {
        await executor
          .update(vatCodesTable)
          .set(patch)
          .where(eq(vatCodesTable.id, currentVatCode.id));
      }
    }
  }

  const amortizationDefaults = {
    kontoStroskaId: accountId(OS_DEFAULT_ACCOUNT_CODES.kontoStroskaId),
    kontoPopravkaId: accountId(OS_DEFAULT_ACCOUNT_CODES.kontoPopravkaId),
  };
  const [currentAmortization] = await executor
    .select()
    .from(osAmortizacijaNastavitveTable)
    .where(eq(osAmortizacijaNastavitveTable.companyId, companyId))
    .limit(1);
  let amortizationCreated = false;
  let amortizationFilled = 0;
  if (!currentAmortization) {
    const conflictPatch = {
      kontoStroskaId: sql`coalesce(${osAmortizacijaNastavitveTable.kontoStroskaId}, ${amortizationDefaults.kontoStroskaId})`,
      kontoPopravkaId: sql`coalesce(${osAmortizacijaNastavitveTable.kontoPopravkaId}, ${amortizationDefaults.kontoPopravkaId})`,
    };
    await executor
      .insert(osAmortizacijaNastavitveTable)
      .values({ companyId, ...amortizationDefaults })
      .onConflictDoUpdate({
        target: osAmortizacijaNastavitveTable.companyId,
        set: conflictPatch,
      });
    amortizationCreated = true;
    amortizationFilled = countPresent(amortizationDefaults);
  } else {
    const patch: { kontoStroskaId?: SQL; kontoPopravkaId?: SQL } = {};
    if (currentAmortization.kontoStroskaId === null && amortizationDefaults.kontoStroskaId !== null) {
      patch.kontoStroskaId = sql`coalesce(${osAmortizacijaNastavitveTable.kontoStroskaId}, ${amortizationDefaults.kontoStroskaId})`;
    }
    if (currentAmortization.kontoPopravkaId === null && amortizationDefaults.kontoPopravkaId !== null) {
      patch.kontoPopravkaId = sql`coalesce(${osAmortizacijaNastavitveTable.kontoPopravkaId}, ${amortizationDefaults.kontoPopravkaId})`;
    }
    amortizationFilled = Object.keys(patch).length;
    if (amortizationFilled > 0) {
      await executor
        .update(osAmortizacijaNastavitveTable)
        .set(patch)
        .where(eq(osAmortizacijaNastavitveTable.companyId, companyId));
    }
  }

  const vatClosingDefaults = {
    netoObveznostAccountId: accountId(DDV_CLOSING_DEFAULT_ACCOUNT_CODES.netoObveznostAccountId),
    netoTerjatevAccountId: accountId(DDV_CLOSING_DEFAULT_ACCOUNT_CODES.netoTerjatevAccountId),
  };
  const [currentVatClosing] = await executor
    .select()
    .from(ddvZakljucekSettingsTable)
    .where(eq(ddvZakljucekSettingsTable.companyId, companyId))
    .limit(1);
  let vatClosingCreated = false;
  let vatClosingFilled = 0;
  if (!currentVatClosing) {
    const conflictPatch = {
      netoObveznostAccountId: sql`coalesce(${ddvZakljucekSettingsTable.netoObveznostAccountId}, ${vatClosingDefaults.netoObveznostAccountId})`,
      netoTerjatevAccountId: sql`coalesce(${ddvZakljucekSettingsTable.netoTerjatevAccountId}, ${vatClosingDefaults.netoTerjatevAccountId})`,
    };
    await executor
      .insert(ddvZakljucekSettingsTable)
      .values({ companyId, ...vatClosingDefaults })
      .onConflictDoUpdate({
        target: ddvZakljucekSettingsTable.companyId,
        set: conflictPatch,
      });
    vatClosingCreated = true;
    vatClosingFilled = countPresent(vatClosingDefaults);
  } else {
    const patch: { netoObveznostAccountId?: SQL; netoTerjatevAccountId?: SQL } = {};
    if (currentVatClosing.netoObveznostAccountId === null && vatClosingDefaults.netoObveznostAccountId !== null) {
      patch.netoObveznostAccountId = sql`coalesce(${ddvZakljucekSettingsTable.netoObveznostAccountId}, ${vatClosingDefaults.netoObveznostAccountId})`;
    }
    if (currentVatClosing.netoTerjatevAccountId === null && vatClosingDefaults.netoTerjatevAccountId !== null) {
      patch.netoTerjatevAccountId = sql`coalesce(${ddvZakljucekSettingsTable.netoTerjatevAccountId}, ${vatClosingDefaults.netoTerjatevAccountId})`;
    }
    vatClosingFilled = Object.keys(patch).length;
    if (vatClosingFilled > 0) {
      await executor
        .update(ddvZakljucekSettingsTable)
        .set(patch)
        .where(eq(ddvZakljucekSettingsTable.companyId, companyId));
    }
  }

  return {
    posBookingSettings: { created: posCreated, filled: posFilled },
    vatCodes: { created: vatCodesCreated, filled: vatCodesFilled },
    amortization: { created: amortizationCreated, filled: amortizationFilled },
    vatClosing: { created: vatClosingCreated, filled: vatClosingFilled },
  };
}