import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  companiesTable,
  blagajneTable,
  darilniBonGibiTable,
  darilniBonIzdajeTable,
  db,
  enoteTable,
  fursAttemptsTable,
  narocilaTable,
  napraveTable,
  pool,
  posKarticnaPlacilaAttemptTable,
  posKarticnaPlacilaReferenceTable,
  postavkeTable,
  racuniTable,
} from "@workspace/db";
import racuniRouter, { finalizeConfirmedStorno, reserveIndividualVoucherForReceipt } from "./racuni";
import { preveriCheckout } from "../../lib/pos-sumup";

vi.mock("../../lib/pos-sumup", () => ({
  preveriCheckout: vi.fn(async () => ({ status: "PAID", amount: 20, currency: "EUR" })),
}));

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();
let companyId: string;
let enotaId: number;
const napravaKljuc = `gift-voucher-${RUN_ID}`;
const racunIds: number[] = [];
const mockedPreveriCheckout = vi.mocked(preveriCheckout);

async function createGiftAttempt(
  idempotencyKey: string,
  checkoutId: string | null,
  amount = 20,
  overrides: Partial<typeof posKarticnaPlacilaAttemptTable.$inferInsert> = {},
) {
  const [attempt] = await db.insert(posKarticnaPlacilaAttemptTable).values({
    companyId,
    enotaId,
    purpose: "gift_voucher",
    idempotencyKey,
    provider: "sumup",
    znesek: amount.toFixed(2),
    providerReferenca: checkoutId,
    status: "completed",
    ...overrides,
  }).returning({ id: posKarticnaPlacilaAttemptTable.id });
  return attempt!.id;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).companyId = companyId;
    (req as any).enotaId = enotaId;
    (req as any).napravaKljuc = req.headers["x-naprava-id"] === "manjkajoca-naprava"
      ? "manjkajoca-naprava"
      : napravaKljuc;
    (req as any).log = { info: () => undefined, warn: () => undefined, error: () => undefined };
    next();
  });
  app.use(racuniRouter);
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_TST_BON_${RUN_ID}`,
    naziv: `Test darilni boni ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;
  const [enota] = await db.insert(enoteTable).values({
    companyId,
    ime: `Enota boni ${RUN_ID}`,
  }).returning({ id: enoteTable.id });
  enotaId = enota!.id;
  await db.insert(napraveTable).values({
    enotaId,
    ime: "Testni SumUp terminal",
    napravaKljuc,
    nastavitveJson: JSON.stringify({ sumupAktiven: true, sumupApiKey: "test-key" }),
  });
});

afterAll(async () => {
  // Fiskalni snapshoti in njihovi povezani dokumenti so namenoma nespremenljivi.
  // Test zato uporablja unikaten tenant in regulatorne sledi pusti nedotaknjene.
  await pool.end();
});

