import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { state } = vi.hoisted(() => ({
  state: {
    userId: "pos-user",
    posUsers: [] as Array<{ id: number; companyId: string; vloga: string; dodeljenaEnotaId: number | null }>,
    enota: null as {
      id: number;
      companyId: string;
      aktiven: boolean;
      idZaDdv: string | null;
      capabilities: string[];
      posPlan: "lite" | "standard" | "extended" | null;
    } | null,
    updateValues: null as Record<string, unknown> | null,
  },
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();

  function select() {
    let table: unknown;
    const promise = () => {
      if (table === original.posUporabnikiTable) return Promise.resolve(state.posUsers);
      if (table === original.enoteTable) return Promise.resolve(state.enota ? [state.enota] : []);
      return Promise.resolve([]);
    };
    const result = {
      from: (value: unknown) => { table = value; return result; },
      innerJoin: () => result,
      leftJoin: () => result,
      where: () => result,
      orderBy: () => result,
      limit: () => result,
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => promise().then(resolve, reject),
      catch: (reject: (reason: unknown) => unknown) => promise().catch(reject),
    };
    return result;
  }

  function update() {
    const result = {
      set: (values: Record<string, unknown>) => {
        state.updateValues = values;
        return result;
      },
      where: () => ({
        returning: async () => state.enota
          ? [{ ...state.enota, ...state.updateValues }]
          : [],
      }),
    };
    return result;
  }

  return {
    ...original,
    db: {
      select,
      update,
    },
  };
});

import {
  requireEnota,
  requirePosAdminRole,
  requirePosCompany,
  requireUnitCapability,
  resolveUnitCapability,
} from "./pos";
import enoteRouter from "../routes/pos/enote";
import posRouter from "../routes/pos";

function app() {
  const result = express();
  result.use(requireEnota);
  result.get("/", (req, res) => {
    res.json({
      enotaId: (req as any).enotaId,
      companyId: (req as any).companyId,
      vloga: (req as any).vloga,
    });
  });
  return result;
}

function companyScopeApp() {
  const result = express();
  result.use(express.json());
  result.use(requirePosCompany);
  result.use("/enote", enoteRouter);
  return result;
}

function companyScopeMiddlewareApp() {
  const result = express();
  result.use(requirePosCompany);
  result.get("/", (req, res) => {
    res.json({
      companyId: (req as any).companyId,
      vloga: (req as any).vloga,
    });
  });
  return result;
}

function capabilityApp(vloga = "uporabnik") {
  const result = express();
  result.use((req, _res, next) => {
    (req as any).enotaId = 1;
    (req as any).companyId = "company-a";
    (req as any).vloga = vloga;
    next();
  });
  result.use(requireUnitCapability);
  result.use((_req, res) => res.json({ ok: true }));
  return result;
}

function fullPosApp() {
  const result = express();
  result.use(express.json());
  result.use((req, _res, next) => {
    (req as any).log = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    };
    next();
  });
  result.use(posRouter);
  return result;
}

beforeEach(() => {
  state.userId = "pos-user";
  state.posUsers = [{
    id: 1,
    companyId: "company-a",
    vloga: "uporabnik",
    dodeljenaEnotaId: 1,
  }];
  state.enota = {
    id: 1,
    companyId: "company-a",
    aktiven: true,
    idZaDdv: null,
    capabilities: [],
    posPlan: "extended",
  };
  state.updateValues = null;
});

