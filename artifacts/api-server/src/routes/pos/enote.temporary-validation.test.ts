import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { db, companiesTable, enoteTable, pool } from "@workspace/db";
import { inArray } from "drizzle-orm";
import enoteRouter from "./enote";

const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
let companyId: string;
let foreignCompanyId: string;
let parentUnitId: number;
let foreignUnitId: number;
const createdUnitIds: number[] = [];

function app() {
  const result = express();
  result.use(express.json());
  result.use((req, _res, next) => {
    Object.assign(req, { companyId, vloga: "admin" });
    next();
  });
  result.use(enoteRouter);
  return result;
}

const validPeriod = {
  activeFrom: "2026-06-01T08:00:00Z",
  activeTo: "2026-06-02T02:00:00Z",
};

beforeAll(async () => {
  const companies = await db.insert(companiesTable).values([
    { podjetjeDavcna: `TMP${suffix.slice(-8)}`, naziv: `Začasne enote ${suffix}` },
    { podjetjeDavcna: `TMF${suffix.slice(-8)}`, naziv: `Tuje podjetje ${suffix}` },
  ]).returning({ id: companiesTable.id });
  companyId = companies[0]!.id;
  foreignCompanyId = companies[1]!.id;
  const units = await db.insert(enoteTable).values([
    { companyId, ime: `Matična ${suffix}` },
    { companyId: foreignCompanyId, ime: `Tuja ${suffix}` },
  ]).returning({ id: enoteTable.id, companyId: enoteTable.companyId });
  parentUnitId = units.find(unit => unit.companyId === companyId)!.id;
  foreignUnitId = units.find(unit => unit.companyId === foreignCompanyId)!.id;
  createdUnitIds.push(parentUnitId, foreignUnitId);
});

afterAll(async () => {
  if (createdUnitIds.length) await db.delete(enoteTable).where(inArray(enoteTable.id, createdUnitIds));
  await db.delete(companiesTable).where(inArray(companiesTable.id, [companyId, foreignCompanyId]));
  await pool.end();
});

describe("API validacija začasnih enot", () => {
  it("zavrne manjkajoče, neobstoječe in obrnjeno obdobje", async () => {
    const api = request(app());
    const [missing, invalid, reversed] = await Promise.all([
      api.post("/").send({ ime: "Brez obdobja", isTemporary: true, parentUnitId }),
      api.post("/").send({
        ime: "Napačen datum", isTemporary: true, parentUnitId,
        activeFrom: "2026-02-30T08:00:00Z", activeTo: "2026-03-02T08:00:00Z",
      }),
      api.post("/").send({
        ime: "Obrnjeno obdobje", isTemporary: true, parentUnitId,
        activeFrom: "2026-06-02T08:00:00Z", activeTo: "2026-06-01T08:00:00Z",
      }),
    ]);
    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(reversed.status).toBe(400);
  });

  it("zavrne matično enoto drugega podjetja", async () => {
    const response = await request(app()).post("/").send({
      ime: "Napačna matična",
      isTemporary: true,
      parentUnitId: foreignUnitId,
      ...validPeriod,
    });
    expect(response.status).toBe(400);
    expect(response.body.napaka).toContain("ne pripada");
  });

  it("zavrne samo-povezavo in ob odstranitvi začasnosti počisti dogodkovne podatke", async () => {
    const created = await request(app()).post("/").send({
      ime: `Veljavna začasna ${suffix}`,
      isTemporary: true,
      parentUnitId,
      temporaryLocation: "Stojnica",
      ...validPeriod,
    });
    expect(created.status).toBe(201);
    createdUnitIds.push(created.body.id);

    const selfLinked = await request(app()).put(`/${created.body.id}`).send({
      parentUnitId: created.body.id,
    });
    expect(selfLinked.status).toBe(400);
    expect(selfLinked.body.napaka).toContain("sama sebi");

    const detached = await request(app()).put(`/${created.body.id}`).send({ isTemporary: false });
    expect(detached.status).toBe(200);
    expect(detached.body).toMatchObject({
      isTemporary: false,
      parentUnitId: null,
      temporaryLocation: null,
      activeFrom: null,
      activeTo: null,
    });
  });
});

describe("DB integriteta začasnih enot", () => {
  it("ne dovoli samo-povezave ali matične enote drugega podjetja", async () => {
    await expect(pool.query(
      `UPDATE enote SET parent_unit_id=$1 WHERE id=$1`,
      [parentUnitId],
    )).rejects.toMatchObject({ constraint: "enote_parent_not_self_check" });

    await expect(pool.query(
      `UPDATE enote SET parent_unit_id=$1 WHERE id=$2`,
      [foreignUnitId, parentUnitId],
    )).rejects.toMatchObject({ constraint: "enote_parent_company_fk" });
  });

  it("ne dovoli delnega ali obrnjenega obdobja", async () => {
    await expect(pool.query(
      `UPDATE enote SET active_from=now(), active_to=null WHERE id=$1`,
      [parentUnitId],
    )).rejects.toMatchObject({ constraint: "enote_active_period_check" });

    await expect(pool.query(
      `UPDATE enote SET active_from=now(), active_to=now()-interval '1 hour' WHERE id=$1`,
      [parentUnitId],
    )).rejects.toMatchObject({ constraint: "enote_active_period_check" });
  });

  it("ne dovoli začasne enote brez matične enote in celotnega obdobja", async () => {
    await expect(pool.query(
      `INSERT INTO enote (company_id, ime, is_temporary)
       VALUES ($1, $2, true)`,
      [companyId, `Nepopolna neposredna ${suffix}`],
    )).rejects.toMatchObject({ constraint: "enote_temporary_fields_check" });
  });

  it("dovoli popoln neposredni DB zapis", async () => {
    const inserted = await pool.query(
      `INSERT INTO enote (
         company_id, ime, is_temporary, parent_unit_id, active_from, active_to
       ) VALUES ($1, $2, true, $3, $4, $5)
       RETURNING id`,
      [
        companyId,
        `Veljavna neposredna ${suffix}`,
        parentUnitId,
        validPeriod.activeFrom,
        validPeriod.activeTo,
      ],
    );
    createdUnitIds.push(inserted.rows[0].id);
    expect(inserted.rowCount).toBe(1);
  });
});