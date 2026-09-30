import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";

const mockCreate = vi.hoisted(() => vi.fn());
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: mockCreate } },
}));

import {
  artikliTable,
  companiesTable,
  db,
  enoteTable,
  natakariTable,
  napraveTable,
  normativiTable,
  posAiAgentAuditTable,
} from "@workspace/db";
import router from "./glasovni-ukaz";
import {
  clearNormativeComparisonCache,
  getCachedNormativeComparison,
  NORMATIVE_COMPARISON_MAX_IN_FLIGHT,
  type LocalNormative,
} from "../../lib/normative-comparison";

const run = `norm-route-audit-${Math.random().toString(36).slice(2)}`;
const secretBefore = process.env.SESSION_SECRET;
let companyId = "";
let enotaId = 0;
let napravaId = 0;
let napravaKljuc = "";
let artikelId = 0;
let bulkArtikelId = 0;
let actorNatakarId = 0;

function aiDeviceToken(): string {
  const payload = Buffer.from(`${napravaId}:${enotaId}:${napravaKljuc}`).toString("base64url");
  const signature = createHmac("sha256", process.env.SESSION_SECRET!).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function compare(forceRefresh = false, requestedArtikelId = artikelId) {
  return request(app)
    .post("/ai/normativ-primerjava")
    .set("x-naprava-id", napravaKljuc)
    .set("x-ai-device-token", aiDeviceToken())
    .send({ artikelId: requestedArtikelId, forceRefresh });
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as typeof req & { enotaId: number; posActorNatakarId: number }).enotaId = enotaId;
  (req as typeof req & { enotaId: number; posActorNatakarId: number }).posActorNatakarId = actorNatakarId;
  req.log = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as never;
  next();
});
app.use(router);
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: error.message });
});

