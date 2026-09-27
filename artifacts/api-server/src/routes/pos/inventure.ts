import { Router, type IRouter, type Response } from "express";
import { and, count, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { artikliTable, db, documentsTable, inventurePostavkeTable, inventureTable, prejemnicePostavkeTable, prejemniceTable, zalogaGibiTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import type { PosRequest } from "../../middlewares/pos";
import { broadcastToUnit } from "../../lib/pos-sse";
import { recomputeZaloge, getZalogeObDatumu } from "../../lib/pos-zaloge-utils";
import { appendStockMovementReversals } from "../../lib/stockMovementHistory";
import { z } from "zod";
import type { Readable } from "stream";
import PDFDocument from "pdfkit";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { ObjectStorageService } from "../../lib/objectStorage";
import {
  INVENTORY_OCR_MAX_UPLOAD_BYTES,
  inventoryEditLineSchema,
  inventoryPriceSchema,
  inventoryOcrSchema,
  inventoryUploadRequestSchema,
  matchInventoryOcr,
  resolveInventoryUnitPrice,
} from "../../lib/inventure-ocr";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const MAX_OCR_BYTES = INVENTORY_OCR_MAX_UPLOAD_BYTES;
const safeInventoryDecimal = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 999999.9999
    && Math.round(value * 10000) / 10000 === value;

const inventoryCreateSchema = z.object({
  datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value =>
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
      && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
  ).optional(),
  opomba: z.string().nullable().optional(),
  documentPath: z.string().optional(),
  postavke: z.array(z.object({
    artikelId: z.number().int().positive(),
    steviloNajdeno: z.number().refine(safeInventoryDecimal),
    cenaKos: inventoryPriceSchema.optional(),
  }).strict()).min(1),
}).strict();

const inventoryUpdateSchema = z.object({
  datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value =>
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
      && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
  ).optional(),
  opomba: z.string().nullable().optional(),
  postavke: z.array(inventoryEditLineSchema).optional(),
}).strict();

function imageToPdf(image: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ autoFirstPage: false, compress: true });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      const dimensions = (doc as any).openImage(image);
      doc.addPage({ size: [dimensions.width, dimensions.height], margin: 0 });
      doc.image(image, 0, 0, { width: dimensions.width, height: dimensions.height });
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function validInventoryObjectPath(path: string): boolean {
  return /^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(path);
}

router.post("/inventure/upload-url", requireEnota, async (req: PosRequest, res: Response): Promise<void> => {
  const parsed = inventoryUploadRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Neveljavni metapodatki datoteke; dovoljen je PDF/JPEG/PNG do 20 MB" });
    return;
  }

  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    if (!validInventoryObjectPath(objectPath)) {
      req.log?.error({ objectPath }, "App Storage returned an invalid inventory upload path");
      res.status(500).json({ error: "Ni bilo mogoče pripraviti varne poti za nalaganje" });
      return;
    }
    await db.insert(documentsTable).values({
      companyId: req.companyId,
      fileName: parsed.data.name,
      mimeType: parsed.data.contentType,
      fileSizeBytes: parsed.data.size,
      objectPath,
      uploadedByClerkId: req.clerkUserId,
    });
    res.json({ uploadURL, objectPath });
  } catch (error) {
    req.log?.error({ err: error }, "Could not create inventory upload URL");
    res.status(500).json({ error: "Ni bilo mogoče ustvariti varne povezave za nalaganje" });
  }
});

function contentMatchesMime(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return false;
}

class InventoryUploadSizeError extends Error {}

function readObjectBounded(file: { createReadStream: () => Readable }, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    const stream = file.createReadStream();
    stream.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > limit) {
        stream.destroy(new InventoryUploadSizeError("Uploaded document exceeds size limit"));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks, length)));
  });
}

