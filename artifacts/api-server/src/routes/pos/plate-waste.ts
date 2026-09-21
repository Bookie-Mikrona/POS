import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  companiesTable,
  db,
  enoteTable,
  plateWasteDailyEntriesTable,
  plateWasteHandoversTable,
  posUporabnikiTable,
} from "@workspace/db";
import {
  CreatePlateWasteHandoverBody,
  CreatePlateWasteHandoverResponse,
  DownloadPlateWasteExportQueryParams,
  GetPlateWasteOverviewQueryParams,
  GetPlateWasteOverviewResponse,
  SavePlateWasteDailyEntryBody,
  SavePlateWasteDailyEntryParams,
  SavePlateWasteDailyEntryResponse,
} from "@workspace/api-zod";
import type { PosRequest } from "../../middlewares/pos";
import { buildPlateWasteHandoverPdf } from "../../lib/plate-waste-pdf";

const router: IRouter = Router();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WASTE_TYPE = "Biološko razgradljivi kuhinjski odpadek";
const CATEGORY_CODE = "20 01 08" as const;
const SOURCE = "ostanki s krožnikov" as const;

function strictIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return value;
}

function parseDateRange(query: unknown) {
  const raw = query as Record<string, unknown>;
  const from = strictIsoDate(raw?.from);
  const to = strictIsoDate(raw?.to);
  if (!from || !to || from > to) return null;
  const parsed = GetPlateWasteOverviewQueryParams.safeParse({
    from: new Date(`${from}T00:00:00.000Z`),
    to: new Date(`${to}T00:00:00.000Z`),
  });
  if (!parsed.success) return null;
  return { from, to };
}

