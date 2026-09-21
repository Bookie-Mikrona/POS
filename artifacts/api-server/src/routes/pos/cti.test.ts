import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { state } = vi.hoisted(() => ({
  state: {
    enote: [
      { id: 1, ctiToken: "cti-token-enota-ena", aktiven: true },
      { id: 2, ctiToken: "cti-token-enota-dva", aktiven: true },
    ] as Array<{ id: number; ctiToken: string | null; aktiven: boolean }>,
    customer: { id: 71, ime: "Ana Novak" } as { id: number; ime: string } | null,
    calls: [] as Array<{ id: number; enotaId: number; telefon: string; prejeto: Date; obravnavano: boolean; narocnikId: number | null; narocnikIme: string | null }>,
    inserted: null as Record<string, unknown> | null,
    requestEnotaId: 1,
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();

  function select(projection?: Record<string, unknown>) {
    let table: unknown;
    let joined = false;
    let limited = false;
    const result = {
      from: (value: unknown) => { table = value; return result; },
      where: () => result,
      leftJoin: () => { joined = true; return result; },
      limit: () => { limited = true; return result; },
      orderBy: () => result,
      then: (resolve: (value: unknown) => unknown) => {
        if (joined) {
          const now = Date.now();
          return Promise.resolve(state.calls
            .filter(call => call.enotaId === state.requestEnotaId && !call.obravnavano && call.prejeto.getTime() >= now - 120_000)
            .sort((a, b) => b.prejeto.getTime() - a.prejeto.getTime())
            .map(call => ({
              id: call.id,
              telefon: call.telefon,
              prejeto: call.prejeto,
              narocnikId: call.narocnikId,
              narocnikIme: call.narocnikIme,
            }))).then(resolve);
        }
        if (table === original.enoteTable) {
          const rows = limited
            ? state.enote.filter(enota => enota.id === state.requestEnotaId && enota.aktiven).map(enota => ({ ctiToken: enota.ctiToken }))
            : state.enote.filter(enota => enota.aktiven && enota.ctiToken != null).map(enota => ({ id: enota.id, ctiToken: enota.ctiToken }));
          return Promise.resolve(rows).then(resolve);
        }
        if (table === original.narocnikiTable) return Promise.resolve(state.customer ? [{ id: state.customer.id }] : []).then(resolve);
        return Promise.resolve([]).then(resolve);
      },
    };
    return result;
  }

  return {
    ...original,
    db: {
      select,
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => ({
          returning: async () => {
            state.inserted = values;
            const call = {
              id: state.calls.length + 1,
              enotaId: Number(values.enotaId),
              telefon: String(values.telefon),
              prejeto: new Date(),
              obravnavano: false,
              narocnikId: (values.narocnikId as number | null) ?? null,
              narocnikIme: state.customer?.ime ?? null,
            };
            if (table === original.ctiDohodniKliciTable) state.calls.push(call);
            return [{ id: call.id, prejeto: call.prejeto }];
          },
        }),
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              if (table === original.enoteTable) {
                const enota = state.enote.find(item => item.id === state.requestEnotaId && item.aktiven);
                if (!enota) return [];
                enota.ctiToken = String(values.ctiToken);
                return [{ ctiToken: enota.ctiToken }];
              }
              const call = state.calls.find(item => item.id === 1 && item.enotaId === state.requestEnotaId && !item.obravnavano);
              if (!call) return [];
              call.obravnavano = true;
              return [{ id: call.id }];
            },
          }),
        }),
      }),
    },
  };
});

import ctiRouter, { ctiIncomingRouter } from "./cti";

function publicApp() {
  const app = express();
  app.use(express.json());
  app.use(ctiIncomingRouter);
  return app;
}

function posApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    state.requestEnotaId = Number(req.get("X-Test-Enota") ?? 1);
    (req as unknown as { enotaId: number; vloga: string }).enotaId = state.requestEnotaId;
    (req as unknown as { enotaId: number; vloga: string }).vloga = req.get("X-Test-Vloga") ?? "admin_enote";
    next();
  });
  app.use(ctiRouter);
  return app;
}

beforeEach(() => {
  state.enote = [
    { id: 1, ctiToken: "cti-token-enota-ena", aktiven: true },
    { id: 2, ctiToken: "cti-token-enota-dva", aktiven: true },
  ];
  state.customer = { id: 71, ime: "Ana Novak" };
  state.calls = [];
  state.inserted = null;
  state.requestEnotaId = 1;
});

