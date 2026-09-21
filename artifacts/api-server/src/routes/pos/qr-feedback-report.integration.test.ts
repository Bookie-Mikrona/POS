import express from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

vi.mock("@clerk/express", () => ({
  getAuth: (req: express.Request) => ({ userId: req.header("x-test-user") ?? null }),
}));

import {
  companiesTable,
  db,
  enoteTable,
  narocilaTable,
  posUporabnikiTable,
  postavkeTable,
  qrGostPovratneInformacijeTable,
} from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import qrFeedbackRouter, {
  articleComparisonMetric,
  dimensionComparisonMetric,
  parseQrFeedbackReportQuery,
  getPreviousQrFeedbackPeriod,
  qrFeedbackReportCsv,
} from "./qr-feedback-report";

const suffix = Math.random().toString(36).slice(2, 10);
const admin = `qr-admin-${suffix}`;
const unitAdmin = `qr-unit-admin-${suffix}`;
const user = `qr-user-${suffix}`;
let companyId = "";
let foreignCompanyId = "";
let unitA = 0;
let unitB = 0;
let foreignUnit = 0;
let orderIds: number[] = [];

const app = express();
app.use(requireEnota);
app.use(qrFeedbackRouter);

function get(actor: string, selectedUnit: number, path: string) {
  return supertest(app).get(path)
    .set("x-test-user", actor)
    .set("x-company-id", companyId)
    .set("x-enota-id", String(selectedUnit));
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `QRF${suffix}`,
    naziv: `QR feedback ${suffix}`,
  }).returning({ id: companiesTable.id });
  const [foreign] = await db.insert(companiesTable).values({
    podjetjeDavcna: `QRX${suffix}`,
    naziv: `QR foreign ${suffix}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;
  foreignCompanyId = foreign!.id;
  const units = await db.insert(enoteTable).values([
    { companyId, ime: `Ljubljana A ${suffix}`, zacetekDnevaUra: "04:00" },
    { companyId, ime: `Ljubljana B ${suffix}`, zacetekDnevaUra: "06:00" },
    { companyId: foreignCompanyId, ime: `Foreign ${suffix}`, zacetekDnevaUra: "04:00" },
  ]).returning({ id: enoteTable.id });
  [unitA, unitB, foreignUnit] = units.map((row) => row.id);
  await db.insert(posUporabnikiTable).values([
    { clerkUserId: admin, companyId, enotaId: unitA, vloga: "admin", ime: "Admin", priimek: suffix },
    { clerkUserId: unitAdmin, companyId, enotaId: unitA, vloga: "admin_enote", ime: "Unit", priimek: suffix },
    { clerkUserId: user, companyId, enotaId: unitA, vloga: "uporabnik", ime: "User", priimek: suffix },
  ]);
  const orders = await db.insert(narocilaTable).values([
    { enotaId: unitA, status: "zakljuceno", vir: "qr_gost" },
    { enotaId: unitA, status: "zakljuceno", vir: "qr_gost" },
    { enotaId: unitB, status: "zakljuceno", vir: "qr_gost" },
    { enotaId: unitB, status: "zakljuceno", vir: "qr_gost" },
    { enotaId: unitA, status: "zakljuceno", vir: "qr_gost" },
    { enotaId: unitB, status: "zakljuceno", vir: "qr_gost" },
  ]).returning({ id: narocilaTable.id });
  orderIds = orders.map((row) => row.id);
  const items = await db.insert(postavkeTable).values([
    { narociloId: orderIds[0]!, ime: `Zgodovinska juha ${suffix}`, cenaKos: "5", skupaj: "5", davek: "9.5" },
    { narociloId: orderIds[1]!, ime: `Zgodovinska juha ${suffix}`, cenaKos: "5", skupaj: "5", davek: "9.5" },
    { narociloId: orderIds[2]!, ime: `Potica ${suffix}`, cenaKos: "5", skupaj: "5", davek: "9.5" },
    { narociloId: orderIds[3]!, ime: `Potica ${suffix}`, cenaKos: "5", skupaj: "5", davek: "9.5" },
    { narociloId: orderIds[4]!, ime: `Zgodovinska juha ${suffix}`, cenaKos: "5", skupaj: "5", davek: "9.5" },
    { narociloId: orderIds[5]!, ime: `Potica ${suffix}`, cenaKos: "5", skupaj: "5", davek: "9.5" },
  ]).returning({ id: postavkeTable.id });
  await db.insert(qrGostPovratneInformacijeTable).values([
    {
      enotaId: unitA, narociloId: orderIds[0]!,
      hranaOcena: 5, ambientOcena: 4, storitevOcena: 3,
      ocenePostavk: { [items[0]!.id]: 5, [items[2]!.id]: 1 },
      komentar: `private-comment-${suffix}`, consentVersion: "1", consentedAt: new Date("2025-01-10T12:00:00Z"),
      createdAt: new Date("2025-01-10T12:00:00Z"),
    },
    {
      enotaId: unitA, narociloId: orderIds[1]!,
      hranaOcena: 3, ambientOcena: 2, storitevOcena: 5,
      ocenePostavk: { [items[1]!.id]: 3 }, komentar: "  ",
      consentVersion: "1", consentedAt: new Date("2025-01-11T02:59:59Z"),
      createdAt: new Date("2025-01-11T02:59:59Z"),
    },
    {
      enotaId: unitB, narociloId: orderIds[2]!,
      hranaOcena: 1, ambientOcena: 1, storitevOcena: 1,
      ocenePostavk: { [items[2]!.id]: 1 }, komentar: `second-unit-${suffix}`,
      consentVersion: "1", consentedAt: new Date("2025-01-10T12:00:00Z"),
      createdAt: new Date("2025-01-10T12:00:00Z"),
    },
    {
      // 04:30 Ljubljana is already calendar 11 January, but still business
      // day 10 January in this unit, whose day starts at 06:00.
      enotaId: unitB, narociloId: orderIds[3]!,
      hranaOcena: 1, ambientOcena: 1, storitevOcena: 1,
      ocenePostavk: { [items[3]!.id]: 1 }, komentar: `second-cutoff-${suffix}`,
      consentVersion: "1", consentedAt: new Date("2025-01-11T03:30:00Z"),
      createdAt: new Date("2025-01-11T03:30:00Z"),
    },
    {
      enotaId: unitA, narociloId: orderIds[4]!,
      hranaOcena: 1, ambientOcena: 2, storitevOcena: 3,
      ocenePostavk: { [items[4]!.id]: 2 }, komentar: null, consentVersion: "1",
      consentedAt: new Date("2025-01-09T12:00:00Z"),
      createdAt: new Date("2025-01-09T12:00:00Z"),
    },
    {
      enotaId: unitB, narociloId: orderIds[5]!,
      hranaOcena: 3, ambientOcena: 3, storitevOcena: 3,
      ocenePostavk: { [items[5]!.id]: 3 }, komentar: null, consentVersion: "1",
      consentedAt: new Date("2025-01-09T12:00:00Z"),
      createdAt: new Date("2025-01-09T12:00:00Z"),
    },
  ]);
});

afterAll(async () => {
  if (!companyId) return;
  await db.delete(qrGostPovratneInformacijeTable).where(inArray(qrGostPovratneInformacijeTable.enotaId, [unitA, unitB]));
  await db.delete(postavkeTable).where(inArray(postavkeTable.narociloId, orderIds));
  await db.delete(narocilaTable).where(inArray(narocilaTable.id, orderIds));
  await db.delete(posUporabnikiTable).where(eq(posUporabnikiTable.companyId, companyId));
  await db.delete(enoteTable).where(inArray(enoteTable.id, [unitA, unitB, foreignUnit]));
  await db.delete(companiesTable).where(inArray(companiesTable.id, [companyId, foreignCompanyId]));
});

describe("QR feedback operational report privacy and tenant scope", () => {
  it("aggregates company units, honors business-day bounds, and validates item ownership", async () => {
    const response = await get(admin, unitA, "/operativna-porocila/qr-feedback?od=2025-01-10&do=2025-01-10");
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.totals).toMatchObject({ responses: 4, smallSample: true, minimumSample: 5 });
    expect(response.body.dimensions.food).toMatchObject({ average: 2.5, count: 4 });
    expect(response.body.comparison).toMatchObject({
      current: { od: "2025-01-10", do: "2025-01-10", responses: 4, smallSample: true },
      previous: { od: "2025-01-09", do: "2025-01-09", responses: 2, smallSample: true },
      dimensions: {
        food: { currentAverage: 2.5, previousAverage: 2, difference: 0.5, direction: "unavailable", directionReason: expect.stringContaining("vsaj 5 odzivov") },
        ambience: { currentAverage: 2, previousAverage: 2.5, difference: -0.5, direction: "unavailable", directionReason: expect.stringContaining("vsaj 5 odzivov") },
        service: { currentAverage: 2.5, previousAverage: 3, difference: -0.5, direction: "unavailable", directionReason: expect.stringContaining("vsaj 5 odzivov") },
      },
    });
    expect(response.body.articles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        articleName: `Zgodovinska juha ${suffix}`,
        current: { average: 4, count: 2, smallSample: true },
        previous: { average: 2, count: 1, smallSample: true },
        difference: 2,
        direction: "unavailable",
        directionReason: "Smer ni določena: v obeh obdobjih je potrebnih vsaj 5 ocen.",
      }),
      expect.objectContaining({
        articleName: `Potica ${suffix}`,
        current: { average: 1, count: 2, smallSample: true },
        previous: { average: 3, count: 1, smallSample: true },
        difference: -2,
        direction: "unavailable",
        directionReason: "Smer ni določena: v obeh obdobjih je potrebnih vsaj 5 ocen.",
      }),
    ]));
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(`private-comment-${suffix}`);
    expect(serialized).not.toContain("secret-device");
    expect(serialized).not.toMatch(/feedbackId|narociloId|qrNapravaId|mizaId|postavkaId/);
    expect(response.body.comments).toEqual({ count: 3, protected: true });
  });

  it("limits unit admins and denies ordinary users", async () => {
    const own = await get(unitAdmin, unitA, "/operativna-porocila/qr-feedback?od=2025-01-10&do=2025-01-10");
    expect(own.status).toBe(200);
    expect(own.body.totals.responses).toBe(2);
    expect(own.body.scope.units).toHaveLength(1);
    expect((await get(unitAdmin, unitA, `/operativna-porocila/qr-feedback?od=2025-01-10&do=2025-01-10&enotaId=${unitB}`)).status).toBe(403);
    expect((await get(admin, unitA, `/operativna-porocila/qr-feedback?od=2025-01-10&do=2025-01-10&enotaId=${foreignUnit}`)).status).toBe(403);
    expect((await get(user, unitA, "/operativna-porocila/qr-feedback?od=2025-01-10&do=2025-01-10")).status).toBe(403);
  });

  it("returns only the protected comment projection and aggregate-only CSV", async () => {
    const comments = await get(admin, unitA, "/operativna-porocila/qr-feedback/comments?od=2025-01-10&do=2025-01-10&page=1&pageSize=50");
    expect(comments.status).toBe(200);
    expect(comments.body.comments).toHaveLength(3);
    expect(Object.keys(comments.body.comments[0]).sort()).toEqual(["createdAt", "text", "unitName"]);
    const commentJson = JSON.stringify(comments.body);
    expect(commentJson).not.toContain("qrNapravaId");
    expect(commentJson).not.toContain("narociloId");
    expect(commentJson).not.toContain("mizaId");
    expect(commentJson).not.toContain("postavkaId");
    expect(commentJson).not.toContain("feedbackId");
    expect(commentJson).not.toContain(`secret-device-3-${suffix}`);
    const csv = await get(admin, unitA, "/operativna-porocila/qr-feedback/export?od=2025-01-10&do=2025-01-10");
    expect(csv.status).toBe(200);
    expect(csv.text).not.toContain(`private-comment-${suffix}`);
    expect(csv.text).not.toContain("secret-device");
    expect(csv.text).not.toContain("qr_naprava_id");
    expect(csv.text).not.toContain("narocilo_id");
    expect(csv.text).not.toContain("miza_id");
    expect(csv.text).not.toContain("postavka_id");
    expect(csv.text).not.toContain("feedback_id");
    expect(csv.text).toContain("comparison_period,previous,2025-01-09,2025-01-09,2");
    expect(csv.text).toContain("dimension,food");

    const [headerLine, ...csvLines] = csv.text.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    const header = headerLine!.split(",");
    const dimensionRow = csvLines.find(line => line.startsWith("dimension,food,"))!.split(",");
    expect(dimensionRow[header.indexOf("difference")]).toBe("0.5");
    expect(dimensionRow[header.indexOf("direction")]).toBe("unavailable");
    expect(dimensionRow[header.indexOf("directionReason")]).toContain("vsaj 5 odzivov");
    const articleRow = csvLines.find(line => line.startsWith(`article,Zgodovinska juha ${suffix},`))!.split(",");
    expect(articleRow[header.indexOf("difference")]).toBe("2");
    expect(articleRow[header.indexOf("direction")]).toBe("unavailable");
    expect(articleRow[header.indexOf("directionReason")]).toBe("Smer ni določena: v obeh obdobjih je potrebnih vsaj 5 ocen.");
    expect(articleRow[header.indexOf("warning")]).toBe("");
    const warningRow = csvLines.find(line => line.startsWith("warning,SMALL_SAMPLE,"))!.split(",");
    expect(warningRow[header.indexOf("directionReason")]).toBe("");
    expect(warningRow[header.indexOf("warning")]).toContain("manj kot petih odgovorih");
  });

  it("applies identical role and unit scope to comments and CSV", async () => {
    const ownComments = await get(unitAdmin, unitA, "/operativna-porocila/qr-feedback/comments?od=2025-01-10&do=2025-01-10");
    expect(ownComments.status).toBe(200);
    expect(ownComments.body.total).toBe(1);
    const ownCsv = await get(unitAdmin, unitA, "/operativna-porocila/qr-feedback/export?od=2025-01-10&do=2025-01-10");
    expect(ownCsv.status).toBe(200);
    expect(ownCsv.text).toContain("2,");
    expect((await get(unitAdmin, unitA, `/operativna-porocila/qr-feedback/comments?od=2025-01-10&do=2025-01-10&enotaId=${unitB}`)).status).toBe(403);
    expect((await get(unitAdmin, unitA, `/operativna-porocila/qr-feedback/export?od=2025-01-10&do=2025-01-10&enotaId=${unitB}`)).status).toBe(403);
    expect((await get(user, unitA, "/operativna-porocila/qr-feedback/comments?od=2025-01-10&do=2025-01-10")).status).toBe(403);
    expect((await get(user, unitA, "/operativna-porocila/qr-feedback/export?od=2025-01-10&do=2025-01-10")).status).toBe(403);
  });

  it("returns safe empty report, comments page, and CSV without data", async () => {
    const base = "od=2025-01-12&do=2025-01-12";
    const aggregate = await get(admin, unitA, `/operativna-porocila/qr-feedback?${base}`);
    expect(aggregate.status).toBe(200);
    expect(aggregate.body.totals).toMatchObject({ responses: 0, smallSample: true });
    expect(aggregate.body.trends).toEqual([]);
    expect(aggregate.body.articles).toEqual([]);
    expect(aggregate.body.comments).toEqual({ count: 0, protected: true });
    expect(aggregate.body.comparison.dimensions.food).toMatchObject({ currentAverage: null, difference: null, direction: "unavailable" });
    const comments = await get(admin, unitA, `/operativna-porocila/qr-feedback/comments?${base}`);
    expect(comments.status).toBe(200);
    expect(comments.body).toMatchObject({ total: 0, totalPages: 0, comments: [] });
    const csv = await get(admin, unitA, `/operativna-porocila/qr-feedback/export?${base}`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("counts,responses");
    expect(csv.text).not.toContain(`private-comment-${suffix}`);
  });

  it("uses each unit's own Ljubljana business-day start hour", async () => {
    const unitBReport = await get(admin, unitA, `/operativna-porocila/qr-feedback?od=2025-01-10&do=2025-01-10&enotaId=${unitB}`);
    expect(unitBReport.status).toBe(200);
    // Includes the 04:30 Ljubljana next-calendar-day response because B starts at 06:00.
    expect(unitBReport.body.totals.responses).toBe(2);
    const unitAReport = await get(admin, unitA, `/operativna-porocila/qr-feedback?od=2025-01-10&do=2025-01-10&enotaId=${unitA}`);
    expect(unitAReport.status).toBe(200);
    // A starts at 04:00 and therefore has only its two own responses.
    expect(unitAReport.body.totals.responses).toBe(2);
  });

  it("ohrani točne current/previous meje in koledarske dni čez oba Ljubljana DST prehoda", async () => {
    const dstOrders = await db.insert(narocilaTable).values([
      { enotaId: unitA, status: "zakljuceno", vir: "qr_gost" },
      { enotaId: unitA, status: "zakljuceno", vir: "qr_gost" },
      { enotaId: unitB, status: "zakljuceno", vir: "qr_gost" },
      { enotaId: unitB, status: "zakljuceno", vir: "qr_gost" },
      { enotaId: unitA, status: "zakljuceno", vir: "qr_gost" },
      { enotaId: unitA, status: "zakljuceno", vir: "qr_gost" },
      { enotaId: unitB, status: "zakljuceno", vir: "qr_gost" },
      { enotaId: unitB, status: "zakljuceno", vir: "qr_gost" },
    ]).returning({ id: narocilaTable.id, enotaId: narocilaTable.enotaId });
    orderIds.push(...dstOrders.map(order => order.id));
    const instants = [
      // Spring forward, 29 March 2026: 04:00 Ljubljana is 02:00Z.
      { enotaId: unitA, createdAt: "2026-03-29T01:59:59Z", rating: 1 },
      { enotaId: unitA, createdAt: "2026-03-29T02:00:00Z", rating: 5 },
      // Unit B starts at 06:00 Ljubljana, which is 04:00Z after the clock jump.
      { enotaId: unitB, createdAt: "2026-03-29T03:59:59Z", rating: 1 },
      { enotaId: unitB, createdAt: "2026-03-29T04:00:00Z", rating: 5 },
      // Fall back, 25 October 2026: the half-open period ends next day at
      // 03:00Z for unit A (04:00 local) and 05:00Z for unit B (06:00 local).
      { enotaId: unitA, createdAt: "2026-10-26T02:59:59Z", rating: 5 },
      { enotaId: unitA, createdAt: "2026-10-26T03:00:00Z", rating: 2 },
      { enotaId: unitB, createdAt: "2026-10-26T04:59:59Z", rating: 5 },
      { enotaId: unitB, createdAt: "2026-10-26T05:00:00Z", rating: 2 },
    ];
    await db.insert(qrGostPovratneInformacijeTable).values(instants.map((event, index) => ({
      enotaId: event.enotaId,
      narociloId: dstOrders[index]!.id,
      hranaOcena: event.rating,
      ambientOcena: event.rating,
      storitevOcena: event.rating,
      ocenePostavk: {},
      komentar: null,
      consentVersion: "1",
      consentedAt: new Date(event.createdAt),
      createdAt: new Date(event.createdAt),
    })));

    const response = await get(
      admin,
      unitA,
      "/operativna-porocila/qr-feedback?od=2026-03-29&do=2026-10-25",
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.comparison).toMatchObject({
      current: { od: "2026-03-29", do: "2026-10-25", responses: 4 },
      previous: { od: "2025-08-30", do: "2026-03-28", responses: 2 },
      dimensions: {
        food: { currentAverage: 5, previousAverage: 1, difference: 4, direction: "unavailable" },
        ambience: { currentAverage: 5, previousAverage: 1, difference: 4, direction: "unavailable" },
        service: { currentAverage: 5, previousAverage: 1, difference: 4, direction: "unavailable" },
      },
    });
    expect(response.body.totals.responses).toBe(4);
    expect(response.body.trends).toEqual([
      expect.objectContaining({ periodStart: "2026-03-29", periodEnd: "2026-03-29", responses: 2 }),
      expect.objectContaining({ periodStart: "2026-10-25", periodEnd: "2026-10-25", responses: 2 }),
    ]);
    expect(response.body.trends.reduce(
      (total: number, period: { responses: number }) => total + period.responses,
      0,
    )).toBe(response.body.totals.responses);
  });

  it("rejects invalid, reversed, and overlong dates", () => {
    expect(() => parseQrFeedbackReportQuery({ od: "2025-02-30", do: "2025-03-01" })).toThrow();
    expect(() => parseQrFeedbackReportQuery({ od: "2025-02-02", do: "2025-02-01" })).toThrow();
    expect(() => parseQrFeedbackReportQuery({ od: "2024-01-01", do: "2025-01-01" })).toThrow();
    expect(getPreviousQrFeedbackPeriod("2025-03-29", "2025-03-30")).toEqual({ od: "2025-03-27", do: "2025-03-28" });
    expect(qrFeedbackReportCsv({
      scope: { od: "2025-01-01", do: "2025-01-01", granularity: "day", timeZone: "Europe/Ljubljana", units: [] },
      totals: { responses: 0, smallSample: true, minimumSample: 5 },
      dimensions: {
        food: { average: null, count: 0, smallSample: true },
        ambience: { average: null, count: 0, smallSample: true },
        service: { average: null, count: 0, smallSample: true },
      },
      comparison: {
        current: { od: "2025-01-01", do: "2025-01-01", responses: 0, smallSample: true },
        previous: { od: "2024-12-31", do: "2024-12-31", responses: 0, smallSample: true },
        dimensions: {
          food: { currentAverage: null, previousAverage: null, difference: null, direction: "unavailable", directionReason: "Smer ni določena, ker ni ocen v obeh obdobjih." },
          ambience: { currentAverage: null, previousAverage: null, difference: null, direction: "unavailable", directionReason: "Smer ni določena, ker ni ocen v obeh obdobjih." },
          service: { currentAverage: null, previousAverage: null, difference: null, direction: "unavailable", directionReason: "Smer ni določena, ker ni ocen v obeh obdobjih." },
        },
      },
      trends: [], articles: [], warnings: [], comments: { count: 0, protected: true },
    })).not.toContain("comment");
  });

  it("določi smer artikla šele, ko oba vzorca dosežeta prag petih ocen", () => {
    expect(articleComparisonMetric(4, 4, 3, 5)).toMatchObject({
      difference: 1,
      direction: "unavailable",
      directionReason: expect.stringContaining("vsaj 5 ocen"),
    });
    expect(articleComparisonMetric(4, 5, 3, 4)).toMatchObject({
      difference: 1,
      direction: "unavailable",
      directionReason: expect.stringContaining("vsaj 5 ocen"),
    });
    expect(articleComparisonMetric(4, 5, 3, 5)).toEqual({
      currentAverage: 4,
      previousAverage: 3,
      difference: 1,
      direction: "improved",
      directionReason: null,
    });
  });

  it("določi smer skupne dimenzije šele pri vsaj petih odzivih v obeh obdobjih", () => {
    expect(dimensionComparisonMetric(4, 4, 3, 5)).toMatchObject({
      difference: 1,
      direction: "unavailable",
      directionReason: expect.stringContaining("vsaj 5 odzivov"),
    });
    expect(dimensionComparisonMetric(4, 5, 3, 4)).toMatchObject({
      difference: 1,
      direction: "unavailable",
      directionReason: expect.stringContaining("vsaj 5 odzivov"),
    });
    expect(dimensionComparisonMetric(4, 5, 3, 5)).toEqual({
      currentAverage: 4,
      previousAverage: 3,
      difference: 1,
      direction: "improved",
      directionReason: null,
    });
  });
});