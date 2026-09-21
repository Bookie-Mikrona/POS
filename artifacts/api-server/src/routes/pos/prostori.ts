import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import JSZip from "jszip";
import QRCode from "qrcode";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { companiesTable, db, enoteTable, mizeTable, prostoriTable, tlorisiTable, tlorisPostavkeTable } from "@workspace/db";
import { GetProstorTlorisParams, GetProstorTlorisResponse, ResetProstorTlorisBody, ResetProstorTlorisParams, ResetProstorTlorisResponse, UpdateProstorTlorisBody, UpdateProstorTlorisParams, UpdateProstorTlorisResponse } from "@workspace/api-zod";
import { broadcast } from "../../lib/pos-sse";
import { requireMizaQrAdmin } from "./mize";
import { generateQrMizePdf } from "../../lib/report-pdf";
import { createQrActivationSession, setQrActivationCookie } from "../javnoMeni";

const router: IRouter = Router();
const MAX_TLORIS_POSTAVK = 500;
const MAX_TLORIS_JSON_BYTES = 10_000;

function canEditTloris(req: any): boolean {
  return ["admin", "admin_enote", "superadmin"].includes(req.vloga);
}

function jsonSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function tlorisResponse(layout: any, items: any[]) {
  return {
    version: layout?.version ?? 0,
    width: layout?.sirina ?? 1200,
    height: layout?.visina ?? 800,
    gridSize: layout?.mreza ?? 20,
    items: items.map((item) => ({
      id: item.id, kind: item.vrsta, tableId: item.mizaId ?? undefined,
      x: item.x, y: item.y, width: item.sirina, height: item.visina,
      rotation: item.rotacija, zIndex: item.zIndex, locked: item.zaklenjena,
      visible: item.vidna, style: item.slog, data: item.podatki,
    })),
  };
}

function validateTloris(data: any): string | null {
  if (!Number.isFinite(data.width) || !Number.isFinite(data.height) || !Number.isFinite(data.gridSize)
    || data.width < 100 || data.width > 10000 || data.height < 100 || data.height > 10000
    || data.gridSize < 1 || data.gridSize > 500 || data.items.length > MAX_TLORIS_POSTAVK) return "Dimenzije ali število postavk tlorisa niso veljavni.";
  const ids = new Set<string>();
  for (const item of data.items) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(item.id) || ids.has(item.id)) return "ID-ji postavk tlorisa morajo biti enolični in varni.";
    ids.add(item.id);
    if (![item.x, item.y, item.width, item.height, item.rotation, item.zIndex].every(Number.isFinite)
      || item.x < 0 || item.y < 0 || item.x + item.width > data.width || item.y + item.height > data.height
      || item.rotation < -3600 || item.rotation > 3600 || item.zIndex < -10000 || item.zIndex > 10000
      || jsonSize(item.style) > MAX_TLORIS_JSON_BYTES || jsonSize(item.data) > MAX_TLORIS_JSON_BYTES) return "Geometrija ali podatki postavke tlorisa niso veljavni.";
    if (item.kind === "table" && !item.tableId) return "Postavka mize mora imeti tableId.";
    if (item.kind !== "table" && item.tableId) return "Samo postavka vrste table lahko vsebuje tableId.";
    if (item.kind === "table" && item.data.oblika !== undefined && !["kvadrat", "pravokotnik_h", "pravokotnik_v", "okrogla"].includes(item.data.oblika)) return "Oblika mize ni veljavna.";
    if (item.kind === "wall" && item.style.strokeWidth !== undefined && (!Number.isFinite(item.style.strokeWidth) || item.style.strokeWidth <= 0 || item.style.strokeWidth > 100)) return "Debelina stene ni veljavna.";
    if ((item.kind === "door" || item.kind === "opening") && item.data.side !== undefined && !["left", "right", "top", "bottom"].includes(item.data.side)) return "Stran vrat oziroma odprtine ni veljavna.";
    if (item.kind === "label" && (typeof item.data.text !== "string" || item.data.text.length > 1000)) return "Oznaka tlorisa potrebuje besedilo do 1000 znakov.";
    if (item.kind === "zone" && item.data.name !== undefined && (typeof item.data.name !== "string" || item.data.name.length > 200)) return "Ime cone ni veljavno.";
    if (item.kind === "decoration" && item.data.type !== undefined && (typeof item.data.type !== "string" || item.data.type.length > 100)) return "Vrsta dekoracije ni veljavna.";
  }
  return null;
}

