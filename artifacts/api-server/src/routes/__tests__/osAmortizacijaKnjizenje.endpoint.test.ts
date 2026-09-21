/**
 * Endpoint testi za POST /os/:companyId/amortizacija/knjizenje
 *
 * Po refaktorju (odstranitev ročne izbire GLK obdobja):
 *   - periodId je ODSTRANJEN iz zahteve; backend ga izpelje samodejno
 *   - dryRun=true deluje brez GLK modula (OS-only podjetja)
 *   - dryRun=false zahteva GLK modul → 403 NO_GLK_MODULE
 *   - dryRun=false zahteva ustrezno odprto GLK obdobje → 400 NO_PERIOD_FOR_LETO
 *
 * Dokazuje (brez prave baze), da:
 * - NO_GLK_MODULE          → 403, db.transaction se NE pokliče
 * - NO_PERIOD_FOR_LETO     → 400, db.transaction se NE pokliče
 * - MONTHLY_EXISTS_FOR_YEAR → 409 pod advisory lock; noben INSERT
 * - ANNUAL_EXISTS_FOR_YEAR  → 409 pod advisory lock; noben INSERT
 * - MISSING_AMORT_ACCOUNTS  → 400, db.transaction se NE pokliče
 * - 400 invalid accounts    → 400, db.transaction se NE pokliče
 * - dryRun=true             → 200 predogled, db.transaction se NE pokliče (BEZ GLK klica)
 * - os_viewer               → 403, db.transaction se NE pokliče
 *
 * DB klici v OUTER handlerju (pred/zunaj transakcije):
 *   [0] companyModulesTable           — resolveOsModuleRole #1
 *   [1] osRolesTable                  — resolveOsModuleRole #2
 *   [2] osAmortizacijaNastavitveTable — nastavitve  ← ni več period lookup!
 *   [3] accountsTable                 — loadValidatedAccountMap default konti
 *   [4] osAmortizacijskeSkupineTable  — loadSredstvaData skupineRows
 *   [5] osnovnaSredstvaTable          — loadSredstvaData glaveRows
 *  ([6] osDoknjizbeTable              — samo ko glaveRows.length > 0)
 *   [6/7] accountsTable               — loadValidatedAccountMap all konti
 *
 * Za NON-dryRun (po dryRun check, po brezKontov/vrstice preverbi):
 *   [7/8]   companyModulesTable   — hasGlkModule (novi)
 *   [8/9]   accountingPeriodsTable — findPeriodForBooking (novi)
 *
 * DB klici ZNOTRAJ transakcije (txMock, po advisory lock):
 *   tx.execute    → pg_advisory_xact_lock (ignoriran rezultat)
 *   tx.select [0] → conflict check (MONTHLY ali ANNUAL)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── vi.hoisted ───────────────────────────────────────────────────────────────

const { mockTransactionSpy, mockInsertSpy, dbState, txState } = vi.hoisted(() => {
  const mockTransactionSpy = vi.fn();
  const mockInsertSpy = vi.fn();
  const dbState = { queues: [] as unknown[][], idx: 0 };
  const txState = { queues: [] as unknown[][], idx: 0 };
  return { mockTransactionSpy, mockInsertSpy, dbState, txState };
});

// ─── @workspace/db mock ──────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  function nextFrom(state: { queues: unknown[][], idx: number }): unknown[] {
    const r = state.queues[state.idx++];
    return r ?? [];
  }

  function makeChainFrom(state: { queues: unknown[][], idx: number }): Record<string, unknown> {
    const rows = nextFrom(state);
    const p = Promise.resolve(rows);
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      limit: () => p,
      then: p.then.bind(p),
      catch: (p as Promise<unknown[]>).catch.bind(p),
    };
    return chain;
  }

  const txMock = {
    execute: () => Promise.resolve([]),
    select: () => makeChainFrom(txState),
    insert: mockInsertSpy,
  };

  mockTransactionSpy.mockImplementation(
    (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
  );

  mockInsertSpy.mockReturnValue({
    values: () => ({
      returning: () => Promise.resolve([{ id: "new-entry-id" }]),
    }),
  });

  const mockDb = {
    select: () => makeChainFrom(dbState),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: "new-entry-id" }]),
      }),
    }),
    transaction: mockTransactionSpy,
  };

  const T = (n: string) => new Proxy({}, { get: (_t, p) => `${n}.${String(p)}` });

  return {
    db: mockDb,
    osAmortizacijskeSkupineTable: T("sk"),
    osnovnaSredstvaTable: T("gl"),
    osDoknjizbeTable: T("dk"),
    osRolesTable: T("ro"),
    osAmortizacijaNastavitveTable: T("na"),
    companyModulesTable: T("mo"),
    accountsTable: T("ac"),
    journalEntriesTable: T("je"),
    journalEntryLinesTable: T("jl"),
    accountingPeriodsTable: T("pe"),
  };
});

// ─── drizzle-orm mock ─────────────────────────────────────────────────────────

vi.mock("drizzle-orm", async (importOriginal) => {
  const orig = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...orig,
    eq: () => "eq", and: () => "and", like: () => "like",
    sql: () => "sql", inArray: () => "inArray",
  };
});

// ─── Middleware mocks ─────────────────────────────────────────────────────────

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request, _r: express.Response, next: express.NextFunction) => {
    (req as unknown as Record<string, unknown>).clerkUserId = "test-user-id";
    next();
  },
}));

vi.mock("../../middlewares/requireSuperAdmin", () => ({
  isSuperAdmin: () => false,
}));

// ─── Router import (AFTER mocks) ─────────────────────────────────────────────

import osAmortizacijaKnjizenjRouter from "../osAmortizacijaKnjizenje";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const CID   = "aaaa0000-0000-0000-0000-000000000001";
const PID   = "bbbb0000-0000-0000-0000-000000000002";
const SID   = "cccc0000-0000-0000-0000-000000000003";
const POPID = "dddd0000-0000-0000-0000-000000000004";

const MODULE_OK    = [{ module: "osnovna_sredstva" }];
const MODULE_ERP   = [{ module: "erp" }];   // hasGlkModule → true
const ROLE_ADMIN   = [{ role: "os_admin" }];
const ROLE_VIEWER  = [{ role: "os_viewer" }];

const PERIOD_2024 = { id: PID, status: "open", startDate: "2024-01-01", endDate: "2024-12-31" };
const ACC_STROSKI = { id: SID,   code: "4300", name: "Amortizacija",      isActive: true, allowsPosting: true, requiresCostCenter: false, requiresPartner: false, requiresProject: false };
const ACC_POPRAVK = { id: POPID, code: "0190", name: "Popravek vrednosti", isActive: true, allowsPosting: true, requiresCostCenter: false, requiresPartner: false, requiresProject: false };
const NASTAVITVE  = { kontoStroskaId: SID, kontoPopravkaId: POPID };

/**
 * Standardni OUTER queue (brez period lookup — ta je zdaj po dryRun, samo za non-dryRun).
 *
 * Dejanski vrstni red DB klicev v POST handlerju:
 *   [0] companyModulesTable           — resolveOsModuleRole #1
 *   [1] osRolesTable                  — resolveOsModuleRole #2
 *   [2] osAmortizacijaNastavitveTable — nastavitve (ni več period lookup pred tem!)
 *   [3] accountsTable                 — loadValidatedAccountMap default konti
 *   [4] osAmortizacijskeSkupineTable  — loadSredstvaData skupineRows
 *   [5] osnovnaSredstvaTable          — loadSredstvaData glaveRows
 *  ([6] osDoknjizbeTable              — samo ko glaveRows.length > 0)
 *   [6/7] accountsTable               — loadValidatedAccountMap all konti
 *
 * Za NON-dryRun (dodaj HA TE za GLK+period):
 *   MODULE_ERP — hasGlkModule
 *   [PERIOD_2024] — findPeriodForBooking
 */
