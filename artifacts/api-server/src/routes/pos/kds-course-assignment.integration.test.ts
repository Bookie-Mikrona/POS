import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  artikliTable, companiesTable, db, enoteTable, kdsDogodkiTable, kdsIzdajaDogodkiTable,
  kdsNalogiTable, kdsPostajeTable, narocilaTable, natakariTable, pool, posAiAgentAuditTable, postavkeTable,
} from "@workspace/db";
import {
  assignKdsCourse, assignKdsCourses, fingerprintKdsCourseAssignmentOrder, KdsCourseAssignmentConflict,
} from "./kds";
import {
  consumeBatchCourseClarificationAssignments, consumeCourseClarificationAssignment,
  signCourseClarificationToken, verifyCourseClarificationToken,
} from "./glasovni-ukaz";

const run = Math.random().toString(36).slice(2, 10);
let companyId: string, enotaId: number, artikelId: number, stationId: number, secondStationId: number, natakarId: number;
const orders: number[] = [];

async function order() {
  const [row] = await db.insert(narocilaTable).values({ enotaId, stevilkaNarocila: 700000 + orders.length }).returning({ id: narocilaTable.id });
  orders.push(row!.id); return row!.id;
}
async function line(narociloId: number, values: Record<string, unknown> = {}) {
  const [row] = await db.insert(postavkeTable).values({
    narociloId, artikelId, ime: `course ${run}`, kolicina: 1, cenaKos: "1", skupaj: "1", davek: "22", ...values,
  } as any).returning();
  return row!;
}
async function ticket(narociloId: number, postavkaId: number, values: Record<string, unknown> = {}) {
  const [row] = await db.insert(kdsNalogiTable).values({
    enotaId, postajaId: stationId, narociloId, postavkaId, stanje: "aktivno", ...values,
  } as any).returning();
  return row!;
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({ podjetjeDavcna: `SI_COURSE_${run}`, naziv: `course ${run}` }).returning({ id: companiesTable.id });
  companyId = company!.id;
  const [unit] = await db.insert(enoteTable).values({ companyId, ime: `course ${run}` }).returning({ id: enoteTable.id });
  enotaId = unit!.id;
  const [article] = await db.insert(artikliTable).values({ enotaId, ime: `course ${run}`, cena: "1", davek: "22", vrstniRed: 1 }).returning({ id: artikliTable.id });
  artikelId = article!.id;
  const [station] = await db.insert(kdsPostajeTable).values({ enotaId, ime: `course ${run}`, tip: "kitchen", vrstniRed: 1 }).returning({ id: kdsPostajeTable.id });
  stationId = station!.id;
  const [secondStation] = await db.insert(kdsPostajeTable).values({ enotaId, ime: `course held ${run}`, tip: "bar", vrstniRed: 2 }).returning({ id: kdsPostajeTable.id });
  secondStationId = secondStation!.id;
  const [natakar] = await db.insert(natakariTable).values({
    companyId, ime: `course ${run}`, priimek: "Natakar",
  }).returning({ id: natakariTable.id });
  natakarId = natakar!.id;
});

