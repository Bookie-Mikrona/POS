import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

const state = vi.hoisted(() => ({ database: null as any }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: new Proxy(original.db, {
    get(target, key) {
      const source = state.database ?? target;
      const value = Reflect.get(source, key);
      return typeof value === "function" ? value.bind(source) : value;
    },
  }) };
});
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = "test-system-admin";
    next();
  },
}));
vi.mock("../middlewares/requireSuperAdmin", () => ({
  requireSuperAdmin: (req: any, res: any, next: any) =>
    req.headers["x-test-role"] === "user" ? res.status(403).json({ error: "Dostop samo za administratorje sistema" }) : next(),
}));
vi.mock("../lib/pos-sse", () => ({ broadcastToCompany: vi.fn() }));

import {
  db, pool, companiesTable, enoteTable, companyPosPlansTable, auditLogTable,
  posEventsTable, rezervacijeMizTable, mizeTable, posStockTransfersTable,
} from "@workspace/db";
import superadminRouter from "./superadmin";
import enoteRouter from "./pos/enote";
import { findCapabilityBlockers } from "../lib/unitCapabilityBlockers";

const connectClient = () => pool.connect();
let client: Awaited<ReturnType<typeof connectClient>>;
let companyId: string;
let unitId: number;
let eventId: number;

function api() {
  const app = express();
  app.use(express.json());
  app.use(superadminRouter);
  app.use("/enote", (req, _res, next) => {
    Object.assign(req, { companyId, vloga: "admin" });
    next();
  }, enoteRouter);
  return app;
}
const url = () => `/superadmin/podjetja/${companyId}/pos-paket`;

beforeEach(async () => {
  // Vse transakcije poti uporabljajo savepointe na tej povezavi; audit ostane le do rollbacka.
  client = await pool.connect();
  await client.query("BEGIN");
  state.database = drizzle(client);
  const [company] = await db.insert(companiesTable).values({
    naziv: "Test paket varovala", podjetjeDavcna: `PS${Date.now()}${Math.random()}`,
  }).returning();
  companyId = company!.id;
  const [unit] = await db.insert(enoteTable).values({
    companyId, ime: "Dogodkovna enota", capabilities: ["events", "reservations", "tables", "stock_transfers"],
  }).returning();
  unitId = unit!.id;
  await db.insert(companyPosPlansTable).values({ companyId, plan: "extended", enabledBy: "test" });
  const [event] = await db.insert(posEventsTable).values({
    companyId, enotaId: unitId, name: "Aktiven dogodek", type: "festival", status: "active",
    location: "Test", startsAt: new Date(), endsAt: new Date(Date.now() + 3600000),
  }).returning();
  eventId = event!.id;
});
afterEach(async () => {
  try { await client?.query("ROLLBACK"); } finally { state.database = null; client?.release(); }
});

