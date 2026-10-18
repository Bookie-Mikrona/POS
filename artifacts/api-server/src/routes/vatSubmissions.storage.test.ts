import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@workspace/db";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  connect: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class { savePrivateObject = mocks.save; },
}));
vi.mock("../lib/logger", () => ({
  logger: { warn: mocks.warn, info: mocks.info, error: mocks.error },
}));
vi.mock("@workspace/db", () => ({ pool: { connect: mocks.connect } }));

const { pool } = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
let client: PoolClient;
let recovery: typeof import("../lib/vatXmlRecovery");
const companyId = "10000000-0000-0000-0000-000000000000";
const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  recovery = await import("../lib/vatXmlRecovery");
  client = await pool.connect();
  await client.query("BEGIN");
  // Shadow the business table on this connection: no global worker test may
  // ever select or mutate real pending submissions.
  await client.query(`CREATE TEMP TABLE vat_submissions (
    id uuid PRIMARY KEY, company_id uuid NOT NULL, period_year smallint NOT NULL,
    period char(4) NOT NULL, xml_inline text, xml_storage_path text
  ) ON COMMIT DROP`);
  mocks.save.mockReset();
  mocks.save.mockImplementation(async (path: string) => `/objects/${path}`);
});
afterEach(async () => {
  await client.query("ROLLBACK");
  client.release();
});
afterAll(() => pool.end());

async function seed(n: number, xml: string | null = `<xml>${n}</xml>`, path: string | null = null) {
  await client.query(`INSERT INTO vat_submissions
    VALUES ($1, $2, 2026, '0709', $3, $4)`, [id(n), companyId, xml, path]);
}
async function read(n: number) {
  return (await client.query("SELECT * FROM vat_submissions WHERE id = $1", [id(n)])).rows[0];
}

describe("DDV XML storage recovery", () => {
  it("recovers only missing archives, preserves inline XML, and skips them after restart", async () => {
    await seed(1);
    await seed(2, null);
    await seed(3, "");
    await seed(4, "<existing/>", "/objects/already.xml");
    await seed(5, "<empty-path/>", "");
    expect(await recovery.recoverVatXmlBatch(client)).toMatchObject({ attempted: 2, restored: 2 });
    const path = `vat-xml/${companyId}/2026-0709/${id(1)}.xml`;
    expect(mocks.save).toHaveBeenCalledWith(path, Buffer.from("<xml>1</xml>"), "application/xml");
    expect(await read(1)).toMatchObject({ xml_inline: "<xml>1</xml>", xml_storage_path: `/objects/${path}` });
    vi.resetModules();
    const restarted = await import("../lib/vatXmlRecovery");
    expect(await restarted.recoverVatXmlBatch(client)).toMatchObject({ attempted: 0, restored: 0 });
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });

  it("logs a transient failure without XML and retries the same destination successfully", async () => {
    await seed(1);
    await seed(2);
    mocks.save.mockRejectedValueOnce(new Error("sensitive provider payload"));
    expect(await recovery.recoverVatXmlBatch(client)).toMatchObject({ attempted: 2, restored: 1 });
    expect(await read(1)).toMatchObject({ xml_inline: "<xml>1</xml>", xml_storage_path: null });
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({
      event: "vat_xml_recovery_failed", submissionId: id(1), companyId, errorType: "Error",
    }), expect.any(String));
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("sensitive provider payload");
    expect(await recovery.recoverVatXmlBatch(client)).toMatchObject({ attempted: 1, restored: 1 });
    expect(mocks.save.mock.calls[2][0]).toBe(mocks.save.mock.calls[0][0]);
  });

  it("reuses the same object when storage succeeded but the database update failed", async () => {
    await seed(1);
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("UPDATE")) throw new Error("database unavailable");
      return client.query(sql, params);
    });
    await recovery.recoverVatXmlBatch({ query } as unknown as Pick<PoolClient, "query">);
    expect((await read(1)).xml_storage_path).toBeNull();
    expect(await recovery.recoverVatXmlBatch(client)).toMatchObject({ restored: 1 });
    expect(mocks.save.mock.calls[1][0]).toBe(mocks.save.mock.calls[0][0]);
  });

  it("caps each batch and advances past failures without starving later submissions", async () => {
    for (let n = 1; n <= 27; n++) await seed(n);
    mocks.save.mockRejectedValue(new Error("temporarily unavailable"));
    const first = await recovery.recoverVatXmlBatch(client);
    expect(first).toEqual({ attempted: 25, restored: 0, lastId: id(25) });
    mocks.save.mockImplementation(async (path: string) => `/objects/${path}`);
    expect(await recovery.recoverVatXmlBatch(client, first.lastId)).toMatchObject({ attempted: 2, restored: 2 });
    expect(await recovery.recoverVatXmlBatch(client, id(27))).toMatchObject({ attempted: 0, lastId: null });
    expect(await recovery.recoverVatXmlBatch(client)).toMatchObject({ attempted: 25, restored: 25 });
    await expect(recovery.recoverVatXmlBatch(client, null, 26)).rejects.toThrow("batch size");
  });

  it("does not replace a path or inline XML changed during upload", async () => {
    await seed(1);
    mocks.save.mockImplementationOnce(async () => {
      await client.query("UPDATE vat_submissions SET xml_storage_path = '/objects/other.xml' WHERE id = $1", [id(1)]);
      return "/objects/recovery.xml";
    });
    expect(await recovery.recoverVatXmlBatch(client)).toMatchObject({ restored: 0 });
    expect((await read(1)).xml_storage_path).toBe("/objects/other.xml");
    await seed(2);
    mocks.save.mockImplementationOnce(async () => {
      await client.query("UPDATE vat_submissions SET xml_inline = '<changed/>' WHERE id = $1", [id(2)]);
      return "/objects/recovery.xml";
    });
    expect(await recovery.recoverVatXmlBatch(client)).toMatchObject({ restored: 0 });
    expect(await read(2)).toMatchObject({ xml_inline: "<changed/>", xml_storage_path: null });
  });

  it("holds the same connection's advisory lock and releases it even after a query failure", async () => {
    await seed(1);
    const other = await pool.connect();
    const release = vi.fn();
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM vat_submissions")) {
        const blocked = await other.query("SELECT pg_try_advisory_lock($1) AS locked", [724112]);
        expect(blocked.rows[0].locked).toBe(false);
        throw new Error("select failed");
      }
      return client.query(sql, params);
    });
    mocks.connect.mockResolvedValue({ query, release });
    try {
      await recovery.runVatXmlRecovery();
      const unlocked = await other.query("SELECT pg_try_advisory_lock($1) AS locked", [724112]);
      expect(unlocked.rows[0].locked).toBe(true);
      expect(release).toHaveBeenCalledWith(false);
      expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({
        event: "vat_xml_recovery_run_failed",
      }), expect.any(String));
    } finally {
      await other.query("SELECT pg_advisory_unlock($1)", [724112]);
      other.release();
    }
  });
});
