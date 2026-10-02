import { sql } from "drizzle-orm";
import { artikliTable, kdsNalogiTable, postavkeTable } from "@workspace/db";

/** Keep historical tickets intact, but exclude them from live production and readiness. */
export function includedKdsTicket() {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${postavkeTable}
    JOIN ${artikliTable} ON ${artikliTable.id} = ${postavkeTable.artikelId}
    WHERE ${postavkeTable.id} = ${kdsNalogiTable.postavkaId}
      AND ${artikliTable.kdsIzkljucen} = true
  )`;
}