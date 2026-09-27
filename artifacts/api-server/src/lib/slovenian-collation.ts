import { sql, type SQLWrapper } from "drizzle-orm";

/**
 * PostgreSQL ICU collation for Slovenian alphabetical ordering.
 * The database must provide PostgreSQL's standard sl-SI-x-icu collation.
 */
export function slovenianCollated(column: SQLWrapper) {
  return sql`(${column} COLLATE "sl-SI-x-icu")`;
}