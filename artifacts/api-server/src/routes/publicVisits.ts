import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  CancelJavnaRezervacijaParams,
  CreateJavnaRezervacijaBody,
  CreateJavnaRezervacijaParams,
  CreateJavniBonCheckoutBody,
  CreateJavniBonCheckoutParams,
  GetJavnaRazpolozljivostParams,
  GetJavnaRazpolozljivostQueryParams,
  GetJavnaRestavracijaParams,
  GetJavnaRezervacijaParams,
  GetJavniBonCheckoutParams,
  HandleJavniStripeWebhookBody,
  ListJavniBoniParams,
  RequestJavniProfilImageUploadBody,
  UpdateJavniProfilNastavitveBody,
} from "@workspace/api-zod";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import type Stripe from "stripe";
import { logPublicStripeWebhookFailure } from "../lib/logger";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import {
  createPublicProfileImageVariant,
  type PublicProfileImagePurpose,
} from "../lib/publicProfileImageVariants";

export const publicVisitsRouter = Router();
export const internalVoucherRouter = Router();
const publicProfileStorage = new ObjectStorageService();
const PUBLIC_PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PUBLIC_PROFILE_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const rate = new Map<string, { count: number; reset: number }>();
function publicLimit(req: any, res: any, next: any) {
  const key = String(req.ip ?? "unknown");
  const now = Date.now();
  const current = rate.get(key);
  const item = !current || current.reset < now ? { count: 1, reset: now + 60_000 } : { ...current, count: current.count + 1 };
  rate.set(key, item);
  if (item.count > 60) return res.status(429).json({ error: "Preveč zahtev. Poskusite znova čez minuto." });
  next();
}
publicVisitsRouter.use("/javno/restavracije", publicLimit);