async function getInventoryOcr(buffer: Buffer, mimeType: string) {
  const pdf = mimeType === "application/pdf" ? buffer : await imageToPdf(buffer);
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [{
      role: "user",
      content: [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") },
        },
        {
          type: "text",
          text: `Preberi ročno izpolnjen popis zalog. Vrni samo JSON brez markdowna s strukturo:
{"datum":"YYYY-MM-DD ali null","rows":[{"naziv":"dobesedno prepisano ime artikla","idNatisnjen":11,"enota":"kg ali null","steviloNajdeno":2.5,"cenaKos":3.25}]}
idNatisnjen je samo številka artikla, če je dejansko natisnjena/prepisana na listu, sicer null. Ne sklepaj ID-jev, količin, cen ali enot; nečitljive/negotove številčne vrednosti vrni null. Cena je cena na enoto, ne vsota. Če datuma ni ali ni zanesljiv, vrni null.`,
        },
      ],
    }],
  });
  const text = message.content.find(block => block.type === "text");
  if (!text || text.type !== "text") throw new Error("OCR ni vrnil besedila");
  return inventoryOcrSchema.parse(JSON.parse(text.text));
}

router.post("/inventure/ocr", requireEnota, async (req: PosRequest, res: Response): Promise<void> => {
  const input = z.object({
    objectPath: z.string().min(1),
    scope: z.enum(["material", "drobni"]),
  }).strict().safeParse(req.body);
  if (!input.success || !validInventoryObjectPath(input.data.objectPath)) {
    res.status(400).json({ error: "Neveljavna pot datoteke ali obseg OCR" });
    return;
  }

  try {
    // An already-claimed object may only be reused within its owning company.
    const priorDocs = await db.select({
      companyId: documentsTable.companyId,
      uploadedByClerkId: documentsTable.uploadedByClerkId,
      mimeType: documentsTable.mimeType,
      fileSizeBytes: documentsTable.fileSizeBytes,
    })
      .from(documentsTable)
      .where(eq(documentsTable.objectPath, input.data.objectPath));
    if (!priorDocs.length
      || priorDocs.some(doc => doc.companyId !== req.companyId || doc.uploadedByClerkId !== req.clerkUserId)) {
      res.status(403).json({ error: "Datoteka ni bila naložena v tej enoti s tem uporabniškim računom" });
      return;
    }

    const file = await objectStorageService.getObjectEntityFile(input.data.objectPath);
    const [metadata] = await file.getMetadata();
    const storedMimeType = String(metadata.contentType ?? "").split(";")[0]!.trim().toLowerCase();
    const mimeType = storedMimeType === "image/jpg" ? "image/jpeg" : storedMimeType;
    const size = Number(metadata.size);
    if (!["application/pdf", "image/jpeg", "image/png"].includes(mimeType)
      || !Number.isSafeInteger(size) || size < 1 || size > MAX_OCR_BYTES) {
      res.status(400).json({ error: "Datoteka mora biti PDF/JPEG/PNG in manjša od 20 MB" });
      return;
    }
    if (priorDocs.some(doc => doc.mimeType !== mimeType || doc.fileSizeBytes !== size)) {
      res.status(400).json({ error: "Naložena datoteka se ne ujema s prijavljenimi metapodatki" });
      return;
    }
    const buffer = await readObjectBounded(file, MAX_OCR_BYTES);
    if (buffer.length !== size || !contentMatchesMime(buffer, mimeType)) {
      res.status(400).json({ error: "Vsebina datoteke se ne ujema z dovoljenim tipom" });
      return;
    }

    const articles = await db.select({
      id: artikliTable.id,
      ime: artikliTable.ime,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere: artikliTable.enotaMere,
      drobniInventar: artikliTable.drobniInventar,
    }).from(artikliTable).where(eq(artikliTable.enotaId, req.enotaId));
    // requireEnota establishes company/unit membership; articles are explicitly unit-scoped.
    const extracted = await getInventoryOcr(buffer, mimeType);
    const result = matchInventoryOcr(extracted, articles, input.data.scope);

    res.json({ ...result, documentPath: input.data.objectPath });
  } catch (error) {
    if (error instanceof InventoryUploadSizeError) {
      res.status(400).json({ error: "Datoteka je večja od dovoljene omejitve 20 MB" });
      return;
    }
    req.log?.error({ err: error }, "Inventory OCR failed");
    res.status(502).json({ error: "OCR dokumenta ni uspel; preverite datoteko in poskusite znova" });
  }
});

