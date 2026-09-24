import { afterAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return { ...actual, getAuth: () => ({ userId: "pos-auth-route-probe" }) };
});

const previousSuperAdmins = process.env.SUPER_ADMIN_IDS;
process.env.SUPER_ADMIN_IDS = "pos-auth-route-probe";

afterAll(() => {
  if (previousSuperAdmins === undefined) delete process.env.SUPER_ADMIN_IDS;
  else process.env.SUPER_ADMIN_IDS = previousSuperAdmins;
});

describe("root API router POS auth ordering", () => {
  it("resolves the POS role before requiring a unit, while still protecting voucher routes", async () => {
    const { default: router } = await import("./index");
    const app = express();
    app.use("/api", router);

    const auth = await request(app).get("/api/pos/auth/me");
    expect(auth.status, auth.text).toBe(200);
    expect(auth.body.vloga).toBe("superadmin");

    const profile = await request(app).get("/api/javni-profil");
    expect(profile.status).toBe(400);
    expect(profile.body.napaka).toBe("Manjka X-Enota-Id glava");

    const deliveries = await request(app).get("/api/darilni-boni/individualni/dostave");
    expect(deliveries.status).toBe(400);
    expect(deliveries.body.napaka).toBe("Manjka X-Enota-Id glava");
  });
});