import express from "express";
import { readFileSync } from "node:fs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@workspace/db";
import eventsRouter from "./events";
import { appendStockMovementReversals } from "../../lib/stockMovementHistory";

type DbClient = {
  query: (...args: any[]) => Promise<any>;
};

const ids: { companyId?: string; sourceUnitId?: number; targetUnitId?: number; eventId?: number; returnTransferId?: number } = {};
const testEventIds: number[] = [];
const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
const statusMigration = readFileSync(
  "../../lib/db/src/migrations/131-pos-events-status-integrity.sql",
  "utf8",
);
const typeMigration = readFileSync(
  "../../lib/db/src/migrations/132-pos-events-type-integrity.sql",
  "utf8",
);
const transferEnumMigration = readFileSync(
  "../../lib/db/src/migrations/133-pos-stock-transfer-enum-integrity.sql",
  "utf8",
);
const transferTransitionMigration = readFileSync(
  "../../lib/db/src/migrations/134-pos-stock-transfer-status-transitions.sql",
  "utf8",
);
const eventMovementMigration = readFileSync(
  "../../lib/db/src/migrations/137-pos-event-stock-movement-integrity.sql",
  "utf8",
);
const movementCompletenessMigration = readFileSync(
  "../../lib/db/src/migrations/138-pos-stock-transfer-movement-completeness.sql",
  "utf8",
);
const cancellationMovementMigration = readFileSync(
  "../../lib/db/src/migrations/139-pos-stock-transfer-cancel-without-movements.sql",
  "utf8",
);
const noDraftMovementMigration = readFileSync(
  "../../lib/db/src/migrations/140-pos-stock-transfer-no-draft-movements.sql",
  "utf8",
);

async function deleteTestTransfers(transferIds: number[]): Promise<void> {
  if (!transferIds.length) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Test-only cleanup: ACCESS EXCLUSIVE lock blocks concurrent table access,
    // and ROLLBACK restores the trigger automatically if cleanup fails.
    await client.query(
      `LOCK TABLE zaloga_gibi, pos_stock_transfers IN ACCESS EXCLUSIVE MODE`,
    );
    await client.query(
      `ALTER TABLE zaloga_gibi
       DISABLE TRIGGER zaloga_gibi_event_transfer_guard`,
    );
    await client.query(
      `ALTER TABLE pos_stock_transfers
       DISABLE TRIGGER pos_stock_transfer_terminal_mutation_guard`,
    );
    await client.query(`SET LOCAL app.allow_stock_movement_cleanup = 'on'`);
    await client.query(
      `DELETE FROM zaloga_gibi WHERE event_transfer_id=ANY($1::int[])`,
      [transferIds],
    );
    await client.query(
      `DELETE FROM pos_stock_transfers WHERE id=ANY($1::int[])`,
      [transferIds],
    );
    await client.query(
      `ALTER TABLE pos_stock_transfers
       ENABLE TRIGGER pos_stock_transfer_terminal_mutation_guard`,
    );
    await client.query(
      `ALTER TABLE zaloga_gibi
       ENABLE TRIGGER zaloga_gibi_event_transfer_guard`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  Object.assign(req, {
    enotaId: ids.sourceUnitId,
    companyId: ids.companyId,
    clerkUserId: `event-integration-${suffix}`,
    vloga: "admin",
  });
  next();
});
app.use("/api", eventsRouter);

beforeAll(async () => {
  const company = await pool.query(
    `INSERT INTO companies (podjetje_davcna, naziv) VALUES ($1, $2) RETURNING id`,
    [`T${suffix.slice(-8)}`, `Test dogodka ${suffix}`],
  );
  ids.companyId = company.rows[0].id;
  const sourceUnit = await pool.query(
    `INSERT INTO enote (company_id, ime, is_temporary)
     VALUES ($1, $2, false)
     RETURNING id`,
    [ids.companyId, `Matična ${suffix}`],
  );
  ids.sourceUnitId = sourceUnit.rows[0].id;
  const targetUnit = await pool.query(
    `INSERT INTO enote (
       company_id, ime, is_temporary, parent_unit_id, active_from, active_to
     ) VALUES ($1, $2, true, $3, now(), now() + interval '1 day')
     RETURNING id`,
    [ids.companyId, `Začasna ${suffix}`, ids.sourceUnitId],
  );
  ids.targetUnitId = targetUnit.rows[0].id;

  const articles = await pool.query(
    `INSERT INTO artikli (enota_id, ime, cena, nabavni_artikel, prodajni_artikel)
     VALUES ($1, $2, 1, true, false), ($1, $3, 12, false, true) RETURNING id, ime`,
    [ids.sourceUnitId, `Sestavina ${suffix}`, `Jed ${suffix}`],
  );
  const ingredientId = articles.rows.find(row => row.ime.startsWith("Sestavina")).id;
  const mealId = articles.rows.find(row => row.ime.startsWith("Jed")).id;
  await pool.query(`INSERT INTO normativi (artikel_id, vhodni_artikel_id, kolicina) VALUES ($1,$2,0.25)`, [mealId, ingredientId]);
  const group = await pool.query(
    `INSERT INTO modifikatorske_skupine (enota_id, ime) VALUES ($1,$2) RETURNING id`,
    [ids.sourceUnitId, `Priloge ${suffix}`],
  );
  const modifier = await pool.query(
    `INSERT INTO modifikatorji (skupina_id, ime, cena_dodatek) VALUES ($1,$2,1.5) RETURNING id`,
    [group.rows[0].id, `Dodatek ${suffix}`],
  );
  await pool.query(`INSERT INTO artikli_modifikatorske_skupine (artikel_id, skupina_id) VALUES ($1,$2)`, [mealId, group.rows[0].id]);
  await pool.query(`INSERT INTO modifikator_normativi (modifikator_id, vhodni_artikel_id, kolicina) VALUES ($1,$2,0.1)`, [modifier.rows[0].id, ingredientId]);
  await pool.query(
    `INSERT INTO zaloge (artikel_id, kolicina, povprecna_cena) VALUES ($1,10,2), ($2,10,5)`,
    [ingredientId, mealId],
  );
  const openingStock = await pool.query(
    `INSERT INTO zacetne_zaloge (enota_id, leto, datum, opomba)
     VALUES ($1,1900,now()-interval '1 day',$2)
     RETURNING id`,
    [ids.sourceUnitId, `Začetno testno stanje ${suffix}`],
  );
  await pool.query(
    `INSERT INTO zacetne_zaloge_postavke (
       zacetna_zaloga_id, artikel_id, kolicina, cena_kos
     ) VALUES ($1,$2,10,2),($1,$3,10,5)`,
    [openingStock.rows[0].id, ingredientId, mealId],
  );
  await pool.query(
    `INSERT INTO zaloga_gibi (
       artikel_id, tip, kolicina, cena_kos, vrednost, opomba, referenca_id,
       source_snapshot
     ) VALUES
       ($1,'inventura',10,2,20,$3,$4,'test_fixture'),
       ($2,'inventura',10,5,50,$3,$4,'test_fixture')`,
    [ingredientId, mealId, `Začetne zaloge – test ${suffix}`, openingStock.rows[0].id],
  );
  const event = await pool.query(
    `INSERT INTO pos_events (company_id, enota_id, name, type, status, location, starts_at, ends_at)
     VALUES ($1,$2,$3,'catering','planned','Testna lokacija',now(),now()+interval '4 hours') RETURNING id`,
    [ids.companyId, ids.sourceUnitId, `Integracijski dogodek ${suffix}`],
  );
  ids.eventId = event.rows[0].id;
  await pool.query(
    `INSERT INTO pos_event_units (company_id, event_id, enota_id)
     VALUES ($1,$2,$3),($1,$2,$4)`,
    [ids.companyId, ids.eventId, ids.sourceUnitId, ids.targetUnitId],
  );
});

afterAll(async () => {
  if (ids.eventId) {
    const transfers = await pool.query(
      `SELECT id FROM pos_stock_transfers WHERE event_id=$1`,
      [ids.eventId],
    );
    await deleteTestTransfers(transfers.rows.map(row => row.id as number));
    await pool.query(`DELETE FROM pos_event_units WHERE event_id=$1`, [ids.eventId]);
    await pool.query(`DELETE FROM pos_events WHERE id=$1`, [ids.eventId]);
  }
  if (testEventIds.length > 0) {
    const transfers = await pool.query(
      `SELECT id FROM pos_stock_transfers WHERE event_id=ANY($1::int[])`,
      [testEventIds],
    );
    await deleteTestTransfers(transfers.rows.map(row => row.id as number));
    await pool.query(`DELETE FROM pos_event_units WHERE event_id=ANY($1::int[])`, [testEventIds]);
    await pool.query(`DELETE FROM pos_events WHERE id=ANY($1::int[])`, [testEventIds]);
  }
  if (ids.companyId) {
    const cleanup = await pool.connect();
    try {
      await cleanup.query("BEGIN");
      await cleanup.query(`SET LOCAL app.allow_stock_movement_cleanup = 'on'`);
      await cleanup.query(
        `DELETE FROM normativi WHERE vhodni_artikel_id IN (
          SELECT a.id FROM artikli a JOIN enote e ON e.id=a.enota_id WHERE e.company_id=$1
        )`,
        [ids.companyId],
      );
      await cleanup.query(
        `DELETE FROM modifikator_normativi WHERE vhodni_artikel_id IN (
          SELECT a.id FROM artikli a JOIN enote e ON e.id=a.enota_id WHERE e.company_id=$1
        )`,
        [ids.companyId],
      );
      await cleanup.query(`DELETE FROM companies WHERE id=$1`, [ids.companyId]);
      await cleanup.query("COMMIT");
    } finally {
      await cleanup.query("ROLLBACK");
      cleanup.release();
    }
  }
});

