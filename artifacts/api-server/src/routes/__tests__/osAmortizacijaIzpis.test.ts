/**
 * Testi za GET /os/:companyId/amortizacija/izpis
 *
 * Pokriva:
 *   1. Brez shranjenega obračuna → 404 z jasnim sporočilom (NO_OBRACUN)
 *   2. Obračun do meseca 6 → branje iz shranjenih vrstic, referenca vsebuje do_meseca
 *   3. Obračun za celo leto (do_meseca=12) → referenca brez meseca
 *   4. CSV: opis vsebuje "do M/leto" ko doMeseca < 12
 *   5. Dostop brez OS vloge → 403
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── vi.hoisted ───────────────────────────────────────────────────────────────

const { dbState } = vi.hoisted(() => {
  const dbState = {
    queues: [] as unknown[][],
    idx: 0,
  };
  return { dbState };
});

// ─── @workspace/db mock ──────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  function nextFrom(state: typeof dbState): unknown[] {
    const r = state.queues[state.idx++];
    return r ?? [];
  }
  function makeChain(): Record<string, unknown> {
    const rows = nextFrom(dbState);
    const p = Promise.resolve(rows);
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      limit: () => p,
      orderBy: () => p,
      then: p.then.bind(p),
      catch: (p as Promise<unknown[]>).catch.bind(p),
    };
    return chain;
  }
  return {
    db: { select: () => makeChain() },
    osAmortizacijaObracunTable: {
      id: "id", companyId: "company_id", leto: "leto",
      doMeseca: "do_meseca", status: "status",
    },
    osAmortizacijaObracunSredstvoTable: {
      id: "id", obracunId: "obracun_id", sredstvoId: "sredstvo_id",
      obracunano: "obracunano",
    },
    osAmortizacijaNastavitveTable: {
      companyId: "company_id", kontoStroskaId: "konto_stroska_id",
      kontoPopravkaId: "konto_popravka_id", osLeto: "os_leto",
    },
    companyModulesTable: { companyId: "company_id", module: "module" },
    osRolesTable: { clerkUserId: "clerk_user_id", companyId: "company_id", role: "role" },
    accountsTable: {
      id: "id", companyId: "company_id", code: "code", name: "name",
      isActive: "is_active", allowsPosting: "allows_posting",
      requiresCostCenter: "requires_cost_center",
      requiresPartner: "requires_partner", requiresProject: "requires_project",
    },
    accountingPeriodsTable: { id: "id", companyId: "company_id" },
    journalEntriesTable: { id: "id" },
    journalEntryLinesTable: { id: "id" },
    osAmortizacijskeSkupineTable: {
      id: "id", companyId: "company_id", koda: "koda", naziv: "naziv",
      racunovodskaStonja: "racunovodska_stonja", davcnaStonja: "davcna_stonja",
    },
    osnovnaSredstvaTable: {
      id: "id", companyId: "company_id", inventarnaSt: "inventarna_st",
      naziv: "naziv", skupinaId: "skupina_id", costCenterId: "cost_center_id",
      accountId: "account_id", kontoStroskaId: "konto_stroska_id",
      kontoPopravkaId: "konto_popravka_id", status: "status",
    },
    osDoknjizbeTable: {
      id: "id", sredstvoId: "sredstvo_id", seq: "seq",
      nabavnaVrednost: "nabavna_vrednost", odpisanaVrednost: "odpisana_vrednost",
      neamortizljiviDelPct: "neamortizljivi_del_pct",
      datumAktivacije: "datum_aktivacije", datumIzpisa: "datum_izpisa", status: "status",
    },
    accountingRolesTable: {},
    companiesTable: { id: "id", naziv: "naziv", podjetjeDavcna: "podjetje_davcna" },
  };
});

// ─── drizzle-orm mock ─────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({ _tag: "eq" })),
  and: vi.fn((...args: unknown[]) => ({ _tag: "and", args })),
  inArray: vi.fn(() => ({ _tag: "inArray" })),
  asc: vi.fn((a: unknown) => a),
  like: vi.fn(() => ({ _tag: "like" })),
  sql: vi.fn(() => ({ _tag: "sql" })),
  or: vi.fn(() => ({ _tag: "or" })),
  lte: vi.fn(() => ({ _tag: "lte" })),
  gte: vi.fn(() => ({ _tag: "gte" })),
}));

// ─── @clerk/express mock ──────────────────────────────────────────────────────

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: { authorization?: string } }) => ({
    userId: req.headers.authorization?.replace("Bearer ", "") ?? null,
  }),
}));

// ─── PDF mock (prepreči dejanski PDF render v testih) ─────────────────────────

vi.mock("../lib/report-pdf", () => ({
  generateAmortizacijaTemeljnicaPdf: vi.fn(async () => Buffer.from("PDF")),
}));

// ─── buildApp ────────────────────────────────────────────────────────────────

async function buildApp() {
  const { default: router } = await import("../osAmortizacijaKnjizenje");
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

// ─── Mock vrednosti ───────────────────────────────────────────────────────────

const MOCK_NASTAVITVE = [{ kontoStroskaId: "ks-1", kontoPopravkaId: "kp-1", osLeto: 2024 }];
const MOCK_COMPANY = [{ naziv: "Testno d.o.o.", podjetjeDavcna: "SI12345678" }];
const MOCK_ACC_MAP = [
  {
    id: "ks-1", code: "4300", name: "Amort. stroški",
    isActive: true, allowsPosting: true,
    requiresCostCenter: false, requiresPartner: false, requiresProject: false,
  },
  {
    id: "kp-1", code: "0190", name: "Popravek vrednosti",
    isActive: true, allowsPosting: true,
    requiresCostCenter: false, requiresPartner: false, requiresProject: false,
  },
];

/** Shranjeni obračun do meseca 6 */
const MOCK_OBRACUN_DO6 = [{ id: "obr-2024", doMeseca: 6, status: "odprt" }];
/** Shranjeni obračun za celo leto */
const MOCK_OBRACUN_DO12 = [{ id: "obr-2024", doMeseca: 12, status: "zakljucen" }];
/** Shranjene vrstice obračuna: 1 sredstvo, obracunano=500 */
const MOCK_VRSTICE = [{
  sredstvoId: "sredstvo-1",
  obracunano: "500.00",
  kontoStroskaId: "ks-1",
  kontoPopravkaId: "kp-1",
  costCenterId: null,
}];

