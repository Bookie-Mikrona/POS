import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

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
} from "@workspace/db";
import router from "./osAmortizacijaKnjizenje";
import { savedAmortizationPdf, type SavedAmortizationReport } from "../lib/os-amortizacija-export";

const app = express().use(router);
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
      expect(asset.slice(1)).toEqual(["000042", "Spremenjeno sredstvo Ž", 1234.56, 7.125, 17.35]);
      expect(rows.at(-1)[5]).toBe(17.35);
      expect(sheet.autoFilter).toBeTruthy();
      expect(sheet.views[0].state).toBe("frozen");
      expect(JSON.stringify(rows)).toContain("30.06.2024");
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
        "Spremenjeno sredstvo Ž", "7,125", "17,35", "SKUPAJ", "Stran 1 / 1"]) expect(text).toContain(value);
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
