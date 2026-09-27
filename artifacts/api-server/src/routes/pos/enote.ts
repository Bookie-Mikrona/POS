/**
 * POS — Poslovne enote (lokacije restavracije).
 * Enote so vezane na ERP podjetje prek company_id.
 * Clerk JWT + X-Company-Id (ERP) → upravljanje enot tega podjetja.
 */

import { Router, type IRouter } from "express";
import { eq, count, and, inArray, isNull, or } from "drizzle-orm";
import {
  db, enoteTable, artikliTable, kategorijeTable, mizeTable, narocilaTable,
  racuniTable, nastavitveTable, natakariTable, poslovniProstoriTable,
  prostoriTable, izmeneTable, inventureTable, prejemniceTable, zacetneZalogeTable,
  costCentersTable,
  blagajniskiPremikiTable, preparedFoodDailyLedgersTable, preparedFoodWasteRecordsTable,
  racunIzdajaZahteveTable,
  posEventsTable, posEventUnitsTable,
  HOSPITALITY_PROFILES, HOSPITALITY_PROFILE_DEFAULTS, UNIT_CAPABILITIES, SERVICE_MODES,
} from "@workspace/db";
import { validateTemporaryPeriod } from "../../lib/temporaryUnitValidation";
import type { Request, Response } from "express";
import { isValidIpNetwork, normalizeClientIp, normalizeIpNetworks } from "../../lib/ip-network";
import { getRemovedCapabilities } from "../../lib/unitCapabilityPolicy";
import { ensureKdsUnitConfiguration } from "../../lib/kds-unit-configuration";
import { uvoziDrobniInventar } from "../../lib/drobni-inventar-catalog";

const router: IRouter = Router();
const QR_WIFI_SSID_MAX_LENGTH = 64;
const QR_WIFI_PASSWORD_MAX_LENGTH = 128;
const STUDENTSKI_BON_KLJUC = "studentskiBonAktiven";
const profileSet = new Set<string>(HOSPITALITY_PROFILES);
const capabilitySet = new Set<string>(UNIT_CAPABILITIES);
const serviceModeSet = new Set<string>(SERVICE_MODES);

type CapabilityBlocker = { kind: string; description: string };

