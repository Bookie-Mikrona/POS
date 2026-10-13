import { beforeEach, describe, expect, it, vi } from "vitest";

const locks = vi.hoisted(() => ({
  shared: new Set<number>(), exclusive: null as number | null, nextId: 0,
  failProbe: false, failUnlock: false, releases: [] as number[],
}));

vi.mock("@workspace/db", () => ({
  pool: {
    connect: async () => {
      const id = ++locks.nextId;
      return {
        query: async (sql: string) => {
          if (sql.includes("pg_try_advisory_lock")) {
            if (locks.failProbe) throw new Error("probe failed");
            const shared = sql.includes("_shared");
            const acquired = shared
              ? locks.exclusive === null
              : locks.exclusive === null && locks.shared.size === 0;
            if (acquired) {
              if (shared) locks.shared.add(id);
              else locks.exclusive = id;
            }
            return { rows: [{ acquired }] };
          }
          if (sql.includes("pg_advisory_unlock")) {
            if (locks.failUnlock) throw new Error("unlock failed");
            if (sql.includes("_shared")) locks.shared.delete(id);
            else if (locks.exclusive === id) locks.exclusive = null;
          }
          return { rows: [] };
        },
        release: () => locks.releases.push(id),
      };
    },
  },
}));

import { acquireRestoreLock, isDatabaseRestoreInProgress } from "./databaseRestoreGuard";

beforeEach(() => {
  locks.shared.clear();
  locks.exclusive = null;
  locks.nextId = 0;
  locks.releases = [];
  locks.failProbe = locks.failUnlock = false;
});

describe("Database restore guard", () => {
  it("does not mistake simultaneous ordinary requests for a restore", async () => {
    expect(await Promise.all(Array.from({ length: 20 }, () => isDatabaseRestoreInProgress())))
      .toEqual(Array(20).fill(false));
    expect(locks.shared.size).toBe(0);
    expect(locks.exclusive).toBeNull();
    expect(new Set(locks.releases).size).toBe(20);
  });

  it("still blocks every request while the exclusive restore lock is held", async () => {
    const release = await acquireRestoreLock();
    expect(release).not.toBeNull();
    expect(await Promise.all([isDatabaseRestoreInProgress(), isDatabaseRestoreInProgress()]))
      .toEqual([true, true]);
    expect(await acquireRestoreLock()).toBeNull();
    await release!();
    await release!();
    expect(await isDatabaseRestoreInProgress()).toBe(false);
    expect(locks.releases.filter(id => id === 1)).toHaveLength(1);
  });

  it("propagates probe errors and releases the connection (fail closed)", async () => {
    locks.failProbe = true;
    await expect(isDatabaseRestoreInProgress()).rejects.toThrow("probe failed");
    expect(locks.releases).toEqual([1]);
  });

  it("releases the connection even when unlocking fails", async () => {
    locks.failUnlock = true;
    await expect(isDatabaseRestoreInProgress()).rejects.toThrow("unlock failed");
    expect(locks.releases).toEqual([1]);
  });
});
