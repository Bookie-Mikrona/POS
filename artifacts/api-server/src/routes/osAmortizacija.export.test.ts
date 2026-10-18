import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";

const state = vi.hoisted(() => ({ tx: null as any, original: null as any }));
vi.mock("@workspace/db", async (original) => {
  const actual = await original<typeof import("@workspace/db")>();
  state.original = actual.db;
  return { ...actual, db: new Proxy(actual.db, {
    get(target, property) {
      const active = state.tx ?? target;
      const value = active[property];
      return typeof value === "function" ? value.bind(active) : value;
    },
  }) };
});
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth(req: any, res: any, next: any) {
    if (!req.header("x-test-user")) { res.sendStatus(401); return; }
    req.clerkUserId = req.header("x-test-user");
    next();
  },
}));
vi.mock("../middlewares/requireSuperAdmin", () => ({ isSuperAdmin: () => false }));

import {
  companiesTable, companyModulesTable, osRolesTable, osnovnaSredstvaTable,
  osAmortizacijaObracunTable, osAmortizacijaObracunSredstvoTable,
  accountsTable, osDoknjizbeTable, osAmortizacijskeSkupineTable, osAmortizacijaNastavitveTable,
} from "@workspace/db";
import router from "./osAmortizacijaKnjizenje";
import pregledRouter from "./osAmortizacija";
import { savedAmortizationPdf, type SavedAmortizationReport } from "../lib/os-amortizacija-export";

const app = express().use(express.json(), router, pregledRouter);
const rollback = new Error("rollback export test");