function javniMeniOrigin(): string | null {
  const rawOrigin = process.env.PUBLIC_MENU_ORIGIN?.trim();
  if (!rawOrigin) return null;
  try {
    const url = new URL(rawOrigin);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function novQrToken(): string {
  return randomBytes(32).toString("base64url");
}

class QrGeneriranjeNapaka extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function qrExportContentType(format: string): string {
  return format === "png" ? "image/png" : format === "zip" ? "application/zip" : "application/pdf";
}

const qrPortableImportSchema = z.object({
  version: z.literal(1),
  // Metadata is informational only. It must never be used as an authority for
  // selecting a company or a unit.
  exportedAt: z.string().datetime(),
  tables: z.array(z.object({
    stevilka: z.number().int().min(1).max(100_000),
    ime: z.string().trim().max(200).nullable(),
    prostor: z.string().trim().min(1).max(200).nullable(),
  }).strict()).min(1).max(500),
}).strict().superRefine((value, context) => {
  const numbers = new Set<number>();
  value.tables.forEach((table, index) => {
    if (numbers.has(table.stevilka)) context.addIssue({
      code: z.ZodIssueCode.custom, path: ["tables", index, "stevilka"],
      message: `Številka mize ${table.stevilka} je v datoteki podvojena.`,
    });
    numbers.add(table.stevilka);
  });
});

function qrImportDiagnostics(error: z.ZodError): string[] {
  return error.issues.slice(0, 50).map((issue) =>
    `${issue.path.length ? issue.path.join(".") : "datoteka"}: ${issue.message}`,
  );
}

router.get("/prostori", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rows = await db.select().from(prostoriTable)
    .where(and(eq(prostoriTable.enotaId, tenotaId)))
    .orderBy(asc(prostoriTable.vrstniRed), asc(prostoriTable.id));
  res.json((rows));
});

/**
 * Deliberately small, authenticated read model for the QR administration
 * screen.  Tokens themselves never leave this endpoint; an administrator gets
 * only the exact public URL that can be printed/tested.
 */
router.get("/qr-admin", requireMizaQrAdmin, async (req, res): Promise<void> => {
  const enotaId = Number((req as any).enotaId);
  const origin = javniMeniOrigin();
  if (!Number.isInteger(enotaId) || enotaId < 1) {
    res.status(400).json({ error: "Aktivna enota ni veljavna." });
    return;
  }
  const [prostori, mize] = await Promise.all([
    db.select({ id: prostoriTable.id, ime: prostoriTable.ime, vrstniRed: prostoriTable.vrstniRed })
      .from(prostoriTable).where(eq(prostoriTable.enotaId, enotaId))
      .orderBy(asc(prostoriTable.vrstniRed), asc(prostoriTable.id)),
    db.select({
      id: mizeTable.id, stevilka: mizeTable.stevilka, ime: mizeTable.ime,
      prostorId: mizeTable.prostorId, qrToken: mizeTable.qrToken,
    }).from(mizeTable).where(and(eq(mizeTable.enotaId, enotaId), eq(mizeTable.arhivirana, false)))
      .orderBy(asc(mizeTable.stevilka), asc(mizeTable.id)),
  ]);
  res.set("Cache-Control", "no-store").json({
    publicMenuOrigin: origin,
    prostori: prostori.map((prostor) => ({
      ...prostor,
      mize: mize.filter((miza) => miza.prostorId === prostor.id).map(({ qrToken, ...miza }) => ({
        ...miza,
        qrAktiven: Boolean(qrToken),
        javniUrl: qrToken && origin ? new URL(`/meni/${encodeURIComponent(qrToken)}`, origin).toString() : null,
      })),
    })),
    mizeBrezProstora: mize.filter((miza) => miza.prostorId === null).map(({ qrToken, ...miza }) => ({
      ...miza, qrAktiven: Boolean(qrToken),
      javniUrl: qrToken && origin ? new URL(`/meni/${encodeURIComponent(qrToken)}`, origin).toString() : null,
    })),
  });
});

router.post("/qr-admin/mize/:id/predogled", requireMizaQrAdmin, async (req, res): Promise<void> => {
  const enotaId = Number((req as any).enotaId);
  const mizaId = Number(req.params.id);
  const qrNapravaId = typeof req.body?.qrNapravaId === "string" ? req.body.qrNapravaId.trim() : "";
  const qrNapravaIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!Number.isInteger(enotaId) || enotaId < 1 || !Number.isInteger(mizaId) || mizaId < 1 || !qrNapravaIdPattern.test(qrNapravaId)) {
    res.status(400).json({ error: "Podatki za predogled QR menija niso veljavni." });
    return;
  }
  const [miza] = await db.select({
    id: mizeTable.id,
    qrToken: mizeTable.qrToken,
  }).from(mizeTable).where(and(
    eq(mizeTable.id, mizaId),
    eq(mizeTable.enotaId, enotaId),
    eq(mizeTable.arhivirana, false),
  )).limit(1);
  if (!miza?.qrToken) {
    res.status(404).json({ error: "Aktivna QR povezava za to mizo ni najdena." });
    return;
  }
  const origin = javniMeniOrigin();
  if (!origin) {
    res.status(503).json({ error: "Javni naslov QR menija ni nastavljen." });
    return;
  }
  const previewSession = createQrActivationSession({
    token: miza.qrToken,
    enotaId,
    mizaId: miza.id,
    qrNapravaId,
  });
  setQrActivationCookie(res, previewSession);
  res.set("Cache-Control", "no-store").json({
    javniUrl: new URL(`/meni/${encodeURIComponent(miza.qrToken)}`, origin).toString(),
    previewSession,
  });
});

