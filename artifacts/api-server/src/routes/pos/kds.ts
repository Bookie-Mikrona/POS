import { Router, type IRouter } from "express";
import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  artikliTable, db, kategorijeTable, kdsDogodkiTable, kdsIzdajaDogodkiTable, kdsNalogiTable,
  kdsNastavitveTable, kdsPostajaMapiranjaTable, kdsPostajeTable,
  kdsPrikazovalnikiTable, kdsPrikazovalnikNaročnineTable, mizeTable, narocilaTable, postavkeTable, prostoriTable,
} from "@workspace/db";
import { broadcastToUnit } from "../../lib/pos-sse";
import { canApplyKdsCommand } from "../../lib/kds-state";
import { choosePreparationStations, planStandardKdsDisplays, preparationStationType, resolvePreparationKind, type KdsProfile } from "../../lib/kds-routing";
import { ensureKdsUnitConfiguration } from "../../lib/kds-unit-configuration";
import { isDispatchEligible, lockKdsOrder } from "../../lib/kds-dispatch";
import {
  CreateKdsMapiranjeBody, CreateKdsPostajaBody, CreateKdsPrikazovalnikBody,
  SetKdsPrikazovalnikNarocnineBody, UpdateKdsNastavitveBody, UpdateKdsPostajaBody,
  UpdateKdsPrikazovalnikBody,
} from "@workspace/api-zod";

const router: IRouter = Router();
const enota = (req: any): number => req.enotaId as number;
const positive = (value: unknown) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const AssignCourseBody = z.object({
  postavkaId: z.number().int().positive(),
  courseNumber: z.number().int().min(1).max(99),
});

export class KdsCourseAssignmentConflict extends Error {
  constructor(message: string) { super(message); }
}

export function fingerprintKdsCourseAssignmentOrder(order: {
  id: number;
  status: string;
  postavke: Array<{
    id: number;
    artikelId: number | null;
    kolicina: number | string;
    parentPostavkaId: number | null;
    racunId: number | null;
    courseNumber?: number | null;
    courseSequence?: number | null;
    courseNameSnapshot?: string | null;
    pairingGroupId?: string | null;
  }>;
}): string {
  return createHash("sha256").update(JSON.stringify({
    id: order.id,
    status: order.status,
    lines: order.postavke
      .filter(line => line.parentPostavkaId == null && line.racunId == null)
      .map(line => ({
        id: line.id,
        artikelId: line.artikelId,
        parentPostavkaId: line.parentPostavkaId,
        racunId: line.racunId,
        courseNumber: line.courseNumber ?? null,
        courseSequence: line.courseSequence ?? null,
        courseNameSnapshot: line.courseNameSnapshot?.trim() || null,
        pairingGroupId: line.pairingGroupId ?? null,
        kolicina: Number(line.kolicina),
      }))
      .sort((a, b) => a.id - b.id),
  })).digest("hex");
}

/**
 * Changes the POS projection and any still-safe KDS projection under the same
 * order lock used by fire/bump/dispatch.  A pairing is the atomic unit: menu
 * components must never be moved independently and modifiers stay with their
 * parent through the shared ordinary pairing id.
 */
export async function assignKdsCourse(input: {
  narociloId: number; enotaId: number; postavkaId: number; courseNumber: number;
  expectedOrderFingerprint?: string;
}, client: any = db): Promise<{ pairingGroupId: string; changed: boolean }> {
  const result = await assignKdsCourses({
    narociloId: input.narociloId, enotaId: input.enotaId,
    assignments: [{ postavkaId: input.postavkaId, courseNumber: input.courseNumber }],
    expectedOrderFingerprint: input.expectedOrderFingerprint,
  }, client);
  return result.assignments[0]!;
}