function rows(result: any): any[] { return result.rows ?? result; }
function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
function credentialKey(purpose:string) {
  const secret=process.env.SESSION_SECRET;
  if(!secret) throw new Error("SESSION_SECRET je obvezen za šifriranje javnih poverilnic.");
  return createHash("sha256").update(`public-visits:v1:${purpose}:${secret}`).digest();
}
function encryptCode(code: string,purpose="voucher") {
  const key = credentialKey(purpose);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
function decryptCode(value: string,purpose="voucher") {
  const bytes=Buffer.from(value,"base64"), key=credentialKey(purpose);
  const decipher=createDecipheriv("aes-256-gcm",key,bytes.subarray(0,12));
  decipher.setAuthTag(bytes.subarray(12,28));
  return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString("utf8");
}
const UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fingerprint(value:unknown){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
function publicProfileImagePrefix(companyId:string,unitId:number){
  return `/objects/uploads/public-profile/${companyId}/${unitId}/`;
}
function publicProfileImageStagingPrefix(companyId:string,unitId:number){
  return `/objects/uploads/public-profile-staging/${companyId}/${unitId}/`;
}
function publicProfileImageObjectId(value:unknown){
  if(typeof value!=="string"||!value.startsWith("/objects/uploads/public-profile/"))return null;
  const objectId=value.split("/").at(-1)??"";
  return UUID_V4.test(objectId)?objectId:null;
}
function publicProfileStagingObjectId(value:unknown){
  if(typeof value!=="string"||!value.startsWith("/objects/uploads/public-profile-staging/"))return null;
  const objectId=value.split("/").at(-1)??"";
  return UUID_V4.test(objectId)?objectId:null;
}
function publicProfileImageUrl(value:unknown){
  const objectId=publicProfileImageObjectId(value);
  return objectId?`/api/javno/slike/${objectId}`:value;
}
function hasImageMagic(bytes:Buffer,mime:string){
  if(mime==="image/jpeg")return bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  if(mime==="image/png")return bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if(mime==="image/webp")return bytes.length>=12&&bytes.subarray(0,4).toString("ascii")==="RIFF"&&bytes.subarray(8,12).toString("ascii")==="WEBP";
  return false;
}
async function validatePublicProfileImage(value:string|null|undefined,companyId:string,unitId:number){
  if(!value)return;
  if(/^https?:\/\//i.test(value))return;
  const ownedPublished=value.startsWith(publicProfileImagePrefix(companyId,unitId))&&publicProfileImageObjectId(value);
  const ownedStaging=value.startsWith(publicProfileImageStagingPrefix(companyId,unitId))&&publicProfileStagingObjectId(value);
  if(!ownedPublished&&!ownedStaging){
    throw new Error("Slika ne pripada aktivni enoti.");
  }
  await validateStoredPublicProfileImage(value);
}
async function validateStoredPublicProfileImage(value:string){
  const file=await publicProfileStorage.getObjectEntityFile(value);
  const [metadata]=await file.getMetadata();
  const mime=String(metadata.contentType??"").toLowerCase();
  const size=Number(metadata.size??0);
  if(!PUBLIC_PROFILE_IMAGE_MIME.has(mime)||!Number.isFinite(size)||size<1||size>PUBLIC_PROFILE_IMAGE_MAX_BYTES){
    throw new Error("Slika mora biti JPG, PNG ali WEBP in velika največ 5 MB.");
  }
  const [header]=await file.download({start:0,end:15});
  if(!hasImageMagic(header,mime))throw new Error("Vsebina datoteke se ne ujema z dovoljeno vrsto slike.");
  return {file,mime,size};
}
async function deletePublicProfileImageIfUnused(objectPath:string,companyId:string,unitId:number){
  if(!objectPath.startsWith(publicProfileImagePrefix(companyId,unitId)))return false;
  const used=rows(await db.execute(sql`
    SELECT EXISTS(
      SELECT 1 FROM public_venue_profiles WHERE logo_url=${objectPath} OR cover_image_url=${objectPath}
      UNION ALL
      SELECT 1 FROM public_voucher_products WHERE image_url=${objectPath}
    ) AS used
  `))[0]?.used;
  if(used)return false;
  try{
    await publicProfileStorage.deleteObjectEntity(objectPath);
  }catch(error){
    if(error instanceof ObjectNotFoundError)return false;
    throw error;
  }
  return true;
}
async function voucherPdf(venue: string, recipient: string, codes: Array<{ code: string; amount: number }>) {
  const doc = new PDFDocument({ size: "A4", margin: 54 });
  const chunks: Buffer[] = [];
  doc.on("data", chunk => chunks.push(Buffer.from(chunk)));
  const done = new Promise<Buffer>((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  doc.fontSize(14).fillColor("#1B3B36").text("BOOKIE DARILNI BON");
  doc.moveDown(2).fontSize(30).text(venue);
  doc.moveDown().fontSize(14).fillColor("#333333").text(`Za: ${recipient}`);
  for (const item of codes) {
    doc.moveDown(1.5).fontSize(12).text("Koda bona").fontSize(22).text(item.code, { characterSpacing: 1.5 });
    doc.fontSize(14).text(`Vrednost: ${(item.amount / 100).toLocaleString("sl-SI", { style: "currency", currency: "EUR" })}`);
  }
  doc.moveDown(2).fontSize(10).fillColor("#666666").text("Bon lahko uporabite delno. Preostala vrednost ostane na isti kodi.");
  doc.end();
  return done;
}
const VOUCHER_DELIVERY_MAX_ATTEMPTS = 5;
const VOUCHER_DELIVERY_RETRY_MINUTES = [1, 5, 30, 120, 720] as const;
export function voucherDeliveryRetryDelayMinutes(attempt: number) {
  return VOUCHER_DELIVERY_RETRY_MINUTES[
    Math.min(Math.max(1, attempt) - 1, VOUCHER_DELIVERY_RETRY_MINUTES.length - 1)
  ]!;
}

type ClaimedVoucherDelivery = {
  checkout: any;
  venueName: string;
  claimToken: string;
  issued: Array<{ id: string; code: string; amount: number }>;
  attempt: number;
  attemptedAt: Date;
};

async function claimVoucherDelivery(
  checkoutId?: string,
  manual = false,
  companyId?: string,
  attemptedAt = new Date(),
): Promise<ClaimedVoucherDelivery | null> {
  const client = await (db as any).$client.connect();
  try {
    await client.query("BEGIN");
    const checkout = (await client.query(`
      SELECT c.*, e.ime AS venue_name
      FROM public_voucher_checkouts c
      JOIN enote e ON e.id = c.unit_id
      WHERE c.status = 'complete' AND c.payment_status = 'paid'
        AND ($1::uuid IS NULL OR c.id = $1)
        AND ($2::uuid IS NULL OR c.company_id = $2)
        AND EXISTS (
          SELECT 1 FROM individual_vouchers v
          WHERE v.checkout_id = c.id AND v.delivery_status <> 'sent'
            AND v.code_encrypted IS NOT NULL
            AND (
              v.delivery_claimed_at IS NULL OR v.delivery_claimed_at < $5::timestamptz - interval '10 minutes'
            )
            AND (
              $3::boolean OR (
                v.delivery_attempts < $4
                AND (v.delivery_next_attempt_at IS NULL OR v.delivery_next_attempt_at <= $5::timestamptz)
              )
            )
        )
      ORDER BY c.created_at
      FOR UPDATE OF c SKIP LOCKED
      LIMIT 1
    `, [checkoutId ?? null, companyId ?? null, manual, VOUCHER_DELIVERY_MAX_ATTEMPTS, attemptedAt])).rows[0];
    if (!checkout) {
      await client.query("ROLLBACK");
      return null;
    }
    const vouchers = (await client.query(`
      SELECT id, code_encrypted, initial_amount_cents, delivery_attempts
      FROM individual_vouchers
      WHERE checkout_id = $1 AND delivery_status <> 'sent'
      FOR UPDATE
    `, [checkout.id])).rows;
    if (!vouchers.length) {
      await client.query("ROLLBACK");
      return null;
    }
    const claimToken = randomBytes(16).toString("hex");
    await client.query(`
      UPDATE individual_vouchers
      SET delivery_status='sending', delivery_claim_token=$2, delivery_claimed_at=$3,
          delivery_last_attempt_at=$3, delivery_next_attempt_at=NULL,
          delivery_attempts=delivery_attempts+1
      WHERE checkout_id=$1 AND delivery_status<>'sent'
    `, [checkout.id, claimToken, attemptedAt]);
    await client.query("COMMIT");
    return {
      checkout,
      venueName: checkout.venue_name,
      claimToken,
      attempt: Math.max(...vouchers.map((v: any) => Number(v.delivery_attempts))) + 1,
      attemptedAt,
      issued: vouchers.map((v: any) => ({
        id: v.id,
        code: decryptCode(v.code_encrypted),
        amount: Number(v.initial_amount_cents),
      })),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deliverClaimedVouchers(claimed: ClaimedVoucherDelivery) {
  const { checkout, venueName, issued, claimToken, attempt, attemptedAt } = claimed;
  const host=process.env.SMTP_HOST, user=process.env.SMTP_USER, password=process.env.SMTP_PASSWORD, from=process.env.SMTP_FROM;
  try {
    if (!host || !user || !password || !from) throw new Error("SMTP dostava ni nastavljena.");
    const pdf = await voucherPdf(venueName, checkout.recipient_name, issued);
    const transporter = nodemailer.createTransport({ host, port:Number(process.env.SMTP_PORT ?? 587), secure:Number(process.env.SMTP_PORT)===465, auth:{user,pass:password} });
    await transporter.sendMail({ from, to:checkout.recipient_email, subject:`Darilni bon – ${venueName}`, text:`Pozdravljeni ${checkout.recipient_name}, v priponki je vaš darilni bon.`, attachments:[{filename:"darilni-bon.pdf",content:pdf,contentType:"application/pdf"}] });
    const client = await (db as any).$client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE individual_vouchers
        SET delivery_status='sent',delivered_at=now(),delivery_error=NULL,
            delivery_next_attempt_at=NULL,delivery_claim_token=NULL,delivery_claimed_at=NULL
        WHERE delivery_claim_token=$1`, [claimToken]);
      await client.query(`UPDATE voucher_delivery_alerts
        SET resolved_at=COALESCE(resolved_at,now()),updated_at=now()
        WHERE checkout_id=$1 AND resolved_at IS NULL`, [checkout.id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0,500) : "Neznana napaka";
    const delayMinutes = voucherDeliveryRetryDelayMinutes(attempt);
    const client = await (db as any).$client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE individual_vouchers
        SET delivery_status='failed',delivery_error=$2,
            delivery_next_attempt_at=CASE WHEN delivery_attempts < $3
              THEN $5::timestamptz + ($4::text || ' minutes')::interval ELSE NULL END,
            delivery_claim_token=NULL,delivery_claimed_at=NULL
        WHERE delivery_claim_token=$1`, [claimToken, message, VOUCHER_DELIVERY_MAX_ATTEMPTS, delayMinutes, attemptedAt]);
      if (attempt >= VOUCHER_DELIVERY_MAX_ATTEMPTS) {
        await client.query(`INSERT INTO voucher_delivery_alerts(checkout_id,company_id,unit_id,last_error)
          VALUES($1,$2,$3,$4)
          ON CONFLICT(checkout_id) DO UPDATE
          SET last_error=EXCLUDED.last_error,updated_at=now()`,
        [checkout.id, checkout.company_id, checkout.unit_id, message]);
      }
      await client.query("COMMIT");
    } catch (dbError) {
      await client.query("ROLLBACK");
      throw dbError;
    } finally {
      client.release();
    }
    return false;
  }
}

export async function attemptVoucherDelivery(
  checkoutId: string,
  options: { manual?: boolean; companyId?: string; now?: Date } = {},
) {
  const claimed = await claimVoucherDelivery(checkoutId, options.manual === true, options.companyId, options.now);
  if (!claimed) return { attempted: false, delivered: false };
  return { attempted: true, delivered: await deliverClaimedVouchers(claimed) };
}

export async function processPendingVoucherDeliveries(limit = 10, now = new Date()) {
  let processed = 0;
  for (; processed < limit; processed++) {
    const claimed = await claimVoucherDelivery(undefined, false, undefined, now);
    if (!claimed) break;
    await deliverClaimedVouchers(claimed);
  }
  return processed;
}

let voucherDeliveryRetryStarted = false;
export function startVoucherDeliveryRetryScheduler() {
  if (voucherDeliveryRetryStarted) return;
  voucherDeliveryRetryStarted = true;
  const run = () => { void processPendingVoucherDeliveries().catch((error) => console.error("Voucher delivery retry failed", error)); };
  run();
  setInterval(run, 60_000).unref();
}
function datePart(value: Date) { return value.toISOString().slice(0, 10); }
export function startsAt(datum: Date, cas: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(cas)) return null;
  const [year,month,day]=datePart(datum).split("-").map(Number),[hour,minute]=cas.split(":").map(Number);
  const target=Date.UTC(year,month-1,day,hour,minute);
  let utc=target;
  for(let i=0;i<2;i++){
    const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Ljubljana",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(utc)).map(x=>[x.type,x.value]));
    const shown=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute));
    utc+=target-shown;
  }
  const parsed=new Date(utc);
  const check=parsed.toLocaleString("sv-SE",{timeZone:"Europe/Ljubljana",hour12:false}).slice(0,16).replace(" ","T");
  return check===`${datePart(datum)}T${cas}`?parsed:null;
}
function reservationDto(row: any, token: string) {
  const start = new Date(row.starts_at);
  return {
    id: row.id, status: row.status, managementToken: token,
    steviloOseb: row.party_size, datum: datePart(start), cas: start.toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Ljubljana" }),
    ime: row.guest_name, email: row.email, telefon: row.phone, opomba: row.note,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    cancelledAt: row.cancelled_at?.toISOString?.() ?? row.cancelled_at,
  };
}

async function profileBySlug(slug: string) {
  return rows(await db.execute(sql`
    SELECT p.*, e.ime FROM public_venue_profiles p
    JOIN enote e ON e.id = p.unit_id
    WHERE p.slug = ${slug} AND p.active = true AND e.aktiven = true LIMIT 1
  `))[0];
}

function normalizeSlug(value:string){
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80)||"restavracija";
}
function validIntervals(intervals:any[]){
  return intervals.every(x=>typeof x?.od==="string"&&typeof x?.do==="string"&&x.od<x.do);
}
function effectiveSchedule(profile:any,date:Date){
  const key=date.toISOString().slice(0,10);
  const exception=(profile.date_exceptions as any[]).find(x=>x.datum===key);
  if(exception)return {odprto:!exception.zaprto,intervals:exception.zaprto?[]:exception.intervals};
  const day=date.getUTCDay()||7;
  return (profile.opening_hours as any[]).find(x=>Number(x.dan)===day);
}

publicVisitsRouter.get("/javno/slike/:objectId",async(req,res):Promise<any>=>{
  const objectId=String(req.params.objectId??"");
  if(!UUID_V4.test(objectId))return res.status(404).json({error:"Slika ni najdena."});
  const match=rows(await db.execute(sql`
    SELECT image_path FROM (
      SELECT logo_url AS image_path FROM public_venue_profiles WHERE logo_url LIKE ${`%/${objectId}`}
      UNION ALL
      SELECT cover_image_url AS image_path FROM public_venue_profiles WHERE cover_image_url LIKE ${`%/${objectId}`}
      UNION ALL
      SELECT image_url AS image_path FROM public_voucher_products WHERE image_url LIKE ${`%/${objectId}`}
    ) images LIMIT 1
  `))[0]?.image_path;
  if(!publicProfileImageObjectId(match))return res.status(404).json({error:"Slika ni najdena."});
  try{
    const {file,mime,size}=await validateStoredPublicProfileImage(match);
    const response=await publicProfileStorage.downloadObject(file,3600);
    res.status(response.status);
    response.headers.forEach((value,key)=>res.setHeader(key,value));
    res.setHeader("Content-Type",mime);
    res.setHeader("Content-Length",String(size));
    res.setHeader("Cache-Control","public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options","nosniff");
    if(response.body)Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);else res.end();
  }catch(error){
    if(error instanceof ObjectNotFoundError||error instanceof Error)return res.status(404).json({error:"Slika ni najdena."});
    req.log.error({err:error},"Serving public profile image failed");
    return res.status(500).json({error:"Slike ni mogoče prikazati."});
  }
});

publicVisitsRouter.get("/javno/restavracije/:slug", async (req, res): Promise<any> => {
  const parsed = GetJavnaRestavracijaParams.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ error: "Neveljaven naslov restavracije." });
  const p = await profileBySlug(parsed.data.slug);
  if (!p) return res.status(404).json({ error: "Restavracija ni najdena." });
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({
    slug: p.slug, ime: p.ime, opis: p.description,
    branding: { primaryColor: p.primary_color, logoUrl: publicProfileImageUrl(p.logo_url), coverImageUrl: publicProfileImageUrl(p.cover_image_url) },
    kontakt: { telefon: p.phone, email: p.email, spletnaStran: p.website },
    openingHours: p.opening_hours, maxPartySize: p.max_party_size, naslov: p.address, aktivna: p.active,
  });
});

