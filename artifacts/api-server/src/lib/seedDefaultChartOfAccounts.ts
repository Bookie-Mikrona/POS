import { and, eq } from "drizzle-orm";
import { db, accountsTable } from "@workspace/db";
import {
  BUDGET_CHART_OF_ACCOUNTS,
  getBudgetParentCodeMap,
} from "./slovenianChartOfAccounts";
import {
  COMPANY_CHART_OF_ACCOUNTS,
  getCompanyParentCodeMap,
} from "./companyChartOfAccounts";
import type { AccountTemplate } from "./slovenianChartOfAccounts";
import { defaultCostCenterPolicy } from "./accountCostCenterPolicy";

type AccountWriteExecutor = Pick<typeof db, "insert" | "update">;

async function seedChartOfAccounts(
  companyId: string,
  chart: readonly AccountTemplate[],
  parentCodeMap: ReadonlyMap<string, string>,
  executor: AccountWriteExecutor = db,
): Promise<number> {
  const inserted = await executor
    .insert(accountsTable)
    .values(
      chart.map((account) => {
        const taxBehavior: "none" | "input_vat" | "output_vat" =
          account.taxBehavior === "input"
            ? "input_vat"
            : account.taxBehavior === "output"
              ? "output_vat"
              : "none";

        return {
          companyId,
          code: account.code,
          name: account.name,
          type: account.type,
          parentId: null as string | null,
          isActive: true,
          allowsPosting: account.allowsPosting,
          requiresPartner: account.requiresPartner ?? false,
          costCenterPolicy: defaultCostCenterPolicy(account.code),
          requiresCostCenter: account.code.startsWith("4"),
          isCash: account.isCash ?? false,
          taxBehavior,
          isOpenItem: account.isOpenItem ?? false,
        };
      }),
    )
    .returning({ id: accountsTable.id, code: accountsTable.code });

  const codeToId = new Map(inserted.map((account) => [account.code, account.id]));
  await Promise.all(
    [...parentCodeMap].map(([code, parentCode]) => {
      const id = codeToId.get(code);
      const parentId = codeToId.get(parentCode);
      if (!id || !parentId) return Promise.resolve();

      return executor
        .update(accountsTable)
        .set({ parentId })
        .where(and(eq(accountsTable.id, id), eq(accountsTable.companyId, companyId)));
    }),
  );

  return inserted.length;
}

/** Privzeti kontni plan za gospodarske družbe, vključno s 5-mestnimi analitikami. */
export function seedDefaultChartOfAccounts(
  companyId: string,
  executor: AccountWriteExecutor = db,
): Promise<number> {
  return seedChartOfAccounts(
    companyId,
    COMPANY_CHART_OF_ACCOUNTS,
    getCompanyParentCodeMap(),
    executor,
  );
}

/** Ločen, izrecen uvoz shranjenega kontnega plana proračunskih uporabnikov. */
export function seedBudgetChartOfAccounts(
  companyId: string,
  executor: AccountWriteExecutor = db,
): Promise<number> {
  return seedChartOfAccounts(
    companyId,
    BUDGET_CHART_OF_ACCOUNTS,
    getBudgetParentCodeMap(),
    executor,
  );
}