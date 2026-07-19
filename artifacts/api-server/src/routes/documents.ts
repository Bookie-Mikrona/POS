/**
 * documents.ts — AI/OCR obdelava dokumentov
 *
 * Tok:
 *   1. Frontend naloži datoteko na GCS via presigned URL (POST /storage/uploads/request-url)
 *   2. Frontend registrira dokument (POST /companies/:id/documents/register) → status: pending
 *   3. Backend takoj sproži async OCR (ne čaka na odgovor) → status: processing
 *   4. OCR konča → status: done + ocrResult
 *   5. Računovodja potrdi (POST .../confirm) → status: confirmed + opcijsko draft račun
 */

import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, desc, sql, asc, inArray } from "drizzle-orm";
import {
  db,
  documentsTable,
  accountingRolesTable,
  counterpartiesTable,
  accountsTable,
  vatCodesTable,
  invoicesTable,
  invoiceLinesTable,
  accountingPeriodsTable,
  counterpartyAccountTemplatesTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { OcrResult, ProposedLine } from "@workspace/db";

const router: IRouter = Router();

function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

async function resolveAccess(
  clerkUserId: string,
  companyId: string,
  res: Response,
): Promise<{ role: "owner" | "accountant" | "viewer" } | null> {
  const [row] = await db
    .select({ role: accountingRolesTable.role })
    .from(accountingRolesTable)
    .where(and(eq(accountingRolesTable.clerkUserId, clerkUserId), eq(accountingRolesTable.companyId, companyId)))
    .limit(1);
  if (!row) { res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" }); return null; }
  return { role: row.role };
}

const storage = new ObjectStorageService();

// ─── OCR logika ────────────────────────────────────────────────────────────────

/**
 * Pridobi vsebino datoteke iz GCS za posredovanje Claudu.
 * Podprti formati: PDF, JPEG, PNG, WEBP.
 */
type ClaudeFileSource =
  | { contentType: "image"; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string }
  | { contentType: "document"; media_type: "application/pdf"; data: string };

async function fetchFileForClaude(objectPath: string, mimeType: string): Promise<ClaudeFileSource> {
  const normalizedPath = objectPath.startsWith("/objects/")
    ? objectPath.slice("/objects/".length)
    : objectPath;

  const file = await storage.getObjectEntityFile(`/objects/${normalizedPath}`);
  const [fileContents] = await file.download();
  const base64 = fileContents.toString("base64");

  if (mimeType === "application/pdf") {
    return { contentType: "document", media_type: "application/pdf", data: base64 };
  }
  const imgMimes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
  type ImgMime = (typeof imgMimes)[number];
  const mt = (imgMimes.includes(mimeType as ImgMime) ? mimeType : "image/jpeg") as ImgMime;
  return { contentType: "image", media_type: mt, data: base64 };
}

/**
 * Pokliče Claude Vision za ekstrakcijo podatkov iz dokumenta.
 * Vrne strukturiran OcrResult.
 */
async function runOcrWithClaude(
  objectPath: string,
  mimeType: string,
  companyId: string,
): Promise<OcrResult> {
  // Pridobi kontekst (partnerji + konte + pretekle knjižbe) za boljše predloge
  const [counterparties, accounts, vatCodes, recentBookingRows, templateRows] = await Promise.all([
    db.select({ id: counterpartiesTable.id, name: counterpartiesTable.name, taxId: counterpartiesTable.taxId })
      .from(counterpartiesTable)
      .where(and(eq(counterpartiesTable.companyId, companyId), eq(counterpartiesTable.isActive, true)))
      .limit(100),
    db.select({ id: accountsTable.id, code: accountsTable.code, name: accountsTable.name })
      .from(accountsTable)
      .where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.isActive, true)))
      .orderBy(asc(accountsTable.code))
      .limit(200),
    db.select({ id: vatCodesTable.id, code: vatCodesTable.code, rate: vatCodesTable.rate })
      .from(vatCodesTable)
      .where(and(eq(vatCodesTable.companyId, companyId), eq(vatCodesTable.isActive, true))),
    // Pretekle potrjene knjižbe za učenje vzorcev kontiranja po partnerjih
    db.select({
      counterpartyId: counterpartiesTable.id,
      counterpartyName: counterpartiesTable.name,
      invoiceType: invoicesTable.type,
      lineDescription: invoiceLinesTable.description,
      accountCode: accountsTable.code,
      accountName: accountsTable.name,
      vatRate: invoiceLinesTable.vatRate,
    })
      .from(invoiceLinesTable)
      .innerJoin(invoicesTable, eq(invoiceLinesTable.invoiceId, invoicesTable.id))
      .innerJoin(counterpartiesTable, eq(invoicesTable.counterpartyId, counterpartiesTable.id))
      .innerJoin(accountsTable, eq(invoiceLinesTable.accountId, accountsTable.id))
      .where(
        and(
          eq(invoicesTable.companyId, companyId),
          inArray(invoicesTable.status, ["posted", "paid"]),
        ),
      )
      .orderBy(desc(invoicesTable.createdAt))
      .limit(100),
    // Shranjene predloge kontiranja po partnerju — nastanejo ob potrditvi dokumenta
    db.select({
      counterpartyId: counterpartyAccountTemplatesTable.counterpartyId,
      counterpartyName: counterpartiesTable.name,
      accountId: counterpartyAccountTemplatesTable.accountId,
      accountCode: accountsTable.code,
      accountName: accountsTable.name,
      documentType: counterpartyAccountTemplatesTable.documentType,
      lastLineDescription: counterpartyAccountTemplatesTable.lastLineDescription,
      usageCount: counterpartyAccountTemplatesTable.usageCount,
    })
      .from(counterpartyAccountTemplatesTable)
      .innerJoin(counterpartiesTable, eq(counterpartyAccountTemplatesTable.counterpartyId, counterpartiesTable.id))
      .innerJoin(accountsTable, eq(counterpartyAccountTemplatesTable.accountId, accountsTable.id))
      .where(eq(counterpartyAccountTemplatesTable.companyId, companyId))
      .orderBy(desc(counterpartyAccountTemplatesTable.usageCount))
      .limit(200),
  ]);

  // Združi shranjene predloge po partnerjih
  const templatesByCounterparty = new Map<string, typeof templateRows>();
  for (const row of templateRows) {
    const existing = templatesByCounterparty.get(row.counterpartyId) ?? [];
    existing.push(row);
    templatesByCounterparty.set(row.counterpartyId, existing);
  }
  const templatesContext = templatesByCounterparty.size > 0
    ? Array.from(templatesByCounterparty.entries())
        .map(([, rows]) => {
          const cpName = rows[0].counterpartyName;
          const lines = rows.map(r =>
            `    • [${r.usageCount}× potrjeno] ${r.documentType === "invoice_received" ? "prejet" : "izdan"} račun | "${r.lastLineDescription ?? "–"}" → konto ${r.accountCode} (${r.accountName})`,
          ).join("\n");
          return `  ${cpName}:\n${lines}`;
        })
        .join("\n\n")
    : null;

  // Združi pretekle knjižbe po partnerjih — max 5 vrstic na partnerja
  const bookingsByCounterparty = new Map<string, typeof recentBookingRows>();
  for (const row of recentBookingRows) {
    const existing = bookingsByCounterparty.get(row.counterpartyId) ?? [];
    if (existing.length < 5) {
      existing.push(row);
      bookingsByCounterparty.set(row.counterpartyId, existing);
    }
  }
  const pastBookingsContext = bookingsByCounterparty.size > 0
    ? Array.from(bookingsByCounterparty.entries())
        .map(([, rows]) => {
          const cpName = rows[0].counterpartyName;
          const lines = rows.map(r =>
            `    • ${r.invoiceType === "received" ? "prejet" : "izdan"} račun | ${r.lineDescription} → konto ${r.accountCode} (${r.accountName}), DDV ${r.vatRate}%`,
          ).join("\n");
          return `  ${cpName}:\n${lines}`;
        })
        .join("\n\n")
    : "(še ni preteklih knjižb)";

  const counterpartyList = counterparties.map(c => `- ${c.name}${c.taxId ? ` (DDV: ${c.taxId})` : ""} [id: ${c.id}]`).join("\n");
  const accountList = accounts.map(a => `- ${a.code}: ${a.name} [id: ${a.id}]`).join("\n");
  const vatList = vatCodes.map(v => `- ${v.code} (${v.rate}%) [id: ${v.id}]`).join("\n");

  const source = await fetchFileForClaude(objectPath, mimeType);

  const prompt = `Si računovodski AI asistent za slovensko dvostavno knjigovodstvo. Iz priloženega dokumenta (računa/fakturo) ekstrahiraj vse računovodske podatke in vrni IZKLJUČNO veljaven JSON brez komentarjev.

KONTEKST PODJETJA:
Partnerji v sistemu:
${counterpartyList || "(ni partnerjev)"}

Kontni načrt (konte za knjiženje):
${accountList || "(ni kontov)"}

DDV kode:
${vatList || "(ni DDV kod)"}

SHRANJENE PREDLOGE KONTIRANJA PO PARTNERJIH (NAJVIŠJA PRIORITETA — te konte je računovodja že potrdil za istega partnerja):
${templatesContext ?? "(še ni shranjenih predlog)"}

PRETEKLE POTRJENE KNJIŽBE PO PARTNERJIH (sekundaren učni vzorec):
${pastBookingsContext}

TIPIČNI VZORCI KONTIRANJA ZA GOSTINSTVO (upoštevaj pri predlogih):
- Prejet račun za surovine/hrano (9,5% DDV):  BREME 3100 + 1601 | DOBRO 2200
- Prejet račun za pijačo (22% DDV):            BREME 3101 + 1600 | DOBRO 2201
- Prejet račun za embalažo (22% DDV):          BREME 3102 + 1600 | DOBRO 2202
- Prejet račun za računovodstvo (22% DDV):     BREME 4150 + 1600 | DOBRO 2203
- Prejet račun za najemnino (22% DDV):         BREME 410  + 1600 | DOBRO 2202
- Prejet račun za elektriko/vodo (22% DDV):    BREME 412  + 1600 | DOBRO 2202
- Prenos surovin v kuhinjo (interni):          BREME 4000 | DOBRO 3100
- Dnevni iztržek blagajne (gotovina):          BREME 1050 | DOBRO 8000/8002/8003/8004 + 2800/2801
- DDV stopnje: hrana v lokalu 9,5% (8000), sokovi 9,5% (8003), pijača+alkohol 22% (8002), embalaža 22% (8004)

NAVODILA:
1. Prepoznaj vrsto dokumenta: invoice_received (prejet od dobavitelja) ali invoice_issued (izdan kupcu)
2. Ekstrahiraj vse metapodatke: številka računa, datum, rok plačila, partner, naslov, DDV identifikacijska številka
3. Ekstrahiraj vse vrstice: opis, količina, cena/enoto, stopnja DDV, osnova, znesek DDV
4. Poišči partnerja v sistemu (fuzzy match po imenu ali DDV številki)
5. Če je partner prepoznan in ima SHRANJENE PREDLOGE (zgoraj), OBVEZNO uporabi točno te konte — to so konte, ki jih je računovodja že potrdil za tega partnerja
6. Če ni shranjenih predlog, preveri pretekle knjižbe (sekundarni vir)
7. Za vsako vrstico predlagaj najprimernejši konto iz zgornjega seznama — najprej shranjene predloge, nato pretekle knjižbe, nato tipične vzorce
8. Izračunaj skupne vsote
9. Oceni zaupnost prepoznave (0.0-1.0) — višja zaupnost, ko se konte ujemajo s shranjenimi predlogami (max 0.98 za shranjene predloge, max 0.85 za pretekle knjižbe)

VRNI TOČNO ta JSON (brez markdowna, brez besedila pred/po):
{
  "rawText": "celotno besedilo dokumenta",
  "confidence": 0.95,
  "counterpartyName": "Ime podjetja d.o.o.",
  "counterpartyTaxId": "SI12345678",
  "counterpartyAddress": "Naslov 1, 1000 Ljubljana",
  "invoiceNumber": "R-2024-001",
  "invoiceDate": "2024-01-15",
  "dueDate": "2024-02-14",
  "totalNet": 1000.00,
  "totalVat": 220.00,
  "totalGross": 1220.00,
  "currency": "EUR",
  "lines": [
    {
      "description": "Opis storitve",
      "quantity": 1,
      "unitPrice": 1000.00,
      "vatRate": 22,
      "vatBase": 1000.00,
      "vatAmount": 220.00,
      "accountCode": "400",
      "accountId": "uuid-konta-ali-null",
      "confidence": 0.9
    }
  ],
  "suggestedCounterpartyId": "uuid-partnerja-ali-null",
  "suggestedCounterpartyName": "Prepoznano ime partnerja",
  "suggestedDocumentType": "invoice_received"
}

Če nečesa ne prepoznaš, nastavi vrednost na null. Za accountId in suggestedCounterpartyId vrni točni UUID iz zgornjega seznama ali null.`;

  // Sestavi vsebinski blok glede na tip datoteke (PDF vs. slika)
  const fileBlock = source.contentType === "document"
    ? { type: "document" as const, source: { type: "base64" as const, media_type: source.media_type, data: source.data } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: source.media_type, data: source.data } };

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: [
          fileBlock as any,
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  const block = message.content[0];
  const rawText = block.type === "text" ? block.text : "{}";

  // Razčleni JSON — poskusi odpraviti morebitne markdown ovoje
  let jsonStr = rawText.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
  }

  let parsed: Partial<OcrResult>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return {
      rawText: rawText,
      confidence: 0,
      lines: [],
      error: `Napaka pri razčlenjevanju OCR odgovora: ${rawText.slice(0, 200)}`,
    };
  }

  return {
    rawText: parsed.rawText ?? rawText,
    confidence: parsed.confidence ?? 0,
    counterpartyName: parsed.counterpartyName ?? undefined,
    counterpartyTaxId: parsed.counterpartyTaxId ?? undefined,
    counterpartyAddress: parsed.counterpartyAddress ?? undefined,
    invoiceNumber: parsed.invoiceNumber ?? undefined,
    invoiceDate: parsed.invoiceDate ?? undefined,
    dueDate: parsed.dueDate ?? undefined,
    totalNet: parsed.totalNet ?? undefined,
    totalVat: parsed.totalVat ?? undefined,
    totalGross: parsed.totalGross ?? undefined,
    currency: parsed.currency ?? "EUR",
    lines: (parsed.lines ?? []) as ProposedLine[],
    suggestedCounterpartyId: parsed.suggestedCounterpartyId ?? undefined,
    suggestedCounterpartyName: parsed.suggestedCounterpartyName ?? undefined,
    suggestedDocumentType: parsed.suggestedDocumentType ?? undefined,
    suggestedPeriodId: undefined,
  };
}