async function fixture(check: (companyId: string, otherId: string) => Promise<void>) {
  try {
    await state.original.transaction(async (tx: any) => {
      state.tx = tx;
      const [company, other] = await tx.insert(companiesTable).values([
        { naziv: "Podjetje Ščž", naslov: "Testna ulica 1, Ljubljana", podjetjeDavcna: randomUUID() },
        { naziv: "Tuja družba", podjetjeDavcna: randomUUID() },
      ]).returning();
      await tx.insert(companyModulesTable).values([
        { companyId: company.id, module: "osnovna_sredstva", enabledBy: "export-test" },
        { companyId: other.id, module: "osnovna_sredstva", enabledBy: "export-test" },
      ]);
      await tx.insert(osRolesTable).values({ companyId: company.id, clerkUserId: "viewer", role: "os_viewer" });
      const [asset] = await tx.insert(osnovnaSredstvaTable).values({
        companyId: company.id, inventarnaSt: "000042", naziv: "Spremenjeno sredstvo Ž", status: "izloceno",
      }).returning();
      const [head] = await tx.insert(osAmortizacijaObracunTable).values({
        companyId: company.id, leto: 2024, doMeseca: 6, status: "odprt",
      }).returning();
      await tx.insert(osAmortizacijaObracunSredstvoTable).values({
        obracunId: head.id, sredstvoId: asset.id, osnova: "1234.56", stopnja: "7.125", obracunano: "17.35",
      });
      await tx.insert(osAmortizacijaObracunTable).values({
        companyId: company.id, leto: 2023, doMeseca: 12, status: "zakljucen",
      });
      await check(company.id, other.id);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally { state.tx = null; }
}

function binary(res: any, callback: any) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

async function pdfText(bytes: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "amort-export-"));
  try {
    const file = join(dir, "report.pdf");
    await writeFile(file, bytes);
    return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

describe("Saved amortization export", () => {
  it("exports saved numeric values without accounts, groups or active assets; lists all saved years", async () => {
    await fixture(async (company) => {
      const years = await request(app).get(`/os/${company}/amortizacija/obracun/leta`).set("x-test-user", "viewer");
      expect(years.status).toBe(200);
      expect(years.body.map((y: any) => y.leto)).toEqual([2024, 2023]);
      const response = await request(app).get(`/os/${company}/amortizacija/obracun/izvozi?leto=2024&format=xlsx`)
        .set("x-test-user", "viewer").buffer(true).parse(binary);
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["content-disposition"]).toContain("2024.xlsx");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body);
      const sheet = workbook.worksheets[0];
      const rows: any[] = [];
      sheet.eachRow((row) => rows.push(row.values));
      const asset = rows.find((r) => r[1] === "000042");
      expect(asset.slice(1)).toEqual(["000042", "Spremenjeno sredstvo Ž [R]", 1234.56, 7.125, 17.35]);
      expect(rows.at(-1)[5]).toBe(17.35);
      expect(sheet.autoFilter).toBeTruthy();
      expect(sheet.views[0].state).toBe("frozen");
      expect(JSON.stringify(rows)).toContain("30.06.2024");
      expect(JSON.stringify(rows)).toContain("Glava podjetja: trenutni register; zgodovinski posnetek manjka.");
      expect(JSON.stringify(rows)).toContain("zgodovinski podatek ni potrjen");
    });
  });

  it("renders PDF company, saved amounts, period, status, totals and print date with Slovenian text", async () => {
    await fixture(async (company) => {
      const response = await request(app).get(`/os/${company}/amortizacija/obracun/izvozi?leto=2024&format=pdf`)
        .set("x-test-user", "viewer").buffer(true).parse(binary);
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("application/pdf");
      const text = await pdfText(response.body);
      for (const value of ["Podjetje Ščž", "Davčna številka", "30.06.2024", "Odprt", "Datum tiska",
        "Spremenjeno sredstvo Ž [R]", "7,125", "17,35", "SKUPAJ", "Stran 1 / 1",
        "zgodovinski posnetek manjka", "zgodovinski podatek ni potrjen"]) expect(text).toContain(value);
    });
  });

  it("captures identities through the save route and keeps PDF/XLSX stable after register edits", async () => {
    await fixture(async (company) => {
      const tx = state.tx;
      await tx.update(osRolesTable).set({ role: "os_admin" }).where(eq(osRolesTable.companyId, company));
      const accounts = await tx.insert(accountsTable).values([
        { companyId: company, code: "4300000", name: "Amortizacija", type: "expense" },
        { companyId: company, code: "0500000", name: "Popravek", type: "asset" },
      ]).returning();
      await tx.insert(osAmortizacijaNastavitveTable).values({
        companyId: company, kontoStroskaId: accounts[0].id, kontoPopravkaId: accounts[1].id,
      });
      const [group] = await tx.insert(osAmortizacijskeSkupineTable).values({
        companyId: company, koda: "TEST", naziv: "Test", racunovodskaStonja: "10", davcnaStonja: "10",
      }).returning();
      const [asset] = await tx.update(osnovnaSredstvaTable).set({
        inventarnaSt: "000001", naziv: "Izvirno sredstvo Č", status: "v_uporabi", skupinaId: group.id,
      }).where(eq(osnovnaSredstvaTable.companyId, company)).returning();
      await tx.insert(osDoknjizbeTable).values({
        sredstvoId: asset.id, seq: 0, nabavnaVrednost: "1200", odpisanaVrednost: "0",
        datumNabave: "2021-01-01", datumAktivacije: "2021-01-01", neamortizljiviDelPct: "0",
      });
      const save = (month: number) => request(app).post(`/os/${company}/amortizacija/obracun`)
        .set("x-test-user", "viewer").send({ leto: 2022, doMeseca: month });
      expect((await save(6)).status).toBe(201);
      // Exercise the update branch as well as initial snapshot creation.
      expect((await save(12)).status).toBe(201);
      const savedHead = (await tx.select().from(osAmortizacijaObracunTable)
        .where(eq(osAmortizacijaObracunTable.companyId, company))).find((row: any) => row.leto === 2022);
      expect(savedHead.companySnapshot).toEqual({
        naziv: "Podjetje Ščž", naslov: "Testna ulica 1, Ljubljana", podjetjeDavcna: expect.any(String),
      });
      const [line] = await tx.select().from(osAmortizacijaObracunSredstvoTable)
        .where(eq(osAmortizacijaObracunSredstvoTable.obracunId, savedHead.id));
      expect(line).toMatchObject({ inventarnaStSnapshot: "000001", nazivSnapshot: "Izvirno sredstvo Č" });
      const read = async (format: string) => {
        const response = await request(app).get(`/os/${company}/amortizacija/obracun/izvozi?leto=2022&format=${format}`)
          .set("x-test-user", "viewer").buffer(true).parse(binary).expect(200);
        if (format === "pdf") return (await pdfText(response.body)).replace(/Datum tiska:.*\n/, "");
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(response.body);
        const rows: unknown[] = [];
        workbook.worksheets[0].eachRow(row => {
          if (!String(row.getCell(1).value).startsWith("Datum tiska:")) rows.push(row.values);
        });
        return JSON.stringify(rows);
      };
      const before = { pdf: await read("pdf"), xlsx: await read("xlsx") };
      await tx.update(osnovnaSredstvaTable).set({ inventarnaSt: "999999", naziv: "Poznejši naziv" })
        .where(eq(osnovnaSredstvaTable.id, asset.id));
      await tx.update(companiesTable).set({ naziv: "Poznejše podjetje", naslov: null, podjetjeDavcna: randomUUID() })
        .where(eq(companiesTable.id, company));
      const screen = await request(app).get(`/os/${company}/amortizacija?leto=2022`)
        .set("x-test-user", "viewer").expect(200);
      expect(screen.body.sredstva.find((row: any) => row.id === asset.id)).toMatchObject({
        inventarnaSt: "000001", naziv: "Izvirno sredstvo Č", identitySource: "snapshot",
      });
      for (const format of ["pdf", "xlsx"] as const) {
        const after = await read(format);
        expect(after).toBe(before[format]);
        expect(after).toContain("Izvirno sredstvo Č");
        expect(after).toContain("000001");
        expect(after).toContain("Podjetje Ščž");
        expect(after).toContain("Testna ulica 1, Ljubljana");
        expect(after).toContain(savedHead.companySnapshot.podjetjeDavcna);
        expect(after).not.toContain("[R]");
        expect(after).not.toContain("Poznejš");
      }
    });
  });

  it("rejects missing login, wrong company membership, malformed input and unsaved years", async () => {
    await fixture(async (company, other) => {
      const url = `/os/${company}/amortizacija/obracun/izvozi`;
      expect((await request(app).get(`${url}?leto=2024&format=pdf`)).status).toBe(401);
      expect((await request(app).get(`/os/${other}/amortizacija/obracun/izvozi?leto=2024&format=pdf`)
        .set("x-test-user", "viewer")).status).toBe(403);
      expect((await request(app).get(`/os/${other}/amortizacija/obracun/leta`).set("x-test-user", "viewer")).status).toBe(403);
      for (const query of ["leto=2024.5&format=pdf", "leto=2024abc&format=pdf", "leto=2024&format=csv", "format=pdf"]) {
        expect((await request(app).get(`${url}?${query}`).set("x-test-user", "viewer")).status).toBe(400);
      }
      expect((await request(app).get(`${url}?leto=2022&format=pdf`).set("x-test-user", "viewer")).status).toBe(404);
      // A saved year without any assets is still an archivable document.
      const empty = await request(app).get(`${url}?leto=2023&format=pdf`).set("x-test-user", "viewer").buffer(true).parse(binary);
      expect(empty.status).toBe(200);
      expect(await pdfText(empty.body)).toContain("0 sredstev");
    });
  });

  it("marks individual legacy and partial identities in a mixed archive without replacing saved fields", async () => {
    await fixture(async (company) => {
      const tx = state.tx;
      const [head] = (await tx.select().from(osAmortizacijaObracunTable)
        .where(eq(osAmortizacijaObracunTable.companyId, company))).filter((row: any) => row.leto === 2024);
      const [legacy] = await tx.select().from(osAmortizacijaObracunSredstvoTable)
        .where(eq(osAmortizacijaObracunSredstvoTable.obracunId, head.id));
      // A partial snapshot must still carry the warning, while its known field is preserved.
      await tx.update(osAmortizacijaObracunSredstvoTable).set({ nazivSnapshot: "Delno shranjen naziv" })
        .where(eq(osAmortizacijaObracunSredstvoTable.id, legacy.id));
      const [asset] = await tx.insert(osnovnaSredstvaTable).values({
        companyId: company, inventarnaSt: "000000", naziv: "Trenutni naziv drugega sredstva",
      }).returning();
      await tx.insert(osAmortizacijaObracunSredstvoTable).values({
        obracunId: head.id, sredstvoId: asset.id,
        inventarnaStSnapshot: "ZZ", nazivSnapshot: "Potrjena identiteta",
        osnova: "100", stopnja: "10", obracunano: "10",
      });
      const response = await request(app).get(`/os/${company}/amortizacija/obracun/izvozi?leto=2024&format=xlsx`)
        .set("x-test-user", "viewer").buffer(true).parse(binary).expect(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body);
      const rows: any[] = [];
      workbook.worksheets[0].eachRow(row => rows.push(row.values));
      const partial = rows.find(row => row[1] === "000042");
      const saved = rows.find(row => row[1] === "ZZ");
      expect(partial.slice(1)).toEqual(["000042", "Delno shranjen naziv [R]", 1234.56, 7.125, 17.35]);
      expect(saved.slice(1)).toEqual(["ZZ", "Potrjena identiteta", 100, 10, 10]);
      expect(rows.indexOf(partial)).toBeLessThan(rows.indexOf(saved));
      expect(rows.at(-1)[5]).toBe(27.35);
      expect(JSON.stringify(rows)).toContain("zgodovinski podatek ni potrjen");
      const [unchangedHead] = await tx.select().from(osAmortizacijaObracunTable)
        .where(eq(osAmortizacijaObracunTable.id, head.id));
      expect(unchangedHead.companySnapshot).toBeNull();
      const [unchangedLine] = await tx.select().from(osAmortizacijaObracunSredstvoTable)
        .where(eq(osAmortizacijaObracunSredstvoTable.id, legacy.id));
      expect(unchangedLine.inventarnaStSnapshot).toBeNull();
      const screen = await request(app).get(`/os/${company}/amortizacija?leto=2024`)
        .set("x-test-user", "viewer").expect(200);
      expect(screen.body.sredstva.find((row: any) => row.id === legacy.sredstvoId)).toMatchObject({
        inventarnaSt: "000042", naziv: "Delno shranjen naziv", identitySource: "current",
      });
    });
  });

  it("paginates long names and many assets without losing the last row or total", async () => {
    const report: SavedAmortizationReport = {
      company: { naziv: "Preizkus Ščž", naslov: null, podjetjeDavcna: "12345678" },
      leto: 2024, doMeseca: 12, status: "zakljucen", printedAt: new Date("2026-10-17T10:00:00Z"),
      rows: Array.from({ length: 80 }, (_, i) => ({
        inventarnaSt: String(i).padStart(6, "0"), naziv: i === 0 ? "Dolgo ime sredstva ".repeat(180) : `Sredstvo ${i}`,
        osnova: "100", stopnja: "10", obracunano: "0.10",
      })),
    };
    const text = await pdfText(await savedAmortizationPdf(report));
    expect(text).toContain("Sredstvo 79");
    expect(text).toContain("80 sredstev");
    expect(text).toContain("8,00");
    expect(text.match(/Inventarna št\./g)!.length).toBeGreaterThan(1);
    expect(text).toContain("Zaključen");
  });
});