/**
 * Postavi vrsto DB odgovorov za tipično GET /izpis zahtevo.
 * Vrstni red:
 *   [0] resolveOsModuleRole → companyModules
 *   [1] resolveOsModuleRole → osRoles
 *   [2] nastavitve
 *   [3] company
 *   [4] savedObracun (os_amortizacija_obracun)
 *   [5] savedVrstice (os_amortizacija_obracun_sredstvo JOIN osnovna_sredstva) — samo če je obracun najden
 *   [6] accountMap — samo če je obracun najden
 */
function pushIzpisQueues(opts: {
  role?: string;
  nastavitve?: unknown[];
  savedObracun?: unknown[];
  savedVrstice?: unknown[];
  accMap?: unknown[];
}) {
  // resolveOsModuleRole
  dbState.queues.push([{ module: "osnovna_sredstva" }]);
  dbState.queues.push([{ role: opts.role ?? "os_admin" }]);
  // nastavitve
  dbState.queues.push(opts.nastavitve ?? MOCK_NASTAVITVE);
  // company
  dbState.queues.push(MOCK_COMPANY);
  // savedObracun
  dbState.queues.push(opts.savedObracun ?? MOCK_OBRACUN_DO6);
  if ((opts.savedObracun ?? MOCK_OBRACUN_DO6).length > 0) {
    // savedVrstice
    dbState.queues.push(opts.savedVrstice ?? MOCK_VRSTICE);
    // accountMap
    dbState.queues.push(opts.accMap ?? MOCK_ACC_MAP);
  }
}

// ─── TESTI ────────────────────────────────────────────────────────────────────