describe("varna sprememba POS paketa", () => {
  it("Extended→Standard blokira aktiven dogodek in ne spremeni paketa ali audita", async () => {
    const response = await request(api()).put(url()).send({ plan: "standard" });
    expect(response.status).toBe(409);
    expect(response.body.blockedUnits).toEqual([{
      id: unitId, ime: "Dogodkovna enota",
      blockers: [{ kind: "open_events", description: expect.any(String) }],
    }]);
    expect((await db.select().from(companyPosPlansTable).where(eq(companyPosPlansTable.companyId, companyId)))[0]!.plan).toBe("extended");
    expect(await db.select().from(auditLogTable).where(eq(auditLogTable.companyId, companyId))).toEqual([]);
  });
  it("force uspe ter atomsko shrani izvajalca, star/nov paket in blokade v audit", async () => {
    const response = await request(api()).put(url()).send({ plan: "standard", force: true });
    expect(response.status).toBe(200);
    expect(response.body.plan).toBe("standard");
    const [audit] = await db.select().from(auditLogTable).where(eq(auditLogTable.companyId, companyId));
    expect(audit).toMatchObject({
      changedBy: "test-system-admin", action: "force_pos_plan_change",
      payload: { oldPlan: "extended", newPlan: "standard", force: true,
        blockedUnits: [{ id: unitId, ime: "Dogodkovna enota", blockers: [{ kind: "open_events", description: expect.any(String) }] }] },
    });
  });
  it("povišanje paketa ne blokira že odprtega dogodka", async () => {
    await db.update(companyPosPlansTable).set({ plan: "standard" }).where(eq(companyPosPlansTable.companyId, companyId));
    const response = await request(api()).put(url()).send({ plan: "extended" });
    expect(response.status).toBe(200);
    expect(response.body.plan).toBe("extended");
  });
  it("izguba zmožnosti, ki ni vklopljena na enoti, ne blokira spremembe", async () => {
    await db.update(enoteTable).set({ capabilities: ["checkout"] }).where(eq(enoteTable.id, unitId));
    expect((await request(api()).put(url()).send({ plan: "standard" })).status).toBe(200);
  });
  it("običajen uporabnik ne more izsiliti spremembe", async () => {
    expect((await request(api()).put(url()).set("x-test-role", "user").send({ plan: "standard", force: true })).status).toBe(403);
  });
  it("force mora biti boolean", async () => {
    expect((await request(api()).put(url()).send({ plan: "standard", force: "true" })).status).toBe(400);
  });
  it("izklop rezervacij s prihodnjo aktivno rezervacijo vrne 409", async () => {
    const [table] = await db.insert(mizeTable).values({ enotaId: unitId, stevilka: 1 }).returning();
    await db.insert(rezervacijeMizTable).values({
      enotaId: unitId, mizaId: table!.id, strankaIme: "Test", telefon: "000",
      zacetek: new Date(Date.now() + 86400000), status: "aktivna",
    });
    const response = await request(api()).put(`/enote/${unitId}`).send({
      capabilities: ["events", "tables", "stock_transfers"],
    });
    expect(response.status).toBe(409);
    expect(response.body.blockers).toContainEqual({ kind: "future_reservations", description: expect.any(String) });
    expect((await db.select().from(enoteTable).where(eq(enoteTable.id, unitId)))[0]!.capabilities).toContain("reservations");
  });
  it("osnutek prenosa blokira izklop za izvorno in ciljno enoto", async () => {
    const [target] = await db.insert(enoteTable).values({ companyId, ime: "Cilj" }).returning();
    await db.insert(posStockTransfersTable).values({
      companyId, eventId, sourceUnitId: unitId, targetUnitId: target!.id,
      direction: "outbound", status: "draft", createdBy: "test",
    });
    for (const id of [unitId, target!.id]) {
      expect(await findCapabilityBlockers(id, ["stock_transfers"])).toContainEqual({
        kind: "stock_transfer_drafts", description: expect.any(String),
      });
    }
  });
  it("prazne odvisnosti in odpadki krožnikov brez statusa osnutka nimajo blokad", async () => {
    expect(await findCapabilityBlockers(unitId, [])).toEqual([]);
    expect(await findCapabilityBlockers(unitId, ["plate_waste"])).toEqual([]);
  });
  it("ne blokira preteklih ali sproščenih rezervacij", async () => {
    const [table] = await db.insert(mizeTable).values({ enotaId: unitId, stevilka: 1 }).returning();
    await db.insert(rezervacijeMizTable).values([
      { enotaId: unitId, mizaId: table!.id, strankaIme: "Test", telefon: "000",
        zacetek: new Date(Date.now() - 86400000), status: "aktivna" },
      { enotaId: unitId, mizaId: table!.id, strankaIme: "Test", telefon: "000",
        zacetek: new Date(Date.now() + 86400000), status: "sprostena" },
    ]);
    expect(await findCapabilityBlockers(unitId, ["reservations"])).toEqual([]);
  });
  it("bon blokira le, če je veljaven in ima neizkoriščen saldo", async () => {
    const profile = (await client.query(
      "INSERT INTO public_venue_profiles(unit_id,company_id,slug) VALUES($1,$2,$3) RETURNING id",
      [unitId, companyId, `test-plan-${companyId}`],
    )).rows[0];
    const checkout = (await client.query(
      `INSERT INTO public_voucher_checkouts(profile_id,company_id,unit_id,idempotency_key,expected_amount_cents,
        buyer_name,buyer_email,recipient_name,recipient_email,items,privacy_accepted_at)
       VALUES($1,$2,$3,'plan-test',1000,'Test','test@example.invalid','Test','test@example.invalid','[]',now()) RETURNING id`,
      [profile.id, companyId, unitId],
    )).rows[0];
    const voucher = (await client.query(
      `INSERT INTO individual_vouchers(checkout_id,company_id,unit_id,code_hash,code_suffix,initial_amount_cents,
        recipient_name,recipient_email,expires_at)
       VALUES($1,$2,$3,$4,'TEST',1000,'Test','test@example.invalid',now()+interval '1 day') RETURNING id`,
      [checkout.id, companyId, unitId, `test-${companyId}`],
    )).rows[0];
    await client.query(
      `INSERT INTO individual_voucher_movements(voucher_id,company_id,operation_key,type,amount_cents)
       VALUES($1,$2,'test-issue','issue',1000)`, [voucher.id, companyId],
    );
    expect(await findCapabilityBlockers(unitId, ["deposits_tokens"])).toContainEqual({
      kind: "unredeemed_vouchers", description: expect.any(String),
    });
    await client.query("UPDATE individual_vouchers SET expires_at=now()-interval '1 day' WHERE id=$1", [voucher.id]);
    expect(await findCapabilityBlockers(unitId, ["deposits_tokens"])).toEqual([]);
    await client.query("UPDATE individual_vouchers SET expires_at=now()+interval '1 day' WHERE id=$1", [voucher.id]);
    await client.query(
      `INSERT INTO individual_voucher_movements(voucher_id,company_id,operation_key,type,amount_cents)
       VALUES($1,$2,'test-redeem','redeem',1000)`, [voucher.id, companyId],
    );
    expect(await findCapabilityBlockers(unitId, ["deposits_tokens"])).toEqual([]);
  });
});
