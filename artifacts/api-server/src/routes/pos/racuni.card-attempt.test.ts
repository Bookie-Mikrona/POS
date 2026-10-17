import { afterAll, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { and, eq, sql } from "drizzle-orm";
import {
  blagajneTable,
  companiesTable,
  db,
  enoteTable,
  natakariTable,
  napraveTable,
  narocilaTable,
  pool,
  posKarticnaPlacilaAttemptTable,
  postavkeTable,
  racunIzdajaZahteveTable,
  racuniTable,
  tipPoliciesTable,
  vivaVracilaTable,
  vivaVraciloStatusPrehodiTable,
} from "@workspace/db";

const vivaRouteMocks = vi.hoisted(() => ({
  ustvariNarocilo: vi.fn(),
  preveriStatus: vi.fn(),
  preveriVivaTransakcijo: vi.fn(),
  posljiNaTerminal: vi.fn(),
  preveriVivaTerminalSessionStatus: vi.fn(),
  smartCheckoutUrl: vi.fn((orderCode: string) => `https://checkout.example/${orderCode}`),
}));

vi.mock("../../lib/pos-viva", () => ({
  ustvariNarocilo: vivaRouteMocks.ustvariNarocilo,
  preveriStatus: vivaRouteMocks.preveriStatus,
  preveriVivaTransakcijo: vivaRouteMocks.preveriVivaTransakcijo,
  smartCheckoutUrl: vivaRouteMocks.smartCheckoutUrl,
  posljiNaTerminal: vivaRouteMocks.posljiNaTerminal,
  preveriVivaTerminalSessionStatus: vivaRouteMocks.preveriVivaTerminalSessionStatus,
  pripraviVivaPovezavo: vi.fn(),
  stornirajVivaTerminal: vi.fn(),
}));
import {
  cardPaymentAttemptIdentifierPredicate,
  expectedCardPaymentProvider,
  receiptProviderReferenceFields,
  releasedFursClaimFields,
  mayViewVivaRefundAudit,
} from "./racuni";
import racuniRouter from "./racuni";
import terminalRouter from "./terminal";
import * as posFursLib from "../../lib/pos-furs";

afterAll(async () => {
  await pool.end();
});

describe("receipt card payment attempt lookup", () => {
  it("accepts the terminal client idempotency key as well as the internal attempt id", () => {
    const clientKey = "client_terminal_attempt_123456";
    const dialect = new PgDialect();
    const query = dialect.sqlToQuery(cardPaymentAttemptIdentifierPredicate(clientKey));
    const normalized = query.sql.replace(/\s+/g, " ").toLowerCase();

    expect(normalized).toContain('"pos_karticna_placila_attempt"."id"::text');
    expect(normalized).toContain('"pos_karticna_placila_attempt"."idempotency_key"');
    expect(normalized).toContain(" or ");
    expect(query.params).toEqual([clientKey, clientKey]);
  });

  it.each([
    [{ sumupCheckoutId: "sumup-ref", vivaTerminalSessionId: "", vivaOrderCode: "" }, "sumup"],
    [{ sumupCheckoutId: "", vivaTerminalSessionId: "viva-session", vivaOrderCode: "" }, "viva_terminal"],
    [{ sumupCheckoutId: "", vivaTerminalSessionId: "", vivaOrderCode: "viva-order" }, "viva_smart"],
    [{ sumupCheckoutId: "", vivaTerminalSessionId: "", vivaOrderCode: "" }, "payten"],
  ] as const)("keeps receipt provider mapping for terminal responses", (references, provider) => {
    expect(expectedCardPaymentProvider(references)).toBe(provider);
  });

  it.each([
    ["sumup", "checkout-1", { sumupCheckoutId: "checkout-1" }],
    ["viva_terminal", "session-1", { vivaTerminalSessionId: "session-1" }],
    ["viva_smart", "order-1", { vivaOrderCode: "order-1" }],
    ["payten", "payten-1", {}],
    ["simulacija", "simulation-1", {}],
  ] as const)("restores %s receipt metadata from the durable attempt", (provider, reference, expected) => {
    expect(receiptProviderReferenceFields(provider, reference)).toEqual(expected);
  });

  it("clears every claim field when retry validation releases a FURS row", () => {
    expect(releasedFursClaimFields()).toEqual({
      fursClaimedAt: null,
      fursClaimedBy: null,
      fursClaimBatchId: null,
      fursClaimLeaseUntil: null,
    });
  });
});

describe("Viva refund audit access", () => {
  it.each([
    ["admin", true],
    ["admin_enote", true],
    ["superadmin", true],
    ["uporabnik", false],
    [undefined, false],
  ] as const)("vloga %s ima pravilno dovoljenje", (vloga, expected) => {
    expect(mayViewVivaRefundAudit(vloga)).toBe(expected);
  });

  it("superadmin prejme identiteto in časovnico, navadna vloga pa redaktiran odgovor", async () => {
    const runId = Math.random().toString(36).slice(2, 10).toUpperCase();
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `VAUD${runId}`,
      naziv: `Viva audit ${runId}`,
    }).returning({ id: companiesTable.id });
    const [enota] = await db.insert(enoteTable).values({
      companyId: company!.id,
      ime: `Viva audit enota ${runId}`,
      capabilities: ["receipts"],
    }).returning({ id: enoteTable.id });
    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId: enota!.id,
      skupaj: "10.00",
    }).returning({ id: narocilaTable.id });
    const [racun] = await db.insert(racuniTable).values({
      enotaId: enota!.id,
      narociloId: narocilo!.id,
      stevilkaRacuna: `VAUD-${runId}`,
      skupaj: "10.00",
      ddv: "1.80",
      placilnaNacin: "kartica",
      status: "testni",
      vivaTerminalSessionId: `sale-${runId}`,
    }).returning({ id: racuniTable.id });
    const [refund] = await db.insert(vivaVracilaTable).values({
      racunId: racun!.id,
      enotaId: enota!.id,
      refundSessionId: `refund-${runId}`,
      znesek: "10.00",
      status: "pending",
      actorClerkUserId: `clerk-${runId}`,
      actorNatakarId: 77,
      napravaKljuc: `device-${runId}`,
    }).returning({ id: vivaVracilaTable.id });
    await db.insert(vivaVraciloStatusPrehodiTable).values({
      vivaVraciloId: refund!.id,
      enotaId: enota!.id,
      prejsnjiStatus: null,
      noviStatus: "pending",
      actorClerkUserId: `clerk-${runId}`,
      actorNatakarId: 77,
      napravaKljuc: `device-${runId}`,
      providerReferenca: `refund-${runId}`,
    });

    const buildAuditApp = (vloga: string) => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        Object.assign(req, {
          companyId: company!.id,
          enotaId: enota!.id,
          clerkUserId: `viewer-${runId}`,
          vloga,
          log: { info: () => undefined, warn: () => undefined, error: () => undefined },
        });
        next();
      });
      app.use(racuniRouter);
      return app;
    };

    const superadmin = await supertest(buildAuditApp("superadmin")).get(`/racuni/${racun!.id}/vracila`);
    expect(superadmin.status, superadmin.body).toBe(200);
    expect(superadmin.body[0]).toMatchObject({
      actorClerkUserId: `clerk-${runId}`,
      actorNatakarId: 77,
      napravaKljuc: `device-${runId}`,
      providerReferenca: `refund-${runId}`,
    });
    expect(superadmin.body[0].statusPrehodi).toHaveLength(1);
    expect(superadmin.body[0].statusPrehodi[0]).toMatchObject({
      noviStatus: "pending",
      actorNatakarId: 77,
      providerReferenca: `refund-${runId}`,
    });

    const uporabnik = await supertest(buildAuditApp("uporabnik")).get(`/racuni/${racun!.id}/vracila`);
    expect(uporabnik.status, uporabnik.body).toBe(200);
    expect(uporabnik.body[0]).toMatchObject({
      actorClerkUserId: null,
      actorNatakarId: null,
      napravaKljuc: null,
      statusPrehodi: [],
    });
  });

  it("superadmin vidi UNKNOWN in samo ena sočasna ročna razrešitev ustvari audit", async () => {
    const runId = Math.random().toString(36).slice(2, 10).toUpperCase();
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `VRSL${runId}`,
      naziv: `Viva resolve ${runId}`,
    }).returning({ id: companiesTable.id });
    const [enota] = await db.insert(enoteTable).values({
      companyId: company!.id,
      ime: `Viva resolve enota ${runId}`,
      capabilities: ["checkout", "receipts"],
    }).returning({ id: enoteTable.id });
    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId: enota!.id,
      skupaj: "18.40",
    }).returning({ id: narocilaTable.id });
    const [racun] = await db.insert(racuniTable).values({
      enotaId: enota!.id,
      narociloId: narocilo!.id,
      stevilkaRacuna: `VRSL-${runId}`,
      skupaj: "18.40",
      ddv: "3.32",
      placilnaNacin: "kartica",
      status: "testni",
    }).returning({ id: racuniTable.id });
    const refundSessionId = `refund-resolve-${runId}`;
    const [refund] = await db.insert(vivaVracilaTable).values({
      racunId: racun!.id,
      enotaId: enota!.id,
      refundSessionId,
      znesek: "18.40",
      status: "unknown",
      napaka: "Provider ni dosegljiv",
      actorClerkUserId: `creator-${runId}`,
      napravaKljuc: `device-${runId}`,
    }).returning({ id: vivaVracilaTable.id });
    await db.insert(vivaVraciloStatusPrehodiTable).values({
      vivaVraciloId: refund!.id,
      enotaId: enota!.id,
      prejsnjiStatus: "pending",
      noviStatus: "unknown",
      napaka: "Provider ni dosegljiv",
      actorClerkUserId: `creator-${runId}`,
      napravaKljuc: `device-${runId}`,
      providerReferenca: refundSessionId,
      vir: "provider_error",
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, {
        companyId: company!.id,
        enotaId: enota!.id,
        clerkUserId: `resolver-${runId}`,
        vloga: "superadmin",
        napravaKljuc: `admin-device-${runId}`,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      });
      next();
    });
    app.use(terminalRouter);

    const unknown = await supertest(app).get("/terminal/viva/terminal/refunds/unknown");
    expect(unknown.status, unknown.body).toBe(200);
    expect(unknown.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ refundSessionId, racunId: racun!.id, znesek: 18.4 }),
    ]));

    const [paid, failed] = await Promise.all([
      supertest(app).post(`/terminal/viva/terminal/refund/${refundSessionId}/resolve`).send({
        status: "paid",
        razlog: "Transakcija je potrjena na terminalskem dnevniku.",
        dokazReferenca: `terminal-log-${runId}`,
      }),
      supertest(app).post(`/terminal/viva/terminal/refund/${refundSessionId}/resolve`).send({
        status: "failed",
        razlog: "Transakcije ni na terminalskem dnevniku.",
        dokazReferenca: `terminal-log-${runId}`,
      }),
    ]);
    expect([paid.status, failed.status].sort()).toEqual([200, 409]);

    const [stored] = await db.select({ status: vivaVracilaTable.status })
      .from(vivaVracilaTable).where(eq(vivaVracilaTable.id, refund!.id));
    expect(["paid", "failed"]).toContain(stored!.status);
    const transitions = await db.select().from(vivaVraciloStatusPrehodiTable)
      .where(eq(vivaVraciloStatusPrehodiTable.vivaVraciloId, refund!.id));
    const manual = transitions.filter(transition => transition.vir === "manual");
    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({
      prejsnjiStatus: "unknown",
      actorClerkUserId: `resolver-${runId}`,
      napravaKljuc: `admin-device-${runId}`,
      dokazReferenca: `terminal-log-${runId}`,
    });

    const after = await supertest(app).get("/terminal/viva/terminal/refunds/unknown");
    expect(after.body.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ refundSessionId }),
    ]));
  });
});