async function findCapabilityBlockers(enotaId: number, removed: string[]): Promise<CapabilityBlocker[]> {
  const blockers: CapabilityBlocker[] = [];
  const removes = (...values: string[]) => values.some(value => removed.includes(value));

  if (removes("tables", "phone_orders", "qr_menu", "delivery", "kitchen", "checkout")) {
    const [openOrder] = await db.select({ id: narocilaTable.id }).from(narocilaTable)
      .where(and(eq(narocilaTable.enotaId, enotaId), eq(narocilaTable.status, "odprto"))).limit(1);
    if (openOrder) blockers.push({ kind: "open_orders", description: "Enota ima odprta naročila." });
  }
  if (removes("shifts", "checkout")) {
    const [activeShift] = await db.select({ id: izmeneTable.id }).from(izmeneTable)
      .where(and(eq(izmeneTable.enotaId, enotaId), isNull(izmeneTable.konec))).limit(1);
    if (activeShift) blockers.push({ kind: "active_shifts", description: "Enota ima aktivne izmene." });
  }
  if (removed.includes("checkout")) {
    const [pendingReceipt] = await db.select({ id: racuniTable.id }).from(racuniTable)
      .where(and(
        eq(racuniTable.enotaId, enotaId),
        inArray(racuniTable.fursState, ["pending", "sending", "unknown"]),
      )).limit(1);
    if (pendingReceipt) blockers.push({ kind: "pending_receipts", description: "Enota ima račune z nedokončanim FURS postopkom." });

    const [pendingIssue] = await db.select({ id: racunIzdajaZahteveTable.id }).from(racunIzdajaZahteveTable)
      .where(and(
        eq(racunIzdajaZahteveTable.enotaId, enotaId),
        inArray(racunIzdajaZahteveTable.status, ["processing", "unknown"]),
      )).limit(1);
    if (pendingIssue) blockers.push({ kind: "pending_issuance", description: "Enota ima nedokončano izdajo računa." });

  }
  if (removed.includes("cash_movements")) {
    const [cashDraft] = await db.select({ id: blagajniskiPremikiTable.id }).from(blagajniskiPremikiTable)
      .where(and(eq(blagajniskiPremikiTable.enotaId, enotaId), eq(blagajniskiPremikiTable.status, "OSNUTEK"))).limit(1);
    if (cashDraft) blockers.push({ kind: "cash_drafts", description: "Enota ima odprte osnutke blagajniških premikov." });
  }
  if (removed.includes("prepared_food")) {
    const [openLedger] = await db.select({ id: preparedFoodDailyLedgersTable.id }).from(preparedFoodDailyLedgersTable)
      .where(and(eq(preparedFoodDailyLedgersTable.enotaId, enotaId), isNull(preparedFoodDailyLedgersTable.closedAt))).limit(1);
    if (openLedger) blockers.push({ kind: "prepared_food_open_day", description: "Dnevna evidenca pripravljene hrane še ni zaključena." });
    const [wasteDraft] = await db.select({ id: preparedFoodWasteRecordsTable.id }).from(preparedFoodWasteRecordsTable)
      .where(and(eq(preparedFoodWasteRecordsTable.enotaId, enotaId), eq(preparedFoodWasteRecordsTable.status, "osnutek"))).limit(1);
    if (wasteDraft) blockers.push({ kind: "prepared_food_waste_drafts", description: "Obstaja nepotrjen zapis odpisa pripravljene hrane." });
  }
  if (removed.includes("events")) {
    const linked = db.select({ eventId: posEventUnitsTable.eventId }).from(posEventUnitsTable)
      .where(eq(posEventUnitsTable.enotaId, enotaId));
    const [openEvent] = await db.select({ id: posEventsTable.id }).from(posEventsTable)
      .where(and(
        inArray(posEventsTable.status, ["planned", "active"]),
        or(eq(posEventsTable.enotaId, enotaId), inArray(posEventsTable.id, linked)),
      )).limit(1);
    if (openEvent) blockers.push({ kind: "open_events", description: "Enota je povezana z načrtovanim ali aktivnim dogodkom." });
  }
  return blockers;
}

function validateUnitProfile(profile: unknown, capabilities: unknown, serviceMode: unknown): string | null {
  if (profile !== undefined && (typeof profile !== "string" || !profileSet.has(profile))) {
    return "Vrsta gostinskega obrata ni veljavna.";
  }
  if (capabilities !== undefined && (
    !Array.isArray(capabilities)
    || capabilities.some(value => typeof value !== "string" || !capabilitySet.has(value))
  )) {
    return "Seznam funkcij enote vsebuje neveljavno vrednost.";
  }
  if (serviceMode !== undefined && (typeof serviceMode !== "string" || !serviceModeSet.has(serviceMode))) {
    return "Način strežbe ni veljaven.";
  }
  return null;
}

async function dodajNastavitevStudentskegaBona<T extends { id: number }>(
  rows: T[],
): Promise<Array<T & { studentskiBonAktiven: boolean }>> {
  if (rows.length === 0) return [];
  const nastavitve = await db.select({
    enotaId: nastavitveTable.enotaId,
    vrednost: nastavitveTable.vrednost,
  }).from(nastavitveTable).where(and(
    eq(nastavitveTable.kljuc, STUDENTSKI_BON_KLJUC),
    inArray(nastavitveTable.enotaId, rows.map(row => row.id)),
  ));
  const poEnoti = new Map(nastavitve.map(n => [n.enotaId, n.vrednost === "true"]));
  return rows.map(row => ({ ...row, studentskiBonAktiven: poEnoti.get(row.id) ?? false }));
}