router.post("/qr-admin/import", requireMizaQrAdmin, async (req, res): Promise<void> => {
  const enotaId = Number((req as any).enotaId);
  const mode = req.body?.mode;
  const parsed = qrPortableImportSchema.safeParse(req.body?.backup);
  if (!Number.isInteger(enotaId) || enotaId < 1) {
    res.status(400).json({ valid: false, errors: ["Aktivna enota ni veljavna."] });
    return;
  }
  if (mode !== "dry-run" && mode !== "apply") {
    res.status(400).json({ valid: false, errors: ["Način uvoza mora biti dry-run ali apply."] });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ valid: false, errors: qrImportDiagnostics(parsed.error) });
    return;
  }
  // The schema is strict on purpose: tokens, Wi-Fi credentials and arbitrary
  // future fields cannot hitch a ride in a portable QR configuration.
  const backup = parsed.data;
  const report = await db.transaction(async (tx) => {
    const existingRooms = await tx.select({ id: prostoriTable.id, ime: prostoriTable.ime, vrstniRed: prostoriTable.vrstniRed })
      .from(prostoriTable).where(eq(prostoriTable.enotaId, enotaId))
      .orderBy(asc(prostoriTable.vrstniRed), asc(prostoriTable.id));
    const existingTables = await tx.select({
      id: mizeTable.id, stevilka: mizeTable.stevilka, ime: mizeTable.ime,
      prostorId: mizeTable.prostorId,
    }).from(mizeTable).where(and(eq(mizeTable.enotaId, enotaId), eq(mizeTable.arhivirana, false)));
    const roomNames = new Set(existingRooms.map((room) => room.ime));
    const tableByNumber = new Map(existingTables.map((table) => [table.stevilka, table]));
    const newRooms = [...new Set(backup.tables.map((table) => table.prostor).filter((name): name is string => name !== null))]
      .filter((name) => !roomNames.has(name));
    const createTables = backup.tables.filter((table) => !tableByNumber.has(table.stevilka));
    const updateTables = backup.tables.filter((table) => {
      const existing = tableByNumber.get(table.stevilka);
      if (!existing) return false;
      const targetRoom = table.prostor === null ? null : existingRooms.find((room) => room.ime === table.prostor)?.id;
      return existing.ime !== table.ime || existing.prostorId !== targetRoom;
    });
    if (mode === "dry-run") return { createdRooms: newRooms.length, createdTables: createTables.length, updatedTables: updateTables.length, applied: false };

    // Explicitly lock only rows in this tenant. Import identifiers are never
    // accepted from the file, so a file cannot update a different tenant.
    const roomMap = new Map(existingRooms.map((room) => [room.ime, room.id]));
    let nextOrder = existingRooms.reduce((max, room) => Math.max(max, room.vrstniRed), 0) + 1;
    for (const name of newRooms) {
      const [room] = await tx.insert(prostoriTable).values({ enotaId, ime: name, vrstniRed: nextOrder++ }).returning({ id: prostoriTable.id });
      roomMap.set(name, room!.id);
    }
    for (const table of backup.tables) {
      const existing = tableByNumber.get(table.stevilka);
      const prostorId = table.prostor === null ? null : roomMap.get(table.prostor)!;
      if (existing) {
        await tx.update(mizeTable).set({ ime: table.ime, prostorId })
          .where(and(eq(mizeTable.id, existing.id), eq(mizeTable.enotaId, enotaId)));
      } else {
        await tx.insert(mizeTable).values({ enotaId, stevilka: table.stevilka, ime: table.ime, prostorId, kapaciteta: 4 });
      }
    }
    return { createdRooms: newRooms.length, createdTables: createTables.length, updatedTables: updateTables.length, applied: true };
  });
  if (report.applied) broadcast("update", { type: "miza" });
  res.json({ valid: true, errors: [], ...report });
});

