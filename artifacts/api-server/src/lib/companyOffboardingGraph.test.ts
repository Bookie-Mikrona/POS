import { describe, expect, it } from "vitest";
import type { PoolClient } from "@workspace/db";
import { inspectCompanyOffboardingGraph } from "./companyOffboardingGraph";

const companyA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const companyB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const nodeA = "11111111-1111-4111-8111-111111111111";
const nodeB = "22222222-2222-4222-8222-222222222222";
const nodeOrphan = "33333333-3333-4333-8333-333333333333";

type FixtureTable = { name: string; columns: { name: string; type: string }[]; pk: string[] };
type FixtureEdge = {
  name: string;
  child: string;
  childColumns: string[];
  parent: string;
  parentColumns: string[];
  validated: boolean;
};

const tables: FixtureTable[] = [
  { name: "companies", columns: [{ name: "id", type: "uuid" }], pk: ["id"] },
  { name: "nodes", columns: [
    { name: "id", type: "uuid" }, { name: "company_id", type: "uuid" }, { name: "parent_id", type: "uuid" },
  ], pk: ["id"] },
  { name: "composite_children", columns: [
    { name: "id", type: "uuid" }, { name: "company_id", type: "uuid" }, { name: "node_id", type: "uuid" },
  ], pk: ["id"] },
  { name: "cross_links", columns: [
    { name: "id", type: "uuid" }, { name: "company_id", type: "uuid" },
    { name: "companyId", type: "uuid" }, { name: "node_id", type: "uuid" },
  ], pk: ["id"] },
  { name: "orphan_rows", columns: [
    { name: "id", type: "uuid" }, { name: "company_id", type: "uuid" }, { name: "node_id", type: "uuid" },
  ], pk: ["id"] },
  { name: "shared_codes", columns: [{ name: "id", type: "uuid" }], pk: ["id"] },
  { name: "alternate_owner_only", columns: [
    { name: "id", type: "uuid" }, { name: "companyId", type: "uuid" },
  ], pk: ["id"] },
];

const edges: FixtureEdge[] = [
  { name: "nodes_parent_fk", child: "nodes", childColumns: ["parent_id"], parent: "nodes", parentColumns: ["id"], validated: true },
  { name: "composite_children_node_fk", child: "composite_children", childColumns: ["node_id", "company_id"], parent: "nodes", parentColumns: ["id", "company_id"], validated: true },
  { name: "cross_links_node_fk", child: "cross_links", childColumns: ["node_id"], parent: "nodes", parentColumns: ["id"], validated: true },
  { name: "orphan_rows_node_fk", child: "orphan_rows", childColumns: ["node_id"], parent: "nodes", parentColumns: ["id"], validated: true },
];

const data: Record<string, Record<string, unknown>[]> = {
  companies: [{ id: companyA }, { id: companyB }],
  nodes: [
    { id: nodeA, company_id: companyA, parent_id: nodeB },
    { id: nodeB, company_id: companyA, parent_id: nodeA },
    { id: nodeOrphan, company_id: companyB, parent_id: null },
  ],
  composite_children: [
    { id: "child-a", company_id: companyA, node_id: nodeA },
    { id: "child-b", company_id: companyB, node_id: nodeOrphan },
  ],
  cross_links: [
    { id: "cross-b-to-a", company_id: companyB, companyId: companyA, node_id: nodeA },
    { id: "cross-a-to-a", company_id: companyA, companyId: null, node_id: nodeA },
  ],
  orphan_rows: [{ id: "orphan-a", company_id: companyA, node_id: "missing-node" }],
  shared_codes: [{ id: "global-code" }],
  alternate_owner_only: [{ id: "alternate-owned-a", companyId: companyA }],
};

