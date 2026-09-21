import express from "express";
import supertest from "supertest";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { companiesTable, db, enoteTable, izmeneTable, natakariTable } from "@workspace/db";
import quickSwitchRouter from "./quick-switch";

const created = { companyId: "", enotaId: 0, natakarId: 0, izmenaId: 0 };
const originalActorSecret = process.env.POS_ACTOR_SESSION_SECRET;

afterEach(async () => {
  if (created.enotaId) await db.execute(sql`DELETE FROM pos_actor_audit WHERE enota_id = ${created.enotaId}`);
  if (created.izmenaId) await db.delete(izmeneTable).where(eq(izmeneTable.id, created.izmenaId));
  if (created.natakarId) await db.delete(natakariTable).where(eq(natakariTable.id, created.natakarId));
  if (created.enotaId) await db.delete(enoteTable).where(eq(enoteTable.id, created.enotaId));
  if (created.companyId) await db.delete(companiesTable).where(eq(companiesTable.id, created.companyId));
  created.companyId = "";
  created.enotaId = 0;
  created.natakarId = 0;
  created.izmenaId = 0;
  if (originalActorSecret === undefined) delete process.env.POS_ACTOR_SESSION_SECRET;
  else process.env.POS_ACTOR_SESSION_SECRET = originalActorSecret;
});

async function fixture() {
  const suffix = Math.random().toString(36).slice(2, 10);
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `QA${suffix}`,
    naziv: `Quick switch audit ${suffix}`,
  }).returning({ id: companiesTable.id });
  const [enota] = await db.insert(enoteTable).values({
    companyId: company!.id,
    ime: `Quick switch ${suffix}`,
  }).returning({ id: enoteTable.id });
  const [natakar] = await db.insert(natakariTable).values({
    companyId: company!.id,
    ime: "Audit",
    priimek: "Natakar",
  }).returning({ id: natakariTable.id });
  Object.assign(created, { companyId: company!.id, enotaId: enota!.id, natakarId: natakar!.id });
  return created;
}

function appFor(input: { companyId: string; enotaId: number; clerkUserId: string }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { ...input, vloga: "admin" });
    next();
  });
  app.use(quickSwitchRouter);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error.message });
  });
  return app;
}

describe("QuickSwitch actor audit", () => {
  it("ob odpovedi audita razveljavi spremembo PIN-a", async () => {
    const data = await fixture();
    const response = await supertest(appFor({
      companyId: data.companyId,
      enotaId: 2_147_483_647,
      clerkUserId: "clerk-rollback-test",
    })).put(`/quick-switch/natakarji/${data.natakarId}/pin`).send({ pin: "1234" });

    expect(response.status).toBe(500);
    const [natakar] = await db.select({
      pinHash: natakariTable.posPinHash,
    }).from(natakariTable).where(eq(natakariTable.id, data.natakarId));
    expect(natakar?.pinHash).toBeNull();
  });

  it("zapiše Clerk izvajalca in natakarja v ločena stolpca", async () => {
    const data = await fixture();
    const response = await supertest(appFor({
      companyId: data.companyId,
      enotaId: data.enotaId,
      clerkUserId: "clerk-admin-quick-switch",
    })).put(`/quick-switch/natakarji/${data.natakarId}/pin`).send({ pin: "1234" });

    expect(response.status).toBe(204);
    const audit = await db.execute(sql`
      SELECT natakar_id, actor_clerk_user_id, metadata
      FROM pos_actor_audit
      WHERE enota_id = ${data.enotaId} AND action = 'pin_set'
    `);
    expect(audit.rows).toEqual([{
      natakar_id: data.natakarId,
      actor_clerk_user_id: "clerk-admin-quick-switch",
      metadata: {},
    }]);
  });

  it("PIN prijavo veže na odprto izmeno natakarja v aktivni enoti", async () => {
    process.env.POS_ACTOR_SESSION_SECRET = "quick-switch-shift-test-secret";
    const data = await fixture();
    const app = appFor({
      companyId: data.companyId,
      enotaId: data.enotaId,
      clerkUserId: "clerk-shift-test",
    });
    expect((await supertest(app).put(`/quick-switch/natakarji/${data.natakarId}/pin`).send({ pin: "1234" })).status).toBe(204);

    const withoutShift = await supertest(app).post("/quick-switch/switch")
      .send({ natakarId: data.natakarId, pin: "1234" });
    expect(withoutShift.status).toBe(409);
    expect(withoutShift.body.code).toBe("OPEN_SHIFT_REQUIRED");

    const [shift] = await db.insert(izmeneTable).values({
      enotaId: data.enotaId,
      natakariId: data.natakarId,
    }).returning({ id: izmeneTable.id });
    created.izmenaId = shift!.id;

    const withShift = await supertest(app).post("/quick-switch/switch")
      .send({ natakarId: data.natakarId, pin: "1234" });
    expect(withShift.status).toBe(200);
    expect(withShift.body).toMatchObject({
      natakarId: data.natakarId,
      izmenaId: shift!.id,
    });
    const payload = JSON.parse(Buffer.from(String(withShift.body.token).split(".")[0]!, "base64url").toString("utf8"));
    expect(payload).toMatchObject({ n: data.natakarId, s: shift!.id, u: data.enotaId, c: data.companyId });
  });
});