afterAll(async () => {
  // Both event tables are append-only. Disable only for fixture teardown and
  // restore in finally so a failed cleanup never weakens production protection.
  await pool.query("ALTER TABLE kds_dogodki DISABLE TRIGGER kds_dogodki_append_only");
  await pool.query("ALTER TABLE kds_izdaja_dogodki DISABLE TRIGGER kds_izdaja_dogodki_append_only");
  try {
    if (orders.length) {
      const tickets = await db.select({ id: kdsNalogiTable.id }).from(kdsNalogiTable).where(inArray(kdsNalogiTable.narociloId, orders));
      if (tickets.length) await db.delete(kdsDogodkiTable).where(inArray(kdsDogodkiTable.nalogId, tickets.map(t => t.id)));
      await db.delete(kdsIzdajaDogodkiTable).where(inArray(kdsIzdajaDogodkiTable.narociloId, orders));
      await db.delete(kdsNalogiTable).where(inArray(kdsNalogiTable.narociloId, orders));
      await db.delete(narocilaTable).where(inArray(narocilaTable.id, orders));
    }
  } finally {
    await pool.query("ALTER TABLE kds_dogodki ENABLE TRIGGER kds_dogodki_append_only");
    await pool.query("ALTER TABLE kds_izdaja_dogodki ENABLE TRIGGER kds_izdaja_dogodki_append_only");
  }
  await db.delete(kdsPostajeTable).where(eq(kdsPostajeTable.id, stationId));
  await db.delete(kdsPostajeTable).where(eq(kdsPostajeTable.id, secondStationId));
  await db.delete(posAiAgentAuditTable).where(eq(posAiAgentAuditTable.actorNatakarId, natakarId));
  await db.delete(natakariTable).where(eq(natakariTable.id, natakarId));
  await db.delete(artikliTable).where(eq(artikliTable.id, artikelId));
  await db.delete(enoteTable).where(eq(enoteTable.id, enotaId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("assignKdsCourse PostgreSQL integration", () => {
  it("groups an ordinary parent and modifier with an idempotent repeat", async () => {
    const narociloId = await order();
    const parent = await line(narociloId);
    const modifier = await line(narociloId, { parentPostavkaId: parent.id, cenaKos: "0", skupaj: "0" });
    const first = await assignKdsCourse({ narociloId, enotaId, postavkaId: parent.id, courseNumber: 2 });
    expect(first.changed).toBe(true);
    const rows = await db.select().from(postavkeTable).where(inArray(postavkeTable.id, [parent.id, modifier.id]));
    expect(rows.map(row => [row.courseNumber, row.courseSequence, row.pairingGroupId])).toEqual([
      [2, 2, first.pairingGroupId], [2, 2, first.pairingGroupId],
    ]);
    await expect(assignKdsCourse({ narociloId, enotaId, postavkaId: parent.id, courseNumber: 2 }))
      .resolves.toMatchObject({ changed: false, pairingGroupId: first.pairingGroupId });
  });

  it("moves a multicourse pairing as one group while preserving its sequence", async () => {
    const narociloId = await order(), group = `menu:${run}:${narociloId}`;
    const commercial = await line(narociloId, { pairingGroupId: group });
    const first = await line(narociloId, {
      pairingGroupId: group, courseNumber: 1, courseSequence: 1, courseNameSnapshot: "Pozdrav iz kuhinje",
    });
    const second = await line(narociloId, {
      pairingGroupId: group, courseNumber: 3, courseSequence: 2, courseNameSnapshot: "Glavna jed",
    });
    await assignKdsCourse({ narociloId, enotaId, postavkaId: first.id, courseNumber: 2 });
    const rows = await db.select().from(postavkeTable).where(inArray(postavkeTable.id, [commercial.id, first.id, second.id]));
    expect(rows.map(row => [row.id, row.courseNumber, row.courseSequence, row.pairingGroupId])).toEqual([
      [commercial.id, null, null, group], [first.id, 2, 1, group], [second.id, 4, 2, group],
    ]);
    expect(rows.map(row => row.courseNameSnapshot)).toEqual([
      null, "Pozdrav iz kuhinje", "Glavna jed",
    ]);
  });

  it("recognizes and moves a single-course menu through its commercial row", async () => {
    const narociloId = await order(), group = `single-menu:${run}:${narociloId}`;
    const commercial = await line(narociloId, { pairingGroupId: group });
    const food = await line(narociloId, { pairingGroupId: group, courseNumber: 1, courseSequence: 4 });
    const wine = await line(narociloId, { pairingGroupId: group, courseNumber: 1, courseSequence: 4, cenaKos: "0", skupaj: "0" });
    await assignKdsCourse({ narociloId, enotaId, postavkaId: food.id, courseNumber: 3 });
    const rows = await db.select().from(postavkeTable).where(inArray(postavkeTable.id, [commercial.id, food.id, wine.id]));
    expect(rows.map(row => [row.id, row.courseNumber, row.courseSequence, row.pairingGroupId])).toEqual([
      [commercial.id, null, null, group], [food.id, 3, 4, group], [wine.id, 3, 4, group],
    ]);
  });

  it("uses the first course as anchor when the commercial menu row is selected", async () => {
    const narociloId = await order(), group = `commercial-anchor:${run}:${narociloId}`;
    const commercial = await line(narociloId, { pairingGroupId: group });
    const food = await line(narociloId, { pairingGroupId: group, courseNumber: 2, courseSequence: 3 });
    const wine = await line(narociloId, { pairingGroupId: group, courseNumber: 2, courseSequence: 3, cenaKos: "0", skupaj: "0" });
    const foodTicket = await ticket(narociloId, food.id, { courseNumber: 2, courseSequence: 3, pairingGroupId: group });
    const wineTicket = await ticket(narociloId, wine.id, { postajaId: secondStationId, courseNumber: 2, courseSequence: 3, pairingGroupId: group });
    const first = await assignKdsCourse({ narociloId, enotaId, postavkaId: commercial.id, courseNumber: 1 });
    expect(first).toMatchObject({ changed: true, pairingGroupId: group });
    const lines = await db.select().from(postavkeTable).where(inArray(postavkeTable.id, [commercial.id, food.id, wine.id]));
    expect(lines.map(row => [row.id, row.courseNumber, row.courseSequence, row.pairingGroupId])).toEqual([
      [commercial.id, null, null, group], [food.id, 1, 3, group], [wine.id, 1, 3, group],
    ]);
    const tickets = await db.select().from(kdsNalogiTable).where(inArray(kdsNalogiTable.id, [foodTicket.id, wineTicket.id]));
    expect(tickets.map(row => [row.courseNumber, row.courseSequence, row.pairingGroupId])).toEqual([
      [1, 3, group], [1, 3, group],
    ]);
    await expect(assignKdsCourse({ narociloId, enotaId, postavkaId: commercial.id, courseNumber: 1 }))
      .resolves.toMatchObject({ changed: false, pairingGroupId: group });
  });

  it("synchronizes already materialized active and held tickets", async () => {
    const narociloId = await order(), parent = await line(narociloId);
    const active = await ticket(narociloId, parent.id);
    const held = await ticket(narociloId, parent.id, { stanje: "zadrzano", postajaId: secondStationId });
    const result = await assignKdsCourse({ narociloId, enotaId, postavkaId: parent.id, courseNumber: 3 });
    const rows = await db.select().from(kdsNalogiTable).where(inArray(kdsNalogiTable.id, [active.id, held.id]));
    expect(rows.map(row => [row.courseNumber, row.courseSequence, row.pairingGroupId])).toEqual([
      [3, 3, result.pairingGroupId], [3, 3, result.pairingGroupId],
    ]);
  });

  it("assigns independent groups atomically and synchronizes their tickets", async () => {
    const narociloId = await order();
    const first = await line(narociloId), second = await line(narociloId);
    const firstTicket = await ticket(narociloId, first.id);
    const secondTicket = await ticket(narociloId, second.id, { postajaId: secondStationId });
    const result = await assignKdsCourses({
      narociloId, enotaId,
      assignments: [{ postavkaId: first.id, courseNumber: 1 }, { postavkaId: second.id, courseNumber: 3 }],
    });
    expect(result).toMatchObject({ changed: true, assignments: [
      { postavkaId: first.id, courseNumber: 1, changed: true },
      { postavkaId: second.id, courseNumber: 3, changed: true },
    ] });
    expect((await db.select().from(postavkeTable).where(inArray(postavkeTable.id, [first.id, second.id])))
      .map(row => [row.courseNumber, row.courseSequence])).toEqual([[1, 1], [3, 3]]);
    expect((await db.select().from(kdsNalogiTable).where(inArray(kdsNalogiTable.id, [firstTicket.id, secondTicket.id])))
      .map(row => [row.courseNumber, row.courseSequence])).toEqual([[1, 1], [3, 3]]);
  });

  it("rejects conflicting duplicate references to one resolved group", async () => {
    const narociloId = await order(), parent = await line(narociloId);
    const modifier = await line(narociloId, { parentPostavkaId: parent.id, cenaKos: "0", skupaj: "0" });
    await expect(assignKdsCourses({
      narociloId, enotaId,
      assignments: [{ postavkaId: parent.id, courseNumber: 1 }, { postavkaId: modifier.id, courseNumber: 2 }],
    })).rejects.toThrow("Ista skupina postavk");
    expect((await db.select().from(postavkeTable).where(inArray(postavkeTable.id, [parent.id, modifier.id])))
      .map(row => [row.courseNumber, row.courseSequence, row.pairingGroupId])).toEqual([[null, null, null], [null, null, null]]);
  });

  it("rolls back the complete batch when a later ticket was released", async () => {
    const narociloId = await order(), first = await line(narociloId), second = await line(narociloId);
    const firstTicket = await ticket(narociloId, first.id);
    const secondTicket = await ticket(narociloId, second.id);
    await db.insert(kdsDogodkiTable).values({ nalogId: secondTicket.id, zaporedje: 1, tip: "sproscen", idempotencyKey: `batch-release:${run}:${narociloId}` });
    const beforeLines = await db.select().from(postavkeTable).where(inArray(postavkeTable.id, [first.id, second.id]));
    const beforeTickets = await db.select().from(kdsNalogiTable).where(inArray(kdsNalogiTable.id, [firstTicket.id, secondTicket.id]));
    await expect(assignKdsCourses({
      narociloId, enotaId,
      assignments: [{ postavkaId: first.id, courseNumber: 1 }, { postavkaId: second.id, courseNumber: 2 }],
    })).rejects.toBeInstanceOf(KdsCourseAssignmentConflict);
    expect(await db.select().from(postavkeTable).where(inArray(postavkeTable.id, [first.id, second.id]))).toEqual(beforeLines);
    expect(await db.select().from(kdsNalogiTable).where(inArray(kdsNalogiTable.id, [firstTicket.id, secondTicket.id]))).toEqual(beforeTickets);
  });

  it("rejects released tickets and dispatched orders without changing rows", async () => {
    const releasedOrder = await order(), releasedLine = await line(releasedOrder, { courseNumber: 1, courseSequence: 1, pairingGroupId: `r:${run}` });
    const releasedTicket = await ticket(releasedOrder, releasedLine.id);
    await db.insert(kdsDogodkiTable).values({ nalogId: releasedTicket.id, zaporedje: 1, tip: "sproscen", idempotencyKey: `release:${run}` });
    const beforeReleased = await db.select().from(postavkeTable).where(eq(postavkeTable.id, releasedLine.id));
    const beforeReleasedTicket = await db.select().from(kdsNalogiTable).where(eq(kdsNalogiTable.id, releasedTicket.id));
    await expect(assignKdsCourse({ narociloId: releasedOrder, enotaId, postavkaId: releasedLine.id, courseNumber: 2 })).rejects.toBeInstanceOf(KdsCourseAssignmentConflict);
    expect(await db.select().from(postavkeTable).where(eq(postavkeTable.id, releasedLine.id))).toEqual(beforeReleased);
    expect(await db.select().from(kdsNalogiTable).where(eq(kdsNalogiTable.id, releasedTicket.id))).toEqual(beforeReleasedTicket);

    const dispatchedOrder = await order(), dispatchedLine = await line(dispatchedOrder);
    await db.insert(kdsIzdajaDogodkiTable).values({ enotaId, narociloId: dispatchedOrder, idempotencyKey: `dispatch:${run}`, actorClerkUserId: "test" });
    const beforeDispatched = await db.select().from(postavkeTable).where(eq(postavkeTable.id, dispatchedLine.id));
    await expect(assignKdsCourse({ narociloId: dispatchedOrder, enotaId, postavkaId: dispatchedLine.id, courseNumber: 2 })).rejects.toBeInstanceOf(KdsCourseAssignmentConflict);
    expect(await db.select().from(postavkeTable).where(eq(postavkeTable.id, dispatchedLine.id))).toEqual(beforeDispatched);
  });

  it("allows exactly one concurrent assignment from the same clarification token", async () => {
    const narociloId = await order();
    const parent = await line(narociloId);
    const options = [
      { courseNumber: 2, courseName: "Ribji hod" },
      { courseNumber: 3, courseName: "Ribji posebni hod" },
    ];
    const token = signCourseClarificationToken({
      enotaId,
      actorNatakarId: natakarId,
      narociloId,
      postavkaId: parent.id,
      options,
      orderFingerprint: fingerprintKdsCourseAssignmentOrder({
        id: narociloId,
        status: "odprto",
        postavke: [parent],
      }),
    }, "integration-course-clarification-secret")!;
    const payload = verifyCourseClarificationToken(token, "integration-course-clarification-secret")!;
    const attempt = (courseNumber: number) => consumeCourseClarificationAssignment({
      payload,
      result: {
        action: "assign_course",
        narociloId,
        postavkaId: parent.id,
        courseNumber,
        odgovor: "test",
      },
      enotaId,
      actorNatakarId: natakarId,
      napravaId: null,
    });
    const outcomes = await Promise.allSettled([attempt(2), attempt(3)]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
    const [saved] = await db.select().from(postavkeTable).where(eq(postavkeTable.id, parent.id));
    const winner = outcomes[0]!.status === "fulfilled" ? 2 : 3;
    expect(saved).toMatchObject({ courseNumber: winner, courseSequence: winner });
    const consumed = (await db.select().from(posAiAgentAuditTable)
      .where(eq(posAiAgentAuditTable.action, "clarify_course_consumed")))
      .filter(row => (row.metadata as { clarificationId?: string }).clarificationId === payload.clarificationId);
    expect(consumed).toHaveLength(1);
  });

  it("allows exactly one concurrent replay of a complete clarified batch", async () => {
    const narociloId = await order();
    const first = await line(narociloId);
    const ambiguous = await line(narociloId);
    const options = [
      { courseNumber: 2, courseName: "Ribji hod" },
      { courseNumber: 3, courseName: "Ribji posebni hod" },
    ];
    const token = signCourseClarificationToken({
      enotaId,
      actorNatakarId: natakarId,
      narociloId,
      targetPostavkaId: ambiguous.id,
      assignments: [{ postavkaId: first.id, courseNumber: 1 }],
      options,
      orderFingerprint: fingerprintKdsCourseAssignmentOrder({
        id: narociloId,
        status: "odprto",
        postavke: [first, ambiguous],
      }),
    }, "integration-batch-course-clarification-secret")!;
    const payload = verifyCourseClarificationToken(token, "integration-batch-course-clarification-secret")!;
    expect(payload.v).toBe(2);
    if (payload.v !== 2) throw new Error("Expected batch clarification payload");
    const attempt = () => consumeBatchCourseClarificationAssignments({
      payload,
      result: {
        action: "assign_courses",
        narociloId,
        assignments: [
          { postavkaId: first.id, courseNumber: 1, naziv: first.ime },
          { postavkaId: ambiguous.id, courseNumber: 3, naziv: ambiguous.ime },
        ],
        odgovor: "test",
      },
      enotaId,
      actorNatakarId: natakarId,
      napravaId: null,
    });
    const outcomes = await Promise.allSettled([attempt(), attempt()]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
    expect((await db.select().from(postavkeTable).where(inArray(postavkeTable.id, [first.id, ambiguous.id])))
      .map(row => [row.id, row.courseNumber, row.courseSequence])).toEqual([
        [first.id, 1, 1],
        [ambiguous.id, 3, 3],
      ]);
    const consumed = (await db.select().from(posAiAgentAuditTable)
      .where(eq(posAiAgentAuditTable.action, "clarify_course_consumed")))
      .filter(row => (row.metadata as { clarificationId?: string }).clarificationId === payload.clarificationId);
    expect(consumed).toHaveLength(1);
  });
});