publicVisitsRouter.get("/javno/restavracije/:slug/razpolozljivost", async (req, res): Promise<any> => {
  const path = GetJavnaRazpolozljivostParams.safeParse(req.params);
  const query = GetJavnaRazpolozljivostQueryParams.safeParse({
    ...req.query,
    datum: new Date(String(req.query.datum ?? "")),
  });
  if (!path.success || !query.success) return res.status(400).json({ error: "Datum ali število oseb ni veljavno." });
  const p = await profileBySlug(path.data.slug);
  if (!p) return res.status(404).json({ error: "Restavracija ni najdena." });
  if (query.data.steviloOseb > p.max_party_size) return res.json({ datum: query.data.datum, steviloOseb: query.data.steviloOseb, slots: [] });
  const schedule = effectiveSchedule(p,query.data.datum);
  const slots: any[] = [];
  if(!schedule?.odprto){
    res.setHeader("Cache-Control","no-store");
    return res.json({datum:query.data.datum,steviloOseb:query.data.steviloOseb,slots});
  }
  for (const interval of schedule?.intervals ?? []) {
    let [h, m] = String(interval.od).split(":").map(Number);
    const [eh, em] = String(interval.do).split(":").map(Number);
    for (let minute = h * 60 + m; minute < eh * 60 + em; minute += p.slot_minutes) {
      const cas = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      const start = startsAt(query.data.datum, cas)!;
      const used = Number(rows(await db.execute(sql`
        SELECT COALESCE(sum(party_size),0)::int AS used FROM public_reservations
        WHERE unit_id=${p.unit_id} AND starts_at=${start} AND status IN ('pending','confirmed')
      `))[0]?.used ?? 0);
      const table = rows(await db.execute(sql`
        SELECT id FROM mize m WHERE m.enota_id=${p.unit_id} AND COALESCE(m.arhivirana,false)=false
        AND m.kapaciteta >= ${query.data.steviloOseb}
        AND NOT EXISTS (SELECT 1 FROM rezervacije_miz r WHERE r.miza_id=m.id AND r.status='aktivna'
          AND abs(extract(epoch from (r.zacetek-${start}))) < 10800) LIMIT 1
      `))[0];
      const remaining = Math.max(0, p.slot_capacity - used);
      slots.push({ cas, naVoljo: start > new Date() && remaining >= query.data.steviloOseb && Boolean(table), preostalo: remaining });
    }
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ datum: query.data.datum, steviloOseb: query.data.steviloOseb, slots });
});

publicVisitsRouter.post("/javno/restavracije/:slug/rezervacije", async (req, res): Promise<any> => {
  const path = CreateJavnaRezervacijaParams.safeParse(req.params);
  const body = CreateJavnaRezervacijaBody.safeParse(req.body);
  if (!path.success || !body.success || body.data.privacyAccepted !== true) return res.status(400).json({ error: "Podatki rezervacije niso veljavni." });
  const p = await profileBySlug(path.data.slug);
  const start = startsAt(body.data.datum, body.data.cas);
  if (!p || !start) return res.status(p ? 400 : 404).json({ error: p ? "Termin ni veljaven." : "Restavracija ni najdena." });
  if (body.data.steviloOseb > p.max_party_size || start <= new Date()) return res.status(409).json({ error: "Izbrani termin ni na voljo." });
  if (!UUID_V4.test(body.data.idempotencyKey)) return res.status(400).json({ error:"Varnostni ključ zahteve ni veljaven." });
  const requestFingerprint=fingerprint(body.data);
  let token = randomBytes(32).toString("base64url");
  const client = await (db as any).$client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM public_venue_profiles WHERE id=$1 FOR UPDATE", [p.id]);
    const schedule=effectiveSchedule(p,body.data.datum);
    if(!schedule?.odprto||!schedule.intervals?.some((x:any)=>body.data.cas>=x.od&&body.data.cas<x.do)){await client.query("ROLLBACK");return res.status(409).json({error:"Restavracija je ob tem času zaprta."});}
    const existing = (await client.query("SELECT * FROM public_reservations WHERE profile_id=$1 AND idempotency_key=$2", [p.id, body.data.idempotencyKey])).rows[0];
    if (existing) {
      if(existing.request_fingerprint!==requestFingerprint){await client.query("ROLLBACK");return res.status(409).json({error:"Ključ zahteve je že uporabljen z drugimi podatki."});}
      token=existing.management_token_encrypted ? decryptCode(existing.management_token_encrypted,"reservation") : "";
      await client.query("COMMIT");
      if(!token) return res.status(409).json({error:"Rezervacija s tem ključem že obstaja."});
      return res.status(200).json(reservationDto(existing, token));
    }
    const used = Number((await client.query("SELECT COALESCE(sum(party_size),0)::int used FROM public_reservations WHERE unit_id=$1 AND starts_at=$2 AND status IN ('pending','confirmed')", [p.unit_id, start])).rows[0].used);
    if (used + body.data.steviloOseb > p.slot_capacity) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Termin se je pravkar zapolnil." }); }
    const table = (await client.query(`
      SELECT id, stevilka, ime FROM mize m WHERE enota_id=$1 AND COALESCE(arhivirana,false)=false AND kapaciteta >= $2
      AND NOT EXISTS (SELECT 1 FROM rezervacije_miz r WHERE r.miza_id=m.id AND r.status='aktivna'
        AND abs(extract(epoch from (r.zacetek-$3::timestamptz))) < 10800)
      ORDER BY kapaciteta, id FOR UPDATE SKIP LOCKED LIMIT 1`, [p.unit_id, body.data.steviloOseb, start])).rows[0];
    if (!table) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Za ta termin ni proste mize." }); }
    const posReservation=(await client.query(`INSERT INTO rezervacije_miz(enota_id,miza_id,miza_stevilka_snapshot,miza_ime_snapshot,stranka_ime,telefon,opomba,zacetek,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'aktivna') RETURNING id`, [p.unit_id, table.id, table.stevilka, table.ime, body.data.ime, body.data.telefon, body.data.opomba, start])).rows[0];
    const inserted = (await client.query(`INSERT INTO public_reservations(profile_id,company_id,unit_id,table_id,reservation_row_id,idempotency_key,request_fingerprint,management_token_hash,management_token_encrypted,party_size,starts_at,guest_name,email,phone,note,privacy_accepted_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now()) RETURNING *`,
      [p.id,p.company_id,p.unit_id,table.id,posReservation.id,body.data.idempotencyKey,requestFingerprint,hashToken(token),encryptCode(token,"reservation"),body.data.steviloOseb,start,body.data.ime,body.data.email,body.data.telefon,body.data.opomba])).rows[0];
    await client.query("INSERT INTO public_reservation_audit(reservation_id,event_type,data) VALUES($1,'public_created',$2)", [inserted.id, JSON.stringify({ partySize: body.data.steviloOseb, startsAt: start })]);
    await client.query("COMMIT");
    res.status(201).json(reservationDto(inserted, token));
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ err: error }, "Public reservation failed");
    res.status(500).json({ error: "Rezervacije ni bilo mogoče shraniti." });
  } finally { client.release(); }
});