router.get("/prostori/:id/tloris", async (req, res): Promise<void> => {
  const params = GetProstorTlorisParams.safeParse(req.params);
  const enotaId = (req as any).enotaId;
  if (!params.success || !Number.isInteger(enotaId)) { res.status(400).json({ error: "Neveljaven prostor ali aktivna enota." }); return; }
  const [prostor] = await db.select({ id: prostoriTable.id }).from(prostoriTable)
    .where(and(eq(prostoriTable.id, params.data.id), eq(prostoriTable.enotaId, enotaId)));
  if (!prostor) { res.status(404).json({ error: "Prostor ni najden." }); return; }
  const [layout] = await db.select().from(tlorisiTable).where(eq(tlorisiTable.prostorId, prostor.id));
  const items = layout ? await db.select().from(tlorisPostavkeTable).where(eq(tlorisPostavkeTable.tlorisId, layout.id)).orderBy(tlorisPostavkeTable.zIndex) : [];
  res.json(GetProstorTlorisResponse.parse(tlorisResponse(layout, items)));
});

router.put("/prostori/:id/tloris", async (req, res): Promise<void> => {
  const params = UpdateProstorTlorisParams.safeParse(req.params);
  const parsed = UpdateProstorTlorisBody.safeParse(req.body);
  const enotaId = (req as any).enotaId;
  if (!params.success || !parsed.success || !Number.isInteger(enotaId)) { res.status(400).json({ error: "Podatki tlorisa niso veljavni." }); return; }
  if (!canEditTloris(req)) { res.status(403).json({ error: "Urejanje tlorisa zahteva vlogo administratorja." }); return; }
  const invalid = validateTloris(parsed.data);
  if (invalid) { res.status(400).json({ error: invalid }); return; }
  const result = await db.transaction(async (tx) => {
    // Lock the room even before a layout exists, so first writes cannot race.
    const [prostor] = await tx.select({ id: prostoriTable.id }).from(prostoriTable)
      .where(and(eq(prostoriTable.id, params.data.id), eq(prostoriTable.enotaId, enotaId))).for("update");
    if (!prostor) return { state: "missing" as const };
    let [layout] = await tx.select().from(tlorisiTable).where(eq(tlorisiTable.prostorId, prostor.id)).for("update");
    if ((layout?.version ?? 0) !== parsed.data.version) return { state: "stale" as const, version: layout?.version ?? 0 };
    const tableIds = parsed.data.items.filter((i) => i.kind === "table").map((i) => i.tableId!);
    if (new Set(tableIds).size !== tableIds.length) return { state: "invalidTable" as const };
    const activeTables = await tx.select({ id: mizeTable.id, oblika: mizeTable.oblika }).from(mizeTable).where(and(
      eq(mizeTable.enotaId, enotaId), eq(mizeTable.prostorId, prostor.id), eq(mizeTable.arhivirana, false),
    )).for("update");
    if (tableIds.some((id) => !activeTables.some((table) => table.id === id))) return { state: "invalidTable" as const };
    // A save is a full document replacement, but operational tables may never
    // disappear: add deterministic automatic items for omitted active tables.
    const effectiveItems: any[] = [...parsed.data.items];
    for (const table of activeTables) {
      if (tableIds.includes(table.id)) continue;
      const width = 96; const height = 56;
      effectiveItems.push({
        id: `auto_${prostor.id}_${table.id}`, kind: "table", tableId: table.id,
        // Deliberately overlap on a too-small imported canvas rather than
        // placing a live table out of bounds or omitting it.
        x: 0, y: 0,
        width, height, rotation: 0, zIndex: 0, locked: false, visible: true,
        style: {}, data: { oblika: table.oblika ?? "pravokotnik_h", automatic: true },
      });
    }
    if (!layout) {
      [layout] = await tx.insert(tlorisiTable).values({ prostorId: prostor.id, version: 0, sirina: Math.round(parsed.data.width), visina: Math.round(parsed.data.height), mreza: Math.round(parsed.data.gridSize) }).returning();
    }
    const nextVersion = layout.version + 1;
    // A table may have been moved between rooms by a legacy endpoint. Remove
    // any old canonical representation before the unique table-item insert.
    const effectiveTableIds = effectiveItems.filter((item) => item.kind === "table").map((item) => item.tableId as number);
    if (effectiveTableIds.length) await tx.delete(tlorisPostavkeTable).where(inArray(tlorisPostavkeTable.mizaId, effectiveTableIds));
    await tx.delete(tlorisPostavkeTable).where(eq(tlorisPostavkeTable.tlorisId, layout.id));
    if (effectiveItems.length) await tx.insert(tlorisPostavkeTable).values(effectiveItems.map((item) => ({
      id: item.id, tlorisId: layout!.id, vrsta: item.kind, mizaId: item.kind === "table" ? item.tableId : null,
      x: Math.round(item.x), y: Math.round(item.y), sirina: Math.round(item.width), visina: Math.round(item.height),
      rotacija: Math.round(item.rotation), zIndex: Math.round(item.zIndex), zaklenjena: item.locked, vidna: item.visible,
      slog: item.style, podatki: item.data,
    })));
    await tx.update(tlorisiTable).set({ version: nextVersion, sirina: Math.round(parsed.data.width), visina: Math.round(parsed.data.height), mreza: Math.round(parsed.data.gridSize), posodobljeno: new Date() }).where(eq(tlorisiTable.id, layout.id));
    for (const item of effectiveItems.filter((i) => i.kind === "table")) await tx.update(mizeTable).set({
      posX: Math.round(item.x), posY: Math.round(item.y), tlorisSirina: Math.round(item.width), tlorisVisina: Math.round(item.height), tlorisRotacija: Math.round(item.rotation),
      ...(typeof item.data.oblika === "string" ? { oblika: item.data.oblika } : {}),
    }).where(and(eq(mizeTable.id, item.tableId!), eq(mizeTable.enotaId, enotaId)));
    return { state: "ok" as const, layout: { ...layout, version: nextVersion, sirina: Math.round(parsed.data.width), visina: Math.round(parsed.data.height), mreza: Math.round(parsed.data.gridSize) }, items: effectiveItems };
  });
  if (result.state === "missing") { res.status(404).json({ error: "Prostor ni najden." }); return; }
  if (result.state === "stale") { res.status(409).json({ error: "Tloris je medtem uredil drug uporabnik.", version: result.version }); return; }
  if (result.state === "invalidTable") { res.status(400).json({ error: "Izbrana miza ne pripada temu prostoru ali je arhivirana." }); return; }
  const response = tlorisResponse(result.layout, result.items.map((item: any) => ({
    id: item.id, vrsta: item.kind, mizaId: item.tableId ?? null, x: Math.round(item.x), y: Math.round(item.y), sirina: Math.round(item.width), visina: Math.round(item.height), rotacija: Math.round(item.rotation), zIndex: Math.round(item.zIndex), zaklenjena: item.locked, vidna: item.visible, slog: item.style, podatki: item.data,
  })));
  broadcast("update", { type: "tloris", prostorId: params.data.id, version: response.version });
  res.json(UpdateProstorTlorisResponse.parse(response));
});

