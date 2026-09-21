/**
 * Testi za assertSameCompany — centralni company-scope validator za
 * reference na skupna šifranta cost_centers in accounts.
 *
 * Pokritost:
 *  1. Prazni/null ID-ji → null (brez DB klica)
 *  2. Vsi ID-ji v podjetju → null
 *  3. Tuj ID (drugo podjetje ali neobstoječ) → { status: 400, error }
 *  4. Mešano: en veljaven + en tuj → napaka
 *  5. Podvojeni ID-ji → en sam batch SELECT (deduplikacija)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @workspace/db ─────────────────────────────────────────────────────────
const mockDb = {
  select: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  db: mockDb,
  accountsTable: { id: "id", companyId: "companyId" },
  costCentersTable: { id: "id", companyId: "companyId" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (col: unknown, val: unknown) => ({ col, val }),
  inArray: (col: unknown, vals: unknown[]) => ({ col, vals }),
}));

/** Nastavi, katere vrstice DB vrne za naslednji select. */
function setupDbRows(rows: { id: string }[]) {
  mockDb.select.mockImplementation(() => ({
    from: () => ({ where: () => Promise.resolve(rows) }),
  }));
}

let assertCostCenterInCompany: typeof import("./assertSameCompany").assertCostCenterInCompany;
let assertAccountInCompany: typeof import("./assertSameCompany").assertAccountInCompany;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  const mod = await import("./assertSameCompany");
  assertCostCenterInCompany = mod.assertCostCenterInCompany;
  assertAccountInCompany = mod.assertAccountInCompany;
});

// ── 1. Prazni / null ID-ji ─────────────────────────────────────────────────────
describe("prazni ID-ji", () => {
  it("prazen seznam → null brez DB klica", async () => {
    const result = await assertCostCenterInCompany([], "comp1");
    expect(result).toBeNull();
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("samo null/undefined → null brez DB klica", async () => {
    const result = await assertAccountInCompany([null, undefined, null], "comp1");
    expect(result).toBeNull();
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("prazen string je preskočen", async () => {
    const result = await assertCostCenterInCompany(["", null], "comp1");
    expect(result).toBeNull();
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

// ── 2. Veljavni ID-ji ──────────────────────────────────────────────────────────
describe("veljavni ID-ji", () => {
  it("stroškovno mesto v podjetju → null", async () => {
    setupDbRows([{ id: "cc-1" }]);
    const result = await assertCostCenterInCompany(["cc-1"], "comp1");
    expect(result).toBeNull();
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  it("več kontov v podjetju → null (en batch SELECT)", async () => {
    setupDbRows([{ id: "acc-1" }, { id: "acc-2" }, { id: "acc-3" }]);
    const result = await assertAccountInCompany(["acc-1", "acc-2", "acc-3"], "comp1");
    expect(result).toBeNull();
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  it("null vrednosti med veljavnimi so preskočene", async () => {
    setupDbRows([{ id: "acc-1" }]);
    const result = await assertAccountInCompany([null, "acc-1", undefined], "comp1");
    expect(result).toBeNull();
  });
});

// ── 3. Tuji / neobstoječi ID-ji ────────────────────────────────────────────────
describe("tuji ID-ji", () => {
  it("stroškovno mesto tujega podjetja → 400", async () => {
    setupDbRows([]); // DB ne vrne ničesar (WHERE companyId filtrira)
    const result = await assertCostCenterInCompany(["cc-tuji"], "comp1");
    expect(result).toEqual({
      status: 400,
      error: "Stroškovno mesto ni najdeno ali ne pripada temu podjetju",
    });
  });

  it("konto tujega podjetja → 400", async () => {
    setupDbRows([]);
    const result = await assertAccountInCompany(["acc-tuji"], "comp1");
    expect(result).toEqual({
      status: 400,
      error: "Konto ni najden ali ne pripada temu podjetju",
    });
  });

  it("mešano: en veljaven + en tuj → 400", async () => {
    setupDbRows([{ id: "acc-1" }]); // acc-2 manjka
    const result = await assertAccountInCompany(["acc-1", "acc-2"], "comp1");
    expect(result).toEqual({
      status: 400,
      error: "Konto ni najden ali ne pripada temu podjetju",
    });
  });
});

// ── 4. Deduplikacija ───────────────────────────────────────────────────────────
describe("deduplikacija", () => {
  it("podvojeni ID-ji → en batch SELECT, en zapis zadošča", async () => {
    setupDbRows([{ id: "acc-1" }]);
    const result = await assertAccountInCompany(["acc-1", "acc-1", "acc-1"], "comp1");
    expect(result).toBeNull();
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });
});
