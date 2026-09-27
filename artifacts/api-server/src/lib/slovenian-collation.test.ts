import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CasingCache } from "drizzle-orm/casing";
import { slovenianCollated } from "./slovenian-collation";

describe("Slovenian name collation", () => {
  it("orders the Slovenian alphabet's C, S, and Z groups correctly", () => {
    const collator = new Intl.Collator("sl-SI");
    expect(["D", "Č", "C"].sort(collator.compare)).toEqual(["C", "Č", "D"]);
    expect(["T", "Š", "S"].sort(collator.compare)).toEqual(["S", "Š", "T"]);
    expect(["Ž", "Z"].sort(collator.compare)).toEqual(["Z", "Ž"]);
  });

  it("emits the PostgreSQL Slovenian ICU collation for a column", () => {
    const query = slovenianCollated(sql.identifier("name")).toQuery({
      casing: new CasingCache(),
      escapeName: (name) => `"${name}"`,
      escapeParam: (index) => `$${index + 1}`,
      escapeString: (value) => `'${value.replaceAll("'", "''")}'`,
      prepareTyping: () => "json",
    });
    expect(query.sql).toContain('COLLATE "sl-SI-x-icu"');
    expect(query.sql).toContain('"name"');
  });
});