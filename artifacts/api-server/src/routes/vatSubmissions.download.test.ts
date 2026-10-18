import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import JSZip from "jszip";

const state = vi.hoisted(() => ({
  companyId: "a7a1ab21-9a6a-46dd-9959-000000000001",
  submissionId: "a7a1ab21-9a6a-46dd-9959-000000000002",
  role: "viewer" as string | null,
  submission: null as Record<string, unknown> | null,
  warn: vi.fn(),
}));
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth(req: any, _res: any, next: any) {
    req.clerkUserId = "vat-storage-test";
    next();
  },
}));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...original,
    db: {
      select(fields?: unknown) {
        const chain = {
          from: () => chain,
          where: () => chain,
          limit: async () => fields
            ? state.role ? [{ role: state.role }] : []
            : state.submission ? [state.submission] : [],
        };
        return chain;
      },
    },
  };
});

import router from "./vatSubmissions";
import { ObjectStorageService, objectStorageClient } from "../lib/objectStorage";

const app = express();
app.use((req, _res, next) => {
  req.log = { warn: state.warn } as unknown as typeof req.log;
  next();
});
app.use(router);
const xml = '<?xml version="1.0" encoding="UTF-8"?><DDV_KIR_KPR xmlns="http://edavki.durs.si/Documents/Schemas/DDV_KIR_KPR_1.xsd"><OPOMBA>Šumniki čšž</OPOMBA></DDV_KIR_KPR>';
const storageXml = "<DDV>Storage copy</DDV>";
const storagePath = `/objects/vat-xml/${state.companyId}/2026-0703/${state.submissionId}.xml`;
const filename = "KIR_KPR_2026_0703_BOTH.xml";
const url = `/companies/${state.companyId}/vat-submissions/${state.submissionId}/download`;
const exists = vi.fn();
const download = vi.fn();
const file = vi.fn();
const bucket = vi.fn();

beforeEach(() => {
  state.role = "viewer";
  state.submission = {
    id: state.submissionId, companyId: state.companyId,
    periodYear: 2026, period: "0703", kind: "BOTH",
    xmlStoragePath: storagePath, xmlInline: xml,
  };
  state.warn.mockReset();
  exists.mockReset().mockResolvedValue([true]);
  download.mockReset().mockResolvedValue([Buffer.from(storageXml)]);
  file.mockReset().mockReturnValue({ exists, download });
  bucket.mockReset().mockReturnValue({ file });
  vi.spyOn(ObjectStorageService.prototype, "getPrivateObjectDir")
    .mockReturnValue("/test-bucket/private");
  vi.spyOn(objectStorageClient, "bucket").mockImplementation(bucket);
});
afterEach(() => vi.restoreAllMocks());

function expectWarning(reason: string, err?: unknown, fallbackAvailable = true) {
  expect(state.warn).toHaveBeenCalledTimes(1);
  expect(state.warn).toHaveBeenCalledWith(expect.objectContaining({
    event: "vat_submission_storage_read_failed",
    companyId: state.companyId, submissionId: state.submissionId,
    xmlStoragePath: storagePath, reason, fallbackAvailable,
    ...(err ? { err } : {}),
  }), expect.any(String));
  expect(JSON.stringify(state.warn.mock.calls)).not.toContain(xml);
}

describe("archived VAT XML storage download contract", () => {
  it("resolves the private object path and prefers storage without warning", async () => {
    const response = await request(app).get(url).query({ format: "xml" });
    expect(response.status).toBe(200);
    expect(response.text).toBe(storageXml);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(bucket).toHaveBeenCalledWith("test-bucket");
    expect(file).toHaveBeenCalledWith(`private/${storagePath.slice("/objects/".length)}`);
    expect(state.warn).not.toHaveBeenCalled();
  });

  it("warns for a missing object while returning the exact inline XML", async () => {
    exists.mockResolvedValue([false]);
    const response = await request(app).get(url).query({ format: "xml" });
    expect(response.status).toBe(200);
    expect(response.text).toBe(xml);
    expect(response.headers["content-type"]).toContain("application/xml");
    expect(response.headers["content-disposition"]).toBe(`attachment; filename="${filename}"`);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(download).not.toHaveBeenCalled();
    expectWarning("missing_object");
  });

  it.each(["exists", "download"])("warns for an operational %s error without interrupting XML", async stage => {
    const err = Object.assign(new Error("GCS unavailable"), { code: 503 });
    (stage === "exists" ? exists : download).mockRejectedValue(err);
    const response = await request(app).get(url).query({ format: "xml" });
    expect(response.status).toBe(200);
    expect(response.text).toBe(xml);
    expectWarning("storage_error", err);
  });

  it.each([404, "404"])("classifies a download-time %s as missing, not operational", async code => {
    const err = Object.assign(new Error("Object disappeared"), { code });
    download.mockRejectedValue(err);
    const response = await request(app).get(url).query({ format: "xml" });
    expect(response.status).toBe(200);
    expect(response.text).toBe(xml);
    expectWarning("missing_object", err);
  });

  it("preserves the default ZIP download on storage failure", async () => {
    download.mockRejectedValue(new Error("GCS unavailable"));
    const response = await request(app).get(url).buffer(true).parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(Buffer.from(chunk)));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/zip");
    expect(response.headers["cache-control"]).toBe("no-store");
    const zip = await JSZip.loadAsync(response.body);
    expect(await zip.file(filename)?.async("string")).toBe(xml);
    expectWarning("storage_error");
  });

  it("does not warn or read storage for an inline-only archive", async () => {
    state.submission!.xmlStoragePath = null;
    const response = await request(app).get(url).query({ format: "xml" });
    expect(response.status).toBe(200);
    expect(response.text).toBe(xml);
    expect(bucket).not.toHaveBeenCalled();
    expect(state.warn).not.toHaveBeenCalled();
  });

  it("keeps the missing XML response when no backup exists, but still warns", async () => {
    state.submission!.xmlInline = null;
    exists.mockResolvedValue([false]);
    const response = await request(app).get(url);
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("XML datoteka ni najdena");
    expectWarning("missing_object", undefined, false);
  });

  it("does not read storage or warn when company access is denied", async () => {
    state.role = null;
    expect((await request(app).get(url)).status).toBe(403);
    expect(bucket).not.toHaveBeenCalled();
    expect(state.warn).not.toHaveBeenCalled();
  });
});