describe("requireEnota — dostop po vlogi", () => {
  it("navadnega uporabnika zavrne ob zahtevi za drugo enoto istega podjetja", async () => {
    const response = await request(app()).get("/").set("X-Enota-Id", "2");

    expect(response.status).toBe(403);
    expect(response.body.koda).toBe("ENOTA_NEDOSTOPNA");
  });

  it("adminu podjetja dovoli drugo enoto istega podjetja", async () => {
    state.posUsers = [{
      id: 1,
      companyId: "company-a",
      vloga: "admin",
      dodeljenaEnotaId: null,
    }];
    state.enota = { id: 2, companyId: "company-a", aktiven: true, idZaDdv: null, capabilities: [], posPlan: "extended" };

    const response = await request(app()).get("/").set("X-Enota-Id", "2");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ enotaId: 2, companyId: "company-a", vloga: "admin" });
  });

  it("deaktivirano enoto zavrne pred vstopom v POS ruto", async () => {
    state.enota = { id: 1, companyId: "company-a", aktiven: false, idZaDdv: null, capabilities: [], posPlan: "extended" };

    const response = await request(app()).get("/").set("X-Enota-Id", "1");

    expect(response.status).toBe(403);
    expect(response.body.koda).toBe("ENOTA_NEDOSTOPNA");
  });

  it("upošteva eksplicitno izbrano podjetje pri uporabniku z več POS vlogami", async () => {
    state.posUsers = [
      { id: 1, companyId: "company-a", vloga: "admin", dodeljenaEnotaId: null },
      { id: 2, companyId: "company-b", vloga: "admin", dodeljenaEnotaId: null },
    ];
    state.enota = { id: 22, companyId: "company-b", aktiven: true, idZaDdv: null, capabilities: [], posPlan: "extended" };

    const response = await request(app())
      .get("/")
      .set("X-Company-Id", "company-b")
      .set("X-Enota-Id", "22");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ enotaId: 22, companyId: "company-b", vloga: "admin" });
  });

  it("ob več podjetjih brez izbire ne ugiba", async () => {
    state.posUsers = [
      { id: 1, companyId: "company-a", vloga: "admin", dodeljenaEnotaId: null },
      { id: 2, companyId: "company-b", vloga: "admin", dodeljenaEnotaId: null },
    ];

    const response = await request(app()).get("/").set("X-Enota-Id", "1");

    expect(response.status).toBe(400);
    expect(response.body.koda).toBe("PODJETJE_NEJASNO");
  });

  it("enako zahteva izbiro tudi na company-scope poti", async () => {
    state.posUsers = [
      { id: 1, companyId: "company-a", vloga: "admin", dodeljenaEnotaId: null },
      { id: 2, companyId: "company-b", vloga: "admin", dodeljenaEnotaId: null },
    ];

    const response = await request(companyScopeMiddlewareApp()).get("/");

    expect(response.status).toBe(400);
    expect(response.body.koda).toBe("PODJETJE_NEJASNO");
  });

  it("company-scope pot uporabi izrecno izbrano podjetje", async () => {
    state.posUsers = [
      { id: 1, companyId: "company-a", vloga: "admin", dodeljenaEnotaId: null },
      { id: 2, companyId: "company-b", vloga: "admin", dodeljenaEnotaId: null },
    ];

    const response = await request(companyScopeMiddlewareApp())
      .get("/")
      .set("X-Company-Id", "company-b");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ companyId: "company-b", vloga: "admin" });
  });

  it("company-scope pot omogoča adminu reaktivacijo deaktivirane enote", async () => {
    state.posUsers = [{
      id: 1,
      companyId: "company-a",
      vloga: "admin",
      dodeljenaEnotaId: null,
    }];
    state.enota = { id: 1, companyId: "company-a", aktiven: false, idZaDdv: null, capabilities: [], posPlan: "extended" };

    const response = await request(companyScopeApp())
      .put("/enote/1")
      .send({ aktiven: true });

    expect(response.status).toBe(200);
    expect(state.updateValues).toMatchObject({ aktiven: true });
    expect(response.body.aktiven).toBe(true);
  });
});