export async function assignKdsCourses(input: {
  narociloId: number; enotaId: number;
  assignments: Array<{ postavkaId: number; courseNumber: number }>;
  expectedOrderFingerprint?: string;
}, client: any = db): Promise<{ changed: boolean; assignments: Array<{ postavkaId: number; courseNumber: number; pairingGroupId: string; changed: boolean }> }> {
  if (!Array.isArray(input.assignments) || !input.assignments.length
    || input.assignments.some(a => !Number.isInteger(a.postavkaId) || a.postavkaId <= 0 || !Number.isInteger(a.courseNumber) || a.courseNumber < 1 || a.courseNumber > 99)) {
    throw new KdsCourseAssignmentConflict("Izbrati je treba vsaj eno postavko in veljaven hod (1–99).");
  }
  if (client === db) return db.transaction(tx => assignKdsCourses(input, tx));
  await lockKdsOrder(client, input.narociloId);
  const [order] = await client.select({ id: narocilaTable.id, status: narocilaTable.status }).from(narocilaTable).where(and(
    eq(narocilaTable.id, input.narociloId), eq(narocilaTable.enotaId, input.enotaId), eq(narocilaTable.status, "odprto"),
  )).for("update");
  if (!order) throw new KdsCourseAssignmentConflict("Naročilo ni odprto ali ne pripada tej enoti.");

  // Lock the complete order once: resolving all pairings from this stable
  // snapshot avoids a partially planned batch when a modifier/menu changes.
  const lines = await client.select().from(postavkeTable)
    .where(eq(postavkeTable.narociloId, input.narociloId))
    .for("update") as Array<typeof postavkeTable.$inferSelect>;
  if (input.expectedOrderFingerprint && fingerprintKdsCourseAssignmentOrder({
    id: order.id,
    status: order.status,
    postavke: lines,
  }) !== input.expectedOrderFingerprint) {
    throw new KdsCourseAssignmentConflict("Naročilo se je med pojasnilom spremenilo. Ponovite celoten ukaz.");
  }
  const byId = new Map<number, typeof postavkeTable.$inferSelect>(
    lines.map(line => [line.id, line]),
  );
  const plans = new Map<string, any>();
  for (const assignment of input.assignments) {
    const selected = byId.get(assignment.postavkaId);
    if (!selected) throw new KdsCourseAssignmentConflict("Postavka ni v odprtem naročilu.");
    const parent = byId.get(selected.parentPostavkaId ?? selected.id);
    if (!parent) throw new KdsCourseAssignmentConflict("Nadrejena postavka ni v naročilu.");
    const key = parent.pairingGroupId ? `pair:${parent.pairingGroupId}` : `parent:${parent.id}`;
    const prior = plans.get(key);
    if (prior) {
      if (prior.courseNumber !== assignment.courseNumber) throw new KdsCourseAssignmentConflict("Ista skupina postavk je v paketu dodeljena različnima hodoma.");
      continue;
    }
    const grouped = parent.pairingGroupId
      ? lines.filter((line: any) => line.pairingGroupId === parent.pairingGroupId)
      : lines.filter((line: any) => line.id === parent.id || line.parentPostavkaId === parent.id);
    plans.set(key, { parent, grouped, courseNumber: assignment.courseNumber,
      pairingGroupId: parent.pairingGroupId ?? `course:${input.narociloId}:${parent.id}:${randomUUID()}` });
  }

  const [dispatched] = await client.select({ id: kdsIzdajaDogodkiTable.id }).from(kdsIzdajaDogodkiTable).where(and(
    eq(kdsIzdajaDogodkiTable.enotaId, input.enotaId), eq(kdsIzdajaDogodkiTable.narociloId, input.narociloId),
  )).limit(1);
  if (dispatched) throw new KdsCourseAssignmentConflict("Naročilo je že predano; hoda ni mogoče več spremeniti.");
  const involvedIds = [...new Set([...plans.values()].flatMap((plan: any) => plan.grouped.map((line: any) => line.id)))];
  const tickets = await client.select().from(kdsNalogiTable).where(and(
    eq(kdsNalogiTable.enotaId, input.enotaId), eq(kdsNalogiTable.narociloId, input.narociloId), inArray(kdsNalogiTable.postavkaId, involvedIds),
  )).for("update");
  if (tickets.some((ticket: any) => !["aktivno", "zadrzano"].includes(ticket.stanje))) throw new KdsCourseAssignmentConflict("KDS nalog je že obdelan; hoda ni mogoče varno spremeniti.");
  if (tickets.length) {
    const released = await client.select({ nalogId: kdsDogodkiTable.nalogId }).from(kdsDogodkiTable).where(and(
      inArray(kdsDogodkiTable.nalogId, tickets.map((ticket: any) => ticket.id)), eq(kdsDogodkiTable.tip, "sproscen"),
    )).limit(1);
    if (released.length) throw new KdsCourseAssignmentConflict("Hod je že sproščen v KDS; sprememba bi pokvarila potek kuhinje.");
  }

  for (const plan of plans.values()) {
    const multicourse = plan.parent.pairingGroupId != null && plan.grouped.some((line: any) => line.courseNumber == null && line.courseSequence == null);
    const anchor = multicourse && plan.parent.courseNumber == null
      ? plan.grouped.filter((line: any) => line.courseNumber != null).sort((a: any, b: any) => (a.courseSequence ?? Number.MAX_SAFE_INTEGER) - (b.courseSequence ?? Number.MAX_SAFE_INTEGER) || (a.courseNumber ?? Number.MAX_SAFE_INTEGER) - (b.courseNumber ?? Number.MAX_SAFE_INTEGER) || a.id - b.id)[0]
      : plan.parent;
    if (multicourse && (!anchor || anchor.courseNumber == null)) throw new KdsCourseAssignmentConflict("Večhodni meni nima postavke, ki bi jo bilo mogoče dodeliti hodu.");
    const offset = multicourse ? plan.courseNumber - anchor.courseNumber : 0;
    plan.desired = plan.grouped.map((line: any) => ({ id: line.id, courseNumber: multicourse ? (line.courseNumber == null ? null : line.courseNumber + offset) : plan.courseNumber, courseSequence: multicourse ? line.courseSequence : plan.courseNumber }));
    if (plan.desired.some((line: any) => line.courseNumber != null && (line.courseNumber < 1 || line.courseNumber > 99))) throw new KdsCourseAssignmentConflict("Ciljni hod bi presegel dovoljeno zaporedje večhodnega menija.");
    plan.changed = plan.desired.some((line: any) => {
      const current = byId.get(line.id);
      if (!current) {
        throw new KdsCourseAssignmentConflict("Skupina postavk se med pripravo dodelitve ni ohranila.");
      }
      return current.courseNumber !== line.courseNumber || current.courseSequence !== line.courseSequence || current.pairingGroupId !== plan.pairingGroupId;
    });
  }
  for (const plan of plans.values()) if (plan.changed) {
    for (const line of plan.desired) await client.update(postavkeTable).set({ courseNumber: line.courseNumber, courseSequence: line.courseSequence, pairingGroupId: plan.pairingGroupId }).where(and(eq(postavkeTable.id, line.id), eq(postavkeTable.narociloId, input.narociloId)));
    for (const ticket of tickets.filter((ticket: any) => plan.desired.some((line: any) => line.id === ticket.postavkaId))) {
      const line = plan.desired.find((candidate: any) => candidate.id === ticket.postavkaId)!;
      await client.update(kdsNalogiTable).set({ courseNumber: line.courseNumber, courseSequence: line.courseSequence, pairingGroupId: plan.pairingGroupId }).where(and(eq(kdsNalogiTable.id, ticket.id), eq(kdsNalogiTable.narociloId, input.narociloId), eq(kdsNalogiTable.enotaId, input.enotaId)));
    }
  }
  const results = input.assignments.map(assignment => {
    const selected = byId.get(assignment.postavkaId)!;
    const parent = byId.get(selected.parentPostavkaId ?? selected.id)!;
    const plan = plans.get(parent.pairingGroupId ? `pair:${parent.pairingGroupId}` : `parent:${parent.id}`)!;
    return { ...assignment, pairingGroupId: plan.pairingGroupId, changed: plan.changed };
  });
  return { changed: results.some(result => result.changed), assignments: results };
}

async function stationForTenant(id: number, enotaId: number) {
  const [station] = await db.select().from(kdsPostajeTable)
    .where(and(eq(kdsPostajeTable.id, id), eq(kdsPostajeTable.enotaId, enotaId)));
  return station;
}
async function activeStationForTenant(id: number | null | undefined, enotaId: number) {
  if (!id) return undefined;
  const station = await stationForTenant(id, enotaId);
  return station?.aktivna ? station : undefined;
}

