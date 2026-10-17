import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pool, type PoolClient } from "@workspace/db";
import { refundAgeState, scanUnknownRefundAlertsInTransaction } from "./vivaRefundAlerts";

let client: PoolClient;
const now = new Date("2026-10-17T12:00:00Z");
const companyA = "00000000-0000-4000-8000-000000000001";
const companyB = "00000000-0000-4000-8000-000000000002";

beforeEach(async () => {
  client = await pool.connect();
  await client.query("BEGIN");
  // Never run a global worker over business data. Every unqualified SQL name,
  // including trigger functions, resolves only within this rollback-only schema.
  const schema = `refund_alert_test_${randomUUID().replaceAll("-", "")}`;
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET LOCAL search_path TO "${schema}"`);
  await client.query(`
    CREATE TABLE companies(id uuid PRIMARY KEY);
    CREATE TABLE enote(id integer PRIMARY KEY, company_id uuid REFERENCES companies(id));
    CREATE TABLE viva_vracila(
      id integer PRIMARY KEY, enota_id integer REFERENCES enote(id),
      status text NOT NULL, ustvarjeno timestamptz NOT NULL
    );
  `);
  const migration = await readFile(new URL("../../../../lib/db/src/migrations/265-viva-refund-aging-alerts.sql", import.meta.url), "utf8");
  await client.query(migration);
  await client.query("INSERT INTO companies VALUES ($1), ($2)", [companyA, companyB]);
  await client.query("INSERT INTO enote VALUES (1, $1), (2, $2)", [companyA, companyB]);
});

afterEach(async () => {
  if (client) {
    await client.query("ROLLBACK");
    client.release();
  }
});

async function refund(id: number, ageHours: number, status = "unknown", unit = 1) {
  await client.query("INSERT INTO viva_vracila VALUES ($1, $2, $3, $4)", [
    id, unit, status, new Date(now.getTime() - ageHours * 3_600_000),
  ]);
}

describe("starostna opozorila UNKNOWN vračil (dejanski PostgreSQL)", () => {
  it("loči sveže, zapadle in kritične zapise tudi natančno na meji", () => {
    const settings = { overdueHours: 24, criticalHours: 72 };
    expect(refundAgeState(new Date(now.getTime() - 23 * 3_600_000), settings, +now).ageState).toBe("fresh");
    expect(refundAgeState(new Date(now.getTime() - 24 * 3_600_000), settings, +now).ageState).toBe("overdue");
    expect(refundAgeState(new Date(now.getTime() - 72 * 3_600_000), settings, +now).ageState).toBe("critical");
  });

  it("ponovljen scheduler ne podvoji opozorila, poznejši prag pa ustvari eno eskalacijo", async () => {
    await refund(1, 24);
    await refund(2, 2);
    await refund(3, 100, "paid");
    await refund(4, 100, "pending");
    expect(await scanUnknownRefundAlertsInTransaction(client, now)).toBe(1);
    expect(await scanUnknownRefundAlertsInTransaction(client, now)).toBe(0);
    const later = new Date(now.getTime() + 48 * 3_600_000);
    expect(await scanUnknownRefundAlertsInTransaction(client, later)).toBe(2); // critical #1, overdue #2
    expect(await scanUnknownRefundAlertsInTransaction(client, later)).toBe(0);
    const alerts = await client.query("SELECT refund_id, threshold FROM viva_refund_alerts ORDER BY refund_id, threshold");
    expect(alerts.rows).toEqual([
      { refund_id: 1, threshold: "critical" },
      { refund_id: 1, threshold: "overdue" },
      { refund_id: 2, threshold: "overdue" },
    ]);
  });

  it.each(["paid", "failed"])("razrešitev %s takoj zapre obe opozorili, brez ponovnega schedulerja", async status => {
    await refund(1, 80);
    expect(await scanUnknownRefundAlertsInTransaction(client, now)).toBe(2);
    await client.query("UPDATE viva_vracila SET status = $1 WHERE id = 1", [status]);
    expect((await client.query("SELECT count(*)::int AS n FROM viva_refund_alerts WHERE closed_at IS NULL")).rows[0].n).toBe(0);
    expect(await scanUnknownRefundAlertsInTransaction(client, now)).toBe(0);
    expect((await client.query("SELECT count(*)::int AS n FROM viva_refund_alerts")).rows[0].n).toBe(2);
  });

  it("čakanje na drugo odobritev ne zapre opozorila in še vedno omogoča eskalacijo", async () => {
    await refund(1, 24);
    expect(await scanUnknownRefundAlertsInTransaction(client, now)).toBe(1);
    await client.query("UPDATE viva_vracila SET status = 'awaiting_approval' WHERE id = 1");
    const later = new Date(now.getTime() + 48 * 3_600_000);
    expect(await scanUnknownRefundAlertsInTransaction(client, later)).toBe(1);
    expect((await client.query("SELECT count(*)::int AS n FROM viva_refund_alerts WHERE closed_at IS NULL")).rows[0].n).toBe(2);
    await client.query("UPDATE viva_vracila SET status = 'paid' WHERE id = 1");
    expect((await client.query("SELECT count(*)::int AS n FROM viva_refund_alerts WHERE closed_at IS NULL")).rows[0].n).toBe(0);
  });

  it("uporabi pragove posameznega podjetja in ne dovoli obrnjenih pragov", async () => {
    await client.query("INSERT INTO viva_refund_alert_settings VALUES ($1, 2, 4)", [companyB]);
    await refund(1, 5, "unknown", 1);
    await refund(2, 5, "unknown", 2);
    expect(await scanUnknownRefundAlertsInTransaction(client, now)).toBe(2);
    expect((await client.query("SELECT DISTINCT refund_id FROM viva_refund_alerts")).rows).toEqual([{ refund_id: 2 }]);
    await client.query("SAVEPOINT invalid");
    await expect(client.query("UPDATE viva_refund_alert_settings SET overdue_hours = 5 WHERE company_id = $1", [companyB])).rejects.toMatchObject({ code: "23514" });
    await client.query("ROLLBACK TO SAVEPOINT invalid");
  });

  it("že opozorjeni zapadli primeri ne blokirajo naslednjega paketa", async () => {
    await client.query(`INSERT INTO viva_vracila SELECT n, 1, 'unknown', $1::timestamptz - interval '25 hours' FROM generate_series(1, 501) n`, [now]);
    expect(await scanUnknownRefundAlertsInTransaction(client, now)).toBe(500);
    expect(await scanUnknownRefundAlertsInTransaction(client, now)).toBe(1);
    expect(await scanUnknownRefundAlertsInTransaction(client, now)).toBe(0);
  });

  it("sočasni drugi scheduler varno odneha, ko prvi drži transakcijski zaklep", async () => {
    await refund(1, 80);
    expect(await scanUnknownRefundAlertsInTransaction(client, now)).toBe(2);
    const second = await pool.connect();
    try {
      await second.query("BEGIN");
      // The advisory lock is acquired before any business-table query.
      expect(await scanUnknownRefundAlertsInTransaction(second, now)).toBe(0);
    } finally {
      await second.query("ROLLBACK");
      second.release();
    }
    expect((await client.query("SELECT count(*)::int AS n FROM viva_refund_alerts")).rows[0].n).toBe(2);
  });
});