async function shraniNastavitevStudentskegaBona(enotaId: number, aktiven: boolean): Promise<void> {
  const [existing] = await db.select({ id: nastavitveTable.id }).from(nastavitveTable).where(and(
    eq(nastavitveTable.enotaId, enotaId),
    eq(nastavitveTable.kljuc, STUDENTSKI_BON_KLJUC),
  )).limit(1);
  if (existing) {
    await db.update(nastavitveTable)
      .set({ vrednost: String(aktiven) })
      .where(eq(nastavitveTable.id, existing.id));
    return;
  }
  await db.insert(nastavitveTable).values({
    enotaId,
    kljuc: STUDENTSKI_BON_KLJUC,
    vrednost: String(aktiven),
  });
}

function smeUrejatiEnote(req: Request): boolean {
  const vloga = (req as any).vloga as string | undefined;
  return vloga === "admin" || vloga === "admin_enote" || vloga === "superadmin";
}

function normalizeQrWifiText(
  value: unknown,
  label: string,
  maxLength: number,
  trimValue: boolean,
): { value?: string | null; error?: string } {
  if (value === undefined) return {};
  if (value === null) return { value: null };
  if (typeof value !== "string") return { error: `${label} mora biti besedilo.` };
  const normalized = trimValue ? value.trim() : value;
  if (normalized.trim() === "") return { value: null };
  if (normalized.length > maxLength) {
    return { error: `${label} lahko vsebuje največ ${maxLength} znakov.` };
  }
  return { value: normalized };
}

// GET /enote — vse enote tega podjetja (company_id iz ERP middleware)
router.get("/", async (req: Request, res: Response): Promise<void> => {
  const companyId = (req as any).companyId as string | undefined;
  if (!companyId) { res.status(400).json({ napaka: "Manjka X-Company-Id" }); return; }
  const rows = await db.select().from(enoteTable)
    .where(eq(enoteTable.companyId, companyId))
    .orderBy(enoteTable.id);
  const rowsZNastavitvijo = await dodajNastavitevStudentskegaBona(rows);
  if (smeUrejatiEnote(req)) {
    res.json(rowsZNastavitvijo);
    return;
  }
  res.json(rowsZNastavitvijo.map(({ qrWifiPassword: _qrWifiPassword, ...row }) => row));
});

/**
 * Company-scope preverba STM: costCenterId mora pripadati istemu podjetju.
 * Vrne sporočilo napake ali null, če je vse v redu (ali costCenterId ni podan).
 */
async function preveriCostCenter(costCenterId: string | null | undefined, companyId: string): Promise<string | null> {
  if (!costCenterId) return null;
  const [cc] = await db.select({ id: costCentersTable.id })
    .from(costCentersTable)
    .where(and(eq(costCentersTable.id, costCenterId), eq(costCentersTable.companyId, companyId)))
    .limit(1);
  return cc ? null : "Stroškovno mesto ni iz tega podjetja";
}

async function preveriMaticnoEnoto(
  parentUnitId: number | null,
  companyId: string,
  unitId?: number,
): Promise<string | null> {
  if (parentUnitId == null) return "Začasna enota mora imeti izbrano matično enoto.";
  if (!Number.isInteger(parentUnitId) || parentUnitId <= 0) return "Matična enota ni veljavna.";
  if (unitId !== undefined && parentUnitId === unitId) return "Enota ne more biti sama sebi matična enota.";
  const [parent] = await db.select({ id: enoteTable.id }).from(enoteTable).where(and(
    eq(enoteTable.id, parentUnitId),
    eq(enoteTable.companyId, companyId),
  )).limit(1);
  return parent ? null : "Matična enota ne pripada izbranemu podjetju.";
}

/** Samo admin podjetja (ali superadmin) sme ustvarjati/brisati enote; admin_enote samo ureja. */
function smeUpravljatiEnote(req: Request): boolean {
  const vloga = (req as any).vloga as string | undefined;
  return vloga === "admin" || vloga === "superadmin";
}