/**
 * Async OCR: posodobi status na processing, pokliče Claude, shrani rezultat.
 * Napaka se shrani v errorMessage (dokument ne "pade" — računovodja vidi napako).
 */
async function processDocumentAsync(documentId: string, objectPath: string, mimeType: string, companyId: string): Promise<void> {
  try {
    await db.update(documentsTable).set({ status: "processing" }).where(eq(documentsTable.id, documentId));
    const ocrResult = await runOcrWithClaude(objectPath, mimeType, companyId);
    await db.update(documentsTable).set({
      status: ocrResult.error ? "error" : "done",
      ocrResult: ocrResult as any,
      errorMessage: ocrResult.error ?? null,
    }).where(eq(documentsTable.id, documentId));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(documentsTable).set({ status: "error", errorMessage: msg }).where(eq(documentsTable.id, documentId));
  }
}

// ─── GET /companies/:companyId/documents ──────────────────────────────────────
router.get(
  "/companies/:companyId/documents",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const { status, limit = "50" } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [eq(documentsTable.companyId, companyId)];
    if (status) conditions.push(eq(documentsTable.status, status as any));

    const documents = await db
      .select()
      .from(documentsTable)
      .where(and(...conditions))
      .orderBy(desc(documentsTable.createdAt))
      .limit(Math.min(parseInt(limit ?? "50", 10), 200));

    res.json({ documents });
  },
);