async function managedReservation(slug: string, token: string) {
  return rows(await db.execute(sql`SELECT r.* FROM public_reservations r JOIN public_venue_profiles p ON p.id=r.profile_id
    WHERE p.slug=${slug} AND r.management_token_hash=${hashToken(token)} LIMIT 1`))[0];
}
publicVisitsRouter.get("/javno/restavracije/:slug/rezervacije/:managementToken", async (req, res): Promise<any> => {
  const parsed = GetJavnaRezervacijaParams.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: "Rezervacija ni najdena." });
  const row = await managedReservation(parsed.data.slug, parsed.data.managementToken);
  if (!row) return res.status(404).json({ error: "Rezervacija ni najdena." });
  res.setHeader("Cache-Control", "no-store");
  res.json(reservationDto(row, parsed.data.managementToken));
});
publicVisitsRouter.delete("/javno/restavracije/:slug/rezervacije/:managementToken", async (req, res): Promise<any> => {
  const parsed = CancelJavnaRezervacijaParams.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: "Rezervacija ni najdena." });
  const row = await managedReservation(parsed.data.slug, parsed.data.managementToken);
  if (!row) return res.status(404).json({ error: "Rezervacija ni najdena." });
  const client=await (db as any).$client.connect();
  try{
    await client.query("BEGIN");
    const updated=(await client.query("UPDATE public_reservations SET status='cancelled',cancelled_at=now() WHERE id=$1 AND status IN ('pending','confirmed') RETURNING *",[row.id])).rows[0];
    if(updated){
      if(updated.reservation_row_id) await client.query("UPDATE rezervacije_miz SET status='sprostena',sproscena=now() WHERE id=$1 AND status='aktivna'",[updated.reservation_row_id]);
      await client.query("INSERT INTO public_reservation_audit(reservation_id,event_type,data) VALUES($1,'public_cancelled','{}')",[row.id]);
    }
    await client.query("COMMIT");
    res.json(reservationDto(updated??row,parsed.data.managementToken));
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
});

publicVisitsRouter.get("/javno/restavracije/:slug/boni", async (req, res): Promise<any> => {
  const parsed = ListJavniBoniParams.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ error: "Neveljaven naslov." });
  const p = await profileBySlug(parsed.data.slug);
  if (!p) return res.status(404).json({ error: "Restavracija ni najdena." });
  const products = rows(await db.execute(sql`SELECT id,name,description,image_url,active FROM public_voucher_products WHERE profile_id=${p.id} AND active=true ORDER BY name`));
  for (const product of products) product.variants = rows(await db.execute(sql`SELECT id,name,amount_cents,currency,active FROM public_voucher_variants WHERE product_id=${product.id} AND active=true ORDER BY amount_cents`));
  res.json({ products: products.map(x => ({ id:x.id,naziv:x.name,opis:x.description,imageUrl:publicProfileImageUrl(x.image_url),active:x.active,variants:x.variants.map((v:any)=>({id:v.id,naziv:v.name,amountCents:v.amount_cents,currency:v.currency,active:v.active})) })) });
});

publicVisitsRouter.post("/javno/restavracije/:slug/boni/checkout", async (req, res): Promise<any> => {
  const path = CreateJavniBonCheckoutParams.safeParse(req.params);
  const body = CreateJavniBonCheckoutBody.safeParse(req.body);
  if (!path.success || !body.success || body.data.privacyAccepted !== true) return res.status(400).json({ error: "Podatki nakupa niso veljavni." });
  const p = await profileBySlug(path.data.slug);
  if (!p) return res.status(404).json({ error: "Restavracija ni najdena." });
  const variantIds = body.data.items.map(x => x.variantId);
  const variants = rows(await db.execute(sql`SELECT v.*,p.name product_name FROM public_voucher_variants v JOIN public_voucher_products p ON p.id=v.product_id
    WHERE v.id=ANY(${variantIds}::uuid[]) AND p.profile_id=${p.id} AND v.active=true AND p.active=true`));
  if (variants.length !== new Set(variantIds).size) return res.status(400).json({ error: "Izbrani bon ni več na voljo." });
  if(!UUID_V4.test(body.data.idempotencyKey))return res.status(400).json({error:"Varnostni ključ zahteve ni veljaven."});
  const byId = new Map(variants.map(v => [v.id, v]));
  const total = body.data.items.reduce((s, x) => s + Number(byId.get(x.variantId)!.amount_cents) * x.quantity, 0);
  const itemSnapshot=body.data.items.map(x=>({variantId:x.variantId,quantity:x.quantity,amountCents:Number(byId.get(x.variantId)!.amount_cents),currency:String(byId.get(x.variantId)!.currency),name:`${byId.get(x.variantId)!.product_name} – ${byId.get(x.variantId)!.name}`}));
  const requestFingerprint=fingerprint({
    buyerIme:body.data.buyerIme,buyerEmail:body.data.buyerEmail,
    recipientIme:body.data.recipientIme,recipientEmail:body.data.recipientEmail,
    sporocilo:body.data.sporocilo??null,
    items:body.data.items.map(x=>({productId:x.productId,variantId:x.variantId,quantity:x.quantity})),
  });
  const inserted = rows(await db.execute(sql`INSERT INTO public_voucher_checkouts(profile_id,company_id,unit_id,idempotency_key,request_fingerprint,expected_amount_cents,buyer_name,buyer_email,recipient_name,recipient_email,message,items,privacy_accepted_at)
    VALUES(${p.id},${p.company_id},${p.unit_id},${body.data.idempotencyKey},${requestFingerprint},${total},${body.data.buyerIme},${body.data.buyerEmail},${body.data.recipientIme},${body.data.recipientEmail},${body.data.sporocilo ?? null},${JSON.stringify(itemSnapshot)}::jsonb,now())
    ON CONFLICT(profile_id,idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key RETURNING *`))[0];
  if(inserted.request_fingerprint!==requestFingerprint)return res.status(409).json({error:"Ključ zahteve je že uporabljen z drugimi podatki."});
  if (inserted.stripe_session_id) return res.json({ sessionId: inserted.stripe_session_id, checkoutUrl: inserted.checkout_url, status: inserted.status, expiresAt: null });
  const claimToken=randomBytes(16).toString("hex");
  const claimed=rows(await db.execute(sql`UPDATE public_voucher_checkouts SET creation_token=${claimToken},creation_started_at=now()
    WHERE id=${inserted.id} AND stripe_session_id IS NULL AND (creation_token IS NULL OR creation_started_at < now()-interval '2 minutes') RETURNING id`))[0];
  if(!claimed)return res.status(409).json({error:"Plačilna seja se že ustvarja. Poskusite znova."});
  const publicHost=(process.env.PUBLIC_APP_ORIGIN??(process.env.REPLIT_DOMAINS?`https://${process.env.REPLIT_DOMAINS.split(",")[0]}`:"")).replace(/\/$/,"");
  if(!publicHost)return res.status(503).json({error:"Javni naslov aplikacije ni nastavljen."});
  try {
    const stripe=await getUncachableStripeClient();
    const persistedItems=inserted.items as typeof itemSnapshot;
    const session=await stripe.checkout.sessions.create({
      mode:"payment",success_url:`${publicHost}/bookie-obiski/${p.slug}/bon/uspeh?session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${publicHost}/bookie-obiski/${p.slug}`,
      customer_email:inserted.buyer_email,metadata:{checkout_id:inserted.id,company_id:inserted.company_id,unit_id:String(inserted.unit_id)},
      line_items:persistedItems.map(x=>({quantity:x.quantity,price_data:{currency:x.currency.toLowerCase(),unit_amount:x.amountCents,product_data:{name:x.name}}})),
    },{idempotencyKey:inserted.id});
    if (!session?.id || !session?.url) throw new Error("Stripe ni vrnil seje.");
    await db.execute(sql`UPDATE public_voucher_checkouts SET stripe_session_id=${session.id},checkout_url=${session.url},status='open',creation_token=NULL WHERE id=${inserted.id} AND creation_token=${claimToken}`);
    res.status(201).json({ sessionId: session.id, checkoutUrl: session.url, status: "open", expiresAt: session.expires_at ? new Date(session.expires_at*1000).toISOString() : null });
  } catch (error) {
    await db.execute(sql`UPDATE public_voucher_checkouts SET creation_token=NULL WHERE id=${inserted.id} AND creation_token=${claimToken}`);
    req.log.error({ err:error }, "Stripe checkout creation failed");
    res.status(502).json({ error: "Plačilne seje trenutno ni mogoče ustvariti." });
  }
});