describe("requireUnitCapability — neposredni API dostop", () => {
  it.each([
    ["/mize", "tables"],
    ["/blagajne", "checkout"],
    ["/artikli", "menu"],
    ["/dostava/kurirji", "delivery"],
    ["/narocila/42/dostava-status", "delivery"],
    ["/pos-events", "events"],
  ])("pot %s zahteva funkcijo %s", async (path, capability) => {
    expect(resolveUnitCapability(path)).toBe(capability);
    state.enota!.capabilities = [];

    const response = await request(capabilityApp()).get(path);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      koda: "FUNKCIJA_ENOTE_ONEMOGOCENA",
      funkcija: capability,
    });
  });

  it("dovoli pot, ko je zahtevana funkcija omogočena", async () => {
    state.enota!.capabilities = ["menu"];

    const response = await request(capabilityApp()).get("/artikli");

    expect(response.status).toBe(200);
  });

  it("paket Lite zavrne funkcijo, četudi jo ima enota vključeno", async () => {
    state.enota!.capabilities = ["delivery"];
    state.enota!.posPlan = "lite";

    const response = await request(capabilityApp()).get("/dostava/kurirji");

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      koda: "POS_PAKET_FUNKCIJE_NE_VKLJUCUJE",
      funkcija: "delivery",
      paket: "lite",
    });
  });

  it("paket Standard dovoli mize, vendar zavrne rezervacije", async () => {
    state.enota!.capabilities = ["tables", "reservations"];
    state.enota!.posPlan = "standard";

    const tablesResponse = await request(capabilityApp()).get("/mize");
    const reservationsResponse = await request(capabilityApp()).get("/rezervacije");

    expect(tablesResponse.status).toBe(200);
    expect(reservationsResponse.status).toBe(403);
    expect(reservationsResponse.body.koda).toBe("POS_PAKET_FUNKCIJE_NE_VKLJUCUJE");
  });

  it("namenske poti uporabljajo napredne paketne funkcije", () => {
    expect(resolveUnitCapability("/multicourse-menus")).toBe("multi_course");
    expect(resolveUnitCapability("/qr-admin/status")).toBe("qr_menu");
    expect(resolveUnitCapability("/darilni-boni/stanje")).toBe("deposits_tokens");
    expect(resolveUnitCapability("/pos-events/12/transfer-history")).toBe("stock_transfers");
  });

  it("neznano poslovno pot zavrne zaprto", async () => {
    state.enota!.capabilities = ["settings"];

    const response = await request(capabilityApp()).get("/nov-nepreslikan-modul");

    expect(response.status).toBe(403);
    expect(response.body.koda).toBe("POT_ENOTE_NEPRESLIKANA");
  });

  it("ohrani izrecni superadmin bypass", async () => {
    state.enota!.capabilities = [];

    const superadmin = await request(capabilityApp("superadmin")).get("/nov-nepreslikan-modul");

    expect(superadmin.status).toBe(200);
  });

  it("certifikat zahteva settings in pravo administratorsko vlogo", async () => {
    expect(resolveUnitCapability("/certifikat/info")).toBe("settings");
    state.enota!.capabilities = ["settings"];
    const app = express();
    app.use((req, _res, next) => {
      (req as any).vloga = "uporabnik";
      next();
    });
    app.use(requirePosAdminRole);
    app.use((_req, res) => res.json({ ok: true }));

    const response = await request(app).get("/certifikat/info");

    expect(response.status).toBe(403);
    expect(response.body.koda).toBe("POS_ADMIN_OBVEZEN");
  });
});

describe("dejansko nameščeni POS router — poti pred globalno zaščito", () => {
  it("blokira destruktivno simulacijo brez funkcije simulation", async () => {
    state.enota!.capabilities = [];

    const response = await request(fullPosApp())
      .post("/sim/reset")
      .set("X-Enota-Id", "1");

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      koda: "FUNKCIJA_ENOTE_ONEMOGOCENA",
      funkcija: "simulation",
    });
  });

  it("blokira SSE tok brez operativne funkcije checkout", async () => {
    state.enota!.capabilities = [];

    const response = await request(fullPosApp())
      .get("/events")
      .set("X-Enota-Id", "1");

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      koda: "FUNKCIJA_ENOTE_ONEMOGOCENA",
      funkcija: "checkout",
    });
  });

  it("certifikat tudi ob funkciji settings zavrne navadnega uporabnika", async () => {
    state.enota!.capabilities = ["settings"];

    const response = await request(fullPosApp())
      .get("/certifikat/info")
      .set("X-Enota-Id", "1");

    expect(response.status).toBe(403);
    expect(response.body.koda).toBe("POS_ADMIN_OBVEZEN");
  });

  it("certifikat dovoli administratorju z omogočeno funkcijo settings", async () => {
    state.posUsers[0]!.vloga = "admin";
    state.posUsers[0]!.dodeljenaEnotaId = null;
    state.enota!.capabilities = ["settings"];

    const response = await request(fullPosApp())
      .get("/certifikat/info")
      .set("X-Enota-Id", "1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ nastavljen: false, subject: null, veljaDo: null });
  });
});