describe("sočasna izdaja računa iz istega potrjenega plačila", () => {
  it("izda individualni bon kot POS račun, vrača isti račun ob replay, blokira premalo stanja pred FURS in ob retry potrdi zadržani hold", async () => {
    const runId = Math.random().toString(36).slice(2, 10).toUpperCase();
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `T509${runId}`,
      naziv: `Individual voucher POS ${runId}`,
    }).returning({ id: companiesTable.id });
    const [enota] = await db.insert(enoteTable).values({
      companyId: company!.id,
      ime: `Individual voucher POS ${runId}`,
      capabilities: ["checkout", "receipts", "simulation"],
    }).returning({ id: enoteTable.id });
    const client = await (db as any).$client.connect();
    let profileId = "";
    try {
      profileId = (await client.query(`INSERT INTO public_venue_profiles(unit_id,company_id,slug)
        VALUES($1,$2,$3) RETURNING id`,[enota!.id,company!.id,`pos-voucher-${runId.toLowerCase()}`])).rows[0].id;
    } finally { client.release(); }

    const createVoucherAndOrder = async (suffix: string, amountCents: number) => {
      const code = `POS-${runId}-${suffix}`;
      const connection = await (db as any).$client.connect();
      let voucherId = "";
      try {
        const checkout = (await connection.query(`INSERT INTO public_voucher_checkouts
          (profile_id,company_id,unit_id,idempotency_key,expected_amount_cents,buyer_name,buyer_email,recipient_name,recipient_email,items,privacy_accepted_at,status,payment_status)
          VALUES($1,$2,$3,$4,$5,'Kupec','k@example.test','Gost','g@example.test','[]',now(),'complete','paid') RETURNING id`,
        [profileId,company!.id,enota!.id,`checkout-${runId}-${suffix}`,amountCents])).rows[0];
        voucherId = (await connection.query(`INSERT INTO individual_vouchers
          (checkout_id,company_id,unit_id,code_hash,code_suffix,initial_amount_cents,recipient_name,recipient_email)
          VALUES($1,$2,$3,$4,$5,$6,'Gost','g@example.test') RETURNING id`,
        [checkout.id,company!.id,enota!.id,createHash("sha256").update(code).digest("hex"),code.slice(-6),amountCents])).rows[0].id;
        await connection.query(`INSERT INTO individual_voucher_movements
          (voucher_id,company_id,operation_key,type,amount_cents) VALUES($1,$2,'issue','issue',$3)`,
        [voucherId,company!.id,amountCents]);
      } finally { connection.release(); }
      const [order] = await db.insert(narocilaTable).values({
        enotaId:enota!.id,skupaj:(amountCents/100).toFixed(2),
      }).returning({id:narocilaTable.id});
      await db.insert(postavkeTable).values({
        narociloId:order!.id,ime:`Voucher sale ${suffix}`,kolicina:1,
        cenaKos:(amountCents/100).toFixed(2),skupaj:(amountCents/100).toFixed(2),davek:"22.00",
      });
      return {code,voucherId,orderId:order!.id};
    };

    const app = express();
    app.use(express.json());
    app.use((req,_res,next)=>{
      Object.assign(req,{
        companyId:company!.id,enotaId:enota!.id,clerkUserId:`voucher-pos-${runId}`,
        log:{info:()=>undefined,warn:()=>undefined,error:()=>undefined},
      });
      next();
    });
    app.use(racuniRouter);
    app.use((err:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
      res.status(500).json({error:err.message});
    });

    const full = await createVoucherAndOrder("full",1000);
    const body = {
      idempotencyKey:`voucher-receipt-${runId}-full`,narociloId:full.orderId,
      placilnaNacin:"bon",znesekBon:10,individualVoucherCode:full.code,
    };
    const issued = await supertest(app).post("/racuni").send(body);
    expect(issued.status,issued.body).toBe(201);
    const replay = await supertest(app).post("/racuni").send(body);
    expect(replay.status,replay.body).toBe(200);
    expect(replay.body).toMatchObject({id:issued.body.id,idempotentReplay:true});
    const committed = await (db as any).$client.query(`SELECT
      (SELECT count(*)::int FROM individual_voucher_movements WHERE voucher_id=$1 AND type='redeem' AND amount_cents=1000) redemptions,
      (SELECT count(*)::int FROM pos_individual_voucher_redemption_holds WHERE voucher_id=$1 AND receipt_id=$2 AND status='committed') holds,
      (SELECT count(*)::int FROM darilni_bon_gibi WHERE racun_id=$2) legacy_movements`,
    [full.voucherId,issued.body.id]);
    expect(committed.rows[0]).toEqual({redemptions:1,holds:1,legacy_movements:0});

    const attemptsBefore = await (db as any).$client.query(`SELECT count(*)::int count FROM furs_attempts fa
      JOIN racuni r ON r.id=fa.racun_id WHERE r.enota_id=$1`,[enota!.id]);
    const insufficientOrder = await db.insert(narocilaTable).values({enotaId:enota!.id,skupaj:"1.00"}).returning({id:narocilaTable.id});
    await db.insert(postavkeTable).values({
      narociloId:insufficientOrder[0]!.id,ime:"Premalo bona",kolicina:1,cenaKos:"1.00",skupaj:"1.00",davek:"22.00",
    });
    const insufficient = await supertest(app).post("/racuni").send({
      idempotencyKey:`voucher-receipt-${runId}-insufficient`,narociloId:insufficientOrder[0]!.id,
      placilnaNacin:"bon",znesekBon:1,individualVoucherCode:full.code,
    });
    expect(insufficient.status).toBe(409);
    const attemptsAfter = await (db as any).$client.query(`SELECT count(*)::int count FROM furs_attempts fa
      JOIN racuni r ON r.id=fa.racun_id WHERE r.enota_id=$1`,[enota!.id]);
    expect(attemptsAfter.rows[0].count).toBe(attemptsBefore.rows[0].count);
    const insufficientEffects = await (db as any).$client.query(`SELECT
      (SELECT count(*)::int FROM racuni WHERE narocilo_id=$1) receipts,
      (SELECT count(*)::int FROM pos_individual_voucher_redemption_holds WHERE voucher_id=$2) holds`,
    [insufficientOrder[0]!.id,full.voucherId]);
    expect(insufficientEffects.rows[0]).toEqual({receipts:0,holds:1});

    const retry = await createVoucherAndOrder("retry",500);
    const fursFailure = vi.spyOn(posFursLib,"posljiNaFURS").mockResolvedValue({
      uspeh:false,zoi:"simulated-zoi",eor:"",napaka:"simulated terminal FURS rejection",surovOdgovor:"test",
    } as Awaited<ReturnType<typeof posFursLib.posljiNaFURS>>);
    const failed = await supertest(app).post("/racuni").send({
      idempotencyKey:`voucher-receipt-${runId}-retry`,narociloId:retry.orderId,
      placilnaNacin:"bon",znesekBon:5,individualVoucherCode:retry.code,
    });
    fursFailure.mockRestore();
    expect(failed.status,JSON.stringify(failed.body)).toBe(422);
    expect(failed.body.fursState).toBe("failed");
    const holdBeforeRetry = await (db as any).$client.query(
      "SELECT status FROM pos_individual_voucher_redemption_holds WHERE voucher_id=$1 AND receipt_id=$2",
      [retry.voucherId,failed.body.id],
    );
    expect(holdBeforeRetry.rows[0]?.status).toBe("held");
    const retried = await supertest(app).post(`/racuni/${failed.body.id}/ponovi-furs`).send({});
    expect(retried.status,retried.body).toBe(200);
    expect(retried.body).toMatchObject({id:failed.body.id,uspeh:true,outcome:"confirmed"});
    const holdAfterRetry = await (db as any).$client.query(
      "SELECT status FROM pos_individual_voucher_redemption_holds WHERE voucher_id=$1 AND receipt_id=$2",
      [retry.voucherId,failed.body.id],
    );
    expect(holdAfterRetry.rows[0]?.status).toBe("committed");
    const retryMovement = await (db as any).$client.query(`SELECT count(*)::int count FROM individual_voucher_movements
      WHERE voucher_id=$1 AND type='redeem' AND amount_cents=500`,[retry.voucherId]);
    expect(retryMovement.rows[0].count).toBe(1);
  });

  it("ohrani Viva ECR referenco in znesek skozi start, PAID, izdajo z napitnino ter replay", async () => {
    const runId = Math.random().toString(36).slice(2, 10).toUpperCase();
    const paymentAttemptId = `viva-payment-${runId}-0001`;
    const transactionId = `viva-transaction-${runId}`;
    const deviceKey = `viva-device-${runId}`;
    const merchantReference = paymentAttemptId;

    vivaRouteMocks.posljiNaTerminal.mockReset().mockResolvedValue(undefined);
    vivaRouteMocks.preveriVivaTerminalSessionStatus.mockReset().mockResolvedValue({
      status: "PAID",
      transactionId,
      orderCode: null,
    });
    vivaRouteMocks.preveriVivaTransakcijo.mockReset().mockResolvedValue({
      status: "PAID",
      transactionId,
      amountCents: 2040,
    });

    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `T507${runId}`,
      naziv: `Viva full route ${runId}`,
    }).returning({ id: companiesTable.id });
    const [enota] = await db.insert(enoteTable).values({
      companyId: company!.id,
      ime: `Viva full route ${runId}`,
      capabilities: ["checkout", "receipts", "simulation"],
    }).returning({ id: enoteTable.id });
    await db.insert(napraveTable).values({
      enotaId: enota!.id,
      ime: "Viva testna naprava",
      napravaKljuc: deviceKey,
      nastavitveJson: JSON.stringify({
        vivaAktiven: true,
        vivaClientId: "test-client-id",
        vivaClientSecret: "test-client-secret",
        vivaSourceCode: "test-source-code",
        vivaDemoNacin: true,
        vivaTerminalAktiven: true,
        vivaTerminalId: "terminal-123",
      }),
    });
    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId: enota!.id,
      skupaj: "18.40",
      znesekNapitnina: "2.00",
    }).returning({ id: narocilaTable.id });
    await db.insert(postavkeTable).values({
      narociloId: narocilo!.id,
      ime: "Viva artikel z napitnino",
      kolicina: 1,
      cenaKos: "18.40",
      skupaj: "18.40",
      davek: "22.00",
    });
    await db.insert(tipPoliciesTable).values({
      companyId: company!.id,
      enotaId: enota!.id,
      effectiveFrom: "2000-01-01",
      mode: "direct_employee",
      evidenceType: "internal_rule",
      evidenceReference: `Viva full route ${runId}`,
      agreementConfirmed: true,
      cardFeeTreatment: "employer_expense",
      cardFeeKind: "none",
      createdBy: "test",
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, {
        companyId: company!.id,
        enotaId: enota!.id,
        clerkUserId: `viva-user-${runId}`,
        napravaKljuc: deviceKey,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      });
      next();
    });
    app.use(terminalRouter);
    app.use(racuniRouter);
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: err.message });
    });

    const startBody = {
      narociloId: narocilo!.id,
      znesek: 20.4,
      znesekNapitninaKartica: 2,
      paymentAttemptId,
    };
    const start = await supertest(app)
      .post("/terminal/viva/terminal/pay")
      .set("X-Naprava-Id", deviceKey)
      .send(startBody);
    expect(start.status, start.body).toBe(200);
    expect(start.body).toMatchObject({ paymentAttemptId, status: "pending" });
    const sessionId = start.body.sessionId as string;
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(vivaRouteMocks.posljiNaTerminal).toHaveBeenCalledWith(
      20.4,
      sessionId,
      "terminal-123",
      merchantReference,
      "test-client-id",
      "test-client-secret",
      true,
    );

    const startReplay = await supertest(app)
      .post("/terminal/viva/terminal/pay")
      .set("X-Naprava-Id", deviceKey)
      .send(startBody);
    expect(startReplay.status, startReplay.body).toBe(200);
    expect(startReplay.body).toMatchObject({ sessionId, paymentAttemptId, status: "pending" });
    expect(vivaRouteMocks.posljiNaTerminal).toHaveBeenCalledTimes(1);

    const status = await supertest(app)
      .get(`/terminal/viva/terminal/status/${sessionId}`)
      .set("X-Naprava-Id", deviceKey);
    expect(status.status, status.body).toBe(200);
    expect(status.body).toMatchObject({ status: "PAID", transactionId });
    expect(vivaRouteMocks.preveriVivaTransakcijo).toHaveBeenCalledWith(
      transactionId,
      2040,
      merchantReference,
      "test-client-id",
      "test-client-secret",
      true,
    );

    const [paymentAttempt] = await db.select()
      .from(posKarticnaPlacilaAttemptTable)
      .where(eq(posKarticnaPlacilaAttemptTable.idempotencyKey, paymentAttemptId));
    expect(paymentAttempt).toMatchObject({
      provider: "viva_terminal",
      providerReferenca: sessionId,
      znesek: "20.40",
      status: "completed",
    });

    const receiptBody = {
      narociloId: narocilo!.id,
      placilnaNacin: "kartica",
      znesekKartica: 20.4,
      znesekNapitnina: 2,
      tipPaymentMethod: "card",
      paymentAttemptId: paymentAttempt!.id,
    };
    const mismatch = await supertest(app).post("/racuni").send({
      ...receiptBody,
      idempotencyKey: `receipt-${runId}-wrong-viva-reference`,
      vivaTerminalSessionId: `${sessionId}-changed`,
    });
    expect(mismatch.status, mismatch.body).toBe(409);
    const fursAfterMismatch = await db.execute(sql`
      SELECT fa.id
      FROM furs_attempts fa
      JOIN racuni r ON r.id = fa.racun_id
      WHERE r.enota_id = ${enota!.id}
    `);
    const requestsAfterMismatch = await db.select({ id: racunIzdajaZahteveTable.id })
      .from(racunIzdajaZahteveTable)
      .where(eq(racunIzdajaZahteveTable.cardPaymentAttemptId, paymentAttempt!.id));
    expect(fursAfterMismatch.rows).toHaveLength(0);
    expect(requestsAfterMismatch).toHaveLength(0);

    const idempotencyKey = `receipt-${runId}-correct-viva-reference`;
    const issued = await supertest(app).post("/racuni").send({
      ...receiptBody,
      idempotencyKey,
      vivaTerminalSessionId: sessionId,
    });
    expect(issued.status, issued.body).toBe(201);

    const replay = await supertest(app).post("/racuni").send({
      ...receiptBody,
      idempotencyKey,
      vivaTerminalSessionId: sessionId,
    });
    expect(replay.status, replay.body).toBe(200);
    expect(replay.body).toMatchObject({ id: issued.body.id, idempotentReplay: true });
  });

  it("ustvari največ en račun ter ohrani idempotentno ponovitev", async () => {
    const runId = Math.random().toString(36).slice(2, 10).toUpperCase();
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `T508${runId}`,
      naziv: `Concurrent receipt recovery ${runId}`,
    }).returning({ id: companiesTable.id });
    const [enota] = await db.insert(enoteTable).values({
      companyId: company!.id,
      ime: `Concurrent recovery ${runId}`,
      capabilities: ["checkout", "receipts", "simulation"],
    }).returning({ id: enoteTable.id });
    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId: enota!.id,
      skupaj: "12.50",
    }).returning({ id: narocilaTable.id });
    await db.insert(postavkeTable).values({
      narociloId: narocilo!.id,
      ime: "Integracijski artikel",
      kolicina: 1,
      cenaKos: "12.50",
      skupaj: "12.50",
      davek: "22.00",
    });
    const [paymentAttempt] = await db.insert(posKarticnaPlacilaAttemptTable).values({
      companyId: company!.id,
      enotaId: enota!.id,
      narociloId: narocilo!.id,
      purpose: "receipt",
      idempotencyKey: `payment-${runId}-0001`,
      provider: "simulacija",
      providerReferenca: `simulation-${runId}`,
      znesek: "12.50",
      status: "completed",
      actor: "concurrent-recovery-test",
      deviceKey: `device-${runId}`,
    }).returning({ id: posKarticnaPlacilaAttemptTable.id });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, {
        companyId: company!.id,
        enotaId: enota!.id,
        clerkUserId: "concurrent-recovery-test",
        napravaKljuc: `device-${runId}`,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      });
      next();
    });
    app.use(racuniRouter);
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: err.message });
    });

    const idempotencyKey = `receipt-${runId}-parallel`;
    const body = {
      idempotencyKey,
      narociloId: narocilo!.id,
      placilnaNacin: "kartica",
      znesekKartica: 12.5,
      paymentAttemptId: paymentAttempt!.id,
    };
    const responses = await Promise.all([
      supertest(app).post("/racuni").send(body),
      supertest(app).post("/racuni").send(body),
    ]);

    const created = responses.filter(response => response.status === 201);
    expect(
      created,
      JSON.stringify(responses.map(response => ({ status: response.status, body: response.body }))),
    ).toHaveLength(1);
    const concurrentFollower = responses.find(response => response.status !== 201)!;
    expect([200, 409]).toContain(concurrentFollower.status);
    if (concurrentFollower.status === 200) {
      expect(concurrentFollower.body).toMatchObject({
        id: created[0]!.body.id,
        idempotentReplay: true,
      });
    }

    const receipts = await db.select({
      id: racuniTable.id,
      cardPaymentAttemptId: racuniTable.cardPaymentAttemptId,
    }).from(racuniTable).where(eq(racuniTable.cardPaymentAttemptId, paymentAttempt!.id));
    const issueRequests = await db.select({
      racunId: racunIzdajaZahteveTable.racunId,
      cardPaymentAttemptId: racunIzdajaZahteveTable.cardPaymentAttemptId,
      idempotencyKey: racunIzdajaZahteveTable.idempotencyKey,
    }).from(racunIzdajaZahteveTable).where(
      eq(racunIzdajaZahteveTable.cardPaymentAttemptId, paymentAttempt!.id),
    );

    expect(receipts).toEqual([{
      id: created[0]!.body.id,
      cardPaymentAttemptId: paymentAttempt!.id,
    }]);
    expect(issueRequests).toEqual([{
      racunId: created[0]!.body.id,
      cardPaymentAttemptId: paymentAttempt!.id,
      idempotencyKey,
    }]);

    const replay = await supertest(app).post("/racuni").send(body);
    expect(replay.status, replay.body).toBe(200);
    expect(replay.body).toMatchObject({
      id: created[0]!.body.id,
      idempotentReplay: true,
    });

    const differentKey = await supertest(app).post("/racuni").send({
      ...body,
      idempotencyKey: `receipt-${runId}-different`,
    });
    expect([400, 409]).toContain(differentKey.status);

    const afterRetryReceipts = await db.select({ id: racuniTable.id })
      .from(racuniTable)
      .where(eq(racuniTable.cardPaymentAttemptId, paymentAttempt!.id));
    const afterRetryRequests = await db.select({ id: racunIzdajaZahteveTable.id })
      .from(racunIzdajaZahteveTable)
      .where(and(
        eq(racunIzdajaZahteveTable.companyId, company!.id),
        eq(racunIzdajaZahteveTable.cardPaymentAttemptId, paymentAttempt!.id),
      ));
    expect(afterRetryReceipts).toHaveLength(1);
    expect(afterRetryRequests).toHaveLength(1);
  });

  it.each([
    ["SumUp", "sumup", "sumup-checkout", 11.4, 0],
    ["Viva Terminal", "viva_terminal", "viva-session", 13.4, 2],
    ["Viva Smart/Android", "viva_smart", "viva-order", 13.4, 2],
    ["Payten", "payten", "payten-reference", 13.4, 2],
    ["SumUp s kartično napitnino", "sumup", "sumup-tip-checkout", 13.4, 2],
  ] as const)("med dvema napravama za %s porabi samo en uporabniško- in napravno-vezan izbor", async (_label, provider, referencePrefix, cardCharge, cardTip) => {
    const runId = Math.random().toString(36).slice(2, 10).toUpperCase();
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `T520${runId}`,
      naziv: `Cross-device receipt recovery ${runId}`,
    }).returning({ id: companiesTable.id });
    const [enota] = await db.insert(enoteTable).values({
      companyId: company!.id,
      ime: `Cross-device recovery ${runId}`,
      capabilities: ["checkout", "receipts", "simulation"],
    }).returning({ id: enoteTable.id });
    const deviceA = `device-a-${runId}`;
    const deviceB = `device-b-${runId}`;
    await db.insert(napraveTable).values([
      { enotaId: enota!.id, ime: "POS naprava A", napravaKljuc: deviceA },
      { enotaId: enota!.id, ime: "POS naprava B", napravaKljuc: deviceB },
    ]);
    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId: enota!.id,
      skupaj: "18.40",
      znesekNapitnina: cardTip.toFixed(2),
    }).returning({ id: narocilaTable.id });
    await db.insert(postavkeTable).values({
      narociloId: narocilo!.id,
      ime: "Mednapravni integracijski artikel",
      kolicina: 1,
      cenaKos: "18.40",
      skupaj: "18.40",
      davek: "22.00",
    });
    if (cardTip > 0) {
      await db.insert(tipPoliciesTable).values({
        companyId: company!.id,
        enotaId: enota!.id,
        effectiveFrom: "2000-01-01",
        mode: "direct_employee",
        evidenceType: "internal_rule",
        evidenceReference: `Card tip race test ${runId}`,
        agreementConfirmed: true,
        cardFeeTreatment: "employer_expense",
        cardFeeKind: "none",
        createdBy: "test",
      });
    }
    const [paymentAttempt] = await db.insert(posKarticnaPlacilaAttemptTable).values({
      companyId: company!.id,
      enotaId: enota!.id,
      narociloId: narocilo!.id,
      purpose: "receipt",
      idempotencyKey: `payment-${runId}-cross-device`,
      provider,
      providerReferenca: `${referencePrefix}-${runId}`,
      znesek: cardCharge.toFixed(2),
      status: "completed",
      rezultatJson: JSON.stringify({
        amountEvidence: {
          version: 1,
          requestedCardTotalCents: Math.round(cardCharge * 100),
          expectedCardTipCents: Math.round(cardTip * 100),
          providerTotalCents: Math.round(cardCharge * 100),
          providerTipCents: null,
          providerAmountsVerified: true,
        },
      }),
      actor: "cross-device-recovery-test",
      deviceKey: deviceA,
    }).returning({ id: posKarticnaPlacilaAttemptTable.id });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const headerDevice = req.headers["x-naprava-id"];
      Object.assign(req, {
        companyId: company!.id,
        enotaId: enota!.id,
        clerkUserId: String(req.headers["x-test-user"] ?? ""),
        napravaKljuc: typeof headerDevice === "string" ? headerDevice : null,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      });
      next();
    });
    app.use(terminalRouter);
    app.use(racuniRouter);
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: err.message });
    });

    const actors = [
      { user: `user-a-${runId}`, device: deviceA },
      { user: `user-b-${runId}`, device: deviceB },
    ];
    const selections = await Promise.all(actors.map(actor =>
      supertest(app)
        .post(`/terminal/card-payment-attempts/${paymentAttempt!.id}/recovery/select`)
        .set("X-Test-User", actor.user)
        .set("X-Naprava-Id", actor.device)
        .send({ narociloId: narocilo!.id, znesek: cardCharge }),
    ));
    expect(selections.map(response => response.status)).toEqual([200, 200]);
    expect(selections[0]!.body.selectionToken).not.toBe(selections[1]!.body.selectionToken);

    const bodies = selections.map((selection, index) => ({
      idempotencyKey: `receipt-${runId}-device-${index + 1}`,
      narociloId: narocilo!.id,
      placilnaNacin: "kartica",
      znesekKartica: cardCharge,
      znesekGotovina: 7,
      ...(cardTip > 0 ? { znesekNapitnina: cardTip, tipPaymentMethod: "card" as const } : {}),
      paymentAttemptId: selection.body.paymentAttemptId,
      recoverySelectedAttemptId: selection.body.attemptId,
      recoverySelectionToken: selection.body.selectionToken,
    }));
    const responses = await Promise.all(actors.map((actor, index) =>
      supertest(app)
        .post("/racuni")
        .set("X-Test-User", actor.user)
        .set("X-Naprava-Id", actor.device)
        .send(bodies[index]),
    ));

    const created = responses
      .map((response, index) => ({ response, index }))
      .filter(result => result.response.status === 201);
    expect(
      created,
      JSON.stringify(responses.map(response => ({ status: response.status, body: response.body }))),
    ).toHaveLength(1);
    const rejected = responses.find(response => response.status !== 201)!;
    expect(rejected.status, rejected.body).toBe(409);

    const winner = created[0]!;
    const replay = await supertest(app)
      .post("/racuni")
      .set("X-Test-User", actors[winner.index]!.user)
      .set("X-Naprava-Id", actors[winner.index]!.device)
      .send(bodies[winner.index]);
    expect(replay.status, replay.body).toBe(200);
    expect(replay.body).toMatchObject({
      id: winner.response.body.id,
      idempotentReplay: true,
    });

    const receipts = await db.select({
      id: racuniTable.id,
      cardPaymentAttemptId: racuniTable.cardPaymentAttemptId,
      znesekKartica: racuniTable.znesekKartica,
      znesekGotovina: racuniTable.znesekGotovina,
      znesekNapitnina: racuniTable.znesekNapitnina,
      tipPaymentMethod: racuniTable.tipPaymentMethod,
      sumupCheckoutId: racuniTable.sumupCheckoutId,
      vivaTerminalSessionId: racuniTable.vivaTerminalSessionId,
      vivaOrderCode: racuniTable.vivaOrderCode,
    }).from(racuniTable).where(eq(racuniTable.cardPaymentAttemptId, paymentAttempt!.id));
    const expectedReferences = receiptProviderReferenceFields(
      provider,
      `${referencePrefix}-${runId}`,
    );
    expect(receipts).toEqual([{
      id: winner.response.body.id,
      cardPaymentAttemptId: paymentAttempt!.id,
      znesekKartica: cardCharge.toFixed(2),
      znesekGotovina: "7.00",
      znesekNapitnina: cardTip.toFixed(2),
      tipPaymentMethod: cardTip > 0 ? "card" : null,
      sumupCheckoutId: expectedReferences.sumupCheckoutId ?? null,
      vivaTerminalSessionId: expectedReferences.vivaTerminalSessionId ?? null,
      vivaOrderCode: expectedReferences.vivaOrderCode ?? null,
    }]);

    const audit = await db.execute(sql`
      SELECT action, natakar_id, actor_clerk_user_id, metadata
      FROM pos_actor_audit
      WHERE enota_id = ${enota!.id}
        AND metadata->>'attemptId' = ${paymentAttempt!.id}
      ORDER BY created_at ASC
    `);
    const selectedAudit = audit.rows.filter(row => row.action === "card_payment_recovery_selected");
    const completedAudit = audit.rows.filter(row => row.action === "card_payment_recovery_completed");
    expect(selectedAudit).toHaveLength(2);
    expect(new Set(selectedAudit.map(row => {
      const metadata = row.metadata as { actorUserId?: string; deviceKey?: string };
      expect(metadata.actorUserId).toBeUndefined();
      return `${row.actor_clerk_user_id}:${metadata.deviceKey}`;
    }))).toEqual(new Set([
      `${actors[0]!.user}:${deviceA}`,
      `${actors[1]!.user}:${deviceB}`,
    ]));
    expect(completedAudit).toHaveLength(1);
    expect(completedAudit[0]!.actor_clerk_user_id).toBe(actors[winner.index]!.user);
    expect(completedAudit[0]!.natakar_id).toBeNull();
    expect(completedAudit[0]!.metadata).toMatchObject({
      attemptId: paymentAttempt!.id,
      orderId: narocilo!.id,
      receiptId: winner.response.body.id,
      deviceKey: actors[winner.index]!.device,
    });
  });

  it("ob padcu recovery audita povrne finančne učinke, referenco pa zadrži pred ponovno izdajo", async () => {
    const runId = Math.random().toString(36).slice(2, 10).toUpperCase();
    const user = `audit-failure-user-${runId}`;
    const device = `audit-failure-device-${runId}`;
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `T595${runId}`,
      naziv: `Recovery audit rollback ${runId}`,
    }).returning({ id: companiesTable.id });
    const [enota] = await db.insert(enoteTable).values({
      companyId: company!.id,
      ime: `Recovery audit rollback ${runId}`,
      capabilities: ["checkout", "receipts", "simulation"],
    }).returning({ id: enoteTable.id });
    await db.insert(napraveTable).values({
      enotaId: enota!.id,
      ime: "Recovery audit failure device",
      napravaKljuc: device,
    });
    const [natakar] = await db.insert(natakariTable).values({
      companyId: company!.id,
      ime: "Audit",
      priimek: `Rollback ${runId}`,
    }).returning({ id: natakariTable.id });
    const [tipPolicy] = await db.insert(tipPoliciesTable).values({
      companyId: company!.id,
      enotaId: enota!.id,
      effectiveFrom: "2000-01-01",
      mode: "direct_employee",
      evidenceType: "internal_rule",
      evidenceReference: `Recovery audit rollback ${runId}`,
      agreementConfirmed: true,
      cardFeeTreatment: "employer_expense",
      cardFeeKind: "none",
      createdBy: user,
    }).returning({ id: tipPoliciesTable.id });
    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId: enota!.id,
      skupaj: "18.40",
      znesekNapitnina: "2.00",
    }).returning({ id: narocilaTable.id });
    const [postavka] = await db.insert(postavkeTable).values({
      narociloId: narocilo!.id,
      ime: "Recovery audit rollback artikel",
      kolicina: 1,
      cenaKos: "18.40",
      skupaj: "18.40",
      davek: "22.00",
    }).returning({ id: postavkeTable.id });
    const [paymentAttempt] = await db.insert(posKarticnaPlacilaAttemptTable).values({
      companyId: company!.id,
      enotaId: enota!.id,
      narociloId: narocilo!.id,
      purpose: "receipt",
      idempotencyKey: `payment-${runId}-audit-failure`,
      provider: "sumup",
      providerReferenca: `sumup-${runId}-audit-failure`,
      znesek: "13.40",
      status: "completed",
      rezultatJson: JSON.stringify({
        amountEvidence: {
          version: 1,
          requestedCardTotalCents: 1340,
          expectedCardTipCents: 200,
          providerTotalCents: 1340,
          providerTipCents: null,
          providerAmountsVerified: true,
        },
      }),
      actor: user,
      deviceKey: device,
    }).returning({ id: posKarticnaPlacilaAttemptTable.id });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, {
        companyId: company!.id,
        enotaId: enota!.id,
        clerkUserId: user,
        posActorNatakarId: natakar!.id,
        napravaKljuc: device,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      });
      next();
    });
    app.use(terminalRouter);
    app.use(racuniRouter);
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: err.message });
    });

    const selection = await supertest(app)
      .post(`/terminal/card-payment-attempts/${paymentAttempt!.id}/recovery/select`)
      .set("X-Test-User", user)
      .set("X-Naprava-Id", device)
      .send({ narociloId: narocilo!.id, znesek: 13.4 });
    expect(selection.status, selection.body).toBe(200);

    const functionName = `fail_recovery_audit_${runId.toLowerCase()}`;
    const triggerName = `${functionName}_trigger`;
    expect(functionName).toMatch(/^[a-z0-9_]+$/);
    await db.execute(sql.raw(`
      CREATE FUNCTION ${functionName}() RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'intentional recovery completion audit failure';
      END;
      $$;
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON pos_actor_audit
      FOR EACH ROW
      WHEN (
        NEW.action = 'card_payment_recovery_completed'
        AND NEW.actor_clerk_user_id = '${user}'
      )
      EXECUTE FUNCTION ${functionName}();
    `));

    let response: Awaited<ReturnType<ReturnType<typeof supertest>["post"]>>;
    try {
      response = await supertest(app)
        .post("/racuni")
        .set("X-Test-User", user)
        .set("X-Naprava-Id", device)
        .send({
          idempotencyKey: `receipt-${runId}-audit-failure`,
          narociloId: narocilo!.id,
          placilnaNacin: "kartica",
          znesekKartica: 13.4,
          znesekBon: 7,
          znesekNapitnina: 2,
          tipPaymentMethod: "card",
          paymentAttemptId: selection.body.paymentAttemptId,
          recoverySelectedAttemptId: selection.body.attemptId,
          recoverySelectionToken: selection.body.selectionToken,
        });
    } finally {
      await db.execute(sql.raw(`
        DROP TRIGGER IF EXISTS ${triggerName} ON pos_actor_audit;
        DROP FUNCTION IF EXISTS ${functionName}();
      `));
    }
    expect(response!.status, response!.body).toBe(500);
    expect(response!.body.error).toContain("INSERT INTO pos_actor_audit");
    expect(response!.body.error).toContain("card_payment_recovery_completed");

    const receipts = await db.select({ id: racuniTable.id })
      .from(racuniTable)
      .where(eq(racuniTable.cardPaymentAttemptId, paymentAttempt!.id));
    const issueRequests = await db.select({ id: racunIzdajaZahteveTable.id })
      .from(racunIzdajaZahteveTable)
      .where(eq(racunIzdajaZahteveTable.cardPaymentAttemptId, paymentAttempt!.id));
    const [attemptAfter] = await db.select({
      status: posKarticnaPlacilaAttemptTable.status,
    }).from(posKarticnaPlacilaAttemptTable)
      .where(eq(posKarticnaPlacilaAttemptTable.id, paymentAttempt!.id));
    const [orderAfter] = await db.select({
      status: narocilaTable.status,
      tip: narocilaTable.znesekNapitnina,
    }).from(narocilaTable).where(eq(narocilaTable.id, narocilo!.id));
    const [lineAfter] = await db.select({
      racunId: postavkeTable.racunId,
    }).from(postavkeTable).where(eq(postavkeTable.id, postavka!.id));
    const persistedEffects = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM pos_racun_finalization_plans WHERE company_id = ${company!.id}) AS plans,
        (SELECT COUNT(*)::int FROM furs_payload_snapshots WHERE company_id = ${company!.id}) AS snapshots,
        (SELECT COUNT(*)::int FROM furs_attempts fa
          JOIN racuni r ON r.id = fa.racun_id
          WHERE r.enota_id = ${enota!.id}) AS furs_attempts,
        (SELECT COUNT(*)::int FROM pos_karticna_placila_reference
          WHERE company_id = ${company!.id}) AS terminal_references,
        (SELECT COUNT(*)::int FROM tip_allocations WHERE company_id = ${company!.id}) AS tips,
        (SELECT COUNT(*)::int FROM darilni_bon_gibi WHERE company_id = ${company!.id}) AS vouchers,
        (SELECT COUNT(*)::int FROM zaloga_gibi zg
          JOIN artikli a ON a.id = zg.artikel_id
          WHERE a.enota_id = ${enota!.id}) AS stock_movements,
        (SELECT COUNT(*)::int FROM pos_actor_audit
          WHERE enota_id = ${enota!.id}
            AND action = ${"card_payment_recovery_completed"}
            AND metadata->>'attemptId' = ${paymentAttempt!.id}) AS completed_audits
    `);

    expect(receipts).toHaveLength(0);
    expect(issueRequests).toHaveLength(0);
    expect(attemptAfter).toEqual({ status: "completed" });
    expect(orderAfter).toEqual({ status: "odprto", tip: "2.00" });
    expect(lineAfter).toEqual({ racunId: null });
    expect(persistedEffects.rows[0]).toMatchObject({
      plans: 0,
      snapshots: 0,
      furs_attempts: 0,
      // The confirmed provider payment owns its reference before issuance.
      // A failed receipt must not release it for a second payment attempt.
      terminal_references: 1,
      tips: 0,
      vouchers: 0,
      stock_movements: 0,
      completed_audits: 0,
    });
    expect(tipPolicy!.id).toBeTruthy();

    const retry = await supertest(app)
      .post("/racuni")
      .set("X-Test-User", user)
      .set("X-Naprava-Id", device)
      .send({
        idempotencyKey: `receipt-${runId}-audit-failure-retry`,
        narociloId: narocilo!.id,
        placilnaNacin: "kartica",
        znesekKartica: 13.4,
        znesekBon: 7,
        znesekNapitnina: 2,
        tipPaymentMethod: "card",
        paymentAttemptId: selection.body.paymentAttemptId,
        recoverySelectedAttemptId: selection.body.attemptId,
        recoverySelectionToken: selection.body.selectionToken,
      });
    // Receipt rollback must not bypass the global, pre-FURS reservation.
    // A fresh issuance key cannot safely prove that no external fiscal effect
    // happened; reconciliation must precede any reuse of this paid reference.
    expect(retry.status, JSON.stringify(retry.body)).toBe(409);
    expect(retry.body.error).toBe("Terminalska referenca je že uporabljena pri drugem računu.");
    const issuedAfterRetry = await db.select({ id: racuniTable.id })
      .from(racuniTable)
      .where(eq(racuniTable.cardPaymentAttemptId, paymentAttempt!.id));
    expect(issuedAfterRetry).toEqual([]);
  });

  it("za delni račun iz SumUp plačila med napravama porabi attempt in postavko natanko enkrat", async () => {
    const runId = Math.random().toString(36).slice(2, 10).toUpperCase();
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `T552${runId}`,
      naziv: `Partial SumUp recovery race ${runId}`,
    }).returning({ id: companiesTable.id });
    const [enota] = await db.insert(enoteTable).values({
      companyId: company!.id,
      ime: `Partial recovery ${runId}`,
      capabilities: ["checkout", "receipts", "simulation"],
    }).returning({ id: enoteTable.id });
    const actors = [
      { user: `user-a-${runId}`, device: `device-a-${runId}` },
      { user: `user-b-${runId}`, device: `device-b-${runId}` },
    ];
    await db.insert(napraveTable).values(actors.map((actor, index) => ({
      enotaId: enota!.id,
      ime: `POS naprava ${index + 1}`,
      napravaKljuc: actor.device,
    })));
    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId: enota!.id,
      skupaj: "18.40",
    }).returning({ id: narocilaTable.id });
    const [selectedPostavka, unselectedPostavka] = await db.insert(postavkeTable).values([
      {
        narociloId: narocilo!.id,
        ime: "A – delni račun",
        kolicina: 1,
        cenaKos: "11.40",
        skupaj: "11.40",
        davek: "22.00",
      },
      {
        narociloId: narocilo!.id,
        ime: "B – ostane odprta",
        kolicina: 1,
        cenaKos: "7.00",
        skupaj: "7.00",
        davek: "22.00",
      },
    ]).returning({ id: postavkeTable.id });
    const [paymentAttempt] = await db.insert(posKarticnaPlacilaAttemptTable).values({
      companyId: company!.id,
      enotaId: enota!.id,
      narociloId: narocilo!.id,
      purpose: "receipt",
      idempotencyKey: `payment-${runId}-partial-sumup`,
      provider: "sumup",
      providerReferenca: `sumup-checkout-${runId}`,
      znesek: "7.40",
      status: "completed",
      actor: "partial-recovery-race-test",
      deviceKey: actors[0]!.device,
    }).returning({ id: posKarticnaPlacilaAttemptTable.id });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const headerDevice = req.headers["x-naprava-id"];
      Object.assign(req, {
        companyId: company!.id,
        enotaId: enota!.id,
        clerkUserId: String(req.headers["x-test-user"] ?? ""),
        napravaKljuc: typeof headerDevice === "string" ? headerDevice : null,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      });
      next();
    });
    app.use(terminalRouter);
    app.use(racuniRouter);
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: err.message });
    });

    const selections = await Promise.all(actors.map(actor =>
      supertest(app)
        .post(`/terminal/card-payment-attempts/${paymentAttempt!.id}/recovery/select`)
        .set("X-Test-User", actor.user)
        .set("X-Naprava-Id", actor.device)
        .send({ narociloId: narocilo!.id, znesek: 7.4 }),
    ));
    expect(selections.map(response => response.status)).toEqual([200, 200]);
    expect(selections[0]!.body.selectionToken).not.toBe(selections[1]!.body.selectionToken);

    const bodies = selections.map((selection, index) => ({
      idempotencyKey: `receipt-${runId}-partial-device-${index + 1}`,
      narociloId: narocilo!.id,
      postavkeIds: [selectedPostavka!.id],
      placilnaNacin: "kartica",
      znesekKartica: 7.4,
      znesekGotovina: 4,
      paymentAttemptId: selection.body.paymentAttemptId,
      recoverySelectedAttemptId: selection.body.attemptId,
      recoverySelectionToken: selection.body.selectionToken,
    }));
    const responses = await Promise.all(actors.map((actor, index) =>
      supertest(app)
        .post("/racuni")
        .set("X-Test-User", actor.user)
        .set("X-Naprava-Id", actor.device)
        .send(bodies[index]),
    ));
    expect(
      responses.map(response => response.status),
      JSON.stringify(responses.map(response => ({ status: response.status, body: response.body }))),
    ).toEqual(expect.arrayContaining([201, 409]));
    expect(responses.filter(response => response.status === 201)).toHaveLength(1);
    expect(responses.filter(response => response.status === 409)).toHaveLength(1);

    const winner = responses
      .map((response, index) => ({ response, index }))
      .find(result => result.response.status === 201)!;
    const replay = await supertest(app)
      .post("/racuni")
      .set("X-Test-User", actors[winner.index]!.user)
      .set("X-Naprava-Id", actors[winner.index]!.device)
      .send(bodies[winner.index]);
    expect(replay.status, replay.body).toBe(200);
    expect(replay.body).toMatchObject({
      id: winner.response.body.id,
      idempotentReplay: true,
    });

    const receipts = await db.select({
      id: racuniTable.id,
      cardPaymentAttemptId: racuniTable.cardPaymentAttemptId,
      skupaj: racuniTable.skupaj,
      znesekKartica: racuniTable.znesekKartica,
      znesekGotovina: racuniTable.znesekGotovina,
    }).from(racuniTable).where(eq(racuniTable.cardPaymentAttemptId, paymentAttempt!.id));
    const postavke = await db.select({
      id: postavkeTable.id,
      racunId: postavkeTable.racunId,
    }).from(postavkeTable).where(eq(postavkeTable.narociloId, narocilo!.id));
    const issueRequests = await db.select({
      racunId: racunIzdajaZahteveTable.racunId,
      cardPaymentAttemptId: racunIzdajaZahteveTable.cardPaymentAttemptId,
      idempotencyKey: racunIzdajaZahteveTable.idempotencyKey,
    }).from(racunIzdajaZahteveTable).where(
      eq(racunIzdajaZahteveTable.cardPaymentAttemptId, paymentAttempt!.id),
    );
    expect(receipts).toEqual([{
      id: winner.response.body.id,
      cardPaymentAttemptId: paymentAttempt!.id,
      skupaj: "11.40",
      znesekKartica: "7.40",
      znesekGotovina: "4.00",
    }]);
    expect(postavke.sort((a, b) => a.id - b.id)).toEqual([
      { id: selectedPostavka!.id, racunId: winner.response.body.id },
      { id: unselectedPostavka!.id, racunId: null },
    ]);
    expect(issueRequests).toEqual([{
      racunId: winner.response.body.id,
      cardPaymentAttemptId: paymentAttempt!.id,
      idempotencyKey: bodies[winner.index]!.idempotencyKey,
    }]);

    const audit = await db.execute(sql`
      SELECT action, natakar_id, actor_clerk_user_id, metadata
      FROM pos_actor_audit
      WHERE enota_id = ${enota!.id}
        AND metadata->>'attemptId' = ${paymentAttempt!.id}
      ORDER BY created_at ASC
    `);
    const selectedAudit = audit.rows.filter(row => row.action === "card_payment_recovery_selected");
    const completedAudit = audit.rows.filter(row => row.action === "card_payment_recovery_completed");
    expect(new Set(selectedAudit.map(row => {
      const metadata = row.metadata as { actorUserId?: string; deviceKey?: string };
      expect(metadata.actorUserId).toBeUndefined();
      return `${row.actor_clerk_user_id}:${metadata.deviceKey}`;
    }))).toEqual(new Set(actors.map(actor => `${actor.user}:${actor.device}`)));
    expect(selectedAudit).toHaveLength(2);
    expect(completedAudit).toHaveLength(1);
    expect(completedAudit[0]!.actor_clerk_user_id).toBe(actors[winner.index]!.user);
    expect(completedAudit[0]!.natakar_id).toBeNull();
    expect(completedAudit[0]!.metadata).toMatchObject({
      attemptId: paymentAttempt!.id,
      orderId: narocilo!.id,
      receiptId: winner.response.body.id,
      deviceKey: actors[winner.index]!.device,
    });
  });

  it("isti completed attempt ne more sočasno plačati dveh različnih delnih računov", async () => {
    const runId = Math.random().toString(36).slice(2, 10).toUpperCase();
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `T565${runId}`,
      naziv: `Different partial lines race ${runId}`,
    }).returning({ id: companiesTable.id });
    const [enota] = await db.insert(enoteTable).values({
      companyId: company!.id,
      ime: `Different partial lines ${runId}`,
      capabilities: ["checkout", "receipts", "simulation"],
    }).returning({ id: enoteTable.id });
    const actors = [
      { user: `user-a-${runId}`, device: `device-a-${runId}` },
      { user: `user-b-${runId}`, device: `device-b-${runId}` },
    ];
    await db.insert(napraveTable).values(actors.map((actor, index) => ({
      enotaId: enota!.id,
      ime: `POS naprava ${index + 1}`,
      napravaKljuc: actor.device,
    })));
    const registers = await db.insert(blagajneTable).values([
      { enotaId: enota!.id, ppId: `PPA${runId}`, bId: `BA${runId}`, ime: "Blagajna A" },
      { enotaId: enota!.id, ppId: `PPB${runId}`, bId: `BB${runId}`, ime: "Blagajna B" },
    ]).returning({ id: blagajneTable.id });
    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId: enota!.id,
      skupaj: "22.80",
    }).returning({ id: narocilaTable.id });
    const postavke = await db.insert(postavkeTable).values([
      {
        narociloId: narocilo!.id,
        ime: "A – neodvisni delni račun",
        kolicina: 1,
        cenaKos: "11.40",
        skupaj: "11.40",
        davek: "22.00",
      },
      {
        narociloId: narocilo!.id,
        ime: "B – neodvisni delni račun",
        kolicina: 1,
        cenaKos: "11.40",
        skupaj: "11.40",
        davek: "22.00",
      },
    ]).returning({ id: postavkeTable.id });
    const [paymentAttempt] = await db.insert(posKarticnaPlacilaAttemptTable).values({
      companyId: company!.id,
      enotaId: enota!.id,
      narociloId: narocilo!.id,
      purpose: "receipt",
      idempotencyKey: `payment-${runId}-different-lines`,
      provider: "sumup",
      providerReferenca: `sumup-checkout-${runId}`,
      znesek: "7.40",
      status: "completed",
      actor: "different-partial-lines-race-test",
      deviceKey: actors[0]!.device,
    }).returning({ id: posKarticnaPlacilaAttemptTable.id });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const headerDevice = req.headers["x-naprava-id"];
      Object.assign(req, {
        companyId: company!.id,
        enotaId: enota!.id,
        clerkUserId: String(req.headers["x-test-user"] ?? ""),
        napravaKljuc: typeof headerDevice === "string" ? headerDevice : null,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      });
      next();
    });
    app.use(terminalRouter);
    app.use(racuniRouter);
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: err.message });
    });

    const selections = await Promise.all(actors.map(actor =>
      supertest(app)
        .post(`/terminal/card-payment-attempts/${paymentAttempt!.id}/recovery/select`)
        .set("X-Test-User", actor.user)
        .set("X-Naprava-Id", actor.device)
        .send({ narociloId: narocilo!.id, znesek: 7.4 }),
    ));
    expect(selections.map(response => response.status)).toEqual([200, 200]);

    const bodies = selections.map((selection, index) => ({
      idempotencyKey: `receipt-${runId}-different-line-${index + 1}`,
      narociloId: narocilo!.id,
      postavkeIds: [postavke[index]!.id],
      blagajnaId: registers[index]!.id,
      placilnaNacin: "kartica",
      znesekKartica: 7.4,
      znesekGotovina: 4,
      paymentAttemptId: selection.body.paymentAttemptId,
      recoverySelectedAttemptId: selection.body.attemptId,
      recoverySelectionToken: selection.body.selectionToken,
    }));
    const responses = await Promise.all(actors.map((actor, index) =>
      supertest(app)
        .post("/racuni")
        .set("X-Test-User", actor.user)
        .set("X-Naprava-Id", actor.device)
        .send(bodies[index]),
    ));
    expect(
      responses.map(response => response.status),
      JSON.stringify(responses.map(response => ({ status: response.status, body: response.body }))),
    ).toEqual(expect.arrayContaining([201, 409]));
    expect(responses.filter(response => response.status === 201)).toHaveLength(1);
    expect(responses.filter(response => response.status === 409)).toHaveLength(1);
    expect(responses.find(response => response.status === 409)!.body).toMatchObject({
      code: "CARD_PAYMENT_ATTEMPT_ALREADY_USED",
    });

    const winner = responses
      .map((response, index) => ({ response, index }))
      .find(result => result.response.status === 201)!;
    const loserIndex = winner.index === 0 ? 1 : 0;
    const replay = await supertest(app)
      .post("/racuni")
      .set("X-Test-User", actors[winner.index]!.user)
      .set("X-Naprava-Id", actors[winner.index]!.device)
      .send(bodies[winner.index]);
    expect(replay.status, replay.body).toBe(200);
    expect(replay.body).toMatchObject({
      id: winner.response.body.id,
      idempotentReplay: true,
    });

    const receipts = await db.select({
      id: racuniTable.id,
      cardPaymentAttemptId: racuniTable.cardPaymentAttemptId,
    }).from(racuniTable).where(eq(racuniTable.cardPaymentAttemptId, paymentAttempt!.id));
    const orderReceipts = await db.select({
      id: racuniTable.id,
      cardPaymentAttemptId: racuniTable.cardPaymentAttemptId,
    }).from(racuniTable).where(eq(racuniTable.narociloId, narocilo!.id));
    const linesAfter = await db.select({
      id: postavkeTable.id,
      racunId: postavkeTable.racunId,
    }).from(postavkeTable).where(eq(postavkeTable.narociloId, narocilo!.id));
    const issueRequests = await db.select({
      racunId: racunIzdajaZahteveTable.racunId,
      cardPaymentAttemptId: racunIzdajaZahteveTable.cardPaymentAttemptId,
      idempotencyKey: racunIzdajaZahteveTable.idempotencyKey,
      status: racunIzdajaZahteveTable.status,
    }).from(racunIzdajaZahteveTable).where(
      eq(racunIzdajaZahteveTable.cardPaymentAttemptId, paymentAttempt!.id),
    );

    expect(receipts).toEqual([{
      id: winner.response.body.id,
      cardPaymentAttemptId: paymentAttempt!.id,
    }]);
    expect(orderReceipts).toEqual(receipts);
    expect(linesAfter.find(line => line.id === postavke[winner.index]!.id)).toEqual({
      id: postavke[winner.index]!.id,
      racunId: winner.response.body.id,
    });
    expect(linesAfter.find(line => line.id === postavke[loserIndex]!.id)).toEqual({
      id: postavke[loserIndex]!.id,
      racunId: null,
    });
    expect(issueRequests).toEqual([{
      racunId: winner.response.body.id,
      cardPaymentAttemptId: paymentAttempt!.id,
      idempotencyKey: bodies[winner.index]!.idempotencyKey,
      status: "completed",
    }]);

    const audit = await db.execute(sql`
      SELECT action, metadata
      FROM pos_actor_audit
      WHERE enota_id = ${enota!.id}
        AND metadata->>'attemptId' = ${paymentAttempt!.id}
      ORDER BY created_at ASC
    `);
    const selectedAudit = audit.rows.filter(row => row.action === "card_payment_recovery_selected");
    const completedAudit = audit.rows.filter(row => row.action === "card_payment_recovery_completed");
    expect(selectedAudit).toHaveLength(2);
    expect(completedAudit).toHaveLength(1);
    expect(completedAudit[0]!.metadata).toMatchObject({
      attemptId: paymentAttempt!.id,
      orderId: narocilo!.id,
      receiptId: winner.response.body.id,
      deviceKey: actors[winner.index]!.device,
    });
  });

  it("zavrne izborni žeton, če se uporabnik ali naprava ne ujemata", async () => {
    const runId = Math.random().toString(36).slice(2, 10).toUpperCase();
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `T529${runId}`,
      naziv: `Bound recovery token ${runId}`,
    }).returning({ id: companiesTable.id });
    const [enota] = await db.insert(enoteTable).values({
      companyId: company!.id,
      ime: `Bound recovery token ${runId}`,
      capabilities: ["checkout", "receipts", "simulation"],
    }).returning({ id: enoteTable.id });
    const userA = `user-a-${runId}`;
    const userB = `user-b-${runId}`;
    const deviceA = `device-a-${runId}`;
    const deviceB = `device-b-${runId}`;
    await db.insert(napraveTable).values([
      { enotaId: enota!.id, ime: "POS naprava A", napravaKljuc: deviceA },
      { enotaId: enota!.id, ime: "POS naprava B", napravaKljuc: deviceB },
    ]);
    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId: enota!.id,
      skupaj: "21.30",
    }).returning({ id: narocilaTable.id });
    await db.insert(postavkeTable).values({
      narociloId: narocilo!.id,
      ime: "Artikel za vezavo žetona",
      kolicina: 1,
      cenaKos: "21.30",
      skupaj: "21.30",
      davek: "22.00",
    });
    const [paymentAttempt] = await db.insert(posKarticnaPlacilaAttemptTable).values({
      companyId: company!.id,
      enotaId: enota!.id,
      narociloId: narocilo!.id,
      purpose: "receipt",
      idempotencyKey: `payment-${runId}-bound-token`,
      provider: "simulacija",
      providerReferenca: `simulation-${runId}-bound-token`,
      znesek: "21.30",
      status: "completed",
      actor: "bound-recovery-token-test",
      deviceKey: deviceA,
    }).returning({ id: posKarticnaPlacilaAttemptTable.id });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const headerDevice = req.headers["x-naprava-id"];
      Object.assign(req, {
        companyId: company!.id,
        enotaId: enota!.id,
        clerkUserId: String(req.headers["x-test-user"] ?? ""),
        napravaKljuc: typeof headerDevice === "string" ? headerDevice : null,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      });
      next();
    });
    app.use(terminalRouter);
    app.use(racuniRouter);
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: err.message });
    });

    const selection = await supertest(app)
      .post(`/terminal/card-payment-attempts/${paymentAttempt!.id}/recovery/select`)
      .set("X-Test-User", userA)
      .set("X-Naprava-Id", deviceA)
      .send({ narociloId: narocilo!.id, znesek: 21.3 });
    expect(selection.status, selection.body).toBe(200);

    const mismatches = [
      { label: "napačen uporabnik in naprava", user: userB, device: deviceB },
      { label: "samo napačen uporabnik", user: userB, device: deviceA },
      { label: "samo napačna naprava", user: userA, device: deviceB },
    ];
    for (const [index, mismatch] of mismatches.entries()) {
      const response = await supertest(app)
        .post("/racuni")
        .set("X-Test-User", mismatch.user)
        .set("X-Naprava-Id", mismatch.device)
        .send({
          idempotencyKey: `receipt-${runId}-mismatch-${index + 1}`,
          narociloId: narocilo!.id,
          placilnaNacin: "kartica",
          znesekKartica: 21.3,
          paymentAttemptId: selection.body.paymentAttemptId,
          recoverySelectedAttemptId: selection.body.attemptId,
          recoverySelectionToken: selection.body.selectionToken,
        });
      expect(response.status, `${mismatch.label}: ${JSON.stringify(response.body)}`).toBe(409);
      expect(response.body).toMatchObject({
        error: "Izbira obnovitve je potekla, ne ustreza trenutnemu uporabniku/napravi ali ni veljavna.",
      });
    }

    const receipts = await db.select({ id: racuniTable.id })
      .from(racuniTable)
      .where(eq(racuniTable.cardPaymentAttemptId, paymentAttempt!.id));
    const issueRequests = await db.select({ id: racunIzdajaZahteveTable.id })
      .from(racunIzdajaZahteveTable)
      .where(eq(racunIzdajaZahteveTable.cardPaymentAttemptId, paymentAttempt!.id));
    const completedAudit = await db.execute(sql`
      SELECT 1
      FROM pos_actor_audit
      WHERE enota_id = ${enota!.id}
        AND action = ${"card_payment_recovery_completed"}
        AND metadata->>'attemptId' = ${paymentAttempt!.id}
    `);
    expect(receipts).toHaveLength(0);
    expect(issueRequests).toHaveLength(0);
    expect(completedAudit.rows).toHaveLength(0);
  });

  it("zavrne pretečeni izborni žeton tudi za pravilnega uporabnika in napravo", async () => {
    const runId = Math.random().toString(36).slice(2, 10).toUpperCase();
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `T535${runId}`,
      naziv: `Expired recovery token ${runId}`,
    }).returning({ id: companiesTable.id });
    const [enota] = await db.insert(enoteTable).values({
      companyId: company!.id,
      ime: `Expired recovery token ${runId}`,
      capabilities: ["checkout", "receipts", "simulation"],
    }).returning({ id: enoteTable.id });
    const user = `user-${runId}`;
    const device = `device-${runId}`;
    await db.insert(napraveTable).values({
      enotaId: enota!.id,
      ime: "POS naprava",
      napravaKljuc: device,
    });
    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId: enota!.id,
      skupaj: "23.70",
    }).returning({ id: narocilaTable.id });
    await db.insert(postavkeTable).values({
      narociloId: narocilo!.id,
      ime: "Artikel za pretečeni žeton",
      kolicina: 1,
      cenaKos: "23.70",
      skupaj: "23.70",
      davek: "22.00",
    });
    const [paymentAttempt] = await db.insert(posKarticnaPlacilaAttemptTable).values({
      companyId: company!.id,
      enotaId: enota!.id,
      narociloId: narocilo!.id,
      purpose: "receipt",
      idempotencyKey: `payment-${runId}-expired-token`,
      provider: "simulacija",
      providerReferenca: `simulation-${runId}-expired-token`,
      znesek: "23.70",
      status: "completed",
      actor: "expired-recovery-token-test",
      deviceKey: device,
    }).returning({ id: posKarticnaPlacilaAttemptTable.id });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const headerDevice = req.headers["x-naprava-id"];
      Object.assign(req, {
        companyId: company!.id,
        enotaId: enota!.id,
        clerkUserId: String(req.headers["x-test-user"] ?? ""),
        napravaKljuc: typeof headerDevice === "string" ? headerDevice : null,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      });
      next();
    });
    app.use(terminalRouter);
    app.use(racuniRouter);
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: err.message });
    });

    const selection = await supertest(app)
      .post(`/terminal/card-payment-attempts/${paymentAttempt!.id}/recovery/select`)
      .set("X-Test-User", user)
      .set("X-Naprava-Id", device)
      .send({ narociloId: narocilo!.id, znesek: 23.7 });
    expect(selection.status, selection.body).toBe(200);

    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    await db.execute(sql`
      UPDATE pos_actor_audit
      SET metadata = jsonb_set(
        metadata,
        '{"selectionExpiresAt"}',
        to_jsonb(${expiredAt}::text)
      )
      WHERE enota_id = ${enota!.id}
        AND action = ${"card_payment_recovery_selected"}
        AND metadata->>'attemptId' = ${paymentAttempt!.id}
        AND metadata->>'selectionTokenHash' IS NOT NULL
    `);

    const response = await supertest(app)
      .post("/racuni")
      .set("X-Test-User", user)
      .set("X-Naprava-Id", device)
      .send({
        idempotencyKey: `receipt-${runId}-expired-token`,
        narociloId: narocilo!.id,
        placilnaNacin: "kartica",
        znesekKartica: 23.7,
        paymentAttemptId: selection.body.paymentAttemptId,
        recoverySelectedAttemptId: selection.body.attemptId,
        recoverySelectionToken: selection.body.selectionToken,
      });
    expect(response.status, response.body).toBe(409);
    expect(response.body).toMatchObject({
      error: "Izbira obnovitve je potekla, ne ustreza trenutnemu uporabniku/napravi ali ni veljavna.",
    });

    const receipts = await db.select({ id: racuniTable.id })
      .from(racuniTable)
      .where(eq(racuniTable.cardPaymentAttemptId, paymentAttempt!.id));
    const issueRequests = await db.select({ id: racunIzdajaZahteveTable.id })
      .from(racunIzdajaZahteveTable)
      .where(eq(racunIzdajaZahteveTable.cardPaymentAttemptId, paymentAttempt!.id));
    const completedAudit = await db.execute(sql`
      SELECT 1
      FROM pos_actor_audit
      WHERE enota_id = ${enota!.id}
        AND action = ${"card_payment_recovery_completed"}
        AND metadata->>'attemptId' = ${paymentAttempt!.id}
    `);
    expect(receipts).toHaveLength(0);
    expect(issueRequests).toHaveLength(0);
    expect(completedAudit.rows).toHaveLength(0);
  });

  it("zavrne veljaven izborni žeton za drugo naročilo ali spremenjen kartični znesek", async () => {
    const runId = Math.random().toString(36).slice(2, 10).toUpperCase();
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `T536${runId}`,
      naziv: `Order and amount bound recovery ${runId}`,
    }).returning({ id: companiesTable.id });
    const [enota] = await db.insert(enoteTable).values({
      companyId: company!.id,
      ime: `Order and amount bound recovery ${runId}`,
      capabilities: ["checkout", "receipts", "simulation"],
    }).returning({ id: enoteTable.id });
    const user = `user-${runId}`;
    const device = `device-${runId}`;
    await db.insert(napraveTable).values({
      enotaId: enota!.id,
      ime: "POS naprava",
      napravaKljuc: device,
    });
    const [selectedOrder, otherOrder] = await db.insert(narocilaTable).values([
      { enotaId: enota!.id, skupaj: "24.80" },
      { enotaId: enota!.id, skupaj: "24.80" },
    ]).returning({ id: narocilaTable.id });
    await db.insert(postavkeTable).values([
      {
        narociloId: selectedOrder!.id,
        ime: "Artikel izbranega naročila",
        kolicina: 1,
        cenaKos: "24.80",
        skupaj: "24.80",
        davek: "22.00",
      },
      {
        narociloId: otherOrder!.id,
        ime: "Artikel drugega naročila",
        kolicina: 1,
        cenaKos: "24.80",
        skupaj: "24.80",
        davek: "22.00",
      },
    ]);
    const [paymentAttempt] = await db.insert(posKarticnaPlacilaAttemptTable).values({
      companyId: company!.id,
      enotaId: enota!.id,
      narociloId: selectedOrder!.id,
      purpose: "receipt",
      idempotencyKey: `payment-${runId}-order-amount-bound`,
      provider: "simulacija",
      providerReferenca: `simulation-${runId}-order-amount-bound`,
      znesek: "24.80",
      status: "completed",
      actor: "order-amount-bound-recovery-test",
      deviceKey: device,
    }).returning({ id: posKarticnaPlacilaAttemptTable.id });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const headerDevice = req.headers["x-naprava-id"];
      Object.assign(req, {
        companyId: company!.id,
        enotaId: enota!.id,
        clerkUserId: String(req.headers["x-test-user"] ?? ""),
        napravaKljuc: typeof headerDevice === "string" ? headerDevice : null,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      });
      next();
    });
    app.use(terminalRouter);
    app.use(racuniRouter);
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: err.message });
    });

    const orderMismatchSelection = await supertest(app)
      .post(`/terminal/card-payment-attempts/${paymentAttempt!.id}/recovery/select`)
      .set("X-Test-User", user)
      .set("X-Naprava-Id", device)
      .send({ narociloId: selectedOrder!.id, znesek: 24.8 });
    expect(orderMismatchSelection.status, orderMismatchSelection.body).toBe(200);
    const orderMismatchTokenHash = createHash("sha256")
      .update(orderMismatchSelection.body.selectionToken)
      .digest("hex");
    await db.execute(sql`
      UPDATE pos_actor_audit
      SET metadata = jsonb_set(metadata, '{"orderId"}', to_jsonb(${String(otherOrder!.id)}::text))
      WHERE enota_id = ${enota!.id}
        AND action = ${"card_payment_recovery_selected"}
        AND metadata->>'selectionTokenHash' = ${orderMismatchTokenHash}
    `);

    const orderMismatchResponse = await supertest(app)
      .post("/racuni")
      .set("X-Test-User", user)
      .set("X-Naprava-Id", device)
      .send({
        idempotencyKey: `receipt-${runId}-selection-order-mismatch`,
        narociloId: selectedOrder!.id,
        placilnaNacin: "kartica",
        znesekKartica: 24.8,
        paymentAttemptId: orderMismatchSelection.body.paymentAttemptId,
        recoverySelectedAttemptId: orderMismatchSelection.body.attemptId,
        recoverySelectionToken: orderMismatchSelection.body.selectionToken,
      });
    expect(orderMismatchResponse.status, orderMismatchResponse.body).toBe(409);
    expect(orderMismatchResponse.body).toMatchObject({
      error: "Izbira obnovitve je potekla, ne ustreza trenutnemu uporabniku/napravi ali ni veljavna.",
    });

    const amountMismatchSelection = await supertest(app)
      .post(`/terminal/card-payment-attempts/${paymentAttempt!.id}/recovery/select`)
      .set("X-Test-User", user)
      .set("X-Naprava-Id", device)
      .send({ narociloId: selectedOrder!.id, znesek: 24.8 });
    expect(amountMismatchSelection.status, amountMismatchSelection.body).toBe(200);
    const amountMismatchTokenHash = createHash("sha256")
      .update(amountMismatchSelection.body.selectionToken)
      .digest("hex");
    await db.execute(sql`
      UPDATE pos_actor_audit
      SET metadata = jsonb_set(metadata, '{"amountCents"}', to_jsonb(${"2481"}::text))
      WHERE enota_id = ${enota!.id}
        AND action = ${"card_payment_recovery_selected"}
        AND metadata->>'selectionTokenHash' = ${amountMismatchTokenHash}
    `);

    const amountMismatchResponse = await supertest(app)
      .post("/racuni")
      .set("X-Test-User", user)
      .set("X-Naprava-Id", device)
      .send({
        idempotencyKey: `receipt-${runId}-selection-amount-mismatch`,
        narociloId: selectedOrder!.id,
        placilnaNacin: "kartica",
        znesekKartica: 24.8,
        paymentAttemptId: amountMismatchSelection.body.paymentAttemptId,
        recoverySelectedAttemptId: amountMismatchSelection.body.attemptId,
        recoverySelectionToken: amountMismatchSelection.body.selectionToken,
      });
    expect(amountMismatchResponse.status, amountMismatchResponse.body).toBe(409);
    expect(amountMismatchResponse.body).toMatchObject({
      error: "Izbira obnovitve je potekla, ne ustreza trenutnemu uporabniku/napravi ali ni veljavna.",
    });

    const receipts = await db.select({ id: racuniTable.id })
      .from(racuniTable)
      .where(eq(racuniTable.cardPaymentAttemptId, paymentAttempt!.id));
    const issueRequests = await db.select({ id: racunIzdajaZahteveTable.id })
      .from(racunIzdajaZahteveTable)
      .where(eq(racunIzdajaZahteveTable.cardPaymentAttemptId, paymentAttempt!.id));
    const completedAudit = await db.execute(sql`
      SELECT 1
      FROM pos_actor_audit
      WHERE enota_id = ${enota!.id}
        AND action = ${"card_payment_recovery_completed"}
        AND metadata->>'attemptId' = ${paymentAttempt!.id}
    `);
    expect(receipts).toHaveLength(0);
    expect(issueRequests).toHaveLength(0);
    expect(completedAudit.rows).toHaveLength(0);
  });

  it.each([
    {
      label: "SumUp checkout",
      provider: "sumup",
      referencePrefix: "sumup-checkout",
      browserField: "sumupCheckoutId",
      receiptField: "sumup_checkout_id",
    },
    {
      label: "Viva Terminal session",
      provider: "viva_terminal",
      referencePrefix: "viva-session",
      browserField: "vivaTerminalSessionId",
      receiptField: "viva_terminal_session_id",
    },
    {
      label: "Viva Smart order code",
      provider: "viva_smart",
      referencePrefix: "viva-order",
      browserField: "vivaOrderCode",
      receiptField: "viva_order_code",
    },
  ] as const)(
    "zavrne zamenjano $label referenco pred izdajo, pravilno pa sprejme",
    async ({ provider, referencePrefix, browserField, receiptField }) => {
      const runId = Math.random().toString(36).slice(2, 10).toUpperCase();
      const [company] = await db.insert(companiesTable).values({
        podjetjeDavcna: `T537${runId}`,
        naziv: `Provider reference binding ${runId}`,
      }).returning({ id: companiesTable.id });
      const [enota] = await db.insert(enoteTable).values({
        companyId: company!.id,
        ime: `Provider reference binding ${runId}`,
        capabilities: ["checkout", "receipts", "simulation"],
      }).returning({ id: enoteTable.id });
      const [narocilo] = await db.insert(narocilaTable).values({
        enotaId: enota!.id,
        skupaj: "27.60",
      }).returning({ id: narocilaTable.id });
      await db.insert(postavkeTable).values({
        narociloId: narocilo!.id,
        ime: "Artikel za vezavo terminalske reference",
        kolicina: 1,
        cenaKos: "27.60",
        skupaj: "27.60",
        davek: "22.00",
      });
      const correctReference = `${referencePrefix}-${runId}`;
      const [paymentAttempt] = await db.insert(posKarticnaPlacilaAttemptTable).values({
        companyId: company!.id,
        enotaId: enota!.id,
        narociloId: narocilo!.id,
        purpose: "receipt",
        idempotencyKey: `payment-${runId}-provider-reference`,
        provider,
        providerReferenca: correctReference,
        znesek: "27.60",
        status: "completed",
        actor: "provider-reference-binding-test",
        deviceKey: `device-${runId}`,
      }).returning({ id: posKarticnaPlacilaAttemptTable.id });

      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        Object.assign(req, {
          companyId: company!.id,
          enotaId: enota!.id,
          clerkUserId: `user-${runId}`,
          napravaKljuc: `device-${runId}`,
          log: { info: () => undefined, warn: () => undefined, error: () => undefined },
        });
        next();
      });
      app.use(racuniRouter);
      app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ error: err.message });
      });

      const baseBody = {
        narociloId: narocilo!.id,
        placilnaNacin: "kartica",
        znesekKartica: 27.6,
        paymentAttemptId: paymentAttempt!.id,
      };
      const mismatched = await supertest(app).post("/racuni").send({
        ...baseBody,
        idempotencyKey: `receipt-${runId}-wrong-reference`,
        [browserField]: `${referencePrefix}-OTHER-${runId}`,
      });
      expect(mismatched.status, mismatched.body).toBe(409);
      expect(mismatched.body).toMatchObject({
        error: "Kartični payment attempt ni potrjen ali ne ustreza naročilu, ponudniku, referenci oziroma znesku računa.",
      });

      const receiptsAfterMismatch = await db.select({ id: racuniTable.id })
        .from(racuniTable)
        .where(eq(racuniTable.cardPaymentAttemptId, paymentAttempt!.id));
      const requestsAfterMismatch = await db.select({ id: racunIzdajaZahteveTable.id })
        .from(racunIzdajaZahteveTable)
        .where(eq(racunIzdajaZahteveTable.cardPaymentAttemptId, paymentAttempt!.id));
      const completedAuditAfterMismatch = await db.execute(sql`
        SELECT 1
        FROM pos_actor_audit
        WHERE enota_id = ${enota!.id}
          AND action = ${"card_payment_recovery_completed"}
          AND metadata->>'attemptId' = ${paymentAttempt!.id}
      `);
      expect(receiptsAfterMismatch).toHaveLength(0);
      expect(requestsAfterMismatch).toHaveLength(0);
      expect(completedAuditAfterMismatch.rows).toHaveLength(0);

      const accepted = await supertest(app).post("/racuni").send({
        ...baseBody,
        idempotencyKey: `receipt-${runId}-correct-reference`,
        [browserField]: correctReference,
      });
      expect(accepted.status, accepted.body).toBe(201);

      const storedReference = await db.execute(sql`
        SELECT ${sql.identifier(receiptField)} AS provider_reference
        FROM racuni
        WHERE card_payment_attempt_id = ${paymentAttempt!.id}
      `);
      expect(storedReference.rows).toEqual([{ provider_reference: correctReference }]);
    },
  );
});

describe("sočasni storno računa s kartično napitnino", () => {
  it("ustvari in finalizira samo en negativni dokument ter replay vrne isti rezultat", async () => {
    const runId = Math.random().toString(36).slice(2, 10).toUpperCase();
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `T564${runId}`,
      naziv: `Concurrent tipped storno ${runId}`,
    }).returning({ id: companiesTable.id });
    const [enota] = await db.insert(enoteTable).values({
      companyId: company!.id,
      ime: `Concurrent tipped storno ${runId}`,
      capabilities: ["checkout", "receipts", "simulation"],
    }).returning({ id: enoteTable.id });
    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId: enota!.id,
      status: "zakljuceno",
      skupaj: "11.40",
      znesekNapitnina: "2.00",
    }).returning({ id: narocilaTable.id });
    const [izvorni] = await db.insert(racuniTable).values({
      enotaId: enota!.id,
      narociloId: narocilo!.id,
      stevilkaRacuna: `PP001-B001-${String(Math.floor(Math.random() * 900_000) + 100_000)}`,
      skupaj: "11.40",
      ddv: "2.06",
      osnova: "9.34",
      placilnaNacin: "kartica",
      status: "testni",
      fursState: "confirmed",
      znesekKartica: "13.40",
      znesekNapitnina: "2.00",
      tipPaymentMethod: "card",
    }).returning({ id: racuniTable.id });
    await db.insert(postavkeTable).values({
      narociloId: narocilo!.id,
      racunId: izvorni!.id,
      ime: "Tipped storno artikel",
      kolicina: 1,
      cenaKos: "11.40",
      skupaj: "11.40",
      davek: "22.00",
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, {
        companyId: company!.id,
        enotaId: enota!.id,
        clerkUserId: "concurrent-storno-test",
        napravaKljuc: `device-${runId}`,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      });
      next();
    });
    app.use(racuniRouter);
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: err.message, stack: err.stack });
    });

    const responses = await Promise.all([
      supertest(app).post(`/racuni/${izvorni!.id}/storniraj`),
      supertest(app).post(`/racuni/${izvorni!.id}/storniraj`),
    ]);
    expect(
      responses.every(response => [200, 202].includes(response.status)),
      JSON.stringify(responses.map(response => ({ status: response.status, body: response.body }))),
    ).toBe(true);

    const storni = await db.select({
      id: racuniTable.id,
      skupaj: racuniTable.skupaj,
      znesekKartica: racuniTable.znesekKartica,
      znesekNapitnina: racuniTable.znesekNapitnina,
      tipPaymentMethod: racuniTable.tipPaymentMethod,
      stornoFinalizedAt: racuniTable.stornoFinalizedAt,
    }).from(racuniTable).where(and(
      eq(racuniTable.izvorniRacunId, izvorni!.id),
      eq(racuniTable.jeStorno, true),
    ));
    expect(storni).toHaveLength(1);
    expect(storni[0]).toMatchObject({
      skupaj: "-11.40",
      znesekKartica: "-13.40",
      znesekNapitnina: "-2.00",
      tipPaymentMethod: "card",
    });
    expect(storni[0]!.stornoFinalizedAt).toBeInstanceOf(Date);

    const replay = await supertest(app).post(`/racuni/${izvorni!.id}/storniraj`);
    expect(replay.status, replay.body).toBe(200);
    expect(replay.body).toMatchObject({
      id: storni[0]!.id,
      idempotentReplay: true,
      znesekNapitnina: -2,
    });

    const [sourceAfter] = await db.select({ status: racuniTable.status })
      .from(racuniTable).where(eq(racuniTable.id, izvorni!.id));
    expect(sourceAfter!.status).toBe("storniran");
  });
});