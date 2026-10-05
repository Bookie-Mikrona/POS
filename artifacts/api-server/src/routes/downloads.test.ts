import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import downloadsRouter from "./downloads";

const app = express();
app.use("/api", downloadsRouter);

describe("download filename normalization", () => {
  it.each(["ScannerBridge.exe", "scannerbridge.exe", "SCANNERBRIDGE.EXE"])(
    "serves the canonical Windows executable for %s", async filename => {
      const response = await request(app).head(`/api/downloads/${filename}`);
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("application/octet-stream");
      expect(response.headers["content-disposition"]).toBe('attachment; filename="ScannerBridge.exe"');
      expect(Number(response.headers["content-length"])).toBeGreaterThan(0);
      expect(response.headers["cache-control"]).toBe("no-store");
    },
  );
  it("keeps non-whitelisted files inaccessible", async () => {
    expect((await request(app).get("/api/downloads/package.json")).status).toBe(404);
    expect((await request(app).get("/api/downloads/..%2FScannerBridge.exe")).status).toBe(404);
  });
});