// GET /enote/current-public-ip — naslov, kot ga vidi Bookie API skozi Replitov proxy.
// Ruta mora biti pred /:id, sicer bi Express "current-public-ip" obravnaval kot ID.
router.get("/current-public-ip", (req: Request, res: Response): void => {
  const javniIp = normalizeClientIp(req.ip ?? req.socket.remoteAddress ?? "");
  res.json({
    javniIp,
    veljavenZaQrWifi: isValidIpNetwork(javniIp),
  });
});

// POST /enote — ustvari novo enoto (samo admin)
router.post("/", async (req: Request, res: Response): Promise<void> => {
  const companyId = (req as any).companyId as string | undefined;
  if (!companyId) { res.status(400).json({ napaka: "Manjka X-Company-Id" }); return; }
  if (!smeUpravljatiEnote(req)) { res.status(403).json({ napaka: "Ustvarjanje enot zahteva vlogo admin" }); return; }
  const {
    ime, opis, aktiven, zacetekDnevaUra, costCenterId,
    hospitalityProfile, serviceMode, capabilities, isTemporary, temporaryLocation, parentUnitId, activeFrom, activeTo,
    qrLatitude, qrLongitude, qrWifiNetworks, qrWifiSsid, qrWifiPassword,
    vnesiPrivzetiDrobniInventar,
  } = req.body as {
    ime?: string;
    opis?: string;
    aktiven?: boolean;
    zacetekDnevaUra?: string;
    costCenterId?: string | null;
    hospitalityProfile?: string;
    serviceMode?: string;
    capabilities?: string[];
    isTemporary?: boolean;
    temporaryLocation?: string | null;
    parentUnitId?: number | null;
    activeFrom?: string | null;
    activeTo?: string | null;
    qrLatitude?: number | null;
    qrLongitude?: number | null;
    qrWifiNetworks?: unknown;
    qrWifiSsid?: unknown;
    qrWifiPassword?: unknown;
    vnesiPrivzetiDrobniInventar?: boolean;
  };
  if (!ime) { res.status(400).json({ napaka: "Ime je obvezno" }); return; }
  if (vnesiPrivzetiDrobniInventar !== undefined && typeof vnesiPrivzetiDrobniInventar !== "boolean") {
    res.status(400).json({ napaka: "Nastavitev privzetega drobnega inventarja mora biti logična vrednost." });
    return;
  }
  const profileError = validateUnitProfile(hospitalityProfile, capabilities, serviceMode);
  if (profileError) { res.status(400).json({ napaka: profileError }); return; }
  const selectedProfile = (hospitalityProfile ?? "restaurant") as keyof typeof HOSPITALITY_PROFILE_DEFAULTS;
  const profileDefaults = HOSPITALITY_PROFILE_DEFAULTS[selectedProfile];
  const finalIsTemporary = isTemporary ?? profileDefaults.temporary;
  const period = validateTemporaryPeriod(activeFrom, activeTo, finalIsTemporary);
  if (period.error) { res.status(400).json({ napaka: period.error }); return; }
  if (finalIsTemporary) {
    const parentError = await preveriMaticnoEnoto(parentUnitId ?? null, companyId);
    if (parentError) { res.status(400).json({ napaka: parentError }); return; }
  }
  if ((qrLatitude == null) !== (qrLongitude == null)) {
    res.status(400).json({ napaka: "Za lokacijo QR menija sta potrebni obe koordinati." });
    return;
  }
  if (
    (qrLatitude != null && (!Number.isFinite(qrLatitude) || qrLatitude < -90 || qrLatitude > 90))
    || (qrLongitude != null && (!Number.isFinite(qrLongitude) || qrLongitude < -180 || qrLongitude > 180))
  ) {
    res.status(400).json({ napaka: "Koordinate lokacije QR menija niso veljavne." });
    return;
  }
  const normalizedQrWifiNetworks = qrWifiNetworks === undefined ? [] : normalizeIpNetworks(qrWifiNetworks);
  if (normalizedQrWifiNetworks === null) {
    res.status(400).json({ napaka: "Dovoljeni javni IP-ji/CIDR za QR Wi-Fi niso veljavni." });
    return;
  }
  const normalizedQrWifiSsid = normalizeQrWifiText(qrWifiSsid, "Ime Wi-Fi omrežja", QR_WIFI_SSID_MAX_LENGTH, true);
  if (normalizedQrWifiSsid.error) {
    res.status(400).json({ napaka: normalizedQrWifiSsid.error });
    return;
  }
  const normalizedQrWifiPassword = normalizeQrWifiText(qrWifiPassword, "Geslo Wi-Fi omrežja", QR_WIFI_PASSWORD_MAX_LENGTH, false);
  if (normalizedQrWifiPassword.error) {
    res.status(400).json({ napaka: normalizedQrWifiPassword.error });
    return;
  }
  const ccNapaka = await preveriCostCenter(costCenterId, companyId);
  if (ccNapaka) { res.status(400).json({ napaka: ccNapaka }); return; }
  const [row] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(enoteTable).values({
    companyId,
    ime,
    opis: opis ?? null,
    aktiven: aktiven ?? true,
    zacetekDnevaUra: zacetekDnevaUra ?? "04:00",
    qrLatitude: qrLatitude == null ? null : String(qrLatitude),
    qrLongitude: qrLongitude == null ? null : String(qrLongitude),
    qrWifiNetworks: normalizedQrWifiNetworks,
    qrWifiSsid: normalizedQrWifiSsid.value ?? null,
    qrWifiPassword: normalizedQrWifiPassword.value ?? null,
    costCenterId: costCenterId ?? null,
    hospitalityProfile: selectedProfile,
    serviceMode: (serviceMode as any) ?? profileDefaults.serviceMode,
    capabilities: (capabilities as any) ?? profileDefaults.capabilities,
    isTemporary: finalIsTemporary,
    temporaryLocation: finalIsTemporary ? temporaryLocation?.trim() || null : null,
    parentUnitId: finalIsTemporary ? parentUnitId ?? null : null,
    activeFrom: finalIsTemporary ? period.activeFrom : null,
    activeTo: finalIsTemporary ? period.activeTo : null,
    }).returning();
    await ensureKdsUnitConfiguration(created.id, tx);
    if (vnesiPrivzetiDrobniInventar === true) {
      await uvoziDrobniInventar(tx, created.id);
    }
    return [created];
  });
  res.status(201).json({ ...row, studentskiBonAktiven: false });
});