describe("POST /ai/normativ-primerjava audit", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = `${run}-secret`;
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: run,
      naziv: run,
    }).returning({ id: companiesTable.id });
    companyId = company!.id;
    const [unit] = await db.insert(enoteTable).values({
      companyId,
      ime: run,
    }).returning({ id: enoteTable.id });
    enotaId = unit!.id;
    const [actor] = await db.insert(natakariTable).values({
      companyId,
      ime: "Audit",
      priimek: run,
    }).returning({ id: natakariTable.id });
    actorNatakarId = actor!.id;
    napravaKljuc = `${run}-device`;
    const [device] = await db.insert(napraveTable).values({
      enotaId,
      ime: run,
      napravaKljuc,
      nastavitveJson: JSON.stringify({ aiSvetovalecAktiven: true }),
    }).returning({ id: napraveTable.id });
    napravaId = device!.id;
    const articles = await db.insert(artikliTable).values([
      { enotaId, ime: `${run}-target`, cena: "10", davek: "9.5" },
      { enotaId, ime: `${run}-ingredient`, cena: "1", davek: "9.5", enotaMere: "g", nabavniArtikel: true },
    ]).returning({ id: artikliTable.id });
    artikelId = articles[0]!.id;
    const [bulkTarget] = await db.insert(artikliTable).values({
      enotaId, ime: `${run}-bulk-target`, cena: "10", davek: "9.5", mealType: "prepared", enotaMere: "kg",
    }).returning({ id: artikliTable.id });
    bulkArtikelId = bulkTarget!.id;
    await db.insert(normativiTable).values({
      artikelId,
      vhodniArtikelId: articles[1]!.id,
      kolicina: "100",
    });
    await db.insert(normativiTable).values({
      artikelId: bulkArtikelId,
      vhodniArtikelId: articles[1]!.id,
      kolicina: "100",
    });
    mockCreate.mockResolvedValue({ content: [
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://allrecipes.com/audit-test", title: "Vir A" }] },
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://bbcgoodfood.com/audit-test", title: "Vir B" }] },
      { type: "text", text: JSON.stringify({ findings: [
        { ingredient: `${run}-ingredient`, quantity: 400, unit: "g", servings: 4, sourceUrl: "https://allrecipes.com/audit-test" },
        { ingredient: `${run}-ingredient`, quantity: 500, unit: "g", servings: 4, sourceUrl: "https://bbcgoodfood.com/audit-test" },
      ] }) },
    ] });
  });

  afterAll(async () => {
    if (artikelId && bulkArtikelId) {
      await db.delete(normativiTable).where(inArray(normativiTable.artikelId, [artikelId, bulkArtikelId]));
    }
    if (companyId) await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
    if (secretBefore === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = secretBefore;
  });

  it("zapiše cache hit in ročno svežo primerjavo z istim tenant/device/actor kontekstom", async () => {
    const first = await compare();
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const cached = await compare();
    expect(cached.status, JSON.stringify(cached.body)).toBe(200);
    const refreshed = await compare(true);
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);
    expect(mockCreate).toHaveBeenCalledTimes(2);

    const audits = await db.select({
      enotaId: posAiAgentAuditTable.enotaId,
      napravaId: posAiAgentAuditTable.napravaId,
      actorNatakarId: posAiAgentAuditTable.actorNatakarId,
      action: posAiAgentAuditTable.action,
      outcome: posAiAgentAuditTable.outcome,
      metadata: posAiAgentAuditTable.metadata,
    }).from(posAiAgentAuditTable).where(and(
      eq(posAiAgentAuditTable.enotaId, enotaId),
      eq(posAiAgentAuditTable.actorNatakarId, actorNatakarId),
      eq(posAiAgentAuditTable.action, "compare_normative"),
    )).orderBy(asc(posAiAgentAuditTable.id));

    expect(audits).toHaveLength(3);
    expect(audits.every(audit =>
      audit.enotaId === enotaId
      && audit.napravaId === napravaId
      && audit.actorNatakarId === actorNatakarId
      && audit.outcome === "success"
    )).toBe(true);
    expect(audits.map(audit => audit.metadata)).toEqual([
      expect.objectContaining({ artikelId, cacheHit: false, coalesced: false, forceRefresh: false, trigger: "editor" }),
      expect.objectContaining({ artikelId, cacheHit: true, coalesced: false, forceRefresh: false, trigger: "editor" }),
      expect.objectContaining({ artikelId, cacheHit: false, coalesced: false, forceRefresh: true, trigger: "editor" }),
    ]);
    for (const audit of audits) {
      expect(Object.keys(audit.metadata as Record<string, unknown>).sort()).toEqual([
        "artikelId", "cacheHit", "coalesced", "comparableRows", "forceRefresh", "trigger",
      ]);
    }
  });

  it("zavrne primerjavo pripravljene jedi na kg pred raziskavo v HTTP in glasovni poti", async () => {
    const callsBefore = mockCreate.mock.calls.length;
    const httpResponse = await compare(false, bulkArtikelId);
    expect(httpResponse.status).toBe(422);
    expect(httpResponse.body.napaka).toMatch(/na porcijo/iu);
    expect(httpResponse.body.napaka).toMatch(/ro[cč]ni normativ na kg\/l/iu);
    expect(mockCreate).toHaveBeenCalledTimes(callsBefore);

    const voiceResponse = await request(app)
      .post("/ai/agent")
      .set("x-naprava-id", napravaKljuc)
      .set("x-ai-device-token", aiDeviceToken())
      .send({ ukaz: `primerjaj normativ za ${run}-bulk-target` });
    expect(voiceResponse.status).toBe(200);
    expect(voiceResponse.body).toMatchObject({
      action: "explain",
      odgovor: httpResponse.body.napaka,
    });
    expect(mockCreate).toHaveBeenCalledTimes(callsBefore);
  });

  it("ob globalni preobremenitvi vrne retryable 503, ne zažene plačljive raziskave in zapiše busy audit", async () => {
    clearNormativeComparisonCache();
    const releases: Array<(value: any) => void> = [];
    const pending = Array.from({ length: NORMATIVE_COMPARISON_MAX_IN_FLIGHT }, (_, index) => {
      const local: LocalNormative = { artikelId: 40_000 + index, revision: 1, targetName: `Zasedeno ${index}`, rows: [] };
      return getCachedNormativeComparison(local, 50_000 + index, () => new Promise(resolve => releases.push(resolve)), { now: 4_000 });
    });
    const callsBefore = mockCreate.mock.calls.length;

    try {
      const response = await compare(true);
      expect(response.status, JSON.stringify(response.body)).toBe(503);
      expect(response.body).toEqual({
        napaka: "Trenutno poteka preveč spletnih primerjav. Poskusite znova čez nekaj trenutkov.",
      });
      expect(mockCreate).toHaveBeenCalledTimes(callsBefore);

      const [busyAudit] = await db.select({
        enotaId: posAiAgentAuditTable.enotaId,
        napravaId: posAiAgentAuditTable.napravaId,
        actorNatakarId: posAiAgentAuditTable.actorNatakarId,
        outcome: posAiAgentAuditTable.outcome,
        metadata: posAiAgentAuditTable.metadata,
      }).from(posAiAgentAuditTable).where(and(
        eq(posAiAgentAuditTable.enotaId, enotaId),
        eq(posAiAgentAuditTable.actorNatakarId, actorNatakarId),
        eq(posAiAgentAuditTable.action, "compare_normative"),
        eq(posAiAgentAuditTable.outcome, "busy"),
      ));
      expect(busyAudit).toMatchObject({
        enotaId,
        napravaId,
        actorNatakarId,
        outcome: "busy",
        metadata: { artikelId, forceRefresh: true, trigger: "editor" },
      });
    } finally {
      releases.forEach((release, index) => release({
        generatedAt: "2026-09-07T06:03:00.000Z",
        localNormative: { artikelId: 40_000 + index, revision: 1, targetName: `Zasedeno ${index}`, rows: [] },
        rows: [], sources: [], warnings: [], disclaimer: "Informativno.",
      }));
      await Promise.all(pending);
      clearNormativeComparisonCache();
    }
  });
});