/** Idempotently projects unbumped POS lines to all matching active stations. */
export async function materializirajKdsNaloge(narociloId: number, enotaId: number, client: any = db) {
  // Publish may create schema without executing migration backfill DML. This
  // idempotent lazy ensure guarantees configuration before any projection.
  if (client === db) {
    await db.transaction((tx) => materializirajKdsNaloge(narociloId, enotaId, tx));
    return;
  }
  await lockKdsOrder(client, narociloId);
  await ensureKdsUnitConfiguration(enotaId, client);
  const [configuration] = await client.select().from(kdsNastavitveTable)
    .where(eq(kdsNastavitveTable.enotaId, enotaId));
  const lines = await client.select({
    postavkaId: postavkeTable.id, artikelId: postavkeTable.artikelId,
    kategorijaId: artikliTable.kategorijaId,
    pripravaVrsta: artikliTable.pripravaVrsta,
    jePica: artikliTable.jePica,
    kategorijaIme: kategorijeTable.ime,
    kategorijaTip: kategorijeTable.tip,
    courseNumber: postavkeTable.courseNumber,
    courseSequence: postavkeTable.courseSequence,
    courseNameSnapshot: postavkeTable.courseNameSnapshot,
    pairingGroupId: postavkeTable.pairingGroupId,
  }).from(postavkeTable)
    .innerJoin(narocilaTable, eq(postavkeTable.narociloId, narocilaTable.id))
    .leftJoin(artikliTable, eq(postavkeTable.artikelId, artikliTable.id))
    .leftJoin(kategorijeTable, and(eq(kategorijeTable.id, artikliTable.kategorijaId), eq(kategorijeTable.enotaId, enotaId)))
    .where(and(
      eq(postavkeTable.narociloId, narociloId),
      eq(narocilaTable.enotaId, enotaId),
      isNull(postavkeTable.parentPostavkaId),
      // A menu-charge line has the pairing group but no course. It is a
      // commercial record only; individual food and wine course lines route.
      or(isNull(postavkeTable.pairingGroupId), isNotNull(postavkeTable.courseNumber)),
    ));
  // Flat POS lines are immediately actionable.  For a menu pairing, only its
  // own lowest selected sequence starts active.  Course numbers are labels
  // (and selections may skip them), so they cannot define serving order.
  const firstSequenceByPairing = new Map<string, number>();
  for (const line of lines) {
    if (line.pairingGroupId && line.courseSequence != null) {
      const current = firstSequenceByPairing.get(line.pairingGroupId);
      if (current == null || line.courseSequence < current) {
        firstSequenceByPairing.set(line.pairingGroupId, line.courseSequence);
      }
    }
  }
  for (const line of lines) {
    const mappings = await client.select({ postajaId: kdsPostajaMapiranjaTable.postajaId })
      .from(kdsPostajaMapiranjaTable)
      .innerJoin(kdsPostajeTable, eq(kdsPostajaMapiranjaTable.postajaId, kdsPostajeTable.id))
      .where(and(eq(kdsPostajeTable.enotaId, enotaId), eq(kdsPostajeTable.aktivna, true),
        or(eq(kdsPostajaMapiranjaTable.artikelId, line.artikelId ?? -1), eq(kdsPostajaMapiranjaTable.kategorijaId, line.kategorijaId ?? -1))));
    // An article and its category can legitimately target several stations,
    // but two overlapping rules must not make two tickets for one station.
    const fallback = configuration?.fallbackPostajaId
      ? (await client.select().from(kdsPostajeTable).where(and(eq(kdsPostajeTable.id, configuration.fallbackPostajaId), eq(kdsPostajeTable.enotaId, enotaId))))[0] : null;
    if (!fallback?.aktivna) throw new Error(`KDS enota ${enotaId} nima veljavne aktivne fallback postaje.`);
    const kind = resolvePreparationKind(line);
    const stationType = kind ? preparationStationType(kind) : null;
    const typedStation = stationType
      ? (await client.select({ id: kdsPostajeTable.id }).from(kdsPostajeTable).where(and(
        eq(kdsPostajeTable.enotaId, enotaId), eq(kdsPostajeTable.aktivna, true),
        eq(kdsPostajeTable.tip, stationType),
      )).orderBy(kdsPostajeTable.vrstniRed, kdsPostajeTable.id).limit(1))[0]
      : null;
    const { stationIds: targetStationIds, usedFallback } = choosePreparationStations(
      mappings.map((mapping: { postajaId: number }) => mapping.postajaId),
      typedStation?.id ?? null, fallback.id,
    );
    for (const postajaId of targetStationIds) {
      const [ticket] = await client.insert(kdsNalogiTable).values({
        enotaId, postajaId, narociloId, postavkaId: line.postavkaId, uporabljenFallback: usedFallback,
        courseNumber: line.courseNumber,
        courseSequence: line.courseSequence,
        courseNameSnapshot: line.courseNameSnapshot,
        pairingGroupId: line.pairingGroupId,
        stanje: line.pairingGroupId != null && line.courseSequence != null
          && line.courseSequence !== firstSequenceByPairing.get(line.pairingGroupId)
          ? "zadrzano" : "aktivno",
      }).onConflictDoNothing().returning({ id: kdsNalogiTable.id });
      if (ticket) await client.insert(kdsDogodkiTable).values({
        nalogId: ticket.id, zaporedje: 1, tip: "materializiran", idempotencyKey: `materialize:${ticket.id}`,
      });
    }
  }
}

async function displayForTenant(id: number, enotaId: number) {
  const [display] = await db.select().from(kdsPrikazovalnikiTable)
    .where(and(eq(kdsPrikazovalnikiTable.id, id), eq(kdsPrikazovalnikiTable.enotaId, enotaId)));
  return display;
}

/** Provision only named standard resources; custom stations and displays survive. */
async function applyStandardProfile(enotaId: number, profile: string) {
  if (profile === "custom") return;
  const required = [
    { ime: "Bar", tip: "bar" as const, vrstniRed: 0 },
    { ime: "Kuhinja", tip: "kitchen" as const, vrstniRed: 1 },
    { ime: "Pica", tip: "pizza" as const, vrstniRed: 2 },
  ];
  for (const station of required) {
    await db.insert(kdsPostajeTable).values({ enotaId, ...station }).onConflictDoNothing();
    // A legacy station with a standard name is safe to normalize: it becomes
    // the named logical lane rather than creating an ambiguous duplicate.
    await db.update(kdsPostajeTable).set({ tip: station.tip, aktivna: true })
      .where(and(eq(kdsPostajeTable.enotaId, enotaId), eq(kdsPostajeTable.ime, station.ime)));
  }
  const stations = await db.select({ id: kdsPostajeTable.id, ime: kdsPostajeTable.ime })
    .from(kdsPostajeTable).where(eq(kdsPostajeTable.enotaId, enotaId));
  const stationIds = new Map<string, number>(stations.map((station) => [station.ime, station.id]));
  const displays = planStandardKdsDisplays(profile as KdsProfile);
  for (const display of displays) {
    const vrstniRed = display.ime === "Bar" ? 0 : display.ime === "Kuhinja" ? 1 : 2;
    await db.insert(kdsPrikazovalnikiTable).values({ enotaId, ime: display.ime, vrstniRed, aktiven: display.active }).onConflictDoNothing();
    await db.update(kdsPrikazovalnikiTable).set({ aktiven: display.active, vrstniRed })
      .where(and(eq(kdsPrikazovalnikiTable.enotaId, enotaId), eq(kdsPrikazovalnikiTable.ime, display.ime)));
    const [saved] = await db.select({ id: kdsPrikazovalnikiTable.id }).from(kdsPrikazovalnikiTable)
      .where(and(eq(kdsPrikazovalnikiTable.enotaId, enotaId), eq(kdsPrikazovalnikiTable.ime, display.ime)));
    if (!saved) continue;
    await db.delete(kdsPrikazovalnikNaročnineTable).where(eq(kdsPrikazovalnikNaročnineTable.prikazovalnikId, saved.id));
    const ids = display.stationTypes.map((tip) => stationIds.get(tip === "bar" ? "Bar" : tip === "kitchen" ? "Kuhinja" : "Pica")).filter((id): id is number => id != null);
    if (ids.length) await db.insert(kdsPrikazovalnikNaročnineTable).values(ids.map((postajaId) => ({ prikazovalnikId: saved.id, postajaId })));
  }
}

