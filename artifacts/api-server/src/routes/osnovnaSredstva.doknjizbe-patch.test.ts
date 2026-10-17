import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/db")>(),
  db: mocks,
}));
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middlewares/requireSuperAdmin", () => ({
  isSuperAdmin: () => true,
}));

import router from "./osnovnaSredstva";

const app = express();
app.use(express.json());
app.use(router);

const url = "/companies/company-1/osnovna-sredstva/asset-1/doknjizbe/purchase-1";

function selectRows(rows: unknown[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
}

describe("PATCH doknjižbe — osnovni nakup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.select.mockReturnValueOnce(selectRows([{ id: "asset-1" }]));
  });

  it.each([
    { nabavnaVrednost: "9999.00" },
    { nazivVlaganja: "Spremenjen osnovni nakup" },
    {},
  ])("zavrne seq=0 brez zapisa v bazo: %j", async (body) => {
    mocks.select.mockReturnValueOnce(selectRows([{ id: "purchase-1", seq: 0 }]));

    const response = await request(app).patch(url).send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Osnovni nakup uredite prek obrazca Uredi osnovno sredstvo, ne kot dograditev.",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("še vedno dovoli urejanje dograditve s seq>0", async () => {
    mocks.select.mockReturnValueOnce(selectRows([{ id: "purchase-1", seq: 1 }]));
    const updated = {
      id: "purchase-1",
      seq: 1,
      nabavnaVrednost: "1200.00",
      odpisanaVrednost: "100.00",
      neamortizljiviDelPct: "0",
    };
    const set = vi.fn(() => ({
      where: () => ({ returning: async () => [updated] }),
    }));
    mocks.update.mockReturnValue({ set });

    const response = await request(app).patch(url).send({ nabavnaVrednost: "1200.00" });

    expect(response.status).toBe(200);
    expect(set).toHaveBeenCalledWith({ nabavnaVrednost: "1200.00" });
    expect(response.body.sedanjaVrednost).toBe("1100.00");
  });

  it("za neobstoječo doknjižbo ohrani odgovor 404", async () => {
    mocks.select.mockReturnValueOnce(selectRows([]));

    const response = await request(app).patch(url).send({ nabavnaVrednost: "1200.00" });

    expect(response.status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