router.get("/inventure/:id/document", requireEnota, async (req: PosRequest, res: Response): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const inventuraId = Number.parseInt(rawId, 10);
  if (!Number.isInteger(inventuraId) || inventuraId <= 0) {
    res.status(404).json({ error: "Dokument inventure ni najden" });
    return;
  }

  try {
    const [inventura] = await db.select({
      id: inventureTable.id,
      documentPath: inventureTable.documentPath,
    }).from(inventureTable)
      .where(and(eq(inventureTable.id, inventuraId), eq(inventureTable.enotaId, req.enotaId)))
      .limit(1);
    if (!inventura?.documentPath || !validInventoryObjectPath(inventura.documentPath)) {
      res.status(404).json({ error: "Dokument inventure ni najden" });
      return;
    }

    const docs = await db.select({
      companyId: documentsTable.companyId,
      fileName: documentsTable.fileName,
      mimeType: documentsTable.mimeType,
      fileSizeBytes: documentsTable.fileSizeBytes,
    }).from(documentsTable).where(eq(documentsTable.objectPath, inventura.documentPath));
    if (!docs.length || docs.some(doc => doc.companyId !== req.companyId)) {
      res.status(404).json({ error: "Dokument inventure ni najden" });
      return;
    }
    const [document] = docs;
    if (!["application/pdf", "image/jpeg", "image/png"].includes(document!.mimeType)) {
      res.status(404).json({ error: "Dokument inventure ni najden" });
      return;
    }

    const file = await objectStorageService.getObjectEntityFile(inventura.documentPath);
    const filename = document!.fileName.replace(/[\r\n]/g, " ").trim() || "inventory-document";
    const safeAsciiFilename = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "inventory-document";
    const encodedFilename = encodeURIComponent(filename).replace(/[!'()*]/g, char =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    res.setHeader("Content-Type", document!.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${safeAsciiFilename}"; filename*=UTF-8''${encodedFilename}`);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (document!.fileSizeBytes !== null && document!.fileSizeBytes >= 0) {
      res.setHeader("Content-Length", String(document!.fileSizeBytes));
    }
    const stream = file.createReadStream();
    stream.on("error", (error: Error) => {
      req.log?.error({ err: error, inventuraId }, "Could not stream inventory document");
      if (!res.headersSent) res.status(404).end();
      else res.destroy(error);
    });
    stream.pipe(res);
  } catch (error) {
    req.log?.error({ err: error, inventuraId }, "Could not retrieve inventory document");
    res.status(404).json({ error: "Dokument inventure ni najden" });
  }
});

/**
 * Vrne Date z uro 23:59:59 UTC za dani datum "YYYY-MM-DD".
 * Frontend prikazuje datum v UTC (timeZone:"UTC"), zato je prikazan datum
 * vedno pravilen ne glede na časovni pas brskalnika.
 */
function endOfDayUTC(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 0));
}

async function nextStevilkaInventura(year: number, tenotaId: number): Promise<string> {
  const yy = String(year).slice(-2);
  const result = await db.execute(
    sql`SELECT COALESCE(MAX(CAST(SUBSTRING(stevilka, 3) AS INTEGER)), 0) + 1 AS next FROM inventure WHERE stevilka LIKE ${`${yy}%`} AND LENGTH(stevilka) = 8 AND enota_id = ${tenotaId}`
  );
  const nextSeq = Number((result.rows[0] as { next: string })?.next ?? 1);
  return `${yy}${String(nextSeq).padStart(6, "0")}`;
}