// ─── POST /companies/:companyId/documents/register ────────────────────────────
router.post(
  "/companies/:companyId/documents/register",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const { objectPath, fileName, mimeType, fileSizeBytes } = req.body as {
      objectPath: string; fileName: string; mimeType: string; fileSizeBytes?: number;
    };

    if (!objectPath || !fileName || !mimeType) {
      res.status(400).json({ error: "Polja objectPath, fileName in mimeType so obvezna" });
      return;
    }

    const allowed = ["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowed.includes(mimeType)) {
      res.status(400).json({ error: `Nepodprt format. Dovoljeni: ${allowed.join(", ")}` });
      return;
    }

    // Preveri dejno velikost datoteke iz GCS metapodatkov — ne zaupamo vrednosti odjemalca
    const MAX_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES ?? String(20 * 1024 * 1024), 10);
    const actualSizeBytes = await storage.getObjectEntitySizeBytes(objectPath);
    if (actualSizeBytes != null && actualSizeBytes > MAX_BYTES) {
      res.status(400).json({ error: `Datoteka je prevelika (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB)` });
      return;
    }

    // Prepričamo se, da objectPath še ni vezan na drug dokument (preprečimo ponovna vezava)
    const [existing] = await db
      .select({ id: documentsTable.id })
      .from(documentsTable)
      .where(eq(documentsTable.objectPath, objectPath))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "Dokument s to potjo že obstaja" });
      return;
    }

    const [doc] = await db.insert(documentsTable).values({
      companyId,
      objectPath,
      fileName,
      mimeType,
      fileSizeBytes: fileSizeBytes ?? null,
      status: "pending",
      uploadedByClerkId: authReq.clerkUserId,
    }).returning();

    res.status(201).json(doc);

    // Sproži OCR asinhrono (po odzivu)
    setImmediate(() => {
      processDocumentAsync(doc.id, objectPath, mimeType, companyId).catch(() => {});
    });
  },
);