describe("GET /os/:companyId/amortizacija/izpis — branje iz shranjenega obračuna", () => {
  beforeEach(() => {
    dbState.queues = [];
    dbState.idx = 0;
  });

  // ── 1. Brez shranjenega obračuna → 404 z NO_OBRACUN ──────────────────────

  it("Brez shranjenega obračuna za leto → 404, code=NO_OBRACUN", async () => {
    pushIzpisQueues({ savedObracun: [] }); // prazno → ni obračuna

    const app = await buildApp();
    const res = await request(app)
      .get("/os/company-1/amortizacija/izpis?leto=2024&format=csv")
      .set("Authorization", "Bearer test-uid");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NO_OBRACUN");
    expect(res.body.error).toMatch(/2024/);
    expect(res.body.error).toMatch(/ni shranjenega obračuna/i);
  });

  // ── 2. Obračun do meseca 6 → referenca vsebuje do_meseca ─────────────────

  it("Obračun do meseca 6 → CSV referenca vsebuje '/06', opis vsebuje 'do 6/2024'", async () => {
    pushIzpisQueues({ savedObracun: MOCK_OBRACUN_DO6, savedVrstice: MOCK_VRSTICE });

    const app = await buildApp();
    const res = await request(app)
      .get("/os/company-1/amortizacija/izpis?leto=2024&format=csv")
      .set("Authorization", "Bearer test-uid");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);

    const csv = res.text;
    // Opis mora vsebovati "do 6/2024"
    expect(csv).toMatch(/do 6\/2024/);
    // Filename mora vsebovati mesec
    expect(res.headers["content-disposition"]).toMatch(/do06/);
  });

  // ── 3. Obračun za celo leto (doMeseca=12) → brez mesečnega opisa ─────────

  it("Obračun do meseca 12 → CSV opis NE vsebuje 'do M/leto', filename brez meseca", async () => {
    pushIzpisQueues({ savedObracun: MOCK_OBRACUN_DO12 });

    const app = await buildApp();
    const res = await request(app)
      .get("/os/company-1/amortizacija/izpis?leto=2024&format=csv")
      .set("Authorization", "Bearer test-uid");

    expect(res.status).toBe(200);
    const csv = res.text;
    // Opis NE sme vsebovati "do M/leto"
    expect(csv).not.toMatch(/do \d+\/\d{4}/);
    // Filename = amortizacija-temeljnica-2024.csv
    expect(res.headers["content-disposition"]).toContain("2024.csv");
    expect(res.headers["content-disposition"]).not.toMatch(/do\d+/);
  });

  // ── 4. Shranjeni zneski se uporabijo (ne recalc) ──────────────────────────

  it("Obračun do 6: obracunano=500.00 iz vrstice se pojavi v CSV zneski", async () => {
    pushIzpisQueues({
      savedObracun: MOCK_OBRACUN_DO6,
      savedVrstice: [{ ...MOCK_VRSTICE[0], obracunano: "500.00" }],
    });

    const app = await buildApp();
    const res = await request(app)
      .get("/os/company-1/amortizacija/izpis?leto=2024&format=csv")
      .set("Authorization", "Bearer test-uid");

    expect(res.status).toBe(200);
    const csv = res.text;
    // 500,00 (sl decimalna vejica v CSV)
    expect(csv).toMatch(/500,00/);
  });

  // ── 5. Dostop brez OS vloge → 403 ────────────────────────────────────────

  it("Brez OS vloge → 403", async () => {
    // resolveOsModuleRole: companyModules → ima OS modul, osRoles → prazen (ni vloge)
    dbState.queues.push([{ module: "osnovna_sredstva" }]);
    dbState.queues.push([]); // ni vloge

    const app = await buildApp();
    const res = await request(app)
      .get("/os/company-1/amortizacija/izpis?leto=2024&format=csv")
      .set("Authorization", "Bearer test-uid");

    expect(res.status).toBe(403);
  });

  // ── 6. PDF format → 200, content-type application/pdf ────────────────────

  it("Obračun do 6, format=pdf → 200 PDF, filename vsebuje mesec", async () => {
    pushIzpisQueues({ savedObracun: MOCK_OBRACUN_DO6 });

    const app = await buildApp();
    const res = await request(app)
      .get("/os/company-1/amortizacija/izpis?leto=2024&format=pdf")
      .set("Authorization", "Bearer test-uid");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toMatch(/do06/);
    expect(res.headers["content-disposition"]).toMatch(/\.pdf/);
  });
});