async function fetchZadnjeCene(artikelIds: number[], beforeDate?: Date): Promise<Map<number, number>> {
  if (!artikelIds.length) return new Map();
  const rows = await db
    .select({
      artikelId: prejemnicePostavkeTable.artikelId,
      cenaKos: prejemnicePostavkeTable.cenaKos})
    .from(prejemnicePostavkeTable)
    .innerJoin(prejemniceTable, eq(prejemnicePostavkeTable.prejemnicaId, prejemniceTable.id))
    .where(beforeDate
      ? and(inArray(prejemnicePostavkeTable.artikelId, artikelIds), lte(prejemniceTable.datum, beforeDate))
      : inArray(prejemnicePostavkeTable.artikelId, artikelIds))
    .orderBy(desc(prejemniceTable.datum), desc(prejemniceTable.id));
  const map = new Map<number, number>();
  for (const r of rows) {
    if (r.artikelId != null && !map.has(r.artikelId)) map.set(r.artikelId, Number(r.cenaKos));
  }
  return map;
}

router.get("/inventure", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const rows = await db
    .select({
      id: inventureTable.id,
      stevilka: inventureTable.stevilka,
      datum: inventureTable.datum,
      opomba: inventureTable.opomba,
      documentPath: inventureTable.documentPath,
      ustvarjeno: inventureTable.ustvarjeno,
      steviloPostavk: count(inventurePostavkeTable.id)})
    .from(inventureTable)
    .leftJoin(inventurePostavkeTable, eq(inventurePostavkeTable.inventuraId, inventureTable.id))
    .where(and(eq(inventureTable.enotaId, tenotaId)))
    .groupBy(inventureTable.id)
    .orderBy(desc(inventureTable.datum));

  res.json(rows);
});

