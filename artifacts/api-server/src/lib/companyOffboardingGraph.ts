import type { PoolClient } from "@workspace/db";

type Column = {
  name: string;
  type: string;
};

type Table = {
  name: string;
  columns: Column[];
  primaryKey: string[];
  tenantColumns: string[];
};

type ForeignKey = {
  name: string;
  childTable: string;
  childColumns: string[];
  parentSchema: string;
  parentTable: string;
  parentColumns: string[];
  validated: boolean;
};

export type CompanyOffboardingBlocker = {
  code:
    | "SCHEMA_INSPECTION_FAILED"
    | "COMPANY_TABLE_UNAVAILABLE"
    | "MISSING_PRIMARY_KEY"
    | "UNVALIDATED_FOREIGN_KEY"
    | "UNKNOWN_TENANT_OWNERSHIP"
    | "CROSS_COMPANY_REFERENCE"
    | "ORPHANED_FOREIGN_KEY"
    | "EXTERNAL_FOREIGN_KEY"
    | "ROW_LIMIT_EXCEEDED"
    | "INSPECTION_TIME_LIMIT_EXCEEDED"
    | "QUERY_FAILED";
  table?: string;
  constraint?: string;
  reason: string;
};

export type CompanyOffboardingTableSelection = {
  table: string;
  primaryKeyColumns: string[];
  primaryKeys: (string | number | boolean | null | object)[][];
  rowCount: number;
};

export type CompanyOffboardingGraph = {
  companyId: string;
  readyForDeletion: false;
  inspectionComplete: boolean;
  tables: CompanyOffboardingTableSelection[];
  blockers: CompanyOffboardingBlocker[];
  metadata: {
    publicBaseTableCount: number;
    foreignKeyCount: number;
    selectedTableCount: number;
    selectedRowCount: number;
    readOnly: true;
    snapshotConsistent: boolean;
  };
};

type CatalogColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
};
type CatalogPrimaryKeyRow = {
  table_name: string;
  column_name: string;
  ordinal: number;
};
type CatalogForeignKeyRow = {
  constraint_name: string;
  table_name: string;
  column_name: string;
  referenced_table: string;
  referenced_schema: string;
  referenced_column: string;
  ordinal: number;
  validated: boolean;
};

const quoteIdentifier = (identifier: string): string =>
  `"${identifier.replaceAll('"', '""')}"`;

const qualifiedTable = (table: string): string =>
  `"public".${quoteIdentifier(table)}`;

const supportsTenantEquality = (dataType: string): boolean =>
  ["uuid", "text", "varchar", "bpchar", "character varying", "character"].includes(dataType);

const stableKey = (values: unknown[]): string => JSON.stringify(values);

function addBlocker(
  blockers: CompanyOffboardingBlocker[],
  blocker: CompanyOffboardingBlocker,
): void {
  const key = `${blocker.code}|${blocker.table ?? ""}|${blocker.constraint ?? ""}|${blocker.reason}`;
  if (!blockers.some((existing) =>
    `${existing.code}|${existing.table ?? ""}|${existing.constraint ?? ""}|${existing.reason}` === key
  )) blockers.push(blocker);
}

function selectedTuplePredicate(
  alias: string,
  columns: string[],
  tuples: unknown[][],
  startParameter: number,
): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const predicate = tuples.map((tuple) => {
    const parts = columns.map((column, index) => {
      values.push(tuple[index]);
      return `${alias}.${quoteIdentifier(column)} = $${startParameter + values.length - 1}`;
    });
    return `(${parts.join(" AND ")})`;
  });
  return { sql: predicate.length ? `(${predicate.join(" OR ")})` : "FALSE", values };
}

/**
 * Inspects public-table rows connected to a company. This is intentionally a
 * read-only inventory, never a deletion plan: tenant ownership beyond explicit
 * tenant columns and validated FK reachability cannot be proven generically.
 */