function mapDaily(
  row: typeof plateWasteDailyEntriesTable.$inferSelect,
  createdByName = row.createdBy,
) {
  return {
    id: row.id,
    enotaId: row.enotaId,
    businessDate: row.businessDate,
    quantityKg: Number(row.quantityKg),
    note: row.note,
    createdBy: row.createdBy,
    createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapHandover(
  row: typeof plateWasteHandoversTable.$inferSelect,
  createdByName = row.createdBy,
) {
  return {
    id: row.id,
    enotaId: row.enotaId,
    handoverDate: row.handoverDate,
    entryType: row.entryType,
    quantityKg: Number(row.quantityKg),
    collectorName: row.collectorName,
    manifestNumber: row.manifestNumber,
    note: row.note,
    correctionOfId: row.correctionOfId,
    createdBy: row.createdBy,
    createdByName,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadIdentity(enotaId: number) {
  const [identity] = await db.select({
    companyId: companiesTable.id,
    companyName: companiesTable.naziv,
    businessUnitName: enoteTable.ime,
  }).from(enoteTable)
    .innerJoin(companiesTable, eq(companiesTable.id, enoteTable.companyId))
    .where(eq(enoteTable.id, enotaId));
  return identity;
}

async function loadCreatorNames(
  companyId: string,
  enotaId: number,
  clerkUserIds: string[],
) {
  if (clerkUserIds.length === 0) return new Map<string, string>();
  const users = await db.select({
    clerkUserId: posUporabnikiTable.clerkUserId,
    ime: posUporabnikiTable.ime,
    priimek: posUporabnikiTable.priimek,
  }).from(posUporabnikiTable).where(and(
    eq(posUporabnikiTable.companyId, companyId),
    inArray(posUporabnikiTable.clerkUserId, clerkUserIds),
    or(eq(posUporabnikiTable.enotaId, enotaId), isNull(posUporabnikiTable.enotaId)),
  ));
  return new Map(users.map((user) => [
    user.clerkUserId,
    `${user.ime} ${user.priimek}`.trim() || user.clerkUserId,
  ]));
}

router.get("/plate-waste", async (req: Request, res: Response): Promise<void> => {
  const range = parseDateRange(req.query);
  if (!range) {
    res.status(400).json({ error: "Neveljavno obdobje evidence." });
    return;
  }

  const enotaId = (req as PosRequest).enotaId;
  const [identity, entries, handovers] = await Promise.all([
    loadIdentity(enotaId),
    db.select().from(plateWasteDailyEntriesTable).where(and(
      eq(plateWasteDailyEntriesTable.enotaId, enotaId),
      gte(plateWasteDailyEntriesTable.businessDate, range.from),
      lte(plateWasteDailyEntriesTable.businessDate, range.to),
    )).orderBy(asc(plateWasteDailyEntriesTable.businessDate)),
    db.select().from(plateWasteHandoversTable).where(and(
      eq(plateWasteHandoversTable.enotaId, enotaId),
      gte(plateWasteHandoversTable.handoverDate, range.from),
      lte(plateWasteHandoversTable.handoverDate, range.to),
    )).orderBy(asc(plateWasteHandoversTable.handoverDate), asc(plateWasteHandoversTable.createdAt)),
  ]);
  if (!identity) {
    res.status(404).json({ error: "Poslovna enota ne obstaja." });
    return;
  }

  const creatorNames = await loadCreatorNames(identity.companyId, enotaId, [
    ...entries.map((entry) => entry.createdBy),
    ...handovers.map((handover) => handover.createdBy),
  ]);
  const mappedEntries = entries.map((entry) => mapDaily(entry, creatorNames.get(entry.createdBy)));
  const mappedHandovers = handovers.map((handover) => mapHandover(handover, creatorNames.get(handover.createdBy)));
  const generatedQuantityKg = mappedEntries.reduce((sum, entry) => sum + entry.quantityKg, 0);
  const handedOverQuantityKg = mappedHandovers.reduce((sum, handover) => sum + handover.quantityKg, 0);
  res.json(GetPlateWasteOverviewResponse.parse({
    categoryCode: CATEGORY_CODE,
    wasteType: WASTE_TYPE,
    source: SOURCE,
    companyName: identity.companyName,
    businessUnitName: identity.businessUnitName,
    entries: mappedEntries,
    handovers: mappedHandovers,
    summary: {
      generatedQuantityKg,
      handedOverQuantityKg,
      remainingQuantityKg: generatedQuantityKg - handedOverQuantityKg,
    },
  }));
});

router.put("/plate-waste/daily/:date", async (req: Request, res: Response): Promise<void> => {
  const rawDate = strictIsoDate(String(req.params.date));
  const params = SavePlateWasteDailyEntryParams.safeParse({
    date: rawDate ? new Date(`${rawDate}T00:00:00.000Z`) : req.params.date,
  });
  const body = SavePlateWasteDailyEntryBody.safeParse(req.body);
  if (!rawDate || !params.success || !body.success) {
    res.status(400).json({ error: "Neveljavni podatki dnevne evidence." });
    return;
  }
  const businessDate = rawDate;

  const posReq = req as PosRequest;
  const identity = await loadIdentity(posReq.enotaId);
  if (!identity) {
    res.status(404).json({ error: "Poslovna enota ne obstaja." });
    return;
  }
  const note = body.data.note?.trim() ?? "";
  const [row] = await db.insert(plateWasteDailyEntriesTable).values({
    enotaId: posReq.enotaId,
    businessDate,
    quantityKg: String(body.data.quantityKg),
    note,
    createdBy: posReq.clerkUserId,
  }).onConflictDoUpdate({
    target: [plateWasteDailyEntriesTable.enotaId, plateWasteDailyEntriesTable.businessDate],
    set: {
      quantityKg: String(body.data.quantityKg),
      note,
      updatedAt: new Date(),
    },
  }).returning();

  const creatorNames = await loadCreatorNames(identity.companyId, posReq.enotaId, [row.createdBy]);
  res.json(SavePlateWasteDailyEntryResponse.parse(mapDaily(row, creatorNames.get(row.createdBy))));
});

router.post("/plate-waste/handovers", async (req: Request, res: Response): Promise<void> => {
  const rawHandoverDate = strictIsoDate((req.body as Record<string, unknown> | undefined)?.handoverDate);
  const body = CreatePlateWasteHandoverBody.safeParse({
    ...req.body,
    handoverDate: rawHandoverDate ? new Date(`${rawHandoverDate}T00:00:00.000Z`) : req.body?.handoverDate,
  });
  if (!rawHandoverDate || !body.success) {
    res.status(400).json({ error: "Neveljavni podatki oddaje." });
    return;
  }
  const data = body.data;
  const handoverDate = rawHandoverDate;
  if (data.entryType === "oddaja" && data.quantityKg <= 0) {
    res.status(422).json({ error: "Količina oddaje mora biti večja od 0 kg." });
    return;
  }
  if (data.entryType === "popravek" && data.quantityKg === 0) {
    res.status(422).json({ error: "Popravek ne sme biti 0 kg." });
    return;
  }
  if (data.entryType === "popravek" && data.correctionOfId == null) {
    res.status(422).json({ error: "Popravek mora biti vezan na izvirno oddajo." });
    return;
  }
  if (data.entryType === "oddaja" && data.correctionOfId != null) {
    res.status(422).json({ error: "Običajna oddaja ne sme imeti povezave na popravek." });
    return;
  }

  const posReq = req as PosRequest;
  const identity = await loadIdentity(posReq.enotaId);
  if (!identity) {
    res.status(404).json({ error: "Poslovna enota ne obstaja." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    if (data.entryType === "popravek") {
      const originalResult = await tx.execute(sql`
        SELECT id, quantity_kg::float8 AS quantity_kg
        FROM plate_waste_handovers
        WHERE id = ${data.correctionOfId}
          AND enota_id = ${posReq.enotaId}
          AND entry_type = 'oddaja'
        FOR UPDATE
      `);
      const original = originalResult.rows[0] as { id: number; quantity_kg: number } | undefined;
      if (!original) {
        return { error: "Izvirna oddaja ne obstaja v aktivni poslovni enoti." as const };
      }
      const correctionsResult = await tx.execute(sql`
        SELECT COALESCE(SUM(quantity_kg), 0)::float8 AS quantity_kg
        FROM plate_waste_handovers
        WHERE correction_of_id = ${original.id}
          AND enota_id = ${posReq.enotaId}
          AND entry_type = 'popravek'
      `);
      const existingCorrections = Number(
        (correctionsResult.rows[0] as { quantity_kg?: number } | undefined)?.quantity_kg ?? 0,
      );
      if (original.quantity_kg + existingCorrections + data.quantityKg < 0) {
        return { error: "Popravek bi zmanjšal neto oddano količino pod 0 kg." as const };
      }
    }

    const [row] = await tx.insert(plateWasteHandoversTable).values({
      enotaId: posReq.enotaId,
      handoverDate,
      entryType: data.entryType,
      quantityKg: String(data.quantityKg),
      collectorName: data.collectorName.trim(),
      manifestNumber: data.manifestNumber?.trim() ?? "",
      note: data.note?.trim() ?? "",
      correctionOfId: data.correctionOfId ?? null,
      createdBy: posReq.clerkUserId,
    }).returning();
    return { row };
  });
  if ("error" in result) {
    res.status(422).json({ error: result.error });
    return;
  }

  const creatorNames = await loadCreatorNames(identity.companyId, posReq.enotaId, [result.row.createdBy]);
  res.status(201).json(CreatePlateWasteHandoverResponse.parse(
    mapHandover(result.row, creatorNames.get(result.row.createdBy)),
  ));
});

router.get("/plate-waste/handovers/:id/pdf", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Neveljaven zapis oddaje." });
    return;
  }

  const enotaId = (req as PosRequest).enotaId;
  const [identity, handover] = await Promise.all([
    loadIdentity(enotaId),
    db.select().from(plateWasteHandoversTable).where(and(
      eq(plateWasteHandoversTable.id, id),
      eq(plateWasteHandoversTable.enotaId, enotaId),
    )),
  ]);
  if (!identity || !handover[0]) {
    res.status(404).json({ error: "Zapis oddaje ne obstaja." });
    return;
  }

  const record = handover[0];
  const creatorNames = await loadCreatorNames(identity.companyId, enotaId, [record.createdBy]);
  const pdf = await buildPlateWasteHandoverPdf({
    companyName: identity.companyName,
    businessUnitName: identity.businessUnitName,
    categoryCode: CATEGORY_CODE,
    wasteType: WASTE_TYPE,
    source: SOURCE,
    handoverDate: record.handoverDate,
    entryType: record.entryType,
    quantityKg: Number(record.quantityKg),
    collectorName: record.collectorName,
    manifestNumber: record.manifestNumber,
    note: record.note,
    correctionOfId: record.correctionOfId,
    createdByName: creatorNames.get(record.createdBy) ?? record.createdBy,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="odpadki-kroznik-${record.id}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(pdf);
});

router.get("/plate-waste/export", async (req: Request, res: Response): Promise<void> => {
  const range = parseDateRange(req.query);
  const parsed = DownloadPlateWasteExportQueryParams.safeParse({
    from: range ? new Date(`${range.from}T00:00:00.000Z`) : req.query.from,
    to: range ? new Date(`${range.to}T00:00:00.000Z`) : req.query.to,
  });
  if (!range || !parsed.success) {
    res.status(400).json({ error: "Neveljavno obdobje izvoza." });
    return;
  }
  const { from, to } = range;

  const enotaId = (req as PosRequest).enotaId;
  const [identity, entries, handovers] = await Promise.all([
    loadIdentity(enotaId),
    db.select().from(plateWasteDailyEntriesTable).where(and(
      eq(plateWasteDailyEntriesTable.enotaId, enotaId),
      gte(plateWasteDailyEntriesTable.businessDate, from),
      lte(plateWasteDailyEntriesTable.businessDate, to),
    )).orderBy(asc(plateWasteDailyEntriesTable.businessDate)),
    db.select().from(plateWasteHandoversTable).where(and(
      eq(plateWasteHandoversTable.enotaId, enotaId),
      gte(plateWasteHandoversTable.handoverDate, from),
      lte(plateWasteHandoversTable.handoverDate, to),
    )).orderBy(asc(plateWasteHandoversTable.handoverDate), asc(plateWasteHandoversTable.createdAt)),
  ]);
  if (!identity) {
    res.status(404).json({ error: "Poslovna enota ne obstaja." });
    return;
  }

  const creatorNames = await loadCreatorNames(identity.companyId, enotaId, [
    ...entries.map((entry) => entry.createdBy),
    ...handovers.map((handover) => handover.createdBy),
  ]);
  const escapeCsv = (value: unknown) => {
    let text = String(value ?? "");
    const plainSignedNumber = /^[+-]?\d+(?:[.,]\d+)?$/.test(text);
    if (!plainSignedNumber && /^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const lines = [
    ["Vrsta", "Datum", "Količina kg", "Zbiralec", "Številka evidenčnega lista", "Opomba", "Uporabnik"].map(escapeCsv).join(";"),
    ...entries.map((entry) => [
      "Nastanek", entry.businessDate, Number(entry.quantityKg).toFixed(3), "", "", entry.note,
      creatorNames.get(entry.createdBy) ?? entry.createdBy,
    ].map(escapeCsv).join(";")),
    ...handovers.map((handover) => [
      handover.entryType === "popravek" ? "Popravek oddaje" : "Oddaja",
      handover.handoverDate, Number(handover.quantityKg).toFixed(3), handover.collectorName,
      handover.manifestNumber, handover.note, creatorNames.get(handover.createdBy) ?? handover.createdBy,
    ].map(escapeCsv).join(";")),
  ];
  const filename = `odpadki-s-kroznikov-${from}-${to}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(`\uFEFF${lines.join("\n")}\n`);
});

export default router;