class FixtureClient {
  async query<Row = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: Row[] }> {
    let rows: Record<string, unknown>[] = [];
    if (sql.includes("offboarding:catalog-columns")) {
      rows = tables.flatMap((table) => table.columns.map((column) => ({
        table_name: table.name, column_name: column.name, data_type: column.type,
      })));
    } else if (sql.includes("offboarding:catalog-primary-keys")) {
      rows = tables.flatMap((table) => table.pk.map((column, index) => ({
        table_name: table.name, column_name: column, ordinal: index + 1,
      })));
    } else if (sql.includes("offboarding:catalog-foreign-keys")) {
      rows = edges.flatMap((edge) => edge.childColumns.map((column, index) => ({
        constraint_name: edge.name,
        table_name: edge.child,
        column_name: column,
        referenced_table: edge.parent,
        referenced_schema: "public",
        referenced_column: edge.parentColumns[index],
        ordinal: index + 1,
        validated: edge.validated,
      })));
    } else {
      const seed = sql.match(/offboarding:seed:([a-z_]+)/);
      const edgeMatch = sql.match(/offboarding:edge:([a-z_]+)/);
      const orphanMatch = sql.match(/offboarding:orphan:([a-z_]+)/);
      if (seed) {
        const name = seed[1];
        const table = tables.find((candidate) => candidate.name === name)!;
        rows = (data[name] ?? []).filter((record) =>
          name === "companies" ? record.id === values[0] : record.company_id === values[0]
        ).map((record) => ({
          ...Object.fromEntries(table.pk.map((column) => [`pk_${column}`, record[column]])),
          ...Object.fromEntries(table.columns
            .filter((column) => column.name === "company_id" || column.name === "companyId")
            .map((column) => [`tenant_${column.name}`, record[column.name]])),
        }));
      } else if (edgeMatch) {
        const edge = edges.find((candidate) => candidate.name === edgeMatch[1])!;
        const parent = tables.find((candidate) => candidate.name === edge.parent)!;
        const parentTuples = new Set<string>();
        for (let offset = 0; offset < values.length; offset += parent.pk.length) {
          parentTuples.add(JSON.stringify(values.slice(offset, offset + parent.pk.length)));
        }
        rows = (data[edge.child] ?? []).filter((child) =>
          (data[edge.parent] ?? []).some((parentRecord) =>
            edge.childColumns.every((column, index) =>
              child[column] === parentRecord[edge.parentColumns[index]]
            ) && parentTuples.has(JSON.stringify(parent.pk.map((column) => parentRecord[column])))
          )
        ).map((record) => ({
          ...Object.fromEntries(tables.find((table) => table.name === edge.child)!.pk
            .map((column) => [`pk_${column}`, record[column]])),
          ...Object.fromEntries(tables.find((table) => table.name === edge.child)!.columns
            .filter((column) => column.name === "company_id" || column.name === "companyId")
            .map((column) => [`tenant_${column.name}`, record[column.name]])),
        }));
      } else if (orphanMatch) {
        const edge = edges.find((candidate) => candidate.name === orphanMatch[1])!;
        const childTable = tables.find((candidate) => candidate.name === edge.child)!;
        const selectedKeys = new Set<string>();
        for (let offset = 0; offset < values.length; offset += childTable.pk.length) {
          selectedKeys.add(JSON.stringify(values.slice(offset, offset + childTable.pk.length)));
        }
        rows = (data[edge.child] ?? []).filter((child) =>
          selectedKeys.has(JSON.stringify(childTable.pk.map((column) => child[column]))) &&
          edge.childColumns.every((column) => child[column] != null) &&
          !(data[edge.parent] ?? []).some((parentRecord) =>
            edge.childColumns.every((column, index) =>
              child[column] === parentRecord[edge.parentColumns[index]]
            )
          )
        ).map(() => ({ orphan: 1 }));
      }
    }
    return { rows: rows as Row[] };
  }
}

describe("inspectCompanyOffboardingGraph", () => {
  it("closes a tenant subset across cycles and composite FKs without selecting another tenant", async () => {
    const graph = await inspectCompanyOffboardingGraph(
      new FixtureClient() as unknown as PoolClient,
      companyA,
    );
    const byTable = Object.fromEntries(graph.tables.map((table) => [table.table, table]));

    expect(byTable.nodes.primaryKeys).toEqual([[nodeA], [nodeB]]);
    expect(byTable.composite_children.primaryKeys).toEqual([["child-a"]]);
    expect(byTable.cross_links.primaryKeys).toEqual([["cross-a-to-a"]]);
    expect(byTable.orphan_rows.primaryKeys).toEqual([["orphan-a"]]);
    expect(byTable.nodes.primaryKeys).not.toContainEqual([nodeOrphan]);
    expect(byTable.composite_children.primaryKeys).not.toContainEqual(["child-b"]);
    expect(byTable.cross_links.primaryKeys).not.toContainEqual(["cross-b-to-a"]);
    expect(graph.blockers.some((blocker) =>
      blocker.code === "CROSS_COMPANY_REFERENCE" && blocker.table === "cross_links"
    )).toBe(true);
    expect(graph.blockers.some((blocker) => blocker.code === "ORPHANED_FOREIGN_KEY")).toBe(true);
    expect(graph.blockers.some((blocker) => blocker.table === "shared_codes" && blocker.code === "UNKNOWN_TENANT_OWNERSHIP")).toBe(true);
    expect(graph.blockers.some((blocker) => blocker.table === "alternate_owner_only" && blocker.code === "UNKNOWN_TENANT_OWNERSHIP")).toBe(true);
    expect(byTable.alternate_owner_only.primaryKeys).toEqual([]);
    expect(graph.readyForDeletion).toBe(false);
    expect(graph.metadata.readOnly).toBe(true);
  });

  it("seeds only the requested company, and never claims deletion readiness", async () => {
    const graph = await inspectCompanyOffboardingGraph(
      new FixtureClient() as unknown as PoolClient,
      companyB,
    );
    const nodes = graph.tables.find((table) => table.table === "nodes");
    expect(nodes?.primaryKeys).toEqual([[nodeOrphan]]);
    expect(graph.tables.find((table) => table.table === "composite_children")?.primaryKeys).toEqual([["child-b"]]);
    // This row's authoritative company_id is B, so it is a B seed despite
    // its nullable/secondary companyId pointing at A.
    expect(graph.tables.find((table) => table.table === "cross_links")?.primaryKeys).toEqual([["cross-b-to-a"]]);
    expect(graph.readyForDeletion).toBe(false);
  });
});