export async function inspectCompanyOffboardingGraph(
  client: PoolClient,
  companyId: string,
  options: { maxSelectedRows?: number; maxDurationMs?: number; snapshotConsistent?: boolean } = {},
): Promise<CompanyOffboardingGraph> {
  const blockers: CompanyOffboardingBlocker[] = [];
  let tables: Table[] = [];
  let foreignKeys: ForeignKey[] = [];
  const selected = new Map<string, Map<string, unknown[]>>();
  let inspectionComplete = true;
  const maxSelectedRows = Number.isInteger(options.maxSelectedRows) && (options.maxSelectedRows ?? 0) > 0
    ? Math.min(options.maxSelectedRows!, 100_000)
    : 10_000;
  let rowLimitExceeded = false;
  let queryFailed = false;
  const maxDurationMs = Number.isInteger(options.maxDurationMs) && (options.maxDurationMs ?? 0) > 0
    ? Math.min(options.maxDurationMs!, 120_000)
    : 30_000;
  const deadline = Date.now() + maxDurationMs;

  function checkBudget(table?: string): boolean {
    if (queryFailed) return false;
    if (Date.now() < deadline) return true;
    queryFailed = true;
    inspectionComplete = false;
    addBlocker(blockers, {
      code: "INSPECTION_TIME_LIMIT_EXCEEDED",
      ...(table ? { table } : {}),
      reason: `Inspection exceeded its ${maxDurationMs} ms time budget; the graph is partial.`,
    });
    return false;
  }

  function selectedRowCount(): number {
    let count = 0;
    for (const rows of selected.values()) count += rows.size;
    return count;
  }

  function markRowLimit(table: string): void {
    rowLimitExceeded = true;
    inspectionComplete = false;
    addBlocker(blockers, {
      code: "ROW_LIMIT_EXCEEDED",
      table,
      reason: `Inspection reached the configured cap of ${maxSelectedRows} selected rows; the graph is partial.`,
    });
  }

  try {
    if (!checkBudget()) return graphResult(companyId, tables, foreignKeys, selected, blockers, false, options.snapshotConsistent ?? false);
    const columnResult = await client.query<CatalogColumnRow>(`
        /*offboarding:catalog-columns*/
        SELECT table_row.relname AS table_name,
               column_row.attname AS column_name,
               type_row.typname AS data_type
        FROM pg_class table_row
        JOIN pg_namespace table_schema ON table_schema.oid = table_row.relnamespace
        JOIN pg_attribute column_row ON column_row.attrelid = table_row.oid
        JOIN pg_type type_row ON type_row.oid = column_row.atttypid
        WHERE table_schema.nspname = 'public'
          AND table_row.relkind IN ('r', 'p')
          AND column_row.attnum > 0
          AND NOT column_row.attisdropped
        ORDER BY table_row.relname, column_row.attnum
      `);
    if (!checkBudget()) return graphResult(companyId, tables, foreignKeys, selected, blockers, false, options.snapshotConsistent ?? false);
    const primaryKeyResult = await client.query<CatalogPrimaryKeyRow>(`
        /*offboarding:catalog-primary-keys*/
        SELECT table_row.relname AS table_name,
               column_row.attname AS column_name,
               key_column.ordinality::int AS ordinal
        FROM pg_constraint key_constraint
        JOIN pg_class table_row ON table_row.oid = key_constraint.conrelid
        JOIN pg_namespace table_schema ON table_schema.oid = table_row.relnamespace
        JOIN LATERAL unnest(key_constraint.conkey) WITH ORDINALITY
          AS key_column(attnum, ordinality) ON TRUE
        JOIN pg_attribute column_row
          ON column_row.attrelid = table_row.oid AND column_row.attnum = key_column.attnum
        WHERE key_constraint.contype = 'p'
          AND table_schema.nspname = 'public'
        ORDER BY table_row.relname, key_column.ordinality
      `);
    if (!checkBudget()) return graphResult(companyId, tables, foreignKeys, selected, blockers, false, options.snapshotConsistent ?? false);
    const foreignKeyResult = await client.query<CatalogForeignKeyRow>(`
        /*offboarding:catalog-foreign-keys*/
        SELECT constraint_row.conname AS constraint_name,
               child.relname AS table_name,
               child_column.attname AS column_name,
               parent.relname AS referenced_table,
               parent_schema.nspname AS referenced_schema,
               parent_column.attname AS referenced_column,
               child_key.ordinality::int AS ordinal,
               constraint_row.convalidated AS validated
        FROM pg_constraint constraint_row
        JOIN pg_class child ON child.oid = constraint_row.conrelid
        JOIN pg_namespace child_schema ON child_schema.oid = child.relnamespace
        JOIN pg_class parent ON parent.oid = constraint_row.confrelid
        JOIN pg_namespace parent_schema ON parent_schema.oid = parent.relnamespace
        JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY
          AS child_key(attnum, ordinality) ON TRUE
        JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY
          AS parent_key(attnum, ordinality) ON parent_key.ordinality = child_key.ordinality
        JOIN pg_attribute child_column
          ON child_column.attrelid = child.oid AND child_column.attnum = child_key.attnum
        JOIN pg_attribute parent_column
          ON parent_column.attrelid = parent.oid AND parent_column.attnum = parent_key.attnum
        WHERE constraint_row.contype = 'f'
          AND child_schema.nspname = 'public'
        ORDER BY child.relname, constraint_row.conname, child_key.ordinality
      `);

    const columnsByTable = new Map<string, Column[]>();
    for (const row of columnResult.rows) {
      const columns = columnsByTable.get(row.table_name) ?? [];
      columns.push({ name: row.column_name, type: row.data_type });
      columnsByTable.set(row.table_name, columns);
    }
    const pksByTable = new Map<string, string[]>();
    for (const row of primaryKeyResult.rows) {
      const columns = pksByTable.get(row.table_name) ?? [];
      columns[row.ordinal - 1] = row.column_name;
      pksByTable.set(row.table_name, columns);
    }
    tables = [...columnsByTable.entries()].map(([name, columns]) => ({
      name,
      columns,
      primaryKey: pksByTable.get(name) ?? [],
      tenantColumns: columns
        // Only the snake-case field is treated as authoritative tenant
        // ownership. Camel-case/secondary fields may be nullable or refer to
        // another company and must never seed rows for this company.
        .filter((column) => column.name === "company_id" && supportsTenantEquality(column.type))
        .map((column) => column.name),
    })).sort((a, b) => a.name.localeCompare(b.name));

    const foreignKeyGroups = new Map<string, CatalogForeignKeyRow[]>();
    for (const row of foreignKeyResult.rows) {
      const groupKey = `${row.table_name}\0${row.constraint_name}`;
      const group = foreignKeyGroups.get(groupKey) ?? [];
      group.push(row);
      foreignKeyGroups.set(groupKey, group);
    }
    foreignKeys = [...foreignKeyGroups.values()].map((rows) => ({
      name: rows[0].constraint_name,
      childTable: rows[0].table_name,
      childColumns: rows.sort((a, b) => a.ordinal - b.ordinal).map((row) => row.column_name),
      parentSchema: rows[0].referenced_schema,
      parentTable: rows[0].referenced_table,
      parentColumns: rows.sort((a, b) => a.ordinal - b.ordinal).map((row) => row.referenced_column),
      validated: rows.every((row) => row.validated),
    })).sort((a, b) =>
      a.childTable.localeCompare(b.childTable) || a.name.localeCompare(b.name)
    );
  } catch {
    inspectionComplete = false;
    addBlocker(blockers, {
      code: "SCHEMA_INSPECTION_FAILED",
      reason: "Public table, primary-key, and foreign-key metadata could not be inspected.",
    });
    return graphResult(companyId, tables, foreignKeys, selected, blockers, false, options.snapshotConsistent ?? false);
  }

  const tableByName = new Map(tables.map((table) => [table.name, table]));
  const companies = tableByName.get("companies");
  if (!companies?.primaryKey.includes("id") ||
      !supportsTenantEquality(companies.columns.find((column) => column.name === "id")?.type ?? "")) {
    addBlocker(blockers, {
      code: "COMPANY_TABLE_UNAVAILABLE",
      table: "companies",
      reason: "The companies table does not expose an id primary key.",
    });
  }

  for (const table of tables) {
    if (!table.primaryKey.length) {
      addBlocker(blockers, {
        code: "MISSING_PRIMARY_KEY",
        table: table.name,
        reason: "Rows cannot be deterministically identified because the table has no primary key.",
      });
    }
    if (!table.tenantColumns.length && table.name !== "companies") {
      addBlocker(blockers, {
        code: "UNKNOWN_TENANT_OWNERSHIP",
        table: table.name,
        reason: "The table has no supported authoritative company_id ownership column; global/reference status cannot be proven from schema alone.",
      });
    }
  }
  for (const foreignKey of foreignKeys) {
    if (foreignKey.parentSchema !== "public") {
      addBlocker(blockers, {
        code: "EXTERNAL_FOREIGN_KEY",
        table: foreignKey.childTable,
        constraint: foreignKey.name,
        reason: `The foreign key references ${foreignKey.parentSchema}.${foreignKey.parentTable}, outside the inspected public base tables.`,
      });
    }
    if (!foreignKey.validated) {
      addBlocker(blockers, {
        code: "UNVALIDATED_FOREIGN_KEY",
        table: foreignKey.childTable,
        constraint: foreignKey.name,
        reason: "The foreign key is not validated, so its existing row relationships are not proven.",
      });
    }
  }

  const companyRoot = companies?.primaryKey.includes("id") ? companies : undefined;
  if (companyRoot) {
    await seedTable(companyRoot, ["id"]);
  }
  for (const table of tables) {
    if (rowLimitExceeded || queryFailed) break;
    if (table.tenantColumns.length) await seedTable(table, table.tenantColumns);
  }

  const queue = new Set(tables.filter((table) => (selected.get(table.name)?.size ?? 0) > 0).map((table) => table.name));
  const processedParentKeys = new Map<string, Set<string>>();
  while (queue.size > 0 && !rowLimitExceeded && !queryFailed) {
    const parentName = [...queue].sort()[0];
    queue.delete(parentName);
    const parent = tableByName.get(parentName);
    if (!parent?.primaryKey.length) continue;
    const parentRows = [...(selected.get(parentName)?.values() ?? [])];
    for (const foreignKey of foreignKeys.filter((edge) =>
      edge.parentSchema === "public" && edge.parentTable === parentName
    )) {
      if (rowLimitExceeded || queryFailed) break;
      const relationKey = `${foreignKey.name}\0${parentName}`;
      const processed = processedParentKeys.get(relationKey) ?? new Set<string>();
      const pendingParentRows = parentRows.filter((row) => {
        const key = stableKey(row);
        if (processed.has(key)) return false;
        processed.add(key);
        return true;
      });
      processedParentKeys.set(relationKey, processed);
      if (!pendingParentRows.length) continue;
      const child = tableByName.get(foreignKey.childTable);
      if (!child) continue;
      if (!child.primaryKey.length) {
        await detectUnidentifiableReferences(child, parent, foreignKey, pendingParentRows);
        continue;
      }
      const before = selected.get(child.name)?.size ?? 0;
      await discoverChildren(child, parent, foreignKey, pendingParentRows);
      if ((selected.get(child.name)?.size ?? 0) > before) queue.add(child.name);
    }
  }

  // A directly scoped row pointing at a missing FK target is an orphan, and
  // cannot be safely described as a closed deletion set.
  for (const edge of foreignKeys) {
    if (rowLimitExceeded || !checkBudget(edge.childTable)) break;
    if (edge.parentSchema !== "public") continue;
    const child = tableByName.get(edge.childTable);
    const parent = tableByName.get(edge.parentTable);
    const childRows = [...(selected.get(edge.childTable)?.values() ?? [])];
    if (!child?.primaryKey.length || !parent?.primaryKey.length || !childRows.length) continue;
    try {
      const predicate = selectedTuplePredicate("child", child.primaryKey, childRows, 1);
      const nonNull = edge.childColumns.map((column) => `child.${quoteIdentifier(column)} IS NOT NULL`).join(" AND ");
      const matches = edge.childColumns.map((column, index) =>
        `parent.${quoteIdentifier(edge.parentColumns[index])} = child.${quoteIdentifier(column)}`
      ).join(" AND ");
      const { rows } = await client.query<{ orphan: number }>(
        `/*offboarding:orphan:${edge.name}*/
         SELECT 1 AS orphan
         FROM ${qualifiedTable(child.name)} child
         WHERE ${predicate.sql} AND ${nonNull}
           AND NOT EXISTS (
             SELECT 1 FROM ${qualifiedTable(parent.name)} parent WHERE ${matches}
           )
         ORDER BY ${child.primaryKey.map((column) => `child.${quoteIdentifier(column)}`).join(", ")}`,
        predicate.values,
      );
      if (rows.length) addBlocker(blockers, {
        code: "ORPHANED_FOREIGN_KEY",
        table: child.name,
        constraint: edge.name,
        reason: `${rows.length} selected row(s) have non-null foreign-key values with no referenced row.`,
      });
    } catch {
      inspectionComplete = false;
      queryFailed = true;
      addBlocker(blockers, {
        code: "QUERY_FAILED",
        table: child.name,
        constraint: edge.name,
        reason: "Selected rows could not be checked for orphaned foreign-key references.",
      });
    }
  }

  return graphResult(
    companyId,
    tables,
    foreignKeys,
    selected,
    blockers,
    inspectionComplete,
    options.snapshotConsistent ?? false,
  );

  async function seedTable(table: Table, columns: string[]): Promise<void> {
    if (!table.primaryKey.length || rowLimitExceeded || !checkBudget(table.name)) return;
    // Tenant roots are restricted to authoritative company_id; companyId and
    // other nullable/secondary owner columns are intentionally not used.
    const predicates = columns
      .map((column) => `${quoteIdentifier(column)}::text = $1::text`)
      .join(" OR ");
    try {
      const { rows } = await client.query<Record<string, unknown>>(
        `/*offboarding:seed:${table.name}*/
         SELECT ${[
           ...table.primaryKey.map((column) => `${quoteIdentifier(column)} AS ${quoteIdentifier(`pk_${column}`)}`),
           ...table.tenantColumns.map((column) => `${quoteIdentifier(column)} AS ${quoteIdentifier(`tenant_${column}`)}`),
         ].join(", ")}
         FROM ${qualifiedTable(table.name)}
         WHERE ${predicates}
         ORDER BY ${table.primaryKey.map(quoteIdentifier).join(", ")}
         LIMIT ${maxSelectedRows + 1}`,
        [companyId],
      );
      if (rows.length > maxSelectedRows) markRowLimit(table.name);
      for (const row of rows) {
        const pk = table.primaryKey.map((column) => row[`pk_${column}`]);
        const tenantValues = table.tenantColumns.map((column) => row[`tenant_${column}`]);
        const inconsistentTenant = tenantValues.some((value) =>
          value == null || String(value).toLowerCase() !== companyId.toLowerCase()
        );
        if (inconsistentTenant) {
          addBlocker(blockers, {
            code: "CROSS_COMPANY_REFERENCE",
            table: table.name,
            reason: "A row matching one company column has conflicting or null ownership in another company column; it was not included.",
          });
          continue;
        }
        addSelected(table, pk);
      }
    } catch {
      inspectionComplete = false;
      queryFailed = true;
      addBlocker(blockers, {
        code: "QUERY_FAILED",
        table: table.name,
        reason: "Company-scoped primary keys could not be inspected.",
      });
    }
  }

  function addSelected(table: Table, primaryKey: unknown[]): boolean {
    const rows = selected.get(table.name) ?? new Map<string, unknown[]>();
    const key = stableKey(primaryKey);
    if (rows.has(key)) return false;
    if (selectedRowCount() >= maxSelectedRows) {
      markRowLimit(table.name);
      return false;
    }
    rows.set(key, primaryKey);
    selected.set(table.name, rows);
    return true;
  }

  async function discoverChildren(
    child: Table,
    parent: Table,
    edge: ForeignKey,
    parentRows: unknown[][],
  ): Promise<void> {
    if (!parentRows.length) return;
    const chunkSize = 250;
    for (let offset = 0; offset < parentRows.length && checkBudget(child.name); offset += chunkSize) {
      const selectedParentRows = parentRows.slice(offset, offset + chunkSize);
      try {
        const predicate = selectedTuplePredicate("parent", parent.primaryKey, selectedParentRows, 1);
        const joins = edge.childColumns.map((column, index) =>
          `child.${quoteIdentifier(column)} = parent.${quoteIdentifier(edge.parentColumns[index])}`
        ).join(" AND ");
        const columns = [
          ...child.primaryKey.map((column) => `child.${quoteIdentifier(column)} AS ${quoteIdentifier(`pk_${column}`)}`),
          ...child.tenantColumns.map((column) => `child.${quoteIdentifier(column)} AS ${quoteIdentifier(`tenant_${column}`)}`),
        ];
        const { rows } = await client.query<Record<string, unknown>>(
          `/*offboarding:edge:${edge.name}*/
           SELECT ${columns.join(", ")}
           FROM ${qualifiedTable(child.name)} child
           JOIN ${qualifiedTable(parent.name)} parent ON ${joins}
           WHERE ${predicate.sql}
           ORDER BY ${child.primaryKey.map((column) => `child.${quoteIdentifier(column)}`).join(", ")}
           LIMIT ${maxSelectedRows + 1}`,
          predicate.values,
        );
        if (rows.length > maxSelectedRows) markRowLimit(child.name);
        for (const row of rows) {
          const tenantValues = child.tenantColumns.map((column) => row[`tenant_${column}`]);
          const mismatch = tenantValues.some((value) =>
            value != null && String(value).toLowerCase() !== companyId.toLowerCase()
          );
          const missingOwnership = child.tenantColumns.length > 0 && tenantValues.some((value) => value == null);
          if (!child.tenantColumns.length) {
            addBlocker(blockers, {
              code: "UNKNOWN_TENANT_OWNERSHIP",
              table: child.name,
              constraint: edge.name,
              reason: "A row references a selected row, but without a tenant column it could be a shared/global row and was not included.",
            });
            addBlocker(blockers, {
              code: "CROSS_COMPANY_REFERENCE",
              table: child.name,
              constraint: edge.name,
              reason: "A retained row without provable tenant ownership references a selected row.",
            });
            continue;
          }
          if (mismatch || missingOwnership) {
            addBlocker(blockers, {
              code: "CROSS_COMPANY_REFERENCE",
              table: child.name,
              constraint: edge.name,
              reason: "A row outside the target company (or with null tenant ownership) references a selected row; it was not included.",
            });
            continue;
          }
          const pk = child.primaryKey.map((column) => row[`pk_${column}`]);
          addSelected(child, pk);
        }
      } catch {
        inspectionComplete = false;
        queryFailed = true;
        addBlocker(blockers, {
          code: "QUERY_FAILED",
          table: child.name,
          constraint: edge.name,
          reason: "Rows referencing selected primary keys could not be inspected.",
        });
      }
    }
  }

  async function detectUnidentifiableReferences(
    child: Table,
    parent: Table,
    edge: ForeignKey,
    parentRows: unknown[][],
  ): Promise<void> {
    for (let offset = 0; offset < parentRows.length && checkBudget(child.name); offset += 250) {
      const predicate = selectedTuplePredicate(
        "parent",
        parent.primaryKey,
        parentRows.slice(offset, offset + 250),
        1,
      );
      const joins = edge.childColumns.map((column, index) =>
        `child.${quoteIdentifier(column)} = parent.${quoteIdentifier(edge.parentColumns[index])}`
      ).join(" AND ");
      try {
        const { rows } = await client.query<{ candidate: number }>(
          `/*offboarding:unidentifiable:${edge.name}*/
           SELECT 1 AS candidate
           FROM ${qualifiedTable(child.name)} child
           JOIN ${qualifiedTable(parent.name)} parent ON ${joins}
           WHERE ${predicate.sql}
           LIMIT 1`,
          predicate.values,
        );
        if (rows.length) {
          addBlocker(blockers, {
            code: "CROSS_COMPANY_REFERENCE",
            table: child.name,
            constraint: edge.name,
            reason: "A row without a primary key references a selected row and cannot be safely included or excluded.",
          });
        }
      } catch {
        inspectionComplete = false;
        queryFailed = true;
        addBlocker(blockers, {
          code: "QUERY_FAILED",
          table: child.name,
          constraint: edge.name,
          reason: "References from a table without a primary key could not be inspected.",
        });
      }
    }
  }
}