function baseQueues(o: {
  nastavitve?: unknown;
  defAccs?: unknown[];
  skupineRows?: unknown[];
  glaveRows?: unknown[];
  doknjizbeRows?: unknown[];
  allAccs?: unknown[];
} = {}): unknown[][] {
  const q: unknown[][] = [
    MODULE_OK,                                        // [0]
    ROLE_ADMIN,                                       // [1]
    [o.nastavitve ?? NASTAVITVE],                     // [2] nastavitve (period REMOVED)
    o.defAccs ?? [ACC_STROSKI, ACC_POPRAVK],          // [3] loadValidatedAccountMap default
    o.skupineRows ?? [],                              // [4] loadSredstvaData skupineRows
    o.glaveRows ?? [],                                // [5] loadSredstvaData glaveRows
  ];
  if (o.glaveRows && o.glaveRows.length > 0) {
    q.push(o.doknjizbeRows ?? []);                    // [6] loadSredstvaData doknjizbeRows
  }
  q.push(o.allAccs ?? [ACC_STROSKI, ACC_POPRAVK]);   // [6/7] loadValidatedAccountMap all
  return q;
}

function setup(outerQueues: unknown[][], txQueues: unknown[][] = []) {
  dbState.queues = outerQueues;
  dbState.idx = 0;
  txState.queues = txQueues;
  txState.idx = 0;
  mockTransactionSpy.mockClear();
  mockInsertSpy.mockClear();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(osAmortizacijaKnjizenjRouter);
  return app;
}