// ─── GET /companies/:companyId/documents/:id ───────────────────────────────────
router.get(
  "/companies/:companyId/documents/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const [doc] = await db.select().from(documentsTable)
      .where(and(eq(documentsTable.id, id), eq(documentsTable.companyId, companyId)))
      .limit(1);
    if (!doc) { res.status(404).json({ error: "Dokument ni najden" }); return; }

    res.json(doc);
  },
);

// ─── POST /companies/:companyId/documents/:id/confirm ─────────────────────────
router.post(
  "/companies/:companyId/documents/:id/confirm",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za potrditev dokumenta potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const [doc] = await db.select().from(documentsTable)
      .where(and(eq(documentsTable.id, id), eq(documentsTable.companyId, companyId)))
      .limit(1);
    if (!doc) { res.status(404).json({ error: "Dokument ni najden" }); return; }
    if (doc.status !== "done") {
      res.status(400).json({ error: `Dokument ni v stanju 'done' (trenutno: ${doc.status})` });
      return;
    }

    const {
      documentType,
      counterpartyId,
      periodId,
      invoiceNumber,
      invoiceDate,
      dueDate,
      lines = [],
      createInvoice = false,
      arApAccountId,
    } = req.body as {
      documentType?: string;
      counterpartyId?: string;
      periodId?: string;
      invoiceNumber?: string;
      invoiceDate?: string;
      dueDate?: string;
      lines?: ProposedLine[];
      createInvoice?: boolean;
      arApAccountId?: string;
    };

    // Validacija: vse vrstice morajo imeti veljavni accountId iz kontnega načrta tega podjetja
    const submittedLines: ProposedLine[] = lines.length > 0 ? lines : ((doc.ocrResult?.lines ?? []) as ProposedLine[]);
    const allLineAccountIds = submittedLines.map(l => l.accountId).filter((id): id is string => !!id);
    const missingAccountLines = submittedLines.filter(l => !l.accountId);
    if (missingAccountLines.length > 0) {
      res.status(400).json({
        error: `${missingAccountLines.length} ${missingAccountLines.length === 1 ? "vrstica nima" : "vrstice nimajo"} izbranega konta — pred potrditvijo izberite konto za vsako vrstico`
      });
      return;
    }
    if (allLineAccountIds.length > 0) {
      const uniqueLineAccountIds = [...new Set(allLineAccountIds)];
      const validAccounts = await db
        .select({ id: accountsTable.id })
        .from(accountsTable)
        .where(and(
          inArray(accountsTable.id, uniqueLineAccountIds),
          eq(accountsTable.companyId, companyId),
          eq(accountsTable.isActive, true),
        ));
      const validIds = new Set(validAccounts.map(a => a.id));
      const invalidIds = uniqueLineAccountIds.filter(id => !validIds.has(id));
      if (invalidIds.length > 0) {
        res.status(400).json({
          error: `${invalidIds.length} ${invalidIds.length === 1 ? "konto ni najden" : "kontov ni najdenih"} v kontnem načrtu tega podjetja — preverite kontiranje pred potrditvijo`
        });
        return;
      }
    }

    // Sestavi confirmedData iz OCR + popravkov računovodje
    const base = doc.ocrResult ?? { rawText: "", confidence: 0, lines: [] };
    const confirmedData: OcrResult = {
      ...base,
      invoiceNumber: invoiceNumber ?? base.invoiceNumber,
      invoiceDate: invoiceDate ?? base.invoiceDate,
      dueDate: dueDate ?? base.dueDate,
      lines: lines.length > 0 ? lines : base.lines,
      suggestedCounterpartyId: counterpartyId ?? base.suggestedCounterpartyId,
      suggestedPeriodId: periodId ?? base.suggestedPeriodId,
      suggestedDocumentType: (documentType as OcrResult["suggestedDocumentType"]) ?? base.suggestedDocumentType,
    };

    let linkedInvoiceId: string | null = null;

    // Ustvari draft račun (opcijsko)
    if (createInvoice && counterpartyId && periodId && invoiceDate) {
      // Validacija partnerja in obdobja
      const [cp] = await db.select({ id: counterpartiesTable.id })
        .from(counterpartiesTable)
        .where(and(eq(counterpartiesTable.id, counterpartyId), eq(counterpartiesTable.companyId, companyId)))
        .limit(1);
      if (!cp) { res.status(400).json({ error: "Partner ni najden" }); return; }

      const [period] = await db.select({ id: accountingPeriodsTable.id })
        .from(accountingPeriodsTable)
        .where(and(eq(accountingPeriodsTable.id, periodId), eq(accountingPeriodsTable.companyId, companyId)))
        .limit(1);
      if (!period) { res.status(400).json({ error: "Obdobje ni najdeno" }); return; }

      // Validacija kontov vrstic — vsi morajo pripadati istemu podjetju
      const lineAccountIds = [...new Set((lines ?? []).filter(l => l.accountId).map((l) => l.accountId as string))];
      if (lineAccountIds.length > 0) {
        const validLineAccounts = await db
          .select({ id: accountsTable.id })
          .from(accountsTable)
          .where(and(
            inArray(accountsTable.id, lineAccountIds),
            eq(accountsTable.companyId, companyId),
          ));
        if (validLineAccounts.length !== lineAccountIds.length) {
          res.status(400).json({ error: "Eden ali več kontov vrstic ne pripada temu podjetju" });
          return;
        }
      }

      const invType = documentType === "invoice_issued" ? "issued" : "received";

      // Poišči privzete AR/AP konto (120 za izdane, 220 za prejete) če ni podan
      const arApPrefix = invType === "issued" ? "120" : "220";
      const revenuePrefix = invType === "issued" ? "760" : "400";

      const [resolvedArApAccount] = arApAccountId
        ? await db.select({ id: accountsTable.id })
            .from(accountsTable)
            .where(and(eq(accountsTable.id, arApAccountId), eq(accountsTable.companyId, companyId)))
            .limit(1)
        : await db.select({ id: accountsTable.id })
            .from(accountsTable)
            .where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.isActive, true),
              sql`${accountsTable.code} LIKE ${arApPrefix + "%"}`,
            ))
            .orderBy(asc(accountsTable.code))
            .limit(1);

      if (!resolvedArApAccount) {
        res.status(400).json({ error: `Privzeti AR/AP konto (${arApPrefix}*) ni najden — ročno izberite konto terjatev/obveznosti` });
        return;
      }

      // Poišči privzet prihodkovni/stroškovni konto za vrstice
      const [defaultAccount] = await db.select({ id: accountsTable.id })
        .from(accountsTable)
        .where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.isActive, true),
          sql`${accountsTable.code} LIKE ${revenuePrefix + "%"}`,
        ))
        .orderBy(asc(accountsTable.code))
        .limit(1);

      const invoice = await db.transaction(async (tx) => {
        const [inv] = await tx.insert(invoicesTable).values({
          companyId,
          type: invType as any,
          counterpartyId,
          periodId,
          invoiceNumber: invoiceNumber ?? `DRAFT-${doc.id.slice(0, 8)}`,
          invoiceDate: invoiceDate as string,
          dueDate: (dueDate ?? null) as string | null,
          status: "draft",
          arApAccountId: resolvedArApAccount.id,
          createdBy: authReq.clerkUserId,
          notes: `Ustvarjeno iz dokumenta: ${doc.fileName}`,
        } as any).returning({ id: invoicesTable.id });

        // Ustvari vrstice
        for (let i = 0; i < confirmedData.lines.length; i++) {
          const line = confirmedData.lines[i];
          const acctId = line.accountId ?? defaultAccount?.id;
          if (!acctId) continue;

          await tx.insert(invoiceLinesTable).values({
            invoiceId: inv.id,
            description: line.description,
            quantity: String(line.quantity),
            unitPrice: String(line.unitPrice),
            vatRate: String(line.vatRate),
            vatBase: String(line.vatBase),
            vatAmount: String(line.vatAmount),
            accountId: acctId,
            sequence: i,
          });
        }
        return inv;
      });

      linkedInvoiceId = invoice.id;
    }

    const [updated] = await db.update(documentsTable).set({
      status: "confirmed",
      documentType: (documentType ?? doc.documentType) as any,
      confirmedData: confirmedData as any,
      linkedInvoiceId,
    }).where(eq(documentsTable.id, id)).returning();

    // ── Upsert predlog kontiranja po partnerju ──────────────────────────────
    // Ob vsaki potrditvi shranimo par (partner + konto) za vsako vrstico.
    // Ob naslednjem dokumentu istega partnerja se ti pari predlagajo pred AI.
    if (counterpartyId && confirmedData.lines.length > 0) {
      const docTypeKey = confirmedData.suggestedDocumentType ?? documentType ?? "invoice_received";
      // Zberi unikatne accountId-je iz vrstic
      const lineAccountPairs = confirmedData.lines
        .filter((l) => l.accountId)
        .reduce<Map<string, string>>((acc, l) => {
          if (!acc.has(l.accountId!)) acc.set(l.accountId!, l.description ?? "");
          return acc;
        }, new Map());

      if (lineAccountPairs.size > 0) {
        await Promise.all(
          Array.from(lineAccountPairs.entries()).map(([acctId, desc]) =>
            db
              .insert(counterpartyAccountTemplatesTable)
              .values({
                companyId,
                counterpartyId,
                accountId: acctId,
                documentType: docTypeKey,
                lastLineDescription: desc || null,
                usageCount: 1,
                lastUsedAt: new Date(),
              })
              .onConflictDoUpdate({
                target: [
                  counterpartyAccountTemplatesTable.companyId,
                  counterpartyAccountTemplatesTable.counterpartyId,
                  counterpartyAccountTemplatesTable.accountId,
                  counterpartyAccountTemplatesTable.documentType,
                ],
                set: {
                  usageCount: sql`${counterpartyAccountTemplatesTable.usageCount} + 1`,
                  lastLineDescription: desc || null,
                  lastUsedAt: new Date(),
                },
              }),
          ),
        );
      }
    }

    res.json(updated);
  },
);

// ─── POST /companies/:companyId/documents/:id/reject ──────────────────────────
router.post(
  "/companies/:companyId/documents/:id/reject",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za zavrnitev dokumenta potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const [doc] = await db.select({ id: documentsTable.id, companyId: documentsTable.companyId })
      .from(documentsTable)
      .where(and(eq(documentsTable.id, id), eq(documentsTable.companyId, companyId)))
      .limit(1);
    if (!doc) { res.status(404).json({ error: "Dokument ni najden" }); return; }

    const [updated] = await db.update(documentsTable).set({ status: "rejected" })
      .where(eq(documentsTable.id, id)).returning();

    res.json(updated);
  },
);

export default router;