// PUT /enote/:id
router.put("/:id", async (req: Request, res: Response): Promise<void> => {
  if (!smeUrejatiEnote(req)) {
    res.status(403).json({ napaka: "Nimate pravic za urejanje poslovnih enot" });
    return;
  }
  const companyId = (req as any).companyId as string | undefined;
  if (!companyId) { res.status(400).json({ napaka: "Manjka X-Company-Id" }); return; }
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }
  const {
    ime, opis, aktiven, zacetekDnevaUra, costCenterId,
    hospitalityProfile, serviceMode, capabilities, isTemporary, temporaryLocation, parentUnitId, activeFrom, activeTo,
    qrLatitude, qrLongitude, qrWifiNetworks, qrWifiSsid, qrWifiPassword,
    studentskiBonAktiven,
  } = req.body as {
    ime?: string;
    opis?: string;
    aktiven?: boolean;
    zacetekDnevaUra?: string;
    costCenterId?: string | null;
    qrLatitude?: number | null;
    qrLongitude?: number | null;
    qrWifiNetworks?: unknown;
    qrWifiSsid?: unknown;
    qrWifiPassword?: unknown;
    studentskiBonAktiven?: boolean;
    hospitalityProfile?: string;
    serviceMode?: string;
    capabilities?: string[];
    isTemporary?: boolean;
    temporaryLocation?: string | null;
    parentUnitId?: number | null;
    activeFrom?: string | null;
    activeTo?: string | null;
  };
  const profileError = validateUnitProfile(hospitalityProfile, capabilities, serviceMode);
  if (profileError) { res.status(400).json({ napaka: profileError }); return; }
  const [currentUnit] = await db.select().from(enoteTable)
    .where(and(eq(enoteTable.id, id), eq(enoteTable.companyId, companyId))).limit(1);
  if (!currentUnit) { res.status(404).json({ napaka: "Enota ni najdena" }); return; }
  const finalIsTemporary = isTemporary ?? currentUnit.isTemporary;
  const finalParentUnitId = parentUnitId !== undefined ? parentUnitId : currentUnit.parentUnitId;
  const period = validateTemporaryPeriod(
    activeFrom !== undefined ? activeFrom : currentUnit.activeFrom,
    activeTo !== undefined ? activeTo : currentUnit.activeTo,
    finalIsTemporary,
  );
  if (period.error) { res.status(400).json({ napaka: period.error }); return; }
  if (finalIsTemporary) {
    const parentError = await preveriMaticnoEnoto(finalParentUnitId, companyId, id);
    if (parentError) { res.status(400).json({ napaka: parentError }); return; }
  }
  if (studentskiBonAktiven !== undefined && typeof studentskiBonAktiven !== "boolean") {
    res.status(400).json({ napaka: "Nastavitev študentskega bona mora biti logična vrednost" });
    return;
  }
  const updateData: Partial<typeof enoteTable.$inferInsert> = {};
  if (ime !== undefined) updateData.ime = ime;
  if (opis !== undefined) updateData.opis = opis;
  if (aktiven !== undefined) updateData.aktiven = aktiven;
  if (zacetekDnevaUra !== undefined) updateData.zacetekDnevaUra = zacetekDnevaUra;
  if (hospitalityProfile !== undefined) updateData.hospitalityProfile = hospitalityProfile as any;
  if (serviceMode !== undefined) updateData.serviceMode = serviceMode as any;
  if (capabilities !== undefined) updateData.capabilities = [...new Set(capabilities)] as any;
  if (isTemporary !== undefined) updateData.isTemporary = isTemporary;
  if (!finalIsTemporary) {
    updateData.temporaryLocation = null;
    updateData.parentUnitId = null;
    updateData.activeFrom = null;
    updateData.activeTo = null;
  } else {
    if (temporaryLocation !== undefined) updateData.temporaryLocation = temporaryLocation?.trim() || null;
    if (parentUnitId !== undefined) updateData.parentUnitId = parentUnitId;
    if (activeFrom !== undefined) updateData.activeFrom = period.activeFrom;
    if (activeTo !== undefined) updateData.activeTo = period.activeTo;
  }
  if (qrLatitude !== undefined || qrLongitude !== undefined) {
    if ((qrLatitude == null) !== (qrLongitude == null)) {
      res.status(400).json({ napaka: "Za lokacijo QR menija sta potrebni obe koordinati." });
      return;
    }
    if (
      (qrLatitude != null && (!Number.isFinite(qrLatitude) || qrLatitude < -90 || qrLatitude > 90))
      || (qrLongitude != null && (!Number.isFinite(qrLongitude) || qrLongitude < -180 || qrLongitude > 180))
    ) {
      res.status(400).json({ napaka: "Koordinate lokacije QR menija niso veljavne." });
      return;
    }
    updateData.qrLatitude = qrLatitude == null ? null : String(qrLatitude);
    updateData.qrLongitude = qrLongitude == null ? null : String(qrLongitude);
  }
  if (qrWifiNetworks !== undefined) {
    const normalized = normalizeIpNetworks(qrWifiNetworks);
    if (normalized === null) {
      res.status(400).json({ napaka: "Dovoljeni javni IP-ji/CIDR za QR Wi-Fi niso veljavni." });
      return;
    }
    updateData.qrWifiNetworks = normalized;
  }
  const normalizedQrWifiSsid = normalizeQrWifiText(qrWifiSsid, "Ime Wi-Fi omrežja", QR_WIFI_SSID_MAX_LENGTH, true);
  if (normalizedQrWifiSsid.error) {
    res.status(400).json({ napaka: normalizedQrWifiSsid.error });
    return;
  }
  if (normalizedQrWifiSsid.value !== undefined) updateData.qrWifiSsid = normalizedQrWifiSsid.value;

  const normalizedQrWifiPassword = normalizeQrWifiText(qrWifiPassword, "Geslo Wi-Fi omrežja", QR_WIFI_PASSWORD_MAX_LENGTH, false);
  if (normalizedQrWifiPassword.error) {
    res.status(400).json({ napaka: normalizedQrWifiPassword.error });
    return;
  }
  if (normalizedQrWifiPassword.value !== undefined) updateData.qrWifiPassword = normalizedQrWifiPassword.value;
  if (costCenterId !== undefined) {
    const ccNapaka = await preveriCostCenter(costCenterId, companyId);
    if (ccNapaka) { res.status(400).json({ napaka: ccNapaka }); return; }
    updateData.costCenterId = costCenterId ?? null;
  }
  if (capabilities !== undefined) {
    const removed = getRemovedCapabilities(currentUnit.capabilities, capabilities);
    const blockers = await findCapabilityBlockers(id, removed);
    if (blockers.length > 0) {
      res.status(409).json({
        napaka: "Funkcij ni mogoče izključiti, dokler ima enota odprto delo.",
        removedCapabilities: removed,
        blockers,
      });
      return;
    }
  }
  const [row] = Object.keys(updateData).length > 0
    ? await db.update(enoteTable).set(updateData)
      .where(and(eq(enoteTable.id, id), eq(enoteTable.companyId, companyId)))
      .returning()
    : await db.select().from(enoteTable)
      .where(and(eq(enoteTable.id, id), eq(enoteTable.companyId, companyId)))
      .limit(1);
  if (!row) { res.status(404).json({ napaka: "Enota ni najdena" }); return; }
  if (studentskiBonAktiven !== undefined) {
    await shraniNastavitevStudentskegaBona(id, studentskiBonAktiven);
  }
  res.json({
    ...row,
    studentskiBonAktiven: studentskiBonAktiven
      ?? (await dodajNastavitevStudentskegaBona([row]))[0]?.studentskiBonAktiven
      ?? false,
  });
});