router.post("/inventure", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const actorSnapshot = (req as PosRequest).clerkUserId;
  const parsed = inventoryCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Neveljavni podatki inventure" });
    return;
  }

  const { datum, opomba, postavke } = parsed.data;
  const distinctArticleIds = new Set(postavke.map(p => p.artikelId));
  if (distinctArticleIds.size !== postavke.length) {
    res.status(400).json({ error: "Artikel je lahko na inventuri naveden samo enkrat" });
    return;
  }

  const artikelIds = postavke.map((p: any) => p.artikelId);
  if (parsed.data.documentPath !== undefined) {
    if (!validInventoryObjectPath(parsed.data.documentPath)) {
      res.status(400).json({ error: "Neveljavna pot priponke inventure" });
      return;
    }
    const ownedDocuments = await db.select({ companyId: documentsTable.companyId })
      .from(documentsTable).where(eq(documentsTable.objectPath, parsed.data.documentPath));
    if (!ownedDocuments.length || ownedDocuments.some(doc => doc.companyId !== (req as PosRequest).companyId)) {
      res.status(403).json({ error: "Priponka ni povezana s tem podjetjem" });
      return;
    }
  }

  // Inventura se vedno beleži ob 23:59:59 po Ljubljana času
  const docDatum = datum ? endOfDayUTC(datum) : (() => { const n = new Date(); n.setSeconds(59, 0); return n; })();
  const cutoff = new Date(docDatum);

  const [zalogaObDatumu, zadnjeCene, artikliRows] = await Promise.all([
    getZalogeObDatumu(artikelIds, cutoff),
    fetchZadnjeCene(artikelIds, cutoff),
    db.select({ id: artikliTable.id, ime: artikliTable.ime, imeZaNabavo: artikliTable.imeZaNabavo, enotaMere: artikliTable.enotaMere, drobniInventar: artikliTable.drobniInventar })
      .from(artikliTable)
      .where(and(inArray(artikliTable.id, artikelIds), sql`true`, eq(artikliTable.enotaId, tenotaId))),
  ]);
  const foundInvIds = new Set(artikliRows.map(a => a.id));
  const missingInvIds = artikelIds.filter((id: any) => !foundInvIds.has(id));
  if (missingInvIds.length > 0) {
    res.status(403).json({ error: "Nekateri artikli ne pripadajo temu podjetju" }); return;
  }
  const zalogeMap = new Map(Array.from(zalogaObDatumu.entries()).map(([id, v]) => [id, v.kolicina]));
  const artikelMap = new Map(artikliRows.map(a => [a.id, a]));
  const year = docDatum.getFullYear();
  const stevilka = await nextStevilkaInventura(year, tenotaId);

  const { inventura, postavkeResult } = await db.transaction(async (tx) => {
    const [inventura] = await tx.insert(inventureTable).values({
      enotaId: tenotaId,
      stevilka,
      datum: docDatum,
      opomba: opomba ?? null,
      documentPath: parsed.data.documentPath ?? null}).returning();

    const postavkeResult = [];
    for (const p of postavke) {
      const steviloNajdeno = p.steviloNajdeno ?? 0;
      const steviloPrejsnje = zalogeMap.get(p.artikelId) ?? 0;
      const razlika = steviloNajdeno - steviloPrejsnje;
      const cenaKos = resolveInventoryUnitPrice({
        drobniInventar: artikelMap.get(p.artikelId)?.drobniInventar ?? false,
        explicitPrice: p.cenaKos,
        inventoryPrice: zalogaObDatumu.get(p.artikelId)?.cenaKos,
        lastPurchasePrice: zadnjeCene.get(p.artikelId),
      });

      await tx.insert(inventurePostavkeTable).values({
        inventuraId: inventura.id,
        artikelId: p.artikelId,
        steviloNajdeno: String(steviloNajdeno),
        steviloPrejsnje: String(steviloPrejsnje),
        razlika: String(razlika),
        cenaKos: String(cenaKos)});

      await tx.insert(zalogaGibiTable).values({
        artikelId: p.artikelId,
        tip: "inventura",
        kolicina: String(razlika),
        cenaKos: String(cenaKos),
        vrednost: String(razlika * cenaKos),
        opomba: opomba ?? `Inventura #${inventura.id}`,
        referencaId: inventura.id,
        actorSnapshot,
        effectiveAtSnapshot: docDatum,
        sourceSnapshot: "inventura"});

      const art = artikelMap.get(p.artikelId);
      postavkeResult.push({
        id: inventura.id,
        artikelId: p.artikelId,
        artikelIme: art?.ime ?? "–",
        imeZaNabavo: art?.imeZaNabavo ?? null,
        enotaMere: art?.enotaMere ?? null,
        steviloNajdeno,
        steviloPrejsnje,
        razlika,
        cenaKos});
    }

    await recomputeZaloge(artikelIds, tx);

    return { inventura, postavkeResult };
  });
  broadcastToUnit(tenotaId, "update", { type: "zaloge" });

  res.status(201).json({
    id: inventura.id,
    stevilka: inventura.stevilka,
    datum: inventura.datum,
    opomba: inventura.opomba,
    documentPath: inventura.documentPath,
    ustvarjeno: inventura.ustvarjeno,
    postavke: postavkeResult});
});

router.get("/inventure/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [inventura] = await db.select().from(inventureTable)
    .where(and(eq(inventureTable.id, id), sql`true`, eq(inventureTable.enotaId, tenotaId)));
  if (!inventura) { res.status(404).json({ error: "Inventura ni najdena" }); return; }

  const postavke = await db
    .select({
      id: inventurePostavkeTable.id,
      artikelId: inventurePostavkeTable.artikelId,
      artikelIme: artikliTable.ime,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere: artikliTable.enotaMere,
      steviloNajdeno: inventurePostavkeTable.steviloNajdeno,
      steviloPrejsnje: inventurePostavkeTable.steviloPrejsnje,
      razlika: inventurePostavkeTable.razlika,
      cenaKos: inventurePostavkeTable.cenaKos})
    .from(inventurePostavkeTable)
    .leftJoin(artikliTable, eq(inventurePostavkeTable.artikelId, artikliTable.id))
    .where(eq(inventurePostavkeTable.inventuraId, id));

  res.json({
    id: inventura.id,
    stevilka: inventura.stevilka,
    datum: inventura.datum,
    opomba: inventura.opomba,
    documentPath: inventura.documentPath,
    ustvarjeno: inventura.ustvarjeno,
    postavke: postavke.map((p: any) => ({
      ...p,
      artikelIme: p.artikelIme ?? "–",
      steviloNajdeno: Number(p.steviloNajdeno),
      steviloPrejsnje: Number(p.steviloPrejsnje),
      razlika: Number(p.razlika),
      cenaKos: Number(p.cenaKos)}))});
});

