import { pool } from "@workspace/db";
import {
  compareTransferMovements,
  type DiagnosticLine,
  type DiagnosticMovement,
  type DiagnosticTransfer,
  type TransferMovementComparison,
  type UnexpectedTransferMovement,
} from "./eventTransferDiagnostics";

type EventRow = {
  id: number;
  name: string;
  type: string;
  status: string;
  location: string;
  customerName: string | null;
  startsAt: Date;
  endsAt: Date;
  notes: string | null;
  unitId: number;
  unitName: string;
};

type TransferRow = {
  id: number;
  eventId: number;
  direction: DiagnosticTransfer["direction"];
  status: DiagnosticTransfer["status"];
  sourceUnitId: number;
  sourceUnitName: string;
  targetUnitId: number;
  targetUnitName: string;
  returnOfId: number | null;
  completedAt: Date | null;
  createdAt: Date;
};

type LineRow = {
  id: number;
  transferId: number;
  sourceArticleId: number;
  sourceArticleName: string;
  targetArticleId: number;
  targetArticleName: string;
  quantity: string;
  unitCost: string;
  value: string;
};

type MovementRow = DiagnosticMovement & {
  articleName: string;
};

type MovementDetailRow = {
  id: number;
  articleId: number;
  articleName: string;
  unitId: number;
  unitName: string;
  type: string;
  quantity: string;
  unitCost: string | null;
  value: string | null;
  note: string | null;
  actorSnapshot: string | null;
  sourceSnapshot: string | null;
  referenceId: number | null;
  eventTransferId: number | null;
  createdAt: Date;
  transferId: number | null;
  transferDirection: DiagnosticTransfer["direction"] | null;
  transferStatus: DiagnosticTransfer["status"] | null;
  transferCreatedBy: string | null;
  eventId: number | null;
  eventName: string | null;
};

const enrichMovement = (
  movement: TransferMovementComparison["expected"],
  articleNames: ReadonlyMap<number, string>,
) => ({
  ...movement,
  ...(articleNames.has(movement.articleId) ? { articleName: articleNames.get(movement.articleId) } : {}),
});

