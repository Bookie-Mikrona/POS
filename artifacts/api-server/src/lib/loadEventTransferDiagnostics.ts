import { pool } from "@workspace/db";
import {
  diagnoseEventTransfers,
  enrichEventTransferViolations,
  summarizeEventTransferViolations,
  type DiagnosticLine,
  type DiagnosticMovement,
  type DiagnosticTransfer,
} from "./eventTransferDiagnostics";

export async function loadEventTransferDiagnostics(
  companyId: string,
  unitId?: number,
) {
  const transfersResult = await pool.query(
    `SELECT
       id,
       event_id AS "eventId",
       direction,
       status,
       source_unit_id AS "sourceUnitId",
       target_unit_id AS "targetUnitId"
     FROM pos_stock_transfers
     WHERE company_id=$1
       AND ($2::int IS NULL OR source_unit_id=$2 OR target_unit_id=$2)
     ORDER BY event_id, id`,
    [companyId, unitId ?? null],
  );
  const transfers = transfersResult.rows as DiagnosticTransfer[];
  const transferIds = transfers.map(transfer => transfer.id);

  const linesResult = await pool.query(
    `SELECT
       id,
       transfer_id AS "transferId",
       source_article_id AS "sourceArticleId",
       target_article_id AS "targetArticleId",
       quantity,
       unit_cost AS "unitCost"
     FROM pos_stock_transfer_lines
     WHERE transfer_id=ANY($1::int[])
     ORDER BY transfer_id, id`,
    [transferIds],
  );
  const movementsResult = await pool.query(
    `SELECT DISTINCT
       zg.id,
       zg.artikel_id AS "articleId",
       zg.tip AS type,
       zg.kolicina AS quantity,
       zg.cena_kos AS "unitCost",
       zg.vrednost AS value,
       zg.referenca_id AS "referenceId",
       zg.event_transfer_id AS "eventTransferId"
     FROM zaloga_gibi zg
     JOIN artikli a ON a.id=zg.artikel_id
     JOIN enote ae ON ae.id=a.enota_id
     LEFT JOIN pos_stock_transfers linked ON linked.id=zg.event_transfer_id
     LEFT JOIN pos_stock_transfers referenced ON referenced.id=zg.referenca_id
     WHERE (
       zg.tip IN (
         'event_transfer_out', 'event_transfer_in',
         'event_return_out', 'event_return_in'
       )
       OR zg.event_transfer_id IS NOT NULL
     )
       AND COALESCE(linked.company_id, referenced.company_id, ae.company_id)=$1
       AND (
         $2::int IS NULL
         OR linked.source_unit_id=$2
         OR linked.target_unit_id=$2
         OR referenced.source_unit_id=$2
         OR referenced.target_unit_id=$2
         OR ae.id=$2
       )
     ORDER BY zg.id`,
    [companyId, unitId ?? null],
  );

  const rawViolations = diagnoseEventTransfers({
    transfers,
    lines: linesResult.rows as DiagnosticLine[],
    movements: movementsResult.rows as DiagnosticMovement[],
  });
  const eventIds = [...new Set(rawViolations.flatMap(
    violation => violation.eventId == null ? [] : [violation.eventId],
  ))];
  const unitIds = [...new Set(rawViolations.flatMap(violation => [
    ...(violation.sourceUnitId == null ? [] : [violation.sourceUnitId]),
    ...(violation.targetUnitId == null ? [] : [violation.targetUnitId]),
  ]))];
  const articleIds = [...new Set(rawViolations.flatMap(violation => [
    ...(violation.expected ? [violation.expected.articleId] : []),
    ...(violation.actual ? [violation.actual.articleId] : []),
  ]))];

  const [eventsResult, unitsResult, articlesResult] = await Promise.all([
    pool.query<{ id: number; name: string }>(
      `SELECT id, name
       FROM pos_events
       WHERE company_id=$1 AND id=ANY($2::int[])`,
      [companyId, eventIds],
    ),
    pool.query<{ id: number; name: string }>(
      `SELECT id, ime AS name
       FROM enote
       WHERE company_id=$1 AND id=ANY($2::int[])`,
      [companyId, unitIds],
    ),
    pool.query<{ id: number; name: string }>(
      `SELECT a.id, a.ime AS name
       FROM artikli a
       JOIN enote e ON e.id=a.enota_id
       WHERE e.company_id=$1 AND a.id=ANY($2::int[])`,
      [companyId, articleIds],
    ),
  ]);
  const violations = enrichEventTransferViolations(rawViolations, {
    events: new Map(eventsResult.rows.map(row => [row.id, row.name])),
    units: new Map(unitsResult.rows.map(row => [row.id, row.name])),
    articles: new Map(articlesResult.rows.map(row => [row.id, row.name])),
    transferIds: new Set(transfers.map(transfer => transfer.id)),
  });

  return {
    generatedAt: new Date().toISOString(),
    scope: { companyId, unitId: unitId ?? null },
    readOnly: true as const,
    checked: {
      transfers: transfers.length,
      lines: linesResult.rowCount ?? 0,
      movements: movementsResult.rowCount ?? 0,
    },
    violationCount: violations.length,
    summary: summarizeEventTransferViolations(violations),
    violations,
  };
}