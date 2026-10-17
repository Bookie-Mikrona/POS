import { pool } from "@workspace/db";

export type SemanticObject = {
  category: string;
  identity: string[];
  properties: Record<string, unknown>;
};

// Object identities never contain OIDs: restore assigns new catalog OIDs.
// JSONB supplies stable property ordering; C collation supplies stable inventory ordering.
const inventorySql = `
WITH objects AS (
  SELECT 'indexes' AS category, ARRAY[n.nspname, c.relname] AS identity,
    jsonb_build_object('definition', pg_get_indexdef(i.indexrelid),
      'valid', i.indisvalid, 'ready', i.indisready, 'clustered', i.indisclustered,
      'replicaIdentity', i.indisreplident, 'options', c.reloptions,
      'tablespace', ts.spcname) AS properties
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_tablespace ts ON ts.oid = c.reltablespace
  UNION ALL
  SELECT 'constraints', ARRAY[n.nspname, COALESCE(c.relname, t.typname), con.conname],
    jsonb_build_object('type', con.contype, 'definition', pg_get_constraintdef(con.oid, false),
      'validated', con.convalidated, 'deferrable', con.condeferrable,
      'deferred', con.condeferred, 'noInherit', con.connoinherit,
      'domain', con.contypid <> 0)
  FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace
  LEFT JOIN pg_class c ON c.oid = con.conrelid LEFT JOIN pg_type t ON t.oid = con.contypid
  UNION ALL
  SELECT 'types', ARRAY[n.nspname, t.typname],
    jsonb_build_object('kind', t.typtype,
      'base', format_type(t.typbasetype, t.typtypmod), 'notNull', t.typnotnull,
      'default', t.typdefault, 'collation', coll.collname,
      'collationSchema', cn.nspname,
      'labels', (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
        FROM pg_enum e WHERE e.enumtypid = t.oid))
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  LEFT JOIN pg_collation coll ON coll.oid = t.typcollation
  LEFT JOIN pg_namespace cn ON cn.oid = coll.collnamespace
  WHERE t.typtype IN ('e', 'd')
  UNION ALL
  SELECT 'views', ARRAY[n.nspname, c.relname],
    jsonb_build_object('kind', c.relkind, 'definition', pg_get_viewdef(c.oid, false),
      'options', c.reloptions,
      'columns', (SELECT jsonb_agg(jsonb_build_array(a.attname,
        format_type(a.atttypid, a.atttypmod)) ORDER BY a.attnum)
        FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('v', 'm')
  UNION ALL
  SELECT 'functions', ARRAY[n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)],
    jsonb_build_object('kind', p.prokind, 'language', l.lanname,
      'arguments', pg_get_function_arguments(p.oid), 'result', pg_get_function_result(p.oid),
      'source', p.prosrc, 'binary', p.probin, 'volatility', p.provolatile,
      'strict', p.proisstrict, 'securityDefiner', p.prosecdef, 'leakproof', p.proleakproof,
      'parallel', p.proparallel, 'config', p.proconfig, 'cost', p.procost, 'rows', p.prorows,
      'definition', CASE WHEN p.prokind <> 'a' THEN pg_get_functiondef(p.oid) ELSE NULL END,
      'aggregate', CASE WHEN a.aggfnoid IS NOT NULL THEN jsonb_build_object(
        'settings', to_jsonb(a) - ARRAY['aggfnoid', 'aggtransfn', 'aggfinalfn',
          'aggcombinefn', 'aggserialfn', 'aggdeserialfn', 'aggmtransfn', 'aggminvtransfn',
          'aggmfinalfn', 'aggsortop', 'aggtranstype', 'aggmtranstype'],
        'kind', a.aggkind, 'directArgs', a.aggnumdirectargs,
        'transition', a.aggtransfn::regproc::text, 'final', a.aggfinalfn::regproc::text,
        'combine', a.aggcombinefn::regproc::text, 'serial', a.aggserialfn::regproc::text,
        'deserial', a.aggdeserialfn::regproc::text,
        'movingTransition', a.aggmtransfn::regproc::text,
        'movingInverse', a.aggminvtransfn::regproc::text,
        'movingFinal', a.aggmfinalfn::regproc::text,
        'sortOperator', a.aggsortop::regoperator::text,
        'movingStateType', format_type(a.aggmtranstype, NULL),
        'stateType', format_type(a.aggtranstype, NULL), 'initial', a.agginitval) END)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang LEFT JOIN pg_aggregate a ON a.aggfnoid = p.oid
  UNION ALL
  SELECT 'triggers', ARRAY[n.nspname, c.relname, t.tgname],
    jsonb_build_object('definition', pg_get_triggerdef(t.oid, false), 'enabled', t.tgenabled)
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'eventTriggers', ARRAY['', e.evtname],
    jsonb_build_object('event', e.evtevent, 'enabled', e.evtenabled,
      'function', e.evtfoid::regprocedure::text, 'tags', e.evttags)
  FROM pg_event_trigger e
  UNION ALL
  SELECT 'rls', ARRAY[n.nspname, c.relname],
    jsonb_build_object('enabled', c.relrowsecurity, 'forced', c.relforcerowsecurity)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p')
  UNION ALL
  SELECT 'policies', ARRAY[n.nspname, c.relname, p.polname],
    jsonb_build_object('command', p.polcmd, 'permissive', p.polpermissive,
      'roles', (SELECT jsonb_agg(role_name ORDER BY role_name COLLATE "C") FROM (
        SELECT CASE WHEN role_id = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_id) END AS role_name
        FROM unnest(p.polroles) role_id) r),
      'using', pg_get_expr(p.polqual, p.polrelid, false),
      'check', pg_get_expr(p.polwithcheck, p.polrelid, false))
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  UNION ALL
  SELECT 'extensions', ARRAY[n.nspname, e.extname],
    jsonb_build_object('version', e.extversion, 'relocatable', e.extrelocatable)
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
)
SELECT category, identity::text[] AS identity, properties FROM objects
WHERE category = 'extensions' OR (identity[1] !~ '^pg_' AND identity[1] <> 'information_schema')
ORDER BY category COLLATE "C", identity COLLATE "C"
`;

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Reparse CHECKs using the same parser used by restore, rather than stripping
 * casts or whitespace (which can change semantics or string literals).
 * Only temporary objects are created, on one connection, and always rolled back.
 */