router.post("/prostori/:id/tloris/reset", async (req, res): Promise<void> => {
  const params = ResetProstorTlorisParams.safeParse(req.params);
  const parsed = ResetProstorTlorisBody.safeParse(req.body);
  const enotaId = (req as any).enotaId;
  if (!params.success || !parsed.success || !Number.isInteger(enotaId)) { res.status(400).json({ error: "Podatki ponastavitve tlorisa niso veljavni." }); return; }
  if (!canEditTloris(req)) { res.status(403).json({ error: "Urejanje tlorisa zahteva vlogo administratorja." }); return; }
  const result = await db.transaction(async (tx) => {
    const [prostor] = await tx.select({ id: prostoriTable.id }).from(prostoriTable)
      .where(and(eq(prostoriTable.id, params.data.id), eq(prostoriTable.enotaId, enotaId))).for("update");
    if (!prostor) return { state: "missing" as const };
    let [layout] = await tx.select().from(tlorisiTable).where(eq(tlorisiTable.prostorId, prostor.id)).for("update");
    if ((layout?.version ?? 0) !== parsed.data.version) return { state: "stale" as const, version: layout?.version ?? 0 };
    const tables = await tx.select({ id: mizeTable.id, oblika: mizeTable.oblika }).from(mizeTable).where(and(
      eq(mizeTable.enotaId, enotaId), eq(mizeTable.prostorId, prostor.id), eq(mizeTable.arhivirana, false),
    )).for("update");
    if (tables.length > MAX_TLORIS_POSTAVK) {
      return { state: "tooMany" as const, version: layout?.version ?? 0, count: tables.length };
    }
    if (!layout) [layout] = await tx.insert(tlorisiTable).values({ prostorId: prostor.id }).returning();
    const canvasHeight = Math.min(10_000, Math.max(800, 20 + Math.ceil(tables.length / 10) * 75 + 20));
    const items = tables.map((table, index) => ({
      id: `auto_${prostor.id}_${table.id}`, vrsta: "table" as const, mizaId: table.id,
      x: 20 + (index % 10) * 110, y: 20 + Math.floor(index / 10) * 75, sirina: 96, visina: 56,
      rotacija: 0, zIndex: 0, zaklenjena: false, vidna: true, slog: {}, podatki: { oblika: table.oblika ?? "pravokotnik_h", automatic: true },
    }));
    const generatedValidation = validateTloris(tlorisResponse(
      { version: layout.version, sirina: 1200, visina: canvasHeight, mreza: 20 },
      items,
    ));
    if (generatedValidation) return { state: "generatedInvalid" as const, error: generatedValidation };
    if (tables.length) await tx.delete(tlorisPostavkeTable).where(inArray(tlorisPostavkeTable.mizaId, tables.map((table) => table.id)));
    await tx.delete(tlorisPostavkeTable).where(eq(tlorisPostavkeTable.tlorisId, layout.id));
    if (items.length) await tx.insert(tlorisPostavkeTable).values(items.map((item) => ({ ...item, tlorisId: layout!.id })));
    const version = layout.version + 1;
    await tx.update(tlorisiTable).set({ version, sirina: 1200, visina: canvasHeight, mreza: 20, posodobljeno: new Date() }).where(eq(tlorisiTable.id, layout.id));
    for (const item of items) await tx.update(mizeTable).set({
      posX: item.x, posY: item.y, tlorisSirina: item.sirina, tlorisVisina: item.visina, tlorisRotacija: item.rotacija,
    }).where(eq(mizeTable.id, item.mizaId));
    return { state: "ok" as const, layout: { ...layout, version, sirina: 1200, visina: canvasHeight, mreza: 20 }, items };
  });
  if (result.state === "missing") { res.status(404).json({ error: "Prostor ni najden." }); return; }
  if (result.state === "stale") { res.status(409).json({ error: "Tloris je medtem uredil drug uporabnik.", version: result.version }); return; }
  if (result.state === "tooMany") {
    res.status(409).json({ error: `Ponastavitev podpira največ ${MAX_TLORIS_POSTAVK} aktivnih miz.`, version: result.version, limit: MAX_TLORIS_POSTAVK, count: result.count });
    return;
  }
  if (result.state === "generatedInvalid") { res.status(400).json({ error: result.error }); return; }
  const response = tlorisResponse(result.layout, result.items);
  broadcast("update", { type: "tloris", prostorId: params.data.id, version: response.version });
  res.json(ResetProstorTlorisResponse.parse(response));
});

