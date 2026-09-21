/**
 * Middleware integracijski testi — preverja, da je requireEnota v verigi
 * pred bizboxNastavitveRouter. Brez veljavnega Clerk JWT vrne 401 before
 * bizBox-specifičen role guard sploh pride do besede.
 *
 * BN-MW-1  GET brez Clerk JWT → 401 (requireEnota vratar)
 * BN-MW-2  PUT brez Clerk JWT → 401 (pred role guard)
 * BN-MW-3  DELETE brez Clerk JWT → 401
 *
 * Clerk `getAuth` je mockiran: ne vrne userId → requireEnota samodejno
 * vrne 401 brez kakršnegakoli DB klica.
 */

import { describe, it, expect, vi } from "vitest";
import express from "express";
import supertest from "supertest";

// Hoisted mock: morate biti pred prvim import-om ki ga uporablja requireEnota.
// getAuth mock vrača { userId: null } — simulira neprijavljenega klicatelja.
vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(() => ({ userId: null })),
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

// Importi po mocku
import { requireEnota } from "../../middlewares/pos";
import bizboxNastavitveRouter from "./bizbox-nastavitve";

function buildFullChainApp() {
  const app = express();
  app.use(express.json());
  // Prava requireEnota (ne zamenjana), le getAuth je mockiran
  app.use(requireEnota);
  app.use(bizboxNastavitveRouter);
  return app;
}

describe("requireEnota chain — 401 brez JWT", () => {
  it("BN-MW-1: GET brez Clerk JWT → 401 (requireEnota vratar, ne bizBox route)", async () => {
    const res = await supertest(buildFullChainApp()).get("/bizbox-nastavitve");
    expect(res.status).toBe(401);
    // Odgovor je od requireEnota (napaka), ne od bizBox route (error)
    expect(res.body.napaka).toMatch(/prijava/i);
  });

  it("BN-MW-2: PUT brez Clerk JWT → 401 (pred role guard)", async () => {
    const res = await supertest(buildFullChainApp())
      .put("/bizbox-nastavitve")
      .send({ bizboxUser: "x@test.si", bizboxPass: "geslo123", bizboxOkolje: "test" });
    expect(res.status).toBe(401);
    expect(res.body.napaka).toMatch(/prijava/i);
  });

  it("BN-MW-3: DELETE brez Clerk JWT → 401 (pred role guard)", async () => {
    const res = await supertest(buildFullChainApp()).delete("/bizbox-nastavitve");
    expect(res.status).toBe(401);
    expect(res.body.napaka).toMatch(/prijava/i);
  });
});
