import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_CLASS_NAMES,
  COMPANY_CHART_OF_ACCOUNTS,
  buildCompanyChartOfAccounts,
} from "./companyChartOfAccounts";
import { seedDefaultChartOfAccounts } from "./seedDefaultChartOfAccounts";

vi.mock("@workspace/db", () => ({
  db: {},
  accountsTable: {},
}));

describe("Kontni načrt CELOTNI za gospodarske družbe", () => {
  it("uporabi potrjeni razdelnik s 3-mestnimi sintetiki in 7-mestnimi analitikami", () => {
    const plan = COMPANY_CHART_OF_ACCOUNTS;
    const byCode = new Map(plan.map((account) => [account.code, account]));

    expect(plan).toHaveLength(400);
    expect(new Set(plan.map((account) => account.code)).size).toBe(plan.length);
    expect(plan.every((account) => account.code.length === 3 || account.code.length === 7)).toBe(true);
    expect(byCode.get("160")?.name).toContain("Terjatve za vstopni DDV");
    expect(byCode.get("1600000")?.name).toBe("Vstopni DDV 22 %");
    expect(byCode.get("1603000")?.name).toBe("Vstopni DDV od uvoza");
    expect(byCode.get("1609000")?.name).toBe("Terjatev za presežek DDV (DDV-O)");
    expect(byCode.get("2604000")?.name).toContain("samoobdavčitve");
    expect(byCode.get("3000000")?.name).toBe("Vrednost materiala po obračunih dobaviteljev");
    expect(byCode.get("3107000")?.name).toBe("Povratna embalaža");
    expect(byCode.get("4000000")?.name).toBe("Poraba materiala (splošno)");
    expect(byCode.get("404")?.name).toBe("Odpis drobnega inventarja in embalaže");
    expect(byCode.get("4040000")?.name).toBe("Odpis drobnega inventarja in embalaže");
    expect(byCode.get("5000000")?.name).toBe("Razporejeni stroški po stroškovnih mestih");
    expect(byCode.get("6000000")?.name).toBe("Nedokončana proizvodnja");
    expect(byCode.get("7000000")?.name).toContain("prodanega blaga");
    expect(byCode.get("8000000")?.name).toBe("Prenos prihodkov na poslovni izid");
    expect(byCode.get("9000000")?.name).toBe("Osnovni kapital (d.o.o. / d.d.)");

    for (const classCode of Object.keys(ACCOUNT_CLASS_NAMES)) {
      expect(plan.some((account) => account.code.startsWith(classCode))).toBe(true);
    }
  });

  it("ohrani nazive vseh desetih kontnih razredov tudi, kadar razdelnik nima kontov v razredu", () => {
    expect(Object.keys(ACCOUNT_CLASS_NAMES)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(ACCOUNT_CLASS_NAMES["0"]).toContain("osnovna sredstva");
    expect(ACCOUNT_CLASS_NAMES["5"]).toContain("stroški prodaje");
    expect(ACCOUNT_CLASS_NAMES["8"]).toContain("kapital");
    expect(ACCOUNT_CLASS_NAMES["9"]).toContain("Obračun poslovnega izida");
  });

  it("poveže vsako analitiko z veljavnim 3-mestnim sintetikom in dovoli knjiženje le na analitikah", () => {
    const byCode = new Map(COMPANY_CHART_OF_ACCOUNTS.map((account) => [account.code, account]));

    expect(byCode.get("1600000")).toMatchObject({
      parentCode: "160",
      allowsPosting: true,
    });
    expect(byCode.get("1609000")).toMatchObject({
      parentCode: "160",
      allowsPosting: true,
      taxBehavior: "none",
    });
    expect(byCode.get("160")).toMatchObject({
      parentCode: undefined,
      allowsPosting: false,
    });
    expect(byCode.get("404")).toMatchObject({ allowsPosting: false, type: "expense" });
    expect(byCode.get("4040000")).toMatchObject({
      parentCode: "404",
      allowsPosting: true,
      type: "expense",
    });

    for (const account of COMPANY_CHART_OF_ACCOUNTS.filter((account) => account.code.length === 7)) {
      expect(account.parentCode).toBe(account.code.slice(0, 3));
      expect(byCode.get(account.parentCode!)).toMatchObject({
        code: account.code.slice(0, 3),
        allowsPosting: false,
      });
      expect(account.allowsPosting).toBe(true);
    }
  });

  it("v seed zapisih ohrani saldakontne, denarne in DDV zastavice", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const values = vi.fn().mockReturnValue({ returning });
    const executor = {
      insert: vi.fn().mockReturnValue({ values }),
      update: vi.fn(),
    } as never;

    await seedDefaultChartOfAccounts("test-company", executor);

    const rows = values.mock.calls[0]?.[0] as Array<{
      code: string;
      requiresPartner: boolean;
      isCash: boolean;
      taxBehavior: string;
    }>;
    const byCode = new Map(rows.map((account) => [account.code, account]));

    expect(rows).toHaveLength(400);
    expect(byCode.get("1200000")).toMatchObject({ requiresPartner: true });
    expect(byCode.get("2200000")).toMatchObject({ requiresPartner: true });
    expect(byCode.get("1000000")).toMatchObject({ isCash: true });
    expect(byCode.get("1100000")).toMatchObject({ isCash: true });
    expect(byCode.get("1600000")).toMatchObject({ taxBehavior: "input_vat" });
    expect(byCode.get("1609000")).toMatchObject({ taxBehavior: "none" });
    expect(byCode.get("2600000")).toMatchObject({ taxBehavior: "output_vat" });
  });

  it("zavrne podvojene in nehierarhične izvorne konte", () => {
    expect(() =>
      buildCompanyChartOfAccounts([
        { code: "001", name: "Skupina" },
        { code: "001", name: "Podvojeno" },
      ]),
    ).toThrow("Podvojen konto 001");

    expect(() =>
      buildCompanyChartOfAccounts([
        { code: "001", name: "Konto" },
        { code: "0010000", name: "Analitika" },
      ]),
    ).not.toThrow();
  });
});