router.get("/kds/nastavitve", async (req, res) => {
  const enotaId = enota(req);
  const [settings] = await db.select().from(kdsNastavitveTable).where(eq(kdsNastavitveTable.enotaId, enotaId));
  if (settings) {
    if (await activeStationForTenant(settings.fallbackPostajaId, enotaId)) { res.json(settings); return; }
    const [fallback] = await db.select({ id: kdsPostajeTable.id }).from(kdsPostajeTable)
      .where(and(eq(kdsPostajeTable.enotaId, enotaId), eq(kdsPostajeTable.aktivna, true))).orderBy(asc(kdsPostajeTable.vrstniRed));
    if (!fallback) { res.status(409).json({ error: "Ni aktivne KDS fallback postaje." }); return; }
    const [repaired] = await db.update(kdsNastavitveTable).set({ fallbackPostajaId: fallback.id, posodobljeno: new Date() })
      .where(eq(kdsNastavitveTable.enotaId, enotaId)).returning();
    res.json(repaired); return;
  }
  await ensureKdsUnitConfiguration(enotaId);
  const [created] = await db.select().from(kdsNastavitveTable).where(eq(kdsNastavitveTable.enotaId, enotaId));
  if (!created) { res.status(409).json({ error: "Ni aktivne KDS fallback postaje." }); return; }
  res.json(created);
});
router.put("/kds/nastavitve", async (req, res) => {
  const parsed = UpdateKdsNastavitveBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  req.body = parsed.data;
  const enotaId = enota(req);
  const profil = req.body?.profil;
  const requestedFallbackId = req.body?.fallbackPostajaId == null ? null : positive(req.body.fallbackPostajaId);
  if (!["bar_combined_kitchen", "bar_separate_kitchen_pizza", "custom"].includes(profil)
    || (req.body?.fallbackPostajaId != null && !requestedFallbackId)) {
    res.status(400).json({ error: "Neveljavna KDS konfiguracija." }); return;
  }
  const [existing] = await db.select().from(kdsNastavitveTable).where(eq(kdsNastavitveTable.enotaId, enotaId));
  if (profil !== "custom" && existing?.profil !== profil) await applyStandardProfile(enotaId, profil);
  let fallbackPostajaId = requestedFallbackId;
  if (fallbackPostajaId && !await activeStationForTenant(fallbackPostajaId, enotaId)) {
    res.status(404).json({ error: "Privzeta postaja ni aktivna ali ni najdena v tej enoti." }); return;
  }
  if (!fallbackPostajaId && profil !== "custom") {
    const [kitchen] = await db.select({ id: kdsPostajeTable.id }).from(kdsPostajeTable).where(and(eq(kdsPostajeTable.enotaId, enotaId), eq(kdsPostajeTable.tip, "kitchen"), eq(kdsPostajeTable.aktivna, true)));
    const [firstActive] = kitchen ? [kitchen] : await db.select({ id: kdsPostajeTable.id }).from(kdsPostajeTable).where(and(eq(kdsPostajeTable.enotaId, enotaId), eq(kdsPostajeTable.aktivna, true))).orderBy(asc(kdsPostajeTable.vrstniRed));
    fallbackPostajaId = firstActive?.id ?? null;
  }
  if (!fallbackPostajaId && await activeStationForTenant(existing?.fallbackPostajaId, enotaId)) {
    fallbackPostajaId = existing!.fallbackPostajaId;
  }
  if (!fallbackPostajaId) {
    res.status(409).json({ error: "Nastavite aktivno fallback KDS postajo pred shranjevanjem." }); return;
  }
  const [settings] = await db.insert(kdsNastavitveTable).values({
    enotaId, profil, fallbackPostajaId, dispatchOmogocen: req.body?.dispatchOmogocen === true, posodobljeno: new Date(),
  }).onConflictDoUpdate({
    target: kdsNastavitveTable.enotaId,
    set: { profil, fallbackPostajaId, dispatchOmogocen: req.body?.dispatchOmogocen === true, posodobljeno: new Date() },
  }).returning();
  res.json(settings);
});

router.get("/kds/postaje", async (req, res) => {
  const enotaId = enota(req);
  const [settings] = await db.select({ enotaId: kdsNastavitveTable.enotaId }).from(kdsNastavitveTable).where(eq(kdsNastavitveTable.enotaId, enotaId));
  if (!settings) await ensureKdsUnitConfiguration(enotaId);
  res.json(await db.select().from(kdsPostajeTable).where(eq(kdsPostajeTable.enotaId, enotaId)).orderBy(asc(kdsPostajeTable.vrstniRed)));
});
router.post("/kds/postaje", async (req, res) => {
  const parsed = CreateKdsPostajaBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  req.body = parsed.data;
  const ime = typeof req.body?.ime === "string" ? req.body.ime.trim() : "";
  if (!ime) { res.status(400).json({ error: "Ime postaje je obvezno." }); return; }
  try {
    const tip = ["bar", "kitchen", "pizza", "dispatch", "custom"].includes(req.body?.tip) ? req.body.tip : "custom";
    const [row] = await db.insert(kdsPostajeTable).values({ enotaId: enota(req), ime, tip, vrstniRed: Number(req.body?.vrstniRed) || 0 }).returning();
    res.status(201).json(row);
  } catch { res.status(409).json({ error: "Postaja s tem imenom že obstaja." }); }
});
router.patch("/kds/postaje/:id", async (req, res) => {
  const parsed = UpdateKdsPostajaBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  req.body = parsed.data;
  const id = positive(req.params.id); if (!id) { res.status(400).json({ error: "Neveljaven ID postaje." }); return; }
  const [settings] = await db.select().from(kdsNastavitveTable).where(eq(kdsNastavitveTable.enotaId, enota(req)));
  if (req.body?.aktivna === false && settings?.fallbackPostajaId === id) {
    res.status(409).json({ error: "Fallback postaje ne morete deaktivirati, dokler ne nastavite druge fallback postaje." }); return;
  }
  const values: Record<string, unknown> = {};
  if (typeof req.body?.ime === "string" && req.body.ime.trim()) values.ime = req.body.ime.trim();
  if (typeof req.body?.aktivna === "boolean") values.aktivna = req.body.aktivna;
  if (["bar", "kitchen", "pizza", "dispatch", "custom"].includes(req.body?.tip)) values.tip = req.body.tip;
  if (Number.isInteger(req.body?.vrstniRed)) values.vrstniRed = req.body.vrstniRed;
  const [row] = await db.update(kdsPostajeTable).set(values).where(and(eq(kdsPostajeTable.id, id), eq(kdsPostajeTable.enotaId, enota(req)))).returning();
  if (!row) { res.status(404).json({ error: "Postaja ni najdena." }); return; } res.json(row);
});
router.delete("/kds/postaje/:id", async (req, res) => {
  const id = positive(req.params.id); if (!id) { res.status(400).json({ error: "Neveljaven ID postaje." }); return; }
  const [settings] = await db.select().from(kdsNastavitveTable).where(eq(kdsNastavitveTable.enotaId, enota(req)));
  if (settings?.fallbackPostajaId === id) { res.status(409).json({ error: "Fallback postaje ne morete izbrisati, dokler ne nastavite druge fallback postaje." }); return; }
  const [row] = await db.delete(kdsPostajeTable).where(and(eq(kdsPostajeTable.id, id), eq(kdsPostajeTable.enotaId, enota(req)))).returning();
  if (!row) { res.status(404).json({ error: "Postaja ni najdena." }); return; } res.sendStatus(204);
});
router.get("/kds/postaje/:id/mapiranja", async (req, res) => {
  const id = positive(req.params.id); if (!id || !await stationForTenant(id, enota(req))) { res.status(404).json({ error: "Postaja ni najdena." }); return; }
  res.json(await db.select().from(kdsPostajaMapiranjaTable).where(eq(kdsPostajaMapiranjaTable.postajaId, id)));
});
router.post("/kds/postaje/:id/mapiranja", async (req, res) => {
  const parsed = CreateKdsMapiranjeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  req.body = parsed.data;
  const id = positive(req.params.id), artikelId = positive(req.body?.artikelId), kategorijaId = positive(req.body?.kategorijaId);
  const enotaId = enota(req);
  if (!id || (!artikelId && !kategorijaId) || !await stationForTenant(id, enotaId)) { res.status(400).json({ error: "Neveljavno mapiranje ali postaja." }); return; }
  if (artikelId && !(await db.select({ id: artikliTable.id }).from(artikliTable).where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId))))[0]) { res.status(404).json({ error: "Artikel ni najden." }); return; }
  if (kategorijaId && !(await db.select({ id: kategorijeTable.id }).from(kategorijeTable).where(and(eq(kategorijeTable.id, kategorijaId), eq(kategorijeTable.enotaId, enotaId))))[0]) { res.status(404).json({ error: "Kategorija ni najdena." }); return; }
  const [row] = await db.insert(kdsPostajaMapiranjaTable).values({ postajaId: id, artikelId, kategorijaId }).onConflictDoNothing().returning();
  res.status(row ? 201 : 200).json(row ?? { ok: true });
});
router.delete("/kds/postaje/:id/mapiranja/:mappingId", async (req, res) => {
  const id = positive(req.params.id), mappingId = positive(req.params.mappingId);
  if (!id || !mappingId || !await stationForTenant(id, enota(req))) { res.status(404).json({ error: "Mapiranje ali postaja ni najdena." }); return; }
  await db.delete(kdsPostajaMapiranjaTable).where(and(eq(kdsPostajaMapiranjaTable.id, mappingId), eq(kdsPostajaMapiranjaTable.postajaId, id))); res.sendStatus(204);
});