// ─── Skupna sredstva za teste, ki morajo priti do GLK check ───────────────────
// Asset 12000 EUR @ 20%/leto, aktiviran 2023-01-01 → pozitivna amortizacija 2024

const ASSET_SKUPINA = [{ id: "sk1", racunovodskaStonja: "20", davcnaStonja: "20" }];
const ASSET_GLAVA   = [{ id: "g1", kontoStroskaId: SID, kontoPopravkaId: null, costCenterId: null, skupinaId: "sk1", status: "active", inventarnaSt: "001", naziv: "Stroj", accountId: null }];
const ASSET_DOKNJIZBA = [{ id: "d1", sredstvoId: "g1", seq: 0, nabavnaVrednost: "12000.00", odpisanaVrednost: "0.00", neamortizljiviDelPct: "0", datumAktivacije: "2023-01-01", datumIzpisa: null, status: "active" }];

// ─── Testi ────────────────────────────────────────────────────────────────────

describe("POST /os/:companyId/amortizacija/knjizenje — validacija in blokiranje", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  // ── Pravice ────────────────────────────────────────────────────────────────

  it("403 os_viewer — knjiženje ni dovoljeno; db.transaction NE pokliče", async () => {
    setup([MODULE_OK, ROLE_VIEWER]);
    const r = await request(app)
      .post(`/os/${CID}/amortizacija/knjizenje`)
      .send({ leto: 2024 });
    expect(r.status).toBe(403);
    expect(mockTransactionSpy).not.toHaveBeenCalled();
  }, 10_000);

  // ── GLK modul in samodejno iskanje obdobja (nova logika) ──────────────────

  it("403 NO_GLK_MODULE — OS-only podjetje (brez ERP modula) ne sme ustvariti GLK temeljnice; db.transaction NE pokliče", async () => {
    // Potrebujemo sredstvo z amortizacijo > 0, da pridemo čez brezKontov/vrstice check.
    // hasGlkModule vrne [] → false → 403
    setup([
      ...baseQueues({
        skupineRows: ASSET_SKUPINA,
        glaveRows:   ASSET_GLAVA,
        doknjizbeRows: ASSET_DOKNJIZBA,
      }),
      [],           // hasGlkModule → false (OS-only)
    ]);
    const r = await request(app)
      .post(`/os/${CID}/amortizacija/knjizenje`)
      .send({ leto: 2024, dryRun: false });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("NO_GLK_MODULE");
    expect(mockTransactionSpy).not.toHaveBeenCalled();
  }, 10_000);

  it("400 NO_PERIOD_FOR_LETO — GLK podjetje, ni odprtega GLK obdobja za leto; db.transaction NE pokliče", async () => {
    // hasGlkModule vrne MODULE_ERP → true; findPeriodForBooking vrne [] → null → 400
    setup([
      ...baseQueues({
        skupineRows: ASSET_SKUPINA,
        glaveRows:   ASSET_GLAVA,
        doknjizbeRows: ASSET_DOKNJIZBA,
      }),
      MODULE_ERP,   // hasGlkModule → true
      [],           // findPeriodForBooking → null (ni ustreznega obdobja)
    ]);
    const r = await request(app)
      .post(`/os/${CID}/amortizacija/knjizenje`)
      .send({ leto: 2024, dryRun: false });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("NO_PERIOD_FOR_LETO");
    expect(mockTransactionSpy).not.toHaveBeenCalled();
  }, 10_000);

  // ── Letni/mesečni vzajemni izklop (pod pg_advisory_xact_lock) ─────────────

  it("409 MONTHLY_EXISTS_FOR_YEAR — letni obračun, ko mesečni obstajajo; noben INSERT v DB", async () => {
    setup(
      [
        ...baseQueues({
          skupineRows:   ASSET_SKUPINA,
          glaveRows:     ASSET_GLAVA,
          doknjizbeRows: ASSET_DOKNJIZBA,
        }),
        MODULE_ERP,       // hasGlkModule → true
        [PERIOD_2024],    // findPeriodForBooking → najdeno
      ],
      [[{ count: 3 }]],   // txState: mesecni obstajajo
    );
    const r = await request(app)
      .post(`/os/${CID}/amortizacija/knjizenje`)
      .send({ leto: 2024 });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("MONTHLY_EXISTS_FOR_YEAR");
    expect(mockInsertSpy).not.toHaveBeenCalled();
  }, 10_000);

  it("409 ANNUAL_EXISTS_FOR_YEAR — mesečni obračun, ko letni obstaja; noben INSERT v DB", async () => {
    setup(
      [
        ...baseQueues({
          skupineRows:   ASSET_SKUPINA,
          glaveRows:     ASSET_GLAVA,
          doknjizbeRows: ASSET_DOKNJIZBA,
        }),
        MODULE_ERP,       // hasGlkModule → true
        [PERIOD_2024],    // findPeriodForBooking → najdeno
      ],
      [[{ id: "annual-uuid" }]],  // txState: letni obstaja
    );
    const r = await request(app)
      .post(`/os/${CID}/amortizacija/knjizenje`)
      .send({ leto: 2024, mesec: 6 });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("ANNUAL_EXISTS_FOR_YEAR");
    expect(mockInsertSpy).not.toHaveBeenCalled();
  }, 10_000);

  // ── Nastavitve kontov ──────────────────────────────────────────────────────

  it("400 MISSING_AMORT_ACCOUNTS — brez privzetih kontov; db.transaction NE pokliče", async () => {
    setup([
      MODULE_OK, ROLE_ADMIN,
      [{ kontoStroskaId: null, kontoPopravkaId: null }],  // nastavitve brez kontov
    ]);
    const r = await request(app)
      .post(`/os/${CID}/amortizacija/knjizenje`)
      .send({ leto: 2024 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("MISSING_AMORT_ACCOUNTS");
    expect(mockTransactionSpy).not.toHaveBeenCalled();
  }, 10_000);

  // ── INCOMPLETE_ACCOUNTS / prazna amortizacija ─────────────────────────────
  //
  // Oba primera vrneta 400 PRED GLK check — noben INSERT in transaction se NE pokliče.

  it("400 — neaktiven lastni konto ali prazna amortizacija → noben DB INSERT (db.transaction NE pokliče)", async () => {
    const INACTIVE_ID = "iiii0000-0000-0000-0000-000000000099";
    const inactiveAcc = {
      id: INACTIVE_ID, code: "4999", name: "Neaktiven",
      isActive: false, allowsPosting: true,
      requiresCostCenter: false, requiresPartner: false, requiresProject: false,
    };
    setup(baseQueues({
      allAccs: [ACC_STROSKI, ACC_POPRAVK, inactiveAcc],
      skupineRows: [{ id: "sk1", racunovodskaStonja: "20", davcnaStonja: "20" }],
      glaveRows: [{ id: "g1", kontoStroskaId: INACTIVE_ID, kontoPopravkaId: null, costCenterId: null, skupinaId: "sk1", status: "active", inventarnaSt: "001", naziv: "Stroj", accountId: null }],
      doknjizbeRows: [{ id: "d1", sredstvoId: "g1", seq: 0, nabavnaVrednost: "10000.00", odpisanaVrednost: "0.00", neamortizljiviDelPct: "0", datumAktivacije: "2023-01-01", datumIzpisa: null, status: "active" }],
    }));

    const r = await request(app)
      .post(`/os/${CID}/amortizacija/knjizenje`)
      .send({ leto: 2024, dryRun: false });

    expect(r.status).toBe(400);
    expect(mockTransactionSpy).not.toHaveBeenCalled();
  }, 10_000);

  it("400 — requiresPartner konto ali prazna amortizacija → noben DB INSERT (db.transaction NE pokliče)", async () => {
    const PARTNER_ID = "pppp0000-0000-0000-0000-000000000088";
    const partnerAcc = {
      id: PARTNER_ID, code: "4888", name: "Partner konto",
      isActive: true, allowsPosting: true,
      requiresCostCenter: false, requiresPartner: true, requiresProject: false,
    };
    setup(baseQueues({
      allAccs: [ACC_STROSKI, ACC_POPRAVK, partnerAcc],
      skupineRows: [{ id: "sk1", racunovodskaStonja: "20", davcnaStonja: "20" }],
      glaveRows: [{ id: "g2", kontoStroskaId: PARTNER_ID, kontoPopravkaId: null, costCenterId: null, skupinaId: "sk1", status: "active", inventarnaSt: "002", naziv: "Vozilo", accountId: null }],
      doknjizbeRows: [{ id: "d2", sredstvoId: "g2", seq: 0, nabavnaVrednost: "5000.00", odpisanaVrednost: "0.00", neamortizljiviDelPct: "0", datumAktivacije: "2023-01-01", datumIzpisa: null, status: "active" }],
    }));

    const r = await request(app)
      .post(`/os/${CID}/amortizacija/knjizenje`)
      .send({ leto: 2024, dryRun: false });

    expect(r.status).toBe(400);
    expect(mockTransactionSpy).not.toHaveBeenCalled();
  }, 10_000);

  // ── dryRun ────────────────────────────────────────────────────────────────
  //
  // dryRun=true ne zahteva GLK modula ali accounting_periods.
  // Queue vsebuje SAMO outer klice do allAccs — BEZ MODULE_ERP in PERIOD.

  it("200 dryRun=true — predogled brez kreacije; db.transaction NE pokliče (BEZ GLK klica)", async () => {
    setup(baseQueues());   // skupineRows=[], glaveRows=[] → prazna amortizacija; ni GLK/period klica
    const r = await request(app)
      .post(`/os/${CID}/amortizacija/knjizenje`)
      .send({ leto: 2024, dryRun: true });

    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("skupajBreme", "0.00");
    expect(r.body).toHaveProperty("skupajDobro", "0.00");
    expect(r.body.vrstice).toHaveLength(0);
    expect(r.body.uravnotezeno).toBe(true);
    expect(mockTransactionSpy).not.toHaveBeenCalled();
  }, 10_000);
});
