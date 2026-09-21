import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { db } from "@workspace/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { posActorContext, requireVerifiedPosActor } from "./pos";
import { actorRequiredPosRoutes } from "../routes/pos";

const originalSecret = process.env.POS_ACTOR_SESSION_SECRET;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalSecret === undefined) delete process.env.POS_ACTOR_SESSION_SECRET;
  else process.env.POS_ACTOR_SESSION_SECRET = originalSecret;
});

function actorToken(payload: { n: number; s: number; e: number; c: string; u: number }, secret: string) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function securityApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { companyId: "company-1", enotaId: 7 });
    next();
  });
  app.use(posActorContext);
  app.post("/ordinary", (_req, res) => res.status(204).end());
  app.post("/sensitive", requireVerifiedPosActor, (_req, res) => res.status(204).end());
  return app;
}

describe("obvezna verificirana POS actor seja", () => {
  it("zavrne manjkajoč, pokvarjen in potekel token pred občutljivim handlerjem", async () => {
    process.env.POS_ACTOR_SESSION_SECRET = "actor-test-secret";
    const app = securityApp();
    const expired = actorToken({ n: 9, s: 12, e: Date.now() - 1, c: "company-1", u: 7 }, "actor-test-secret");

    expect((await request(app).post("/sensitive")).status).toBe(401);
    expect((await request(app).post("/sensitive").set("X-Pos-Actor-Session", "broken")).status).toBe(401);
    expect((await request(app).post("/sensitive").set("X-Pos-Actor-Session", expired)).status).toBe(401);
  });

  it("pokvarjen ali potekel actor token ne blokira običajnega POS dejanja", async () => {
    process.env.POS_ACTOR_SESSION_SECRET = "actor-test-secret";
    const app = securityApp();
    const expired = actorToken({ n: 9, s: 12, e: Date.now() - 1, c: "company-1", u: 7 }, "actor-test-secret");

    expect((await request(app).post("/ordinary").set("X-Pos-Actor-Session", "broken")).status).toBe(204);
    expect((await request(app).post("/ordinary").set("X-Pos-Actor-Session", expired)).status).toBe(204);
  });

  it("spusti samo veljaven podpis za pravo podjetje in enoto", async () => {
    process.env.POS_ACTOR_SESSION_SECRET = "actor-test-secret";
    vi.spyOn(db, "execute").mockResolvedValue({ rows: [{}] } as never);
    const valid = actorToken({ n: 9, s: 12, e: Date.now() + 60_000, c: "company-1", u: 7 }, "actor-test-secret");

    expect((await request(securityApp()).post("/sensitive").set("X-Pos-Actor-Session", valid)).status).toBe(204);
  });

  it("takoj zavrne actor sejo, ko se nanjo vezana izmena zapre", async () => {
    process.env.POS_ACTOR_SESSION_SECRET = "actor-test-secret";
    vi.spyOn(db, "execute").mockResolvedValue({ rows: [] } as never);
    const valid = actorToken({ n: 9, s: 12, e: Date.now() + 60_000, c: "company-1", u: 7 }, "actor-test-secret");

    const response = await request(securityApp()).post("/sensitive").set("X-Pos-Actor-Session", valid);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe("POS_ACTOR_SHIFT_CLOSED");
  });

  it("guard varuje račun, storno, plačilo in recovery, vodstveni Z-zaključek pa uporablja Clerk identiteto", () => {
    expect(actorRequiredPosRoutes).toContainEqual(["post", "/racuni"]);
    expect(actorRequiredPosRoutes).toContainEqual(["post", "/racuni/:id/storniraj"]);
    expect(actorRequiredPosRoutes).toContainEqual(["post", "/terminal/card-payment-attempts/:paymentAttemptId/recovery/select"]);
    expect(actorRequiredPosRoutes).toContainEqual(["post", "/terminal/payten/android/bridge"]);
    expect(actorRequiredPosRoutes).toContainEqual(["post", "/terminal/payten/android/timeout"]);
    expect(actorRequiredPosRoutes).toContainEqual(["post", "/terminal/sumup/pay"]);
    expect(actorRequiredPosRoutes).toContainEqual(["delete", "/terminal/viva/terminal/refund"]);
    expect(actorRequiredPosRoutes).not.toContainEqual(["post", "/x-porocilo/uskladitev-gotovine"]);
    expect(actorRequiredPosRoutes).not.toContainEqual(["post", "/z-porocilo/zakljuci"]);
    expect(actorRequiredPosRoutes).not.toContainEqual(["post", "/z-porocilo/:id/odkleni"]);
  });
});