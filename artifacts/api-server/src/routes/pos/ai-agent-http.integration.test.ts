import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

vi.mock("@clerk/express", () => ({
  getAuth: (req: express.Request) => ({ userId: req.header("x-test-user") ?? null }),
}));

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: vi.fn() } },
}));

import {
  artikliTable,
  companiesTable,
  db,
  enoteTable,
  izmeneTable,
  kdsNalogiTable,
  kdsPostajeTable,
  multicourseMenuCoursesTable,
  multicourseMenusTable,
  napraveTable,
  narocilaTable,
  natakariTable,
  posAiAgentAuditTable,
  posUporabnikiTable,
  postavkeTable,
} from "@workspace/db";
import {
  posActorContext,
  requireEnota,
  requireUnitCapability,
} from "../../middlewares/pos";
import router, { verifyCourseClarificationToken } from "./glasovni-ukaz";

const run = `agent-http-${Math.random().toString(36).slice(2, 10)}`;
const clerkUserId = `${run}-clerk`;
const previousSessionSecret = process.env.SESSION_SECRET;
const previousActorSecret = process.env.POS_ACTOR_SESSION_SECRET;

let companyId = "";
let enotaA = 0;
let enotaB = 0;
let napravaA = { id: 0, key: "" };
let napravaB = { id: 0, key: "" };
let actorA = 0;
let actorB = 0;
let shiftA = 0;
let shiftB = 0;
let shiftAEnotaB = 0;
let orderId = 0;
let otherOrderId = 0;
let juhaId = 0;
let vinoId = 0;
let juhaKdsId = 0;
let vinoKdsId = 0;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.log = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as never;
  next();
});
app.use(requireEnota, requireUnitCapability, posActorContext);
app.use(router);
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: error.message });
});