router.get("/kds/prikazovalniki", async (req, res) => {
  const enotaId = enota(req);
  await ensureKdsUnitConfiguration(enotaId);
  const displays = await db.select().from(kdsPrikazovalnikiTable).where(eq(kdsPrikazovalnikiTable.enotaId, enotaId)).orderBy(asc(kdsPrikazovalnikiTable.vrstniRed));
  const subscriptions = await db.select({
    prikazovalnikId: kdsPrikazovalnikNaročnineTable.prikazovalnikId,
    postajaId: kdsPrikazovalnikNaročnineTable.postajaId,
  }).from(kdsPrikazovalnikNaročnineTable).innerJoin(kdsPrikazovalnikiTable, eq(kdsPrikazovalnikNaročnineTable.prikazovalnikId, kdsPrikazovalnikiTable.id))
    .where(eq(kdsPrikazovalnikiTable.enotaId, enotaId));
  res.json(displays.map((display) => ({ ...display, postajaIds: subscriptions.filter((s) => s.prikazovalnikId === display.id).map((s) => s.postajaId) })));
});
router.post("/kds/prikazovalniki", async (req, res) => {
  const parsed = CreateKdsPrikazovalnikBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  req.body = parsed.data;
  const ime = typeof req.body?.ime === "string" ? req.body.ime.trim() : "";
  if (!ime) { res.status(400).json({ error: "Ime prikazovalnika je obvezno." }); return; }
  try {
    const [display] = await db.insert(kdsPrikazovalnikiTable).values({ enotaId: enota(req), ime, vrstniRed: Number(req.body?.vrstniRed) || 0 }).returning();
    res.status(201).json({ ...display, postajaIds: [] });
  } catch { res.status(409).json({ error: "Prikazovalnik s tem imenom že obstaja." }); }
});
router.patch("/kds/prikazovalniki/:id", async (req, res) => {
  const parsed = UpdateKdsPrikazovalnikBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  req.body = parsed.data;
  const id = positive(req.params.id); if (!id) { res.status(400).json({ error: "Neveljaven ID prikazovalnika." }); return; }
  const values: Record<string, unknown> = {};
  if (typeof req.body?.ime === "string" && req.body.ime.trim()) values.ime = req.body.ime.trim();
  if (typeof req.body?.aktiven === "boolean") values.aktiven = req.body.aktiven;
  if (Number.isInteger(req.body?.vrstniRed)) values.vrstniRed = req.body.vrstniRed;
  const [display] = await db.update(kdsPrikazovalnikiTable).set(values).where(and(eq(kdsPrikazovalnikiTable.id, id), eq(kdsPrikazovalnikiTable.enotaId, enota(req)))).returning();
  if (!display) { res.status(404).json({ error: "Prikazovalnik ni najden." }); return; }
  const subscriptions = await db.select({ postajaId: kdsPrikazovalnikNaročnineTable.postajaId }).from(kdsPrikazovalnikNaročnineTable).where(eq(kdsPrikazovalnikNaročnineTable.prikazovalnikId, id));
  res.json({ ...display, postajaIds: subscriptions.map((s) => s.postajaId) });
});
router.delete("/kds/prikazovalniki/:id", async (req, res) => {
  const id = positive(req.params.id); if (!id) { res.status(400).json({ error: "Neveljaven ID prikazovalnika." }); return; }
  const [display] = await db.delete(kdsPrikazovalnikiTable).where(and(eq(kdsPrikazovalnikiTable.id, id), eq(kdsPrikazovalnikiTable.enotaId, enota(req)))).returning();
  if (!display) { res.status(404).json({ error: "Prikazovalnik ni najden." }); return; } res.sendStatus(204);
});
router.put("/kds/prikazovalniki/:id/narocnine", async (req, res) => {
  const parsed = SetKdsPrikazovalnikNarocnineBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  req.body = parsed.data;
  const id = positive(req.params.id), enotaId = enota(req);
  const rawPostajaIds: unknown[] | null = Array.isArray(req.body?.postajaIds) ? req.body.postajaIds : null;
  const postajaIds: number[] | null = rawPostajaIds ? [...new Set(rawPostajaIds.map(positive).filter((v): v is number => v != null))] : null;
  if (!id || !postajaIds || !await displayForTenant(id, enotaId)) { res.status(400).json({ error: "Neveljaven prikazovalnik ali naročnine." }); return; }
  const validStations = await db.select({ id: kdsPostajeTable.id }).from(kdsPostajeTable).where(eq(kdsPostajeTable.enotaId, enotaId));
  if (postajaIds.some((stationId) => !validStations.some((station) => station.id === stationId))) { res.status(404).json({ error: "Postaja ni najdena v tej enoti." }); return; }
  await db.transaction(async (tx) => {
    await tx.delete(kdsPrikazovalnikNaročnineTable).where(eq(kdsPrikazovalnikNaročnineTable.prikazovalnikId, id));
    if (postajaIds.length) await tx.insert(kdsPrikazovalnikNaročnineTable).values(postajaIds.map((postajaId) => ({ prikazovalnikId: id, postajaId })));
  });
  res.json({ ok: true, postajaIds });
});