publicVisitsRouter.get("/javno/restavracije/:slug/boni/checkout/:sessionId", async (req, res): Promise<any> => {
  const parsed = GetJavniBonCheckoutParams.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: "Nakup ni najden." });
  const row = rows(await db.execute(sql`SELECT c.* FROM public_voucher_checkouts c JOIN public_venue_profiles p ON p.id=c.profile_id WHERE p.slug=${parsed.data.slug} AND c.stripe_session_id=${parsed.data.sessionId}`))[0];
  if (!row) return res.status(404).json({ error: "Nakup ni najden." });
  const vouchers = rows(await db.execute(sql`
    SELECT id,delivery_status,delivery_attempts,delivery_next_attempt_at,delivery_error
    FROM individual_vouchers WHERE checkout_id=${row.id}
  `));
  const deliveryStatus = vouchers.length === 0 ? null
    : vouchers.every(x => x.delivery_status === "sent") ? "sent"
    : vouchers.some(x => x.delivery_status === "sending") ? "sending"
    : vouchers.some(x => x.delivery_status === "failed") ? "failed"
    : "pending";
  res.setHeader("Cache-Control","no-store");
  res.json({
    sessionId: row.stripe_session_id,
    status: row.status,
    paymentStatus: row.payment_status,
    checkoutUrl: row.checkout_url,
    voucherIds: vouchers.map(x => x.id),
    deliveryStatus,
    deliveryAttempts: Math.max(0, ...vouchers.map(x => Number(x.delivery_attempts))),
    deliveryNextAttemptAt: vouchers.find(x => x.delivery_next_attempt_at)?.delivery_next_attempt_at ?? null,
    deliveryError: vouchers.find(x => x.delivery_error)?.delivery_error ?? null,
  });
});