function graphResult(
  companyId: string,
  tables: Table[],
  foreignKeys: ForeignKey[],
  selected: Map<string, Map<string, unknown[]>>,
  blockers: CompanyOffboardingBlocker[],
  inspectionComplete: boolean,
  snapshotConsistent: boolean,
): CompanyOffboardingGraph {
  const tableSelections = tables
    .map((tableInfo) => {
      const keys = selected.get(tableInfo.name);
      const primaryKeys = [...(keys?.values() ?? [])].sort((a, b) =>
        stableKey(a).localeCompare(stableKey(b))
      ) as CompanyOffboardingTableSelection["primaryKeys"];
      return {
        table: tableInfo.name,
        primaryKeyColumns: tableInfo.primaryKey,
        primaryKeys,
        rowCount: primaryKeys.length,
      };
    })
    .sort((a, b) => a.table.localeCompare(b.table));
  const selectedRowCount = tableSelections.reduce((sum, table) => sum + table.rowCount, 0);
  blockers.sort((a, b) =>
    (a.table ?? "").localeCompare(b.table ?? "") ||
    a.code.localeCompare(b.code) ||
    (a.constraint ?? "").localeCompare(b.constraint ?? "")
  );
  return {
    companyId,
    readyForDeletion: false,
    inspectionComplete,
    tables: tableSelections,
    blockers,
    metadata: {
      publicBaseTableCount: tables.length,
      foreignKeyCount: foreignKeys.length,
      selectedTableCount: tableSelections.filter((table) => table.rowCount > 0).length,
      selectedRowCount,
      readOnly: true,
      snapshotConsistent,
    },
  };
}