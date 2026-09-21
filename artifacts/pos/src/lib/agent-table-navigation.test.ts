import { describe, expect, it } from "vitest";
import {
  parseAgentOpenTableNavigation,
  resolveSafeAgentStaticNavigation,
  resolveAgentOpenTable,
} from "./agent-table-navigation";

const tables = [
  { id: 41, stevilka: 1, ime: "Terasa" },
  { id: 99, stevilka: 12, ime: "Bar" },
  { id: 105, stevilka: 27, ime: "Miza 5" },
];

describe("resolveAgentOpenTable", () => {
  it("razreši prikazano številko mize v njen interni ID", () => {
    expect(resolveAgentOpenTable("odpriMizo=1", tables)).toBe(tables[0]);
    expect(resolveAgentOpenTable("odpriMizo=12", tables)).toBe(tables[1]);
    expect(resolveAgentOpenTable("odpriMizo=5", tables)).toBe(tables[2]);
  });

  it("zavrne manjkajočo, neveljavno ali neobstoječo mizo", () => {
    expect(resolveAgentOpenTable("", tables)).toBeNull();
    expect(resolveAgentOpenTable("odpriMizo=abc", tables)).toBeNull();
    expect(resolveAgentOpenTable("odpriMizo=0", tables)).toBeNull();
    expect(resolveAgentOpenTable("odpriMizo=7", tables)).toBeNull();
  });

  it("prepozna samo navigacijski namen za odpiranje mize", () => {
    expect(parseAgentOpenTableNavigation("/?odpriMizo=1")).toBe(1);
    expect(parseAgentOpenTableNavigation("/pos/?odpriMizo=12")).toBe(12);
    expect(parseAgentOpenTableNavigation("/narocilo/1")).toBeNull();
    expect(parseAgentOpenTableNavigation("/?odpriMizo=abc")).toBeNull();
  });

  it("zavrne neobstoječo ali dinamično pot splošnega modela", () => {
    expect(resolveSafeAgentStaticNavigation("/izmene")).toBe("/izmene");
    expect(resolveSafeAgentStaticNavigation("/narocilo/123")).toBeNull();
    expect(resolveSafeAgentStaticNavigation("/neobstojeca-pot")).toBeNull();
    expect(resolveSafeAgentStaticNavigation("/nastavitve?tab=nastavitve&section=sek-terminali&card=ns-viva")).toBe("/nastavitve?tab=nastavitve&section=sek-terminali&card=ns-viva");
    expect(resolveSafeAgentStaticNavigation("/nastavitve?tab=nastavitve&card=ns-viva")).toBeNull();
  });
});