function aiDeviceToken(device: { id: number; key: string }, enotaId: number): string {
  const payload = Buffer.from(`${device.id}:${enotaId}:${device.key}`).toString("base64url");
  const signature = createHmac("sha256", process.env.SESSION_SECRET!).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function actorToken(input: { actorId: number; shiftId: number; enotaId: number }): string {
  const payload = Buffer.from(JSON.stringify({
    n: input.actorId,
    s: input.shiftId,
    e: Date.now() + 60_000,
    c: companyId,
    u: input.enotaId,
  })).toString("base64url");
  const signature = createHmac("sha256", process.env.POS_ACTOR_SESSION_SECRET!)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function agentRequest(input: {
  enotaId?: number;
  device?: { id: number; key: string };
  actorSession?: string;
  body: Record<string, unknown>;
}) {
  const enotaId = input.enotaId ?? enotaA;
  const device = input.device ?? napravaA;
  let result = request(app)
    .post("/ai/agent")
    .set("x-test-user", clerkUserId)
    .set("x-company-id", companyId)
    .set("x-enota-id", String(enotaId))
    .set("x-naprava-id", device.key)
    .set("x-ai-device-token", aiDeviceToken(device, enotaId));
  if (input.actorSession) result = result.set("x-pos-actor-session", input.actorSession);
  return result.send(input.body);
}

async function assignmentRows() {
  return db.select({
    id: postavkeTable.id,
    courseNumber: postavkeTable.courseNumber,
    courseSequence: postavkeTable.courseSequence,
    pairingGroupId: postavkeTable.pairingGroupId,
  }).from(postavkeTable)
    .where(inArray(postavkeTable.id, [juhaId, vinoId]))
    .orderBy(postavkeTable.id);
}

async function assignmentKdsRows() {
  return db.select({
    id: kdsNalogiTable.id,
    courseNumber: kdsNalogiTable.courseNumber,
    courseSequence: kdsNalogiTable.courseSequence,
    pairingGroupId: kdsNalogiTable.pairingGroupId,
  }).from(kdsNalogiTable)
    .where(inArray(kdsNalogiTable.id, [juhaKdsId, vinoKdsId]))
    .orderBy(kdsNalogiTable.id);
}

beforeAll(async () => {
  process.env.SESSION_SECRET = `${run}-session-secret`;
  process.env.POS_ACTOR_SESSION_SECRET = `${run}-actor-secret`;

  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_${run}`,
    naziv: run,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;

  [enotaA, enotaB] = (await db.insert(enoteTable).values([
    { companyId, ime: `${run} A`, capabilities: ["checkout"] },
    { companyId, ime: `${run} B`, capabilities: ["checkout"] },
  ]).returning({ id: enoteTable.id })).map(row => row.id) as [number, number];

  await db.insert(posUporabnikiTable).values({
    clerkUserId,
    companyId,
    enotaId: null,
    vloga: "admin",
    ime: "HTTP",
    priimek: "Test",
  });

  [actorA, actorB] = (await db.insert(natakariTable).values([
    { companyId, ime: "Prvi", priimek: run },
    { companyId, ime: "Drugi", priimek: run },
  ]).returning({ id: natakariTable.id })).map(row => row.id) as [number, number];

  [shiftA, shiftB, shiftAEnotaB] = (await db.insert(izmeneTable).values([
    { enotaId: enotaA, natakariId: actorA },
    { enotaId: enotaA, natakariId: actorB },
    { enotaId: enotaB, natakariId: actorA },
  ]).returning({ id: izmeneTable.id })).map(row => row.id) as [number, number, number];

  napravaA.key = `${run}-device-a`;
  napravaB.key = `${run}-device-b`;
  [napravaA.id, napravaB.id] = (await db.insert(napraveTable).values([
    { enotaId: enotaA, ime: `${run} A`, napravaKljuc: napravaA.key, nastavitveJson: JSON.stringify({ aiSvetovalecAktiven: true }) },
    { enotaId: enotaB, ime: `${run} B`, napravaKljuc: napravaB.key, nastavitveJson: JSON.stringify({ aiSvetovalecAktiven: true }) },
  ]).returning({ id: napraveTable.id })).map(row => row.id) as [number, number];

  const [article] = await db.insert(artikliTable).values({
    enotaId: enotaA,
    ime: run,
    cena: "1",
    davek: "22",
    vrstniRed: 1,
  }).returning({ id: artikliTable.id });

  [orderId, otherOrderId] = (await db.insert(narocilaTable).values([
    { enotaId: enotaA, stevilkaNarocila: 910001 },
    { enotaId: enotaA, stevilkaNarocila: 910002 },
  ]).returning({ id: narocilaTable.id })).map(row => row.id) as [number, number];

  const lines = await db.insert(postavkeTable).values([
    { narociloId: orderId, artikelId: article!.id, ime: "Juha", kolicina: 1, cenaKos: "1", skupaj: "1", davek: "22" },
    { narociloId: orderId, artikelId: article!.id, ime: "Vino", kolicina: 1, cenaKos: "1", skupaj: "1", davek: "22" },
    {
      narociloId: orderId, artikelId: article!.id, ime: "Referenca dva", kolicina: 1,
      cenaKos: "0", skupaj: "0", davek: "22", courseNumber: 2, courseSequence: 2,
      courseNameSnapshot: "Ribji hod", pairingGroupId: `${run}:ref:2`,
    },
    {
      narociloId: orderId, artikelId: article!.id, ime: "Referenca tri", kolicina: 1,
      cenaKos: "0", skupaj: "0", davek: "22", courseNumber: 3, courseSequence: 3,
      courseNameSnapshot: "Ribjemu hod", pairingGroupId: `${run}:ref:3`,
    },
  ]).returning({ id: postavkeTable.id, ime: postavkeTable.ime });
  juhaId = lines.find(line => line.ime === "Juha")!.id;
  vinoId = lines.find(line => line.ime === "Vino")!.id;

  const [station] = await db.insert(kdsPostajeTable).values({
    enotaId: enotaA,
    ime: `${run} kitchen`,
    tip: "kitchen",
    vrstniRed: 1,
  }).returning({ id: kdsPostajeTable.id });
  [juhaKdsId, vinoKdsId] = (await db.insert(kdsNalogiTable).values([
    { enotaId: enotaA, postajaId: station!.id, narociloId: orderId, postavkaId: juhaId, stanje: "aktivno" },
    { enotaId: enotaA, postajaId: station!.id, narociloId: orderId, postavkaId: vinoId, stanje: "zadrzano" },
  ]).returning({ id: kdsNalogiTable.id })).map(row => row.id) as [number, number];
});

afterAll(async () => {
  if (actorA || actorB) {
    await db.delete(posAiAgentAuditTable).where(inArray(posAiAgentAuditTable.actorNatakarId, [actorA, actorB]));
  }
  // Remove menu/course references before the company cascades into articles.
  if (enotaA) await db.delete(multicourseMenusTable).where(eq(multicourseMenusTable.enotaId, enotaA));
  if (companyId) await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSessionSecret;
  if (previousActorSecret === undefined) delete process.env.POS_ACTOR_SESSION_SECRET;
  else process.env.POS_ACTOR_SESSION_SECRET = previousActorSecret;
});

describe("POST /ai/agent protected batch clarification", () => {
  it("dve zaporedni izbiri pustita POS in KDS nespremenjena do zadnje ter paket izvedeta največ enkrat", async () => {
    const [original] = await db.select().from(postavkeTable).where(eq(postavkeTable.id, juhaId));
    const rows = await db.insert(postavkeTable).values([
      { narociloId: otherOrderId, artikelId: original!.artikelId, ime: "Juha", kolicina: 1, cenaKos: "1", skupaj: "1", davek: "22" },
      { narociloId: otherOrderId, artikelId: original!.artikelId, ime: "Vino", kolicina: 1, cenaKos: "1", skupaj: "1", davek: "22" },
      { narociloId: otherOrderId, ime: "Referenca dva", kolicina: 1, cenaKos: "0", skupaj: "0", davek: "22", courseNumber: 2, courseSequence: 2, courseNameSnapshot: "Ribji hod", pairingGroupId: `${run}:other:2` },
      { narociloId: otherOrderId, ime: "Referenca tri", kolicina: 1, cenaKos: "0", skupaj: "0", davek: "22", courseNumber: 3, courseSequence: 3, courseNameSnapshot: "Ribjemu hod", pairingGroupId: `${run}:other:3` },
    ]).returning();
    const [station] = await db.select().from(kdsPostajeTable).where(eq(kdsPostajeTable.enotaId, enotaA));
    await db.insert(kdsNalogiTable).values(rows.slice(0, 2).map(line => ({
      enotaId: enotaA, postajaId: station!.id, narociloId: otherOrderId, postavkaId: line.id, stanje: "aktivno" as const,
    })));
    const readLines = () => db.select().from(postavkeTable).where(eq(postavkeTable.narociloId, otherOrderId));
    const readKds = () => db.select().from(kdsNalogiTable).where(eq(kdsNalogiTable.narociloId, otherOrderId));
    const beforeLines = await readLines();
    const beforeKds = await readKds();
    const actorSession = actorToken({ actorId: actorA, shiftId: shiftA, enotaId: enotaA });
    const initial = await agentRequest({ actorSession, body: {
      ukaz: "vino k ribjemu hodu, juha k ribjemu hodu", narociloId: otherOrderId,
    } });
    expect(initial.status, JSON.stringify(initial.body)).toBe(200);
    const initialToken = initial.body.courseClarification.token;
    const initialPayload = verifyCourseClarificationToken(initialToken)!;
    expect(initialPayload).toMatchObject({ v: 3, assignments: [], selections: [] });
    const next = await agentRequest({ actorSession, body: {
      ukaz: "2", narociloId: otherOrderId, courseClarificationToken: initialToken,
    } });
    expect(next.status, JSON.stringify(next.body)).toBe(200);
    expect(next.body.action).toBe("explain");
    expect(next.body.odgovor).toContain("Juha");
    const nextToken = next.body.courseClarification.token;
    expect(verifyCourseClarificationToken(nextToken)).toMatchObject({
      clarificationId: initialPayload.clarificationId, expiresAt: initialPayload.expiresAt, selections: [2],
    });
    expect(await readLines()).toEqual(beforeLines);
    expect(await readKds()).toEqual(beforeKds);
    const invalid = await agentRequest({ actorSession, body: {
      ukaz: "9", narociloId: otherOrderId, courseClarificationToken: nextToken,
    } });
    expect(invalid.body.courseClarification.token).toBe(nextToken);
    const finish = () => agentRequest({ actorSession, body: {
      ukaz: "3", narociloId: otherOrderId, courseClarificationToken: nextToken,
    } });
    const outcomes = await Promise.all([finish(), finish()]);
    expect(outcomes.filter(response => response.body.action === "assign_courses")).toHaveLength(1);
    expect(outcomes.every(response => response.status === 200 || response.status === 409)).toBe(true);
    const assigned = await readLines();
    expect(assigned.find(row => row.ime === "Vino")!.courseNumber).toBe(2);
    expect(assigned.find(row => row.ime === "Juha")!.courseNumber).toBe(3);
    const kds = await readKds();
    expect(kds.find(row => row.postavkaId === rows[0]!.id)!.courseNumber).toBe(3);
    expect(kds.find(row => row.postavkaId === rows[1]!.id)!.courseNumber).toBe(2);
    const audits = await db.select().from(posAiAgentAuditTable).where(eq(posAiAgentAuditTable.enotaId, enotaA));
    expect(audits.filter(row => row.action === "clarify_course_consumed"
      && (row.metadata as { clarificationId?: string }).clarificationId === initialPayload.clarificationId)).toHaveLength(1);
  });

  it("preveri zaščite, ne mutira pred pojasnilom in nadaljevanje izvede samo v pravem kontekstu", async () => {
    const body = {
      ukaz: "vino k ribjemu hodu, juha na prvi hod",
      narociloId: orderId,
    };
    const actorASession = actorToken({ actorId: actorA, shiftId: shiftA, enotaId: enotaA });

    const withoutActor = await agentRequest({ body });
    expect(withoutActor.status).toBe(401);

    const wrongDevice = await request(app)
      .post("/ai/agent")
      .set("x-test-user", clerkUserId)
      .set("x-company-id", companyId)
      .set("x-enota-id", String(enotaA))
      .set("x-naprava-id", napravaA.key)
      .set("x-ai-device-token", "invalid")
      .set("x-pos-actor-session", actorASession)
      .send(body);
    expect(wrongDevice.status).toBe(403);

    const pending = await agentRequest({ actorSession: actorASession, body });
    expect(pending.status, JSON.stringify(pending.body)).toBe(200);
    expect(pending.body).toMatchObject({
      action: "explain",
      courseClarification: {
        token: expect.any(String),
        options: [
          { courseNumber: 2, courseName: "Ribji hod" },
          { courseNumber: 3, courseName: "Ribjemu hod" },
        ],
      },
    });
    expect(await assignmentRows()).toEqual([
      { id: juhaId, courseNumber: null, courseSequence: null, pairingGroupId: null },
      { id: vinoId, courseNumber: null, courseSequence: null, pairingGroupId: null },
    ]);
    expect((await assignmentKdsRows()).map(row => [
      row.courseNumber,
      row.courseSequence,
      row.pairingGroupId,
    ])).toEqual([
      [null, null, null],
      [null, null, null],
    ]);

    const token = pending.body.courseClarification.token as string;
    const tokenPayload = verifyCourseClarificationToken(token);
    expect(tokenPayload).toMatchObject({
      v: 2,
      narociloId: orderId,
      targetPostavkaId: vinoId,
      assignments: [{ postavkaId: juhaId, courseNumber: 1 }],
    });
    const continuationBody = { ukaz: "3", narociloId: orderId, courseClarificationToken: token };

    const wrongActor = await agentRequest({
      actorSession: actorToken({ actorId: actorB, shiftId: shiftB, enotaId: enotaA }),
      body: continuationBody,
    });
    expect(wrongActor.status).toBe(200);
    expect(wrongActor.body).toMatchObject({ action: "explain", odgovor: expect.stringContaining("spremenili") });

    const wrongUnit = await agentRequest({
      enotaId: enotaB,
      device: napravaB,
      actorSession: actorToken({ actorId: actorA, shiftId: shiftAEnotaB, enotaId: enotaB }),
      body: continuationBody,
    });
    expect(wrongUnit.status).toBe(200);
    expect(wrongUnit.body).toMatchObject({ action: "explain", odgovor: expect.stringContaining("spremenili") });

    const wrongOrder = await agentRequest({
      actorSession: actorASession,
      body: { ...continuationBody, narociloId: otherOrderId },
    });
    expect(wrongOrder.status).toBe(200);
    expect(wrongOrder.body).toMatchObject({ action: "explain", odgovor: expect.stringContaining("spremenili") });
    expect((await assignmentRows()).every(row => row.courseNumber === null)).toBe(true);

    const completed = await agentRequest({ actorSession: actorASession, body: continuationBody });
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    expect(completed.body).toMatchObject({
      action: "assign_courses",
      changed: true,
      assignmentOutcomes: expect.arrayContaining([
        expect.objectContaining({ postavkaId: juhaId, courseNumber: 1, naziv: "Juha" }),
        expect.objectContaining({ postavkaId: vinoId, courseNumber: 3, naziv: "Vino" }),
      ]),
    });
    const saved = await assignmentRows();
    expect(saved.map(row => [row.id, row.courseNumber, row.courseSequence])).toEqual([
      [juhaId, 1, 1],
      [vinoId, 3, 3],
    ]);
    expect((await assignmentKdsRows()).map(row => [
      row.id,
      row.courseNumber,
      row.courseSequence,
      row.pairingGroupId,
    ])).toEqual([
      [juhaKdsId, 1, 1, saved[0]!.pairingGroupId],
      [vinoKdsId, 3, 3, saved[1]!.pairingGroupId],
    ]);

    const replay = await agentRequest({ actorSession: actorASession, body: continuationBody });
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ action: "explain", odgovor: expect.stringContaining("spremenili") });
    expect(await assignmentRows()).toEqual(saved);
  });
});

describe("POST /ai/agent persisted course-name audit", () => {
  it.each([
    { action: "assign_course", conflictingSnapshots: false },
    { action: "assign_courses", conflictingSnapshots: false },
    { action: "assign_course", conflictingSnapshots: true },
    { action: "assign_courses", conflictingSnapshots: true },
  ] as const)(
    "$action keeps historical audit evidence after rename (conflicting snapshots: $conflictingSnapshots)",
    async ({ action, conflictingSnapshots }) => {
      const [article] = await db.insert(artikliTable).values({
        enotaId: enotaA, ime: `${run} audit menu`, cena: "1", davek: "22", vrstniRed: 1,
      }).returning({ id: artikliTable.id });
      const [menu] = await db.insert(multicourseMenusTable).values({
        enotaId: enotaA, menuArtikelId: article!.id, izbor: "fixed_four", aktivno: true,
      }).returning({ id: multicourseMenusTable.id });
      const [course] = await db.insert(multicourseMenuCoursesTable).values({
        menuId: menu!.id, courseNumber: 2, courseName: "Ribji hod", foodArtikelId: article!.id,
      }).returning({ id: multicourseMenuCoursesTable.id });
      const [order] = await db.insert(narocilaTable).values({
        enotaId: enotaA, stevilkaNarocila: 920000,
      }).returning({ id: narocilaTable.id });
      const group = `${run}:audit:${order!.id}`;
      const lines = await db.insert(postavkeTable).values([
        {
          narociloId: order!.id, artikelId: article!.id, ime: "Meni", kolicina: 1,
          cenaKos: "1", skupaj: "1", davek: "22", pairingGroupId: group,
        },
        {
          narociloId: order!.id, artikelId: article!.id, ime: "Referenca hoda", kolicina: 1,
          cenaKos: "0", skupaj: "0", davek: "22", pairingGroupId: group,
          courseNumber: 2, courseSequence: 2, courseNameSnapshot: "Ribji hod",
        },
        {
          narociloId: order!.id, artikelId: article!.id, ime: "Juha", kolicina: 1,
          cenaKos: "1", skupaj: "1", davek: "22",
        },
        {
          narociloId: order!.id, artikelId: article!.id, ime: "Vino", kolicina: 1,
          cenaKos: "1", skupaj: "1", davek: "22",
        },
      ]).returning({ id: postavkeTable.id, ime: postavkeTable.ime });
      if (conflictingSnapshots) {
        await db.insert(postavkeTable).values({
          narociloId: order!.id, artikelId: article!.id, ime: "Nasprotujoča referenca", kolicina: 1,
          cenaKos: "0", skupaj: "0", davek: "22", pairingGroupId: group,
          courseNumber: 2, courseSequence: 2, courseNameSnapshot: "Drugo zgodovinsko ime",
        });
      }

      // Rename only after opening the order with persisted historical evidence.
      await db.update(multicourseMenuCoursesTable)
        .set({ courseName: "Preimenovan hod" })
        .where(eq(multicourseMenuCoursesTable.id, course!.id));
      const response = await agentRequest({
        actorSession: actorToken({ actorId: actorA, shiftId: shiftA, enotaId: enotaA }),
        body: {
          ukaz: action === "assign_course" ? "juha na drugi hod" : "juha na drugi hod, vino na drugi hod",
          narociloId: order!.id,
        },
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body).toMatchObject({ action, changed: true, narociloId: order!.id });

      const targetIds = lines.filter(line =>
        line.ime === "Juha" || (action === "assign_courses" && line.ime === "Vino"),
      ).map(line => line.id);
      const saved = await db.select({
        id: postavkeTable.id,
        courseNumber: postavkeTable.courseNumber,
        courseSequence: postavkeTable.courseSequence,
        pairingGroupId: postavkeTable.pairingGroupId,
      }).from(postavkeTable).where(inArray(postavkeTable.id, targetIds)).orderBy(postavkeTable.id);
      expect(saved).toEqual(targetIds.map(id => ({
        id, courseNumber: 2, courseSequence: 2, pairingGroupId: expect.any(String),
      })));

      // Read the stored audit, not the response or the resolver's return value.
      const audits = await db.select().from(posAiAgentAuditTable)
        .where(eq(posAiAgentAuditTable.enotaId, enotaA));
      const relevantAudits = audits.filter(row => {
        if (row.action !== action) return false;
        const metadata = row.metadata as {
          postavkaId?: number;
          assignments?: Array<{ postavkaId: number }>;
        };
        return action === "assign_course"
          ? metadata.postavkaId === targetIds[0]
          : metadata.assignments?.some(assignment => targetIds.includes(assignment.postavkaId));
      });
      expect(relevantAudits).toHaveLength(1);
      const expectedAssignments = saved.map(line => ({
        postavkaId: line.id,
        courseNumber: 2,
        courseNameSnapshot: conflictingSnapshots ? "2. hod" : "Ribji hod",
        pairingGroupId: line.pairingGroupId,
      }));
      expect(relevantAudits[0]).toMatchObject({
        napravaId: napravaA.id, actorNatakarId: actorA, action, outcome: "success",
        metadata: action === "assign_course"
          ? expectedAssignments[0]
          : { assignments: expectedAssignments },
      });
    },
  );
});