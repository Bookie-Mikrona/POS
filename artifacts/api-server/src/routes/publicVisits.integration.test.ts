import { createHash, randomUUID } from "node:crypto";
import express from "express";
import supertest from "supertest";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { companiesTable, db, enoteTable, mizeTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  internalVoucherRouter,
  processPendingVoucherDeliveries,
  processPublicStripeEvent,
  publicVisitsRouter,
  stripeAccountIsReady,
  stripeCheckoutEventAccountMatches,
  voucherStripeIdempotencyKey,
  startsAt,
  voucherDeliveryRetryDelayMinutes,
} from "./publicVisits";

const run = randomUUID().slice(0, 8);
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
const imageStorage = vi.hoisted(() => ({
  counter: 0,
  files: new Map<string,{mime:string;bytes:Buffer}>(),
  deleted: [] as string[],
}));
let companyId = "";
let unitId = 0;
let profileId = "";

vi.mock("@replit/connectors-sdk", () => ({
  ReplitConnectors: class { proxy() { throw new Error("Stripe v teh testih ni klican."); } },
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail }) },
}));
vi.mock("../lib/objectStorage", () => {
  class ObjectNotFoundError extends Error {}
  class ObjectStorageService {
    async getObjectEntityUploadURL(relativeDir:string) {
      imageStorage.counter+=1;
      const id=`00000000-0000-4000-8000-${String(imageStorage.counter).padStart(12,"0")}`;
      return `https://storage.googleapis.com/test-bucket/private/${relativeDir}/${id}`;
    }
    normalizeObjectEntityPath(rawPath:string) {
      return `/objects/${new URL(rawPath).pathname.split("/private/")[1]}`;
    }
    async getObjectEntityFile(objectPath:string) {
      const stored=imageStorage.files.get(objectPath);
      if(!stored)throw new ObjectNotFoundError();
      return {
        getMetadata:async()=>[{contentType:stored.mime,size:String(stored.bytes.length)}],
        download:async(options?:{start?:number;end?:number})=>[
          options ? stored.bytes.subarray(options.start??0,(options.end??stored.bytes.length-1)+1) : stored.bytes,
        ],
        delete:async()=>{imageStorage.files.delete(objectPath);},
      };
    }
    async deleteObjectEntity(objectPath:string) {
      if(!imageStorage.files.has(objectPath))throw new ObjectNotFoundError();
      imageStorage.files.delete(objectPath);
      imageStorage.deleted.push(objectPath);
    }
    async saveObjectEntityToNewPath(relativeDir:string,bytes:Buffer,contentType:string) {
      imageStorage.counter+=1;
      const id=`10000000-0000-4000-8000-${String(imageStorage.counter).padStart(12,"0")}`;
      const destination=`/objects/${relativeDir}/${id}`;
      imageStorage.files.set(destination,{mime:contentType,bytes:Buffer.from(bytes)});
      return destination;
    }
    async downloadObject(file:any) {
      const [bytes]=await file.download();
      return new Response(bytes,{headers:{"Content-Type":"image/png"}});
    }
  }
  return {ObjectNotFoundError,ObjectStorageService};
});

function publicApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: vi.fn() }; next(); });
  app.use(publicVisitsRouter);
  return app;
}
function internalApp(authCompanyId = companyId, authUnitId = unitId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).companyId = authCompanyId;
    (req as any).enotaId = authUnitId;
    (req as any).vloga = "admin";
    (req as any).clerkUserId = "stripe-review-test-manager";
    (req as any).log = { error: vi.fn() };
    next();
  });
  app.use(internalVoucherRouter);
  return app;
}

function profileUpdateBody(profile: any) {
  return {
    slug: profile.slug,
    active: profile.active,
    description: profile.description,
    address: profile.address,
    phone: profile.phone,
    email: profile.email,
    website: profile.website,
    primaryColor: profile.primaryColor,
    logoUrl: profile.logoUrl,
    coverImageUrl: profile.coverImageUrl,
    maxPartySize: profile.maxPartySize,
    slotMinutes: profile.slotMinutes,
    slotCapacity: profile.slotCapacity,
    openingHours: profile.openingHours,
    dateExceptions: profile.dateExceptions,
    products: profile.products,
  };
}

