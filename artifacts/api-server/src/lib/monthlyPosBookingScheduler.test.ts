import { describe, expect, it, vi } from "vitest";
import {
  createPostgresSchedulerLock,
  hasBlockingMonthlySkip,
  isEligibleForMonthlyBooking,
  isMonthlyBookingWindowOpen,
  monthsInclusive,
  previousMonthFor,
  runMonthlyPosBookingJob,
  type MonthlyPosBookingSchedulerDependencies,
} from "./monthlyPosBookingScheduler";

function dependencies(
  overrides: Partial<MonthlyPosBookingSchedulerDependencies> = {},
): MonthlyPosBookingSchedulerDependencies {
  return {
    listEligibleCompanies: vi.fn(async () => []),
    syncCompany: vi.fn(async () => ({ created: [], skipped: [] })),
    acquireLock: vi.fn(async () => true),
    releaseLock: vi.fn(async () => undefined),
    listCompletedCompanies: vi.fn(async () => new Set<string>()),
    markCompanyCompleted: vi.fn(async () => undefined),
    getOrCreateStartMonth: vi.fn(async (initialMonth) => initialMonth),
    ...overrides,
  };
}

describe("mesečni POS scheduler", () => {
  it("drži advisory lock na isti povezavi in ga po sprostitvi vrne poolu", async () => {
    const key = `monthly-pos-test-${Math.random().toString(36).slice(2)}`;
    const first = createPostgresSchedulerLock(key);
    const second = createPostgresSchedulerLock(key);

    await expect(first.acquireLock()).resolves.toBe(true);
    await expect(second.acquireLock()).resolves.toBe(false);

    await first.releaseLock();
    await expect(second.acquireLock()).resolves.toBe(true);
    await second.releaseLock();
  });

  it("uniči povezavo, če odklep ne uspe", async () => {
    const unlockError = new Error("odklep ni uspel");
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockRejectedValueOnce(unlockError);
    const release = vi.fn();
    const connect = vi.fn(async () => ({ query, release }) as unknown as import("@workspace/db").PoolClient);
    const lock = createPostgresSchedulerLock("unlock-failure-test", connect);

    await expect(lock.acquireLock()).resolves.toBe(true);
    await expect(lock.releaseLock()).rejects.toThrow("odklep ni uspel");
    expect(release).toHaveBeenCalledWith(unlockError);
  });

  it("odpre catch-up okno prvi delovni dan ob 06:00 in ga nato pusti odprtega", () => {
    expect(isMonthlyBookingWindowOpen(new Date("2026-09-01T04:00:00Z"))).toBe(true);
    expect(isMonthlyBookingWindowOpen(new Date("2026-09-01T03:59:00Z"))).toBe(false);
    expect(isMonthlyBookingWindowOpen(new Date("2026-09-01T10:00:00Z"))).toBe(true);
    expect(isMonthlyBookingWindowOpen(new Date("2026-09-15T04:00:00Z"))).toBe(true);
    expect(isMonthlyBookingWindowOpen(new Date("2026-10-01T04:00:00Z"))).toBe(true);
    expect(isMonthlyBookingWindowOpen(new Date("2026-10-02T04:00:00Z"))).toBe(true);
  });

  it("za januarski prehod vrne prejšnji december", () => {
    expect(previousMonthFor(new Date("2026-01-02T05:00:00Z"))).toBe("2025-12");
    expect(previousMonthFor(new Date("2026-09-01T04:00:00Z"))).toBe("2026-08");
  });

  it("našteje vse mesece za obnovo po daljšem izpadu", () => {
    expect(monthsInclusive("2026-06", "2026-09")).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
  });

  it("upošteva prejšnjo frekvenco pri spremembi, ki začne veljati naslednji mesec", () => {
    expect(isEligibleForMonthlyBooking({
      companyId: "company-a",
      salesBookingFrequency: "daily",
      consumptionBookingFrequency: "daily",
      frequencyEffectiveFrom: "2026-09-01",
      salesBookingFrequencyPrevious: "monthly",
      consumptionBookingFrequencyPrevious: "daily",
    }, "2026-08")).toBe(true);
  });

  it("ločuje operativne napake od pričakovanih preskokov nemesečnih modulov", () => {
    expect(hasBlockingMonthlySkip({
      skipped: [{ ref: "x", reason: "Ni odprtega računovodskega obdobja za 2026-08-01" }],
    })).toBe(true);
    expect(hasBlockingMonthlySkip({
      skipped: [{ ref: "x", reason: "Poraba za ta mesec ni nastavljena na mesečno knjiženje" }],
    })).toBe(false);
  });

  it("obdela vsa ustrezna podjetja in napako izolira na eno podjetje", async () => {
    const syncCompany = vi.fn(async (companyId: string) => {
      if (companyId === "company-fails") throw new Error("test napaka");
      return { created: ["POS:PRODAJA:2026-08:E1"], skipped: [] };
    });
    const deps = dependencies({
      listEligibleCompanies: vi.fn(async () => ["company-a", "company-fails", "company-a"]),
      syncCompany,
    });

    const result = await runMonthlyPosBookingJob(
      new Date("2026-09-01T04:00:00Z"),
      deps,
    );

    expect(result).toEqual({
      ran: true,
      month: "2026-08",
      companies: 2,
      succeeded: 1,
      failed: 1,
    });
    expect(syncCompany).toHaveBeenNthCalledWith(1, "company-a", "2026-08");
    expect(syncCompany).toHaveBeenNthCalledWith(2, "company-fails", "2026-08");
    expect(deps.releaseLock).toHaveBeenCalledOnce();
    expect(deps.markCompanyCompleted).toHaveBeenCalledOnce();
    expect(deps.markCompanyCompleted).toHaveBeenCalledWith("company-a", "2026-08");
  });

  it("po uspešnem catch-upu trajno označi mesec in ga ne ponovi", async () => {
    const first = dependencies({
      listEligibleCompanies: vi.fn(async () => ["company-a"]),
    });
    const now = new Date("2026-09-01T10:00:00Z");

    const firstResult = await runMonthlyPosBookingJob(now, first);
    expect(firstResult.ran).toBe(true);
    expect(first.markCompanyCompleted).toHaveBeenCalledWith("company-a", "2026-08");

    const duplicate = dependencies({
      listCompletedCompanies: vi.fn(async () => new Set(["company-a"])),
      listEligibleCompanies: vi.fn(async () => ["company-a"]),
    });
    const duplicateResult = await runMonthlyPosBookingJob(now, duplicate);
    expect(duplicateResult.skippedReason).toBe("already-completed");
    expect(duplicate.syncCompany).not.toHaveBeenCalled();
    expect(duplicate.releaseLock).toHaveBeenCalledOnce();
  });

  it("ob ponovitvi obdela samo prej neuspešno podjetje", async () => {
    const deps = dependencies({
      listEligibleCompanies: vi.fn(async () => ["company-ok", "company-retry"]),
      listCompletedCompanies: vi.fn(async () => new Set(["company-ok"])),
    });

    await runMonthlyPosBookingJob(new Date("2026-09-01T10:00:00Z"), deps);

    expect(deps.syncCompany).toHaveBeenCalledOnce();
    expect(deps.syncCompany).toHaveBeenCalledWith("company-retry", "2026-08");
    expect(deps.markCompanyCompleted).toHaveBeenCalledWith("company-retry", "2026-08");
  });

  it("po prehodu v nov mesec ponovno obdela starejši neuspešni mesec", async () => {
    const deps = dependencies({
      getOrCreateStartMonth: vi.fn(async () => "2026-07"),
      listEligibleCompanies: vi.fn(async () => ["company-a"]),
      listCompletedCompanies: vi.fn(async (month: string) =>
        month === "2026-08" ? new Set(["company-a"]) : new Set<string>(),
      ),
    });

    await runMonthlyPosBookingJob(new Date("2026-09-01T10:00:00Z"), deps);

    expect(deps.syncCompany).toHaveBeenCalledOnce();
    expect(deps.syncCompany).toHaveBeenCalledWith("company-a", "2026-07");
    expect(deps.markCompanyCompleted).toHaveBeenCalledWith("company-a", "2026-07");
  });

  it("ne zažene obdelave pred urnikom ali ob zasedenem zaklepu", async () => {
    const notDue = dependencies();
    const notDueResult = await runMonthlyPosBookingJob(
      new Date("2026-09-01T03:59:00Z"),
      notDue,
    );
    expect(notDueResult.skippedReason).toBe("not-due");
    expect(notDue.acquireLock).not.toHaveBeenCalled();

    const locked = dependencies({ acquireLock: vi.fn(async () => false) });
    const lockedResult = await runMonthlyPosBookingJob(
      new Date("2026-09-01T04:00:00Z"),
      locked,
    );
    expect(lockedResult.skippedReason).toBe("already-running");
    expect(locked.listEligibleCompanies).not.toHaveBeenCalled();
    expect(locked.releaseLock).not.toHaveBeenCalled();
  });
});