router.get("/kds/nerazporejene-postavke", async (req, res) => {
  const enotaId = enota(req);
  const [settings] = await db.select().from(kdsNastavitveTable).where(eq(kdsNastavitveTable.enotaId, enotaId));
  const articles = await db.select({
    artikelId: artikliTable.id, ime: artikliTable.ime, kategorijaId: artikliTable.kategorijaId,
    pripravaVrsta: artikliTable.pripravaVrsta, jePica: artikliTable.jePica,
    kategorijaIme: kategorijeTable.ime, kategorijaTip: kategorijeTable.tip,
  }).from(artikliTable)
    .leftJoin(kategorijeTable, and(eq(kategorijeTable.id, artikliTable.kategorijaId), eq(kategorijeTable.enotaId, enotaId)))
    .where(and(eq(artikliTable.enotaId, enotaId), eq(artikliTable.aktiven, true), eq(artikliTable.prodajniArtikel, true)));
  const mappings = await db.select({ artikelId: kdsPostajaMapiranjaTable.artikelId, kategorijaId: kdsPostajaMapiranjaTable.kategorijaId })
    .from(kdsPostajaMapiranjaTable).innerJoin(kdsPostajeTable, eq(kdsPostajaMapiranjaTable.postajaId, kdsPostajeTable.id))
    .where(and(eq(kdsPostajeTable.enotaId, enotaId), eq(kdsPostajeTable.aktivna, true)));
  const stations = await db.select({ tip: kdsPostajeTable.tip }).from(kdsPostajeTable)
    .where(and(eq(kdsPostajeTable.enotaId, enotaId), eq(kdsPostajeTable.aktivna, true)));
  res.json(articles.filter((article) => {
    if (mappings.some((mapping) => mapping.artikelId === article.artikelId || mapping.kategorijaId === article.kategorijaId)) return false;
    const kind = resolvePreparationKind(article);
    return !kind || !stations.some((station) => station.tip === preparationStationType(kind));
  }).map((article) => ({
    artikelId: article.artikelId, ime: article.ime, kategorijaId: article.kategorijaId,
    boUporabljenFallback: Boolean(settings?.fallbackPostajaId),
  })));
});

router.get("/kds/postaje/:id/nalogi", async (req, res) => {
  const id = positive(req.params.id), enotaId = enota(req);
  if (!id || !await stationForTenant(id, enotaId)) { res.status(404).json({ error: "Postaja ni najdena." }); return; }
  // Lazy recovery covers orders/lines created before KDS was enabled as well as
  // a process failure between POS commit and projection.
  const orderIds = await db.select({ narociloId: narocilaTable.id }).from(narocilaTable)
    .where(and(eq(narocilaTable.enotaId, enotaId), eq(narocilaTable.status, "odprto")));
  await Promise.all(orderIds.map(({ narociloId }) => materializirajKdsNaloge(narociloId, enotaId)));
  const tickets = await db.select().from(kdsNalogiTable).where(and(
    eq(kdsNalogiTable.postajaId, id),
    eq(kdsNalogiTable.enotaId, enotaId),
    // Held tickets are metadata for the POS fire control.  Consumers must not
    // make them actionable until the explicit fire command succeeds.
    inArray(kdsNalogiTable.stanje, ["zadrzano", "aktivno", "bumped"]),
  )).orderBy(asc(kdsNalogiTable.ustvarjeno), asc(kdsNalogiTable.id));
  const releaseEvents = tickets.length
    ? await db.select({
      nalogId: kdsDogodkiTable.nalogId,
      ustvarjeno: kdsDogodkiTable.ustvarjeno,
    }).from(kdsDogodkiTable).where(and(
      inArray(kdsDogodkiTable.nalogId, tickets.map(ticket => ticket.id)),
      eq(kdsDogodkiTable.tip, "sproscen"),
    ))
    : [];
  const releasedAtByTicket = new Map(releaseEvents.map(event => [event.nalogId, event.ustvarjeno]));
  res.json(tickets.map(ticket => ({
    ...ticket,
    aktiviranoAt: ticket.stanje === "zadrzano"
      ? null
      : releasedAtByTicket.get(ticket.id) ?? ticket.ustvarjeno,
  })));
});
router.post("/kds/narocila/:narociloId/materializiraj", async (req, res) => {
  const narociloId = positive(req.params.narociloId), enotaId = enota(req);
  if (!narociloId) { res.status(400).json({ error: "Neveljaven ID naročila." }); return; }
  const [order] = await db.select({ id: narocilaTable.id }).from(narocilaTable)
    .where(and(eq(narocilaTable.id, narociloId), eq(narocilaTable.enotaId, enotaId), eq(narocilaTable.status, "odprto")));
  if (!order) { res.status(404).json({ error: "Odprto naročilo ni najdeno." }); return; }
  await materializirajKdsNaloge(narociloId, enotaId);
  res.json({ ok: true });
});

router.post("/kds/narocila/:narociloId/hod", async (req, res) => {
  const narociloId = positive(req.params.narociloId);
  const parsed = AssignCourseBody.safeParse(req.body);
  if (!narociloId || !parsed.success) {
    res.status(400).json({ error: "Veljavni ID naročila, postavke in hoda so obvezni." }); return;
  }
  try {
    const result = await assignKdsCourse({ narociloId, enotaId: enota(req), ...parsed.data });
    if (result.changed) {
      broadcastToUnit(enota(req), "update", { type: "kds" });
      broadcastToUnit(enota(req), "update", { type: "narocilo", id: narociloId });
    }
    res.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof KdsCourseAssignmentConflict) {
      res.status(409).json({ error: error.message, code: "KDS_COURSE_REASSIGNMENT_CONFLICT" }); return;
    }
    throw error;
  }
});

/**
 * Releases exactly one held course.  This intentionally never auto-releases:
 * the operator controls when a later food/wine pairing reaches the kitchen
 * and bar, after every earlier course has been completed.
 */
