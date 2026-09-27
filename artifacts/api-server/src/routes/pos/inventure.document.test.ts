import express from "express";
import supertest from "supertest";
import { Readable } from "stream";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as unknown[][],
  file: null as any,
  selectCount: 0,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  const select = () => {
    const chain: Record<string, any> = {};
    for (const method of ["from", "where", "limit"]) chain[method] = () => chain;
    chain.then = (resolve: (value: unknown[]) => void, reject: (error: unknown) => void) => {
      try {
        state.selectCount += 1;
        resolve(state.rows.shift() ?? []);
      } catch (error) {
        reject(error);
      }
    };
    return chain;
  };
  return { ...original, db: { ...original.db, select } };
});

vi.mock("../../middlewares/pos", () => ({
  requireEnota(req: express.Request, res: express.Response, next: express.NextFunction) {
    const companyId = req.header("x-test-company");
    const enotaId = Number(req.header("x-test-enota"));
    if (!companyId || !Number.isInteger(enotaId) || enotaId <= 0) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    Object.assign(req, { companyId, enotaId, clerkUserId: "clerk-user", log: { error: vi.fn() } });
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    getObjectEntityFile = async () => state.file;
  },
}));

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: vi.fn() } },
}));

describe("GET /inventure/:id/document", () => {
  let app: express.Express;

  beforeAll(async () => {
    const router = (await import("./inventure")).default;
    app = express();
    app.use(router);
  });

  beforeEach(() => {
    state.rows = [];
    const createReadStream = vi.fn(() => Readable.from([Buffer.from("%PDF-original")]));
    state.file = {
      createReadStream,
    };
    state.selectCount = 0;
  });

  it("streams the original as a private attachment for its owning POS company", async () => {
    state.rows = [
      [{ id: 7, documentPath: "/objects/uploads/00000000-0000-4000-8000-000000000007" }],
      [{
        companyId: "company-a",
        fileName: "inventūra-list.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 13,
      }],
    ];

    const response = await supertest(app)
      .get("/inventure/7/document")
      .set("x-test-company", "company-a")
      .set("x-test-enota", "4");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toContain("attachment;");
    expect(response.headers["content-disposition"]).toContain("filename*=UTF-8''");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["content-length"]).toBe("13");
    expect(state.file.createReadStream).toHaveBeenCalledOnce();
  });

  const unauthorizedCases: Array<[string, unknown[][]]> = [
    ["missing inventory / another unit", [[]]],
    ["inventory without an attachment", [[{ id: 7, documentPath: null }]]],
    ["document owned by another company", [
      [{ id: 7, documentPath: "/objects/uploads/00000000-0000-4000-8000-000000000007" }],
      [{ companyId: "company-b", fileName: "other.pdf", mimeType: "application/pdf", fileSizeBytes: 1 }],
    ]],
  ];

  it.each(unauthorizedCases)("returns 404 for %s", async (_name, queryRows) => {
    state.rows = queryRows;
    const response = await supertest(app)
      .get("/inventure/7/document")
      .set("x-test-company", "company-a")
      .set("x-test-enota", "4");
    expect(response.status).toBe(404);
    expect(state.file.createReadStream).not.toHaveBeenCalled();
  });
});