// DELETE /enote/:id (samo admin)
router.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const companyId = (req as any).companyId as string | undefined;
  if (!companyId) { res.status(400).json({ napaka: "Manjka X-Company-Id" }); return; }
  if (!smeUpravljatiEnote(req)) { res.status(403).json({ napaka: "Brisanje enot zahteva vlogo admin" }); return; }
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }

  const allEnote = await db.select({ id: enoteTable.id }).from(enoteTable)
    .where(eq(enoteTable.companyId, companyId));
  if (allEnote.length <= 1) {
    res.status(409).json({ napaka: "Ne morete izbrisati zadnje poslovne enote" }); return;
  }

  const checks = await Promise.all([
    db.select({ n: count() }).from(artikliTable).where(eq(artikliTable.enotaId, id)),
    db.select({ n: count() }).from(kategorijeTable).where(eq(kategorijeTable.enotaId, id)),
    db.select({ n: count() }).from(mizeTable).where(eq(mizeTable.enotaId, id)),
    db.select({ n: count() }).from(narocilaTable).where(eq(narocilaTable.enotaId, id)),
    db.select({ n: count() }).from(racuniTable).where(eq(racuniTable.enotaId, id)),
  ]);
  const skupaj = checks.reduce((sum, [r]) => sum + Number(r?.n ?? 0), 0);
  if (skupaj > 0) {
    res.status(409).json({ napaka: "Enote ni mogoče izbrisati — vsebuje podatke." }); return;
  }

  await db.delete(enoteTable).where(and(eq(enoteTable.id, id), eq(enoteTable.companyId, companyId)));
  res.status(204).send();
});

export default router;