export async function processPublicStripeEvent(verifiedEvent:Stripe.Event,req:any,res:any):Promise<any>{
  const session:any=verifiedEvent.data.object;
  if (verifiedEvent.type !== "checkout.session.completed") return res.json({ received: true, processed: false });
  const client = await (db as any).$client.connect();
  const issued: Array<{id:string;code:string;amount:number}> = [];
  let completedCheckout: any;
  let venueName = "Restavracija";
  try {
    await client.query("BEGIN");
    const claim = await client.query("INSERT INTO public_stripe_events(event_id,event_type) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id",[verifiedEvent.id,verifiedEvent.type]);
    if (!claim.rowCount) {
      await client.query("COMMIT");
      const checkout=(await client.query("SELECT c.*,e.ime venue_name FROM public_voucher_checkouts c JOIN enote e ON e.id=c.unit_id WHERE c.stripe_session_id=$1",[session.id])).rows[0];
      if(checkout){
        const delivery=await attemptVoucherDelivery(checkout.id);
        if(delivery.attempted&&!delivery.delivered)return res.status(503).json({error:"Dostava bona bo ponovljena."});
      }
      return res.json({ received:true,processed:false });
    }
    const checkout = (await client.query("SELECT c.*,e.ime venue_name FROM public_voucher_checkouts c JOIN enote e ON e.id=c.unit_id WHERE c.stripe_session_id=$1 FOR UPDATE",[session.id])).rows[0];
    const metadataMatches = checkout
      && String(session.metadata?.checkout_id ?? "") === String(checkout.id)
      && String(session.metadata?.company_id ?? "") === String(checkout.company_id)
      && String(session.metadata?.unit_id ?? "") === String(checkout.unit_id);
    const currencyMatches = checkout && String(session.currency ?? "").toUpperCase() === checkout.currency;
    const amountMatches = checkout && Number(session.amount_total) === checkout.expected_amount_cents;
    if (!checkout || !metadataMatches || session.payment_status !== "paid" || !currencyMatches || !amountMatches) {
      const metadataCompanyId=String(session.metadata?.company_id??"");
      const metadataUnitId=String(session.metadata?.unit_id??"");
      let tenant=checkout ? {company_id:checkout.company_id,unit_id:checkout.unit_id} : null;
      if(!tenant&&UUID_V4.test(metadataCompanyId)&&/^\d+$/.test(metadataUnitId)){
        tenant=(await client.query(`SELECT c.id company_id,e.id unit_id FROM companies c
          LEFT JOIN enote e ON e.company_id=c.id AND e.id=$2
          WHERE c.id=$1 LIMIT 1`,[metadataCompanyId,Number(metadataUnitId)])).rows[0]??null;
      }
      const reason=!checkout
        ?{code:"checkout_not_found",detail:"Nakup za podpisano Stripe sejo ni bil najden."}
        :!metadataMatches
          ?{code:"tenant_mismatch",detail:"Identiteta nakupa, podjetje ali enota iz Stripe dogodka se ne ujema."}
          :session.payment_status!=="paid"
            ?{code:"payment_not_paid",detail:"Stripe dogodek nima potrjenega statusa plačila."}
            :!currencyMatches
              ?{code:"currency_mismatch",detail:"Valuta Stripe plačila se ne ujema s pričakovano valuto nakupa."}
              :{code:"amount_mismatch",detail:"Znesek Stripe plačila se ne ujema s pričakovanim zneskom nakupa."};
      const review=(await client.query(`INSERT INTO public_stripe_payment_reviews(
        event_id,event_type,stripe_session_id,checkout_id,company_id,unit_id,
        metadata_company_id,metadata_unit_id,reason_code,reason_detail,
        expected_amount_cents,received_amount_cents,expected_currency,received_currency,payment_status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT(event_id) DO NOTHING RETURNING id`,[
        verifiedEvent.id,verifiedEvent.type,String(session.id??""),checkout?.id??null,
        tenant?.company_id??null,tenant?.unit_id??null,metadataCompanyId||null,metadataUnitId||null,
        reason.code,reason.detail,checkout?.expected_amount_cents??null,
        Number.isFinite(Number(session.amount_total))?Number(session.amount_total):null,
        checkout?.currency??null,String(session.currency??"").toUpperCase()||null,
        String(session.payment_status??"")||null,
      ])).rows[0];
      if(review){
        await client.query(`INSERT INTO public_stripe_payment_review_audit(review_id,action,data)
          VALUES($1,'created',$2::jsonb)`,[review.id,JSON.stringify({eventId:verifiedEvent.id,reasonCode:reason.code})]);
      }
      await client.query("COMMIT");
      logPublicStripeWebhookFailure({
        errorType:"StripeBusinessValidationError",
        reason:reason.code,
        retryable:false,
        requestId:req.id,
        message:"Stripe payment requires manual review",
      });
      return res.status(409).json({error:"Plačilo zahteva ročno uskladitev."});
    }
    const items = checkout.items as Array<{variantId:string;quantity:number;amountCents:number;currency:string}>;
    for (const item of items) {
      for(let i=0;i<item.quantity;i++){
        const code=randomBytes(18).toString("base64url").toUpperCase();
        const voucher=(await client.query(`INSERT INTO individual_vouchers(checkout_id,company_id,unit_id,code_hash,code_encrypted,code_suffix,initial_amount_cents,recipient_name,recipient_email)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[checkout.id,checkout.company_id,checkout.unit_id,hashToken(code),encryptCode(code),code.slice(-6),item.amountCents,checkout.recipient_name,checkout.recipient_email])).rows[0];
        await client.query("INSERT INTO individual_voucher_movements(voucher_id,company_id,operation_key,type,amount_cents) VALUES($1,$2,$3,'issue',$4)",[voucher.id,checkout.company_id,`stripe:${verifiedEvent.id}:${voucher.id}`,item.amountCents]);
        issued.push({id:voucher.id,code,amount:item.amountCents});
      }
    }
    await client.query("UPDATE public_voucher_checkouts SET status='complete',payment_status='paid' WHERE id=$1",[checkout.id]);
    await client.query("COMMIT");
    completedCheckout=checkout; venueName=checkout.venue_name;
    const delivery=await attemptVoucherDelivery(completedCheckout.id);
    if(delivery.attempted&&!delivery.delivered)return res.status(503).json({error:"Bon je izdan, dostava bo ponovljena."});
    res.json({ received:true,processed:true });
  } catch(error){
    await client.query("ROLLBACK");
    logPublicStripeWebhookFailure({
      error,
      reason:"stripe_business_processing_failed",
      retryable:false,
      requestId:req.id,
      message:"Stripe webhook business processing failed",
    });
    res.status(409).json({error:"Plačila ni mogoče potrditi."});
  }
  finally{client.release();}
}

async function managedPublicProfileDto(companyId:string,unitId:number){
  const client=(db as any).$client;
  const profile=(await client.query(`SELECT p.*,e.ime venue_name FROM public_venue_profiles p
    JOIN enote e ON e.id=p.unit_id WHERE p.company_id=$1 AND p.unit_id=$2 LIMIT 1`,[companyId,unitId])).rows[0];
  if(!profile){
    const venue=(await client.query("SELECT ime FROM enote WHERE id=$1 AND company_id=$2 LIMIT 1",[unitId,companyId])).rows[0];
    if(!venue)return null;
    const slug=normalizeSlug(venue.ime);
    return {id:"",unitId,companyId,venueName:venue.ime,publicUrl:`/bookie-obiski/${slug}`,slug,active:false,
      description:null,address:null,phone:null,email:null,website:null,primaryColor:"#1B3B36",logoUrl:null,coverImageUrl:null,
      maxPartySize:12,slotMinutes:30,slotCapacity:40,openingHours:[1,2,3,4,5,6,7].map(dan=>({dan,odprto:false,intervals:[]})),
      dateExceptions:[],products:[]};
  }
  const products=(await client.query(`SELECT * FROM public_voucher_products WHERE profile_id=$1 ORDER BY name,id`,[profile.id])).rows;
  for(const product of products)product.variants=(await client.query(`SELECT * FROM public_voucher_variants WHERE product_id=$1 ORDER BY amount_cents,id`,[product.id])).rows;
  return {id:profile.id,unitId:profile.unit_id,companyId:profile.company_id,venueName:profile.venue_name,
    publicUrl:`/bookie-obiski/${profile.slug}`,slug:profile.slug,active:profile.active,description:profile.description,address:profile.address,
    phone:profile.phone,email:profile.email,website:profile.website,primaryColor:profile.primary_color??"#1B3B36",
    logoUrl:profile.logo_url,coverImageUrl:profile.cover_image_url,maxPartySize:profile.max_party_size,slotMinutes:profile.slot_minutes,
    slotCapacity:profile.slot_capacity,openingHours:profile.opening_hours,dateExceptions:profile.date_exceptions,
    products:products.map((p:any)=>({id:p.id,naziv:p.name,opis:p.description,imageUrl:p.image_url,active:p.active,
      variants:p.variants.map((v:any)=>({id:v.id,naziv:v.name,amountCents:v.amount_cents,active:v.active}))}))};
}

internalVoucherRouter.get("/javni-profil",async(req:any,res):Promise<any>=>{
  if(!["admin","admin_enote","superadmin"].includes(String(req.vloga??"")))return res.status(403).json({error:"Urejanje javne strani zahteva administrativni dostop."});
  const companyId=req.companyId as string|undefined,unitId=Number(req.enotaId);
  if(!companyId||!Number.isInteger(unitId))return res.status(400).json({error:"Aktivna enota ni izbrana."});
  const profile=await managedPublicProfileDto(companyId,unitId);
  if(!profile)return res.status(404).json({error:"Enota ni najdena."});
  res.setHeader("Cache-Control","no-store");res.json(profile);
});

internalVoucherRouter.post("/javni-profil/slike/upload-url",async(req:any,res):Promise<any>=>{
  if(!["admin","admin_enote","superadmin"].includes(String(req.vloga??"")))return res.status(403).json({error:"Nalaganje slik zahteva administrativni dostop."});
  const parsed=RequestJavniProfilImageUploadBody.safeParse(req.body);
  const companyId=req.companyId as string|undefined,unitId=Number(req.enotaId);
  if(!parsed.success||!companyId||!Number.isInteger(unitId))return res.status(400).json({error:"Podatki slike niso veljavni."});
  if(!PUBLIC_PROFILE_IMAGE_MIME.has(parsed.data.contentType)||parsed.data.size>PUBLIC_PROFILE_IMAGE_MAX_BYTES){
    return res.status(400).json({error:"Dovoljene so slike JPG, PNG in WEBP do 5 MB."});
  }
  const venue=rows(await db.execute(sql`SELECT id FROM enote WHERE id=${unitId} AND company_id=${companyId} LIMIT 1`))[0];
  if(!venue)return res.status(404).json({error:"Enota ni najdena."});
  try{
    const uploadURL=await publicProfileStorage.getObjectEntityUploadURL(`uploads/public-profile-staging/${companyId}/${unitId}`);
    res.json({uploadURL,objectPath:publicProfileStorage.normalizeObjectEntityPath(uploadURL)});
  }catch(error){
    req.log.error({err:error},"Creating public profile image upload failed");
    res.status(500).json({error:"Prenosa slike ni mogoče začeti."});
  }
});

internalVoucherRouter.delete("/javni-profil/slike/:objectId",async(req:any,res):Promise<any>=>{
  if(!["admin","admin_enote","superadmin"].includes(String(req.vloga??"")))return res.status(403).json({error:"Brisanje slik zahteva administrativni dostop."});
  const companyId=req.companyId as string|undefined,unitId=Number(req.enotaId),objectId=String(req.params.objectId??"");
  if(!companyId||!Number.isInteger(unitId)||!UUID_V4.test(objectId))return res.status(400).json({error:"Slika ni veljavna."});
  const objectPath=`${publicProfileImagePrefix(companyId,unitId)}${objectId}`;
  const stagingPath=`${publicProfileImageStagingPrefix(companyId,unitId)}${objectId}`;
  try{
    const publishedDeleted=await deletePublicProfileImageIfUnused(objectPath,companyId,unitId);
    let stagingDeleted=false;
    try{
      await publicProfileStorage.deleteObjectEntity(stagingPath);
      stagingDeleted=true;
    }catch(error){
      if(!(error instanceof ObjectNotFoundError))throw error;
    }
    res.json({deleted:publishedDeleted||stagingDeleted});
  }catch(error){
    req.log.error({err:error},"Deleting unused public profile image failed");
    res.status(500).json({error:"Slike ni mogoče odstraniti."});
  }
});

internalVoucherRouter.put("/javni-profil",async(req:any,res):Promise<any>=>{
  if(!["admin","admin_enote","superadmin"].includes(String(req.vloga??"")))return res.status(403).json({error:"Urejanje javne strani zahteva administrativni dostop."});
  const parsed=UpdateJavniProfilNastavitveBody.safeParse(req.body);
  const companyId=req.companyId as string|undefined,unitId=Number(req.enotaId);
  if(!parsed.success||!companyId||!Number.isInteger(unitId))return res.status(400).json({error:"Nastavitve javne strani niso veljavne."});
  const body=parsed.data;
  if(body.openingHours.some(x=>!validIntervals(x.intervals))||body.dateExceptions.some(x=>!validIntervals(x.intervals))){
    return res.status(400).json({error:"Čas konca mora biti po času začetka."});
  }
  const requestedImages:Array<{value:string|null|undefined;purpose:PublicProfileImagePurpose}>=[
    {value:body.logoUrl,purpose:"logo"},
    {value:body.coverImageUrl,purpose:"cover"},
    ...body.products.map(product=>({value:product.imageUrl,purpose:"voucher" as const})),
  ];
  const promotedImages=new Map<string,string>();
  try{
    const uniqueSourceImages=[...new Set(requestedImages.map(image=>image.value).filter((value):value is string=>Boolean(value)))];
    await Promise.all(uniqueSourceImages.map(value=>validatePublicProfileImage(value,companyId,unitId)));
    const uniqueVariants=new Map<string,{value:string;purpose:PublicProfileImagePurpose}>();
    for(const image of requestedImages){
      if(image.value)uniqueVariants.set(`${image.purpose}:${image.value}`,{value:image.value,purpose:image.purpose});
    }
    for(const {value,purpose} of uniqueVariants.values()){
      if(value.startsWith(publicProfileImageStagingPrefix(companyId,unitId))){
        const sourceFile=await publicProfileStorage.getObjectEntityFile(value);
        const [sourceBytes]=await sourceFile.download();
        const variant=await createPublicProfileImageVariant(sourceBytes,purpose);
        const promotedPath=await publicProfileStorage.saveObjectEntityToNewPath(
          `uploads/public-profile/${companyId}/${unitId}`,
          variant.bytes,
          variant.contentType,
        );
        promotedImages.set(`${purpose}:${value}`,promotedPath);
        await validateStoredPublicProfileImage(promotedPath);
      }
    }
  }catch(error){
    for(const promotedPath of promotedImages.values()){
      try{await publicProfileStorage.deleteObjectEntity(promotedPath);}catch{}
    }
    return res.status(409).json({error:error instanceof Error?error.message:"Slika ni veljavna."});
  }
  const resolvedImage=(value:string|null|undefined,purpose:PublicProfileImagePurpose)=>
    value?promotedImages.get(`${purpose}:${value}`)??value:value;
  const resolvedBody={
    ...body,
    logoUrl:resolvedImage(body.logoUrl,"logo"),
    coverImageUrl:resolvedImage(body.coverImageUrl,"cover"),
    products:body.products.map(product=>({...product,imageUrl:resolvedImage(product.imageUrl,"voucher")})),
  };
  const resolvedImages=[resolvedBody.logoUrl,resolvedBody.coverImageUrl,...resolvedBody.products.map(product=>product.imageUrl)];
  const client=await (db as any).$client.connect();
  let staleImages:string[]=[];
  let saved=false;
  try{
    await client.query("BEGIN");
    const venue=(await client.query("SELECT id FROM enote WHERE id=$1 AND company_id=$2 FOR UPDATE",[unitId,companyId])).rows[0];
    if(!venue){
      await client.query("ROLLBACK");
      for(const promotedPath of promotedImages.values()){
        try{await publicProfileStorage.deleteObjectEntity(promotedPath);}catch{}
      }
      return res.status(404).json({error:"Enota ni najdena."});
    }
    const previousProfile=(await client.query("SELECT id,logo_url,cover_image_url FROM public_venue_profiles WHERE unit_id=$1 AND company_id=$2 FOR UPDATE",[unitId,companyId])).rows[0];
    const previousProductImages=previousProfile
      ?(await client.query("SELECT image_url FROM public_voucher_products WHERE profile_id=$1",[previousProfile.id])).rows.map((row:any)=>row.image_url)
      :[];
    const previousImages=[previousProfile?.logo_url,previousProfile?.cover_image_url,...previousProductImages]
      .filter((value):value is string=>Boolean(publicProfileImageObjectId(value)));
    const profile=(await client.query(`INSERT INTO public_venue_profiles(unit_id,company_id,slug,active,description,address,phone,email,website,primary_color,logo_url,cover_image_url,max_party_size,slot_minutes,slot_capacity,opening_hours,date_exceptions,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,now())
      ON CONFLICT(unit_id) DO UPDATE SET slug=excluded.slug,active=excluded.active,description=excluded.description,address=excluded.address,
        phone=excluded.phone,email=excluded.email,website=excluded.website,primary_color=excluded.primary_color,logo_url=excluded.logo_url,
        cover_image_url=excluded.cover_image_url,max_party_size=excluded.max_party_size,slot_minutes=excluded.slot_minutes,
        slot_capacity=excluded.slot_capacity,opening_hours=excluded.opening_hours,date_exceptions=excluded.date_exceptions,updated_at=now()
      WHERE public_venue_profiles.company_id=$2 RETURNING id`,[unitId,companyId,resolvedBody.slug,resolvedBody.active,resolvedBody.description,resolvedBody.address,resolvedBody.phone,
      resolvedBody.email,resolvedBody.website,resolvedBody.primaryColor,resolvedBody.logoUrl,resolvedBody.coverImageUrl,resolvedBody.maxPartySize,resolvedBody.slotMinutes,resolvedBody.slotCapacity,
      JSON.stringify(resolvedBody.openingHours),JSON.stringify(resolvedBody.dateExceptions)])).rows[0];
    if(!profile)throw new Error("Profil pripada drugemu podjetju.");
    const productIds:string[]=[];
    for(const product of resolvedBody.products){
      const saved=product.id
        ?(await client.query(`UPDATE public_voucher_products SET name=$1,description=$2,image_url=$3,active=$4
          WHERE id=$5 AND profile_id=$6 RETURNING id`,[product.naziv,product.opis,product.imageUrl,product.active,product.id,profile.id])).rows[0]
        :(await client.query(`INSERT INTO public_voucher_products(profile_id,name,description,image_url,active) VALUES($1,$2,$3,$4,$5) RETURNING id`,
          [profile.id,product.naziv,product.opis,product.imageUrl,product.active])).rows[0];
      if(!saved)throw new Error("Bon ne pripada aktivni enoti.");
      productIds.push(saved.id);
      const variantIds:string[]=[];
      for(const variant of product.variants){
        const savedVariant=variant.id
          ?(await client.query(`UPDATE public_voucher_variants SET name=$1,amount_cents=$2,active=$3
            WHERE id=$4 AND product_id=$5 RETURNING id`,[variant.naziv,variant.amountCents,variant.active,variant.id,saved.id])).rows[0]
          :(await client.query(`INSERT INTO public_voucher_variants(product_id,name,amount_cents,active) VALUES($1,$2,$3,$4) RETURNING id`,
            [saved.id,variant.naziv,variant.amountCents,variant.active])).rows[0];
        if(!savedVariant)throw new Error("Vrednost bona ne pripada aktivni enoti.");
        variantIds.push(savedVariant.id);
      }
      await client.query("DELETE FROM public_voucher_variants WHERE product_id=$1 AND NOT(id=ANY($2::uuid[]))",[saved.id,variantIds]);
    }
    await client.query("DELETE FROM public_voucher_products WHERE profile_id=$1 AND NOT(id=ANY($2::uuid[]))",[profile.id,productIds]);
    const nextImages=new Set(resolvedImages.filter((value):value is string=>Boolean(value)));
    staleImages=[...new Set(previousImages.filter(value=>!nextImages.has(value)))];
    await client.query("COMMIT");
    saved=true;
  }catch(error:any){
    await client.query("ROLLBACK");
    for(const promotedPath of promotedImages.values()){
      try{await publicProfileStorage.deleteObjectEntity(promotedPath);}catch{}
    }
    if(error?.code==="23505")return res.status(409).json({error:"Ta javni naslov že uporablja druga enota."});
    req.log.error({err:error},"Saving public profile failed");
    return res.status(409).json({error:error instanceof Error?error.message:"Nastavitev ni bilo mogoče shraniti."});
  }finally{client.release();}
  if(saved){
    for(const stagingPath of new Set(
      requestedImages
        .map(image=>image.value)
        .filter((value):value is string=>Boolean(value&&value.startsWith(publicProfileImageStagingPrefix(companyId,unitId)))),
    )){
      try{await publicProfileStorage.deleteObjectEntity(stagingPath);}
      catch(error){if(!(error instanceof ObjectNotFoundError))req.log.warn({err:error,stagingPath},"Public profile staging image cleanup failed");}
    }
  }
  for(const objectPath of staleImages){
    try{await deletePublicProfileImageIfUnused(objectPath,companyId,unitId);}
    catch(error){req.log.warn({err:error,objectPath},"Unused public profile image cleanup failed");}
  }
  res.json(await managedPublicProfileDto(companyId,unitId));
});

internalVoucherRouter.get("/darilni-boni/individualni/dostave", async (req:any,res): Promise<any> => {
  if (!["admin","admin_enote","superadmin"].includes(String(req.vloga ?? ""))) {
    return res.status(403).json({ error: "Pregled dostave bonov zahteva administrativni dostop." });
  }
  const companyId=req.companyId as string|undefined;
  if(!companyId)return res.status(400).json({error:"Podjetje ni izbrano."});
  const unitFilter=req.vloga==="admin_enote" ? Number(req.enotaId) : null;
  const deliveries=rows(await db.execute(sql`
    SELECT c.id AS checkout_id,c.recipient_name,c.recipient_email,c.created_at,
      COUNT(v.id)::int AS voucher_count,
      CASE WHEN bool_and(v.delivery_status='sent') THEN 'sent'
        WHEN bool_or(v.delivery_status='sending') THEN 'sending'
        WHEN bool_or(v.delivery_status='failed') THEN 'failed' ELSE 'pending' END AS delivery_status,
      MAX(v.delivery_attempts)::int AS delivery_attempts,
      MIN(v.delivery_next_attempt_at) FILTER (WHERE v.delivery_next_attempt_at IS NOT NULL) AS delivery_next_attempt_at,
      MAX(v.delivery_last_attempt_at) AS delivery_last_attempt_at,
      (array_agg(v.delivery_error ORDER BY v.delivery_last_attempt_at DESC NULLS LAST)
        FILTER (WHERE v.delivery_error IS NOT NULL))[1] AS delivery_error
    FROM public_voucher_checkouts c
    JOIN individual_vouchers v ON v.checkout_id=c.id
    WHERE c.company_id=${companyId}
      AND (${unitFilter}::int IS NULL OR c.unit_id=${unitFilter})
    GROUP BY c.id
    ORDER BY c.created_at DESC
    LIMIT 100
  `));
  res.setHeader("Cache-Control","no-store");
  res.json(deliveries.map(x=>({
    checkoutId:x.checkout_id,recipientName:x.recipient_name,recipientEmail:x.recipient_email,
    createdAt:x.created_at,voucherCount:Number(x.voucher_count),deliveryStatus:x.delivery_status,
    deliveryAttempts:Number(x.delivery_attempts),deliveryNextAttemptAt:x.delivery_next_attempt_at,
    deliveryLastAttemptAt:x.delivery_last_attempt_at,deliveryError:x.delivery_error,
  })));
});

internalVoucherRouter.get("/darilni-boni/individualni/dostave/opozorila", async (req:any,res): Promise<any> => {
  if (!["admin","admin_enote","superadmin"].includes(String(req.vloga ?? ""))) {
    return res.status(403).json({ error: "Pregled opozoril dostave bonov zahteva administrativni dostop." });
  }
  const companyId=req.companyId as string|undefined;
  if(!companyId)return res.status(400).json({error:"Podjetje ni izbrano."});
  const unitFilter=req.vloga==="admin_enote" ? Number(req.enotaId) : null;
  const alerts=rows(await db.execute(sql`
    SELECT a.id,a.checkout_id,a.last_error,a.created_at,c.recipient_name,c.recipient_email
    FROM voucher_delivery_alerts a
    JOIN public_voucher_checkouts c ON c.id=a.checkout_id
    WHERE a.company_id=${companyId} AND a.resolved_at IS NULL
      AND (${unitFilter}::int IS NULL OR a.unit_id=${unitFilter})
    ORDER BY a.created_at
    LIMIT 20
  `));
  res.setHeader("Cache-Control","no-store");
  res.json(alerts.map(alert=>({
    id:alert.id,checkoutId:alert.checkout_id,recipientName:alert.recipient_name,
    recipientEmail:alert.recipient_email,lastError:alert.last_error,createdAt:alert.created_at,
    retryPath:`/darilni-boni/individualni/dostave/${alert.checkout_id}/ponovi`,
  })));
});

internalVoucherRouter.get("/darilni-boni/individualni/stripe-pregledi", async (req:any,res): Promise<any> => {
  if (!["admin","admin_enote","superadmin"].includes(String(req.vloga ?? ""))) {
    return res.status(403).json({ error: "Pregled Stripe plačil zahteva administrativni dostop." });
  }
  const companyId=req.companyId as string|undefined;
  if(!companyId)return res.status(400).json({error:"Podjetje ni izbrano."});
  const unitFilter=req.vloga==="admin_enote" ? Number(req.enotaId) : null;
  const reviews=rows(await db.execute(sql`
    SELECT r.*
    FROM public_stripe_payment_reviews r
    WHERE r.status='open' AND r.company_id=${companyId}
      AND (${unitFilter}::int IS NULL OR r.unit_id=${unitFilter})
    ORDER BY r.created_at
    LIMIT 100
  `));
  res.setHeader("Cache-Control","no-store");
  res.json(reviews.map(review=>({
    id:review.id,eventId:review.event_id,sessionId:review.stripe_session_id,
    checkoutId:review.checkout_id,companyId:review.company_id,unitId:review.unit_id,
    metadataCompanyId:review.metadata_company_id,metadataUnitId:review.metadata_unit_id,
    reasonCode:review.reason_code,reason:review.reason_detail,
    expectedAmountCents:review.expected_amount_cents,receivedAmountCents:review.received_amount_cents,
    expectedCurrency:review.expected_currency,receivedCurrency:review.received_currency,
    paymentStatus:review.payment_status,createdAt:review.created_at,
  })));
});

internalVoucherRouter.post("/darilni-boni/individualni/stripe-pregledi/:reviewId/resi", async (req:any,res): Promise<any> => {
  if (!["admin","admin_enote","superadmin"].includes(String(req.vloga ?? ""))) {
    return res.status(403).json({ error: "Reševanje Stripe plačil zahteva administrativni dostop." });
  }
  const companyId=req.companyId as string|undefined;
  const reviewId=String(req.params.reviewId??"");
  const note=String(req.body?.note??"").trim();
  if(!companyId||!UUID_V4.test(reviewId)||note.length<3||note.length>1000){
    return res.status(400).json({error:"Vnesite pojasnilo ročne rešitve."});
  }
  const unitFilter=req.vloga==="admin_enote" ? Number(req.enotaId) : null;
  const client=await (db as any).$client.connect();
  try{
    await client.query("BEGIN");
    const review=(await client.query(`UPDATE public_stripe_payment_reviews
      SET status='resolved',resolved_at=now(),resolved_by=$4,resolution_note=$5,updated_at=now()
      WHERE id=$1 AND company_id=$2 AND ($3::int IS NULL OR unit_id=$3) AND status='open'
      RETURNING id,event_id`,[reviewId,companyId,unitFilter,req.clerkUserId??"unknown",note])).rows[0];
    if(!review){
      await client.query("ROLLBACK");
      return res.status(404).json({error:"Odprti primer ni najden."});
    }
    await client.query(`INSERT INTO public_stripe_payment_review_audit(
      review_id,action,actor_clerk_user_id,note,data)
      VALUES($1,'resolved',$2,$3,$4::jsonb)`,[
      review.id,req.clerkUserId??"unknown",note,
      JSON.stringify({eventId:review.event_id,outcome:"acknowledged_without_voucher_change"}),
    ]);
    await client.query("COMMIT");
    res.json({id:review.id,status:"resolved",message:"Primer je označen kot ročno rešen. Boni in njihovi saldi niso bili spremenjeni."});
  }catch(error){
    await client.query("ROLLBACK");
    req.log.error({err:error},"Resolving Stripe payment review failed");
    res.status(500).json({error:"Primera ni bilo mogoče rešiti."});
  }finally{client.release();}
});

internalVoucherRouter.post("/darilni-boni/individualni/dostave/:checkoutId/ponovi", async (req:any,res): Promise<any> => {
  if (!["admin","admin_enote","superadmin"].includes(String(req.vloga ?? ""))) {
    return res.status(403).json({ error: "Ponovna dostava bonov zahteva administrativni dostop." });
  }
  const companyId=req.companyId as string|undefined;
  const checkoutId=String(req.params.checkoutId??"");
  if(!companyId||!UUID_V4.test(checkoutId))return res.status(400).json({error:"Nakup bona ni veljaven."});
  const owned=rows(await db.execute(sql`SELECT id,unit_id FROM public_voucher_checkouts
    WHERE id=${checkoutId} AND company_id=${companyId}
      AND (${req.vloga==="admin_enote" ? Number(req.enotaId) : null}::int IS NULL OR unit_id=${req.vloga==="admin_enote" ? Number(req.enotaId) : null})
    LIMIT 1`))[0];
  if(!owned)return res.status(404).json({error:"Nakup bona ni najden."});
  const result=await attemptVoucherDelivery(checkoutId,{manual:true,companyId});
  if(!result.attempted)return res.status(409).json({error:"Dostava je že zaključena ali trenutno poteka."});
  res.status(result.delivered?200:503).json({
    checkoutId,deliveryStatus:result.delivered?"sent":"failed",
    message:result.delivered?"Bon je bil poslan.":"Pošiljanje ni uspelo; samodejni poskus ostaja načrtovan.",
  });
});

internalVoucherRouter.post("/darilni-boni/individualni/preveri", async (req:any,res): Promise<any> => {
  const companyId=req.companyId as string|undefined;
  const code=String(req.body?.code??"");
  if(!companyId||code.length<8)return res.status(400).json({error:"Koda bona ni veljavna."});
  const row=rows(await db.execute(sql`SELECT v.*,COALESCE(sum(CASE WHEN m.type='issue' OR m.type='reverse' THEN m.amount_cents ELSE -m.amount_cents END),0)::int balance
    FROM individual_vouchers v JOIN individual_voucher_movements m ON m.voucher_id=v.id WHERE v.company_id=${companyId} AND v.code_hash=${hashToken(code)}
    GROUP BY v.id`))[0];
  if(!row)return res.status(404).json({error:"Bon ni najden."});
  res.json({id:row.id,codeSuffix:row.code_suffix,balanceCents:row.balance,currency:row.currency,status:row.status,expiresAt:row.expires_at});
});

internalVoucherRouter.post("/darilni-boni/individualni/unovci", async (req:any,res): Promise<any> => {
  const companyId=req.companyId as string|undefined;
  const code=String(req.body?.code??""); const operationKey=String(req.body?.operationKey??"");
  const amount=Number(req.body?.amountCents);
  if(!companyId||code.length<8||!operationKey||!Number.isInteger(amount)||amount<=0)return res.status(400).json({error:"Podatki unovčitve niso veljavni."});
  const client=await (db as any).$client.connect();
  try{
    await client.query("BEGIN");
    const voucher=(await client.query("SELECT * FROM individual_vouchers WHERE company_id=$1 AND code_hash=$2 FOR UPDATE",[companyId,hashToken(code)])).rows[0];
    if(!voucher) {await client.query("ROLLBACK");return res.status(404).json({error:"Bon ni najden."});}
    if(voucher.status!=="active"||(voucher.expires_at&&new Date(voucher.expires_at)<=new Date())){await client.query("ROLLBACK");return res.status(409).json({error:"Bon ni aktiven."});}
    const existing=(await client.query("SELECT * FROM individual_voucher_movements WHERE voucher_id=$1 AND operation_key=$2",[voucher.id,operationKey])).rows[0];
    const balance=Number((await client.query("SELECT COALESCE(sum(CASE WHEN type='issue' OR type='reverse' THEN amount_cents ELSE -amount_cents END),0)::int balance FROM individual_voucher_movements WHERE voucher_id=$1",[voucher.id])).rows[0].balance);
    if(existing){await client.query("COMMIT");return res.json({voucherId:voucher.id,redeemedCents:existing.amount_cents,balanceCents:balance,idempotent:true});}
    if(amount>balance){await client.query("ROLLBACK");return res.status(409).json({error:"Znesek presega preostalo vrednost bona.",balanceCents:balance});}
    await client.query("INSERT INTO individual_voucher_movements(voucher_id,company_id,operation_key,type,amount_cents,receipt_id) VALUES($1,$2,$3,'redeem',$4,$5)",[voucher.id,companyId,operationKey,amount,req.body?.receiptId??null]);
    if(amount===balance)await client.query("UPDATE individual_vouchers SET status='spent' WHERE id=$1",[voucher.id]);
    await client.query("COMMIT");res.json({voucherId:voucher.id,redeemedCents:amount,balanceCents:balance-amount,idempotent:false});
  }catch(error){await client.query("ROLLBACK");req.log.error({err:error},"Voucher redemption failed");res.status(500).json({error:"Bona ni bilo mogoče unovčiti."});}
  finally{client.release();}
});