export async function loadEventTransferDetail(companyId: string, eventId: number) {
  const eventResult = await pool.query<EventRow>(
    `SELECT
       pe.id, pe.name, pe.type, pe.status, pe.location,
       pe.customer_name AS "customerName",
       pe.starts_at AS "startsAt", pe.ends_at AS "endsAt", pe.notes,
       pe.enota_id AS "unitId", e.ime AS "unitName"
     FROM pos_events pe
     JOIN enote e ON e.id=pe.enota_id AND e.company_id=pe.company_id
     WHERE pe.company_id=$1 AND pe.id=$2
     LIMIT 1`,
    [companyId, eventId],
  );
  const event = eventResult.rows[0];
  if (!event) return null;

  const transfersResult = await pool.query<TransferRow>(
    `SELECT
       pst.id, pst.event_id AS "eventId", pst.direction, pst.status,
       pst.source_unit_id AS "sourceUnitId", source.ime AS "sourceUnitName",
       pst.target_unit_id AS "targetUnitId", target.ime AS "targetUnitName",
       pst.return_of_id AS "returnOfId",
       pst.completed_at AS "completedAt", pst.created_at AS "createdAt"
     FROM pos_stock_transfers pst
     JOIN enote source ON source.id=pst.source_unit_id AND source.company_id=pst.company_id
     JOIN enote target ON target.id=pst.target_unit_id AND target.company_id=pst.company_id
     WHERE pst.company_id=$1 AND pst.event_id=$2
     ORDER BY pst.created_at, pst.id`,
    [companyId, eventId],
  );
  const transferIds = transfersResult.rows.map(transfer => transfer.id);
  const linesResult = await pool.query<LineRow>(
    `SELECT
       line.id, line.transfer_id AS "transferId",
       line.source_article_id AS "sourceArticleId", source.ime AS "sourceArticleName",
       line.target_article_id AS "targetArticleId", target.ime AS "targetArticleName",
       line.quantity, line.unit_cost AS "unitCost",
       (line.quantity * line.unit_cost)::text AS value
     FROM pos_stock_transfer_lines line
     JOIN artikli source ON source.id=line.source_article_id AND source.enota_id=line.source_unit_id
     JOIN artikli target ON target.id=line.target_article_id AND target.enota_id=line.target_unit_id
     WHERE line.company_id=$1 AND line.transfer_id=ANY($2::int[])
     ORDER BY line.transfer_id, line.id`,
    [companyId, transferIds],
  );
  const movementsResult = await pool.query<MovementRow>(
    `SELECT
       zg.id, zg.artikel_id AS "articleId", a.ime AS "articleName",
       zg.tip AS type, zg.kolicina AS quantity,
       zg.cena_kos AS "unitCost", zg.vrednost AS value,
       zg.referenca_id AS "referenceId", zg.event_transfer_id AS "eventTransferId"
     FROM zaloga_gibi zg
     JOIN artikli a ON a.id=zg.artikel_id
     JOIN enote e ON e.id=a.enota_id
     JOIN pos_stock_transfers pst ON pst.id=zg.event_transfer_id
     WHERE pst.company_id=$1
       AND e.company_id=$1
       AND zg.event_transfer_id=ANY($2::int[])
     ORDER BY zg.event_transfer_id, zg.id`,
    [companyId, transferIds],
  );
  const articleNames = new Map<number, string>([
    ...linesResult.rows.flatMap(line => [
      [line.sourceArticleId, line.sourceArticleName] as const,
      [line.targetArticleId, line.targetArticleName] as const,
    ]),
    ...movementsResult.rows.map(row => [row.articleId, row.articleName] as const),
  ]);

  return {
    readOnly: true as const,
    event: {
      ...event,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
    },
    transfers: transfersResult.rows.map(transfer => {
      const lines = linesResult.rows.filter(line => line.transferId === transfer.id);
      const comparison = compareTransferMovements(
        transfer,
        lines as DiagnosticLine[],
        movementsResult.rows,
      );
      const comparisonByLine = new Map<number, TransferMovementComparison[]>();
      for (const row of comparison.comparisons) {
        const current = comparisonByLine.get(row.lineId) ?? [];
        current.push(row);
        comparisonByLine.set(row.lineId, current);
      }
      const enrichComparison = (row: TransferMovementComparison) => ({
        ...row,
        expected: enrichMovement(row.expected, articleNames),
        ...(row.actual ? { actual: enrichMovement(row.actual, articleNames) } : {}),
      });
      const enrichUnexpected = (row: UnexpectedTransferMovement) => ({
        ...row,
        actual: enrichMovement(row.actual, articleNames),
      });

      return {
        ...transfer,
        completedAt: transfer.completedAt?.toISOString() ?? null,
        createdAt: transfer.createdAt.toISOString(),
        lines: lines.map(line => ({
          ...line,
          movements: (comparisonByLine.get(line.id) ?? []).map(enrichComparison),
        })),
        unexpectedMovements: comparison.unexpectedMovements.map(enrichUnexpected),
      };
    }),
  };
}

export async function loadEventTransferMovementDetail(companyId: string, movementId: number) {
  const result = await pool.query<MovementDetailRow>(
    `SELECT
       zg.id, zg.artikel_id AS "articleId", a.ime AS "articleName",
       e.id AS "unitId", e.ime AS "unitName",
       zg.tip AS type, zg.kolicina AS quantity,
       zg.cena_kos AS "unitCost", zg.vrednost AS value,
       zg.opomba AS note, zg.actor_snapshot AS "actorSnapshot",
       zg.source_snapshot AS "sourceSnapshot", zg.referenca_id AS "referenceId",
       zg.event_transfer_id AS "eventTransferId", zg.ustvarjeno AS "createdAt",
       pst.id AS "transferId", pst.direction AS "transferDirection",
       pst.status AS "transferStatus", pst.created_by AS "transferCreatedBy",
       pe.id AS "eventId", pe.name AS "eventName"
     FROM zaloga_gibi zg
     JOIN artikli a ON a.id=zg.artikel_id
     JOIN enote e ON e.id=a.enota_id AND e.company_id=$1
     LEFT JOIN pos_stock_transfers pst
       ON pst.id=zg.event_transfer_id AND pst.company_id=e.company_id
     LEFT JOIN pos_events pe
       ON pe.id=pst.event_id AND pe.company_id=e.company_id
     WHERE zg.id=$2
     LIMIT 1`,
    [companyId, movementId],
  );
  const movement = result.rows[0];
  if (!movement) return null;

  return {
    readOnly: true as const,
    ...movement,
    createdAt: movement.createdAt.toISOString(),
  };
}