describe("produkcijska izdaja darilnega bona", () => {
  it("ustvari POS račun in hold atomsko ter ne sprosti holda za neznan ali ponovljiv FURS izid", async () => {
    const code=`POS-${RUN_ID}-HOLD-TEST`;
    const client=await (db as any).$client.connect();
    let voucherId="";
    let firstOperationId="";
    const concurrentOperationIds:string[]=[];
    let orderId=0;
    try {
      let profile=(await client.query(`INSERT INTO public_venue_profiles(unit_id,company_id,slug)
        VALUES($1,$2,$3) ON CONFLICT(unit_id) DO NOTHING RETURNING id`,
      [enotaId,companyId,`pos-hold-${RUN_ID.toLowerCase()}`])).rows[0];
      if(!profile)profile=(await client.query("SELECT id FROM public_venue_profiles WHERE unit_id=$1",[enotaId])).rows[0];
      const checkout=(await client.query(`INSERT INTO public_voucher_checkouts(profile_id,company_id,unit_id,idempotency_key,expected_amount_cents,buyer_name,buyer_email,recipient_name,recipient_email,items,privacy_accepted_at,status,payment_status)
        VALUES($1,$2,$3,$4,4000,'Kupec','k@example.test','Gost','g@example.test','[]',now(),'complete','paid') RETURNING id`,
      [profile.id,companyId,enotaId,`pos-hold-checkout-${RUN_ID}`])).rows[0];
      const voucher=(await client.query(`INSERT INTO individual_vouchers(checkout_id,company_id,unit_id,code_hash,code_suffix,initial_amount_cents,recipient_name,recipient_email)
        VALUES($1,$2,$3,$4,'HOLD',4000,'Gost','g@example.test') RETURNING id`,
      [checkout.id,companyId,enotaId,createHash("sha256").update(code).digest("hex")])).rows[0];
      voucherId=voucher.id;
      await client.query(`INSERT INTO individual_voucher_movements(voucher_id,company_id,operation_key,type,amount_cents)
        VALUES($1,$2,'issue','issue',4000)`,[voucherId,companyId]);
      const order=(await client.query("INSERT INTO narocila(enota_id,status,skupaj) VALUES($1,'odprto','40.00') RETURNING id",[enotaId])).rows[0];
      orderId=order.id;
      firstOperationId=(await client.query(`INSERT INTO pos_racun_izdaja_zahteve(company_id,enota_id,narocilo_id,blagajna_kljuc,idempotency_key,payload_hash,status)
        VALUES($1,$2,$3,'TEST:POS-HOLD-ROLLBACK',$4,'rollback-test','processing') RETURNING id`,
      [companyId,enotaId,orderId,`pos-hold-rollback-${RUN_ID}`])).rows[0].id;
      for(let index=0;index<2;index+=1) {
        const operation=(await client.query(`INSERT INTO pos_racun_izdaja_zahteve(company_id,enota_id,narocilo_id,blagajna_kljuc,idempotency_key,payload_hash,status)
          VALUES($1,$2,$3,$4,$5,'furs-test','processing') RETURNING id`,
        [companyId,enotaId,orderId,`TEST:POS-HOLD-FURS-${index}`,`pos-hold-furs-${RUN_ID}-${index}`])).rows[0];
        concurrentOperationIds.push(operation.id);
      }
    } finally { client.release(); }

    await expect(db.transaction(async tx => {
      const [receipt]=await tx.insert(racuniTable).values({
        enotaId,narociloId:orderId,stevilkaRacuna:`POS-HOLD-ROLLBACK-${RUN_ID}`,
        skupaj:"40.00",ddv:"0.00",placilnaNacin:"bon",status:"napaka",fursState:"sending",
      }).returning({id:racuniTable.id});
      await reserveIndividualVoucherForReceipt(tx,{
        companyId,code,operationId:firstOperationId,amountCents:4000,receiptId:receipt!.id,
      });
      throw new Error("simulated process failure before transaction commit");
    })).rejects.toThrow("simulated process failure");
    const rolledBack=await (db as any).$client.query(`SELECT
      (SELECT count(*)::int FROM racuni WHERE stevilka_racuna=$1) receipts,
      (SELECT count(*)::int FROM pos_individual_voucher_redemption_holds WHERE operation_id=$2) holds`,
    [`POS-HOLD-ROLLBACK-${RUN_ID}`,firstOperationId]);
    expect(rolledBack.rows[0]).toEqual({receipts:0,holds:0});

    const concurrent=await Promise.allSettled(concurrentOperationIds.map((operationId,index)=>
      db.transaction(async tx => {
        const [receipt]=await tx.insert(racuniTable).values({
          enotaId,narociloId:orderId,stevilkaRacuna:`POS-HOLD-${index}-${RUN_ID}`,
          skupaj:"30.00",ddv:"0.00",placilnaNacin:"bon",status:"napaka",fursState:"sending",
        }).returning({id:racuniTable.id});
        await reserveIndividualVoucherForReceipt(tx,{
          companyId,code,operationId,amountCents:3000,receiptId:receipt!.id,
        });
        return {receiptId:receipt!.id,operationId};
      })
    ));
    expect(concurrent.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect(concurrent.filter(result=>result.status==="rejected")).toHaveLength(1);
    const winner=concurrent.find(result=>result.status==="fulfilled") as PromiseFulfilledResult<{receiptId:number;operationId:string}>;
    const receiptId=winner.value.receiptId;
    const winningOperationId=winner.value.operationId;
    for (const fursState of ["pending","failed","unknown"] as const) {
      await db.update(racuniTable).set({fursState}).where(eq(racuniTable.id,receiptId));
      const hold=await (db as any).$client.query(`SELECT status,receipt_id FROM pos_individual_voucher_redemption_holds WHERE operation_id=$1`,[winningOperationId]);
      expect(hold.rows[0]).toEqual({status:"held",receipt_id:receiptId});
    }
    const balance=await (db as any).$client.query(`SELECT COALESCE(sum(CASE WHEN type IN ('issue','reverse') THEN amount_cents ELSE -amount_cents END),0)::int balance
      FROM individual_voucher_movements WHERE voucher_id=$1`,[voucherId]);
    expect(Number(balance.rows[0].balance)).toBe(4000);
  });

  it("zavrne delčke centa pred rezervacijo, preverjanjem ponudnika ali fiskalizacijo", async () => {
    const app = buildApp();
    const providerCallsBefore = mockedPreveriCheckout.mock.calls.length;
    const key = `gift-${RUN_ID}-fractional-cent`;
    const response = await supertest(app).post("/darilni-boni/izdaja").send({
      znesek: 10.001,
      placilnaNacin: "gotovina",
      idempotencyKey: key,
    });
    expect(response.status).toBe(400);
    expect(mockedPreveriCheckout).toHaveBeenCalledTimes(providerCallsBefore);
    const reservations = await db.select().from(darilniBonIzdajeTable).where(and(
      eq(darilniBonIzdajeTable.companyId, companyId),
      eq(darilniBonIzdajeTable.idempotencyKey, key),
    ));
    expect(reservations).toHaveLength(0);
  });

  it("vrne isti legacy račun tudi po kasnejši konfiguraciji aktivne blagajne", async () => {
    const app = buildApp();
    const body = {
      znesek: 18,
      placilnaNacin: "gotovina",
      idempotencyKey: `gift-${RUN_ID}-legacy-replay-register`,
    };
    const first = await supertest(app).post("/darilni-boni/izdaja").send(body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    racunIds.push(first.body.id);

    const [configuredRegister] = await db.insert(blagajneTable).values({
      enotaId,
      ppId: "PP-AFTER-LEGACY",
      bId: "B-AFTER-LEGACY",
      ime: "Kasneje konfigurirana blagajna",
      aktivna: true,
    }).returning({ id: blagajneTable.id });
    const replay = await supertest(app).post("/darilni-boni/izdaja").send(body);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.idempotentno).toBe(true);
    await db.delete(blagajneTable).where(eq(blagajneTable.id, configuredRegister!.id));
  });

  it("atomsko rezervira terminalsko referenco tudi ob sočasnih poskusih", async () => {
    const referenca = `concurrent-${RUN_ID}`;
    const [otherCompany] = await db.insert(companiesTable).values({
      podjetjeDavcna: `SI_TST_BON_OTHER_${RUN_ID}`,
      naziv: `Test drugo podjetje ${RUN_ID}`,
    }).returning({ id: companiesTable.id });
    const claims = await Promise.all([
      db.insert(posKarticnaPlacilaReferenceTable).values({
        companyId,
        provider: "sumup",
        referenca,
      }).onConflictDoNothing().returning({ id: posKarticnaPlacilaReferenceTable.id }),
      db.insert(posKarticnaPlacilaReferenceTable).values({
        companyId: otherCompany!.id,
        provider: "sumup",
        referenca,
      }).onConflictDoNothing().returning({ id: posKarticnaPlacilaReferenceTable.id }),
    ]);
    expect(claims.flat()).toHaveLength(1);
    await db.delete(posKarticnaPlacilaReferenceTable)
      .where(eq(posKarticnaPlacilaReferenceTable.referenca, referenca));
    await db.delete(companiesTable).where(eq(companiesTable.id, otherCompany!.id));
  });

  it("ponovi SumUp preverjanje po začasni napaki brez novega zaračunavanja", async () => {
    const app = buildApp();
    const idempotencyKey = `gift-${RUN_ID}-card-retry`;
    const paymentAttemptId = await createGiftAttempt(idempotencyKey, `checkout-retry-${RUN_ID}`);
    const body = {
      znesek: 20,
      placilnaNacin: "kartica",
      paymentAttemptId,
      idempotencyKey,
    };
    mockedPreveriCheckout.mockResolvedValueOnce({ status: "FAILED", amount: null, currency: null });
    const first = await supertest(app).post("/darilni-boni/izdaja").send(body);
    expect(first.status).toBe(409);

    mockedPreveriCheckout.mockResolvedValueOnce({ status: "PAID", amount: 20, currency: "EUR" });
    const retry = await supertest(app).post("/darilni-boni/izdaja").send(body);
    expect(retry.status).toBe(201);
    racunIds.push(retry.body.id);
    const storno = await supertest(app).post(`/racuni/${retry.body.id}/storniraj`);
    expect(storno.status, JSON.stringify(storno.body)).toBe(200);
    racunIds.push(storno.body.id);
  });

  it("po omrežni napaki SumUp ponovno preveri isti checkout pred fiskalizacijo", async () => {
    const app = buildApp();
    const idempotencyKey = `gift-${RUN_ID}-card-network-retry`;
    const paymentAttemptId = await createGiftAttempt(idempotencyKey, `checkout-network-retry-${RUN_ID}`);
    const body = {
      znesek: 20,
      placilnaNacin: "kartica",
      paymentAttemptId,
      idempotencyKey,
    };
    mockedPreveriCheckout.mockRejectedValueOnce(new Error("SumUp omrežna napaka"));
    const first = await supertest(app).post("/darilni-boni/izdaja").send(body);
    expect(first.status).toBe(503);

    mockedPreveriCheckout.mockResolvedValueOnce({ status: "PAID", amount: 20, currency: "EUR" });
    const retry = await supertest(app).post("/darilni-boni/izdaja").send(body);
    expect(retry.status).toBe(201);
    racunIds.push(retry.body.id);
    const storno = await supertest(app).post(`/racuni/${retry.body.id}/storniraj`);
    expect(storno.status, JSON.stringify(storno.body)).toBe(200);
    racunIds.push(storno.body.id);
  });

  it("zavrne potrjen SumUp checkout v drugi valuti pred fiskalizacijo", async () => {
    const app = buildApp();
    const idempotencyKey = `gift-${RUN_ID}-card-usd`;
    const paymentAttemptId = await createGiftAttempt(idempotencyKey, `checkout-usd-${RUN_ID}`);
    mockedPreveriCheckout.mockResolvedValueOnce({ status: "PAID", amount: 20, currency: "USD" });
    const response = await supertest(app).post("/darilni-boni/izdaja").send({
      znesek: 20,
      placilnaNacin: "kartica",
      paymentAttemptId,
      idempotencyKey,
    });
    expect(response.status).toBe(409);

    const amountKey = `gift-${RUN_ID}-provider-amount`;
    const amountAttempt = await createGiftAttempt(amountKey, `checkout-${RUN_ID}-provider-amount`);
    mockedPreveriCheckout.mockResolvedValueOnce({ status: "PAID", amount: 19, currency: "EUR" });
    const amountResponse = await supertest(app).post("/darilni-boni/izdaja").send({
      znesek: 20,
      placilnaNacin: "kartica",
      paymentAttemptId: amountAttempt,
      idempotencyKey: amountKey,
    });
    expect(amountResponse.status).toBe(409);
  });

  it("pred FURS zavrne neveljavne ali napačno omejene plačilne poskuse in odjemalčeve reference", async () => {
    const app = buildApp();
    const [receiptOrder] = await db.insert(narocilaTable).values({
      enotaId, status: "odprto", skupaj: "20.00",
    }).returning({ id: narocilaTable.id });
    const cases = [
      { suffix: "pending", overrides: { status: "pending" as const } },
      { suffix: "failed", overrides: { status: "failed" as const } },
      { suffix: "unknown", overrides: { status: "unknown" as const } },
      { suffix: "provider", overrides: { provider: "payten" as const } },
      { suffix: "amount", amount: 19 },
      { suffix: "missing-ref", checkout: null },
      {
        suffix: "receipt-purpose",
        overrides: { purpose: "receipt" as const, narociloId: receiptOrder!.id },
      },
    ];
    for (const invalid of cases) {
      const key = `gift-${RUN_ID}-invalid-${invalid.suffix}`;
      const attemptId = await createGiftAttempt(
        key,
        "checkout" in invalid && invalid.checkout === null ? null : `checkout-${RUN_ID}-${invalid.suffix}`,
        "amount" in invalid ? invalid.amount : 20,
        "overrides" in invalid ? invalid.overrides : {},
      );
      const response = await supertest(app).post("/darilni-boni/izdaja").send({
        znesek: 20,
        placilnaNacin: "kartica",
        idempotencyKey: key,
        paymentAttemptId: attemptId,
      });
      expect(response.status, invalid.suffix).toBe(409);
      const reservations = await db.select({ id: darilniBonIzdajeTable.id })
        .from(darilniBonIzdajeTable)
        .where(and(
          eq(darilniBonIzdajeTable.companyId, companyId),
          eq(darilniBonIzdajeTable.idempotencyKey, key),
        ));
      expect(reservations, invalid.suffix).toHaveLength(0);
    }

    const clientRefKey = `gift-${RUN_ID}-client-ref`;
    const clientRefAttempt = await createGiftAttempt(clientRefKey, `checkout-${RUN_ID}-client-ref`);
    const clientRefResponse = await supertest(app).post("/darilni-boni/izdaja").send({
      znesek: 20,
      placilnaNacin: "kartica",
      idempotencyKey: clientRefKey,
      paymentAttemptId: clientRefAttempt,
      sumupCheckoutId: `checkout-${RUN_ID}-client-ref`,
    });
    expect(clientRefResponse.status).toBe(400);

    const [otherCompany] = await db.insert(companiesTable).values({
      podjetjeDavcna: `SI_TST_SCOPE_${RUN_ID}`,
      naziv: `Test scope ${RUN_ID}`,
    }).returning({ id: companiesTable.id });
    const [otherCompanyUnit] = await db.insert(enoteTable).values({
      companyId: otherCompany!.id,
      ime: `Tuja enota ${RUN_ID}`,
    }).returning({ id: enoteTable.id });
    const [otherUnit] = await db.insert(enoteTable).values({
      companyId,
      ime: `Druga lastna enota ${RUN_ID}`,
    }).returning({ id: enoteTable.id });
    const scopedAttempts = [
      await createGiftAttempt(
        `gift-${RUN_ID}-wrong-company`,
        `checkout-${RUN_ID}-wrong-company`,
        20,
        { companyId: otherCompany!.id, enotaId: otherCompanyUnit!.id },
      ),
      await createGiftAttempt(
        `gift-${RUN_ID}-wrong-unit`,
        `checkout-${RUN_ID}-wrong-unit`,
        20,
        { enotaId: otherUnit!.id },
      ),
    ];
    for (const [index, attemptId] of scopedAttempts.entries()) {
      const response = await supertest(app).post("/darilni-boni/izdaja").send({
        znesek: 20,
        placilnaNacin: "kartica",
        idempotencyKey: `gift-${RUN_ID}-${index === 0 ? "wrong-company" : "wrong-unit"}`,
        paymentAttemptId: attemptId,
      });
      expect(response.status).toBe(409);
    }
    await db.delete(posKarticnaPlacilaAttemptTable)
      .where(inArray(posKarticnaPlacilaAttemptTable.id, scopedAttempts));
    await db.delete(enoteTable).where(eq(enoteTable.id, otherUnit!.id));
    await db.delete(enoteTable).where(eq(enoteTable.id, otherCompanyUnit!.id));
    await db.delete(companiesTable).where(eq(companiesTable.id, otherCompany!.id));
  });

  it("sočasno porabi isti poskus največ enkrat in ustvari samo en FURS audit ter gib", async () => {
    const app = buildApp();
    const key = `gift-${RUN_ID}-parallel-card`;
    const paymentAttemptId = await createGiftAttempt(key, `checkout-${RUN_ID}-parallel-card`);
    mockedPreveriCheckout.mockResolvedValue({ status: "PAID", amount: 20, currency: "EUR" });
    const body = { znesek: 20, placilnaNacin: "kartica", idempotencyKey: key, paymentAttemptId };
    const responses = await Promise.all([
      supertest(app).post("/darilni-boni/izdaja").send(body),
      supertest(app).post("/darilni-boni/izdaja").send(body),
    ]);
    const issued = responses.find(response => response.status === 201);
    expect(issued).toBeDefined();
    expect(responses.filter(response => response.status === 201)).toHaveLength(1);
    racunIds.push(issued!.body.id);

    const [reservation] = await db.select().from(darilniBonIzdajeTable).where(and(
      eq(darilniBonIzdajeTable.companyId, companyId),
      eq(darilniBonIzdajeTable.idempotencyKey, key),
    ));
    expect(reservation?.cardPaymentAttemptId).toBe(paymentAttemptId);
    expect(reservation?.terminalskoPlaciloPreverjeno).toBe("preverjeno");
    const movements = await db.select().from(darilniBonGibiTable)
      .where(eq(darilniBonGibiTable.racunId, issued!.body.id));
    const fursAttempts = await db.select().from(fursAttemptsTable)
      .where(eq(fursAttemptsTable.racunId, issued!.body.id));
    expect(movements).toHaveLength(1);
    expect(fursAttempts).toHaveLength(1);

    // Keep the shared tenant's open voucher balance isolated for subsequent
    // cases while retaining the immutable issuance/FURS audit trail.
    const storno = await supertest(app).post(`/racuni/${issued!.body.id}/storniraj`);
    expect(storno.status, JSON.stringify(storno.body)).toBe(200);
    racunIds.push(storno.body.id);
  });

  it("fiskalizira izdajo po strežniškem FURS načinu, zapiše en gib in jo storno izloči iz odprtega salda", async () => {
    const app = buildApp();
    const baselineResponse = await supertest(app).get("/darilni-boni/stanje");
    expect(baselineResponse.status).toBe(200);
    const baseline = baselineResponse.body as { izdano: number; unovceno: number; odprto: number };
    const izdaja = await supertest(app).post("/darilni-boni/izdaja").send({
      znesek: 25,
      placilnaNacin: "gotovina",
      idempotencyKey: `gift-${RUN_ID}-furs-ignored`,
      // Strežnik ima privzeto simulacijo; odjemalčeva produkcija jo ne sme preglasiti.
      fursNacin: "produkcija",
    });
    expect(izdaja.status).toBe(201);
    racunIds.push(izdaja.body.id);
    expect(izdaja.body.status).toBe("testni");
    expect(izdaja.body.zoi).toBeTruthy();
    expect(izdaja.body.eor).toBeTruthy();

    const [racun] = await db.select().from(racuniTable).where(eq(racuniTable.id, izdaja.body.id));
    expect(racun).toMatchObject({
      jeDarilniBonIzdaja: true,
      placilnaNacin: "gotovina",
      status: "testni",
      skupaj: "25.00",
      ddv: "0.00",
      znesekGotovina: "25.00",
    });

    const gibi = await db.select().from(darilniBonGibiTable)
      .where(and(eq(darilniBonGibiTable.racunId, izdaja.body.id), eq(darilniBonGibiTable.tip, "izdaja")));
    expect(gibi).toHaveLength(1);
    expect(gibi[0]!.znesek).toBe("25.00");

    const stanjePredStornom = await supertest(app).get("/darilni-boni/stanje");
    expect(stanjePredStornom.body).toMatchObject({
      izdano: baseline.izdano + 25,
      unovceno: baseline.unovceno,
      odprto: baseline.odprto + 25,
    });

    const storno = await supertest(app).post(`/racuni/${izdaja.body.id}/storniraj`);
    expect(storno.status, JSON.stringify(storno.body)).toBe(200);
    racunIds.push(storno.body.id);

    const [stornoRacun] = await db.select().from(racuniTable).where(eq(racuniTable.id, storno.body.id));
    expect(stornoRacun?.jeDarilniBonIzdaja).toBe(true);
    const stanjePoStornu = await supertest(app).get("/darilni-boni/stanje");
    expect(stanjePoStornu.body).toMatchObject(baseline);
  });

  it("ponovljen zahtevek z istim ključem vrne isti račun in ne izda drugega bona", async () => {
    const app = buildApp();
    const body = {
      znesek: 31,
      placilnaNacin: "gotovina",
      idempotencyKey: `gift-${RUN_ID}-idempotent`,
    };
    const first = await supertest(app).post("/darilni-boni/izdaja").send(body);
    expect(first.status).toBe(201);
    racunIds.push(first.body.id);

    const second = await supertest(app).post("/darilni-boni/izdaja").send(body);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ id: first.body.id, idempotentno: true });

    const issues = await db.select({ racunId: darilniBonGibiTable.racunId }).from(darilniBonGibiTable)
      .where(and(eq(darilniBonGibiTable.racunId, first.body.id), eq(darilniBonGibiTable.tip, "izdaja")));
    expect(issues).toHaveLength(1);

    const changedAmount = await supertest(app).post("/darilni-boni/izdaja").send({
      ...body,
      znesek: 32,
    });
    expect(changedAmount.status).toBe(409);
  });

  it("potrjen storno povrne individualni bon natanko enkrat in ohrani potek veljavnosti", async () => {
    const client = await (db as any).$client.connect();
    let originalReceiptId = 0;
    let stornoReceiptId = 0;
    let voucherId = "";
    try {
      let profile = (await client.query(`INSERT INTO public_venue_profiles(unit_id,company_id,slug)
        VALUES($1,$2,$3) ON CONFLICT(unit_id) DO NOTHING RETURNING id`,
      [enotaId,companyId,`storno-${RUN_ID.toLowerCase()}`])).rows[0];
      if(!profile)profile=(await client.query("SELECT id FROM public_venue_profiles WHERE unit_id=$1",[enotaId])).rows[0];
      const checkout = (await client.query(`INSERT INTO public_voucher_checkouts(profile_id,company_id,unit_id,idempotency_key,expected_amount_cents,buyer_name,buyer_email,recipient_name,recipient_email,items,privacy_accepted_at,status,payment_status)
        VALUES($1,$2,$3,$4,5000,'Kupec','k@example.test','Gost','g@example.test','[]',now(),'complete','paid') RETURNING id`,
      [profile.id,companyId,enotaId,`storno-${RUN_ID}`])).rows[0];
      const voucher = (await client.query(`INSERT INTO individual_vouchers(checkout_id,company_id,unit_id,code_hash,code_suffix,initial_amount_cents,recipient_name,recipient_email,expires_at)
        VALUES($1,$2,$3,$4,'STORNO',5000,'Gost','g@example.test',now()-interval '1 day') RETURNING id`,
      [checkout.id,companyId,enotaId,`storno-hash-${RUN_ID}`])).rows[0];
      voucherId = voucher.id;
      await client.query(`INSERT INTO individual_voucher_movements(voucher_id,company_id,operation_key,type,amount_cents)
        VALUES($1,$2,'issue','issue',5000)`,[voucher.id,companyId]);
      const order=(await client.query("INSERT INTO narocila(enota_id,status,skupaj) VALUES($1,'zakljuceno','30.00') RETURNING id",[enotaId])).rows[0];
      const issue=(await client.query(`INSERT INTO pos_racun_izdaja_zahteve(company_id,enota_id,narocilo_id,blagajna_kljuc,idempotency_key,payload_hash,status)
        VALUES($1,$2,$3,'TEST:STORNO',$4,'test','completed') RETURNING id`,
      [companyId,enotaId,order.id,`storno-hold-${RUN_ID}`])).rows[0];
      const [original] = await db.insert(racuniTable).values({
        enotaId, narociloId: order.id, stevilkaRacuna: `STORNO-ORIG-${RUN_ID}`,
        skupaj: "30.00", ddv: "0.00", placilnaNacin: "bon", status: "testni",
        fursState: "confirmed", businessFinalizedAt: new Date(),
      }).returning({ id: racuniTable.id });
      originalReceiptId = original!.id;
      const [storno] = await db.insert(racuniTable).values({
        enotaId, narociloId: order.id, stevilkaRacuna: `STORNO-${RUN_ID}`,
        skupaj: "-30.00", ddv: "0.00", placilnaNacin: "bon", status: "testni",
        fursState: "confirmed", jeStorno: true, izvorniRacunId: originalReceiptId,
      }).returning({ id: racuniTable.id });
      stornoReceiptId = storno!.id;
      await client.query(`INSERT INTO individual_voucher_movements(voucher_id,company_id,operation_key,type,amount_cents,receipt_id)
        VALUES($1,$2,$3,'redeem',3000,$4)`,[voucher.id,companyId,`pos-receipt:${issue.id}`,originalReceiptId]);
      await client.query(`INSERT INTO pos_individual_voucher_redemption_holds(operation_id,voucher_id,company_id,amount_cents,receipt_id,status,committed_at)
        VALUES($1,$2,$3,3000,$4,'committed',now())`,[issue.id,voucher.id,companyId,originalReceiptId]);
    } finally {
      client.release();
    }

    await db.transaction(tx => finalizeConfirmedStorno(tx, stornoReceiptId, "storno-test"));
    await db.transaction(tx => finalizeConfirmedStorno(tx, stornoReceiptId, "storno-test-replay"));
    const verify = await (db as any).$client;
    const movements = await verify.query(`SELECT type,amount_cents FROM individual_voucher_movements
      WHERE voucher_id=$1 ORDER BY created_at,id`,[voucherId]);
    expect(movements.rows.filter((row:any)=>row.type==="reverse")).toHaveLength(1);
    expect(Number(movements.rows.reduce((balance:number,row:any)=>balance+(row.type==="redeem"?-1:1)*Number(row.amount_cents),0))).toBe(5000);
    const state = await verify.query(`SELECT v.status,h.status hold_status FROM individual_vouchers v
      JOIN pos_individual_voucher_redemption_holds h ON h.voucher_id=v.id
      WHERE v.id=$1 AND h.receipt_id=$2`,[voucherId,originalReceiptId]);
    expect(state.rows[0]).toEqual({ status: "spent", hold_status: "reversed" });
    expect(originalReceiptId).toBeGreaterThan(0);
  });

  it("zavrne neaktivno ali tujo blagajno in ponovno uporabo iste kartične reference", async () => {
    const app = buildApp();
    const [otherEnota] = await db.insert(enoteTable).values({
      companyId,
      ime: `Druga enota ${RUN_ID}`,
    }).returning({ id: enoteTable.id });
    const [wrongCashRegister] = await db.insert(blagajneTable).values({
      enotaId: otherEnota!.id,
      ppId: "PP-OTHER",
      bId: "B-OTHER",
      ime: "Druga blagajna",
      aktivna: true,
    }).returning({ id: blagajneTable.id });
    const [inactiveCashRegister] = await db.insert(blagajneTable).values({
      enotaId,
      ppId: "PP-INACTIVE",
      bId: "B-INACTIVE",
      ime: "Neaktivna blagajna",
      aktivna: false,
    }).returning({ id: blagajneTable.id });
    const [krizisceCashRegister] = await db.insert(blagajneTable).values({
      enotaId,
      ppId: "SIM-KRIZISCE-24399",
      bId: "B-KRIZISCE-SIM-01",
      ime: "Križišče simulacijska blagajna",
      aktivna: true,
    }).returning({ id: blagajneTable.id });

    const missingAfterUnitSwitch = await supertest(app).post("/darilni-boni/izdaja").send({
      znesek: 20,
      placilnaNacin: "gotovina",
      idempotencyKey: `gift-${RUN_ID}-missing-after-unit-switch`,
    });
    expect(missingAfterUnitSwitch.status).toBe(400);
    expect(missingAfterUnitSwitch.body.code).toBe("BLAGAJNA_REQUIRED");

    const explicitAfterUnitSwitch = await supertest(app).post("/darilni-boni/izdaja").send({
      znesek: 20,
      placilnaNacin: "gotovina",
      blagajnaId: krizisceCashRegister!.id,
      idempotencyKey: `gift-${RUN_ID}-explicit-after-unit-switch`,
    });
    expect(explicitAfterUnitSwitch.status, JSON.stringify(explicitAfterUnitSwitch.body)).toBe(201);
    expect(explicitAfterUnitSwitch.body.stevilkaRacuna).toMatch(
      /^SIM-KRIZISCE-24399-B-KRIZISCE-SIM-01-\d{6}$/,
    );
    racunIds.push(explicitAfterUnitSwitch.body.id);
    await db.delete(blagajneTable).where(eq(blagajneTable.id, krizisceCashRegister!.id));

    const inactive = await supertest(app).post("/darilni-boni/izdaja").send({
      znesek: 20,
      placilnaNacin: "gotovina",
      blagajnaId: inactiveCashRegister!.id,
      idempotencyKey: `gift-${RUN_ID}-inactive-register`,
    });
    expect(inactive.status).toBe(403);

    const wrongUnit = await supertest(app).post("/darilni-boni/izdaja").send({
      znesek: 20,
      placilnaNacin: "gotovina",
      blagajnaId: wrongCashRegister!.id,
      idempotencyKey: `gift-${RUN_ID}-wrong-register`,
    });
    expect(wrongUnit.status).toBe(403);

    const missingCardReference = await supertest(app).post("/darilni-boni/izdaja").send({
      znesek: 20,
      placilnaNacin: "kartica",
      idempotencyKey: `gift-${RUN_ID}-card-without-reference`,
    });
    expect(missingCardReference.status).toBe(400);

    const firstCardKey = `gift-${RUN_ID}-card-1`;
    const firstCardAttemptId = await createGiftAttempt(firstCardKey, `checkout-${RUN_ID}`);
    const firstCard = await supertest(app).post("/darilni-boni/izdaja").send({
      znesek: 20,
      placilnaNacin: "kartica",
      paymentAttemptId: firstCardAttemptId,
      idempotencyKey: firstCardKey,
    });
    expect(firstCard.status).toBe(201);
    racunIds.push(firstCard.body.id);

    const retryFirstCard = await supertest(app).post("/darilni-boni/izdaja")
      .set("X-Naprava-Id", "manjkajoca-naprava")
      .send({
      znesek: 20,
      placilnaNacin: "kartica",
      paymentAttemptId: firstCardAttemptId,
      idempotencyKey: firstCardKey,
    });
    expect(retryFirstCard.status).toBe(200);
    expect(retryFirstCard.body).toMatchObject({ id: firstCard.body.id, idempotentno: true });

    const duplicateReference = await supertest(app).post("/darilni-boni/izdaja").send({
      znesek: 20,
      placilnaNacin: "kartica",
      idempotencyKey: `gift-${RUN_ID}-card-2`,
      paymentAttemptId: firstCardAttemptId,
    });
    expect(duplicateReference.status).toBe(409);

    const [normalOrderAfterGift] = await db.insert(narocilaTable).values({
      enotaId,
      status: "zakljuceno",
      skupaj: "20.00",
    }).returning({ id: narocilaTable.id });
    await expect(db.insert(racuniTable).values({
      enotaId,
      narociloId: normalOrderAfterGift!.id,
      stevilkaRacuna: `TEST-NORMAL-AFTER-GIFT-${RUN_ID}`,
      skupaj: "20.00",
      ddv: "3.61",
      osnova: "16.39",
      placilnaNacin: "kartica",
      status: "testni",
      sumupCheckoutId: `checkout-${RUN_ID}`,
    })).rejects.toThrow();

    const [normalOrderBeforeGift] = await db.insert(narocilaTable).values({
      enotaId,
      status: "zakljuceno",
      skupaj: "19.00",
    }).returning({ id: narocilaTable.id });
    const [normalReceiptBeforeGift] = await db.insert(racuniTable).values({
      enotaId,
      narociloId: normalOrderBeforeGift!.id,
      stevilkaRacuna: `TEST-NORMAL-BEFORE-GIFT-${RUN_ID}`,
      skupaj: "19.00",
      ddv: "3.43",
      osnova: "15.57",
      placilnaNacin: "kartica",
      status: "testni",
      sumupCheckoutId: `normal-checkout-${RUN_ID}`,
    }).returning({ id: racuniTable.id });
    racunIds.push(normalReceiptBeforeGift!.id);

    const giftAfterNormalKey = `gift-${RUN_ID}-card-after-normal`;
    const giftAfterNormalAttempt = await createGiftAttempt(giftAfterNormalKey, `normal-checkout-${RUN_ID}`, 19);
    const giftAfterNormal = await supertest(app).post("/darilni-boni/izdaja").send({
      znesek: 19,
      placilnaNacin: "kartica",
      paymentAttemptId: giftAfterNormalAttempt,
      idempotencyKey: giftAfterNormalKey,
    });
    expect(giftAfterNormal.status).toBe(409);

    await db.delete(blagajneTable).where(eq(blagajneTable.id, wrongCashRegister!.id));
    await db.delete(blagajneTable).where(eq(blagajneTable.id, inactiveCashRegister!.id));
    await db.delete(enoteTable).where(eq(enoteTable.id, otherEnota!.id));
  });
});