router.post("/kds/narocila/:narociloId/tecaji/:courseNumber/fire", async (req, res) => {
  const narociloId = positive(req.params.narociloId);
  const courseNumber = positive(req.params.courseNumber);
  const enotaId = enota(req);
  const idempotencyKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey.trim() : "";
  const suppliedPairingGroupId = typeof req.body?.pairingGroupId === "string" ? req.body.pairingGroupId.trim() : "";
  if (!narociloId || !courseNumber || !idempotencyKey || idempotencyKey.length > 200) {
    res.status(400).json({ error: "Veljavni ID naročila, hod in idempotencyKey so obvezni." }); return;
  }
  try {
    const released = await db.transaction(async (tx) => {
      await lockKdsOrder(tx, narociloId);
      const [order] = await tx.select({ id: narocilaTable.id }).from(narocilaTable).where(and(
        eq(narocilaTable.id, narociloId), eq(narocilaTable.enotaId, enotaId), eq(narocilaTable.status, "odprto"),
      )).for("update");
      if (!order) throw new Error("KDS_ORDER_NOT_OPEN");
      await materializirajKdsNaloge(narociloId, enotaId, tx);
      const tickets = await tx.select().from(kdsNalogiTable).where(and(
        eq(kdsNalogiTable.enotaId, enotaId), eq(kdsNalogiTable.narociloId, narociloId),
      ));
      // Older callers do not send a pairing id. Keep that URL contract only
      // when the held course label identifies one pairing unambiguously.
      const matchingPairings = [...new Set(tickets
        .filter((ticket) => ticket.stanje === "zadrzano" && ticket.courseNumber === courseNumber && ticket.pairingGroupId)
        .map((ticket) => ticket.pairingGroupId!))];
      const pairingGroupId = suppliedPairingGroupId || (matchingPairings.length === 1 ? matchingPairings[0]! : "");
      if (!pairingGroupId) throw new Error("KDS_COURSE_NOT_FOUND");
      const heldForPairing = tickets.filter((ticket) => ticket.pairingGroupId === pairingGroupId && ticket.stanje === "zadrzano");
      const nextSequence = heldForPairing.reduce<number | null>((minimum, ticket) => (
        ticket.courseSequence != null && (minimum == null || ticket.courseSequence < minimum)
          ? ticket.courseSequence : minimum
      ), null);
      const target = heldForPairing.filter((ticket) => ticket.courseNumber === courseNumber && ticket.courseSequence === nextSequence);
      if (!target.length) throw new Error("KDS_COURSE_NOT_FOUND");
      const priorIncomplete = tickets.some((ticket) => ticket.pairingGroupId === pairingGroupId
        && ticket.courseSequence != null && ticket.courseSequence < nextSequence!
        && ticket.stanje !== "bumped" && ticket.stanje !== "ack");
      if (priorIncomplete) throw new Error("KDS_PREVIOUS_COURSE_NOT_READY");
      for (const ticket of target) {
        const sequence = await tx.execute(sql<{ next: number }>`
          SELECT COALESCE(MAX(zaporedje), 0) + 1 AS next FROM kds_dogodki WHERE nalog_id = ${ticket.id}`);
        await tx.update(kdsNalogiTable).set({ stanje: "aktivno" }).where(eq(kdsNalogiTable.id, ticket.id));
        await tx.insert(kdsDogodkiTable).values({
          nalogId: ticket.id, zaporedje: Number(sequence.rows[0]?.next ?? 1),
          tip: "sproscen", idempotencyKey: `fire:${idempotencyKey}`,
        });
      }
      return { released: true, pairingGroupId };
    });
    if (released.released) broadcastToUnit(enotaId, "update", { type: "kds" });
    res.json({ ok: true, released: courseNumber, pairingGroupId: released.pairingGroupId });
  } catch (error) {
    if (error instanceof Error && ["KDS_ORDER_NOT_OPEN", "KDS_COURSE_NOT_FOUND", "KDS_PREVIOUS_COURSE_NOT_READY", "KDS_COURSE_NOT_HELD"].includes(error.message)) {
      res.status(409).json({ error: error.message === "KDS_PREVIOUS_COURSE_NOT_READY"
        ? "Prejšnji hod mora biti najprej v celoti pripravljen." : "Hoda ni mogoče sprostiti." }); return;
    }
    throw error;
  }
});

router.get("/kds/izdaja", async (req, res) => {
  const enotaId = enota(req);
  await ensureKdsUnitConfiguration(enotaId);
  const [settings] = await db.select().from(kdsNastavitveTable).where(eq(kdsNastavitveTable.enotaId, enotaId));
  if (!settings?.dispatchOmogocen) { res.status(403).json({ error: "KDS izdaja ni omogočena za to enoto." }); return; }
  const orders = await db.select({
    id: narocilaTable.id, stevilkaNarocila: narocilaTable.stevilkaNarocila, ustvarjeno: narocilaTable.ustvarjeno,
    predvidenPrevzem: narocilaTable.predvidenPrevzem, opomba: narocilaTable.opomba, strankaIme: narocilaTable.strankaIme,
    nacin: narocilaTable.nacin, nacinIzpolnitve: narocilaTable.nacinIzpolnitve,
    mizaId: narocilaTable.mizaId, mizaIme: mizeTable.ime, mizaStevilka: mizeTable.stevilka, prostorIme: prostoriTable.ime,
  }).from(narocilaTable).leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .leftJoin(prostoriTable, eq(mizeTable.prostorId, prostoriTable.id))
    .where(and(eq(narocilaTable.enotaId, enotaId), eq(narocilaTable.status, "odprto"))).orderBy(asc(narocilaTable.ustvarjeno));
  await Promise.all(orders.map((order) => materializirajKdsNaloge(order.id, enotaId)));
  const orderIds = orders.map((order) => order.id);
  if (!orderIds.length) { res.json([]); return; }
  const [tickets, dispatched, lines] = await Promise.all([
    db.select({ narociloId: kdsNalogiTable.narociloId, stanje: kdsNalogiTable.stanje, postajaIme: kdsPostajeTable.ime })
      .from(kdsNalogiTable).innerJoin(kdsPostajeTable, eq(kdsNalogiTable.postajaId, kdsPostajeTable.id))
      .where(and(eq(kdsNalogiTable.enotaId, enotaId), inArray(kdsNalogiTable.narociloId, orderIds), ne(kdsNalogiTable.stanje, "preklicano"))),
    db.select({ narociloId: kdsIzdajaDogodkiTable.narociloId }).from(kdsIzdajaDogodkiTable)
      .where(and(eq(kdsIzdajaDogodkiTable.enotaId, enotaId), inArray(kdsIzdajaDogodkiTable.narociloId, orderIds))),
    db.select({ narociloId: postavkeTable.narociloId, id: postavkeTable.id, ime: postavkeTable.ime, kolicina: postavkeTable.kolicina, opomba: postavkeTable.opomba })
      .from(postavkeTable).where(and(inArray(postavkeTable.narociloId, orderIds), isNull(postavkeTable.parentPostavkaId))),
  ]);
  const dispatchedIds = new Set(dispatched.map((event) => event.narociloId));
  res.json(orders.filter((order) => {
    const states = tickets.filter((ticket) => ticket.narociloId === order.id).map((ticket) => ticket.stanje);
    return !dispatchedIds.has(order.id) && isDispatchEligible(states);
  }).map((order) => ({
    ...order,
    postavke: lines.filter((line) => line.narociloId === order.id),
    postaje: tickets.filter((ticket) => ticket.narociloId === order.id)
      .map((ticket) => ({ ime: ticket.postajaIme, stanje: ticket.stanje })),
  })));
});