describe("CTI dohodni klici", () => {
  it("veljaven žeton izbere enoto in ignorira enotaId iz telesa", async () => {
    const response = await request(publicApp())
      .post("/cti/dohodni-klic")
      .set("X-CTI-Token", "cti-token-enota-ena")
      .send({ telefon: "041 123 456", enotaId: 2 });

    expect(response.status).toBe(200);
    expect(response.body.narocnikId).toBe(71);
    expect(state.inserted).toMatchObject({
      enotaId: 1,
      telefon: "041 123 456",
      telefonNormaliziran: "+38641123456",
      narocnikId: 71,
    });
  });

  it("žeton druge enote ustvari klic izključno v svoji enoti", async () => {
    const response = await request(publicApp())
      .post("/cti/dohodni-klic")
      .set("X-CTI-Token", "cti-token-enota-dva")
      .send({ telefon: "041 123 456", enotaId: 1 });

    expect(response.status).toBe(200);
    expect(state.inserted).toMatchObject({ enotaId: 2 });
  });

  it("manjkajoč ali napačen žeton vrne 401 in ne shrani klica", async () => {
    const missing = await request(publicApp()).post("/cti/dohodni-klic").send({ telefon: "041 123 456" });
    const wrong = await request(publicApp())
      .post("/cti/dohodni-klic")
      .set("X-CTI-Token", "wrong-token")
      .send({ telefon: "041 123 456" });

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(state.calls).toHaveLength(0);
  });

  it("admin aktivne enote prebere in regenerira samo njen žeton", async () => {
    const app = posApp();
    const before = await request(app).get("/cti/token").set("X-Test-Enota", "1");
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ ctiToken: "cti-token-enota-ena" });

    const regenerated = await request(app).post("/cti/token/generiraj").set("X-Test-Enota", "1");
    expect(regenerated.status).toBe(200);
    expect(regenerated.body.ctiToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(regenerated.body.ctiToken).not.toBe("cti-token-enota-ena");
    expect(state.enote.find(enota => enota.id === 2)?.ctiToken).toBe("cti-token-enota-dva");

    const oldToken = await request(publicApp())
      .post("/cti/dohodni-klic")
      .set("X-CTI-Token", "cti-token-enota-ena")
      .send({ telefon: "041 123 456" });
    const newToken = await request(publicApp())
      .post("/cti/dohodni-klic")
      .set("X-CTI-Token", regenerated.body.ctiToken)
      .send({ telefon: "041 123 456" });
    expect(oldToken.status).toBe(401);
    expect(newToken.status).toBe(200);
  });

  it("navaden uporabnik ne more brati ali generirati žetona", async () => {
    const app = posApp();
    const get = await request(app).get("/cti/token").set("X-Test-Vloga", "uporabnik");
    const post = await request(app).post("/cti/token/generiraj").set("X-Test-Vloga", "uporabnik");
    expect(get.status).toBe(403);
    expect(post.status).toBe(403);
  });

  it("vrne le nedavne neobravnavane klice aktivne enote", async () => {
    state.calls = [
      { id: 1, enotaId: 1, telefon: "041 111 111", prejeto: new Date(), obravnavano: false, narocnikId: 71, narocnikIme: "Ana Novak" },
      { id: 2, enotaId: 1, telefon: "041 222 222", prejeto: new Date(), obravnavano: true, narocnikId: null, narocnikIme: null },
      { id: 3, enotaId: 1, telefon: "041 333 333", prejeto: new Date(Date.now() - 180_000), obravnavano: false, narocnikId: null, narocnikIme: null },
      { id: 4, enotaId: 2, telefon: "041 444 444", prejeto: new Date(), obravnavano: false, narocnikId: null, narocnikIme: null },
    ];

    const response = await request(posApp()).get("/cti/aktivni-klici").set("X-Test-Enota", "1");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ id: 1, telefon: "041 111 111", narocnikIme: "Ana Novak" })]);
  });

  it("obravnavano skrije klic iz aktivnega seznama", async () => {
    state.calls = [{ id: 1, enotaId: 1, telefon: "041 111 111", prejeto: new Date(), obravnavano: false, narocnikId: null, narocnikIme: null }];

    const app = posApp();
    const handled = await request(app).post("/cti/klici/1/obravnavano");
    expect(handled.status).toBe(200);
    expect(handled.body).toEqual({ id: 1, obravnavano: true });

    const active = await request(app).get("/cti/aktivni-klici");
    expect(active.body).toEqual([]);
  });
});