import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

const { selects, updates, inserts, searchMock } = vi.hoisted(() => ({
  selects: [] as unknown[][],
  updates: [] as Array<{ set: unknown; where: unknown }>,
  inserts: [] as unknown[],
  searchMock: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  const thenable = (value: unknown) => ({ then: (resolve: (value: unknown) => unknown) => resolve(value), returning: () => Promise.resolve(value) });
  const select = () => {
    const chain: any = {};
    for (const method of ["from", "where", "innerJoin", "leftJoin", "orderBy", "limit"]) chain[method] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => resolve(selects.shift() ?? []);
    return chain;
  };
  const update = () => ({
    set: (set: unknown) => ({
      where: (where: unknown) => {
        updates.push({ set, where });
        return thenable([{ id: 1 }]);
      },
    }),
  });
  const insert = () => ({ values: (value: unknown) => { inserts.push(value); return Promise.resolve([]); } });
  return { ...original, db: { select, update, insert, transaction: async (callback: any) => callback({ update, insert }) } };
});
vi.mock("../../middlewares/pos", () => ({ requireEnota: (req: any, _res: unknown, next: () => void) => { req.enotaId = 1; next(); } }));
vi.mock("../../lib/objectStorage", () => ({ ObjectStorageService: class ObjectStorageService { searchPublicObject = searchMock; savePublicObject = vi.fn(); } }));
vi.mock("@workspace/integrations-gemini-ai/image", () => ({ generateImage: vi.fn(), ImageGenerationError: class ImageGenerationError extends Error {} }));

import artikliRouter from "./artikli";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => { (req as any).log = { error: vi.fn(), warn: vi.fn() }; next(); });
  instance.use(artikliRouter);
  return instance;
}

describe("različice slik artiklov", () => {
  beforeEach(() => { selects.length = 0; updates.length = 0; inserts.length = 0; searchMock.mockReset(); });

  it("ob obnovi ne prepiše izvirnika, temveč doda nespremenljivo novo trenutno različico", async () => {
    selects.push([{ storageKey: "article-images/enota-1/original.webp", altText: "Izvirna jed" }], [{ id: 7, ime: "Jed", cena: "10", davek: "9.5" }]);
    const response = await supertest(app()).post("/artikli/7/slike/42/obnovi").send({});
    expect(response.status).toBe(200);
    expect(inserts).toContainEqual(expect.objectContaining({
      artikelId: 7, storageKey: "article-images/enota-1/original.webp", source: "restore", isCurrent: true, altText: "Izvirna jed",
    }));
    expect(updates.some((entry) => (entry.set as any).isCurrent === false)).toBe(true);
  });

  it("ne dovoli AI urejanja slike artikla iz druge enote", async () => {
    selects.push([]);
    const response = await supertest(app()).post("/artikli/7/uredi-sliko").send({ prompt: "Svetlejše ozadje" });
    expect(response.status).toBe(404);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("shrani alt besedilo samo po preverjanju lastništva artikla", async () => {
    selects.push([{ id: 7 }]);
    const response = await supertest(app()).patch("/artikli/7/slike/alt").send({ altText: "Krožnik testenin" });
    expect(response.status).toBe(200);
    expect(updates.some((entry) => (entry.set as any).altText === "Krožnik testenin")).toBe(true);
  });

  it("zahteva izrecno potrditev pred odstranitvijo trenutne slike", async () => {
    const response = await supertest(app()).delete("/artikli/7/slike/trenutna").send({});
    expect(response.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it("paketna odstranitev ne briše bajtov, ampak le odstrani aktivne reference", async () => {
    const response = await supertest(app()).post("/artikli/slike/bulk").send({ artikelIds: [7, 8], action: "remove", confirm: true });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ updated: 2, action: "remove" });
    expect(updates.some((entry) => (entry.set as any).isCurrent === false)).toBe(true);
  });
});