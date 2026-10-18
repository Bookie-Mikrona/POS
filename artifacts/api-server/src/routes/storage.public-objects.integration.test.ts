import express from "express";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const gcs = vi.hoisted(() => {
  const exists = vi.fn();
  const getMetadata = vi.fn();
  const createReadStream = vi.fn();
  const file = vi.fn((_name: string) => ({ exists, getMetadata, createReadStream }));
  const bucket = vi.fn((_name: string) => ({ file }));
  return { exists, getMetadata, createReadStream, file, bucket };
});

vi.mock("@google-cloud/storage", () => ({
  File: class {},
  Storage: class {
    bucket(name: string) {
      return gcs.bucket(name);
    }
  },
}));
vi.mock("@workspace/db", () => ({
  db: {},
  documentsTable: {},
  accountingRolesTable: {},
}));
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: vi.fn(() => {
    throw new Error("Public objects must not require authentication");
  }),
}));
vi.mock("@workspace/api-zod", () => ({
  RequestUploadUrlBody: {},
  RequestUploadUrlResponse: {},
}));

import { ObjectStorageService } from "../lib/objectStorage";
import storageRouter from "./storage";

const endpoint = "/api/storage/public-objects/";
const body = "public image bytes";
let server: ReturnType<express.Express["listen"]>;
let receivedUrls: string[];
let search: MockInstance<ObjectStorageService["searchPublicObject"]>;

// Pass the raw request target to node:http. URL/fetch/supertest helpers may
// normalize dot segments before Express ever receives the security test input.
async function getRaw(rawUrl: string) {
  const address = server.address() as AddressInfo;
  return new Promise<{ status: number; body: string; contentType?: string }>((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1",
      port: address.port,
      path: rawUrl,
      method: "GET",
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode!,
        body: Buffer.concat(chunks).toString(),
        contentType: res.headers["content-type"],
      }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

beforeEach(async () => {
  vi.stubEnv("PUBLIC_OBJECT_SEARCH_PATHS", "/controlled-bucket/public");
  vi.clearAllMocks();
  gcs.exists.mockResolvedValue([true]);
  gcs.getMetadata.mockResolvedValue([{
    contentType: "image/png",
    size: Buffer.byteLength(body),
    metadata: { "custom:aclPolicy": JSON.stringify({ visibility: "public" }) },
  }]);
  gcs.createReadStream.mockImplementation(() => Readable.from([Buffer.from(body)]));
  // Call through to the real service: only the GCS boundary is replaced.
  search = vi.spyOn(ObjectStorageService.prototype, "searchPublicObject");
  receivedUrls = [];
  const app = express();
  app.use((req, _res, next) => {
    receivedUrls.push(req.originalUrl);
    req.log = { error: vi.fn() } as unknown as typeof req.log;
    next();
  });
  app.use("/api", storageRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("public object HTTP boundary: raw URL versus Express-decoded filePath", () => {
  it.each([
    // Explicit pairs prevent a client-side decoder from hiding a router change.
    ["%2e/secret.png", "./secret.png"],
    ["%2E%2e/secret.png", "../secret.png"],
    ["images/%2e%2e/secret.png", "images/../secret.png"],
    ["%252e/secret.png", "%2e/secret.png"],
    ["images/%252E%252e/secret.png", "images/%2E%2e/secret.png"],
    ["%2fsecret.png", "/secret.png"],
    ["images%2f%2fsecret.png", "images//secret.png"],
    ["images%2f..%2fsecret.png", "images/../secret.png"],
    ["%252fsecret.png", "%2fsecret.png"],
    ["images%252F..%252fsecret.png", "images%2F..%2fsecret.png"],
    ["%5csecret.png", "\\secret.png"],
    ["images%5C..%5csecret.png", "images\\..\\secret.png"],
    ["%255csecret.png", "%5csecret.png"],
    ["images%255C..%255csecret.png", "images%5C..%5csecret.png"],
    ["images/%252e%2e%252fsecret.png", "images/%2e.%2fsecret.png"],
    ["images/%2e%2e%5csecret.png", "images/..\\secret.png"],
    ["images//secret.png", "images//secret.png"],
    ["images%00secret.png", "images\u0000secret.png"],
  ])("rejects raw path %s without any GCS access", async (rawPath, decodedFilePath) => {
    const rawUrl = endpoint + rawPath;
    const response = await getRaw(rawUrl);
    expect(receivedUrls).toEqual([rawUrl]);
    expect(search).toHaveBeenCalledExactlyOnceWith(decodedFilePath);
    expect(response.status).toBe(404);
    expect(gcs.bucket).not.toHaveBeenCalled();
    expect(gcs.file).not.toHaveBeenCalled();
    expect(gcs.exists).not.toHaveBeenCalled();
    expect(gcs.getMetadata).not.toHaveBeenCalled();
    expect(gcs.createReadStream).not.toHaveBeenCalled();
  });

  it.each(["images/%", "images/%2", "images/%GG", "images/%C3%28"])(
    "rejects malformed raw escape %s before calling the service",
    async (rawPath) => {
      const rawUrl = endpoint + rawPath;
      const response = await getRaw(rawUrl);
      expect(receivedUrls).toEqual([rawUrl]);
      expect(response.status).toBe(400);
      expect(search).not.toHaveBeenCalled();
      expect(gcs.bucket).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["images/%C5%BEiva%20slika.png", "images/živa slika.png"],
    ["images/poletni%20meni.png", "images/poletni meni.png"],
    ["images/%E6%97%A5%E6%9C%AC.png", "images/日本.png"],
    ["images/slika%2Epng", "images/slika.png"],
    ["images%2Fmeni.png", "images/meni.png"],
  ])("serves raw path %s from its exact canonical object", async (rawPath, decodedFilePath) => {
    const rawUrl = endpoint + rawPath;
    const response = await getRaw(rawUrl);
    expect(receivedUrls).toEqual([rawUrl]);
    expect(search).toHaveBeenCalledExactlyOnceWith(decodedFilePath);
    expect(response).toEqual({ status: 200, body, contentType: "image/png" });
    expect(gcs.bucket).toHaveBeenCalledExactlyOnceWith("controlled-bucket");
    expect(gcs.file).toHaveBeenCalledExactlyOnceWith(`public/${decodedFilePath}`);
    expect(gcs.exists).toHaveBeenCalledTimes(1);
    expect(gcs.createReadStream).toHaveBeenCalledTimes(1);
  });
});