router.put("/inventure/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const actorSnapshot = (req as PosRequest).clerkUserId;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const parsed = inventoryUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Neveljavni podatki inventure" });
    return;
  }

  const [existing] = await db.select().from(inventureTable)
    .where(and(eq(inventureTable.id, id), sql`true`, eq(inventureTable.enotaId, tenotaId)));
  if (!existing) { res.status(404).json({ error: "Inventura ni najdena" }); return; }

  let zadnjeCeneMap: Map<number, number> | undefined;
  let drobniInventarIds = new Set<number>();
  if (parsed.data.postavke !== undefined) {
    const novaPostavke = parsed.data.postavke;
    if (!novaPostavke.length) { res.status(400).json({ error: "Inventura mora imeti vsaj eno postavko" }); return; }

    const artikelIds = novaPostavke.map((p: any) => p.artikelId);
    if (new Set(artikelIds).size !== artikelIds.length) {
      res.status(400).json({ error: "Artikel je lahko na inventuri naveden samo enkrat" });
      return;
    }
    const putArtikliRows = await db.select({ id: artikliTable.id, drobniInventar: artikliTable.drobniInventar })
      .from(artikliTable)
      .where(and(inArray(artikliTable.id, artikelIds), sql`true`, eq(artikliTable.enotaId, tenotaId)));
    const putFoundIds = new Set(putArtikliRows.map(a => a.id));
    drobniInventarIds = new Set(putArtikliRows.filter(a => a.drobniInventar).map(a => a.id));
    const putMissingIds = artikelIds.filter((id: any) => !putFoundIds.has(id));
    if (putMissingIds.length > 0) {
      res.status(403).json({ error: "Nekateri artikli ne pripadajo temu podjetju" }); return;
    }

    const putCutoff = parsed.data.datum
      ? endOfDayUTC(parsed.data.datum)
      : new Date(existing.datum);
    zadnjeCeneMap = await fetchZadnjeCene(artikelIds, putCutoff);
  }

  let didUpdatePostavke = false;

  const [updated] = await db.transaction(async (tx) => {
    const txUpdates: Partial<typeof existing> = {};
    if (parsed.data.datum !== undefined) {
      txUpdates.datum = endOfDayUTC(parsed.data.datum);
    }
    if (parsed.data.opomba !== undefined) txUpdates.opomba = parsed.data.opomba;

    if (parsed.data.postavke !== undefined) {
      const novaPostavke = parsed.data.postavke;
      const artikelIds2 = novaPostavke.map((p: any) => p.artikelId);

      const oldPostavke = await tx.select().from(inventurePostavkeTable).where(eq(inventurePostavkeTable.inventuraId, id));
      const oldArtikleIds = oldPostavke.map((p: any) => p.artikelId);
      const oldPricesByArticle = new Map<number, number>(
        oldPostavke.flatMap((p: any) =>
          p.artikelId == null ? [] : [[p.artikelId, Number(p.cenaKos)] as [number, number]],
        ),
      );

      const reversedArtikelIds = await appendStockMovementReversals(tx, {
        referenceId: id,
        sourceSnapshots: ["inventura"],
        actorSnapshot,
        reversalSourceSnapshot: "inventura_reversal",
        note: `Razveljavitev inventure #${id} zaradi urejanja`,
        legacyKind: "inventura",
      });
      await tx.delete(inventurePostavkeTable).where(eq(inventurePostavkeTable.inventuraId, id));
      await recomputeZaloge([...new Set([...oldArtikleIds, ...reversedArtikelIds])], tx);

      // Stanje zalog ob koncu inventurnega dne (brez te inventure, ker smo jo ravno izbrisali)
      const putCutoff2 = parsed.data.datum
        ? endOfDayUTC(parsed.data.datum)
        : new Date(existing.datum);
      const zalogaObDatumu = await getZalogeObDatumu(artikelIds2, putCutoff2, tx);
      const zalogeMap = new Map(Array.from(zalogaObDatumu.entries()).map(([id2, v]) => [id2, v.kolicina]));

      for (const p of novaPostavke) {
        const steviloNajdeno = p.steviloNajdeno ?? 0;
        const steviloPrejsnje = zalogeMap.get(p.artikelId) ?? 0;
        const razlika = steviloNajdeno - steviloPrejsnje;
        const cenaKos = resolveInventoryUnitPrice({
          drobniInventar: drobniInventarIds.has(p.artikelId),
          explicitPrice: p.cenaKos,
          previousPrice: oldPricesByArticle.get(p.artikelId),
          inventoryPrice: zalogaObDatumu.get(p.artikelId)?.cenaKos,
          lastPurchasePrice: zadnjeCeneMap!.get(p.artikelId),
        });

        await tx.insert(inventurePostavkeTable).values({
          inventuraId: id,
          artikelId: p.artikelId,
          steviloNajdeno: String(steviloNajdeno),
          steviloPrejsnje: String(steviloPrejsnje),
          razlika: String(razlika),
          cenaKos: String(cenaKos)});

        await tx.insert(zalogaGibiTable).values({
          artikelId: p.artikelId,
          tip: "inventura",
          kolicina: String(razlika),
          cenaKos: String(cenaKos),
          vrednost: String(razlika * cenaKos),
          opomba: parsed.data.opomba ?? existing.opomba ?? `Inventura #${id}`,
          referencaId: id,
          actorSnapshot,
          effectiveAtSnapshot: putCutoff2,
          sourceSnapshot: "inventura"});
      }

      const allAffectedIds = [...new Set([...oldArtikleIds, ...reversedArtikelIds, ...artikelIds2])];
      await recomputeZaloge(allAffectedIds, tx);

      didUpdatePostavke = true;
    } else if (parsed.data.datum !== undefined && txUpdates.datum!.getTime() !== existing.datum.getTime()) {
      const newEffectiveDate = txUpdates.datum!;
      const existingPostavke = await tx.select().from(inventurePostavkeTable)
        .where(eq(inventurePostavkeTable.inventuraId, id));
      const artikelIds = existingPostavke.flatMap((p) => p.artikelId == null ? [] : [p.artikelId]);
      const drobniIds = artikelIds.length
        ? new Set((await tx.select({ id: artikliTable.id }).from(artikliTable)
          .where(and(inArray(artikliTable.id, artikelIds), eq(artikliTable.drobniInventar, true)))).map(a => a.id))
        : new Set<number>();
      const reversedArtikelIds = await appendStockMovementReversals(tx, {
        referenceId: id,
        sourceSnapshots: ["inventura"],
        actorSnapshot,
        reversalSourceSnapshot: "inventura_reversal",
        note: `Razveljavitev inventure #${id} zaradi spremembe datuma`,
        legacyKind: "inventura",
      });
      await recomputeZaloge([...new Set([...artikelIds, ...reversedArtikelIds])], tx);

      // Enako kot pri celotnem urejanju: ohranimo prešteto količino, vendar
      // razliko in vrednost določimo glede na stanje na nov inventurni dan.
      const zalogaObDatumu = await getZalogeObDatumu(artikelIds, newEffectiveDate, tx);
      for (const p of existingPostavke) {
        if (p.artikelId == null) continue;
        const steviloNajdeno = Number(p.steviloNajdeno);
        const steviloPrejsnje = zalogaObDatumu.get(p.artikelId)?.kolicina ?? 0;
        const razlika = steviloNajdeno - steviloPrejsnje;
        const cenaKos = resolveInventoryUnitPrice({
          drobniInventar: drobniIds.has(p.artikelId),
          previousPrice: Number(p.cenaKos),
          inventoryPrice: zalogaObDatumu.get(p.artikelId)?.cenaKos,
        });
        await tx.update(inventurePostavkeTable).set({
          steviloPrejsnje: String(steviloPrejsnje),
          razlika: String(razlika),
          cenaKos: String(cenaKos),
        }).where(eq(inventurePostavkeTable.id, p.id));
        await tx.insert(zalogaGibiTable).values({
          artikelId: p.artikelId,
          tip: "inventura",
          kolicina: String(razlika),
          cenaKos: String(cenaKos),
          vrednost: String(razlika * cenaKos),
          opomba: parsed.data.opomba ?? existing.opomba ?? `Inventura #${id}`,
          referencaId: id,
          actorSnapshot,
          effectiveAtSnapshot: newEffectiveDate,
          sourceSnapshot: "inventura",
        });
      }
      await recomputeZaloge([...new Set([...artikelIds, ...reversedArtikelIds])], tx);
      didUpdatePostavke = true;
    }

    return tx.update(inventureTable).set(txUpdates)
      .where(and(eq(inventureTable.id, id), sql`true`, eq(inventureTable.enotaId, tenotaId)))
      .returning();
  });

  if (didUpdatePostavke) broadcastToUnit(tenotaId, "update", { type: "zaloge" });

  const postavke = await db
    .select({
      id: inventurePostavkeTable.id,
      artikelId: inventurePostavkeTable.artikelId,
      artikelIme: artikliTable.ime,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere: artikliTable.enotaMere,
      steviloNajdeno: inventurePostavkeTable.steviloNajdeno,
      steviloPrejsnje: inventurePostavkeTable.steviloPrejsnje,
      razlika: inventurePostavkeTable.razlika,
      cenaKos: inventurePostavkeTable.cenaKos})
    .from(inventurePostavkeTable)
    .leftJoin(artikliTable, eq(inventurePostavkeTable.artikelId, artikliTable.id))
    .where(eq(inventurePostavkeTable.inventuraId, id));

  res.json({
    id: updated.id,
    stevilka: updated.stevilka,
    datum: updated.datum,
    opomba: updated.opomba,
    documentPath: updated.documentPath,
    ustvarjeno: updated.ustvarjeno,
    postavke: postavke.map((p: any) => ({
      ...p,
      artikelIme: p.artikelIme ?? "–",
      steviloNajdeno: Number(p.steviloNajdeno),
      steviloPrejsnje: Number(p.steviloPrejsnje),
      razlika: Number(p.razlika),
      cenaKos: Number(p.cenaKos)}))});
});

