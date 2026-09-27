import { and, eq, isNull, sql } from "drizzle-orm";
import {
  accountsTable,
  db,
  posBookingSettingsTable,
} from "@workspace/db";
import { defaultCostCenterPolicy } from "./accountCostCenterPolicy";

export interface SeedSmallEquipmentExpenseAccountResult {
  accountId: string;
  created: boolean;
  filled: boolean;
}

export class SmallEquipmentExpenseAccountUnavailableError extends Error {
  constructor() {
    super("Konto 4040000 obstaja, vendar ni aktivno in proknjižljivo.");
    this.name = "SmallEquipmentExpenseAccountUnavailableError";
  }
}

/**
 * Izrecno, transakcijsko dejanje za podjetja, ki nimajo konta 4040000.
 * Običajno dopolnjevanje nastavitev tega konta nikoli ne ustvari.
 */
export async function seedSmallEquipmentExpenseAccount(
  companyId: string,
): Promise<SeedSmallEquipmentExpenseAccountResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${companyId}))`);

    const [currentSettings] = await tx
      .select({
        drobniInventarExpenseAccountId: posBookingSettingsTable.drobniInventarExpenseAccountId,
      })
      .from(posBookingSettingsTable)
      .where(eq(posBookingSettingsTable.companyId, companyId))
      .limit(1);

    if (currentSettings?.drobniInventarExpenseAccountId) {
      return {
        accountId: currentSettings.drobniInventarExpenseAccountId,
        created: false,
        filled: false,
      };
    }

    let [account] = await tx
      .select({
        id: accountsTable.id,
        isActive: accountsTable.isActive,
        allowsPosting: accountsTable.allowsPosting,
      })
      .from(accountsTable)
      .where(and(
        eq(accountsTable.companyId, companyId),
        eq(accountsTable.code, "4040000"),
      ))
      .limit(1);
    let created = false;

    if (account && (!account.isActive || !account.allowsPosting)) {
      throw new SmallEquipmentExpenseAccountUnavailableError();
    }

    if (!account) {
      let [group] = await tx
        .select({ id: accountsTable.id })
        .from(accountsTable)
        .where(and(
          eq(accountsTable.companyId, companyId),
          eq(accountsTable.code, "404"),
        ))
        .limit(1);

      if (!group) {
        const [insertedGroup] = await tx
          .insert(accountsTable)
          .values({
            companyId,
            code: "404",
            name: "Odpis drobnega inventarja in embalaže",
            type: "expense",
            isActive: true,
            allowsPosting: false,
            costCenterPolicy: defaultCostCenterPolicy("404"),
            requiresCostCenter: true,
          })
          .onConflictDoNothing({
            target: [accountsTable.companyId, accountsTable.code],
          })
          .returning({ id: accountsTable.id });
        group = insertedGroup ?? (await tx
          .select({ id: accountsTable.id })
          .from(accountsTable)
          .where(and(
            eq(accountsTable.companyId, companyId),
            eq(accountsTable.code, "404"),
          ))
          .limit(1))[0];
      }

      if (!group) {
        throw new Error("Sintetičnega konta 404 ni bilo mogoče ustvariti.");
      }

      const [insertedAccount] = await tx
        .insert(accountsTable)
        .values({
          companyId,
          code: "4040000",
          name: "Odpis drobnega inventarja in embalaže",
          type: "expense",
          parentId: group.id,
          isActive: true,
          allowsPosting: true,
          costCenterPolicy: defaultCostCenterPolicy("4040000"),
          requiresCostCenter: true,
        })
        .onConflictDoNothing({
          target: [accountsTable.companyId, accountsTable.code],
        })
        .returning({
          id: accountsTable.id,
          isActive: accountsTable.isActive,
          allowsPosting: accountsTable.allowsPosting,
        });
      account = insertedAccount ?? (await tx
        .select({
          id: accountsTable.id,
          isActive: accountsTable.isActive,
          allowsPosting: accountsTable.allowsPosting,
        })
        .from(accountsTable)
        .where(and(
          eq(accountsTable.companyId, companyId),
          eq(accountsTable.code, "4040000"),
        ))
        .limit(1))[0];
      if (!account) {
        throw new Error("Konta 4040000 ni bilo mogoče ustvariti.");
      }
      if (!account.isActive || !account.allowsPosting) {
        throw new SmallEquipmentExpenseAccountUnavailableError();
      }
      created = insertedAccount !== undefined;
    }

    let filled = false;
    if (!currentSettings) {
      const [insertedSettings] = await tx
        .insert(posBookingSettingsTable)
        .values({
          companyId,
          drobniInventarExpenseAccountId: account.id,
        })
        .onConflictDoNothing({
          target: posBookingSettingsTable.companyId,
        })
        .returning({ id: posBookingSettingsTable.id });
      filled = insertedSettings !== undefined;
    }

    if (!filled) {
      const [updatedSettings] = await tx
        .update(posBookingSettingsTable)
        .set({
          drobniInventarExpenseAccountId: sql`coalesce(${posBookingSettingsTable.drobniInventarExpenseAccountId}, ${account.id})`,
        })
        .where(and(
          eq(posBookingSettingsTable.companyId, companyId),
          isNull(posBookingSettingsTable.drobniInventarExpenseAccountId),
        ))
        .returning({ id: posBookingSettingsTable.id });
      filled = updatedSettings !== undefined;
    }

    const [savedSettings] = await tx
      .select({
        drobniInventarExpenseAccountId: posBookingSettingsTable.drobniInventarExpenseAccountId,
      })
      .from(posBookingSettingsTable)
      .where(eq(posBookingSettingsTable.companyId, companyId))
      .limit(1);

    return {
      accountId: savedSettings?.drobniInventarExpenseAccountId ?? account.id,
      created,
      filled,
    };
  });
}