export async function readSemanticObjects(): Promise<SemanticObject[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await client.query("SET LOCAL search_path = pg_catalog, public");
    const { rows } = await client.query<SemanticObject>(inventorySql);
    let ordinal = 0;
    for (const object of rows) {
      if (object.category !== "constraints" || object.properties.type !== "c") continue;
      const [schema, relation] = object.identity;
      const target = `${quoteIdentifier(schema)}.${quoteIdentifier(relation)}`;
      const temporary = `bookie_check_${ordinal++}`;
      const name = `pg_temp.${quoteIdentifier(temporary)}`;
      const definition = String(object.properties.definition);
      if (object.properties.domain) {
        const base = await client.query<{ base: string }>(
          `SELECT format_type(typbasetype, typtypmod) AS base FROM pg_type
           WHERE oid = $1::regtype`, [target],
        );
        await client.query(`CREATE DOMAIN ${name} AS ${base.rows[0].base} ${definition}`);
      } else {
        await client.query(`CREATE TEMP TABLE ${quoteIdentifier(temporary)} (LIKE ${target})`);
        await client.query(`ALTER TABLE ${name} ADD ${definition}`);
      }
      const normalized = await client.query<{ expression: string }>(
        `SELECT pg_get_expr(conbin, conrelid, false) AS expression FROM pg_constraint
         WHERE ${object.properties.domain ? "contypid = $1::regtype" : "conrelid = $1::regclass"}
           AND contype = 'c'`, [name],
      );
      if (normalized.rows.length !== 1) throw new Error("Normalizacija CHECK omejitve ni uspela.");
      object.properties.definition = normalized.rows[0].expression;
      await client.query(`DROP ${object.properties.domain ? "DOMAIN" : "TABLE"} ${name}`);
    }
    return rows;
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
}

export function assertSemanticObjectsRestored(
  expected: SemanticObject[],
  actual: SemanticObject[],
): void {
  // Also makes comparisons independent of JSON property order after parsing.
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
    return JSON.stringify(value);
  };
  const entries = (objects: SemanticObject[]) => new Map(objects.map((object) => [
    JSON.stringify([object.category, object.identity]), canonical(object.properties),
  ]));
  const before = entries(expected);
  const after = entries(actual);
  if (before.size !== expected.length || after.size !== actual.length) {
    throw new Error("Semantični manifest vsebuje podvojene identitete objektov.");
  }
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(key) !== after.get(key)) {
      throw new Error(`Semantični manifest baze se razlikuje: ${key}.`);
    }
  }
}