router.delete("/inventure/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const actorSnapshot = (req as PosRequest).clerkUserId;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [existing] = await db.select().from(inventureTable)
    .where(and(eq(inventureTable.id, id), sql`true`, eq(inventureTable.enotaId, tenotaId)));
  if (!existing) { res.status(404).json({ error: "Inventura ni najdena" }); return; }

  const postavke = await db.select().from(inventurePostavkeTable).where(eq(inventurePostavkeTable.inventuraId, id));
  const artikelIds = postavke.map((p: any) => p.artikelId);

  await db.transaction(async (tx) => {
    const reversedArtikelIds = await appendStockMovementReversals(tx, {
      referenceId: id,
      sourceSnapshots: ["inventura"],
      actorSnapshot,
      reversalSourceSnapshot: "inventura_reversal",
      note: `Razveljavitev izbrisane inventure #${id}`,
      legacyKind: "inventura",
    });
    await tx.delete(inventurePostavkeTable).where(eq(inventurePostavkeTable.inventuraId, id));
    await tx.delete(inventureTable).where(and(eq(inventureTable.id, id), sql`true`, eq(inventureTable.enotaId, tenotaId)));

    await recomputeZaloge([...new Set([...artikelIds, ...reversedArtikelIds])], tx);
  });

  broadcastToUnit(tenotaId, "update", { type: "zaloge" });
  res.status(204).send();
});

export default router;
