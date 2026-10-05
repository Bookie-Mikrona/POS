import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import ExcelJS from "exceljs";
import { eq, inArray } from "drizzle-orm";
import { db, companiesTable, enoteTable, accountsTable, posBookingDraftsTable, posBookingDraftLinesTable } from "@workspace/db";
import router from "./temeljnice";

const companyIds: string[] = [];
const draftIds: string[] = [];
let baseUrl: string;
let server: Server;

beforeAll(async () => {
  const tag = crypto.randomUUID().slice(0, 8);
  for (const [index, name] of ["Izvoz Križišče", "Tuji izvoz"].entries()) {
    const [company] = await db.insert(companiesTable).values({ naziv: `${name} ${tag}`, podjetjeDavcna: `EXP${index}${tag}` }).returning();
    companyIds.push(company.id);
    const [unit] = await db.insert(enoteTable).values({ companyId: company.id, ime: name }).returning();
    const accounts = await db.insert(accountsTable).values([
      { companyId: company.id, code: "1000", name: "Gotovina", type: "asset" },
      { companyId: company.id, code: "7600", name: "Prihodki", type: "revenue" },
    ]).returning();
    for (const date of index === 0 ? ["2026-09-01", "2026-09-30", "2026-10-01"] : ["2026-09-28"]) {
      const [draft] = await db.insert(posBookingDraftsTable).values({
        companyId: company.id, entryDate: date, reference: `POS:PRODAJA:${date}:E${unit.id}`,
        description: `Dnevna prodaja POS — ${date}`, status: "draft", createdBy: "export-test",
      }).returning();
      draftIds.push(draft.id);
      await db.insert(posBookingDraftLinesTable).values([
        { entryId: draft.id, accountId: accounts[0].id, side: "debit", amount: "62.40", sequence: 1 },
        { entryId: draft.id, accountId: accounts[1].id, side: "credit", amount: "62.40", sequence: 2 },
      ]);
    }
  }
  const app = express();
  app.use((req, _res, next) => { Object.assign(req, { companyId: companyIds[0], vloga: "admin" }); next(); });
  app.use(router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not open a port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (draftIds.length) {
    await db.delete(posBookingDraftLinesTable).where(inArray(posBookingDraftLinesTable.entryId, draftIds));
    await db.delete(posBookingDraftsTable).where(inArray(posBookingDraftsTable.id, draftIds));
  }
  for (const companyId of companyIds) {
    await db.delete(enoteTable).where(eq(enoteTable.companyId, companyId));
    await db.delete(accountsTable).where(eq(accountsTable.companyId, companyId));
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  }
});

describe("POS temeljnice — dejanski izvoz obdobja", () => {
  it("CSV vključuje obe meji, izključi naslednji mesec in drugo podjetje", async () => {
    const response = await fetch(`${baseUrl}/temeljnice/izvoz?od=2026-09-01&do=2026-09-30&format=csv&companyId=${companyIds[1]}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("temeljnice-2026-09-01-2026-09-30.csv");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const csv = await response.text();
    expect(csv).toContain('"01.09.2026";"Izvoz Križišče"');
    expect(csv).toContain('"30.09.2026";"Izvoz Križišče"');
    expect(csv).not.toContain("01.10.2026");
    expect(csv).not.toContain("Tuji izvoz");
    expect(csv.match(/62,40/g)).toHaveLength(4);
  });
  it("XLSX je berljiv in za isti interval vsebuje vse štiri vrstice", async () => {
    const response = await fetch(`${baseUrl}/temeljnice/izvoz?od=2026-09-01&do=2026-09-30&format=xlsx`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as unknown as ExcelJS.Buffer);
    expect(workbook.getWorksheet("Temeljnice")!.rowCount).toBe(5);
    expect(workbook.getWorksheet("Povzetek")!.getCell("B7").value).toBe(124.8);
    expect(workbook.getWorksheet("Povzetek")!.getCell("B8").value).toBe(124.8);
  });
  it("prazno in neveljavno obdobje vrneta razločno napako, ne prazne datoteke", async () => {
    const empty = await fetch(`${baseUrl}/temeljnice/izvoz?od=2025-09-01&do=2025-09-30&format=csv`);
    expect(empty.status).toBe(404);
    const body = await empty.json() as { error: string };
    expect(body.error).toContain("ni temeljnic");
    for (const params of ["od=2026-02-30&do=2026-09-30&format=csv", "od=2026-10-01&do=2026-09-01&format=xlsx", "od=2026-09-01&do=2026-09-30&format=pdf"]) {
      expect((await fetch(`${baseUrl}/temeljnice/izvoz?${params}`)).status).toBe(400);
    }
  });
});