describe("celoten tok začasne enote dogodka", () => {
  it("migracija popravi manjkajočo in permisivno statusno omejitev", async () => {
    try {
      await pool.query(`ALTER TABLE pos_events DROP CONSTRAINT pos_events_status_check`);
      await pool.query(statusMigration);
      await expect(pool.query(
        `UPDATE pos_events SET status='legacy' WHERE id=$1`,
        [ids.eventId],
      )).rejects.toMatchObject({ constraint: "pos_events_status_check" });

      await pool.query(`ALTER TABLE pos_events DROP CONSTRAINT pos_events_status_check`);
      await pool.query(
        `ALTER TABLE pos_events
         ADD CONSTRAINT pos_events_status_check
         CHECK (status IN ('planned','active','closed','cancelled','legacy'))`,
      );
      await pool.query(statusMigration);
      await expect(pool.query(
        `UPDATE pos_events SET status='legacy' WHERE id=$1`,
        [ids.eventId],
      )).rejects.toMatchObject({ constraint: "pos_events_status_check" });
    } finally {
      await pool.query(statusMigration);
    }
  });

  it("migracija popravi manjkajočo in permisivno omejitev vrste dogodka", async () => {
    try {
      await pool.query(`ALTER TABLE pos_events DROP CONSTRAINT pos_events_type_check`);
      await pool.query(typeMigration);
      await expect(pool.query(
        `UPDATE pos_events SET type='legacy' WHERE id=$1`,
        [ids.eventId],
      )).rejects.toMatchObject({ constraint: "pos_events_type_check" });

      await pool.query(`ALTER TABLE pos_events DROP CONSTRAINT pos_events_type_check`);
      await pool.query(
        `ALTER TABLE pos_events
         ADD CONSTRAINT pos_events_type_check
         CHECK (type IN ('festival','wedding','catering','celebration','other','legacy'))`,
      );
      await pool.query(typeMigration);
      await expect(pool.query(
        `UPDATE pos_events SET type='legacy' WHERE id=$1`,
        [ids.eventId],
      )).rejects.toMatchObject({ constraint: "pos_events_type_check" });
    } finally {
      await pool.query(typeMigration);
    }
  });

  it("migracija popravi manjkajoči in permisivni omejitvi prenosa zaloge", async () => {
    const fixture = await pool.query(
      `INSERT INTO pos_stock_transfers (
         company_id, event_id, source_unit_id, target_unit_id,
         direction, status, created_by
       ) VALUES ($1,$2,$3,$4,'outbound','draft','migration-test')
       RETURNING id`,
      [ids.companyId, ids.eventId, ids.sourceUnitId, ids.targetUnitId],
    );
    const transferId = fixture.rows[0].id as number;
    try {
      await pool.query(
        `ALTER TABLE pos_stock_transfers
         DROP CONSTRAINT pos_stock_transfers_direction_check,
         DROP CONSTRAINT pos_stock_transfers_status_check`,
      );
      await pool.query(transferEnumMigration);
      await expect(pool.query(
        `UPDATE pos_stock_transfers SET direction='legacy' WHERE id=$1`,
        [transferId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfers_direction_check" });
      await expect(pool.query(
        `UPDATE pos_stock_transfers SET status='legacy' WHERE id=$1`,
        [transferId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfers_status_check" });

      await pool.query(
        `ALTER TABLE pos_stock_transfers
         DROP CONSTRAINT pos_stock_transfers_direction_check,
         DROP CONSTRAINT pos_stock_transfers_status_check`,
      );
      await pool.query(
        `ALTER TABLE pos_stock_transfers
         ADD CONSTRAINT pos_stock_transfers_direction_check
           CHECK (direction IN ('outbound','return','legacy')),
         ADD CONSTRAINT pos_stock_transfers_status_check
           CHECK (status IN ('draft','completed','cancelled','legacy'))`,
      );
      await pool.query(transferEnumMigration);
      await expect(pool.query(
        `UPDATE pos_stock_transfers SET direction='legacy' WHERE id=$1`,
        [transferId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfers_direction_check" });
      await expect(pool.query(
        `UPDATE pos_stock_transfers SET status='legacy' WHERE id=$1`,
        [transferId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfers_status_check" });
    } finally {
      await pool.query(`DELETE FROM pos_stock_transfers WHERE id=$1`, [transferId]);
      await pool.query(transferEnumMigration);
    }
  });

  it("migracija ustavi star semantično neusklajen prenos brez tihega popravka", async () => {
    const fixture = await pool.query(
      `INSERT INTO pos_stock_transfers (
         company_id, event_id, source_unit_id, target_unit_id,
         direction, status, created_by
       ) VALUES ($1,$2,$3,$4,'outbound','draft','migration-state-test')
       RETURNING id`,
      [ids.companyId, ids.eventId, ids.sourceUnitId, ids.targetUnitId],
    );
    const transferId = fixture.rows[0].id as number;
    try {
      await pool.query(
        `ALTER TABLE pos_stock_transfers
         DROP CONSTRAINT pos_stock_transfers_completion_check`,
      );
      await pool.query(
        `UPDATE pos_stock_transfers SET completed_at=now() WHERE id=$1`,
        [transferId],
      );
      await expect(pool.query(transferTransitionMigration))
        .rejects.toThrow(/neusklajenima statusom in completed_at/);
      const unchanged = await pool.query(
        `SELECT status, completed_at IS NOT NULL AS has_completed_at
         FROM pos_stock_transfers WHERE id=$1`,
        [transferId],
      );
      expect(unchanged.rows[0]).toEqual({ status: "draft", has_completed_at: true });
    } finally {
      await pool.query(
        `UPDATE pos_stock_transfers SET completed_at=NULL WHERE id=$1`,
        [transferId],
      );
      await pool.query(transferTransitionMigration);
      await pool.query(`DELETE FROM pos_stock_transfers WHERE id=$1`, [transferId]);
    }
  });

  it("migracija ustavi osirotel dogodkovni zalogovni gib brez tihega popravka", async () => {
    const article = await pool.query(
      `SELECT id FROM artikli WHERE enota_id=$1 ORDER BY id LIMIT 1`,
      [ids.sourceUnitId],
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `LOCK TABLE zaloga_gibi, pos_stock_transfers IN ACCESS EXCLUSIVE MODE`,
      );
      await client.query(
        `ALTER TABLE zaloga_gibi
         DISABLE TRIGGER zaloga_gibi_event_transfer_guard`,
      );
      await client.query(
        `ALTER TABLE zaloga_gibi
         DROP CONSTRAINT zaloga_gibi_event_transfer_link_check,
         DROP CONSTRAINT zaloga_gibi_event_transfer_fk`,
      );
      const orphan = await client.query(
        `INSERT INTO zaloga_gibi (
           artikel_id, tip, kolicina, cena_kos, vrednost, referenca_id,
           source_snapshot
         ) VALUES ($1,'event_transfer_out',-1,1,-1,2147483647,'test_fixture')
         RETURNING id`,
        [article.rows[0].id],
      );

      await client.query("SAVEPOINT migration_check");
      await expect(client.query(eventMovementMigration))
        .rejects.toThrow(/osiroteli 1/);
      await client.query("ROLLBACK TO SAVEPOINT migration_check");
      const unchanged = await client.query(
        `SELECT referenca_id, event_transfer_id
         FROM zaloga_gibi WHERE id=$1`,
        [orphan.rows[0].id],
      );
      expect(unchanged.rows[0]).toEqual({
        referenca_id: 2147483647,
        event_transfer_id: null,
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("migracija ustavi zaključen prenos z manjkajočimi gibi brez tihega popravka", async () => {
    const sourceArticle = await pool.query(
      `INSERT INTO artikli (enota_id, ime, cena, nabavni_artikel, prodajni_artikel)
       VALUES ($1,$2,1,true,false) RETURNING id`,
      [ids.sourceUnitId, `Vir preflight popolnosti ${suffix}`],
    );
    const targetArticle = await pool.query(
      `INSERT INTO artikli (enota_id, ime, cena, nabavni_artikel, prodajni_artikel)
       VALUES ($1,$2,1,true,false) RETURNING id`,
      [ids.targetUnitId, `Cilj preflight popolnosti ${suffix}`],
    );
    const transfer = await pool.query(
      `INSERT INTO pos_stock_transfers (
         company_id, event_id, source_unit_id, target_unit_id,
         direction, status, created_by
       ) VALUES ($1,$2,$3,$4,'outbound','draft','completeness-migration-test')
       RETURNING id`,
      [ids.companyId, ids.eventId, ids.sourceUnitId, ids.targetUnitId],
    );
    const transferId = transfer.rows[0].id as number;
    await pool.query(
      `INSERT INTO pos_stock_transfer_lines (
         company_id, transfer_id, source_unit_id, target_unit_id,
         source_article_id, target_article_id, quantity, unit_cost
       ) VALUES ($1,$2,$3,$4,$5,$6,1,1)`,
      [
        ids.companyId, transferId, ids.sourceUnitId, ids.targetUnitId,
        sourceArticle.rows[0].id, targetArticle.rows[0].id,
      ],
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `LOCK TABLE zaloga_gibi, pos_stock_transfers IN ACCESS EXCLUSIVE MODE`,
      );
      await client.query(
        `ALTER TABLE pos_stock_transfers
         DISABLE TRIGGER pos_stock_transfer_movement_completion_guard`,
      );
      await client.query(
        `UPDATE pos_stock_transfers
         SET status='completed', completed_at=now()
         WHERE id=$1`,
        [transferId],
      );

      await client.query("SAVEPOINT migration_check");
      await expect(client.query(movementCompletenessMigration))
        .rejects.toThrow(/zaključenih prenosov z manjkajočimi/);
      await client.query("ROLLBACK TO SAVEPOINT migration_check");
      const unchanged = await client.query(
        `SELECT status FROM pos_stock_transfers WHERE id=$1`,
        [transferId],
      );
      expect(unchanged.rows[0].status).toBe("completed");
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await deleteTestTransfers([transferId]);
      await pool.query(
        `DELETE FROM artikli WHERE id=ANY($1::int[])`,
        [[sourceArticle.rows[0].id, targetArticle.rows[0].id]],
      );
    }
  });

  it("migracija ustavi preklican prenos z gibom brez tihega brisanja", async () => {
    const sourceArticle = await pool.query(
      `INSERT INTO artikli (enota_id, ime, cena, nabavni_artikel, prodajni_artikel)
       VALUES ($1,$2,1,true,false) RETURNING id`,
      [ids.sourceUnitId, `Vir preflight preklica ${suffix}`],
    );
    const targetArticle = await pool.query(
      `INSERT INTO artikli (enota_id, ime, cena, nabavni_artikel, prodajni_artikel)
       VALUES ($1,$2,1,true,false) RETURNING id`,
      [ids.targetUnitId, `Cilj preflight preklica ${suffix}`],
    );
    const transfer = await pool.query(
      `INSERT INTO pos_stock_transfers (
         company_id, event_id, source_unit_id, target_unit_id,
         direction, status, created_by
       ) VALUES ($1,$2,$3,$4,'outbound','draft','cancel-migration-test')
       RETURNING id`,
      [ids.companyId, ids.eventId, ids.sourceUnitId, ids.targetUnitId],
    );
    const transferId = transfer.rows[0].id as number;
    await pool.query(
      `INSERT INTO pos_stock_transfer_lines (
         company_id, transfer_id, source_unit_id, target_unit_id,
         source_article_id, target_article_id, quantity, unit_cost
       ) VALUES ($1,$2,$3,$4,$5,$6,1,1)`,
      [
        ids.companyId, transferId, ids.sourceUnitId, ids.targetUnitId,
        sourceArticle.rows[0].id, targetArticle.rows[0].id,
      ],
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `LOCK TABLE zaloga_gibi, pos_stock_transfers IN ACCESS EXCLUSIVE MODE`,
      );
      await client.query(
        `ALTER TABLE pos_stock_transfers
         DISABLE TRIGGER pos_stock_transfer_movement_completion_guard`,
      );
      await client.query(
        `INSERT INTO zaloga_gibi (
           artikel_id, tip, kolicina, cena_kos, vrednost,
           referenca_id, event_transfer_id, source_snapshot
         ) VALUES ($1,'event_transfer_out',-1,1,-1,$2,$2,'test_fixture')`,
        [sourceArticle.rows[0].id, transferId],
      );
      await client.query(
        `UPDATE pos_stock_transfers SET status='cancelled' WHERE id=$1`,
        [transferId],
      );

      await client.query("SAVEPOINT migration_check");
      await expect(client.query(cancellationMovementMigration))
        .rejects.toThrow(/preklicanih prenosov z zalogovnimi gibi/);
      await client.query("ROLLBACK TO SAVEPOINT migration_check");
      const unchanged = await client.query(
        `SELECT pst.status, count(zg.id)::int AS movements
         FROM pos_stock_transfers pst
         LEFT JOIN zaloga_gibi zg ON zg.event_transfer_id=pst.id
         WHERE pst.id=$1
         GROUP BY pst.status`,
        [transferId],
      );
      expect(unchanged.rows[0]).toEqual({ status: "cancelled", movements: 1 });
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await deleteTestTransfers([transferId]);
      await pool.query(
        `DELETE FROM artikli WHERE id=ANY($1::int[])`,
        [[sourceArticle.rows[0].id, targetArticle.rows[0].id]],
      );
    }
  });

  it("migracija ustavi nedokončan prenos z gibom brez tihega popravljanja", async () => {
    const sourceArticle = await pool.query(
      `INSERT INTO artikli (enota_id, ime, cena, nabavni_artikel, prodajni_artikel)
       VALUES ($1,$2,1,true,false) RETURNING id`,
      [ids.sourceUnitId, `Vir preflight osnutka ${suffix}`],
    );
    const targetArticle = await pool.query(
      `INSERT INTO artikli (enota_id, ime, cena, nabavni_artikel, prodajni_artikel)
       VALUES ($1,$2,1,true,false) RETURNING id`,
      [ids.targetUnitId, `Cilj preflight osnutka ${suffix}`],
    );
    const transfer = await pool.query(
      `INSERT INTO pos_stock_transfers (
         company_id, event_id, source_unit_id, target_unit_id,
         direction, status, created_by
       ) VALUES ($1,$2,$3,$4,'outbound','draft','draft-migration-test')
       RETURNING id`,
      [ids.companyId, ids.eventId, ids.sourceUnitId, ids.targetUnitId],
    );
    const transferId = transfer.rows[0].id as number;
    await pool.query(
      `INSERT INTO pos_stock_transfer_lines (
         company_id, transfer_id, source_unit_id, target_unit_id,
         source_article_id, target_article_id, quantity, unit_cost
       ) VALUES ($1,$2,$3,$4,$5,$6,1,1)`,
      [
        ids.companyId, transferId, ids.sourceUnitId, ids.targetUnitId,
        sourceArticle.rows[0].id, targetArticle.rows[0].id,
      ],
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `LOCK TABLE zaloga_gibi, pos_stock_transfers IN ACCESS EXCLUSIVE MODE`,
      );
      await client.query(
        `ALTER TABLE zaloga_gibi
         DISABLE TRIGGER zaloga_gibi_no_committed_draft_transfer`,
      );
      await client.query(
        `INSERT INTO zaloga_gibi (
           artikel_id, tip, kolicina, cena_kos, vrednost,
           referenca_id, event_transfer_id, source_snapshot
         ) VALUES ($1,'event_transfer_out',-1,1,-1,$2,$2,'test_fixture')`,
        [sourceArticle.rows[0].id, transferId],
      );

      await client.query("SAVEPOINT migration_check");
      await expect(client.query(noDraftMovementMigration))
        .rejects.toThrow(/nedokončanih prenosov z zalogovnimi gibi/);
      await client.query("ROLLBACK TO SAVEPOINT migration_check");
      const unchanged = await client.query(
        `SELECT pst.status, count(zg.id)::int AS movements
         FROM pos_stock_transfers pst
         LEFT JOIN zaloga_gibi zg ON zg.event_transfer_id=pst.id
         WHERE pst.id=$1
         GROUP BY pst.status`,
        [transferId],
      );
      expect(unchanged.rows[0]).toEqual({ status: "draft", movements: 1 });
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await deleteTestTransfers([transferId]);
      await pool.query(
        `DELETE FROM artikli WHERE id=ANY($1::int[])`,
        [[sourceArticle.rows[0].id, targetArticle.rows[0].id]],
      );
    }
  });

  it("migracija pred preflightom počaka na ekskluzivni zaklep obeh tabel", async () => {
    const blocker = await pool.connect();
    const migrator = await pool.connect();
    let migrationPromise: Promise<unknown> | undefined;

    try {
      await blocker.query("BEGIN");
      await blocker.query(
        `LOCK TABLE zaloga_gibi, pos_stock_transfers IN ROW EXCLUSIVE MODE`,
      );
      const migratorPid = await migrator.query(`SELECT pg_backend_pid() AS pid`);

      migrationPromise = migrator.query(noDraftMovementMigration);

      let waitingForExclusiveLock = false;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const pendingLock = await pool.query(
          `SELECT count(*)::int AS count
           FROM pg_locks
           WHERE pid=$1
             AND relation IN (
               'zaloga_gibi'::regclass,
               'pos_stock_transfers'::regclass
             )
             AND mode='AccessExclusiveLock'
             AND NOT granted`,
          [migratorPid.rows[0].pid],
        );
        if (pendingLock.rows[0].count > 0) {
          waitingForExclusiveLock = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(waitingForExclusiveLock).toBe(true);

      await blocker.query("COMMIT");
      await migrationPromise;
      const installed = await pool.query(
        `SELECT tgdeferrable, tginitdeferred
         FROM pg_trigger
         WHERE tgname='zaloga_gibi_no_committed_draft_transfer'`,
      );
      expect(installed.rows[0]).toEqual({
        tgdeferrable: true,
        tginitdeferred: true,
      });
    } finally {
      await blocker.query("ROLLBACK");
      await migrationPromise?.catch(() => undefined);
      blocker.release();
      migrator.release();
    }
  });

  it("DB sprejme povezavo istega podjetja in zavrne enoto drugega podjetja", async () => {
    const validUnit = await pool.query(
      `INSERT INTO enote (company_id, ime) VALUES ($1, $2) RETURNING id`,
      [ids.companyId, `Veljavna povezana ${suffix}`],
    );
    const foreignCompany = await pool.query(
      `INSERT INTO companies (podjetje_davcna, naziv) VALUES ($1, $2) RETURNING id`,
      [`F${suffix.slice(-8)}`, `Tuje podjetje dogodka ${suffix}`],
    );
    try {
      const foreignUnit = await pool.query(
        `INSERT INTO enote (company_id, ime) VALUES ($1, $2) RETURNING id`,
        [foreignCompany.rows[0].id, `Tuja povezana ${suffix}`],
      );
      const inserted = await pool.query(
        `INSERT INTO pos_event_units (company_id, event_id, enota_id)
         VALUES ($1, $2, $3)`,
        [ids.companyId, ids.eventId, validUnit.rows[0].id],
      );
      expect(inserted.rowCount).toBe(1);

      await expect(pool.query(
        `INSERT INTO pos_event_units (company_id, event_id, enota_id)
         VALUES ($1, $2, $3)`,
        [ids.companyId, ids.eventId, foreignUnit.rows[0].id],
      )).rejects.toMatchObject({ constraint: "pos_event_units_unit_company_fk" });
    } finally {
      await pool.query(
        `DELETE FROM pos_event_units WHERE event_id=$1 AND enota_id=$2`,
        [ids.eventId, validUnit.rows[0].id],
      );
      await pool.query(`DELETE FROM companies WHERE id=$1`, [foreignCompany.rows[0].id]);
    }
  });

  it("DB zavrne neznan status dogodka pri vstavitvi in spremembi", async () => {
    await expect(pool.query(
      `INSERT INTO pos_events (
         company_id, enota_id, name, type, status, location, starts_at, ends_at
       ) VALUES ($1,$2,$3,'other','uvozen_neznan_status','Testna lokacija',now(),now()+interval '1 hour')`,
      [ids.companyId, ids.sourceUnitId, `Neveljaven status ${suffix}`],
    )).rejects.toMatchObject({ constraint: "pos_events_status_check" });

    await expect(pool.query(
      `UPDATE pos_events SET status='uvozen_neznan_status' WHERE id=$1`,
      [ids.eventId],
    )).rejects.toMatchObject({ constraint: "pos_events_status_check" });

    const unchanged = await pool.query(`SELECT status FROM pos_events WHERE id=$1`, [ids.eventId]);
    expect(unchanged.rows[0].status).toBe("planned");
  });

  it("DB zavrne neznano vrsto dogodka pri vstavitvi in spremembi", async () => {
    await expect(pool.query(
      `INSERT INTO pos_events (
         company_id, enota_id, name, type, status, location, starts_at, ends_at
       ) VALUES ($1,$2,$3,'uvozena_neznana_vrsta','planned','Testna lokacija',now(),now()+interval '1 hour')`,
      [ids.companyId, ids.sourceUnitId, `Neveljavna vrsta ${suffix}`],
    )).rejects.toMatchObject({ constraint: "pos_events_type_check" });

    await expect(pool.query(
      `UPDATE pos_events SET type='uvozena_neznana_vrsta' WHERE id=$1`,
      [ids.eventId],
    )).rejects.toMatchObject({ constraint: "pos_events_type_check" });

    const unchanged = await pool.query(`SELECT type FROM pos_events WHERE id=$1`, [ids.eventId]);
    expect(unchanged.rows[0].type).toBe("catering");
  });

  it("DB zavrne neznano smer in status prenosa pri vstavitvi in spremembi", async () => {
    const insertTransferSql = `INSERT INTO pos_stock_transfers (
      company_id, event_id, source_unit_id, target_unit_id,
      direction, status, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,'direct-test') RETURNING id`;
    await expect(pool.query(insertTransferSql, [
      ids.companyId, ids.eventId, ids.sourceUnitId, ids.targetUnitId,
      "uvozena_neznana_smer", "draft",
    ])).rejects.toMatchObject({ constraint: "pos_stock_transfers_direction_check" });
    await expect(pool.query(insertTransferSql, [
      ids.companyId, ids.eventId, ids.sourceUnitId, ids.targetUnitId,
      "outbound", "uvozen_neznan_status",
    ])).rejects.toMatchObject({ constraint: "pos_stock_transfers_status_check" });

    const valid = await pool.query(insertTransferSql, [
      ids.companyId, ids.eventId, ids.sourceUnitId, ids.targetUnitId,
      "outbound", "draft",
    ]);
    const transferId = valid.rows[0].id as number;
    try {
      await expect(pool.query(
        `UPDATE pos_stock_transfers SET direction='uvozena_neznana_smer' WHERE id=$1`,
        [transferId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfers_direction_check" });
      await expect(pool.query(
        `UPDATE pos_stock_transfers SET status='uvozen_neznan_status' WHERE id=$1`,
        [transferId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfers_status_check" });
    } finally {
      await pool.query(`DELETE FROM pos_stock_transfers WHERE id=$1`, [transferId]);
    }
  });

  it("DB uskladi completed_at in prepreči ponovno odpiranje terminalnega prenosa", async () => {
    const insertTransferSql = `INSERT INTO pos_stock_transfers (
      company_id, event_id, source_unit_id, target_unit_id,
      direction, status, completed_at, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'transition-test') RETURNING id`;

    await expect(pool.query(insertTransferSql, [
      ids.companyId, ids.eventId, ids.sourceUnitId, ids.targetUnitId,
      "outbound", "draft", new Date(),
    ])).rejects.toMatchObject({ constraint: "pos_stock_transfers_completion_check" });
    await expect(pool.query(insertTransferSql, [
      ids.companyId, ids.eventId, ids.sourceUnitId, ids.targetUnitId,
      "outbound", "completed", null,
    ])).rejects.toMatchObject({ constraint: "pos_stock_transfers_completion_check" });

    const completedFixture = await pool.query(insertTransferSql, [
      ids.companyId, ids.eventId, ids.sourceUnitId, ids.targetUnitId,
      "outbound", "draft", null,
    ]);
    const completedId = completedFixture.rows[0].id as number;
    const cancelledFixture = await pool.query(insertTransferSql, [
      ids.companyId, ids.eventId, ids.targetUnitId, ids.sourceUnitId,
      "return", "draft", null,
    ]);
    const cancelledId = cancelledFixture.rows[0].id as number;

    try {
      const completed = await pool.query(
        `UPDATE pos_stock_transfers
         SET status='completed', completed_at=now()
         WHERE id=$1`,
        [completedId],
      );
      expect(completed.rowCount).toBe(1);
      await expect(pool.query(
        `UPDATE pos_stock_transfers
         SET status='draft', completed_at=NULL
         WHERE id=$1`,
        [completedId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfers_status_transition_check" });
      await expect(pool.query(
        `UPDATE pos_stock_transfers
         SET status='cancelled', completed_at=NULL
         WHERE id=$1`,
        [completedId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfers_status_transition_check" });

      const cancelled = await pool.query(
        `UPDATE pos_stock_transfers SET status='cancelled' WHERE id=$1`,
        [cancelledId],
      );
      expect(cancelled.rowCount).toBe(1);
      await expect(pool.query(
        `UPDATE pos_stock_transfers SET status='draft' WHERE id=$1`,
        [cancelledId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfers_status_transition_check" });
      await expect(pool.query(
        `UPDATE pos_stock_transfers
         SET status='completed', completed_at=now()
         WHERE id=$1`,
        [cancelledId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfers_status_transition_check" });
    } finally {
      await deleteTestTransfers([completedId, cancelledId]);
    }
  });

  it("DB zamrzne glavo in vrstice zaključenega ali preklicanega prenosa", async () => {
    const sourceArticles = await pool.query(
      `INSERT INTO artikli (enota_id, ime, cena, nabavni_artikel, prodajni_artikel)
       VALUES ($1,$2,1,true,false),($1,$3,1,true,false)
       RETURNING id`,
      [ids.sourceUnitId, `Vir zamrznitve A ${suffix}`, `Vir zamrznitve B ${suffix}`],
    );
    const targetArticles = await pool.query(
      `INSERT INTO artikli (enota_id, ime, cena, nabavni_artikel, prodajni_artikel)
       VALUES ($1,$2,1,true,false),($1,$3,1,true,false)
       RETURNING id`,
      [ids.targetUnitId, `Cilj zamrznitve A ${suffix}`, `Cilj zamrznitve B ${suffix}`],
    );
    const [sourceA, sourceB] = sourceArticles.rows.map(row => row.id as number);
    const [targetA, targetB] = targetArticles.rows.map(row => row.id as number);
    const scopeEvent = await pool.query(
      `INSERT INTO pos_events (
         company_id, enota_id, name, type, status, location, starts_at, ends_at
       ) VALUES ($1,$2,$3,'catering','planned','Testna lokacija',now(),now()+interval '4 hours')
       RETURNING id`,
      [ids.companyId, ids.sourceUnitId, `Dogodek osnutka prenosa ${suffix}`],
    );
    const scopeEventId = scopeEvent.rows[0].id as number;
    testEventIds.push(scopeEventId);
    const insertTransferSql = `INSERT INTO pos_stock_transfers (
      company_id, event_id, source_unit_id, target_unit_id,
      direction, status, created_by
    ) VALUES ($1,$2,$3,$4,$5,'draft','immutability-test') RETURNING id`;
    const completedTransfer = await pool.query(insertTransferSql, [
      ids.companyId, ids.eventId, ids.sourceUnitId, ids.targetUnitId, "outbound",
    ]);
    const cancelledTransfer = await pool.query(insertTransferSql, [
      ids.companyId, ids.eventId, ids.targetUnitId, ids.sourceUnitId, "return",
    ]);
    const completedScopeDraft = await pool.query(insertTransferSql, [
      ids.companyId, scopeEventId, ids.sourceUnitId, ids.targetUnitId, "return",
    ]);
    const cancelledScopeDraft = await pool.query(insertTransferSql, [
      ids.companyId, scopeEventId, ids.targetUnitId, ids.sourceUnitId, "outbound",
    ]);
    const completedId = completedTransfer.rows[0].id as number;
    const cancelledId = cancelledTransfer.rows[0].id as number;
    const completedScopeDraftId = completedScopeDraft.rows[0].id as number;
    const cancelledScopeDraftId = cancelledScopeDraft.rows[0].id as number;
    const insertLineSql = `INSERT INTO pos_stock_transfer_lines (
      company_id, transfer_id, source_unit_id, target_unit_id,
      source_article_id, target_article_id, quantity, unit_cost
    ) VALUES ($1,$2,$3,$4,$5,$6,1,1) RETURNING id`;
    const completedLine = await pool.query(insertLineSql, [
      ids.companyId, completedId, ids.sourceUnitId, ids.targetUnitId, sourceA, targetA,
    ]);
    const cancelledLine = await pool.query(insertLineSql, [
      ids.companyId, cancelledId, ids.targetUnitId, ids.sourceUnitId, targetA, sourceA,
    ]);
    const completedLineId = completedLine.rows[0].id as number;
    const cancelledLineId = cancelledLine.rows[0].id as number;
    const completionClient = await pool.connect();
    let completedMovementId: number;
    try {
      await completionClient.query("BEGIN");
      const completedMovement = await completionClient.query(
        `INSERT INTO zaloga_gibi (
           artikel_id, tip, kolicina, cena_kos, vrednost,
           referenca_id, event_transfer_id, source_snapshot
         ) VALUES ($1,'event_transfer_out',-1,1,-1,$2,$2,'test_fixture')
         RETURNING id`,
        [sourceA, completedId],
      );
      await completionClient.query(
        `INSERT INTO zaloga_gibi (
           artikel_id, tip, kolicina, cena_kos, vrednost,
           referenca_id, event_transfer_id, source_snapshot
         ) VALUES ($1,'event_transfer_in',1,1,1,$2,$2,'test_fixture')`,
        [targetA, completedId],
      );
      await completionClient.query(
        `UPDATE pos_stock_transfers
         SET status='completed', completed_at=now()
         WHERE id=$1`,
        [completedId],
      );
      await completionClient.query("COMMIT");
      completedMovementId = completedMovement.rows[0].id as number;
    } catch (error) {
      await completionClient.query("ROLLBACK");
      throw error;
    } finally {
      completionClient.release();
    }

    try {
      const cancelled = await pool.query(
        `UPDATE pos_stock_transfers SET status='cancelled' WHERE id=$1`,
        [cancelledId],
      );
      expect(cancelled.rowCount).toBe(1);

      for (const transferId of [completedId, cancelledId]) {
        await expect(pool.query(
          `UPDATE pos_stock_transfers SET created_by='spremenjen' WHERE id=$1`,
          [transferId],
        )).rejects.toMatchObject({ constraint: "pos_stock_transfers_terminal_immutable" });
      }

      await expect(pool.query(insertLineSql, [
        ids.companyId, completedId, ids.sourceUnitId, ids.targetUnitId, sourceB, targetB,
      ])).rejects.toMatchObject({ constraint: "pos_stock_transfer_lines_terminal_immutable" });
      await expect(pool.query(
        `UPDATE pos_stock_transfer_lines SET quantity=2 WHERE id=$1`,
        [completedLineId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfer_lines_terminal_immutable" });
      await expect(pool.query(
        `DELETE FROM pos_stock_transfer_lines WHERE id=$1`,
        [completedLineId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfer_lines_terminal_immutable" });
      await expect(pool.query(
        `UPDATE pos_stock_transfer_lines SET transfer_id=$2 WHERE id=$1`,
        [completedLineId, completedScopeDraftId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfer_lines_terminal_immutable" });

      await expect(pool.query(insertLineSql, [
        ids.companyId, cancelledId, ids.targetUnitId, ids.sourceUnitId, targetB, sourceB,
      ])).rejects.toMatchObject({ constraint: "pos_stock_transfer_lines_terminal_immutable" });
      await expect(pool.query(
        `UPDATE pos_stock_transfer_lines SET quantity=2 WHERE id=$1`,
        [cancelledLineId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfer_lines_terminal_immutable" });
      await expect(pool.query(
        `DELETE FROM pos_stock_transfer_lines WHERE id=$1`,
        [cancelledLineId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfer_lines_terminal_immutable" });
      await expect(pool.query(
        `UPDATE pos_stock_transfer_lines SET transfer_id=$2 WHERE id=$1`,
        [cancelledLineId, cancelledScopeDraftId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfer_lines_terminal_immutable" });

      for (const [movementId, transferId, articleId, type] of [
        [completedMovementId, completedId, sourceB, "event_transfer_out"],
      ] as const) {
        await expect(pool.query(
          `UPDATE zaloga_gibi SET opomba='spremenjen gib' WHERE id=$1`,
          [movementId],
        )).rejects.toMatchObject({
          constraint: "zaloga_gibi_terminal_event_transfer_immutable",
        });
        await expect(pool.query(
          `DELETE FROM zaloga_gibi WHERE id=$1`,
          [movementId],
        )).rejects.toMatchObject({
          constraint: "zaloga_gibi_terminal_event_transfer_immutable",
        });
        await expect(pool.query(
          `INSERT INTO zaloga_gibi (
             artikel_id, tip, kolicina, cena_kos, vrednost,
             referenca_id, event_transfer_id, source_snapshot
           ) VALUES ($1,$2,-1,1,-1,$3,$3,'test_fixture')`,
          [articleId, type, transferId],
        )).rejects.toMatchObject({
          constraint: "zaloga_gibi_terminal_event_transfer_immutable",
        });
      }

      await expect(pool.query(
        `DELETE FROM pos_stock_transfers WHERE id=$1`,
        [completedId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfers_terminal_immutable" });
      await expect(pool.query(
        `DELETE FROM pos_stock_transfers WHERE id=$1`,
        [cancelledId],
      )).rejects.toMatchObject({ constraint: "pos_stock_transfers_terminal_immutable" });

      const deletedDraft = await pool.query(
        `DELETE FROM pos_stock_transfers WHERE id=$1`,
        [completedScopeDraftId],
      );
      expect(deletedDraft.rowCount).toBe(1);

      await expect(pool.query(
        `DELETE FROM pos_events WHERE id=$1`,
        [ids.eventId],
      )).rejects.toMatchObject({ code: "23503" });
      await expect(pool.query(
        `DELETE FROM companies WHERE id=$1`,
        [ids.companyId],
      )).rejects.toMatchObject({ code: "23503" });
    } finally {
      await deleteTestTransfers([completedId, cancelledId, cancelledScopeDraftId]);
      await pool.query(
        `DELETE FROM artikli WHERE id=ANY($1::int[])`,
        [[sourceA, sourceB, targetA, targetB]],
      );
    }
  });

  it("DB zahteva točen par zalogovnih gibov pred zaključkom prenosa", async () => {
    const sourceArticle = await pool.query(
      `INSERT INTO artikli (enota_id, ime, cena, nabavni_artikel, prodajni_artikel)
       VALUES ($1,$2,1,true,false) RETURNING id`,
      [ids.sourceUnitId, `Vir popolnosti ${suffix}`],
    );
    const targetArticle = await pool.query(
      `INSERT INTO artikli (enota_id, ime, cena, nabavni_artikel, prodajni_artikel)
       VALUES ($1,$2,1,true,false) RETURNING id`,
      [ids.targetUnitId, `Cilj popolnosti ${suffix}`],
    );
    const sourceArticleId = sourceArticle.rows[0].id as number;
    const targetArticleId = targetArticle.rows[0].id as number;

    const createDraftTransfer = async (): Promise<number> => {
      const transfer = await pool.query(
        `INSERT INTO pos_stock_transfers (
           company_id, event_id, source_unit_id, target_unit_id,
           direction, status, created_by
         ) VALUES ($1,$2,$3,$4,'outbound','draft','completeness-test')
         RETURNING id`,
        [ids.companyId, ids.eventId, ids.sourceUnitId, ids.targetUnitId],
      );
      const transferId = transfer.rows[0].id as number;
      await pool.query(
        `INSERT INTO pos_stock_transfer_lines (
           company_id, transfer_id, source_unit_id, target_unit_id,
           source_article_id, target_article_id, quantity, unit_cost
         ) VALUES ($1,$2,$3,$4,$5,$6,3,2)`,
        [
          ids.companyId, transferId, ids.sourceUnitId, ids.targetUnitId,
          sourceArticleId, targetArticleId,
        ],
      );
      return transferId;
    };
    const insertMovement = async (
      executor: DbClient,
      transferId: number,
      articleId: number,
      type: "event_transfer_out" | "event_transfer_in",
      quantity: number,
      value: number,
    ): Promise<void> => {
      await executor.query(
        `INSERT INTO zaloga_gibi (
           artikel_id, tip, kolicina, cena_kos, vrednost,
           referenca_id, event_transfer_id, source_snapshot
         ) VALUES ($1,$2,$3,2,$4,$5,$5,'test_fixture')`,
        [articleId, type, quantity, value, transferId],
      );
    };
    const complete = (transferId: number) => pool.query(
      `UPDATE pos_stock_transfers
       SET status='completed', completed_at=now()
       WHERE id=$1`,
      [transferId],
    );

    try {
      const missingId = await createDraftTransfer();
      await expect(complete(missingId)).rejects.toMatchObject({
        constraint: "pos_stock_transfer_movement_completeness",
      });
      await deleteTestTransfers([missingId]);

      const duplicateId = await createDraftTransfer();
      const duplicateClient = await pool.connect();
      try {
        await duplicateClient.query("BEGIN");
        await insertMovement(duplicateClient, duplicateId, sourceArticleId, "event_transfer_out", -3, -6);
        await insertMovement(duplicateClient, duplicateId, targetArticleId, "event_transfer_in", 3, 6);
        await insertMovement(duplicateClient, duplicateId, sourceArticleId, "event_transfer_out", -3, -6);
        await expect(duplicateClient.query(
          `UPDATE pos_stock_transfers
           SET status='completed', completed_at=now()
           WHERE id=$1`,
          [duplicateId],
        )).rejects.toMatchObject({
          constraint: "pos_stock_transfer_movement_completeness",
        });
      } finally {
        await duplicateClient.query("ROLLBACK");
        duplicateClient.release();
      }
      await deleteTestTransfers([duplicateId]);

      const mismatchId = await createDraftTransfer();
      const mismatchClient = await pool.connect();
      try {
        await mismatchClient.query("BEGIN");
        await insertMovement(mismatchClient, mismatchId, sourceArticleId, "event_transfer_out", -3, -5);
        await insertMovement(mismatchClient, mismatchId, targetArticleId, "event_transfer_in", 3, 6);
        await expect(mismatchClient.query(
          `UPDATE pos_stock_transfers
           SET status='completed', completed_at=now()
           WHERE id=$1`,
          [mismatchId],
        )).rejects.toMatchObject({
          constraint: "pos_stock_transfer_movement_completeness",
        });
      } finally {
        await mismatchClient.query("ROLLBACK");
        mismatchClient.release();
      }
      await deleteTestTransfers([mismatchId]);

      const completeId = await createDraftTransfer();
      const completeClient = await pool.connect();
      try {
        await completeClient.query("BEGIN");
        await insertMovement(completeClient, completeId, sourceArticleId, "event_transfer_out", -3, -6);
        await insertMovement(completeClient, completeId, targetArticleId, "event_transfer_in", 3, 6);
        const completed = await completeClient.query(
          `UPDATE pos_stock_transfers
           SET status='completed', completed_at=now()
           WHERE id=$1`,
          [completeId],
        );
        expect(completed.rowCount).toBe(1);
        await completeClient.query("COMMIT");
      } catch (error) {
        await completeClient.query("ROLLBACK");
        throw error;
      } finally {
        completeClient.release();
      }
      await deleteTestTransfers([completeId]);
    } finally {
      await pool.query(
        `DELETE FROM artikli WHERE id=ANY($1::int[])`,
        [[sourceArticleId, targetArticleId]],
      );
    }
  });

  it("DB dovoli preklic samo osnutku brez zalogovnih gibov", async () => {
    const sourceArticle = await pool.query(
      `INSERT INTO artikli (enota_id, ime, cena, nabavni_artikel, prodajni_artikel)
       VALUES ($1,$2,1,true,false) RETURNING id`,
      [ids.sourceUnitId, `Vir preklica brez gibov ${suffix}`],
    );
    const targetArticle = await pool.query(
      `INSERT INTO artikli (enota_id, ime, cena, nabavni_artikel, prodajni_artikel)
       VALUES ($1,$2,1,true,false) RETURNING id`,
      [ids.targetUnitId, `Cilj preklica brez gibov ${suffix}`],
    );
    const transfer = await pool.query(
      `INSERT INTO pos_stock_transfers (
         company_id, event_id, source_unit_id, target_unit_id,
         direction, status, created_by
       ) VALUES ($1,$2,$3,$4,'outbound','draft','cancel-with-movement-test')
       RETURNING id`,
      [ids.companyId, ids.eventId, ids.sourceUnitId, ids.targetUnitId],
    );
    const transferId = transfer.rows[0].id as number;
    await pool.query(
      `INSERT INTO pos_stock_transfer_lines (
         company_id, transfer_id, source_unit_id, target_unit_id,
         source_article_id, target_article_id, quantity, unit_cost
       ) VALUES ($1,$2,$3,$4,$5,$6,1,1)`,
      [
        ids.companyId, transferId, ids.sourceUnitId, ids.targetUnitId,
        sourceArticle.rows[0].id, targetArticle.rows[0].id,
      ],
    );
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO zaloga_gibi (
             artikel_id, tip, kolicina, cena_kos, vrednost,
             referenca_id, event_transfer_id, source_snapshot
           ) VALUES ($1,'event_transfer_out',-1,1,-1,$2,$2,'test_fixture')`,
          [sourceArticle.rows[0].id, transferId],
        );
        await expect(client.query(
          `UPDATE pos_stock_transfers SET status='cancelled' WHERE id=$1`,
          [transferId],
        )).rejects.toMatchObject({
          constraint: "pos_stock_transfer_cancelled_without_movements",
        });
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      const cancelled = await pool.query(
        `UPDATE pos_stock_transfers SET status='cancelled' WHERE id=$1`,
        [transferId],
      );
      expect(cancelled.rowCount).toBe(1);
    } finally {
      await deleteTestTransfers([transferId]);
      await pool.query(
        `DELETE FROM artikli WHERE id=ANY($1::int[])`,
        [[sourceArticle.rows[0].id, targetArticle.rows[0].id]],
      );
    }
  });

  it("DB zavrne nov zalogovni premik brez izvora tudi, ko ima akterja", async () => {
    const article = await pool.query(
      `SELECT id FROM artikli WHERE enota_id=$1 ORDER BY id LIMIT 1`,
      [ids.sourceUnitId],
    );
    await expect(pool.query(
      `INSERT INTO zaloga_gibi (artikel_id, tip, kolicina, actor_snapshot)
       VALUES ($1,'poraba',-1,'actor-only-test')`,
      [article.rows[0].id],
    )).rejects.toMatchObject({
      constraint: "zaloga_gibi_insert_snapshot_required",
    });
  });

  it("DB ne dovoli spremembe že zapolnjenih snapshotov premika", async () => {
    const article = await pool.query(
      `SELECT id FROM artikli WHERE enota_id=$1 ORDER BY id LIMIT 1`,
      [ids.sourceUnitId],
    );
    const movement = await pool.query(
      `INSERT INTO zaloga_gibi (
         artikel_id, tip, kolicina, actor_snapshot, source_snapshot
       ) VALUES ($1,'poraba',-1,'actor-a','source-a')
       RETURNING id`,
      [article.rows[0].id],
    );
    const movementId = movement.rows[0].id;
    try {
      await expect(pool.query(
        `UPDATE zaloga_gibi SET actor_snapshot='actor-b' WHERE id=$1`,
        [movementId],
      )).rejects.toMatchObject({
        constraint: "zaloga_gibi_history_append_only",
      });
      await expect(pool.query(
        `UPDATE zaloga_gibi SET source_snapshot='source-b' WHERE id=$1`,
        [movementId],
      )).rejects.toMatchObject({
        constraint: "zaloga_gibi_history_append_only",
      });
      await expect(pool.query(
        `UPDATE zaloga_gibi SET kolicina=-2 WHERE id=$1`,
        [movementId],
      )).rejects.toMatchObject({
        constraint: "zaloga_gibi_history_append_only",
      });
      await expect(pool.query(
        `DELETE FROM zaloga_gibi WHERE id=$1`,
        [movementId],
      )).rejects.toMatchObject({
        constraint: "zaloga_gibi_history_append_only",
      });
    } finally {
      const cleanup = await pool.connect();
      try {
        await cleanup.query("BEGIN");
        await cleanup.query(`SET LOCAL app.allow_stock_movement_cleanup = 'on'`);
        await cleanup.query(`DELETE FROM zaloga_gibi WHERE id=$1`, [movementId]);
        await cleanup.query("COMMIT");
      } finally {
        await cleanup.query("ROLLBACK");
        cleanup.release();
      }
    }
  });

  it("DB ne dovoli naknadnega pripisa akterja ali izvora legacy premiku", async () => {
    const article = await pool.query(
      `SELECT id FROM artikli WHERE enota_id=$1 ORDER BY id LIMIT 1`,
      [ids.sourceUnitId],
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("LOCK TABLE zaloga_gibi IN ACCESS EXCLUSIVE MODE");
      await client.query("ALTER TABLE zaloga_gibi DISABLE TRIGGER zaloga_gibi_insert_snapshot_required");
      await client.query("ALTER TABLE zaloga_gibi DISABLE TRIGGER zaloga_gibi_history_append_only");
      const legacy = await client.query(
        `INSERT INTO zaloga_gibi (artikel_id, tip, kolicina)
         VALUES ($1,'poraba',-1)
         RETURNING id`,
        [article.rows[0].id],
      );
      await client.query("ALTER TABLE zaloga_gibi ENABLE TRIGGER zaloga_gibi_insert_snapshot_required");
      await client.query("ALTER TABLE zaloga_gibi ENABLE TRIGGER zaloga_gibi_history_append_only");

      await client.query("SAVEPOINT legacy_actor_update");
      await expect(client.query(
        `UPDATE zaloga_gibi SET actor_snapshot='naknadni-akter' WHERE id=$1`,
        [legacy.rows[0].id],
      )).rejects.toMatchObject({
        constraint: "zaloga_gibi_history_append_only",
      });
      await client.query("ROLLBACK TO SAVEPOINT legacy_actor_update");

      await client.query("SAVEPOINT legacy_source_update");
      await expect(client.query(
        `UPDATE zaloga_gibi SET source_snapshot='naknadni-izvor' WHERE id=$1`,
        [legacy.rows[0].id],
      )).rejects.toMatchObject({
        constraint: "zaloga_gibi_history_append_only",
      });
      await client.query("ROLLBACK TO SAVEPOINT legacy_source_update");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("ponovni reconciliation ohrani prvotni gib in njegovega akterja", async () => {
    const article = await pool.query(
      `SELECT id FROM artikli WHERE enota_id=$1 ORDER BY id LIMIT 1`,
      [ids.sourceUnitId],
    );
    const referenceId = 900_000_000 + Number(article.rows[0].id);
    const original = await pool.query(
      `INSERT INTO zaloga_gibi (
         artikel_id, tip, kolicina, cena_kos, vrednost, referenca_id,
         actor_snapshot, source_snapshot
       ) VALUES ($1,'prejemnica',3,2,6,$2,'uvoznik-a','uvoz-prejemnica')
       RETURNING id`,
      [article.rows[0].id, referenceId],
    );
    try {
      await appendStockMovementReversals(db, {
        referenceId,
        sourceSnapshots: ["uvoz-prejemnica"],
        actorSnapshot: "uvoznik-b",
        reversalSourceSnapshot: "uvoz-prejemnica_reversal",
        note: "Testna prva uskladitev",
      });
      const replacement = await pool.query(
        `INSERT INTO zaloga_gibi (
           artikel_id, tip, kolicina, cena_kos, vrednost, referenca_id,
           actor_snapshot, source_snapshot
         ) VALUES ($1,'prejemnica',4,2,8,$2,'uvoznik-b','uvoz-prejemnica')
         RETURNING id`,
        [article.rows[0].id, referenceId],
      );
      await appendStockMovementReversals(db, {
        referenceId,
        sourceSnapshots: ["uvoz-prejemnica"],
        actorSnapshot: "uvoznik-c",
        reversalSourceSnapshot: "uvoz-prejemnica_reversal",
        note: "Testna druga uskladitev",
      });

      const history = await pool.query(
        `SELECT id, actor_snapshot, source_snapshot, reversal_of_id
         FROM zaloga_gibi WHERE referenca_id=$1 ORDER BY id`,
        [referenceId],
      );
      expect(history.rows).toHaveLength(4);
      expect(history.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: original.rows[0].id, actor_snapshot: "uvoznik-a", reversal_of_id: null }),
        expect.objectContaining({ id: replacement.rows[0].id, actor_snapshot: "uvoznik-b", reversal_of_id: null }),
        expect.objectContaining({ actor_snapshot: "uvoznik-b", reversal_of_id: original.rows[0].id }),
        expect.objectContaining({ actor_snapshot: "uvoznik-c", reversal_of_id: replacement.rows[0].id }),
      ]));
    } finally {
      const cleanup = await pool.connect();
      try {
        await cleanup.query("BEGIN");
        await cleanup.query(`SET LOCAL app.allow_stock_movement_cleanup = 'on'`);
        await cleanup.query(`DELETE FROM zaloga_gibi WHERE referenca_id=$1`, [referenceId]);
        await cleanup.query("COMMIT");
      } finally {
        await cleanup.query("ROLLBACK");
        cleanup.release();
      }
    }
  });

  it("legacy prejem brez source snapshota se izravna natanko enkrat brez pripisa provenance", async () => {
    const article = await pool.query(
      `SELECT id FROM artikli WHERE enota_id=$1 ORDER BY id LIMIT 1`,
      [ids.sourceUnitId],
    );
    const referenceId = 910_000_000 + Number(article.rows[0].id);
    const setup = await pool.connect();
    let originalId = 0;
    try {
      await setup.query("BEGIN");
      await setup.query("LOCK TABLE zaloga_gibi IN ACCESS EXCLUSIVE MODE");
      await setup.query("ALTER TABLE zaloga_gibi DISABLE TRIGGER zaloga_gibi_insert_snapshot_required");
      const original = await setup.query(
        `INSERT INTO zaloga_gibi (
           artikel_id, tip, kolicina, cena_kos, vrednost, referenca_id,
           actor_snapshot, source_snapshot, effective_at_snapshot
         ) VALUES ($1,'prejemnica',5,2,10,$2,NULL,NULL,'2025-01-01')
         RETURNING id`,
        [article.rows[0].id, referenceId],
      );
      originalId = original.rows[0].id;
      await setup.query("ALTER TABLE zaloga_gibi ENABLE TRIGGER zaloga_gibi_insert_snapshot_required");
      await setup.query("COMMIT");
    } finally {
      await setup.query("ROLLBACK");
      setup.release();
    }

    try {
      const reverse = () => appendStockMovementReversals(db, {
        referenceId,
        sourceSnapshots: ["prejemnica"],
        actorSnapshot: "legacy-editor",
        reversalSourceSnapshot: "prejemnica_reversal",
        note: "Legacy testna izravnava",
        legacyKind: "prejemnica",
      });
      await reverse();
      await reverse();

      const history = await pool.query(
        `SELECT id, source_snapshot, actor_snapshot, reversal_of_id, kolicina, vrednost
         FROM zaloga_gibi WHERE referenca_id=$1 ORDER BY id`,
        [referenceId],
      );
      expect(history.rows).toHaveLength(2);
      expect(history.rows[0]).toMatchObject({
        id: originalId,
        source_snapshot: null,
        actor_snapshot: null,
        reversal_of_id: null,
        kolicina: "5.0000",
        vrednost: "10.0000",
      });
      expect(history.rows[1]).toMatchObject({
        source_snapshot: "prejemnica_reversal",
        actor_snapshot: "legacy-editor",
        reversal_of_id: originalId,
        kolicina: "-5.0000",
        vrednost: "-10.0000",
      });
    } finally {
      const cleanup = await pool.connect();
      try {
        await cleanup.query("BEGIN");
        await cleanup.query(`SET LOCAL app.allow_stock_movement_cleanup = 'on'`);
        await cleanup.query(`DELETE FROM zaloga_gibi WHERE referenca_id=$1`, [referenceId]);
        await cleanup.query("COMMIT");
      } finally {
        await cleanup.query("ROLLBACK");
        cleanup.release();
      }
    }
  });

  it("DB zavrne commit osnutka z gibi in dovoli atomski zaključek", async () => {
    const sourceArticle = await pool.query(
      `INSERT INTO artikli (enota_id, ime, cena, nabavni_artikel, prodajni_artikel)
       VALUES ($1,$2,1,true,false) RETURNING id`,
      [ids.sourceUnitId, `Vir deferred osnutka ${suffix}`],
    );
    const targetArticle = await pool.query(
      `INSERT INTO artikli (enota_id, ime, cena, nabavni_artikel, prodajni_artikel)
       VALUES ($1,$2,1,true,false) RETURNING id`,
      [ids.targetUnitId, `Cilj deferred osnutka ${suffix}`],
    );
    const sourceArticleId = sourceArticle.rows[0].id as number;
    const targetArticleId = targetArticle.rows[0].id as number;
    const transfer = await pool.query(
      `INSERT INTO pos_stock_transfers (
         company_id, event_id, source_unit_id, target_unit_id,
         direction, status, created_by
       ) VALUES ($1,$2,$3,$4,'outbound','draft','deferred-draft-test')
       RETURNING id`,
      [ids.companyId, ids.eventId, ids.sourceUnitId, ids.targetUnitId],
    );
    const transferId = transfer.rows[0].id as number;
    await pool.query(
      `INSERT INTO pos_stock_transfer_lines (
         company_id, transfer_id, source_unit_id, target_unit_id,
         source_article_id, target_article_id, quantity, unit_cost
       ) VALUES ($1,$2,$3,$4,$5,$6,2,3)`,
      [
        ids.companyId, transferId, ids.sourceUnitId, ids.targetUnitId,
        sourceArticleId, targetArticleId,
      ],
    );
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const transientMovement = await client.query(
        `INSERT INTO zaloga_gibi (
           artikel_id, tip, kolicina, cena_kos, vrednost,
           referenca_id, event_transfer_id, source_snapshot
         ) VALUES ($1,'event_transfer_out',-2,3,-6,$2,$2,'test_fixture')
         RETURNING id`,
        [sourceArticleId, transferId],
      );
      await client.query(`SET LOCAL app.allow_stock_movement_cleanup = 'on'`);
      await client.query(
        `DELETE FROM zaloga_gibi WHERE id=$1`,
        [transientMovement.rows[0].id],
      );
      await client.query("COMMIT");

      await client.query("BEGIN");
      await client.query(
        `INSERT INTO zaloga_gibi (
           artikel_id, tip, kolicina, cena_kos, vrednost,
           referenca_id, event_transfer_id, source_snapshot
         ) VALUES ($1,'event_transfer_out',-2,3,-6,$2,$2,'test_fixture')`,
        [sourceArticleId, transferId],
      );
      await expect(client.query("COMMIT")).rejects.toMatchObject({
        constraint: "zaloga_gibi_no_committed_draft_transfer",
      });
      await client.query("ROLLBACK");

      const rolledBack = await pool.query(
        `SELECT pst.status, count(zg.id)::int AS movements
         FROM pos_stock_transfers pst
         LEFT JOIN zaloga_gibi zg ON zg.event_transfer_id=pst.id
         WHERE pst.id=$1
         GROUP BY pst.status`,
        [transferId],
      );
      expect(rolledBack.rows[0]).toEqual({ status: "draft", movements: 0 });

      await client.query("BEGIN");
      await client.query(
        `INSERT INTO zaloga_gibi (
           artikel_id, tip, kolicina, cena_kos, vrednost,
           referenca_id, event_transfer_id, source_snapshot
         ) VALUES
           ($1,'event_transfer_out',-2,3,-6,$3,$3,'test_fixture'),
           ($2,'event_transfer_in',2,3,6,$3,$3,'test_fixture')`,
        [sourceArticleId, targetArticleId, transferId],
      );
      await client.query(
        `UPDATE pos_stock_transfers
         SET status='completed', completed_at=now()
         WHERE id=$1`,
        [transferId],
      );
      await client.query("COMMIT");

      const completed = await pool.query(
        `SELECT pst.status, count(zg.id)::int AS movements
         FROM pos_stock_transfers pst
         JOIN zaloga_gibi zg ON zg.event_transfer_id=pst.id
         WHERE pst.id=$1
         GROUP BY pst.status`,
        [transferId],
      );
      expect(completed.rows[0]).toEqual({ status: "completed", movements: 2 });
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await deleteTestTransfers([transferId]);
      await pool.query(
        `DELETE FROM artikli WHERE id=ANY($1::int[])`,
        [[sourceArticleId, targetArticleId]],
      );
    }
  });

  it("DB omeji dovoljenje na dogodek, API pa ga z obdobjem premakne atomsko", async () => {
    const eventPeriod = await pool.query(
      `SELECT starts_at, ends_at FROM pos_events WHERE id=$1`,
      [ids.eventId],
    );
    const originalStartsAt = eventPeriod.rows[0].starts_at as Date;
    const originalEndsAt = eventPeriod.rows[0].ends_at as Date;
    const user = await pool.query(
      `INSERT INTO pos_uporabniki (
         clerk_user_id, company_id, enota_id, vloga, ime, priimek
       ) VALUES ($1,$2,$3,'uporabnik','Časovni','Test') RETURNING id`,
      [`staff-period-${suffix}`, ids.companyId, ids.sourceUnitId],
    );
    const userId = user.rows[0].id as number;
    const insertGrantSql = `INSERT INTO pos_event_staff_grants (
      company_id, event_id, pos_user_id, unit_id, valid_from, valid_to
    ) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`;

    try {
      await expect(pool.query(insertGrantSql, [
        ids.companyId, ids.eventId, userId, ids.targetUnitId,
        originalEndsAt, originalStartsAt,
      ])).rejects.toMatchObject({ constraint: "pos_event_staff_period_order_check" });

      await expect(pool.query(insertGrantSql, [
        ids.companyId, ids.eventId, userId, ids.targetUnitId,
        new Date(originalStartsAt.getTime() - 60_000), originalEndsAt,
      ])).rejects.toMatchObject({ constraint: "pos_event_staff_within_event_check" });

      await expect(pool.query(insertGrantSql, [
        ids.companyId, ids.eventId, userId, ids.targetUnitId,
        originalStartsAt, new Date(originalEndsAt.getTime() + 60_000),
      ])).rejects.toMatchObject({ constraint: "pos_event_staff_within_event_check" });

      const validGrant = await pool.query(
        `INSERT INTO pos_event_staff_grants (
           company_id, event_id, pos_user_id, unit_id, valid_from, valid_to
         )
         SELECT company_id, id, $2, $3, starts_at, ends_at
         FROM pos_events
         WHERE id=$1
         RETURNING id`,
        [ids.eventId, userId, ids.targetUnitId],
      );
      expect(validGrant.rowCount).toBe(1);

      await expect(pool.query(
        `UPDATE pos_events
         SET starts_at=starts_at+interval '5 minutes',
             ends_at=ends_at-interval '5 minutes'
         WHERE id=$1`,
        [ids.eventId],
      )).rejects.toMatchObject({ constraint: "pos_event_staff_within_event_check" });

      const shiftedStartsAt = new Date(originalStartsAt.getTime() + 5 * 60_000);
      const shiftedEndsAt = new Date(originalEndsAt.getTime() - 5 * 60_000);
      const shifted = await request(app).patch(`/api/pos-events/${ids.eventId}`).send({
        startsAt: shiftedStartsAt.toISOString(),
        endsAt: shiftedEndsAt.toISOString(),
      });
      expect(shifted.status).toBe(200);
      const shiftedGrant = await pool.query(
        `SELECT valid_from, valid_to FROM pos_event_staff_grants WHERE id=$1`,
        [validGrant.rows[0].id],
      );
      expect(shiftedGrant.rows[0].valid_from.toISOString()).toBe(shiftedStartsAt.toISOString());
      expect(shiftedGrant.rows[0].valid_to.toISOString()).toBe(shiftedEndsAt.toISOString());
    } finally {
      await pool.query(
        `DELETE FROM pos_event_staff_grants WHERE event_id=$1 AND pos_user_id=$2`,
        [ids.eventId, userId],
      );
      await pool.query(
        `UPDATE pos_events SET starts_at=$1, ends_at=$2 WHERE id=$3`,
        [originalStartsAt, originalEndsAt, ids.eventId],
      );
      await pool.query(`DELETE FROM pos_uporabniki WHERE id=$1`, [userId]);
    }
  });

  it("preklic in predčasni zaključek takoj in nepovratno revocirata dostop osebja", async () => {
    const users = await pool.query(
      `INSERT INTO pos_uporabniki (
         clerk_user_id, company_id, enota_id, vloga, ime, priimek
       ) VALUES
         ($1,$3,$4,'uporabnik','Statusni','Prvi'),
         ($2,$3,$4,'uporabnik','Statusni','Drugi')
       RETURNING id`,
      [`status-first-${suffix}`, `status-second-${suffix}`, ids.companyId, ids.sourceUnitId],
    );
    const [firstUserId, secondUserId] = users.rows.map(row => row.id as number);
    const events = await pool.query(
      `INSERT INTO pos_events (
         company_id, enota_id, name, type, status, location, starts_at, ends_at
       ) VALUES
         ($1,$2,$3,'other','planned','Statusna lokacija',now(),now()+interval '4 hours'),
         ($1,$2,$4,'other','active','Statusna lokacija',now(),now()+interval '4 hours')
       RETURNING id`,
      [
        ids.companyId,
        ids.sourceUnitId,
        `Dogodek za preklic ${suffix}`,
        `Dogodek za zaključek ${suffix}`,
      ],
    );
    const [cancelEventId, closeEventId] = events.rows.map(row => row.id as number);
    const insertGrantFromEvent = async (eventId: number, userId: number) => pool.query(
      `INSERT INTO pos_event_staff_grants (
         company_id, event_id, pos_user_id, unit_id, valid_from, valid_to
       )
       SELECT company_id, id, $2, $3, starts_at, ends_at
       FROM pos_events
       WHERE id=$1
       RETURNING id`,
      [eventId, userId, ids.targetUnitId],
    );

    try {
      const cancelGrant = await insertGrantFromEvent(cancelEventId, firstUserId);
      const cancelled = await request(app)
        .patch(`/api/pos-events/${cancelEventId}`)
        .send({ status: "cancelled" });
      expect(cancelled.status).toBe(200);
      const cancelledGrant = await pool.query(
        `SELECT revoked FROM pos_event_staff_grants WHERE id=$1`,
        [cancelGrant.rows[0].id],
      );
      expect(cancelledGrant.rows[0].revoked).toBe(true);

      await expect(pool.query(
        `UPDATE pos_event_staff_grants SET revoked=false WHERE id=$1`,
        [cancelGrant.rows[0].id],
      )).rejects.toMatchObject({ constraint: "pos_event_staff_active_status_check" });
      await expect(insertGrantFromEvent(cancelEventId, secondUserId))
        .rejects.toMatchObject({ constraint: "pos_event_staff_active_status_check" });

      const reopen = await request(app)
        .patch(`/api/pos-events/${cancelEventId}`)
        .send({ status: "planned" });
      expect(reopen.status).toBe(409);
      const stillRevoked = await pool.query(
        `SELECT revoked FROM pos_event_staff_grants WHERE id=$1`,
        [cancelGrant.rows[0].id],
      );
      expect(stillRevoked.rows[0].revoked).toBe(true);

      const closeGrant = await insertGrantFromEvent(closeEventId, firstUserId);
      await expect(pool.query(
        `UPDATE pos_events SET status='closed' WHERE id=$1`,
        [closeEventId],
      )).rejects.toMatchObject({ constraint: "pos_event_staff_active_status_check" });

      const closed = await request(app)
        .patch(`/api/pos-events/${closeEventId}`)
        .send({ status: "closed" });
      expect(closed.status).toBe(200);
      const closedGrant = await pool.query(
        `SELECT revoked FROM pos_event_staff_grants WHERE id=$1`,
        [closeGrant.rows[0].id],
      );
      expect(closedGrant.rows[0].revoked).toBe(true);
    } finally {
      await pool.query(`DELETE FROM pos_events WHERE id=ANY($1::int[])`, [[cancelEventId, closeEventId]]);
      await pool.query(`DELETE FROM pos_uporabniki WHERE id=ANY($1::int[])`, [[firstUserId, secondUserId]]);
    }
  });

  it("DB prepreči mešanje menija, osebja in zaloge med podjetji", async () => {
    const sourceArticles = await pool.query(
      `SELECT id FROM artikli WHERE enota_id=$1 ORDER BY id`,
      [ids.sourceUnitId],
    );
    const sourceArticleId = sourceArticles.rows[0].id as number;
    const localTarget = await pool.query(
      `INSERT INTO enote (company_id, ime) VALUES ($1,$2) RETURNING id`,
      [ids.companyId, `Cilj integritete ${suffix}`],
    );
    const localTargetId = localTarget.rows[0].id as number;
    const localTargetArticle = await pool.query(
      `INSERT INTO artikli (enota_id, ime, cena) VALUES ($1,$2,1) RETURNING id`,
      [localTargetId, `Ciljni artikel integritete ${suffix}`],
    );
    const localTargetArticleId = localTargetArticle.rows[0].id as number;
    const localUser = await pool.query(
      `INSERT INTO pos_uporabniki (
         clerk_user_id, company_id, enota_id, vloga, ime, priimek
       ) VALUES ($1,$2,$3,'uporabnik','Lokalni','Test') RETURNING id`,
      [`local-integrity-${suffix}`, ids.companyId, ids.sourceUnitId],
    );
    const localUserId = localUser.rows[0].id as number;
    const foreignCompany = await pool.query(
      `INSERT INTO companies (podjetje_davcna, naziv) VALUES ($1,$2) RETURNING id`,
      [`I${suffix.slice(-8)}`, `Tuje podjetje integritete ${suffix}`],
    );
    const foreignCompanyId = foreignCompany.rows[0].id as string;

    try {
      const foreignUnits = await pool.query(
        `INSERT INTO enote (company_id, ime)
         VALUES ($1,$2),($1,$3) RETURNING id`,
        [foreignCompanyId, `Tuja enota A ${suffix}`, `Tuja enota B ${suffix}`],
      );
      const [foreignUnitId, foreignUnit2Id] = foreignUnits.rows.map(row => row.id as number);
      const foreignArticle = await pool.query(
        `INSERT INTO artikli (enota_id, ime, cena) VALUES ($1,$2,1) RETURNING id`,
        [foreignUnitId, `Tuji artikel ${suffix}`],
      );
      const foreignArticleId = foreignArticle.rows[0].id as number;
      const foreignUser = await pool.query(
        `INSERT INTO pos_uporabniki (
           clerk_user_id, company_id, enota_id, vloga, ime, priimek
         ) VALUES ($1,$2,$3,'uporabnik','Tuji','Test') RETURNING id`,
        [`foreign-integrity-${suffix}`, foreignCompanyId, foreignUnitId],
      );
      const foreignUserId = foreignUser.rows[0].id as number;
      const foreignEvent = await pool.query(
        `INSERT INTO pos_events (
           company_id, enota_id, name, type, location, starts_at, ends_at
         ) VALUES ($1,$2,$3,'other','Tuja lokacija',now(),now()+interval '1 hour')
         RETURNING id`,
        [foreignCompanyId, foreignUnitId, `Tuji dogodek ${suffix}`],
      );
      const foreignTransfer = await pool.query(
        `INSERT INTO pos_stock_transfers (
           company_id, event_id, source_unit_id, target_unit_id,
           direction, status, created_by
         ) VALUES ($1,$2,$3,$4,'outbound','draft','test') RETURNING id`,
        [foreignCompanyId, foreignEvent.rows[0].id, foreignUnitId, foreignUnit2Id],
      );

      const menuSql = `INSERT INTO pos_event_menu_items (
        company_id, event_id, source_unit_id, target_unit_id,
        source_article_id, target_article_id
      ) VALUES ($1,$2,$3,$4,$5,$6)`;
      await expect(pool.query(menuSql, [
        ids.companyId, ids.eventId, ids.sourceUnitId, localTargetId,
        foreignArticleId, localTargetArticleId,
      ])).rejects.toMatchObject({ constraint: "pos_event_menu_source_article_unit_fk" });
      await expect(pool.query(menuSql, [
        ids.companyId, ids.eventId, ids.sourceUnitId, localTargetId,
        sourceArticleId, foreignArticleId,
      ])).rejects.toMatchObject({ constraint: "pos_event_menu_target_article_unit_fk" });

      const staffSql = `INSERT INTO pos_event_staff_grants (
        company_id, event_id, pos_user_id, unit_id, valid_from, valid_to
      ) VALUES ($1,$2,$3,$4,now(),now()+interval '1 hour')`;
      await expect(pool.query(staffSql, [
        ids.companyId, ids.eventId, foreignUserId, localTargetId,
      ])).rejects.toMatchObject({ constraint: "pos_event_staff_user_company_fk" });
      await expect(pool.query(staffSql, [
        ids.companyId, ids.eventId, localUserId, foreignUnitId,
      ])).rejects.toMatchObject({ constraint: "pos_event_staff_unit_company_fk" });

      const transferSql = `INSERT INTO pos_stock_transfers (
        company_id, event_id, source_unit_id, target_unit_id,
        direction, status, return_of_id, created_by
      ) VALUES ($1,$2,$3,$4,$5,'draft',$6,'test')`;
      await expect(pool.query(transferSql, [
        ids.companyId, ids.eventId, foreignUnitId, localTargetId, "outbound", null,
      ])).rejects.toMatchObject({ constraint: "pos_stock_transfers_source_unit_company_fk" });
      await expect(pool.query(transferSql, [
        ids.companyId, ids.eventId, ids.sourceUnitId, foreignUnitId, "outbound", null,
      ])).rejects.toMatchObject({ constraint: "pos_stock_transfers_target_unit_company_fk" });
      await expect(pool.query(transferSql, [
        ids.companyId, ids.eventId, localTargetId, ids.sourceUnitId,
        "return", foreignTransfer.rows[0].id,
      ])).rejects.toMatchObject({ constraint: "pos_stock_transfers_return_company_fk" });

      const validMenu = await pool.query(menuSql, [
        ids.companyId, ids.eventId, ids.sourceUnitId, localTargetId,
        sourceArticleId, localTargetArticleId,
      ]);
      const validStaff = await pool.query(staffSql, [
        ids.companyId, ids.eventId, localUserId, localTargetId,
      ]);
      const validTransfer = await pool.query(
        `${transferSql} RETURNING id`,
        [ids.companyId, ids.eventId, ids.sourceUnitId, localTargetId, "outbound", null],
      );
      expect([validMenu.rowCount, validStaff.rowCount, validTransfer.rowCount]).toEqual([1, 1, 1]);

      const lineSql = `INSERT INTO pos_stock_transfer_lines (
        company_id, transfer_id, source_unit_id, target_unit_id,
        source_article_id, target_article_id, quantity, unit_cost
      ) VALUES ($1,$2,$3,$4,$5,$6,1,1)`;
      await expect(pool.query(lineSql, [
        foreignCompanyId, validTransfer.rows[0].id, ids.sourceUnitId, localTargetId,
        sourceArticleId, localTargetArticleId,
      ])).rejects.toMatchObject({ constraint: "pos_stock_transfer_lines_transfer_scope_fk" });
      await expect(pool.query(lineSql, [
        ids.companyId, validTransfer.rows[0].id, ids.sourceUnitId, localTargetId,
        foreignArticleId, localTargetArticleId,
      ])).rejects.toMatchObject({ constraint: "pos_stock_transfer_lines_source_article_unit_fk" });
      await expect(pool.query(lineSql, [
        ids.companyId, validTransfer.rows[0].id, ids.sourceUnitId, localTargetId,
        sourceArticleId, foreignArticleId,
      ])).rejects.toMatchObject({ constraint: "pos_stock_transfer_lines_target_article_unit_fk" });
      const validLine = await pool.query(lineSql, [
        ids.companyId, validTransfer.rows[0].id, ids.sourceUnitId, localTargetId,
        sourceArticleId, localTargetArticleId,
      ]);
      expect(validLine.rowCount).toBe(1);
    } finally {
      await pool.query(`DELETE FROM pos_stock_transfers WHERE company_id=$1`, [ids.companyId]);
      await pool.query(`DELETE FROM pos_event_menu_items WHERE target_unit_id=$1`, [localTargetId]);
      await pool.query(`DELETE FROM pos_event_staff_grants WHERE unit_id=$1`, [localTargetId]);
      await pool.query(`DELETE FROM pos_uporabniki WHERE id=$1`, [localUserId]);
      await pool.query(`DELETE FROM enote WHERE id=$1`, [localTargetId]);
      await pool.query(`DELETE FROM pos_stock_transfers WHERE company_id=$1`, [foreignCompanyId]);
      await pool.query(`DELETE FROM companies WHERE id=$1`, [foreignCompanyId]);
    }
  });

  it("sinhronizira celotno obdobje ter ob odstranitvi povezave počisti začasno enoto", async () => {
    const startsAt = "2026-07-10T08:00:00.000Z";
    const endsAt = "2026-07-11T02:00:00.000Z";
    const syncUnit = await pool.query(
      `INSERT INTO enote (
         company_id, ime, is_temporary, parent_unit_id, active_from, active_to
       ) VALUES ($1, $2, true, $3, $4, $5)
       RETURNING id`,
      [ids.companyId, `Začasna sinhronizacija ${suffix}`, ids.sourceUnitId, startsAt, endsAt],
    );
    const syncUnitId = syncUnit.rows[0].id as number;
    const created = await request(app).post("/api/pos-events").send({
      name: `Poletni dogodek ${suffix}`,
      type: "festival",
      location: "Glavni trg",
      startsAt,
      endsAt,
      linkedUnitIds: [syncUnitId],
    });
    expect(created.status).toBe(201);
    const createdEventId = created.body.id as number;

    let unit = await pool.query(
      `SELECT is_temporary, parent_unit_id, active_from, active_to, temporary_location FROM enote WHERE id=$1`,
      [syncUnitId],
    );
    expect(unit.rows[0]).toMatchObject({
      parent_unit_id: ids.sourceUnitId,
      temporary_location: "Glavni trg",
    });
    expect(unit.rows[0].active_from.toISOString()).toBe(startsAt);
    expect(unit.rows[0].active_to.toISOString()).toBe(endsAt);

    const movedEndsAt = "2026-07-12T02:00:00.000Z";
    const moved = await request(app).patch(`/api/pos-events/${createdEventId}`).send({
      endsAt: movedEndsAt,
      location: "Novi trg",
    });
    expect(moved.status).toBe(200);
    unit = await pool.query(
      `SELECT active_to, temporary_location FROM enote WHERE id=$1`,
      [syncUnitId],
    );
    expect(unit.rows[0].active_to.toISOString()).toBe(movedEndsAt);
    expect(unit.rows[0].temporary_location).toBe("Novi trg");

    const detached = await request(app).patch(`/api/pos-events/${createdEventId}`).send({
      linkedUnitIds: [],
    });
    expect(detached.status).toBe(200);
    unit = await pool.query(
      `SELECT is_temporary, parent_unit_id, active_from, active_to, temporary_location FROM enote WHERE id=$1`,
      [syncUnitId],
    );
    expect(unit.rows[0]).toEqual({
      is_temporary: false,
      parent_unit_id: null,
      active_from: null,
      active_to: null,
      temporary_location: null,
    });

    const deleted = await request(app).delete(`/api/pos-events/${createdEventId}`);
    expect(deleted.status).toBe(204);
  });

  it("predogleda, pripravi, zaključi in vrne sledljivo zalogo", async () => {
    const articles = await pool.query(
      `SELECT id, ime
       FROM artikli
       WHERE enota_id=$1 AND ime IN ($2, $3)
       ORDER BY id`,
      [ids.sourceUnitId, `Sestavina ${suffix}`, `Jed ${suffix}`],
    );
    const ingredientId = articles.rows.find(row => row.ime.startsWith("Sestavina")).id;
    const articleIds = articles.rows.map(row => row.id);
    const payload = {
      targetUnitId: ids.targetUnitId,
      articleIds,
      staffUserIds: [],
      quantities: { [ingredientId]: 2 },
    };

    const preview = await request(app).post(`/api/pos-events/${ids.eventId}/preparation-preview`).send(payload);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      canPrepare: true,
      counts: { articles: 2, norms: 1, modifierGroups: 1, modifiers: 1, modifierNorms: 1 },
      stockTotalQuantity: 2,
      stockTotalValue: 4,
      warnings: [],
    });

    const prepared = await request(app).post(`/api/pos-events/${ids.eventId}/prepare`).send(payload);
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(200);
    expect(prepared.body).toMatchObject({ reused: false, copiedArticles: 2 });
    const preparedMovementSnapshots = await pool.query(
      `SELECT zg.actor_snapshot, zg.source_snapshot
       FROM zaloga_gibi zg
       JOIN pos_stock_transfers pst ON pst.id=zg.event_transfer_id
       WHERE pst.event_id=$1 AND pst.direction='outbound'
       ORDER BY zg.id`,
      [ids.eventId],
    );
    expect(preparedMovementSnapshots.rows).toHaveLength(2);
    expect(preparedMovementSnapshots.rows).toEqual([
      {
        actor_snapshot: `event-integration-${suffix}`,
        source_snapshot: "pos_event_transfer",
      },
      {
        actor_snapshot: `event-integration-${suffix}`,
        source_snapshot: "pos_event_transfer",
      },
    ]);

    const copied = await pool.query(
      `SELECT
        (SELECT count(*)::int FROM artikli WHERE enota_id=$1) articles,
        (SELECT count(*)::int FROM modifikatorske_skupine WHERE enota_id=$1) groups,
        (SELECT count(*)::int FROM normativi n JOIN artikli a ON a.id=n.artikel_id WHERE a.enota_id=$1) norms,
        (SELECT count(*)::int FROM artikli_modifikatorske_skupine ams JOIN artikli a ON a.id=ams.artikel_id WHERE a.enota_id=$1) bindings,
        (SELECT count(*)::int FROM modifikatorji m JOIN modifikatorske_skupine ms ON ms.id=m.skupina_id WHERE ms.enota_id=$1) modifiers,
        (SELECT count(*)::int FROM modifikator_normativi mn JOIN modifikatorji m ON m.id=mn.modifikator_id JOIN modifikatorske_skupine ms ON ms.id=m.skupina_id WHERE ms.enota_id=$1) modifier_norms,
        (SELECT count(*)::int FROM normativi n JOIN artikli a ON a.id=n.artikel_id JOIN artikli i ON i.id=n.vhodni_artikel_id WHERE a.enota_id=$1 AND i.enota_id=$1) mapped_norms,
        (SELECT count(*)::int FROM modifikator_normativi mn JOIN modifikatorji m ON m.id=mn.modifikator_id JOIN modifikatorske_skupine ms ON ms.id=m.skupina_id JOIN artikli i ON i.id=mn.vhodni_artikel_id WHERE ms.enota_id=$1 AND i.enota_id=$1) mapped_modifier_norms`,
      [ids.targetUnitId],
    );
    expect(copied.rows[0]).toEqual({
      articles: 2, groups: 1, norms: 1, bindings: 1, modifiers: 1,
      modifier_norms: 1, mapped_norms: 1, mapped_modifier_norms: 1,
    });

    const outboundHistory = await request(app).get(`/api/pos-events/${ids.eventId}/transfer-history`);
    expect(outboundHistory.status).toBe(200);
    expect(outboundHistory.body).toHaveLength(1);
    expect(outboundHistory.body[0]).toMatchObject({ direction: "outbound", status: "completed", totalQuantity: 2, totalValue: 4 });

    const targetIngredient = await pool.query(
      `SELECT a.id FROM pos_event_menu_items em
       JOIN artikli a ON a.id=em.target_article_id
       WHERE em.event_id=$1 AND em.source_article_id=$2`,
      [ids.eventId, ingredientId],
    );
    await pool.query(
      `INSERT INTO zaloga_gibi (
         artikel_id, tip, kolicina, cena_kos, vrednost, opomba, source_snapshot
       ) VALUES ($1,'poraba',-1,2,-2,$2,'test_fixture')`,
      [targetIngredient.rows[0].id, `Testna poraba ${suffix}`],
    );
    await pool.query(`UPDATE zaloge SET kolicina=1 WHERE artikel_id=$1`, [targetIngredient.rows[0].id]);
    const consumedHistory = await request(app).get(`/api/pos-events/${ids.eventId}/transfer-history`);
    expect(consumedHistory.body[0].lines[0]).toMatchObject({
      returnedQuantity: 0, remainingQuantity: 1, consumedQuantity: 1,
    });

    const activated = await request(app).patch(`/api/pos-events/${ids.eventId}`).send({ status: "active" });
    expect(activated.status).toBe(200);
    const closed = await request(app).patch(`/api/pos-events/${ids.eventId}`).send({ status: "closed" });
    expect(closed.status).toBe(200);
    const draft = await pool.query(`SELECT id FROM pos_stock_transfers WHERE event_id=$1 AND direction='return'`, [ids.eventId]);
    expect(draft.rowCount).toBe(1);
    ids.returnTransferId = draft.rows[0].id;

    const returned = await request(app).post(`/api/pos-events/${ids.eventId}/returns/${ids.returnTransferId}/confirm`);
    expect(returned.status).toBe(200);
    expect(returned.body).toMatchObject({ reused: false, lines: 1 });

    const finalHistory = await request(app).get(`/api/pos-events/${ids.eventId}/transfer-history`);
    expect(finalHistory.status).toBe(200);
    expect(finalHistory.body).toHaveLength(2);
    expect(finalHistory.body.map((item: { direction: string; status: string }) => [item.direction, item.status]))
      .toEqual([["outbound", "completed"], ["return", "completed"]]);
    expect(finalHistory.body[0].lines[0]).toMatchObject({ returnedQuantity: 1, remainingQuantity: 0, consumedQuantity: 1 });

    const linkedMovements = await pool.query(
      `SELECT count(*)::int AS count
       FROM zaloga_gibi zg
       JOIN pos_stock_transfers pst ON pst.id=zg.event_transfer_id
       WHERE pst.event_id=$1
         AND zg.tip IN (
           'event_transfer_out','event_transfer_in',
           'event_return_out','event_return_in'
         )
         AND zg.event_transfer_id=zg.referenca_id`,
      [ids.eventId],
    );
    expect(linkedMovements.rows[0].count).toBe(4);
  });
});