beforeAll(async () => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || "public-visits-test-secret";
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_USER = "test";
  process.env.SMTP_PASSWORD = "test";
  process.env.SMTP_FROM = "boni@example.test";
  const [company] = await db.insert(companiesTable).values({ podjetjeDavcna:`SI_PUBLIC_${run}`, naziv:`Javni obisk ${run}` }).returning({id:companiesTable.id});
  companyId = company!.id;
  const [unit] = await db.insert(enoteTable).values({ companyId, ime:`Restavracija ${run}` }).returning({id:enoteTable.id});
  unitId = unit!.id;
  await db.insert(mizeTable).values({ enotaId:unitId, stevilka:1, kapaciteta:4 });
  const client = await (db as any).$client.connect();
  try {
    profileId = (await client.query(`INSERT INTO public_venue_profiles(unit_id,company_id,slug,max_party_size,slot_capacity,opening_hours)
      VALUES($1,$2,$3,8,4,$4::jsonb) RETURNING id`,[unitId,companyId,`venue-${run}`,JSON.stringify([1,2,3,4,5,6,7].map(d=>({dan:d,odprto:true,intervals:[{od:"00:00",do:"23:59"}]})))])).rows[0].id;
  } finally { client.release(); }
});
afterAll(async () => {
  const client=await (db as any).$client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM public_stripe_payment_review_audit
      WHERE review_id IN (SELECT id FROM public_stripe_payment_reviews WHERE company_id=$1)`,[companyId]);
    await client.query("DELETE FROM public_stripe_payment_reviews WHERE company_id=$1",[companyId]);
    await client.query("DELETE FROM public_reservation_audit WHERE reservation_id IN (SELECT id FROM public_reservations WHERE company_id=$1)",[companyId]);
    await client.query("DELETE FROM public_reservations WHERE company_id=$1",[companyId]);
    await client.query("DELETE FROM individual_voucher_movements WHERE company_id=$1",[companyId]);
    await client.query("DELETE FROM individual_vouchers WHERE company_id=$1",[companyId]);
    await client.query("DELETE FROM public_voucher_checkouts WHERE company_id=$1",[companyId]);
    await client.query("DELETE FROM public_voucher_variants WHERE product_id IN (SELECT p.id FROM public_voucher_products p JOIN public_venue_profiles v ON v.id=p.profile_id WHERE v.company_id=$1)",[companyId]);
    await client.query("DELETE FROM public_voucher_products WHERE profile_id IN (SELECT id FROM public_venue_profiles WHERE company_id=$1)",[companyId]);
    await client.query("DELETE FROM public_venue_profiles WHERE company_id=$1",[companyId]);
    await client.query("COMMIT");
  } catch(error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  await db.delete(companiesTable).where(eq(companiesTable.id,companyId));
});

describe("Stripe Connect voucher safeguards", () => {
  it("requires a Standard account in the platform mode and all payment capabilities", () => {
    const ready={id:"acct_ready",type:"standard",details_submitted:true,charges_enabled:true,payouts_enabled:true};
    expect(stripeAccountIsReady(ready,"acct_ready",false,false)).toBe(true);
    expect(stripeAccountIsReady(ready,"acct_other",false,false)).toBe(false);
    expect(stripeAccountIsReady({...ready,payouts_enabled:false},"acct_ready",false,false)).toBe(false);
    expect(stripeAccountIsReady(ready,"acct_ready",true,false)).toBe(false);
    expect(stripeAccountIsReady({...ready,type:"express"},"acct_ready",false,false)).toBe(false);
  });

  it("scopes Stripe idempotency to both the connected account and checkout", () => {
    const first=voucherStripeIdempotencyKey("acct_one","checkout-one",false);
    expect(first).toBe(voucherStripeIdempotencyKey("acct_one","checkout-one",false));
    expect(first).not.toBe(voucherStripeIdempotencyKey("acct_two","checkout-one",false));
    expect(first).not.toBe(voucherStripeIdempotencyKey("acct_one","checkout-two",false));
    expect(first).not.toBe(voucherStripeIdempotencyKey("acct_one","checkout-one",true));
    expect(first).not.toContain("acct_one");
  });

  it("matches webhook ownership only to its immutable account snapshot", () => {
    const checkout={connect_account_id:"acct_merchant",stripe_livemode:true};
    expect(stripeCheckoutEventAccountMatches(checkout,"acct_merchant",true)).toBe(true);
    expect(stripeCheckoutEventAccountMatches(checkout,"acct_other",true)).toBe(false);
    expect(stripeCheckoutEventAccountMatches(checkout,"acct_merchant",false)).toBe(false);
    expect(stripeCheckoutEventAccountMatches(checkout,null,true)).toBe(false);
    expect(stripeCheckoutEventAccountMatches({connect_account_id:null},null,true)).toBe(true);
  });

  it("processes only the configured account's update and deauthorization events", async () => {
    const accountId=`acct_status${run}`;
    await db.execute(sql`INSERT INTO public_company_stripe_connect(
      company_id,account_id,livemode,details_submitted,charges_enabled,payouts_enabled)
      VALUES(${companyId},${accountId},false,true,true,true)
      ON CONFLICT(company_id) DO UPDATE SET account_id=excluded.account_id,livemode=false,
        details_submitted=true,charges_enabled=true,payouts_enabled=true`);
    const updateResponse={statusCode:200,body:undefined as any,status(code:number){this.statusCode=code;return this;},json(body:any){this.body=body;return this;}};
    await processPublicStripeEvent({
      id:`evt_account_updated_${run}`,type:"account.updated",account:accountId,livemode:false,
      data:{object:{id:accountId,type:"standard",details_submitted:true,charges_enabled:false,payouts_enabled:true}},
    } as any,{log:{error:vi.fn(),warn:vi.fn()}},updateResponse,accountId);
    expect(updateResponse.statusCode).toBe(200);
    const updated=(await (db as any).$client.query(
      "SELECT charges_enabled FROM public_company_stripe_connect WHERE company_id=$1",[companyId],
    )).rows[0];
    expect(updated.charges_enabled).toBe(false);

    const mismatch={statusCode:200,body:undefined as any,status(code:number){this.statusCode=code;return this;},json(body:any){this.body=body;return this;}};
    await processPublicStripeEvent({
      id:`evt_other_account_${run}`,type:"account.updated",account:"acct_other",livemode:false,
      data:{object:{id:"acct_other"}},
    } as any,{log:{error:vi.fn(),warn:vi.fn()}},mismatch,"acct_other");
    expect(mismatch.statusCode).toBe(200);
    expect(mismatch.body).toMatchObject({received:true,processed:false,accountMatched:false});

    const disconnect={statusCode:200,body:undefined as any,status(code:number){this.statusCode=code;return this;},json(body:any){this.body=body;return this;}};
    await processPublicStripeEvent({
      id:`evt_account_deauthorized_${run}`,type:"account.application.deauthorized",account:accountId,livemode:false,
      data:{object:{id:"ca_test"}},
    } as any,{log:{error:vi.fn(),warn:vi.fn()}},disconnect,accountId);
    expect(disconnect.statusCode).toBe(200);
    expect((await (db as any).$client.query(
      "SELECT account_id,livemode,charges_enabled FROM public_company_stripe_connect WHERE company_id=$1",[companyId],
    )).rows[0]).toEqual({account_id:null,livemode:null,charges_enabled:false});
  });
});

describe("javni obiski", () => {
  it("vodja uredi javni profil, zaprt dan in ponudbo samo za aktivno enoto", async () => {
    const regularClosedDate="2099-12-28";
    const regularClosedDay=new Date(`${regularClosedDate}T00:00:00.000Z`).getUTCDay()||7;
    const initial=await supertest(internalApp()).get("/javni-profil");
    expect(initial.status,initial.text).toBe(200);
    expect(initial.body).toMatchObject({companyId,unitId,venueName:`Restavracija ${run}`});

    const saved=await supertest(internalApp()).put("/javni-profil").send({
      slug:`venue-${run}`,active:true,description:"Javni opis",address:"Glavna cesta 1",
      phone:"01 234 56 78",email:"info@example.test",website:"https://example.test",
      primaryColor:"#1B3B36",logoUrl:null,coverImageUrl:null,maxPartySize:8,slotMinutes:30,slotCapacity:4,
      openingHours:[1,2,3,4,5,6,7].map(dan=>({dan,odprto:dan!==regularClosedDay,intervals:[{od:"08:00",do:"22:00"}]})),
      dateExceptions:[{datum:"2099-12-25",zaprto:true,intervals:[]}],
      products:[{naziv:"Večerja za dva",opis:"Darilo",imageUrl:null,active:true,
        variants:[{naziv:"50 EUR",amountCents:5000,active:true}]}],
    });
    expect(saved.status,saved.text).toBe(200);
    expect(saved.body).toMatchObject({
      companyId,unitId,description:"Javni opis",
      dateExceptions:[{datum:"2099-12-25",zaprto:true,intervals:[]}],
      products:[{naziv:"Večerja za dva",variants:[{amountCents:5000,active:true}]}],
    });

    const closed=await supertest(publicApp()).get(`/javno/restavracije/venue-${run}/razpolozljivost`)
      .query({datum:"2099-12-25",steviloOseb:2});
    expect(closed.status,closed.text).toBe(200);
    expect(closed.body.slots).toEqual([]);
    const regularClosed=await supertest(publicApp()).get(`/javno/restavracije/venue-${run}/razpolozljivost`)
      .query({datum:regularClosedDate,steviloOseb:2});
    expect(regularClosed.status,regularClosed.text).toBe(200);
    expect(regularClosed.body.slots).toEqual([]);
  });

  it("tuji ID bona ali vrednosti ne more spremeniti ponudbe druge enote", async () => {
    const currentApi=supertest(internalApp());
    const ownSaved=await currentApi.put("/javni-profil").send({
      slug:`venue-${run}`,active:true,description:"Lastni profil",address:"Glavna cesta 1",
      phone:"01 234 56 78",email:"info@example.test",website:"https://example.test",
      primaryColor:"#1B3B36",logoUrl:null,coverImageUrl:null,maxPartySize:8,slotMinutes:30,slotCapacity:4,
      openingHours:[1,2,3,4,5,6,7].map(dan=>({dan,odprto:true,intervals:[{od:"08:00",do:"22:00"}]})),
      dateExceptions:[],
      products:[{naziv:"Lastni bon",opis:"Lastna ponudba",imageUrl:null,active:true,
        variants:[{naziv:"50 EUR",amountCents:5000,active:true}]}],
    });
    expect(ownSaved.status,ownSaved.text).toBe(200);
    const ownBefore=ownSaved.body;
    const ownProduct=ownBefore.products[0];
    const ownVariant=ownProduct.variants[0];

    let foreignCompanyId="";
    let foreignUnitId=0;
    const client=await (db as any).$client.connect();
    try {
      const [foreignCompany]=await db.insert(companiesTable).values({
        podjetjeDavcna:`SI_PUBLIC_FOREIGN_${run}`,
        naziv:`Tuji javni obisk ${run}`,
      }).returning({id:companiesTable.id});
      foreignCompanyId=foreignCompany!.id;
      const [foreignUnit]=await db.insert(enoteTable).values({
        companyId:foreignCompanyId,
        ime:`Tuja restavracija ${run}`,
      }).returning({id:enoteTable.id});
      foreignUnitId=foreignUnit!.id;

      const foreignProfile=(await client.query(`INSERT INTO public_venue_profiles(unit_id,company_id,slug,active,description,max_party_size,slot_minutes,slot_capacity,opening_hours,date_exceptions)
        VALUES($1,$2,$3,true,'Tuji profil',6,30,3,$4::jsonb,'[]'::jsonb) RETURNING id`,
        [foreignUnitId,foreignCompanyId,`foreign-venue-${run}`,JSON.stringify([1,2,3,4,5,6,7].map(dan=>({dan,odprto:true,intervals:[{od:"10:00",do:"20:00"}]})))])).rows[0];
      const foreignProduct=(await client.query(`INSERT INTO public_voucher_products(profile_id,name,description,active)
        VALUES($1,'Tuji bon','Tuja ponudba',true) RETURNING id`,[foreignProfile.id])).rows[0];
      const foreignVariant=(await client.query(`INSERT INTO public_voucher_variants(product_id,name,amount_cents,active)
        VALUES($1,'75 EUR',7500,true) RETURNING id`,[foreignProduct.id])).rows[0];

      const foreignApi=supertest(internalApp(foreignCompanyId,foreignUnitId));
      const foreignBefore=(await foreignApi.get("/javni-profil")).body;

      const foreignProductAttempt=await currentApi.put("/javni-profil").send({
        ...profileUpdateBody(ownBefore),
        description:"Ta sprememba se mora razveljaviti",
        products:[{
          ...ownProduct,
          id:foreignProduct.id,
          naziv:"Poskus spremembe tujega bona",
          variants:[ownVariant],
        }],
      });
      expect(foreignProductAttempt.status,foreignProductAttempt.text).toBe(409);
      expect(foreignProductAttempt.body).toEqual({error:"Bon ne pripada aktivni enoti."});
      expect((await currentApi.get("/javni-profil")).body).toEqual(ownBefore);
      expect((await foreignApi.get("/javni-profil")).body).toEqual(foreignBefore);

      const foreignVariantAttempt=await currentApi.put("/javni-profil").send({
        ...profileUpdateBody(ownBefore),
        description:"Tudi ta sprememba se mora razveljaviti",
        products:[{
          ...ownProduct,
          variants:[{
            ...ownVariant,
            id:foreignVariant.id,
            naziv:"Poskus spremembe tuje vrednosti",
          }],
        }],
      });
      expect(foreignVariantAttempt.status,foreignVariantAttempt.text).toBe(409);
      expect(foreignVariantAttempt.body).toEqual({error:"Vrednost bona ne pripada aktivni enoti."});
      expect((await currentApi.get("/javni-profil")).body).toEqual(ownBefore);
      expect((await foreignApi.get("/javni-profil")).body).toEqual(foreignBefore);

      const validAfterRejections=await currentApi.put("/javni-profil").send({
        ...profileUpdateBody(ownBefore),
        description:"Lastni profil po zavrnitvah",
      });
      expect(validAfterRejections.status,validAfterRejections.text).toBe(200);
      expect(validAfterRejections.body).toMatchObject({
        companyId,
        unitId,
        description:"Lastni profil po zavrnitvah",
        products:[{id:ownProduct.id,naziv:"Lastni bon",variants:[{id:ownVariant.id,amountCents:5000}]}],
      });
      expect((await foreignApi.get("/javni-profil")).body).toEqual(foreignBefore);
    } finally {
      if(foreignCompanyId){
        await client.query("DELETE FROM public_voucher_variants WHERE product_id IN (SELECT p.id FROM public_voucher_products p JOIN public_venue_profiles v ON v.id=p.profile_id WHERE v.company_id=$1)",[foreignCompanyId]);
        await client.query("DELETE FROM public_voucher_products WHERE profile_id IN (SELECT id FROM public_venue_profiles WHERE company_id=$1)",[foreignCompanyId]);
        await client.query("DELETE FROM public_venue_profiles WHERE company_id=$1",[foreignCompanyId]);
        await db.delete(companiesTable).where(eq(companiesTable.id,foreignCompanyId));
      }
      client.release();
    }
  });

  it("ID bona ali vrednosti druge enote istega podjetja ostane izoliran", async () => {
    const firstApi=supertest(internalApp());
    const firstSaved=await firstApi.put("/javni-profil").send({
      slug:`venue-${run}`,active:true,description:"Prva enota pred preizkusom",address:"Glavna cesta 1",
      phone:"01 234 56 78",email:"info@example.test",website:"https://example.test",
      primaryColor:"#1B3B36",logoUrl:null,coverImageUrl:null,maxPartySize:8,slotMinutes:30,slotCapacity:4,
      openingHours:[1,2,3,4,5,6,7].map(dan=>({dan,odprto:true,intervals:[{od:"08:00",do:"22:00"}]})),
      dateExceptions:[],
      products:[{naziv:"Bon prve enote",opis:"Prva ponudba",imageUrl:null,active:true,
        variants:[{naziv:"50 EUR",amountCents:5000,active:true}]}],
    });
    expect(firstSaved.status,firstSaved.text).toBe(200);
    const firstBefore=firstSaved.body;
    const firstProduct=firstBefore.products[0];
    const firstVariant=firstProduct.variants[0];

    let secondUnitId=0;
    const client=await (db as any).$client.connect();
    try {
      const [secondUnit]=await db.insert(enoteTable).values({
        companyId,
        ime:`Druga restavracija ${run}`,
      }).returning({id:enoteTable.id});
      secondUnitId=secondUnit!.id;
      const secondProfile=(await client.query(`INSERT INTO public_venue_profiles(unit_id,company_id,slug,active,description,max_party_size,slot_minutes,slot_capacity,opening_hours,date_exceptions)
        VALUES($1,$2,$3,true,'Druga enota pred preizkusom',6,30,3,$4::jsonb,'[]'::jsonb) RETURNING id`,
        [secondUnitId,companyId,`second-venue-${run}`,JSON.stringify([1,2,3,4,5,6,7].map(dan=>({dan,odprto:true,intervals:[{od:"10:00",do:"20:00"}]})))])).rows[0];
      const secondProduct=(await client.query(`INSERT INTO public_voucher_products(profile_id,name,description,active)
        VALUES($1,'Bon druge enote','Druga ponudba',true) RETURNING id`,[secondProfile.id])).rows[0];
      const secondVariant=(await client.query(`INSERT INTO public_voucher_variants(product_id,name,amount_cents,active)
        VALUES($1,'75 EUR',7500,true) RETURNING id`,[secondProduct.id])).rows[0];

      const secondApi=supertest(internalApp(companyId,secondUnitId));
      const secondBefore=(await secondApi.get("/javni-profil")).body;

      const secondProductAttempt=await firstApi.put("/javni-profil").send({
        ...profileUpdateBody(firstBefore),
        description:"Nedovoljena sprememba prve enote",
        products:[{
          ...firstProduct,
          id:secondProduct.id,
          naziv:"Poskus spremembe bona druge enote",
          variants:[firstVariant],
        }],
      });
      expect(secondProductAttempt.status,secondProductAttempt.text).toBe(409);
      expect(secondProductAttempt.body).toEqual({error:"Bon ne pripada aktivni enoti."});
      expect((await firstApi.get("/javni-profil")).body).toEqual(firstBefore);
      expect((await secondApi.get("/javni-profil")).body).toEqual(secondBefore);

      const secondVariantAttempt=await firstApi.put("/javni-profil").send({
        ...profileUpdateBody(firstBefore),
        description:"Tudi ta sprememba se mora razveljaviti",
        products:[{
          ...firstProduct,
          variants:[{
            ...firstVariant,
            id:secondVariant.id,
            naziv:"Poskus spremembe vrednosti druge enote",
          }],
        }],
      });
      expect(secondVariantAttempt.status,secondVariantAttempt.text).toBe(409);
      expect(secondVariantAttempt.body).toEqual({error:"Vrednost bona ne pripada aktivni enoti."});
      expect((await firstApi.get("/javni-profil")).body).toEqual(firstBefore);
      expect((await secondApi.get("/javni-profil")).body).toEqual(secondBefore);

      const validAfterRejections=await firstApi.put("/javni-profil").send({
        ...profileUpdateBody(firstBefore),
        description:"Prva enota po zavrnitvah",
      });
      expect(validAfterRejections.status,validAfterRejections.text).toBe(200);
      expect(validAfterRejections.body).toMatchObject({
        companyId,
        unitId,
        description:"Prva enota po zavrnitvah",
        products:[{id:firstProduct.id,naziv:"Bon prve enote",variants:[{id:firstVariant.id,amountCents:5000}]}],
      });
      expect((await secondApi.get("/javni-profil")).body).toEqual(secondBefore);
    } finally {
      if(secondUnitId){
        await client.query("DELETE FROM public_voucher_variants WHERE product_id IN (SELECT p.id FROM public_voucher_products p JOIN public_venue_profiles v ON v.id=p.profile_id WHERE v.unit_id=$1)",[secondUnitId]);
        await client.query("DELETE FROM public_voucher_products WHERE profile_id IN (SELECT id FROM public_venue_profiles WHERE unit_id=$1)",[secondUnitId]);
        await client.query("DELETE FROM public_venue_profiles WHERE unit_id=$1",[secondUnitId]);
        await client.query("DELETE FROM enote WHERE id=$1 AND company_id=$2",[secondUnitId,companyId]);
      }
      client.release();
    }
  });

  it("ob zavrnitvi tujega bona odstrani novo kopijo slike in ohrani začasno ter veljavno sliko", async () => {
    const firstApi=supertest(internalApp());
    const current=(await firstApi.get("/javni-profil")).body;
    const sourceCanvas=createCanvas(600,400);
    const sourceContext=sourceCanvas.getContext("2d");
    sourceContext.fillStyle="#9A3412";
    sourceContext.fillRect(0,0,600,400);
    const sourcePng=sourceCanvas.encodeSync("png");
    const existingImagePath=`/objects/uploads/public-profile/${companyId}/${unitId}/${randomUUID()}`;
    imageStorage.files.set(existingImagePath,{mime:"image/png",bytes:sourcePng});
    const firstSaved=await firstApi.put("/javni-profil").send({
      ...profileUpdateBody(current),
      description:"Profil z veljavno sliko",
      products:current.products.map((product:any,index:number)=>({
        ...product,
        imageUrl:index===0?existingImagePath:product.imageUrl,
      })),
    });
    expect(firstSaved.status,firstSaved.text).toBe(200);
    const firstBefore=firstSaved.body;
    const firstProduct=firstBefore.products[0];
    const firstVariant=firstProduct.variants[0];
    const existingBytes=Buffer.from(imageStorage.files.get(existingImagePath)!.bytes);

    let secondUnitId=0;
    const client=await (db as any).$client.connect();
    try {
      const [secondUnit]=await db.insert(enoteTable).values({
        companyId,
        ime:`Druga slikovna restavracija ${run}`,
      }).returning({id:enoteTable.id});
      secondUnitId=secondUnit!.id;
      const secondProfile=(await client.query(`INSERT INTO public_venue_profiles(unit_id,company_id,slug,active,description,max_party_size,slot_minutes,slot_capacity,opening_hours,date_exceptions)
        VALUES($1,$2,$3,true,'Drugi slikovni profil',6,30,3,$4::jsonb,'[]'::jsonb) RETURNING id`,
        [secondUnitId,companyId,`second-image-venue-${run}`,JSON.stringify([1,2,3,4,5,6,7].map(dan=>({dan,odprto:true,intervals:[{od:"10:00",do:"20:00"}]})))])).rows[0];
      const secondProduct=(await client.query(`INSERT INTO public_voucher_products(profile_id,name,description,active)
        VALUES($1,'Tuji slikovni bon','Druga ponudba',true) RETURNING id`,[secondProfile.id])).rows[0];
      const secondVariant=(await client.query(`INSERT INTO public_voucher_variants(product_id,name,amount_cents,active)
        VALUES($1,'75 EUR',7500,true) RETURNING id`,[secondProduct.id])).rows[0];
      const secondApi=supertest(internalApp(companyId,secondUnitId));
      const secondBefore=(await secondApi.get("/javni-profil")).body;

      const upload=await firstApi.post("/javni-profil/slike/upload-url").send({
        name:"nova-slika.png",
        size:sourcePng.length,
        contentType:"image/png",
      });
      expect(upload.status,upload.text).toBe(200);
      const stagingPath=upload.body.objectPath as string;
      imageStorage.files.set(stagingPath,{mime:"image/png",bytes:sourcePng});
      const pathsBefore=new Set(imageStorage.files.keys());
      const deletedBefore=imageStorage.deleted.length;

      const productAttempt=await firstApi.put("/javni-profil").send({
        ...profileUpdateBody(firstBefore),
        description:"Ta profil se ne sme spremeniti",
        products:[{
          ...firstProduct,
          id:secondProduct.id,
          imageUrl:stagingPath,
          variants:[firstVariant],
        }],
      });
      expect(productAttempt.status,productAttempt.text).toBe(409);
      expect(productAttempt.body).toEqual({error:"Bon ne pripada aktivni enoti."});
      expect(new Set(imageStorage.files.keys())).toEqual(pathsBefore);
      expect(imageStorage.files.has(stagingPath)).toBe(true);
      expect(imageStorage.files.get(existingImagePath)?.bytes).toEqual(existingBytes);
      expect(imageStorage.deleted.slice(deletedBefore)).toHaveLength(1);
      expect(imageStorage.deleted.at(-1)).toContain(`/public-profile/${companyId}/${unitId}/`);
      expect((await firstApi.get("/javni-profil")).body).toEqual(firstBefore);
      expect((await secondApi.get("/javni-profil")).body).toEqual(secondBefore);

      const deletedAfterProduct=imageStorage.deleted.length;
      const variantAttempt=await firstApi.put("/javni-profil").send({
        ...profileUpdateBody(firstBefore),
        description:"Tudi ta profil se ne sme spremeniti",
        products:[{
          ...firstProduct,
          imageUrl:stagingPath,
          variants:[{
            ...firstVariant,
            id:secondVariant.id,
          }],
        }],
      });
      expect(variantAttempt.status,variantAttempt.text).toBe(409);
      expect(variantAttempt.body).toEqual({error:"Vrednost bona ne pripada aktivni enoti."});
      expect(new Set(imageStorage.files.keys())).toEqual(pathsBefore);
      expect(imageStorage.files.has(stagingPath)).toBe(true);
      expect(imageStorage.files.get(existingImagePath)?.bytes).toEqual(existingBytes);
      expect(imageStorage.deleted.slice(deletedAfterProduct)).toHaveLength(1);
      expect(imageStorage.deleted.at(-1)).toContain(`/public-profile/${companyId}/${unitId}/`);
      expect((await firstApi.get("/javni-profil")).body).toEqual(firstBefore);
      expect((await secondApi.get("/javni-profil")).body).toEqual(secondBefore);
    } finally {
      if(secondUnitId){
        await client.query("DELETE FROM public_voucher_variants WHERE product_id IN (SELECT p.id FROM public_voucher_products p JOIN public_venue_profiles v ON v.id=p.profile_id WHERE v.unit_id=$1)",[secondUnitId]);
        await client.query("DELETE FROM public_voucher_products WHERE profile_id IN (SELECT id FROM public_venue_profiles WHERE unit_id=$1)",[secondUnitId]);
        await client.query("DELETE FROM public_venue_profiles WHERE unit_id=$1",[secondUnitId]);
        await client.query("DELETE FROM enote WHERE id=$1 AND company_id=$2",[secondUnitId,companyId]);
      }
      client.release();
    }
  });

  it("slike varno naloži za aktivno enoto, javno prikaže ter po zamenjavi in odstranitvi počisti", async () => {
    const api=supertest(internalApp());
    const sourceCanvas=createCanvas(2400,1600);
    const sourceContext=sourceCanvas.getContext("2d");
    sourceContext.fillStyle="#1B3B36";
    sourceContext.fillRect(0,0,2400,1600);
    const sourcePng=sourceCanvas.encodeSync("png");
    expect((await api.post("/javni-profil/slike/upload-url").send({
      name:"virus.svg",size:100,contentType:"image/svg+xml",
    })).status).toBe(400);

    const requestUpload=async()=>{
      const response=await api.post("/javni-profil/slike/upload-url").send({
        name:"slika.png",size:1024,contentType:"image/png",
      });
      expect(response.status,response.text).toBe(200);
      expect(response.body.objectPath).toContain(`/public-profile-staging/${companyId}/${unitId}/`);
      imageStorage.files.set(response.body.objectPath,{
        mime:"image/png",
        bytes:sourcePng,
      });
      return response.body.objectPath as string;
    };
    const current=(await api.get("/javni-profil")).body;
    const spoofedPath=await requestUpload();
    imageStorage.files.set(spoofedPath,{mime:"image/png",bytes:Buffer.from("not-an-image")});
    const spoofed=await api.put("/javni-profil").send({...current,logoUrl:spoofedPath});
    expect(spoofed.status).toBe(409);
    await api.delete(`/javni-profil/slike/${spoofedPath.split("/").at(-1)}`);

    const firstPath=await requestUpload();
    const coverPath=await requestUpload();
    const productPath=await requestUpload();
    const firstSave=await api.put("/javni-profil").send({
      ...current,
      logoUrl:firstPath,
      coverImageUrl:coverPath,
      products:current.products.map((product:any,index:number)=>({
        ...product,
        imageUrl:index===0?productPath:product.imageUrl,
      })),
    });
    expect(firstSave.status,firstSave.text).toBe(200);
    expect(firstSave.body.logoUrl).not.toBe(firstPath);
    expect(firstSave.body.logoUrl).toContain(`/public-profile/${companyId}/${unitId}/`);
    expect(firstSave.body.coverImageUrl).not.toBe(coverPath);
    expect(firstSave.body.products[0].imageUrl).not.toBe(productPath);
    const optimizedLogo=await loadImage(imageStorage.files.get(firstSave.body.logoUrl)!.bytes);
    const optimizedCover=await loadImage(imageStorage.files.get(firstSave.body.coverImageUrl)!.bytes);
    const optimizedVoucher=await loadImage(imageStorage.files.get(firstSave.body.products[0].imageUrl)!.bytes);
    expect([optimizedLogo.width,optimizedLogo.height]).toEqual([512,341]);
    expect([optimizedCover.width,optimizedCover.height]).toEqual([1620,1080]);
    expect([optimizedVoucher.width,optimizedVoucher.height]).toEqual([960,640]);

    const firstId=firstSave.body.logoUrl.split("/").at(-1);
    const publicImage=await supertest(publicApp()).get(`/javno/slike/${firstId}`);
    expect(publicImage.status,publicImage.text).toBe(200);
    expect(publicImage.headers["content-type"]).toContain("image/webp");
    expect(publicImage.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(publicImage.headers["x-content-type-options"]).toBe("nosniff");

    imageStorage.files.set(firstPath,{mime:"text/html",bytes:Buffer.from("<script>alert(1)</script>")});
    const replayedStagingUpload=await supertest(publicApp()).get(`/javno/slike/${firstId}`);
    expect(replayedStagingUpload.status).toBe(200);

    imageStorage.files.set(firstSave.body.logoUrl,{mime:"text/html",bytes:Buffer.from("<script>alert(1)</script>")});
    const tamperedPublishedImage=await supertest(publicApp()).get(`/javno/slike/${firstId}`);
    expect(tamperedPublishedImage.status).toBe(404);
    imageStorage.files.set(firstSave.body.logoUrl,{
      mime:"image/png",
      bytes:Buffer.concat([
        Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
        Buffer.alloc(5*1024*1024),
      ]),
    });
    const oversizedPublishedImage=await supertest(publicApp()).get(`/javno/slike/${firstId}`);
    expect(oversizedPublishedImage.status).toBe(404);

    const secondPath=await requestUpload();
    const secondSave=await api.put("/javni-profil").send({...firstSave.body,logoUrl:secondPath});
    expect(secondSave.status,secondSave.text).toBe(200);
    expect(imageStorage.deleted).toContain(firstSave.body.logoUrl);
    expect(imageStorage.files.has(firstSave.body.logoUrl)).toBe(false);

    const foreignPath=`/objects/uploads/public-profile/${randomUUID()}/${unitId}/${randomUUID()}`;
    imageStorage.files.set(foreignPath,{
      mime:"image/png",
      bytes:Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    });
    const foreign=await api.put("/javni-profil").send({...secondSave.body,logoUrl:foreignPath});
    expect(foreign.status).toBe(409);
    expect(imageStorage.files.has(foreignPath)).toBe(true);

    const removed=await api.put("/javni-profil").send({
      ...secondSave.body,
      logoUrl:null,
      coverImageUrl:null,
      products:secondSave.body.products.map((product:any)=>({...product,imageUrl:null})),
    });
    expect(removed.status,removed.text).toBe(200);
    expect(imageStorage.deleted).toContain(secondSave.body.logoUrl);
    expect(imageStorage.deleted).toContain(firstSave.body.coverImageUrl);
    expect(imageStorage.deleted).toContain(firstSave.body.products[0].imageUrl);
    expect(removed.body.logoUrl).toBeNull();
  });

  it("po začasni napaki ponovno pošlje isti bon brez nove izdaje ali spremembe salda", async () => {
    sendMail.mockRejectedValueOnce(new Error("Začasna SMTP napaka")).mockResolvedValueOnce({ messageId: "sent" });
    const sessionId=`cs_retry_${run}`;
    const eventId=`evt_retry_${run}`;
    const client=await (db as any).$client.connect();
    let checkoutId="";
    try {
      checkoutId=(await client.query(`INSERT INTO public_voucher_checkouts(
        profile_id,company_id,unit_id,idempotency_key,stripe_session_id,expected_amount_cents,
        buyer_name,buyer_email,recipient_name,recipient_email,items,privacy_accepted_at,status,payment_status)
        VALUES($1,$2,$3,$4,$5,5000,'Kupec','k@example.test','Gost','g@example.test',
          $6::jsonb,now(),'open','unpaid') RETURNING id`,
        [profileId,companyId,unitId,`retry-${run}`,sessionId,JSON.stringify([{variantId:randomUUID(),quantity:1,amountCents:5000,currency:"EUR"}])])).rows[0].id;
    } finally { client.release(); }

    const response = {
      statusCode: 200,
      body: undefined as any,
      status(code:number){this.statusCode=code;return this;},
      json(body:any){this.body=body;return this;},
    };
    await processPublicStripeEvent({
      id:eventId,type:"checkout.session.completed",
      data:{object:{id:sessionId,payment_status:"paid",currency:"eur",amount_total:5000,metadata:{checkout_id:checkoutId,company_id:companyId,unit_id:String(unitId)}}},
    } as any,{log:{error:vi.fn()}},response);
    expect(response.statusCode).toBe(503);

    const failed=await (db as any).$client.query(`
      SELECT v.id,v.delivery_status,v.delivery_attempts,
        (SELECT count(*)::int FROM individual_voucher_movements m WHERE m.voucher_id=v.id) movement_count,
        (SELECT sum(CASE WHEN m.type IN ('issue','reverse') THEN m.amount_cents ELSE -m.amount_cents END)::int
          FROM individual_voucher_movements m WHERE m.voucher_id=v.id) balance
      FROM individual_vouchers v WHERE v.checkout_id=$1`,[checkoutId]);
    expect(failed.rows[0]).toMatchObject({delivery_status:"failed",delivery_attempts:1,movement_count:1,balance:5000});
    const voucherId=failed.rows[0].id;

    const retry=await supertest(internalApp()).post(`/darilni-boni/individualni/dostave/${checkoutId}/ponovi`);
    expect(retry.status,retry.text).toBe(200);
    expect(retry.body.deliveryStatus).toBe("sent");
    const after=await (db as any).$client.query(`
      SELECT v.id,v.delivery_status,v.delivery_attempts,
        (SELECT count(*)::int FROM individual_voucher_movements m WHERE m.voucher_id=v.id) movement_count,
        (SELECT sum(CASE WHEN m.type IN ('issue','reverse') THEN m.amount_cents ELSE -m.amount_cents END)::int
          FROM individual_voucher_movements m WHERE m.voucher_id=v.id) balance
      FROM individual_vouchers v WHERE v.checkout_id=$1`,[checkoutId]);
    expect(after.rows[0]).toMatchObject({id:voucherId,delivery_status:"sent",delivery_attempts:2,movement_count:1,balance:5000});

    const list=await supertest(internalApp()).get("/darilni-boni/individualni/dostave");
    expect(list.status).toBe(200);
    expect(list.body).toEqual(expect.arrayContaining([
      expect.objectContaining({checkoutId,deliveryStatus:"sent",deliveryAttempts:2,voucherCount:1}),
    ]));
  });

  it("platform webhook ne izda bona za checkout, ki je posnet na Stripe Connect račun", async () => {
    sendMail.mockResolvedValue({messageId:"connect-sent"});
    const sessionId=`cs_connect_${run}`;
    const client=await (db as any).$client.connect();
    let checkoutId="";
    const connectedAccountId=`acct_merchant${run}`;
    try{
      checkoutId=(await client.query(`INSERT INTO public_voucher_checkouts(
        profile_id,company_id,unit_id,idempotency_key,stripe_session_id,expected_amount_cents,
        buyer_name,buyer_email,recipient_name,recipient_email,items,privacy_accepted_at,status,payment_status,
        connect_account_id,stripe_livemode,stripe_idempotency_key)
        VALUES($1,$2,$3,$4,$5,5000,'Kupec','k@example.test','Gost','g@example.test',
          $6::jsonb,now(),'open','unpaid',$7,false,'test-idempotency') RETURNING id`,
      [profileId,companyId,unitId,`connect-${run}`,sessionId,JSON.stringify([{variantId:randomUUID(),quantity:1,amountCents:5000,currency:"EUR"}]),connectedAccountId])).rows[0].id;
    }finally{client.release();}

    const eventPayload=(id:string,account:string|null)=>({
      id,type:"checkout.session.completed",livemode:false,...(account?{account}:{}),
      data:{object:{id:sessionId,payment_status:"paid",currency:"eur",amount_total:5000,
        metadata:{checkout_id:checkoutId,company_id:companyId,unit_id:String(unitId)}}},
    });
    const platformResponse={statusCode:200,body:undefined as any,status(code:number){this.statusCode=code;return this;},json(body:any){this.body=body;return this;}};
    await processPublicStripeEvent(eventPayload(`evt_platform_connect_${run}`,null) as any,{log:{error:vi.fn(),warn:vi.fn()}},platformResponse);
    expect(platformResponse.statusCode).toBe(409);
    expect(Number((await (db as any).$client.query(
      "SELECT count(*)::int AS count FROM individual_vouchers WHERE checkout_id=$1",[checkoutId],
    )).rows[0].count)).toBe(0);

    const connectResponse={statusCode:200,body:undefined as any,status(code:number){this.statusCode=code;return this;},json(body:any){this.body=body;return this;}};
    await processPublicStripeEvent(eventPayload(`evt_connect_match_${run}`,connectedAccountId) as any,{log:{error:vi.fn(),warn:vi.fn(),info:vi.fn()}},connectResponse,connectedAccountId);
    expect(connectResponse.statusCode).toBe(200);
    expect(connectResponse.body).toMatchObject({received:true,processed:true});
    expect(Number((await (db as any).$client.query(
      "SELECT count(*)::int AS count FROM individual_vouchers WHERE checkout_id=$1",[checkoutId],
    )).rows[0].count)).toBe(1);
    const secondSuccess={statusCode:200,body:undefined as any,status(code:number){this.statusCode=code;return this;},json(body:any){this.body=body;return this;}};
    await processPublicStripeEvent({
      ...eventPayload(`evt_connect_async_${run}`,connectedAccountId),
      type:"checkout.session.async_payment_succeeded",
    } as any,{log:{error:vi.fn(),warn:vi.fn(),info:vi.fn()}},secondSuccess,connectedAccountId);
    expect(secondSuccess.statusCode).toBe(200);
    expect(secondSuccess.body).toMatchObject({received:true,processed:false});
    expect(Number((await (db as any).$client.query(
      "SELECT count(*)::int AS count FROM individual_vouchers WHERE checkout_id=$1",[checkoutId],
    )).rows[0].count)).toBe(1);
  });

  it("po petem neuspehu ustvari eno opozorilo in ga uspešna ročna dostava reši", async () => {
    sendMail.mockReset();
    sendMail.mockRejectedValue(new Error("SMTP trajno nedosegljiv"));
    const sessionId=`cs_alert_${run}`;
    const eventId=`evt_alert_${run}`;
    const client=await (db as any).$client.connect();
    let checkoutId="";
    try {
      checkoutId=(await client.query(`INSERT INTO public_voucher_checkouts(
        profile_id,company_id,unit_id,idempotency_key,stripe_session_id,expected_amount_cents,
        buyer_name,buyer_email,recipient_name,recipient_email,items,privacy_accepted_at,status,payment_status)
        VALUES($1,$2,$3,$4,$5,7000,'Kupec','k@example.test','Prejemnik opozorila','prejemnik@example.test',
          $6::jsonb,now(),'open','unpaid') RETURNING id`,
        [profileId,companyId,unitId,`alert-${run}`,sessionId,JSON.stringify([{variantId:randomUUID(),quantity:1,amountCents:7000,currency:"EUR"}])])).rows[0].id;
    } finally { client.release(); }

    const response = {
      statusCode: 200,
      body: undefined as any,
      status(code:number){this.statusCode=code;return this;},
      json(body:any){this.body=body;return this;},
    };
    await processPublicStripeEvent({
      id:eventId,type:"checkout.session.completed",
      data:{object:{id:sessionId,payment_status:"paid",currency:"eur",amount_total:7000,metadata:{checkout_id:checkoutId,company_id:companyId,unit_id:String(unitId)}}},
    } as any,{log:{error:vi.fn()}},response);
    expect(response.statusCode).toBe(503);

    const api=supertest(internalApp());
    for(let attempt=2;attempt<=5;attempt++){
      const retry=await api.post(`/darilni-boni/individualni/dostave/${checkoutId}/ponovi`);
      expect(retry.status,retry.text).toBe(503);
    }
    const alerts=await api.get("/darilni-boni/individualni/dostave/opozorila");
    expect(alerts.status,alerts.text).toBe(200);
    expect(alerts.body).toEqual([
      expect.objectContaining({
        checkoutId,
        recipientName:"Prejemnik opozorila",
        recipientEmail:"prejemnik@example.test",
        lastError:"SMTP trajno nedosegljiv",
        retryPath:`/darilni-boni/individualni/dostave/${checkoutId}/ponovi`,
      }),
    ]);

    await processPendingVoucherDeliveries();
    const alertRows=await (db as any).$client.query(
      "SELECT count(*)::int AS count FROM voucher_delivery_alerts WHERE checkout_id=$1",
      [checkoutId],
    );
    expect(alertRows.rows[0].count).toBe(1);

    sendMail.mockReset();
    sendMail.mockResolvedValueOnce({messageId:"resolved"});
    const resolved=await api.post(`/darilni-boni/individualni/dostave/${checkoutId}/ponovi`);
    expect(resolved.status,resolved.text).toBe(200);
    const noAlerts=await api.get("/darilni-boni/individualni/dostave/opozorila");
    expect(noAlerts.status,noAlerts.text).toBe(200);
    expect(noAlerts.body).toEqual([]);
    const resolution=await (db as any).$client.query(
      "SELECT resolved_at IS NOT NULL AS resolved FROM voucher_delivery_alerts WHERE checkout_id=$1",
      [checkoutId],
    );
    expect(resolution.rows[0].resolved).toBe(true);
  });

  it("samodejne ponovitve spoštujejo razmike, enojni prevzem in omejitev petih poskusov", async () => {
    expect([1,2,3,4,5].map(voucherDeliveryRetryDelayMinutes)).toEqual([1,5,30,120,720]);
    sendMail.mockReset();
    sendMail.mockRejectedValue(new Error("Nadzorovana SMTP napaka"));
    const sessionId=`cs_schedule_${run}`;
    const eventId=`evt_schedule_${run}`;
    const client=await (db as any).$client.connect();
    let checkoutId="";
    try {
      checkoutId=(await client.query(`INSERT INTO public_voucher_checkouts(
        profile_id,company_id,unit_id,idempotency_key,stripe_session_id,expected_amount_cents,
        buyer_name,buyer_email,recipient_name,recipient_email,items,privacy_accepted_at,status,payment_status)
        VALUES($1,$2,$3,$4,$5,9000,'Kupec','k@example.test','Prejemnik urnika','urnik@example.test',
          $6::jsonb,now(),'open','unpaid') RETURNING id`,
        [profileId,companyId,unitId,`schedule-${run}`,sessionId,JSON.stringify([{variantId:randomUUID(),quantity:1,amountCents:9000,currency:"EUR"}])])).rows[0].id;
    } finally { client.release(); }

    const response = {
      statusCode: 200,
      body: undefined as any,
      status(code:number){this.statusCode=code;return this;},
      json(body:any){this.body=body;return this;},
    };
    await processPublicStripeEvent({
      id:eventId,type:"checkout.session.completed",
      data:{object:{id:sessionId,payment_status:"paid",currency:"eur",amount_total:9000,metadata:{checkout_id:checkoutId,company_id:companyId,unit_id:String(unitId)}}},
    } as any,{log:{error:vi.fn()}},response);
    expect(response.statusCode).toBe(503);

    const state=async()=>(
      await (db as any).$client.query(`SELECT delivery_attempts,delivery_status,
        delivery_last_attempt_at,delivery_next_attempt_at
        FROM individual_vouchers WHERE checkout_id=$1`,[checkoutId])
    ).rows[0];
    let delivery=await state();
    expect(delivery.delivery_attempts).toBe(1);
    expect(new Date(delivery.delivery_next_attempt_at).getTime()-new Date(delivery.delivery_last_attempt_at).getTime()).toBe(60_000);

    const firstDue=new Date(delivery.delivery_next_attempt_at);
    expect(await processPendingVoucherDeliveries(1,new Date(firstDue.getTime()-1))).toBe(0);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const concurrent=await Promise.all([
      processPendingVoucherDeliveries(1,firstDue),
      processPendingVoucherDeliveries(1,firstDue),
    ]);
    expect(concurrent.sort()).toEqual([0,1]);
    expect(sendMail).toHaveBeenCalledTimes(2);

    for(const [attempt,delayMinutes] of [[2,5],[3,30],[4,120]] as const){
      delivery=await state();
      expect(delivery.delivery_attempts).toBe(attempt);
      const attemptedAt=new Date(delivery.delivery_last_attempt_at);
      const nextAt=new Date(delivery.delivery_next_attempt_at);
      expect(nextAt.getTime()-attemptedAt.getTime()).toBe(delayMinutes*60_000);
      expect(await processPendingVoucherDeliveries(1,new Date(nextAt.getTime()-1))).toBe(0);
      expect(await processPendingVoucherDeliveries(1,nextAt)).toBe(1);
    }

    delivery=await state();
    expect(delivery).toMatchObject({delivery_attempts:5,delivery_status:"failed",delivery_next_attempt_at:null});
    const fifthAttemptAt=new Date(delivery.delivery_last_attempt_at);
    expect(await processPendingVoucherDeliveries(1,new Date(fifthAttemptAt.getTime()+720*60_000))).toBe(0);
    expect(await processPendingVoucherDeliveries(1,new Date(fifthAttemptAt.getTime()+30*24*60*60_000))).toBe(0);
    expect(sendMail).toHaveBeenCalledTimes(5);

    sendMail.mockReset();
    sendMail.mockResolvedValueOnce({messageId:"manual-after-limit"});
    const manual=await supertest(internalApp()).post(`/darilni-boni/individualni/dostave/${checkoutId}/ponovi`);
    expect(manual.status,manual.text).toBe(200);
    expect(manual.body.deliveryStatus).toBe("sent");
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("poslovno zavrnjeno podpisano Stripe plačilo shrani enkrat in ga ročno reši brez izdaje bona", async () => {
    const sessionId=`cs_review_${run}`;
    const eventId=`evt_review_${run}`;
    const client=await (db as any).$client.connect();
    let checkoutId="";
    try {
      checkoutId=(await client.query(`INSERT INTO public_voucher_checkouts(
        profile_id,company_id,unit_id,idempotency_key,stripe_session_id,expected_amount_cents,
        buyer_name,buyer_email,recipient_name,recipient_email,items,privacy_accepted_at,status,payment_status)
        VALUES($1,$2,$3,$4,$5,5000,'Kupec','k@example.test','Prejemnik pregleda','pregled@example.test',
          $6::jsonb,now(),'open','unpaid') RETURNING id`,
        [profileId,companyId,unitId,`review-${run}`,sessionId,JSON.stringify([{variantId:randomUUID(),quantity:1,amountCents:5000,currency:"EUR"}])])).rows[0].id;
    } finally { client.release(); }
    const event={
      id:eventId,type:"checkout.session.completed",
      data:{object:{id:sessionId,payment_status:"paid",currency:"eur",amount_total:5100,
        metadata:{checkout_id:checkoutId,company_id:companyId,unit_id:String(unitId)}}},
    };
    const makeResponse=()=>({
      statusCode:200,body:undefined as any,
      status(code:number){this.statusCode=code;return this;},
      json(body:any){this.body=body;return this;},
    });
    const rejected=makeResponse();
    await processPublicStripeEvent(event as any,{log:{error:vi.fn()}},rejected);
    expect(rejected.statusCode).toBe(409);
    expect(rejected.body.error).toBe("Plačilo zahteva ročno uskladitev.");

    const api=supertest(internalApp());
    const list=await api.get("/darilni-boni/individualni/stripe-pregledi");
    expect(list.status,list.text).toBe(200);
    expect(list.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId,sessionId,checkoutId,companyId,unitId,
        reasonCode:"amount_mismatch",
        expectedAmountCents:5000,receivedAmountCents:5100,
        expectedCurrency:"EUR",receivedCurrency:"EUR",
      }),
    ]));
    const reviewId=list.body.find((review:any)=>review.eventId===eventId).id;

    const repeated=makeResponse();
    await processPublicStripeEvent(event as any,{log:{error:vi.fn()}},repeated);
    expect(repeated.statusCode).toBe(200);
    const duplicateCount=await (db as any).$client.query(
      "SELECT count(*)::int count FROM public_stripe_payment_reviews WHERE event_id=$1",
      [eventId],
    );
    expect(duplicateCount.rows[0].count).toBe(1);

    const resolved=await api.post(`/darilni-boni/individualni/stripe-pregledi/${reviewId}/resi`)
      .send({note:"Plačilo preverjeno v Stripe; bon ni bil izdan."});
    expect(resolved.status,resolved.text).toBe(200);
    expect(resolved.body.status).toBe("resolved");
    expect((await api.get("/darilni-boni/individualni/stripe-pregledi")).body
      .filter((review:any)=>review.eventId===eventId)).toEqual([]);

    const evidence=await (db as any).$client.query(`
      SELECT
        (SELECT count(*)::int FROM individual_vouchers WHERE checkout_id=$1) voucher_count,
        (SELECT count(*)::int FROM individual_voucher_movements m
          JOIN individual_vouchers v ON v.id=m.voucher_id WHERE v.checkout_id=$1) movement_count,
        (SELECT array_agg(action ORDER BY id) FROM public_stripe_payment_review_audit WHERE review_id=$2) audit_actions,
        (SELECT resolved_by FROM public_stripe_payment_reviews WHERE id=$2) resolved_by
    `,[checkoutId,reviewId]);
    expect(evidence.rows[0]).toMatchObject({
      voucher_count:0,movement_count:0,
      audit_actions:["created","resolved"],
      resolved_by:"stripe-review-test-manager",
    });
  });

  it("lokalni termin Europe/Ljubljana pravilno pretvori pozimi in poleti", () => {
    expect(startsAt(new Date("2027-01-15"),"12:00")?.toISOString()).toBe("2027-01-15T11:00:00.000Z");
    expect(startsAt(new Date("2027-07-15"),"12:00")?.toISOString()).toBe("2027-07-15T10:00:00.000Z");
  });

  it("ne dovoli neposredne rezervacije zunaj odpiralnega časa", async () => {
    const client=await (db as any).$client.connect();
    try{await client.query("UPDATE public_venue_profiles SET opening_hours=$1::jsonb WHERE id=$2",[JSON.stringify([1,2,3,4,5,6,7].map(d=>({dan:d,odprto:true,intervals:[{od:"18:00",do:"19:00"}]}))),profileId]);}finally{client.release();}
    const response=await supertest(publicApp()).post(`/javno/restavracije/venue-${run}/rezervacije`).send({
      idempotencyKey:randomUUID(),steviloOseb:2,datum:new Date(Date.now()+36*60*60*1000).toISOString(),cas:"12:00",
      ime:"Gost",email:"gost@example.test",telefon:"040000000",privacyAccepted:true,
    });
    expect(response.status).toBe(409);
    const restore=await (db as any).$client.connect();
    try{await restore.query("UPDATE public_venue_profiles SET opening_hours=$1::jsonb WHERE id=$2",[JSON.stringify([1,2,3,4,5,6,7].map(d=>({dan:d,odprto:true,intervals:[{od:"00:00",do:"23:59"}]}))),profileId]);}finally{restore.release();}
  });

  it("pri sočasni rezervaciji iste zmogljivosti sprejme le eno zahtevo", async () => {
    const tomorrow = new Date(Date.now()+36*60*60*1000);
    const payload = (key:string) => ({
      idempotencyKey:key,steviloOseb:4,datum:tomorrow.toISOString(),cas:"12:00",
      ime:"Gost",email:"gost@example.test",telefon:"040000000",privacyAccepted:true,
    });
    const api=supertest(publicApp());
    const results=await Promise.all([
      api.post(`/javno/restavracije/venue-${run}/rezervacije`).send(payload(randomUUID())),
      api.post(`/javno/restavracije/venue-${run}/rezervacije`).send(payload(randomUUID())),
    ]);
    expect(results.map(x=>x.status).sort()).toEqual([201,409]);
  });

  it("delno unovčenje je atomsko, idempotentno in ne dovoli prekoračitve", async () => {
    const code=`BON-${run}-SECRET`;
    const client=await (db as any).$client.connect();
    try {
      const checkout=(await client.query(`INSERT INTO public_voucher_checkouts(profile_id,company_id,unit_id,idempotency_key,expected_amount_cents,buyer_name,buyer_email,recipient_name,recipient_email,items,privacy_accepted_at,status,payment_status)
        VALUES($1,$2,$3,$4,5000,'Kupec','k@example.test','Gost','g@example.test','[]',now(),'complete','paid') RETURNING id`,[profileId,companyId,unitId,`checkout-${run}`])).rows[0];
      const voucher=(await client.query(`INSERT INTO individual_vouchers(checkout_id,company_id,unit_id,code_hash,code_suffix,initial_amount_cents,recipient_name,recipient_email)
        VALUES($1,$2,$3,$4,$5,5000,'Gost','g@example.test') RETURNING id`,[checkout.id,companyId,unitId,createHash("sha256").update(code).digest("hex"),code.slice(-6)])).rows[0];
      await client.query(`INSERT INTO individual_voucher_movements(voucher_id,company_id,operation_key,type,amount_cents) VALUES($1,$2,'issue','issue',5000)`,[voucher.id,companyId]);
    } finally { client.release(); }
    const api=supertest(internalApp());
    const [a,b]=await Promise.all([
      api.post("/darilni-boni/individualni/unovci").send({code,operationKey:`redeem-a-${run}`,amountCents:3000}),
      api.post("/darilni-boni/individualni/unovci").send({code,operationKey:`redeem-b-${run}`,amountCents:3000}),
    ]);
    expect([a.status,b.status].sort()).toEqual([200,409]);
    const winner=a.status===200?a:b;
    const winnerKey=a.status===200?`redeem-a-${run}`:`redeem-b-${run}`;
    const replay=await api.post("/darilni-boni/individualni/unovci").send({code,operationKey:winnerKey,amountCents:3000});
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent).toBe(true);
    expect(replay.body.balanceCents).toBe(2000);
  });
});