router.post("/prostori", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }
  const [row] = await db.insert(prostoriTable).values({
    enotaId: tenotaId,
    ime: parsed.data.ime,
    vrstniRed: parsed.data.vrstniRed ?? 0}).returning();
  broadcast("update", { type: "prostor" });
  res.status(201).json(row);
});

router.put("/prostori/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }
  const updateData: Partial<typeof prostoriTable.$inferInsert> = {};
  if (parsed.data.ime !== undefined) updateData.ime = parsed.data.ime;
  if (parsed.data.vrstniRed !== undefined) updateData.vrstniRed = parsed.data.vrstniRed;
  const [row] = await db.update(prostoriTable).set(updateData)
    .where(and(eq(prostoriTable.id, params.data.id), sql`true`, eq(prostoriTable.enotaId, tenotaId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Prostor ni najden" }); return; }
  broadcast("update", { type: "prostor" });
  res.json((row));
});

router.delete("/prostori/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  await db.update(mizeTable)
    .set({ prostorId: null })
    .where(and(eq(mizeTable.prostorId, params.data.id), sql`true`, eq(mizeTable.enotaId, tenotaId)));
  await db.delete(prostoriTable)
    .where(and(eq(prostoriTable.id, params.data.id), sql`true`, eq(prostoriTable.enotaId, tenotaId)));
  broadcast("update", { type: "prostor" });
  res.sendStatus(204);
});

router.post(
  "/prostori/:id/qr-kode",
  requireMizaQrAdmin,
  async (req, res): Promise<void> => {
    const enotaId = Number((req as any).enotaId);
    const prostorId = Number(req.params.id);
    if (!Number.isInteger(enotaId) || enotaId < 1 || !Number.isInteger(prostorId) || prostorId < 1) {
      res.status(400).json({ error: "Neveljaven prostor ali aktivna enota" });
      return;
    }
    const origin = javniMeniOrigin();
    if (!origin) {
      res.status(503).json({
        error: "Javni naslov QR menija ni nastavljen. Nastavite PUBLIC_MENU_ORIGIN na HTTPS domeno aplikacije.",
      });
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        const lockKey = `qr-kode-prostor:${enotaId}:${prostorId}`;
        const lockResult = await tx.execute<{ acquired: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS acquired`,
        );
        if (!lockResult.rows[0]?.acquired) {
          throw new QrGeneriranjeNapaka(409, "QR kode za ta prostor se že pripravljajo. Poskusite znova čez trenutek.");
        }

        const [context] = await tx
          .select({
            prostorIme: prostoriTable.ime,
            enotaIme: enoteTable.ime,
            podjetjeNaziv: companiesTable.naziv,
            qrWifiSsid: enoteTable.qrWifiSsid,
            qrWifiPassword: enoteTable.qrWifiPassword,
          })
          .from(prostoriTable)
          .innerJoin(enoteTable, eq(enoteTable.id, prostoriTable.enotaId))
          .innerJoin(companiesTable, eq(companiesTable.id, enoteTable.companyId))
          .where(and(eq(prostoriTable.id, prostorId), eq(prostoriTable.enotaId, enotaId)))
          .limit(1);
        if (!context) throw new QrGeneriranjeNapaka(404, "Prostor ni najden");

        const selectedTableIds = req.body?.tableIds;
        const rotate = req.body?.rotate !== false;
        if (selectedTableIds !== undefined && (!Array.isArray(selectedTableIds)
          || selectedTableIds.some((id) => !Number.isInteger(id) || id < 1)
          || new Set(selectedTableIds).size !== selectedTableIds.length)) {
          throw new QrGeneriranjeNapaka(400, "Izbor miz ni veljaven.");
        }
        const mize = await tx
          .select({ id: mizeTable.id, stevilka: mizeTable.stevilka, ime: mizeTable.ime, qrToken: mizeTable.qrToken })
          .from(mizeTable)
          .where(and(
            eq(mizeTable.enotaId, enotaId),
            eq(mizeTable.prostorId, prostorId),
            ...(selectedTableIds === undefined ? [] : [inArray(mizeTable.id, selectedTableIds)]),
          ))
          .orderBy(asc(mizeTable.stevilka), asc(mizeTable.id));
        if (mize.length === 0) {
          throw new QrGeneriranjeNapaka(409, "V tem prostoru ni miz, zato QR izpisa ni mogoče pripraviti.");
        }

        const qrMize = mize.map((miza) => {
          // Re-download must never silently invalidate a label.  A missing
          // legacy token is initialized, while an explicit rotation changes it.
          const qrToken = rotate || !miza.qrToken ? novQrToken() : miza.qrToken;
          return {
            id: miza.id,
            stevilka: miza.stevilka,
            ime: miza.ime,
            qrToken,
            javniUrl: new URL(`/meni/${encodeURIComponent(qrToken)}`, origin).toString(),
          };
        });
        // PDF in vse QR slike pripravimo pred zamenjavo starih žetonov. Če priprava
        // izpisa odpove, obstoječe natisnjene kode ostanejo veljavne.
        const exportFormat = req.body?.format ?? "pdf";
        if (!["pdf", "png", "zip"].includes(exportFormat)) {
          throw new QrGeneriranjeNapaka(400, "Format izvoza mora biti PDF, PNG ali ZIP.");
        }
        if (exportFormat === "png" && qrMize.length !== 1) {
          throw new QrGeneriranjeNapaka(400, "PNG izvoz je na voljo za eno izbrano mizo; za več miz uporabite ZIP.");
        }
        const pdfBuffer = exportFormat === "pdf" ? await generateQrMizePdf({
          podjetjeNaziv: context.podjetjeNaziv,
          enotaNaziv: context.enotaIme,
          prostorNaziv: context.prostorIme,
          qrWifiSsid: context.qrWifiSsid,
          qrWifiPassword: context.qrWifiPassword,
          createdAt: new Date(),
          mize: qrMize,
        }) : null;
        const imageBuffers = exportFormat === "pdf" ? [] : await Promise.all(qrMize.map((miza) =>
          QRCode.toBuffer(miza.javniUrl, { errorCorrectionLevel: "H", margin: 2, width: 1000 }),
        ));
        const exportBuffer = exportFormat === "pdf" ? pdfBuffer! : exportFormat === "png" ? imageBuffers[0]! : await (async () => {
          const zip = new JSZip();
          qrMize.forEach((miza, index) => zip.file(`qr-miza-${miza.stevilka}.png`, imageBuffers[index]!));
          return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
        })();

        for (const miza of qrMize.filter((miza) => rotate || !mize.find((old) => old.id === miza.id)?.qrToken)) {
          const [updated] = await tx
            .update(mizeTable)
            .set({ qrToken: miza.qrToken })
            .where(and(
              eq(mizeTable.id, miza.id),
              eq(mizeTable.enotaId, enotaId),
              eq(mizeTable.prostorId, prostorId),
            ))
            .returning({ id: mizeTable.id });
          if (!updated) {
            throw new Error("Miza se je med pripravo QR izpisa spremenila");
          }
        }
        return { context, exportBuffer, exportFormat };
      });

      broadcast("update", { type: "miza" });
      const safeSpaceName = result.context.prostorIme.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "prostor";
      res.set({
        "Content-Type": qrExportContentType(result.exportFormat),
        "Content-Disposition": `attachment; filename="qr-kode-${safeSpaceName}.${result.exportFormat}"`,
        "Content-Length": String(result.exportBuffer.length),
        "Cache-Control": "no-store",
      });
      res.send(result.exportBuffer);
    } catch (error) {
      if (error instanceof QrGeneriranjeNapaka) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  },
);

export default router;