router.post("/kds/narocila/:narociloId/izdaj", async (req, res) => {
  const narociloId = positive(req.params.narociloId), enotaId = enota(req);
  const idempotencyKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey.trim() : "";
  if (!narociloId || !idempotencyKey || idempotencyKey.length > 200) { res.status(400).json({ error: "Veljaven idempotencyKey je obvezen." }); return; }
  await ensureKdsUnitConfiguration(enotaId);
  const [settings] = await db.select().from(kdsNastavitveTable).where(eq(kdsNastavitveTable.enotaId, enotaId));
  if (!settings?.dispatchOmogocen) { res.status(403).json({ error: "KDS izdaja ni omogočena za to enoto." }); return; }
  let inserted = false;
  try {
    const event = await db.transaction(async (tx) => {
      await lockKdsOrder(tx, narociloId);
      const [sameKey] = await tx.select().from(kdsIzdajaDogodkiTable).where(and(
        eq(kdsIzdajaDogodkiTable.enotaId, enotaId), eq(kdsIzdajaDogodkiTable.idempotencyKey, idempotencyKey),
      ));
      if (sameKey) {
        if (sameKey.narociloId !== narociloId) throw new Error("KDS_IDEMPOTENCY_KEY_REUSED");
        return sameKey;
      }
      const [order] = await tx.select({ id: narocilaTable.id }).from(narocilaTable).where(and(
        eq(narocilaTable.id, narociloId), eq(narocilaTable.enotaId, enotaId), eq(narocilaTable.status, "odprto"),
      )).for("update");
      if (!order) throw new Error("KDS_ORDER_NOT_OPEN");
      const [previous] = await tx.select({ id: kdsIzdajaDogodkiTable.id }).from(kdsIzdajaDogodkiTable)
        .where(and(eq(kdsIzdajaDogodkiTable.narociloId, narociloId), eq(kdsIzdajaDogodkiTable.enotaId, enotaId)));
      if (previous) throw new Error("KDS_ORDER_DISPATCHED");
      await materializirajKdsNaloge(narociloId, enotaId, tx);
      const tickets = await tx.select({ stanje: kdsNalogiTable.stanje }).from(kdsNalogiTable)
        .where(and(eq(kdsNalogiTable.narociloId, narociloId), eq(kdsNalogiTable.enotaId, enotaId), ne(kdsNalogiTable.stanje, "preklicano")));
      if (!isDispatchEligible(tickets.map((ticket) => ticket.stanje))) throw new Error("KDS_NOT_READY");
      const [created] = await tx.insert(kdsIzdajaDogodkiTable).values({
        enotaId, narociloId, idempotencyKey, actorClerkUserId: (req as any).clerkUserId ?? "pos",
      }).returning();
      inserted = true;
      return created;
    });
    if (inserted) broadcastToUnit(enotaId, "update", { type: "kds" });
    res.json({ ok: true, event });
  } catch (error) {
    if (error instanceof Error && ["KDS_ORDER_NOT_OPEN", "KDS_ORDER_DISPATCHED", "KDS_NOT_READY", "KDS_IDEMPOTENCY_KEY_REUSED"].includes(error.message)) {
      res.status(409).json({ error: error.message === "KDS_NOT_READY" ? "Vsi KDS nalogi morajo biti bumped." : "Naročilo ni odprto ali je že predano." }); return;
    }
    throw error;
  }
});

async function transition(req: any, res: any, tip: "bump" | "ack") {
  const enotaId = enota(req);
  const id = positive(req.params.id), key = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey.trim() : "";
  if (!id || !key || key.length > 200) { res.status(400).json({ error: "ID in idempotencyKey sta obvezna." }); return; }
  const [ticket] = await db.select().from(kdsNalogiTable).where(and(eq(kdsNalogiTable.id, id), eq(kdsNalogiTable.enotaId, enota(req))));
  if (!ticket) { res.status(404).json({ error: "KDS nalog ni najden." }); return; }
  if (tip === "ack") {
    const [settings] = await db.select({ dispatchOmogocen: kdsNastavitveTable.dispatchOmogocen }).from(kdsNastavitveTable)
      .where(eq(kdsNastavitveTable.enotaId, enota(req)));
    if (settings?.dispatchOmogocen) { res.status(409).json({ error: "V enoti z izdajo se nalogi predajo na ravni naročila." }); return; }
  }
  let changed = false;
  try {
    await db.transaction(async (tx) => {
      await lockKdsOrder(tx, ticket.narociloId);
      const [current] = await tx.select().from(kdsNalogiTable).where(and(
        eq(kdsNalogiTable.id, id),
        eq(kdsNalogiTable.enotaId, enota(req)),
      )).for("update");
      if (!current) throw new Error("KDS_TICKET_NOT_FOUND");
      const [existing] = await tx.select({ id: kdsDogodkiTable.id }).from(kdsDogodkiTable).where(and(
        eq(kdsDogodkiTable.nalogId, id),
        eq(kdsDogodkiTable.idempotencyKey, key),
      ));
      // A retry is safe even after a later cancellation. A new transition must
      // still match the state observed after the shared order lock.
      if (!canApplyKdsCommand(current.stanje, tip, Boolean(existing))) {
        throw new Error("KDS_INVALID_TRANSITION");
      }
      if (existing) return;
      const expectedState = tip === "bump" ? "aktivno" : "bumped";
      const sequence = await tx.execute(sql<{ next: number }>`SELECT COALESCE(MAX(zaporedje), 0) + 1 AS next FROM kds_dogodki WHERE nalog_id = ${id}`);
      const [updated] = await tx.update(kdsNalogiTable)
        .set(tip === "bump" ? { stanje: "bumped", bumpedAt: new Date() } : { stanje: "ack", ackAt: new Date() })
        .where(and(eq(kdsNalogiTable.id, id), eq(kdsNalogiTable.stanje, expectedState)))
        .returning({ id: kdsNalogiTable.id });
      if (!updated) throw new Error("KDS_INVALID_TRANSITION");
      await tx.insert(kdsDogodkiTable).values({
        nalogId: id, zaporedje: Number(sequence.rows[0]?.next ?? 1), tip, idempotencyKey: key,
      });
      changed = true;
    });
  } catch (error) {
    if (error instanceof Error && ["KDS_TICKET_NOT_FOUND", "KDS_INVALID_TRANSITION"].includes(error.message)) {
      res.status(error.message === "KDS_TICKET_NOT_FOUND" ? 404 : 409).json({
        error: error.message === "KDS_TICKET_NOT_FOUND"
          ? "KDS nalog ni najden."
          : tip === "bump" ? "Nalog ni več aktiven za bump." : "Nalog mora biti najprej bumped.",
      });
      return;
    }
    throw error;
  }
  if (changed) {
    broadcastToUnit(enotaId, "update", { type: "kds" });
  }
  const events = await db.select().from(kdsDogodkiTable).where(eq(kdsDogodkiTable.nalogId, id)).orderBy(asc(kdsDogodkiTable.zaporedje));
  res.json({ ok: true, events });
}
router.post("/kds/nalogi/:id/bump", (req, res) => transition(req, res, "bump"));
router.post("/kds/nalogi/:id/ack", (req, res) => transition(req, res, "ack"));
router.get("/kds/nalogi/:id/zgodovina", async (req, res) => {
  const id = positive(req.params.id); const [ticket] = id ? await db.select().from(kdsNalogiTable).where(and(eq(kdsNalogiTable.id, id), eq(kdsNalogiTable.enotaId, enota(req)))) : [];
  if (!ticket) { res.status(404).json({ error: "KDS nalog ni najden." }); return; }
  res.json(await db.select().from(kdsDogodkiTable).where(eq(kdsDogodkiTable.nalogId, id!)).orderBy(asc(kdsDogodkiTable.zaporedje)));
});

export default router;